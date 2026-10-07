// ---------------------------------------------------------------------------
// The canvas's arithmetic, with no Konva and no DOM: what a marquee meets, what
// a point hits, where a fit or a zoom puts the camera, how screen and world
// points convert, how far a drop snaps, and how a camera eases from one
// place to another.
//
// Out of canvas-surface.ts so it can be tested as it is used. The surface, both
// views and the comment markers all answered "is this point on that thing?" for
// themselves, four slightly different ways, and the pin's disc was the case
// three of them got wrong.
// ---------------------------------------------------------------------------

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** Where the camera is looking: the stage offset and the zoom. */
export interface Camera { x: number; y: number; scale: number }

/** What the geometry needs to know about an item. A subset of CanvasItem, so
 *  this module stands on its own. */
export interface HitShape extends Rect {
  /** The edge is a circle of this radius in SCREEN pixels, centred in the box
   *  (CanvasItem.discRadius). */
  discRadius?: number;
  /** The part of the item that answers the pointer, relative to its origin, in
   *  world units (CanvasItem.hitArea). Absent, the whole box does. */
  hitArea?: Rect;
}

/**
 * How far, in SCREEN pixels, a press has to travel before it is a drag rather
 * than a click. One number for an item drag, a pan and a marquee: they used to
 * be three (Konva's own, two pixels and one world unit), so the same small
 * wobble selected a card, panned the view or swept a marquee depending on
 * where it started.
 */
export const DRAG_THRESHOLD_PX = 3;

/** Has the pointer moved far enough, on screen, to be a drag? Konva's own rule
 *  for an item drag (`dragDistance`, the larger axis), so all three agree. */
export function pastDragThreshold(from: Point, to: Point): boolean {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) >= DRAG_THRESHOLD_PX;
}

/** The rectangle two corners span, whichever way round they came. */
export function boxBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
  };
}

/** Is the point inside the rectangle, edges included? */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

/** Do two rectangles overlap? Touching edges do not count. */
export function rectsMeet(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** The part of an item that answers, in world coordinates. */
function answeringRect(item: HitShape): Rect {
  const h = item.hitArea;
  return h === undefined ? item : { x: item.x + h.x, y: item.y + h.y, width: h.width, height: h.height };
}

/**
 * Does the item, AS DRAWN at this zoom, meet this world box?
 *
 * The box on an item is what the surface positions and drags by, and it lies
 * twice. Anything drawn at a constant SCREEN size has a box that is not what you
 * see: a pin's box is 18 world units while its disc is always 9 screen pixels
 * across, so at 30% a marquee that came nowhere near the dot took it, and at
 * 300% one swept across the dot missed. And a frame's box is the whole area it
 * encloses, while only its BAR answers the pointer: a marquee round the cards
 * inside a frame took the frame, and the next Delete removed it.
 *
 * A disc gets a real circle-versus-rectangle test. A box standing in for it
 * would fix the scale half and leave the corners over-selecting.
 *
 * NOT done, knowingly: a zone polygon still meets by its bounding box, so a
 * marquee in the courtyard an L-shaped corridor wraps takes the corridor. That
 * needs polygon-versus-rectangle, and no map has yet been drawn where it bites.
 */
export function meetsBox(item: HitShape, box: Rect, scale: number): boolean {
  if (item.discRadius !== undefined) {
    const cx = item.x + item.width / 2, cy = item.y + item.height / 2;
    const r = item.discRadius / scale;
    // The nearest point of the box to the centre: inside it, that is the centre
    // itself, so a box swallowing the disc reads as a hit without a special case.
    const nx = Math.min(Math.max(cx, box.x), box.x + box.width);
    const ny = Math.min(Math.max(cy, box.y), box.y + box.height);
    return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
  }
  return rectsMeet(answeringRect(item), box);
}

/** Is this world point on the item as drawn at this zoom? The same two lies as
 *  `meetsBox`, answered the same way: a disc by its radius on screen, an item
 *  with a hit area by that area. */
export function hitsItem(item: HitShape, point: Point, scale: number): boolean {
  if (item.discRadius !== undefined) {
    const r = item.discRadius / scale;
    return Math.hypot(point.x - (item.x + item.width / 2), point.y - (item.y + item.height / 2)) <= r;
  }
  return pointInRect(point, answeringRect(item));
}

/** The TOPMOST item under a world point, of those `among` allows: the last one
 *  drawn, since later items draw over earlier ones. */
export function itemAt<T extends HitShape>(
  items: readonly T[], point: Point, scale: number, among: (item: T) => boolean = () => true,
): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (among(item) && hitsItem(item, point, scale)) return item;
  }
  return undefined;
}

