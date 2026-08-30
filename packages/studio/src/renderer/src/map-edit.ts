// ---------------------------------------------------------------------------
// Editing a zone's shape: the draft polygon while it is being traced, and the
// handles that reshape a finished one.
//
// Both lifted from the old system's storymap canvas, which paid for these
// decisions once already (../storylets, StorymapCanvasZoneHandles and the
// draw-zone tool in StorymapCanvas):
//
//   - a click adds a vertex; clicking near the FIRST vertex closes the shape;
//     Enter closes it too, Escape abandons it
//   - a rubber band follows the pointer from the last vertex, so a shape is
//     drawn rather than guessed at
//   - vertex handles reshape; MID-EDGE handles insert a new vertex, which is how
//     a rectangle becomes an L without a mode of its own
//   - every handle holds a constant size on screen, or it is unclickable when
//     zoomed out and enormous when zoomed in
//
// Pure drawing plus geometry; the gestures live in map-view.ts.
// ---------------------------------------------------------------------------

import Konva from "konva";
import type { CanvasTokens } from "./canvas-tokens.js";
import type { Polygon, ViewPoint } from "@storylet-studio/model";

/** How near the first vertex a click has to land to close the shape, in SCREEN
 *  pixels: a world-space threshold would be impossible to hit when zoomed out. */
export const CLOSE_RADIUS = 14;
const VERTEX_R = 6;
const INSERT_R = 4;
/** A picture smaller than this cannot be grabbed to fix. */
const MIN_SIDE = 8;

/** Is this click closing the shape? */
export function closesShape(draft: Polygon, at: ViewPoint, scale: number): boolean {
  const first = draft[0];
  if (draft.length < 3 || !first) return false;
  return Math.hypot(at.x - first.x, at.y - first.y) * scale < CLOSE_RADIUS;
}

/** The shape being traced: the committed vertices, plus a rubber band out to
 *  wherever the pointer is. Drawn in the foreground, so it sits over the zones it
 *  is being drawn on top of. */
export function paintDraft(
  layer: Konva.Container, scale: number, tokens: CanvasTokens,
  draft: Polygon, pointer: ViewPoint | undefined,
): void {
  if (draft.length === 0) return;
  const flat: number[] = [];
  for (const p of draft) flat.push(p.x, p.y);

  // The line so far, and then the rubber band, dashed so it reads as "not yet".
  layer.add(new Konva.Line({
    points: flat, stroke: tokens.accent, strokeWidth: 2 / scale,
    closed: draft.length > 2, fill: draft.length > 2 ? tokens.accentSoft : undefined,
    listening: false,
  }));
  if (pointer) {
    const last = draft[draft.length - 1]!;
    layer.add(new Konva.Line({
      points: [last.x, last.y, pointer.x, pointer.y],
      stroke: tokens.accent, strokeWidth: 1.5 / scale,
      dash: [6 / scale, 4 / scale], listening: false,
    }));
  }
  // Every vertex placed so far, and the first one emphasised: it is the target that
  // closes the shape, so it has to look like one.
  draft.forEach((p, i) => {
    layer.add(new Konva.Circle({
      x: p.x, y: p.y, radius: (i === 0 ? VERTEX_R : INSERT_R) / scale,
      fill: i === 0 ? tokens.accent : tokens.surface,
      stroke: tokens.accent, strokeWidth: 1.5 / scale, listening: false,
    }));
  });
}

export interface HandleActions {
  /** A vertex was dragged to here (world coordinates), and let go. */
  moveVertex: (index: number, to: ViewPoint) => void;
  /** Insert a vertex in the edge that starts at `index`. */
  insertVertex: (index: number, at: ViewPoint) => void;
  /** A live drag: redraw the shape without committing. */
  previewVertex: (index: number, to: ViewPoint | undefined) => void;
  /** A corner was clicked: select it, so Delete can remove it. Clicking the
   *  selected one again clears the selection. */
  selectVertex: (index: number | undefined) => void;
  /** Right-click on a corner: the caller opens its menu at the pointer. */
  menuForVertex: (index: number, e: MouseEvent) => void;
}

/**
 * The handles on a selected zone: one per vertex to reshape, one per edge to
 * insert. Drawn into the surface's CHROME layer, which listens, so they can be
 * grabbed; every handler stops the event so a handle drag is not also a canvas
 * gesture.
 */
/**
 * Corner handles for a background: scale it, keeping its shape.
 *
 * Corners only, and always PROPORTIONAL. A background is a photograph of a real
 * place, so stretching one is a lie about the space it depicts; edge handles that
 * allowed it would be a feature nobody should want. The corner being dragged
 * moves and the OPPOSITE corner stays put, which is what every drawing tool does
 * and what makes the gesture predictable.
 *
 * Constant size on screen, like the vertex handles, and it reports a PREVIEW
 * while dragging rather than rewriting the item: a repaint mid-drag destroys the
 * handle the pointer is holding, which is the lesson the zone vertices paid for.
 */
