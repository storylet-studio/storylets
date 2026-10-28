// ---------------------------------------------------------------------------
// The write path. Every edit the editor makes changes the source shard model,
// writes it back CANONICALLY through the VC layer (lock-aware; files are the
// truth), then re-loads and re-validates through here. Everything goes through
// this one path, so hand edits and editor edits are the same legitimate path
// through the same validator (Reboot 9.2).
// ---------------------------------------------------------------------------

import { applyStates, captureBefore } from "../history.js";
import type { FileState } from "../history.js";
import { relative } from "node:path";
import { readRemote, refuseWrite } from "../remote.js";
import { withGameScopes } from "../game-scopes.js";
import { missingColours } from "../box-colours.js";
import { changedSinceRead, openResult, validate } from "../project.js";
import type { ProjectSession } from "../project.js";
import type { OpenResult } from "../../shared/api.js";

/** What a mutation answers: the fresh project, or why it was refused. */
export type Written = OpenResult | { error: string; reread?: true };

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
  // A write whose bytes are already on disk changes nothing, and an edit made
  // only of those is no step at all: a list saved straight after the edit that
  // already wrote it (a stage rename, say) must not leave an Undo that does
  // nothing. Leaving those files alone also leaves them checked in.
  const current = captureBefore(writes.map((w) => w.path));
  const changing = writes.filter((w, i) => w.content !== current[i]!.content);
  if (changing.length === 0) return reload(session);
  const drifted = refuseDrift(session, changing.map((w) => w.path));
  if (drifted !== undefined) return drifted;
  const before = captureBefore(changing.map((w) => w.path));
  const applied = await applyStates(changing);
  if (!applied.ok) {
    // Writes that landed before a delete failed are a change on disk all the
    // same, and the step is how the author takes it back.
    if (applied.wrote) { session.history.record(label, key, before, changing); onWritten?.(); }
    return refuse(session, applied.error);
  }
  const step = session.history.record(label, key, before, changing);
  // NOTHING is tallied here any more (2026-09-07). What the server has not seen
  // is a fact about the shards on disk, worked out by comparing them with the
  // revision last pulled (remote.ts `unpushedShards`), so a write counts by
  // changing a file rather than by being announced.
  // The step goes back with the project, for a report that offers its Undo.
  return { ...reload(session, true), step };
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

/**
 * Refuse a write that would overwrite a file changed outside Storyletter since
 * it was read (`changedSinceRead`). The project is read again, so main holds
 * what the disk says, and the answer tells the window to show it (`reread`):
 * the outside edit appears. A field the author is still typing in keeps its
 * text and saves it again over the new file; an edit made any other way has
 * to be made again, which is why the message asks them to check. Nothing on
 * disk is lost either way.
 */
function refuseDrift(session: ProjectSession, paths: readonly string[]): { error: string; reread: true } | undefined {
  const file = changedSinceRead(session, paths);
  if (file === undefined) return undefined;
  const name = relative(session.loaded.dir, file);
  return {
    ...refuse(session, `couldn't save: ${name.startsWith("..") ? file : name} changed outside Storyletter since it was read, and saving would have overwritten that. Storyletter has read it again: check your last edit is still there`),
    reread: true,
  };
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
  // The shell's history writes the step back, refusing it when a file has
  // changed since (a pull, a merge, Patterpad writing the shared scopes): that
  // step and every one below it are dropped, and the error names the file. A
  // step that could not be written goes back on the stack, so the author can
  // try again once the file is free, and the error says which file and why.
  const outcome = await session.history.applyUndo();
  if (!outcome) return null;
  if (!outcome.ok) return refuse(session, outcome.error);
  // An undo is a change to the files like any other, and it is counted the same
  // way: by what the shards now say. An undo back to the pulled text is not an
  // unpushed edit at all, which is what an author who types and undoes expects
  // and what the old tally got wrong in both directions.
  return reload(session, true);
}

/**
 * A toast's Undo: take back step `id`, but only while it is still the newest,
 * so the button never undoes something done since (the October 2026 review:
 * Undo replaces "Are you sure?"). Anything newer, and nothing changes: Edit >
 * Undo steps back to it in order. Checked here, in the write queue, so no write
 * can land between the check and the undo.
 */
export async function undoStep(session: ProjectSession, id: number): Promise<Written | { stale: true }> {
  if (session.history.newest !== id) return { stale: true };
  return (await undo(session)) ?? { stale: true };
}

export async function redo(session: ProjectSession): Promise<Written | null> {
  const outcome = await session.history.applyRedo();
  if (!outcome) return null;
  if (!outcome.ok) return refuse(session, outcome.error);
  return reload(session, true);
}

/**
 * Apply writes that finish the author's last step rather than make one of
 * their own (History.fold): a property rename's references, when the list
 * already saved the new name as its own step, so one Undo puts back the name
 * and every reference together. The same checks as `commit`.
 */
export async function commitFolded(session: ProjectSession, given: FileState[]): Promise<Written> {
  const writes = withGameScopes(session.loaded.source, session.loaded.dir, given);
  const refusal = refuseWrite(readRemote(session.loaded.dir)?.role, writes.map((w) => w.path));
  if (refusal !== undefined) return refuse(session, refusal);
  const current = captureBefore(writes.map((w) => w.path));
  const changing = writes.filter((w, i) => w.content !== current[i]!.content);
  if (changing.length === 0) return reload(session);
  const drifted = refuseDrift(session, changing.map((w) => w.path));
  if (drifted !== undefined) return drifted;
  const before = captureBefore(changing.map((w) => w.path));
  const applied = await applyStates(changing);
  if (applied.ok || applied.wrote) session.history.fold(before, changing);
  if (!applied.ok) return refuse(session, applied.error);
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
  // Built from the project as read, like any write: a box file changed since
  // keeps its outside edit, and the colours wait for the next draw.
  if (changedSinceRead(session, writes.map((w) => w.path)) !== undefined) return;
  const before = captureBefore(writes.map((w) => w.path));
  if (!(await applyStates(writes)).ok) return;
  session.history.fold(before, writes);
  // Read back, so the stamp knows these writes are the editor's own and the
  // next write of the same box is not taken for an outside edit.
  validate(session);
}
