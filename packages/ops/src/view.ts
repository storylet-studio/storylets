// ---------------------------------------------------------------------------
// The author's arrangement layer: reading and writing a box's `.storyletview`
// sidecar, which since 2026-09-06 is the CANVASES and nothing else. Where a
// box's hands stand went next door to `map.ts` with the map shard
// (design/engine-server.md 9.1 point 5).
//
// Where things SIT, never what they are. The reasoning for a separate shard is in
// design/graphical-views.md section 1.2, and it shapes this file: every function
// here is sparse and forgiving, because the sidecar answers to content that moves
// underneath it without warning.
//
//   - A card with no entry is not missing, it just lays out by default.
//   - An entry for a card that no longer exists is inert, and is LEFT ALONE.
//     Pruning it would look tidy and would fight the merge engine: a designer
//     tidying and a writer adding a card back would trip over each other, and
//     the whole point of the id-keyed shape is that they do not.
//   - A box with no sidecar at all is the normal state of a project. Nothing
//     creates one until somebody arranges something.
//
// Writes are planned, never performed: ops hands back PlannedWrites and the
// caller commits them through the VC layer, as everywhere else.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { boxMapOf, canonicalStringify } from "@storylet-studio/compiler";
import type { SourceBox } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS, VIEW_SCHEMA } from "@storylet-studio/model";
import { framesOf } from "@storylet-studio/model";
import type { CanvasFurniture, DeckCanvas, Frame, ViewPoint, ViewShard } from "@storylet-studio/model";
import { planMapFurniture } from "./map.js";
import type { PlannedWrite } from "./write.js";

/** One card's new home on a canvas. */
export interface CardPlacement extends ViewPoint {
  /** The card's id. */
  id: string;
}

/** Where the box keeps its arrangement. */
export function viewPath(dir: string, box: SourceBox): string {
  return join(dir, box.path, `view${SHARD_EXTENSIONS.view}`);
}

/** One deck's canvas as recorded, or an empty one. */
export function deckCanvas(box: SourceBox, deckId: string): DeckCanvas {
  return box.view?.canvases?.[deckId] ?? {};
}

/** The positions recorded for one deck's cards. Sparse: ask for a card that has
 *  never been placed and you get nothing, which means "lay it out by default". */
export function cardPositions(box: SourceBox, deckId: string): Record<string, ViewPoint> {
  return deckCanvas(box, deckId).cards ?? {};
}

/** Positions are whole numbers. The canvas snaps to a grid, but a caller could
 *  hand us anything, and a coordinate that differs in its eleventh decimal place
 *  is a diff in the file and a merge conflict for nobody's benefit. */
const whole = (n: number): number => Math.round(n);

/**
 * Plan the write that records where cards now sit.
 *
 * Merges into whatever the sidecar already holds, so other decks' canvases, the
 * map, notes, and anything a NEWER version of the app wrote all survive a save by
 * an older one. Returns undefined when nothing would change, so an idle drag or a
 * drop back where it started does not touch the file at all.
 */
export function planCardPositions(
  dir: string, box: SourceBox, deckId: string, placements: CardPlacement[],
): PlannedWrite | undefined {
  const before = cardPositions(box, deckId);
  const cards: Record<string, ViewPoint> = { ...before };
  let changed = false;
  for (const placement of placements) {
    const next = { x: whole(placement.x), y: whole(placement.y) };
    const current = before[placement.id];
    if (current && current.x === next.x && current.y === next.y) continue;
    cards[placement.id] = next;
    changed = true;
  }
  if (!changed) return undefined;

  const shard: ViewShard = {
    ...box.view,
    schema: VIEW_SCHEMA,
    canvases: {
      ...box.view?.canvases,
      [deckId]: { ...deckCanvas(box, deckId), cards },
    },
  };
  return { path: viewPath(dir, box), content: canonicalStringify(shard) };
}

/**
 * Plan the write that forgets a deck's arrangement: back to the default layout.
 *
 * The canvas KEY is removed rather than emptied, so the file does not accumulate
 * husks of decks nobody arranges. Returns undefined when there was nothing
 * recorded, so "reset" on an untouched canvas is not a write.
 */
export function planForgetCanvas(dir: string, box: SourceBox, deckId: string): PlannedWrite | undefined {
  if (box.view?.canvases?.[deckId] === undefined) return undefined;
  const canvases = { ...box.view.canvases };
  delete canvases[deckId];
  const shard: ViewShard = { ...box.view, schema: VIEW_SCHEMA, canvases };
  if (Object.keys(canvases).length === 0) delete shard.canvases;
  return { path: viewPath(dir, box), content: canonicalStringify(shard) };
}

// --- canvas furniture ----------------------------------------------------------
//
// Frames, on either canvas. One pair of functions rather than two, because the
// two canvases differ only in WHERE their furniture sits: a deck's under
// `canvases[deckId]` in this shard, a box map's in the map shard next door. The
// author draws the same thought on either, so the API stays one; which file it
// lands in is this module's business and not the caller's.

/** Which canvas: one deck's node canvas, or the box's map. */
export type CanvasRef = { kind: "deck"; deck: string } | { kind: "map" };

/** The furniture recorded for a canvas, forgiving and in draw order. */
export function canvasFurniture(box: SourceBox, ref: CanvasRef): CanvasFurniture {
  const canvas: CanvasFurniture | undefined = ref.kind === "deck"
    ? box.view?.canvases?.[ref.deck]
    : boxMapOf(box);
  return { frames: framesOf(canvas) };
}

/**
 * Plan the write that records a canvas's furniture.
 *
 * The WHOLE list, not a patch, which is the one place this sidecar's usual
 * sparse-and-merge habit does not apply. Furniture is a short authored list
 * rather than a keyed record of entries that content moves underneath: there is
 * no id to be sparse about, and "these are the boxes I have drawn" is a single
 * statement. Two authors drawing on the same canvas will conflict, and that is
 * honest - they drew different pictures.
 *
 * Empty lists are dropped rather than written, so a canvas somebody cleared
 * leaves no husk, exactly as the map's `planForgetSites` does for an unplaced hand.
 */
export function planCanvasFurniture(
  dir: string, box: SourceBox, ref: CanvasRef, furniture: CanvasFurniture,
): PlannedWrite[] {
  const before = canvasFurniture(box, ref);
  const frames = framesOf(furniture).map(tidyFrame);
  if (canonicalStringify(before.frames) === canonicalStringify(frames)) return [];

  // The map's furniture belongs to the map shard, and moving it there can move
  // the whole block out of a pre-split view shard, so that half plans a PAIR of
  // writes and this one hands the job over whole.
  if (ref.kind === "map") return planMapFurniture(dir, box, frames);

  const canvas = { ...deckCanvas(box, ref.deck) };
  if (frames.length > 0) canvas.frames = frames; else delete canvas.frames;
  const shard: ViewShard = {
    ...box.view, schema: VIEW_SCHEMA,
    canvases: { ...box.view?.canvases, [ref.deck]: canvas },
  };
  return [{ path: viewPath(dir, box), content: canonicalStringify(shard) }];
}

/** Whole numbers on the way in, like every other coordinate here. Text is left
 *  exactly as typed: it is prose, and trimming somebody's trailing newline is
 *  not this layer's business. */
const tidyFrame = (r: Frame): Frame => ({
  ...r, x: whole(r.x), y: whole(r.y), w: whole(r.w), h: whole(r.h),
});
