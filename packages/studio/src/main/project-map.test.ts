// The project map page's write and read paths, headless, on a copy of Port
// Meridian: four boxes sharing the district map, and the codex, which is not on
// it (the surfacing review's plan item 2).

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@storylet-studio/compiler";
import { commentsOf, polygonOf, zoneAt } from "@storylet-studio/model";
import type { NotesShard, ProjectMapShard, ViewShard } from "@storylet-studio/model";
import { openProject, toDto } from "./project.js";
import type { ProjectSession } from "./project.js";
import {
  createCard, createHand, createZone, handCards, mapZoneDetail, moveBox, moveSitesOnMap, postComment, projectMapView, setBoxColour, setCommentResolved,
  setZonePolygon, undo, useProjectMap,
} from "./mutate.js";
import { COLOUR_ORDER, nextColour } from "./box-colours.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/port-meridian.storylets", import.meta.url));

function scratch(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-projmap-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const GROUP = "d_con_district";
const DOCKS = "v_con_docks";
const rootMap = (s: ProjectSession): ProjectMapShard =>
  parseSource(readFileSync(join(s.loaded.dir, "map.storyletmap"), "utf8")) as ProjectMapShard;
const box = (s: ProjectSession, id: string) => s.loaded.source!.boxes.find((b) => b.box.box.id === id)!;

describe("the project map page", () => {
  it("draws the zones once, with a layer per box on the map and none for a box off it", async () => {
    const view = await projectMapView(scratch());
    expect(view.hasMap).toBe(true);
    expect(view.groupId).toBe(GROUP);
    expect(view.layers.map((l) => l.box).sort()).toEqual(["b_contracts", "b_encounters", "b_items", "b_news"]);
    expect(view.zones.length + view.undrawn.length).toBeGreaterThan(0);
    // Every site carries its "only here" count, which the panels and pins read.
    for (const site of view.layers.flatMap((l) => l.sites)) expect(site.only).toBeGreaterThanOrEqual(0);
  });

  it("tells the navigator there is a map", async () => {
    const dto = toDto(scratch().loaded);
    expect(dto.map).toMatchObject({ groupId: GROUP, gameId: "district" });
  });

  it("shows a zone's properties declared once, starting values per zone", async () => {
    const zone = mapZoneDetail(scratch(), DOCKS)!;
    expect(zone.gameId).toBe("docks");
    expect(zone.properties).toContainEqual(expect.objectContaining({ name: "patrolled", type: "boolean", start: "true" }));
    // Used by: only boxes with a site or a card there, never the whole map.
    for (const b of zone.byBox) expect(b.sites.length + b.cards.length).toBeGreaterThan(0);
  });

  it("edits zones with no box named, writing the ROOT map shard", async () => {
    const s = scratch();
    const shape = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    const created = await createZone(s, "", GROUP, shape);
    if ("error" in created) throw new Error(created.error);
    expect(rootMap(s).group.tags.some((t) => t.id === created.tagId && polygonOf(t) !== undefined)).toBe(true);
    expect(await setZonePolygon(s, "", GROUP, DOCKS, shape)).not.toHaveProperty("error");
    expect(polygonOf(rootMap(s).group.tags.find((t) => t.id === DOCKS)!)).toEqual(shape);
    // An unknown group is still refused.
    expect(await createZone(s, "", "d_nope", shape)).toHaveProperty("error");
  });

  it("names a zone as it is drawn, slugged, and falls back to new-zone rather than lose the shape", async () => {
    const s = scratch();
    const shape = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    const named = await createZone(s, "", GROUP, shape, "The Study");
    if ("error" in named) throw new Error(named.error);
    const tag = (id: string): string | undefined => rootMap(s).group.tags.find((t) => t.id === id)?.gameId;
    expect(tag(named.tagId)).toBe("the-study");
    const again = await createZone(s, "", GROUP, shape, "the-study");
    if ("error" in again) throw new Error(again.error);
    expect(tag(again.tagId)).toBe("the-study-2");
    const blank = await createZone(s, "", GROUP, shape, "  ");
    if ("error" in blank) throw new Error(blank.error);
    expect(tag(blank.tagId)).toBe("new-zone");
  });

  it("makes a site in the active box: the hand, its pin and its zone in ONE undo step", async () => {
    const s = scratch();
    const docks = polygonOf(s.loaded.source!.map!.group.tags.find((t) => t.id === DOCKS)!)!;
    const inside = { x: (docks[0]!.x + docks[2]!.x) / 2, y: (docks[0]!.y + docks[2]!.y) / 2 };
    const made = await createHand(s, "b_news", inside);
    if ("error" in made) throw new Error(made.error);
    const hand = box(s, "b_news").hands.hands.find((h) => h.id === made.handId)!;
    expect(hand.rule?.bindings?.[GROUP]).toBe(DOCKS);
    const sites = parseSource(readFileSync(join(s.loaded.dir, "news", "map.storyletmap"), "utf8")) as { map: { sites: Record<string, unknown> } };
    expect(sites.map.sites[made.handId]).toEqual({ x: Math.round(inside.x), y: Math.round(inside.y) });
    await undo(s);
    expect(box(s, "b_news").hands.hands.some((h) => h.id === made.handId)).toBe(false);
    // A box off the map has nowhere to put one.
    expect(await createHand(s, "b_codex", inside)).toHaveProperty("error");
  });

  it("joins a box to the map and lets it leave, refusing while it names a zone", async () => {
    const s = scratch();
    expect(await useProjectMap(s, "b_codex", true)).not.toHaveProperty("error");
    expect(box(s, "b_codex").box.box.usesMap).toBe(true);
    expect((await projectMapView(s)).layers.some((l) => l.box === "b_codex")).toBe(true);
    expect(await useProjectMap(s, "b_codex", false)).not.toHaveProperty("error");
    expect(box(s, "b_codex").box.box.usesMap).toBeUndefined();
    // News files cards to districts and binds hands to them: leaving would make
    // it a compile error, so it is refused with a sentence that says why.
    const refused = await useProjectMap(s, "b_news", false);
    // Named by titles, quoted, with the thing to open to change it.
    expect(refused).toMatchObject({
      refused: {
        title: "\"News\" is still using the map",
        body: expect.stringMatching(/^It can't leave the project map while its hand "[^"]+" is in the zone "[^"]+"\./),
        open: { kind: "hand", box: "b_news" },
      },
    });
    expect(box(s, "b_news").box.box.usesMap).toBe(true);
  });

  it("lets a box leave whose @hand reads a name it declares itself, and only a map-sourced name holds it", async () => {
    const s = scratch();
    expect(await useProjectMap(s, "b_codex", true)).not.toHaveProperty("error");
    const codex = box(s, "b_codex");
    const deck = codex.decks[0]!.shard;
    deck.cards[0]!.condition = "@hand.patrolled";
    // Without a declaration of its own, `patrolled` is the map's: refused.
    expect(await useProjectMap(s, "b_codex", false, true)).toMatchObject({ refused: { body: expect.stringContaining("@hand.patrolled") } });
    // Its own tag group declaring `patrolled` (Saltmarsh's `area/docks` shape):
    // off the map the name resolves to that, so the box may leave.
    codex.tags.groups.push({ id: "d_lore", gameId: "lore", tags: [{ id: "v_lore_old", gameId: "old", properties: [{ name: "patrolled", type: "boolean", default: false }] }] });
    expect(await useProjectMap(s, "b_codex", false, true)).not.toHaveProperty("refused");
  });

  it("makes a hand of a picked template from the map, its zone hole filled by the pin", async () => {
    const s = scratch();
    const docks = polygonOf(s.loaded.source!.map!.group.tags.find((t) => t.id === DOCKS)!)!;
    const inside = { x: (docks[0]!.x + docks[2]!.x) / 2, y: (docks[0]!.y + docks[2]!.y) / 2 };
    const layer = (await projectMapView(s)).layers.find((l) => l.box === "b_news")!;
    expect(layer.templates).toEqual([{ id: "t_screen", title: "Public screens" }]);
    const made = await createHand(s, "b_news", inside, "t_screen");
    if ("error" in made) throw new Error(made.error);
    const hand = box(s, "b_news").hands.hands.find((h) => h.id === made.handId)!;
    expect(hand.template).toBe("t_screen");
    expect(hand.rule).toBeUndefined();
    expect(hand.chosen?.[GROUP]).toBe(DOCKS);
    expect(await createHand(s, "b_news", inside, "t_nope")).toHaveProperty("error");
  });

  it("files a new card to a zone from the zone's panel, and only in a box on the map", async () => {
    const s = scratch();
    const deck = box(s, "b_news").decks[0]!.shard.deck.id;
    const made = await createCard(s, deck, undefined, DOCKS);
    if ("error" in made) throw new Error(made.error);
    const card = box(s, "b_news").decks[0]!.shard.cards.find((c) => c.id === made.cardId)!;
    expect(card.tags).toEqual({ [GROUP]: [DOCKS] });
    const codexDeck = box(s, "b_codex").decks[0]!.shard.deck.id;
    expect(await createCard(s, codexDeck, undefined, DOCKS)).toHaveProperty("error");
  });

  it("deletes the box's emptied map shard in the same step as leaving", async () => {
    const s = scratch();
    const docks = polygonOf(s.loaded.source!.map!.group.tags.find((t) => t.id === DOCKS)!)!;
    expect(await useProjectMap(s, "b_codex", true)).not.toHaveProperty("error");
    // A pin for the codex's one hand, nowhere near a zone, so nothing is bound.
    const hand = box(s, "b_codex").hands.hands[0]!;
    expect(await moveSitesOnMap(s, "b_codex", GROUP, [{ id: hand.id, x: docks[0]!.x - 5000, y: docks[0]!.y - 5000 }])).not.toHaveProperty("error");
    const shard = join(s.loaded.dir, "codex", "map.storyletmap");
    expect(existsSync(shard)).toBe(true);
    expect(await useProjectMap(s, "b_codex", false, true)).not.toHaveProperty("error");
    expect(existsSync(shard)).toBe(false);
    await undo(s);
    expect(existsSync(shard)).toBe(true);
  });
});

describe("box colours on the map", () => {
  const stored = (s: ProjectSession, folder: string): number | undefined => {
    const file = join(s.loaded.dir, folder, "view.storyletview");
    return existsSync(file) ? (parseSource(readFileSync(file, "utf8")) as ViewShard).colour : undefined;
  };

  it("stores a distinct colour for every box on the map the first time it is drawn, and none for one off it", async () => {
    const s = scratch();
    const view = await projectMapView(s);
    const colours = view.layers.map((l) => l.colour);
    expect(new Set(colours).size).toBe(4);
    // Project order takes the palette's spread order: opposite hues first.
    expect(colours).toEqual(COLOUR_ORDER.slice(0, 4));
    expect(["contracts", "encounters", "items", "news"].map((f) => stored(s, f))).toEqual(colours);
    expect(stored(s, "codex")).toBeUndefined();
    // Written once: a second drawing writes nothing new.
    expect((await projectMapView(s)).layers.map((l) => l.colour)).toEqual(colours);
  });

  it("keeps each box's colour when the boxes are reordered", async () => {
    const s = scratch();
    const before = new Map((await projectMapView(s)).layers.map((l) => [l.box, l.colour]));
    expect(await moveBox(s, "b_news", "b_contracts", true)).not.toHaveProperty("error");
    const after = new Map((await projectMapView(s)).layers.map((l) => [l.box, l.colour]));
    expect(after).toEqual(before);
  });

  it("gives a joining box a colour no other box on the map uses, in the same undo step", async () => {
    const s = scratch();
    const taken = (await projectMapView(s)).layers.map((l) => l.colour);
    expect(await useProjectMap(s, "b_codex", true)).not.toHaveProperty("error");
    const codex = stored(s, "codex");
    expect(codex).toBe(COLOUR_ORDER[4]);
    expect(taken).not.toContain(codex);
    await undo(s);
    expect(stored(s, "codex")).toBeUndefined();
  });

  it("changes a colour from the swatch, undoably", async () => {
    const s = scratch();
    await projectMapView(s);
    const was = stored(s, "news");
    expect(await setBoxColour(s, "b_news", 5)).not.toHaveProperty("error");
    expect(stored(s, "news")).toBe(5);
    expect(toDto(s.loaded).boxes.find((b) => b.id === "b_news")?.colour).toBe(5);
    await undo(s);
    expect(stored(s, "news")).toBe(was);
    expect(await setBoxColour(s, "b_news", 12)).toHaveProperty("error");
  });

  it("folds the first colours into the author's last step, never a step of their own", async () => {
    const s = scratch();
    const made = await createHand(s, "b_news");
    if ("error" in made) throw new Error(made.error);
    await projectMapView(s);
    expect(stored(s, "news")).toBeDefined();
    // One undo takes the new hand away, and the colours it was drawn with.
    await undo(s);
    expect(box(s, "b_news").hands.hands.some((h) => h.id === made.handId)).toBe(false);
    expect(stored(s, "news")).toBeUndefined();
  });

  it("nextColour takes the least-used slot once every slot is taken", async () => {
    expect(nextColour([])).toBe(COLOUR_ORDER[0]);
    expect(nextColour([COLOUR_ORDER[0]!])).toBe(COLOUR_ORDER[1]);
    expect(nextColour([...COLOUR_ORDER, COLOUR_ORDER[0]!])).toBe(COLOUR_ORDER[1]);
  });

  it("files a thread about the map itself in the ROOT notes", async () => {
    const s = scratch();
    expect(await postComment(s, "map", "cmt_root", "Ada", "The docks feel thin", { canvas: "map", x: 10, y: 20 })).not.toHaveProperty("error");
    const notesFile = join(s.loaded.dir, "notes.storyletnotes");
    expect(existsSync(notesFile)).toBe(true);
    const notes = parseSource(readFileSync(notesFile, "utf8")) as NotesShard;
    expect(commentsOf(notes).map((t) => t.anchor)).toEqual(["map"]);
    // A zone is the project's too.
    expect(await postComment(s, DOCKS, "cmt_zone", "Ada", "Busy", undefined)).not.toHaveProperty("error");
    expect(await setCommentResolved(s, "cmt_root", true)).not.toHaveProperty("error");
    expect(commentsOf(s.loaded.source!.notes).find((t) => t.id === "cmt_root")?.resolved).toBe(true);
    expect(toDto(s.loaded).threads[DOCKS]).toBe(1);
  });
});

// A template that CHOOSES a group gives each instance one fixed choice: Port
// Meridian's stash makes Container 7 in the docks, The Back Room in the strip
// and Service Duct in the old grid. Only a hole filled from a property moves a
// hand. Pinned after a review read a scratch copy (whose stash had been edited
// to bind every instance to the docks) as the map mistaking a chooses template
// for a moving hand.
describe("a chooses-template instance with a fixed choice", () => {
  const ZONES = { docks: "v_con_docks", strip: "v_con_strip", oldgrid: "v_con_oldgrid" };
  const HANDS = { h_container_7: ZONES.docks, h_back_room: ZONES.strip, h_service_duct: ZONES.oldgrid };

  it("is listed at exactly one zone, its own", async () => {
    const s = scratch();
    for (const [hand, zone] of Object.entries(HANDS)) {
      const at = Object.values(ZONES).filter((z) => mapZoneDetail(s, z)!.byBox.some((b) => b.sites.some((x) => x.id === hand)));
      expect(at, hand).toEqual([zone]);
      expect(mapZoneDetail(s, zone)!.byBox.flatMap((b) => b.sites).find((x) => x.id === hand)?.moving, hand).toBeUndefined();
    }
  });

  it("is drawn bound to its own zone and standing inside it, so it wears no ring", async () => {
    // The ring (renderer map-art `pinPlacement`, tested there) is drawn when the
    // frontmost zone under a pin is not the one its hand is bound to. Here both
    // halves come from main: the binding the pin carries, and the frontmost
    // zone at the pin, by the model's own `zoneAt`, which pinPlacement reads.
    const s = scratch();
    const view = await projectMapView(s);
    const items = view.layers.find((l) => l.box === "b_items")!;
    for (const [hand, zone] of Object.entries(HANDS)) {
      const site = items.sites.find((x) => x.id === hand)!;
      expect(site.zone, hand).toBe(zone);
      expect(zoneAt({ x: site.x, y: site.y }, view.zones), hand).toBe(zone);
      // Outside every zone, the frontmost zone is none: a ring.
      expect(zoneAt({ x: -9999, y: -9999 }, view.zones), hand).toBeUndefined();
    }
  });

  it("has one zone tier on its page, and tells Group by its one zone", async () => {
    const s = scratch();
    const dto = toDto(s.loaded).boxes.find((b) => b.id === "b_items")!;
    for (const [hand, zone] of Object.entries(HANDS)) {
      const tiers = handCards(s, "b_items", hand)!;
      expect(tiers.moving, hand).toBeUndefined();
      expect(tiers.tiers.map((t) => t.tag), hand).toEqual([name(s, zone)]);
      // What card-groups.ts `filedUnder` reads: the one tag, and nothing moving.
      const h = dto.hands.find((x) => x.id === hand)!;
      expect(h.tags["district"], hand).toBe(name(s, zone));
      expect(h.moving, hand).toBeUndefined();
    }
  });

  const name = (s: ProjectSession, id: string): string =>
    s.loaded.source!.map!.group.tags.find((t) => t.id === id)!.gameId!;
});
