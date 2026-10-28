// Moving a card to another deck (the hands-on review, 2026-10, foundation 4):
// both decks written as one undo step, the card keeping its id and Game ID,
// and only within its own box. And Duplicate's copy, which takes the next free
// title and pins no Game ID.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProject, projectSettings } from "./project.js";
import { duplicateCard, moveCardToDeck, saveProjectSettings, undo } from "./mutate.js";
import { renamePropertyEverywhere } from "./mutate/stages.js";
import type { ProjectSession } from "./project.js";

const saltmarsh = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

function scratch(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-move-card-")), "copy.storylets");
  cpSync(saltmarsh, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const deck = (session: ProjectSession, id: string) => session.dto.boxes[0]!.decks.find((d) => d.id === id)!;

describe("moveCardToDeck", () => {
  it("moves a card to the end of another deck in its box, keeping its id and Game ID, as one undo step", async () => {
    const session = scratch();
    const card = deck(session, "k_docks").cards[0]!;
    const result = await moveCardToDeck(session, "k_docks", card.id, "k_market");
    expect("error" in result).toBe(false);
    expect(deck(session, "k_docks").cards.map((c) => c.id)).not.toContain(card.id);
    const moved = deck(session, "k_market").cards.at(-1)!;
    expect(moved.id).toBe(card.id);
    expect(moved.gameId).toBe(card.gameId);

    await undo(session);
    expect(deck(session, "k_docks").cards.map((c) => c.id)).toContain(card.id);
    expect(deck(session, "k_market").cards.map((c) => c.id)).not.toContain(card.id);
  });

  it("refuses a deck that isn't there", async () => {
    const session = scratch();
    const card = deck(session, "k_docks").cards[0]!;
    expect(await moveCardToDeck(session, "k_docks", card.id, "k_nowhere")).toHaveProperty("error");
  });
});

describe("duplicateCard", () => {
  it("titles the copy with the next free number and pins no Game ID, so a copy of a copy isn't -copy-copy", async () => {
    const session = scratch();
    const original = deck(session, "k_docks").cards[0]!;
    const first = await duplicateCard(session, "k_docks", original.id);
    if ("error" in first) throw new Error(first.error);
    const copy = deck(session, "k_docks").cards.find((c) => c.id === first.cardId)!;
    expect(copy.title).toBe(`${original.title} 2`);
    // Shown just after the original, not tied with it.
    const shown = deck(session, "k_docks").cards.map((c) => c.id);
    expect(shown.indexOf(copy.id)).toBe(shown.indexOf(original.id) + 1);
    expect(copy.gameId).not.toMatch(/copy/);
    const second = await duplicateCard(session, "k_docks", copy.id);
    if ("error" in second) throw new Error(second.error);
    expect(deck(session, "k_docks").cards.find((c) => c.id === second.cardId)!.title).toBe(`${original.title} 3`);
  });
});

// Renaming a property carries every reference (the hands-on review, 2026-10,
// foundation 4), as one undo step.
describe("renamePropertyEverywhere", () => {
  const hamlet = fileURLToPath(new URL("../../../../examples/the-hamlet.storylets", import.meta.url));
  const open = (): ProjectSession => {
    const dir = join(mkdtempSync(join(tmpdir(), "studio-rename-")), "copy.storylets");
    cpSync(hamlet, dir, { recursive: true });
    const opened = openProject(dir);
    if ("error" in opened) throw new Error(opened.error);
    return opened.session;
  };
  const text = (session: ProjectSession): string =>
    JSON.stringify(session.loaded.source!.boxes.map((b) => b.decks.map((d) => d.shard)));
  const target = { kind: "property", scope: "story", name: "reputation" } as const;

  it("renames the declaration and every reference, and the project has no errors", async () => {
    const session = open();
    const result = await renamePropertyEverywhere(session, target, "reputation", "standing");
    if ("error" in result) throw new Error(result.error);
    expect(session.loaded.source!.project.story.properties.map((p) => p.name)).toContain("standing");
    expect(text(session)).not.toMatch(/@reputation\b|@story\.reputation\b/);
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);

    await undo(session);
    expect(session.loaded.source!.project.story.properties.map((p) => p.name)).toContain("reputation");
    expect(text(session)).toMatch(/@story\.reputation\b/);
  });

  it("finishes the list's own step when the list saved the new name first, so one Undo puts back both", async () => {
    const session = open();
    // The Story page saves its list as the name is typed, before the rename lands.
    const settings = projectSettings(session);
    settings.story = settings.story.map((p) => (p.name === "reputation" ? { ...p, name: "standing" } : p));
    expect("error" in await saveProjectSettings(session, settings)).toBe(false);
    const result = await renamePropertyEverywhere(session, target, "reputation", "standing");
    if ("error" in result) throw new Error(result.error);
    expect(text(session)).not.toMatch(/@reputation\b|@story\.reputation\b/);

    await undo(session);
    expect(session.loaded.source!.project.story.properties.map((p) => p.name)).toContain("reputation");
    expect(text(session)).toMatch(/@story\.reputation\b/);
  });
});

// A card on its Card template's Redraw goes on following it when its other
// dealing rules are saved: the editor sends Redraw "" for it, and "" writes
// no Redraw (the hands-on review, 2026-10: Card template defaults are live).
describe("a card following its Card template's Redraw", () => {
  it("is saved with no Redraw of its own, and the template still decides it", async () => {
    const session = scratch();
    const box = session.dto.boxes[0]!;
    const { saveBox, saveCard } = await import("./mutate.js");
    await saveBox(session, box.id, { cardDefaults: { redraw: "never", weight: "", inOneHand: "", acrossHands: "any" } });
    const card = deck(session, "k_docks").cards[0]!;
    await saveCard(session, "k_docks", card.id, { redraw: "", acrossHands: "one" });
    const saved = session.loaded.source!.boxes[0]!.decks.find((d) => d.shard.deck.id === "k_docks")!.shard.cards.find((c) => c.id === card.id)!;
    expect("redraw" in saved).toBe(false);
    expect(saved.acrossHands).toBe("one");
    const shown = deck(session, "k_docks").cards.find((c) => c.id === card.id)!;
    expect(shown).toMatchObject({ redraw: "never", redrawInherited: true });
  });
});
