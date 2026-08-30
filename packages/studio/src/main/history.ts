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
import { deleteFile, writeTextFiles } from "@wildwinter/simple-vc-lib";

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

/** Apply file states through the VC layer: write content, or delete when null.
 *  Returns false if any write failed. */
export function applyStates(states: FileState[]): boolean {
  const writes = states.filter((s) => s.content !== null).map((s) => ({ filePath: s.path, content: s.content! }));
  const batch = writes.length > 0 ? writeTextFiles(writes) : { success: true };
  for (const s of states) if (s.content === null && existsSync(s.path)) deleteFile(s.path);
  return batch.success;
}

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
    }
    this.redoStack = [];
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
}