export function paintScaleHandles(
  layer: Konva.Container, scale: number, tokens: CanvasTokens,
  rect: { x: number; y: number; width: number; height: number },
  on: {
    preview: (rect: { x: number; y: number; width: number; height: number } | undefined) => void;
    commit: (rect: { x: number; y: number; width: number; height: number }) => void;
  },
): void {
  const r = VERTEX_R / scale;
  const corners = [
    { at: { x: rect.x, y: rect.y }, anchor: { x: rect.x + rect.width, y: rect.y + rect.height } },
    { at: { x: rect.x + rect.width, y: rect.y }, anchor: { x: rect.x, y: rect.y + rect.height } },
    { at: { x: rect.x + rect.width, y: rect.y + rect.height }, anchor: { x: rect.x, y: rect.y } },
    { at: { x: rect.x, y: rect.y + rect.height }, anchor: { x: rect.x + rect.width, y: rect.y } },
  ];
  const ratio = rect.width / Math.max(1, rect.height);

  for (const corner of corners) {
    const handle = new Konva.Circle({
      x: corner.at.x, y: corner.at.y, radius: r,
      fill: tokens.surface, stroke: tokens.accent, strokeWidth: 2 / scale,
      draggable: true,
    });
    /** The rectangle this pointer position implies, with the shape kept. */
    const shaped = (to: { x: number; y: number }): { x: number; y: number; width: number; height: number } => {
      const wanted = { width: Math.abs(to.x - corner.anchor.x), height: Math.abs(to.y - corner.anchor.y) };
      // Whichever axis the hand moved further in wins, so the drag follows the
      // pointer rather than fighting it.
      const byWidth = wanted.width / ratio >= wanted.height;
      const width = Math.max(MIN_SIDE, byWidth ? wanted.width : wanted.height * ratio);
      const height = Math.max(MIN_SIDE, byWidth ? wanted.width / ratio : wanted.height);
      // Whole units, here rather than only in the shard writer. The store rounds
      // anyway, so a fractional rect would mean the number an author is shown
      // mid-drag and the number that lands are different by a hair - and every
      // readout of it would carry eleven decimal places of noise.
      return {
        x: Math.round(to.x < corner.anchor.x ? corner.anchor.x - width : corner.anchor.x),
        y: Math.round(to.y < corner.anchor.y ? corner.anchor.y - height : corner.anchor.y),
        width: Math.round(width), height: Math.round(height),
      };
    };
    handle.on("dragmove", (e) => { e.cancelBubble = true; on.preview(shaped(handle.position())); });
    handle.on("dragend", (e) => {
      e.cancelBubble = true;
      on.preview(undefined);
      on.commit(shaped(handle.position()));
    });
    layer.add(handle);
  }
}

export function paintHandles(
  layer: Konva.Container, scale: number, tokens: CanvasTokens,
  polygon: Polygon, actions: HandleActions, selected?: number,
): void {
  const r = VERTEX_R / scale;

  // Mid-edge inserts first, so a vertex handle wins where the two overlap on a
  // very short edge: reshaping is the commoner act.
  polygon.forEach((p, i) => {
    const next = polygon[(i + 1) % polygon.length]!;
    const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
    const insert = new Konva.Circle({
      x: mid.x, y: mid.y, radius: INSERT_R / scale,
      fill: tokens.surface, stroke: tokens.accent, strokeWidth: 1.5 / scale, opacity: 0.9,
    });
    // NOT cancelling the mousedown: the surface needs to see that a press landed on
    // chrome (it suppresses its own context menu for one), and it already ignores
    // presses whose target is not the stage, so nothing here starts a marquee.
    insert.on("click", (e) => { e.cancelBubble = true; actions.insertVertex(i, mid); });
    insert.on("mouseenter", () => { layer.getStage()?.container().style.setProperty("cursor", "copy"); });
    insert.on("mouseleave", () => { layer.getStage()?.container().style.removeProperty("cursor"); });
    layer.add(insert);
  });

  polygon.forEach((p, i) => {
    const isSelected = selected === i;
    const handle = new Konva.Circle({
      x: p.x, y: p.y, radius: isSelected ? r * 1.35 : r,
      // A selected corner is filled from the ink and ringed, so "this is the one
      // Delete will take" is legible without a legend.
      fill: isSelected ? tokens.ink : tokens.accent,
      stroke: tokens.surface, strokeWidth: (isSelected ? 2 : 1.5) / scale,
      draggable: true,
    });
    handle.on("dragmove", (e) => { e.cancelBubble = true; actions.previewVertex(i, { x: e.target.x(), y: e.target.y() }); });
    handle.on("dragend", (e) => {
      e.cancelBubble = true;
      actions.previewVertex(i, undefined);
      actions.moveVertex(i, { x: e.target.x(), y: e.target.y() });
    });
    // Two ways to remove a corner, because an author reaches for either: select it
    // and press Delete, or right-click it. Konva fires click after a drag too, so
    // the selection only toggles when the pointer did not travel.
    handle.on("click", (e) => {
      e.cancelBubble = true;
      actions.selectVertex(isSelected ? undefined : i);
    });
    handle.on("contextmenu", (e) => {
      e.cancelBubble = true;
      e.evt.preventDefault();
      actions.selectVertex(i);
      actions.menuForVertex(i, e.evt);
    });
    handle.on("mouseenter", () => { layer.getStage()?.container().style.setProperty("cursor", "move"); });
    handle.on("mouseleave", () => { layer.getStage()?.container().style.removeProperty("cursor"); });
    layer.add(handle);
  });
}

/** A polygon with one vertex moved: the live shape during a handle drag. */
export const withVertexAt = (polygon: Polygon, index: number, to: ViewPoint): Polygon =>
  polygon.map((p, i) => (i === index ? { x: to.x, y: to.y } : p));

/** A polygon with a vertex inserted after `index`. */
export const withVertexAfter = (polygon: Polygon, index: number, at: ViewPoint): Polygon =>
  [...polygon.slice(0, index + 1), { x: at.x, y: at.y }, ...polygon.slice(index + 1)];

/** A polygon with a vertex removed. Refuses below three points, because a zone
 *  with two is not a shape and the author would have destroyed it by accident. */
export const withoutVertex = (polygon: Polygon, index: number): Polygon | undefined =>
  (polygon.length <= 3 ? undefined : polygon.filter((_, i) => i !== index));
