// ---------------------------------------------------------------------------
// The write path. Every edit the editor makes changes the source shard model,
// writes it back CANONICALLY through the VC layer (lock-aware; files are the
// truth), then re-loads and re-validates through here. Everything goes through
// this one path, so hand edits and editor edits are the same legitimate path
// through the same validator (Reboot 9.2).
// ---------------------------------------------------------------------------

import { applyStates, captureBefore } from "../history.js";
import type { FileState } from "../history.js";
import { readRemote, refuseWrite } from "../remote.js";
import { withGameScopes } from "../game-scopes.js";
import { missingColours } from "../box-colours.js";
import { openResult, validate } from "../project.js";
import type { ProjectSession } from "../project.js";
import type { OpenResult } from "../../shared/api.js";

/** What a mutation answers: the fresh project, or why it was refused. */
export type Written = OpenResult | { error: string };

/**
 * One write at a time, from the mutation to its reload.
 *
 * The writes are asynchronous now (simple-vc-lib 0.5.0 runs the VC layer off
 * the main thread), so two handlers could otherwise interleave: one changing
 * the in-memory project while another's write was still in the air, and the
 * second capturing an undo "before" the first had landed. Main runs every
 * mutating handler through this, as Patterpad runs its writes through
 * `enqueueWrite`. A failing op does not break the chain for the next.
 */
let queue: Promise<unknown> = Promise.resolve();
export function serialised<T>(op: () => T | Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

let stepCounter = 0;
/** An undo key no other step shares, for a standalone (structural) change.
 *  The family names the kind of gesture ("struct", "view", "map"); the count
 *  is one across every family, as it always was. */
export const freshKey = (family = "struct"): string => `${family}:${stepCounter++}`;

/** Apply a set of file writes, recording an undo entry, then reload. `key`
 *  coalesces consecutive same-key edits into one undo step; pass a unique key
 *  (`freshKey`) for a standalone (structural) change. Exported for the
 *  project-wide Replace (replace.ts), which is the same path with more files
 *  in it. */
export async function commit(session: ProjectSession, label: string, key: string, given: FileState[]): Promise<Written> {
  // The game's shared scopes folder, when there is one: a write of the project shard
  // brings the Storylet Engine's file and the project's copy of @world along, in this
  // same undoable step (game-scopes.ts). The identity with no folder.
  const writes = withGameScopes(session.loaded.source, session.loaded.dir, given);
  // The role the project was fetched with, where there is one. An author's key
  // may change the cards and the comments; the shape is the designer's, and the
  // editor says so rather than offering an edit the far end would refuse.
  const refusal = refuseWrite(readRemote(session.loaded.dir)?.role, writes.map((w) => w.path));
  if (refusal !== undefined) return refuse(session, refusal);
  const before = captureBefore(writes.map((w) => w.path));
  const applied = await applyStates(writes);
  if (!applied.ok) {
    // Writes that landed before a delete failed are a change on disk all the
    // same, and the step is how the author takes it back.
    if (applied.wrote) { session.history.record(label, key, before, writes); onWritten?.(); }
    return refuse(session, applied.error);
  }
  session.history.record(label, key, before, writes);
  // NOTHING is tallied here any more (2026-09-07). What the server has not seen
  // is a fact about the shards on disk, worked out by comparing them with the
  // revision last pulled (remote.ts `unpushedShards`), so a write counts by
  // changing a file rather than by being announced.
  return reload(session, true);
}

/**
 * `commit`, answering with something the caller made beside the fresh project
 * (the new card's id, the outcome's address): `{ result, ...made }`, or the
 * refusal as it stands. The shape every create and duplicate answers in.
 */
export async function commitMaking<T extends object>(
  session: ProjectSession, label: string, key: string, writes: FileState[], made: T,
): Promise<({ result: OpenResult } & T) | { error: string }> {
  const result = await commit(session, label, key, writes);
  return "error" in result ? result : { result, ...made };
}

/**
 * Turn a mutation down AFTER it may have changed the in-memory project.
 *
 * Every mutator edits the loaded shards first and writes them second, so a
 * refused write left main holding an edit the disk never got, and the next
 * write of that shard carried it there (review 2026-10, item 12). Re-reading
 * the project puts main back to what the files say.
 */
export function refuse(session: ProjectSession, error: string): { error: string } {
  validate(session);
  return { error };
}

/** Live Link: told after every write that lands through here (a commit, an
 *  undo, a redo), so a connected game can be refreshed. One listener; main
 *  sets it. */
let onWritten: (() => void) | undefined;
export function setProjectWrittenListener(fn: (() => void) | undefined): void { onWritten = fn; }

/** Reload + revalidate, so DTOs and problems are fresh. The written listener
 *  hears about it only when something was written: a gesture that changed
 *  nothing reloads too, and is not a reason to recompile a connected game. */
export function reload(session: ProjectSession, written = false): OpenResult {
  const result = openResult(session, validate(session));
  if (written) onWritten?.();
  return result;
}

export async function undo(session: ProjectSession): Promise<Written | null> {
  const states = session.history.undo();
  if (!states) return null;
  const applied = await applyStates(states);
  // A step that could not be written goes back on the stack, so the author can
  // try again once the file is free, and the error says which file and why.
  if (!applied.ok) { session.history.undoFailed(); return refuse(session, applied.error); }
  // An undo is a change to the files like any other, and it is counted the same
  // way: by what the shards now say. An undo back to the pulled text is not an
  // unpushed edit at all, which is what an author who types and undoes expects
  // and what the old tally got wrong in both directions.
  return reload(session, true);
}

export async function redo(session: ProjectSession): Promise<Written | null> {
  const states = session.history.redo();
  if (!states) return null;
  const applied = await applyStates(states);
  if (!applied.ok) { session.history.redoFailed(); return refuse(session, applied.error); }
  return reload(session, true);
}

/**
 * Store a colour for every box on the map that has none yet (box-colours.ts),
 * the first time the map is drawn. Not an undo step of its own: it is folded
 * into the author's last one (History.fold), so the next Undo undoes what they
 * did rather than a colour they never chose. The colours are in memory either
 * way, so a project the far end will not let us write still draws them.
 */
export async function ensureBoxColours(session: ProjectSession): Promise<void> {
  const writes = missingColours(session);
  if (writes.length === 0) return;
  if (refuseWrite(readRemote(session.loaded.dir)?.role, writes.map((w) => w.path)) !== undefined) return;
  const before = captureBefore(writes.map((w) => w.path));
  if (!(await applyStates(writes)).ok) return;
  session.history.fold(before, writes);
}
