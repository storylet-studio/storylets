// ---------------------------------------------------------------------------
// Threaded comments: posting, moving, resolving and withdrawing. Each thread
// lives in the notes of the box that holds what it is about, or in the
// project's root notes for the project map and its zones. What the comment
// surfaces READ is read/comments.ts.
// ---------------------------------------------------------------------------

import type { SourceBox } from "@storylet-studio/compiler";
import { planComments } from "@storylet-studio/ops";
import type { NotesOwner } from "@storylet-studio/ops";
import { commentsOf } from "@storylet-studio/model";
import type { Comment, CommentMark } from "@storylet-studio/model";
import type { ProjectSession } from "../project.js";
import { allFinite } from "../trust.js";
import { MAP_CANVAS, PROJECT_MAP_CANVAS_ID } from "../../shared/api.js";
import { commit, freshKey, reload } from "./write-path.js";
import type { Written } from "./write-path.js";
import { refusedNumber } from "./shards.js";

/**
 * Post a message to a thread, creating the thread if this is its first.
 *
 * The thread is not committed until a message exists, which is Patterpad's rule
 * and a good one: opening a composer and thinking better of it must leave
 * nothing behind. So there is no "create a thread" call at all - posting IS
 * creating.
 */
export async function postComment(
  session: ProjectSession, anchor: string, threadId: string, author: string, body: string,
  mark?: CommentMark,
): Promise<Written> {
  // The project map and its zones are nobody's box: their threads live in the
  // ROOT notes (design/project-map-contract.md 1.1).
  if (mark !== undefined && !allFinite(mark.x, mark.y)) return refusedNumber;
  const box = boxOwning(session, anchor) ?? (aboutProjectMap(session, anchor) ? rootNotes(session) : undefined);
  if (!box) return { error: "that is not something a comment can be attached to" };
  const message = { author, ts: new Date().toISOString(), body };
  const threads = commentsOf(box.notes);
  const at = threads.findIndex((t) => t.id === threadId);
  // `mark` belongs to a thread's CREATION only. A reply must not be able to move
  // a marker, or a comment would jump because somebody answered it from the
  // other canvas; moving is `moveComment`, its own gesture and its own undo step.
  const next = at >= 0
    ? threads.map((t) => (t.id === threadId ? { ...t, messages: [...t.messages, message] } : t))
    : [...threads, { id: threadId, anchor, ...(mark ? { mark } : {}), messages: [message] }];
  return writeComments(session, box, next, at >= 0 ? "Reply to a comment" : "Add a comment");
}

/**
 * Move a marker, re-deciding what it is anchored to from where it LANDED.
 *
 * That is what makes detaching free: dropped on an item it follows that item
 * (with `x`/`y` as the offset), dropped on empty canvas it stays put (with `x`/`y`
 * as canvas coordinates), and dragging one off a card is the second case
 * happening. Nothing remembers what it used to be attached to.
 *
 * One undo step per drag, keyed to the gesture like every other move.
 */
export async function moveComment(
  session: ProjectSession, threadId: string, canvas: string, x: number, y: number, item?: string,
): Promise<Written> {
  if (!allFinite(x, y)) return refusedNumber;
  const box = notesWithThread(session, threadId);
  if (!box) return { error: "no such comment" };
  const next = commentsOf(box.notes).map((t) =>
    (t.id === threadId ? { ...t, anchor: item ?? canvas, mark: { canvas, x, y } } : t));
  return writeComments(session, box, next, "Move a comment");
}

/** Mark a thread complete, or reopen it. */
export async function setCommentResolved(
  session: ProjectSession, threadId: string, resolved: boolean,
): Promise<Written> {
  const box = notesWithThread(session, threadId);
  if (!box) return { error: "no such comment" };
  const next = commentsOf(box.notes).map((t) => {
    if (t.id !== threadId) return t;
    const copy = { ...t };
    if (resolved) copy.resolved = true; else delete copy.resolved;
    return copy;
  });
  return writeComments(session, box, next, resolved ? "Mark a comment complete" : "Reopen a comment");
}