/** The box around every item, or undefined for none. */
export function contentBounds(of: readonly Rect[]): Rect | undefined {
  if (of.length === 0) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of of) {
    minX = Math.min(minX, i.x); minY = Math.min(minY, i.y);
    maxX = Math.max(maxX, i.x + i.width); maxY = Math.max(maxY, i.y + i.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The camera that puts a world point in the middle of a view at this zoom. */
export function centredCamera(at: Point, scale: number, view: { width: number; height: number }): Camera {
  return { x: view.width / 2 - at.x * scale, y: view.height / 2 - at.y * scale, scale };
}

/** Where the middle of the view is, in world coordinates. */
export function viewCentre(camera: Camera, view: { width: number; height: number }): Point {
  return { x: (view.width / 2 - camera.x) / camera.scale, y: (view.height / 2 - camera.y) / camera.scale };
}

/** A screen point (the stage container's own pixels) in world coordinates. */
export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.x) / camera.scale, y: (p.y - camera.y) / camera.scale };
}

/** A world point in the stage container's own pixels. */
export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: p.x * camera.scale + camera.x, y: p.y * camera.scale + camera.y };
}

/** A world rectangle in the stage container's own pixels. */
export function worldRectToScreen(camera: Camera, r: Rect): Rect {
  return {
    x: camera.x + r.x * camera.scale, y: camera.y + r.y * camera.scale,
    width: r.width * camera.scale, height: r.height * camera.scale,
  };
}

/** The world rectangle a view of this size shows. */
export function visibleRect(camera: Camera, view: { width: number; height: number }): Rect {
  return {
    x: -camera.x / camera.scale, y: -camera.y / camera.scale,
    width: view.width / camera.scale, height: view.height / camera.scale,
  };
}

/** A zoom held to the canvas's limits. */
export function clampScale(scale: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, scale));
}

/**
 * The camera after zooming by `factor` about a screen point, which stays where
 * it is on screen: whatever is under the cursor stays put. Undefined when the
 * limits leave the zoom where it was, so the caller has nothing to repaint.
 */
export function zoomAbout(camera: Camera, at: Point, factor: number, min: number, max: number): Camera | undefined {
  const scale = clampScale(camera.scale * factor, min, max);
  if (scale === camera.scale) return undefined;
  const world = screenToWorld(camera, at);
  return { x: at.x - world.x * scale, y: at.y - world.y * scale, scale };
}

/** Does a grid of this step have a line at `v`? Within a hair, since a grid
 *  walked by repeated addition drifts off the exact multiples. */
export function onGridLine(v: number, step: number): boolean {
  const r = Math.abs(v % step);
  return r < 1e-6 || step - r < 1e-6;
}

/** The least room a fit leaves itself, in screen pixels, however narrow the pane. */
const MIN_ROOM_PX = 40;

export interface FrameOptions {
  /** Room around the framed box, in SCREEN pixels, on every side. */
  padding: number;
  /** World-space room a caller's backdrop needs around the items. */
  margin: { top: number; right: number; bottom: number; left: number };
  minScale: number;
  maxScale: number;
  /** May the fit zoom IN past 1:1? */
  magnify: boolean;
  /** Keep the current zoom when the subject already fits at it. */
  keepZoomIfItFits: boolean;
}

/**
 * The camera that frames `bounds` in a view of this size, or undefined when
 * there is nothing to frame.
 *
 * A fit shrinks to reveal; it never magnifies unless asked. A deck of two cards
 * framed at 300% draws cards several times the size they are designed at, which
 * reads as a mistake rather than as a fit.
 */
