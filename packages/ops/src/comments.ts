// ---------------------------------------------------------------------------
// Reading and writing a box's `.storyletnotes`: the threaded comments on the
// things in that box (design/annotation.md).
//
// The extension and schema still say "notes" because the file used to hold
// documentation notes too. Those were retired - `purpose` already says why a
// thing exists - and renaming the file would break every project for nothing.
//
// Its own shard for a reason worth stating, because it is the third sidecar and
// the reasons differ. The arrangement sidecar exists because positions CHURN.
// This one exists because comments have a different AUTHOR: a reviewer writing
// "this card lands too early" and a writer rewriting the card are two people
// touching one project at once, and a shared file would make their work collide
// for no reason other than where it was stored.
//
// Sparse and forgiving in the same way as the rest: a thread anchored to a card
// that no longer exists is inert and is LEFT ALONE. Pruning it would look tidy
// and would fight the merge engine - somebody deleting a card and somebody
// restoring it would fight over the thread - and it costs a few bytes.
//
// Writes are planned, never performed.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { canonicalStringify } from "@storylet-studio/compiler";
import type { SourceBox } from "@storylet-studio/compiler";
import { NOTES_SCHEMA, SHARD_EXTENSIONS, commentsOf } from "@storylet-studio/model";
import type { Comment, NotesShard } from "@storylet-studio/model";
import type { PlannedWrite } from "./write.js";

/** Where a box keeps its comment threads. */
export function notesPath(dir: string, box: SourceBox): string {
  return join(dir, box.path, `notes${SHARD_EXTENSIONS.notes}`);
}

/**
 * Plan the write that records this box's threads.
 *
 * A WHOLE-LIST write, unlike the per-id note writes that used to live here: a
 * thread carries its own anchor, so the shard is a flat list and there is no
 * per-id key to write in isolation. Two reviewers commenting at once therefore
 * do conflict on this file, which is the honest cost of the flat shape and is
 * what the merge engine is for.
 *
 * An unchanged list plans nothing, so posting and immediately undoing does not
 * leave a diff.
 */
export function planComments(
  dir: string, box: SourceBox, comments: Comment[],
): PlannedWrite | undefined {
  const clean = comments.filter((c) => c.messages.length > 0).map(tidy);
  if (canonicalStringify(commentsOf(box.notes)) === canonicalStringify(clean)) return undefined;

  const shard: NotesShard = { ...box.notes, schema: NOTES_SCHEMA };
  if (clean.length > 0) shard.comments = clean; else delete shard.comments;
  return { path: notesPath(dir, box), content: canonicalStringify(shard) };
}

/** A marker's coordinates go in whole, like every other coordinate this project
 *  stores: a position differing in its eleventh decimal place is a diff, and
 *  later a conflict, for nobody's benefit. */
const tidy = (c: Comment): Comment =>
  (c.mark
    ? { ...c, mark: { canvas: c.mark.canvas, x: Math.round(c.mark.x), y: Math.round(c.mark.y) } }
    : c);