/**
 * Withdraw one message from a thread.
 *
 * ONE rule, which covers both halves of what was asked for: the message becomes
 * a tombstone, and the whole thread goes when nothing readable would be left.
 *
 * Stated as two rules ("solo deletes, in-thread tombstones") it has a dead end:
 * withdraw all three messages of a three-message thread one at a time and you
 * are left with three tombstones and no way to be rid of them. Read as one rule,
 * the solo case falls out of it - a lone message withdrawn leaves nothing to
 * read, so the thread goes - and so does the last-one-out case.
 *
 * The body is EMPTIED rather than kept beside a flag. "Deleted" has to mean gone
 * from the file: the person reaching for this may have typed something they
 * regret, and a shard that still holds it, in a directory under version control,
 * would be the opposite of what they asked for.
 */
export async function deleteCommentMessage(
  session: ProjectSession, threadId: string, index: number,
): Promise<Written> {
  const box = notesWithThread(session, threadId);
  if (!box) return { error: "no such comment" };
  const threads = commentsOf(box.notes);
  const thread = threads.find((t) => t.id === threadId)!;
  const target = thread.messages[index];
  if (!target) return { error: "that comment has already gone" };
  if (target.deleted === true) return { error: "that comment is already deleted" };

  const messages = thread.messages.map((m, i) =>
    (i === index ? { author: m.author, ts: m.ts, body: "", deleted: true as const } : m));
  const readable = messages.some((m) => m.deleted !== true);
  const next = readable
    ? threads.map((t) => (t.id === threadId ? { ...t, messages } : t))
    : threads.filter((t) => t.id !== threadId);
  return writeComments(session, box, next, "Delete a comment");
}

/** The project's root notes, as a notes owner (`path` "" is the root). */
function rootNotes(session: ProjectSession): NotesOwner {
  const notes = session.loaded.source!.notes;
  return { ...(notes !== undefined ? { notes } : {}), path: "" } as NotesOwner;
}

/** Is this anchor the project map itself, or one of its zones? Threads about
 *  them are the project's, not any box's. */
function aboutProjectMap(session: ProjectSession, anchor: string): boolean {
  const map = session.loaded.source?.map;
  return map !== undefined && (anchor === PROJECT_MAP_CANVAS_ID || map.group.tags.some((t) => t.id === anchor));
}

/** The notes that hold a thread: a box's, else the root's. */
function notesWithThread(session: ProjectSession, threadId: string): NotesOwner | undefined {
  const source = session.loaded.source;
  const box = source?.boxes.find((b) => commentsOf(b.notes).some((t) => t.id === threadId));
  if (box) return box;
  return commentsOf(source?.notes).some((t) => t.id === threadId) ? rootNotes(session) : undefined;
}

async function writeComments(
  session: ProjectSession, box: NotesOwner, threads: Comment[], label: string,
): Promise<Written> {
  const write = planComments(session.loaded.dir, box, threads);
  if (!write) return reload(session);
  return commit(session, label, freshKey(), [{ path: write.path, content: write.content }]);
}

/**
 * Which box holds the thing this id names.
 *
 * Every commentable id, which is now every item type plus the two kinds of
 * canvas. OUTCOMES were missing when outcome comments were added, so posting on
 * one was refused - found by writing this function's other half rather than by
 * using the app, because opening the popover works and only POSTING fails.
 *
 * A canvas anchor is a comment about a PLACE (design/annotation.md 3): a deck id
 * is already an item id above, and `map:<boxId>` names a box's map.
 */
function boxOwning(session: ProjectSession, id: string): SourceBox | undefined {
  const boxes = session.loaded.source?.boxes ?? [];
  const mapOf = id.startsWith(MAP_CANVAS) ? id.slice(MAP_CANVAS.length) : undefined;
  for (const box of boxes) {
    if (box.box.box.id === id || box.box.box.id === mapOf) return box;
    for (const deck of box.decks) {
      if (deck.shard.deck.id === id) return box;
      for (const card of deck.shard.cards) {
        if (card.id === id) return box;
        if (card.outcomes.some((o) => o.id === id)) return box;
      }
    }
    if (box.hands.hands.some((h) => h.id === id)) return box;
    if (box.hands.templates.some((t) => t.id === id)) return box;
    if (box.tags.groups.some((g) => g.id === id)) return box;
  }
  return undefined;
}