export function frameCamera(
  bounds: Rect | undefined, view: { width: number; height: number }, current: number, opts: FrameOptions,
): Camera | undefined {
  if (!bounds) return undefined;
  const m = opts.margin;
  const box = {
    x: bounds.x - m.left, y: bounds.y - m.top,
    width: bounds.width + m.left + m.right,
    height: bounds.height + m.top + m.bottom,
  };
  // A pane too narrow for the padding still gets a usable scale rather than a
  // negative one that clamps to the minimum zoom.
  const room = {
    width: Math.max(MIN_ROOM_PX, view.width - opts.padding * 2),
    height: Math.max(MIN_ROOM_PX, view.height - opts.padding * 2),
  };
  const ceiling = opts.magnify ? opts.maxScale : 1;
  const needed = Math.min(ceiling, Math.max(opts.minScale, Math.min(
    room.width / Math.max(1, box.width),
    room.height / Math.max(1, box.height),
  )));
  const scale = opts.keepZoomIfItFits && current <= needed ? current : needed;
  return centredCamera({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, scale, view);
}

/** Is every item fully inside the view, `margin` screen pixels in from its edge? */
export function allInView(
  subject: readonly Rect[], camera: Camera, view: { width: number; height: number }, margin = 8,
): boolean {
  return subject.every((item) => {
    const x = camera.x + item.x * camera.scale;
    const y = camera.y + item.y * camera.scale;
    return x >= margin && y >= margin
      && x + item.width * camera.scale <= view.width - margin
      && y + item.height * camera.scale <= view.height - margin;
  });
}

/**
 * The delta a drop actually moves by once the grid bites. The DRAGGED item
 * snaps, and everything else moves by the same delta, so a selection keeps its
 * own spacing instead of collapsing onto the grid one item at a time.
 */
export function snapDelta(from: Point, delta: Point, grid: number): Point {
  if (grid <= 0) return delta;
  return {
    x: Math.round((from.x + delta.x) / grid) * grid - from.x,
    y: Math.round((from.y + delta.y) / grid) * grid - from.y,
  };
}

/** Does going from one zoom to another cross any of these floors? A face that
 *  abbreviates below a floor has to be rebuilt when one is crossed; anywhere
 *  else it only needs its screen-constant sizes updated. */
export function crossesFloor(floors: readonly number[], from: number, to: number): boolean {
  return floors.some((f) => (from < f) !== (to < f));
}

// --- easing --------------------------------------------------------------------

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` as a function of time, so a camera move
 * eases on the same curve the stylesheet's transitions do. Solved for x by
 * Newton's method with a bisection fallback, which is how browsers do it.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a1: number, a2: number, s: number): number =>
    3 * a1 * s * (1 - s) ** 2 + 3 * a2 * s * s * (1 - s) + s ** 3;
  const slope = (a1: number, a2: number, s: number): number =>
    3 * a1 * (1 - s) ** 2 + 6 * (a2 - a1) * s * (1 - s) + 3 * (1 - a2) * s * s;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = at(x1, x2, s) - t;
      if (Math.abs(err) < 1e-6) return at(y1, y2, s);
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0, hi = 1;
    s = t;
    for (let i = 0; i < 30; i++) {
      const x = at(x1, x2, s);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return at(y1, y2, s);
  };
}

/** Read a `cubic-bezier(...)` token, or undefined for anything else. */
export function parseCubicBezier(value: string): ((t: number) => number) | undefined {
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(value);
  if (!m) return undefined;
  const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number];
  return [x1, y1, x2, y2].every(Number.isFinite) ? cubicBezier(x1, y1, x2, y2) : undefined;
}

/** A CSS time token ("260ms", "0.2s") in milliseconds, or the fallback. */
export function parseDuration(value: string, fallback: number): number {
  const m = /^\s*([\d.]+)\s*(ms|s)\s*$/.exec(value);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) ? (m[2] === "s" ? n * 1000 : n) : fallback;
}

/**
 * The camera part of the way from `a` to `b`, `t` from 0 to 1.
 *
 * Interpolating the stage offset directly makes a zoom swing sideways, because
 * the offset is a function of the zoom. So the point at the middle of the view
 * travels in a straight line, and the zoom changes geometrically (each frame
 * the same RATIO), which is what reads as a steady zoom rather than one that
 * rushes at the start.
 */
export function tweenCamera(a: Camera, b: Camera, t: number, view: { width: number; height: number }): Camera {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const from = viewCentre(a, view);
  const to = viewCentre(b, view);
  const scale = a.scale * (b.scale / a.scale) ** t;
  return centredCamera({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, scale, view);
}

// --- modifiers -------------------------------------------------------------------

interface Mods { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; button?: number }

/** Is this a click that ADDS to the selection? Shift, or the platform's command
 *  key (Cmd on macOS, Ctrl elsewhere): the same answer for a click and a
 *  marquee, which used to disagree. */
export function isAdditive(e: Mods, mac: boolean): boolean {
  return e.shiftKey || (mac ? e.metaKey : e.ctrlKey);
}

/** Is this press the context menu's? The right button, and on macOS a
 *  Ctrl-click, which every Mac app treats as a right-click. */
export function isContextPress(e: Mods, mac: boolean): boolean {
  return e.button === 2 || (mac && e.button === 0 && e.ctrlKey);
}
