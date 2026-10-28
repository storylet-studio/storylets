// Undo / redo tested through the mutation layer against a real project copy:
// file-state snapshots reverse every mutation, consecutive same-card edits
// coalesce into one step, and create/delete/rename (with file moves) all undo.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProject } from "./project.js";
import { createCard, createDeck, deleteCard, deleteDeck, redo, renameDeck, saveCard, undo, undoStep } from "./mutate.js";
import { StepHistory, UNDO_LIMIT, setHistoryListener } from "./history.js";
import type { ProjectSession } from "./project.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

function scratchProject(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-history-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}

const docks = "k_docks";
const ambushId = (session: ProjectSession): string =>
  session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "ambush-at-the-ford")!.id;
const titleOf = (session: ProjectSession, id: string): string | undefined =>
  session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.id === id)?.title;

describe("undo / redo", () => {
  it("undoes a card edit and redoes it", async () => {
    const session = scratchProject();
    const id = ambushId(session);
    await saveCard(session, docks, id, { title: "Renamed once" });
    expect(titleOf(session, id)).toBe("Renamed once");

    const undone = await undo(session);
    expect(undone).not.toBeNull();
    expect(titleOf(session, id)).toBe("Ambush at the ford");   // back to the original

    const redone = await redo(session);
    expect(redone).not.toBeNull();
    expect(titleOf(session, id)).toBe("Renamed once");
  });

  it("coalesces consecutive edits to one card into a single undo step", async () => {
    const session = scratchProject();
    const id = ambushId(session);
    await saveCard(session, docks, id, { title: "A" });
    await saveCard(session, docks, id, { title: "AB" });
    await saveCard(session, docks, id, { title: "ABC" });

    await undo(session);   // one undo reverses the whole typing burst
    expect(titleOf(session, id)).toBe("Ambush at the ford");
    expect(await undo(session)).toBeNull();   // nothing before it
  });

  it("starts a fresh step when a different card is edited", async () => {
    const session = scratchProject();
    const ambush = ambushId(session);
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!.id;
    await saveCard(session, docks, ambush, { title: "Ambush X" });
    await saveCard(session, docks, ratJob, { title: "Rat X" });

    await undo(session);   // reverses only the rat-job edit
    expect(titleOf(session, ratJob)).toBe("A rat job");
    expect(titleOf(session, ambush)).toBe("Ambush X");
    await undo(session);
    expect(titleOf(session, ambush)).toBe("Ambush at the ford");
  });

  it("undoes card create (the file loses the card) and delete", async () => {
    const session = scratchProject();
    const created = await createCard(session, docks);
    if ("error" in created) throw new Error(created.error);
    expect(session.dto.boxes[0]!.decks[0]!.cards.some((c) => c.id === created.cardId)).toBe(true);
    await undo(session);
    expect(session.dto.boxes[0]!.decks[0]!.cards.some((c) => c.id === created.cardId)).toBe(false);
    await redo(session);
    expect(session.dto.boxes[0]!.decks[0]!.cards.some((c) => c.id === created.cardId)).toBe(true);
  });

  it("undoes deck create by removing the new shard file", async () => {
    const session = scratchProject();
    const created = await createDeck(session, session.dto.boxes[0]!.id);
    if ("error" in created) throw new Error(created.error);
    const file = join(session.loaded.dir, "encounters", "decks", "new-deck.storyletdeck");
    expect(existsSync(file)).toBe(true);
    await undo(session);
    expect(existsSync(file)).toBe(false);
  });

  it("undoes a deck rename, moving the file back", async () => {
    const session = scratchProject();
    await renameDeck(session, docks, { title: "The Docks", gameId: "harbour" });
    const dir = join(session.loaded.dir, "encounters", "decks");
    expect(existsSync(join(dir, "harbour.storyletdeck"))).toBe(true);
    expect(existsSync(join(dir, "docks.storyletdeck"))).toBe(false);

    await undo(session);
    expect(existsSync(join(dir, "harbour.storyletdeck"))).toBe(false);
    expect(existsSync(join(dir, "docks.storyletdeck"))).toBe(true);
    expect(readFileSync(join(dir, "docks.storyletdeck"), "utf8")).toContain('gameId: "docks"');
  });

  it("a new edit after an undo clears the redo stack", async () => {
    const session = scratchProject();
    const id = ambushId(session);
    await saveCard(session, docks, id, { title: "One" });
    await undo(session);
    await saveCard(session, docks, id, { title: "Two" });   // a fresh edit
    expect(await redo(session)).toBeNull();                 // "One" is no longer redoable
    expect(titleOf(session, id)).toBe("Two");
  });
});

