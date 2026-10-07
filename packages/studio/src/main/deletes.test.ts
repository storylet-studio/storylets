// Deletes and map-making as single, honest undo steps (the Storyletter review of
// 2026-10, items 5, 13 and 15): several cards are one step, a hand takes its pin
// with it, a tag group in use is refused by evidence, an id that is not there
// is an error rather than an empty step, and making a map is one step with a
// key of its own.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProject, validate } from "./project.js";
import {
  createGroupAsMap, createTagGroup, deleteCard, deleteCards, deleteCardsAcross, deleteHand, deleteTagGroup, deleteTemplate,
  saveTagGroup, setGroupSpatial, undo,
} from "./mutate.js";
import { isSpatial } from "@storylet-studio/model";
import type { ProjectSession } from "./project.js";

const examples = fileURLToPath(new URL("../../../../examples/", import.meta.url));

function scratch(example: string): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-deletes-")), example);
  cpSync(join(examples, example), dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const docks = "k_docks";
const encBox = "b_enc";
const cardsOf = (session: ProjectSession): string[] => session.dto.boxes[0]!.decks[0]!.cards.map((c) => c.id);
const errorsOf = (r: { problems: { severity: string }[] }): number => r.problems.filter((p) => p.severity === "error").length;

describe("deleting several cards (review 2026-10, item 5)", () => {
  it("is one undo step, as the dialog promises", async () => {
    const session = scratch("saltmarsh.storylets");
    const [a, b] = cardsOf(session);
    const result = await deleteCards(session, docks, [a!, b!]);
    if ("error" in result) throw new Error(result.error);
    expect(cardsOf(session)).not.toContain(a);
    expect(cardsOf(session)).not.toContain(b);

    await undo(session);
    expect(cardsOf(session)).toContain(a);
    expect(cardsOf(session)).toContain(b);
    // Nothing before it: the two deletes were one step, not two.
    expect(await undo(session)).toBeNull();
  });

  it("refuses a card that is not in the deck, and records nothing", async () => {
    const session = scratch("saltmarsh.storylets");
    const [a] = cardsOf(session);
    expect(await deleteCards(session, docks, [a!, "c_gone"])).toMatchObject({ error: expect.any(String) });
    expect(cardsOf(session)).toContain(a);
    expect(await undo(session)).toBeNull();
  });
});

describe("deleting cards from several decks at once (a box's Contents)", () => {
  const allCards = (session: ProjectSession): string[] => session.dto.boxes.flatMap((b) => b.decks.flatMap((d) => d.cards.map((c) => c.id)));

  it("is still one undo step", async () => {
    const session = scratch("saltmarsh.storylets");
    const [one, two] = session.dto.boxes.flatMap((b) => b.decks).filter((d) => d.cards.length > 0);
    expect(two, "the example needs two decks with cards").toBeDefined();
    const a = one!.cards[0]!.id, b = two!.cards[0]!.id;
    const result = await deleteCardsAcross(session, [{ deckId: one!.id, cardIds: [a] }, { deckId: two!.id, cardIds: [b] }]);
    if ("error" in result) throw new Error(result.error);
    expect(allCards(session)).not.toContain(a);
    expect(allCards(session)).not.toContain(b);
    await undo(session);
    expect(allCards(session)).toContain(a);
    expect(allCards(session)).toContain(b);
    expect(await undo(session)).toBeNull();
  });

  it("refuses the whole delete when one deck's card has gone, and changes nothing", async () => {
    const session = scratch("saltmarsh.storylets");
    const [one, two] = session.dto.boxes.flatMap((b) => b.decks).filter((d) => d.cards.length > 0);
    const a = one!.cards[0]!.id;
    expect(await deleteCardsAcross(session, [{ deckId: one!.id, cardIds: [a] }, { deckId: two!.id, cardIds: ["c_gone"] }]))
      .toMatchObject({ error: expect.any(String) });
    expect(allCards(session)).toContain(a);
    expect(await undo(session)).toBeNull();
  });
});

describe("deleting what is not there (review 2026-10, item 15)", () => {
  it("is an error, not an empty undo step, for a card, a hand, a template and a tag group", async () => {
    const session = scratch("saltmarsh.storylets");
    expect(await deleteCard(session, docks, "c_gone")).toMatchObject({ error: expect.any(String) });
    expect(await deleteHand(session, encBox, "h_gone")).toMatchObject({ error: expect.any(String) });
    expect(await deleteTemplate(session, encBox, "t_gone")).toMatchObject({ error: expect.any(String) });
    expect(await deleteTagGroup(session, encBox, "d_gone")).toMatchObject({ error: expect.any(String) });
    expect(await undo(session)).toBeNull();
  });

  it("names no internal id in the message (house style rule 34)", async () => {
    const session = scratch("saltmarsh.storylets");
    const result = await deleteHand(session, encBox, "h_0123");
    expect("error" in result && result.error.includes("h_0123")).toBe(false);
    const deck = await deleteCards(session, "k_nope", ["c_x"]);
    expect("error" in deck && deck.error.includes("k_nope")).toBe(false);
  });
});

describe("deleting a pinned hand on the Village (review 2026-10, item 15)", () => {
  it("clears its pin in the same step, leaving no new errors", async () => {
    const session = scratch("the-village.storylets");
    const mapFile = join(session.loaded.dir, "village", "map.storyletmap");
    expect(readFileSync(mapFile, "utf8")).toContain("h_000b");
    const baseline = errorsOf({ problems: validate(session) });

    const result = await deleteHand(session, "b_0000", "h_000b");
    if ("error" in result) throw new Error(result.error);
    expect(readFileSync(mapFile, "utf8")).not.toContain("h_000b");
    // Nothing is said about the map: no pin is left for a hand that is gone.
    expect(result.problems.filter((p) => p.path.endsWith(".storyletmap"))).toEqual([]);
    // The cards made AT that hand still say so, which is the author's to settle
    // (the renderer confirms the delete by that evidence): those are the only
    // errors the delete adds.
    const added = result.problems.filter((p) => p.severity === "error" && !p.message.startsWith("place tag points at a hand"));
    expect(added.length).toBe(baseline);

    // One undo brings the hand and its pin back together.
    await undo(session);
    expect(readFileSync(mapFile, "utf8")).toContain("h_000b");
    expect(session.loaded.source!.boxes[0]!.hands.hands.some((h) => h.id === "h_000b")).toBe(true);
  });
});

describe("deleting a tag group in use (review 2026-10, item 15)", () => {
  it("is refused, saying how many cards still carry it, as a non-empty deck is", async () => {
    const session = scratch("the-village.storylets");
    const box = session.loaded.source!.boxes[0]!;
    const tagged = box.decks.flatMap((d) => d.shard.cards).filter((c) => (c.tags?.["d_0002"] ?? []).length > 0).length;
    expect(tagged).toBeGreaterThan(0);

    const result = await deleteTagGroup(session, "b_0000", "d_0002");
    expect(result).toMatchObject({ error: expect.stringContaining(`${tagged} card`) });
    expect(session.loaded.source!.boxes[0]!.tags.groups.some((g) => g.id === "d_0002")).toBe(true);
    expect(await undo(session)).toBeNull();
  });

  it("still deletes a group nothing is tagged with", async () => {
    const session = scratch("saltmarsh.storylets");
    const created = await createTagGroup(session, encBox);
    if ("error" in created) throw new Error(created.error);
    const result = await deleteTagGroup(session, encBox, created.groupId);
    expect("error" in result).toBe(false);
  });
});

describe("making a map (review 2026-10, item 13)", () => {
  it("does not fold into the tag-group edit before it", async () => {
    const session = scratch("saltmarsh.storylets");
    await saveTagGroup(session, encBox, "d_zone", { purpose: "Where things happen" });
    await setGroupSpatial(session, encBox, "d_zone", true);
    expect(session.loaded.source!.map).toBeDefined();

    // One undo takes the map back and leaves the group edit standing.
    await undo(session);
    expect(session.loaded.source!.map).toBeUndefined();
    const group = session.loaded.source!.boxes[0]!.tags.groups.find((g) => g.id === "d_zone")!;
    expect(group.purpose).toBe("Where things happen");
  });

  it("Create map is one commit: the group and its map in one undo step", async () => {
    const session = scratch("saltmarsh.storylets");
    const groupsBefore = session.loaded.source!.boxes[0]!.tags.groups.length;
    const made = await createGroupAsMap(session, encBox);
    if ("error" in made) throw new Error(made.error);
    expect(session.loaded.source!.map?.group.id).toBe(made.groupId);
    expect(isSpatial(session.loaded.source!.map!.group)).toBe(true);

    await undo(session);
    expect(session.loaded.source!.map).toBeUndefined();
    expect(session.loaded.source!.boxes[0]!.tags.groups.length).toBe(groupsBefore);
    expect(await undo(session)).toBeNull();
  });

  it("Create map on a project that already has one is refused, and nothing is made", async () => {
    const session = scratch("the-village.storylets");
    const groupsBefore = session.loaded.source!.boxes[0]!.tags.groups.length;
    expect(await createGroupAsMap(session, "b_0000")).toMatchObject({ error: expect.stringContaining("map already") });
    expect(session.loaded.source!.boxes[0]!.tags.groups.length).toBe(groupsBefore);
    expect(await undo(session)).toBeNull();
  });
});
