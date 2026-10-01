// The one definition of a place axis, as the editor's surfaces read it (the
// surfacing review, round 3 fix round, part B), headless on copies of the
// examples: the hand page's tiers off the map and on it, "+ New card here" by a
// hand's own binding rule, Group by filing placed cards under their hand's
// zone, a moving hand at every zone it can be in, and the guards on leaving the
// map.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLACE_GROUP, framesOf } from "@storylet-studio/model";
import { openProject, toDto } from "./project.js";
import type { ProjectSession } from "./project.js";
import {
  addBackground, createBox, createCard, handCards, mapZoneDetail, moveSitesOnMap, setGroupSpatial, useProjectMap,
} from "./mutate.js";
import { boxEntries, groupEntries } from "../renderer/src/card-groups.js";

const example = (name: string): string => fileURLToPath(new URL(`../../../../examples/${name}`, import.meta.url));

function scratch(name: string): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-axis-")), "copy.storylets");
  cpSync(example(name), dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const sourceBox = (s: ProjectSession, id: string) => s.loaded.source!.boxes.find((b) => b.box.box.id === id)!;
const PM_GROUP = "d_con_district";
const PM_DOCKS = "v_con_docks";

describe("the hand page off the map (Saltmarsh)", () => {
  it("tiers Docks street's own area, so its docks cards are not 'no place'", () => {
    const s = scratch("saltmarsh.storylets");
    const tiers = handCards(s, "b_enc", "h_docks")!;
    expect(tiers.bound).toEqual(["area"]);
    // Two cards are filed to the docks; the third of the three it can be dealt
    // carries no area at all, and is the one the Anywhere count holds.
    expect(tiers.tiers.map((t) => [t.tag, t.cards.length])).toEqual([["docks", 2]]);
    expect(tiers.tiers[0]!.zone).toBeUndefined();   // the box's own group, not the map's
    expect(tiers.anywhere.length).toBe(1);
    // The Where row reads the same group as a place axis.
    const box = toDto(s.loaded).boxes.find((b) => b.id === "b_enc")!;
    expect(box.tagGroups.find((g) => g.gameId === "area")?.placeAxis).toBe(true);
  });

  it("makes a card at a conversation hand tagged with its npc, not pinned to the hand", () => {
    const s = scratch("saltmarsh.storylets");
    const made = createBox(s, "dialogue");
    if ("error" in made) throw new Error(made.error);
    const box = sourceBox(s, made.boxId);
    const gareth = box.hands.hands.find((h) => h.title === "Talking to Gareth")!;
    const npc = box.tags.groups.find((g) => g.gameId === "npc")!;
    const tiers = handCards(s, made.boxId, gareth.id)!;
    // Gareth's topics are tiered under him; Mira's alone are not his at all.
    expect(tiers.tiers.map((t) => `${t.group}: ${t.tag}`)).toEqual(["npc: gareth"]);
    expect(tiers.tiers[0]!.cards.length).toBe(3);
    expect(tiers.anywhere.length).toBe(1);   // the weather: anyone's smalltalk
    const deck = box.decks[0]!.shard.deck.id;
    const created = createCard(s, deck, gareth.id);
    if ("error" in created) throw new Error(created.error);
    const card = sourceBox(s, made.boxId).decks[0]!.shard.cards.find((c) => c.id === created.cardId)!;
    expect(card.tags).toEqual({ [npc.id]: [gareth.chosen![npc.id]!] });
  });

  it("still pins a card made at a placed map hand to that hand", () => {
    const s = scratch("the-village.storylets");
    const box = s.loaded.source!.boxes[0]!;
    const inn = box.hands.hands.find((h) => (h.title ?? "").includes("Inn"))!;
    const created = createCard(s, box.decks[0]!.shard.deck.id, inn.id);
    if ("error" in created) throw new Error(created.error);
    const card = s.loaded.source!.boxes[0]!.decks[0]!.shard.cards.find((c) => c.id === created.cardId)!;
    expect(card.tags).toEqual({ [PLACE_GROUP]: [inn.id] });
  });
});

describe("the hand page on the map", () => {
  it("shows a card placed here but filed to another zone, with the reason", () => {
    const s = scratch("the-village.storylets");
    const box = s.loaded.source!.boxes[0]!;
    const zone = s.loaded.source!.map!.group;
    const inn = box.hands.hands.find((h) => (h.title ?? "").includes("Inn"))!;
    const innZone = Object.values(inn.chosen ?? {})[0] ?? inn.rule?.bindings?.[zone.id];
    const elsewhere = zone.tags.find((t) => t.id !== innZone)!;
    const card = box.decks[0]!.shard.cards[0]!;
    card.tags = { [PLACE_GROUP]: [inn.id], [zone.id]: [elsewhere.id] };
    const tiers = handCards(s, box.box.box.id, inn.id)!;
    expect(tiers.only.some((r) => r.card === card.id)).toBe(false);
    const never = tiers.never.find((r) => r.card === card.id)!;
    expect(never.why).toMatch(/is in .*, but this card is filed to/);
  });
});

describe("Group by a place axis (Port Meridian)", () => {
  it("files a card placed at a site under that site's district, never Untagged", () => {
    const s = scratch("port-meridian.storylets");
    const box = toDto(s.loaded).boxes.find((b) => b.id === "b_contracts")!;
    const district = box.tagGroups.find((g) => g.gameId === "district")!;
    const groups = groupEntries(box, boxEntries(box), `tag:${district.id}`);
    expect(groups.find((g) => g.key === "rest")).toBeUndefined();
  });
});

describe("a moving hand", () => {
  it("is listed at every zone its property can name, marked as moving", () => {
    const s = scratch("port-meridian.storylets");
    const source = s.loaded.source!;
    source.project.story = {
      ...source.project.story,
      properties: [...(source.project.story?.properties ?? []), { name: "courier_at", type: "enum", default: "docks", values: ["docks", "strip"] }],
    };
    const news = sourceBox(s, "b_news");
    const hand = news.hands.hands[0]!;
    if (hand.template !== undefined) hand.chosen = { ...hand.chosen, [PM_GROUP]: "@story.courier_at" };
    else hand.rule = { ...hand.rule!, bindings: { ...hand.rule?.bindings, [PM_GROUP]: "@story.courier_at" } };
    const docks = mapZoneDetail(s, PM_DOCKS)!;
    expect(docks.byBox.find((b) => b.box === "b_news")!.sites.find((x) => x.id === hand.id)).toMatchObject({ moving: true });
    const oldgrid = source.map!.group.tags.find((t) => t.gameId === "oldgrid")!;
    const there = mapZoneDetail(s, oldgrid.id)!.byBox.find((b) => b.box === "b_news");
    expect(there?.sites.some((x) => x.id === hand.id) ?? false).toBe(false);
    const tiers = handCards(s, "b_news", hand.id)!;
    expect(tiers.moving).toBe(true);
    expect(tiers.tiers.filter((t) => t.zone === true).map((t) => t.tag)).toEqual(["docks", "strip"]);
  });
});

describe("leaving the map", () => {
  it("is refused while an expression reads a zone property, naming the card and where", () => {
    const s = scratch("port-meridian.storylets");
    expect(useProjectMap(s, "b_codex", true)).not.toHaveProperty("error");
    const card = sourceBox(s, "b_codex").decks[0]!.shard.cards[0]!;
    card.condition = "@hand.patrolled";
    const refused = useProjectMap(s, "b_codex", false);
    // Named by its title, with the card to open (the round-3 wording pass).
    expect(refused).toMatchObject({
      refused: { body: expect.stringContaining(`its card "${card.title}" reads @hand.patrolled in its When`), open: { kind: "card", id: card.id } },
    });
    card.condition = 'count_played_in("district", "docks") > 0';
    expect(useProjectMap(s, "b_codex", false)).toMatchObject({ refused: { body: expect.stringContaining('count_played_in("district")') } });
    delete card.condition;
    const left = useProjectMap(s, "b_codex", false);
    expect(left).not.toHaveProperty("error");
    expect(left).not.toHaveProperty("refused");
  });

  it("asks before deleting the box's positions on the map", () => {
    const s = scratch("port-meridian.storylets");
    expect(useProjectMap(s, "b_codex", true)).not.toHaveProperty("error");
    const hand = sourceBox(s, "b_codex").hands.hands[0]!;
    // Put down well away from every zone, so nothing is bound by it.
    const moved = moveSitesOnMap(s, "b_codex", PM_GROUP, [{ id: hand.id, x: -99999, y: -99999 }]);
    if ("error" in moved) throw new Error(moved.error);
    const asked = useProjectMap(s, "b_codex", false);
    expect(asked).toEqual({ confirm: { title: expect.stringContaining("off the project map"), body: expect.stringContaining("position") } });
    expect(sourceBox(s, "b_codex").box.box.usesMap).toBe(true);
    expect(useProjectMap(s, "b_codex", false, true)).not.toHaveProperty("error");
    expect(sourceBox(s, "b_codex").box.box.usesMap).toBeUndefined();
  });
});

describe("stop being a map", () => {
  it("refuses while the map has pictures or frames, rather than losing them", () => {
    const s = scratch("saltmarsh.storylets");
    expect(setGroupSpatial(s, "b_enc", "d_zone", true)).not.toHaveProperty("error");
    const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
    const added = addBackground(s, "b_enc", "d_zone", { name: "plan.png", bytes: PNG }, { view: { width: 100, height: 100 }, scale: 1, at: { x: 0, y: 0 } });
    expect(added).not.toHaveProperty("error");
    const refused = setGroupSpatial(s, "b_enc", "d_zone", false);
    expect(refused).toEqual({ error: expect.stringContaining("1 picture") });
    expect(s.loaded.source!.map).toBeDefined();
    expect(framesOf(s.loaded.source!.map!)).toEqual([]);
  });
});
