// ---------------------------------------------------------------------------
// Undo / redo, the files-are-truth way: an undo entry is a set of file-state
// transitions (a path's content before and after, where null = absent). Every
// mutation writes through `commit`, which captures the before-state from disk,
// applies the writes through the VC layer, and records the entry. Undo replays
// the before-states; redo the after-states. No document command log - the
// bytes on disk are the model, so restoring bytes is undo (Reboot 9.2).
//
// Consecutive edits sharing a coalesce `key` (e.g. typing into one card) merge
// into a single entry, so undo steps by logical edit, not by keystroke.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { deleteFileAsync, writeTextFilesAsync } from "@wildwinter/simple-vc-lib";
import type { VCWriteOutcome } from "@wildwinter/simple-vc-lib";

/** A file's content, or null when the file is absent (created / deleted). */
export interface FileState {
  path: string;
  content: string | null;
}

interface Entry {
  label: string;
  key: string;
  before: FileState[];
  after: FileState[];
}

/** Read the current on-disk state of a set of paths. */
export function captureBefore(paths: string[]): FileState[] {
  return paths.map((path) => ({ path, content: existsSync(path) ? readFileSync(path, "utf8") : null }));
}

/** What applying a set of states came to. `wrote` says whether the writes
 *  landed before something else (a delete) failed, which decides whether there
 *  is now a change on disk for the history to know about. */
export type Applied = { ok: true } | { ok: false; error: string; wrote: boolean };

/**
 * Apply file states through the VC layer: write content, or delete when null.
 *
 * ALL OR NOTHING, and off the main thread (simple-vc-lib 0.5.0, as Patterpad's
 * `commitWrites`): every file is checked out first, and if any one is refused
 * nothing is written. The deletes run only once the whole batch has landed.
 * Under 0.4.1 a refused write carried on past the refusal and the deletes ran
 * anyway, so a deck rename whose new path was refused lost the deck (the
 * Storyletter review of 2026-10, item 1).
 */
export async function applyStates(states: FileState[]): Promise<Applied> {
  const writes = states.filter((s) => s.content !== null).map((s) => ({ filePath: s.path, content: s.content! }));
  if (writes.length > 0) {
    try {
      const batch = await writeTextFilesAsync(writes, "utf8", { allOrNothing: true });
      if (!batch.success) return { ok: false, error: writeFailure(batch.results), wrote: false };
    } catch (e) {
      return { ok: false, error: `couldn't save: ${e instanceof Error ? e.message : String(e)}`, wrote: false };
    }
  }
  const undeleted: string[] = [];
  for (const s of states) {
    if (s.content !== null || !existsSync(s.path)) continue;
    try {
      const gone = await deleteFileAsync(s.path);
      if (!gone.success) undeleted.push(`${basename(s.path)} (${gone.message || gone.status})`);
    } catch (e) {
      undeleted.push(`${basename(s.path)} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (undeleted.length > 0) return { ok: false, error: `couldn't delete ${undeleted.join("; ")}`, wrote: writes.length > 0 };
  return { ok: true };
}

/**
 * What a refused batch says: the file, and why. A refusal names who holds it
 * ("'docks.storyletdeck' is locked by bob@bob-ws"); every other file in an
 * all-or-nothing batch reports only that it was not prepared because of that
 * one, which is not worth repeating.
 */
export function writeFailure(results: VCWriteOutcome[]): string {
  const failed = results.filter((r) => !r.success);
  const refused = failed.filter((r) => r.status === "locked" || r.status === "outOfDate");
  const say = (r: VCWriteOutcome): string => {
    const name = basename(r.filePath);
    const why = r.message || r.status;
    return why.includes(name) ? why : `${name} (${why})`;
  };
  if (refused.length > 0) return `nothing was saved: ${refused.map(say).join("; ")}`;
  return `couldn't save ${failed.map(say).join("; ") || "the project"}`;
}

/** How many steps Undo keeps. Patterpad's editor history is ProseMirror's, whose
 *  default depth is a hundred; the same here. A step holds whole shards before
 *  and after, so an uncapped stack grew for as long as the window stayed open. */
export const UNDO_LIMIT = 100;

/** Merge state lists by path, `override` winning. */
function mergeStates(base: FileState[], override: FileState[]): FileState[] {
  const byPath = new Map<string, FileState>();
  for (const s of base) byPath.set(s.path, s);
  for (const s of override) byPath.set(s.path, s);
  return [...byPath.values()];
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Record a committed change; coalesce with the top entry when the key
   *  matches (same logical edit continuing). A new distinct edit clears redo. */
  record(label: string, key: string, before: FileState[], after: FileState[]): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.key === key) {
      top.before = mergeStates(before, top.before);   // keep the earliest before per path
      top.after = mergeStates(top.after, after);       // keep the latest after per path
    } else {
      this.undoStack.push({ label, key, before, after });
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Fold a write the app made on its own into the step the author took last,
   * rather than recording a step of its own. For a write nobody asked for
   * (a box's first colour, stored when the map is first drawn): a step of its
   * own would be undone by the author's next Undo, which would then undo the
   * thing they meant. Folded, undoing the step that put a box on the map takes
   * its colour with it, and a box folder that step created is never left
   * holding nothing but the colour's sidecar. With nothing to undo yet, there
   * is nothing to fold into, and the write simply stands.
   */
  fold(before: FileState[], after: FileState[]): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (!top) return;
    const known = new Set(top.before.map((s) => s.path));
    top.before = [...top.before, ...before.filter((s) => !known.has(s.path))];
    top.after = mergeStates(top.after, after);
  }

  /** Move the top undo entry to redo and return its before-states to apply. */
  undo(): FileState[] | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;
    this.redoStack.push(entry);
    return entry.before;
  }

  /** Move the top redo entry to undo and return its after-states to apply. */
  redo(): FileState[] | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    this.undoStack.push(entry);
    return entry.after;
  }

  /** An undo whose states could not be written: the step goes back where it
   *  was, so the author can try again once the file can be written. */
  undoFailed(): void {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
  }

  /** The same for a redo that could not be written. */
  redoFailed(): void {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
  }
}
