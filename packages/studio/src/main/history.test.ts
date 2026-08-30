// Undo / redo tested through the mutation layer against a real project copy:
// file-state snapshots reverse every mutation, consecutive same-card edits
// coalesce into one step, and create/delete/rename (with file moves) all undo.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openProject } from "./project.js";
import { createCard, createDeck, deleteDeck, redo, renameDeck, saveCard, undo } from "./mutate.js";
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
  it("undoes a card edit and redoes it", () => {
    const session = scratchProject();
    const id = ambushId(session);
    saveCard(session, docks, id, { title: "Renamed once" });
    expect(titleOf(session, id)).toBe("Renamed once");

    const undone = undo(session);
    expect(undone).not.toBeNull();
    expect(titleOf(session, id)).toBe("Ambush at the ford");   // back to the original

    const redone = redo(session);
    expect(redone).not.toBeNull();
    expect(titleOf(session, id)).toBe("Renamed once");
  });

  it("coalesces consecutive edits to one card into a single undo step", () => {
    const session = scratchProject();
    const id = ambushId(session);
    saveCard(session, docks, id, { title: "A" });
    saveCard(session, docks, id, { title: "AB" });
    saveCard(session, docks, id, { title: "ABC" });

    undo(session);   // one undo reverses the whole typing burst
    expect(titleOf(session, id)).toBe("Ambush at the ford");
    expect(undo(session)).toBeNull();   // nothing before it
  });

  it("starts a fresh step when a different card is edited", () => {
    const session = scratchProject();
    const ambush = ambushId(session);
    const ratJob = session.dto.boxes[0]!.decks[0]!.cards.find((c) => c.gameId === "rat-job")!.id;
    saveCard(session, docks, ambush, { title: "Ambush X" });
    saveCard(session, docks, ratJob, { title: "Rat X" });

    undo(session);   // reverses only the rat-job edit
    expect(titleOf(session, ratJob)).toBe("A rat job");
    expect(titleOf(session, ambush)).toBe("Ambush X");
    undo(session);
    expect(titleOf(session, ambush)).toBe("Ambush at the ford");
  });

  it("undoes card create (the file loses the card) and delete", () => {
    const session = scratchProject();
    const created = createCard(session, docks);
    if ("error" in created) throw new Error(created.error);
    expect(session.dto.boxes[0]!.decks[0]!.cards.some((c) => c.id === created.cardId)).toBe(true);
    undo(session);
    expect(session.dto.boxes[0]!.decks[0]!.cards.some((c) => c.id === created.cardId)).toBe(false);
    redo(session);
    expect(session.dto.boxes[0]!.decks[0]!.cards.some((c) => c.id === created.cardId)).toBe(true);
  });

  it("undoes deck create by removing the new shard file", () => {
    const session = scratchProject();
    const created = createDeck(session, session.dto.boxes[0]!.id);
    if ("error" in created) throw new Error(created.error);
    const file = join(session.loaded.dir, "encounters", "decks", "new-deck.storyletdeck");
    expect(existsSync(file)).toBe(true);
    undo(session);
    expect(existsSync(file)).toBe(false);
  });

  it("undoes a deck rename, moving the file back", () => {
    const session = scratchProject();
    renameDeck(session, docks, { title: "The Docks", gameId: "harbour" });
    const dir = join(session.loaded.dir, "encounters", "decks");
    expect(existsSync(join(dir, "harbour.storyletdeck"))).toBe(true);
    expect(existsSync(join(dir, "docks.storyletdeck"))).toBe(false);

    undo(session);
    expect(existsSync(join(dir, "harbour.storyletdeck"))).toBe(false);
    expect(existsSync(join(dir, "docks.storyletdeck"))).toBe(true);
    expect(readFileSync(join(dir, "docks.storyletdeck"), "utf8")).toContain('gameId: "docks"');
  });

  it("a new edit after an undo clears the redo stack", () => {
    const session = scratchProject();
    const id = ambushId(session);
    saveCard(session, docks, id, { title: "One" });
    undo(session);
    saveCard(session, docks, id, { title: "Two" });   // a fresh edit
    expect(redo(session)).toBeNull();                 // "One" is no longer redoable
    expect(titleOf(session, id)).toBe("Two");
  });
});