// A toast's Undo (the October 2026 review: Undo replaces "Are you sure?") takes
// back the step it reported and nothing else: each step has an id, and undoing
// one by id is refused once anything newer has been done.
describe("undoing one step by its id", () => {
  const stepOf = (r: Awaited<ReturnType<typeof saveCard>>): { id: number; merged: boolean } => {
    if ("error" in r || r.step === undefined) throw new Error("no step");
    return r.step;
  };

  it("names each write's step, and the same id when an edit coalesces into it", async () => {
    const session = scratchProject();
    const id = ambushId(session);
    const first = stepOf(await saveCard(session, docks, id, { title: "One" }));
    const again = stepOf(await saveCard(session, docks, id, { title: "Two" }));
    expect(first.merged).toBe(false);
    expect(again).toEqual({ id: first.id, merged: true });
    expect(session.history.newest).toBe(first.id);
  });

  it("undoes the step while it is the newest", async () => {
    const session = scratchProject();
    const id = ambushId(session);
    const deleted = await deleteCard(session, docks, id);
    if ("error" in deleted) throw new Error(deleted.error);
    const undone = await undoStep(session, deleted.step!.id);
    expect(undone).not.toHaveProperty("stale");
    expect(titleOf(session, id)).toBe("Ambush at the ford");
  });

  it("is stale, and changes nothing, once something newer has been done", async () => {
    const session = scratchProject();
    const id = ambushId(session);
    const deleted = await deleteCard(session, docks, id);
    if ("error" in deleted) throw new Error(deleted.error);
    const other = session.dto.boxes[0]!.decks[0]!.cards[0]!.id;
    await saveCard(session, docks, other, { title: "Newer" });
    expect(await undoStep(session, deleted.step!.id)).toEqual({ stale: true });
    expect(titleOf(session, other)).toBe("Newer");
    expect(titleOf(session, id)).toBeUndefined();
    // Edit > Undo steps back to it in order, and then it is the newest again.
    await undo(session);
    expect(await undoStep(session, deleted.step!.id)).not.toHaveProperty("stale");
    expect(titleOf(session, id)).toBe("Ambush at the ford");
  });

  it("is stale for a step already undone, and newest again once redone", async () => {
    const session = scratchProject();
    const deleted = await deleteCard(session, docks, ambushId(session));
    if ("error" in deleted) throw new Error(deleted.error);
    await undo(session);
    expect(await undoStep(session, deleted.step!.id)).toEqual({ stale: true });
    await redo(session);
    expect(session.history.newest).toBe(deleted.step!.id);
  });

  it("keeps its ids in step with the shell's history across the cap", async () => {
    const history = new StepHistory();
    const ids = Array.from({ length: UNDO_LIMIT + 20 }, (_, i) => history.record(`step ${i}`, `struct:${i}`, [], []).id);
    let steps = 0;
    while (history.canUndo) {
      expect(history.newest).toBe(ids[ids.length - 1 - steps]);
      await history.applyUndo();
      steps++;
    }
    expect(steps).toBe(UNDO_LIMIT);
    expect(history.newest).toBeUndefined();
  });
});

// The history says when what Undo and Redo would take may have changed, so the menu can name the step
// (Patter's hands-on step 6, Q20).
describe("the history's change listener", () => {
  it("hears a step recorded, undone and redone, with the labels the menu would show", async () => {
    const session = scratchProject();
    const heard: Array<[string | undefined, string | undefined]> = [];
    setHistoryListener(() => heard.push([session.history.undoLabel, session.history.redoLabel]));
    try {
      await renameDeck(session, docks, { title: "Quayside" });
      expect(heard.at(-1)).toEqual(["Rename deck", undefined]);
      await undo(session);
      expect(heard.at(-1)).toEqual([undefined, "Rename deck"]);
      await redo(session);
      expect(heard.at(-1)).toEqual(["Rename deck", undefined]);
      session.history.reset();
      expect(heard.at(-1)).toEqual([undefined, undefined]);
    } finally {
      setHistoryListener(undefined);
    }
  });
});
