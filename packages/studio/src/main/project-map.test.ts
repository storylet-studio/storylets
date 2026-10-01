// The project map page's write and read paths, headless, on a copy of Port
// Meridian: four boxes sharing the district map, and the codex, which is not on
// it (the surfacing review's plan item 2).

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@storylet-studio/compiler";
import { commentsOf, polygonOf } from "@storylet-studio/model";
import type { NotesShard, ProjectMapShard } from "@storylet-studio/model";
import { openProject, toDto } from "./project.js";
import type { ProjectSession } from "./project.js";
import {
  createHand, createZone, mapZoneDetail, postComment, projectMapView, setCommentResolved, setZonePolygon, undo,
  useProjectMap,
} from "./mutate.js";

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
  it("draws the zones once, with a layer per box on the map and none for a box off it", () => {
    const view = projectMapView(scratch());
    expect(view.hasMap).toBe(true);
    expect(view.groupId).toBe(GROUP);
    expect(view.layers.map((l) => l.box).sort()).toEqual(["b_contracts", "b_encounters", "b_items", "b_news"]);
    expect(view.zones.length + view.undrawn.length).toBeGreaterThan(0);
    // Every site carries its "only here" count, which the panels and pins read.
    for (const site of view.layers.flatMap((l) => l.sites)) expect(site.only).toBeGreaterThanOrEqual(0);
  });

  it("tells the navigator there is a map", () => {
    const dto = toDto(scratch().loaded);
    expect(dto.map).toMatchObject({ groupId: GROUP, gameId: "district" });
  });

  it("shows a zone's properties declared once, starting values per zone", () => {
    const zone = mapZoneDetail(scratch(), DOCKS)!;
    expect(zone.gameId).toBe("docks");
    expect(zone.properties).toContainEqual(expect.objectContaining({ name: "patrolled", type: "boolean", start: "true" }));
    // Used by: only boxes with a site or a card there, never the whole map.
    for (const b of zone.byBox) expect(b.sites.length + b.cards.length).toBeGreaterThan(0);
  });

  it("edits zones with no box named, writing the ROOT map shard", () => {
    const s = scratch();
    const shape = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    const created = createZone(s, "", GROUP, shape);
    if ("error" in created) throw new Error(created.error);
    expect(rootMap(s).group.tags.some((t) => t.id === created.tagId && polygonOf(t) !== undefined)).toBe(true);
    expect(setZonePolygon(s, "", GROUP, DOCKS, shape)).not.toHaveProperty("error");
    expect(polygonOf(rootMap(s).group.tags.find((t) => t.id === DOCKS)!)).toEqual(shape);
    // An unknown group is still refused.
    expect(createZone(s, "", "d_nope", shape)).toHaveProperty("error");
  });

  it("makes a site in the active box: the hand, its pin and its zone in ONE undo step", () => {
    const s = scratch();
    const docks = polygonOf(s.loaded.source!.map!.group.tags.find((t) => t.id === DOCKS)!)!;
    const inside = { x: (docks[0]!.x + docks[2]!.x) / 2, y: (docks[0]!.y + docks[2]!.y) / 2 };
    const made = createHand(s, "b_news", inside);
    if ("error" in made) throw new Error(made.error);
    const hand = box(s, "b_news").hands.hands.find((h) => h.id === made.handId)!;
    expect(hand.rule?.bindings?.[GROUP]).toBe(DOCKS);
    const sites = parseSource(readFileSync(join(s.loaded.dir, "news", "map.storyletmap"), "utf8")) as { map: { sites: Record<string, unknown> } };
    expect(sites.map.sites[made.handId]).toEqual({ x: Math.round(inside.x), y: Math.round(inside.y) });
    undo(s);
    expect(box(s, "b_news").hands.hands.some((h) => h.id === made.handId)).toBe(false);
    // A box off the map has nowhere to put one.
    expect(createHand(s, "b_codex", inside)).toHaveProperty("error");
  });

  it("joins a box to the map and lets it leave, refusing while it names a zone", () => {
    const s = scratch();
    expect(useProjectMap(s, "b_codex", true)).not.toHaveProperty("error");
    expect(box(s, "b_codex").box.box.usesMap).toBe(true);
    expect(projectMapView(s).layers.some((l) => l.box === "b_codex")).toBe(true);
    expect(useProjectMap(s, "b_codex", false)).not.toHaveProperty("error");
    expect(box(s, "b_codex").box.box.usesMap).toBeUndefined();
    // News files cards to districts and binds hands to them: leaving would make
    // it a compile error, so it is refused with a sentence that says why.
    const refused = useProjectMap(s, "b_news", false);
    expect(refused).toEqual({ error: expect.stringMatching(/can't leave the map while its/) });
    expect(box(s, "b_news").box.box.usesMap).toBe(true);
  });

  it("files a thread about the map itself in the ROOT notes", () => {
    const s = scratch();
    expect(postComment(s, "map", "cmt_root", "Ada", "The docks feel thin", { canvas: "map", x: 10, y: 20 })).not.toHaveProperty("error");
    const notesFile = join(s.loaded.dir, "notes.storyletnotes");
    expect(existsSync(notesFile)).toBe(true);
    const notes = parseSource(readFileSync(notesFile, "utf8")) as NotesShard;
    expect(commentsOf(notes).map((t) => t.anchor)).toEqual(["map"]);
    // A zone is the project's too.
    expect(postComment(s, DOCKS, "cmt_zone", "Ada", "Busy", undefined)).not.toHaveProperty("error");
    expect(setCommentResolved(s, "cmt_root", true)).not.toHaveProperty("error");
    expect(commentsOf(s.loaded.source!.notes).find((t) => t.id === "cmt_root")?.resolved).toBe(true);
    expect(toDto(s.loaded).threads[DOCKS]).toBe(1);
  });
});
