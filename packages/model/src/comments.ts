// ---------------------------------------------------------------------------
// Threaded comments: the conversation about a thing.
//
// This file used to hold documentation notes as well, and they were retired
// (design/annotation.md): Patterpad's typed notes exist to be ROUTED to a
// localisation script or a voice script, this app has neither destination, and
// `purpose` was already a first-class field on every type saying why a thing
// exists. Comments are the annotation model here.
//
// The sidecar keeps its `.storyletnotes` extension and `storylets/notes@0`
// schema. That is a fossil rather than a compromise: the name is fine for a file
// of annotations, and churning an extension buys nothing.
//
// No ranges, deliberately. Patterpad anchors a thread to a character range in a
// line, because there is prose to range OVER; a card's purpose is a field, not a
// document with offsets. Whole-thing threads only.
// ---------------------------------------------------------------------------

/**
 * The comment sidecar for one box.
 *
 * A flat LIST rather than a map: a thread carries its own anchor, so there is
 * no key to hang it on. Id'd so the merge engine can tell two reviewers apart.
 */
export interface NotesShard {
  schema: string;
  comments?: Comment[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One message in a thread. The author is a NAME, stamped at posting time, not a
 *  reference to anything: people leave projects and their words stay. */
export interface CommentMessage {
  author: string;
  /** ISO 8601, stamped when posted. */
  ts: string;
  body: string;
  /**
   * A TOMBSTONE: withdrawn, but still a turn in the conversation.
   *
   * A reply removed outright would renumber the argument around it - the answer
   * to a question nobody can see any more reads as a non-sequitur - so what is
   * left records who spoke and when, and that they took it back. The body is
   * EMPTIED when this is set: "deleted" has to mean gone from the file, or the
   * word is a lie to somebody who typed something they regret.
   *
   * Absent on every message that was never withdrawn, so an ordinary thread's
   * shard is unchanged.
   */
  deleted?: true;
}

/**
 * Where a thread is DRAWN, when it was dropped on a canvas rather than opened
 * from an editor (design/annotation.md 3).
 *
 * `canvas` names the canvas it appears on: a deck id, or `map:<boxId>` for a
 * box's map. `x`/`y` are that canvas's own coordinates when the thread is
 * anchored to the canvas itself, and an OFFSET from the item's origin when the
 * thread's `anchor` names an item on that canvas. One field, two readings,
 * distinguished by a single comparison - `anchor === canvas` - because the
 * alternative was a second key that could disagree with the first.
 *
 * A thread with no `mark` is not drawn anywhere: it was opened from an editor,
 * and it lives in that document's topline where it always did.
 */
export interface CommentMark {
  canvas: string;
  x: number;
  y: number;
}

/**
 * A thread, anchored to the id of the thing it is about.
 *
 * `anchor` is the SUBJECT: an item id, or a canvas id for a comment about a
 * place rather than a thing. `mark` is only about where it is drawn.
 */
export interface Comment {
  id: string;
  anchor: string;
  /** Marked complete: hidden unless the reviewer asks to see resolved threads. */
  resolved?: boolean;
  /** Present when this thread is a marker on a canvas. */
  mark?: CommentMark;
  messages: CommentMessage[];
}

/** Is this thread drawn as a marker, and is it following an item or sitting on
 *  the canvas? Answers both questions at once, so no caller has to remember the
 *  `anchor === canvas` rule. */
export function markOf(thread: Comment): { canvas: string; x: number; y: number; item?: string } | undefined {
  const mark = thread.mark;
  if (!mark) return undefined;
  return {
    canvas: mark.canvas, x: mark.x, y: mark.y,
    ...(thread.anchor === mark.canvas ? {} : { item: thread.anchor }),
  };
}

/** The threads drawn on one canvas, in the order they were written. */
export const marksOn = (shard: NotesShard | undefined, canvas: string): Comment[] =>
  commentsOf(shard).filter((c) => c.mark?.canvas === canvas);

/** A `mark` off a shard, or nothing when it is absent or malformed. A thread
 *  whose mark is broken is still a thread: it loses its place on the canvas and
 *  stays readable from its subject's editor, which is a better failure than
 *  losing the conversation. */
function markIn(value: unknown): { mark: CommentMark } | undefined {
  if (!isRecord(value)) return undefined;
  const canvas = value["canvas"], x = value["x"], y = value["y"];
  if (typeof canvas !== "string" || canvas === "") return undefined;
  if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
  if (typeof y !== "number" || !Number.isFinite(y)) return undefined;
  return { mark: { canvas, x, y } };
}

/** Every thread in the shard, forgiving of a mangled one. */
export function commentsOf(shard: NotesShard | undefined): Comment[] {
  const list = shard?.comments;
  if (!Array.isArray(list)) return [];
  const out: Comment[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = entry["id"], anchor = entry["anchor"];
    if (typeof id !== "string" || id === "" || typeof anchor !== "string" || anchor === "") continue;
    const raw = Array.isArray(entry["messages"]) ? entry["messages"] : [];
    const messages: CommentMessage[] = [];
    for (const m of raw) {
      if (!isRecord(m)) continue;
      const body = m["body"];
      if (typeof body !== "string") continue;
      // A TOMBSTONE is the one message allowed to be empty. Without this the
      // reader would drop every withdrawn message on the way back in - the
      // conversation would silently reflow around the gap on the next load,
      // which is exactly what tombstoning exists to prevent.
      const deleted = m["deleted"] === true;
      if (!deleted && body.trim() === "") continue;
      messages.push({
        author: typeof m["author"] === "string" ? m["author"] : "",
        ts: typeof m["ts"] === "string" ? m["ts"] : "",
        body: deleted ? "" : body,
        ...(deleted ? { deleted: true as const } : {}),
      });
    }
    // A thread with no messages is not a thread. Patterpad's rule too: a new one
    // is not committed until its first message is posted, so an empty one in a
    // file is a crash's leftovers rather than anybody's work.
    if (messages.length === 0) continue;
    out.push({
      id, anchor,
      ...(entry["resolved"] === true ? { resolved: true } : {}),
      ...(markIn(entry["mark"]) ?? {}),
      messages,
    });
  }
  return out;
}

/** The threads about one thing, oldest first (their order in the shard). */
export const threadsFor = (shard: NotesShard | undefined, anchor: string): Comment[] =>
  commentsOf(shard).filter((c) => c.anchor === anchor);

/** How many UNRESOLVED threads each anchor has: what a speech-bubble shows. A
 *  resolved thread is done, and a badge that kept counting it would never
 *  return to zero. */
export function openThreadCounts(shard: NotesShard | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const thread of commentsOf(shard)) {
    if (thread.resolved === true) continue;
    out[thread.anchor] = (out[thread.anchor] ?? 0) + 1;
  }
  return out;
}
