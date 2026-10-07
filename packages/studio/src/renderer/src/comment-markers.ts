// ---------------------------------------------------------------------------
// Comment markers on a canvas: the Miro gesture, in our grammar
// (design/annotation.md section 3).
//
// A marker is a DISC with a speech mark in it, not a sticky. That is the whole
// point of the feature: a canvas is for the content, and an annotation as large
// as the thing it annotates is a bad trade. Hover to read the first line, click
// to open the thread, drag to move it.
//
// Two things it must get right, both learnt elsewhere in this app:
//
//   - CONSTANT SCREEN SIZE. A marker is chrome, so it divides by the camera scale
//     exactly as the map's vertex handles do. A marker that shrinks with the zoom
//     is unclickable at the size where you most want an overview.
//   - HIT-TESTING. The disc is the only SHAPE that listens, so a click landing
//     near a marker reaches the card underneath. This is the rule the frame bar
//     had to learn: anything that answers the pointer across an area swallows the
//     work going on inside it. Note the marker's GROUP must listen even so, since
//     Konva inherits `listening` downwards - see the note where it is built.
//
// It draws into the surface's MARKER GROUP, a sibling of the chrome group on one
// layer, so moving a marker never rebuilds the map's handles. See
// "The layer budget" in the brief for why that is a group and not a layer.
//
// The COMMENT TOOL lives here too (`createCommentTool`): arming it, dropping a
// marker, and opening one from the feedback walk were the same forty lines in
// the node view and the map, and had already begun to differ.
// ---------------------------------------------------------------------------

import Konva from "konva";
import { hideTip, iconNode, tipAt } from "@wildwinter/app-shell";
import { hoverCursor, type CanvasItem, type CanvasSurface } from "./canvas-surface.js";
import { itemAt } from "./canvas-geometry.js";
import type { CanvasTokens } from "./canvas-tokens.js";
import type { CommentMarkerDto } from "../../shared/api.js";

/** The disc's radius in SCREEN pixels: big enough to hit, small enough to sit
 *  beside a card without hiding its title. */
const R = 11;
/** The vocabulary's drawing grid: every icon is drawn on a 24-unit square. */
const ICON_GRID = 24;

export interface MarkerHost {
  /** The markers to draw, as main resolved them. */
  markers: () => CommentMarkerDto[];
  /** Open the thread. `anchor` is the DOM element the popover hangs off, which
   *  for a canvas marker is a zero-size proxy at the marker's screen position:
   *  the shell's anchored panel wants an element, and a Konva node is not one. */
  open: (threadId: string, anchor: HTMLElement) => void;
  /** A drag ended: `item` is what it was dropped on, absent for empty canvas. */
  moved: (threadId: string, x: number, y: number, item?: string) => void;
  /** What is under this canvas point at this zoom, for deciding a drop's anchor.
   *  Cards or pins only: furniture and other markers do not carry comments. The
   *  zoom matters for a pin, whose disc keeps its size on screen. */
  itemAt: (x: number, y: number, scale: number) => string | undefined;
  /** The stage's container, for the popover proxy. */
  host: () => HTMLElement;
}

/** Where a marker sits in CANVAS coordinates: its own point, or its item's
 *  origin plus the stored offset. The one place the two kinds differ. */
export function markerPoint<T extends CanvasItem>(
  marker: CommentMarkerDto, at: (id: string) => T | undefined,
): { x: number; y: number } | undefined {
  if (marker.item === undefined) return { x: marker.x, y: marker.y };
  const item = at(marker.item);
  // A marker whose item has gone is not drawn. The THREAD is not lost: it is
  // still on that item's editor, and the item is coming back or it is not.
  return item ? { x: item.x + marker.x, y: item.y + marker.y } : undefined;
}

/**
 * The painter to hand to `surface.setMarkers`.
 *
 * Closes over the host rather than taking it per call, so the surface's painter
 * contract stays the three arguments every other painter takes.
 */
export function markerPainter<T extends CanvasItem>(
  host: MarkerHost, tokens: () => CanvasTokens,
): (group: Konva.Container, scale: number, at: (id: string) => T | undefined) => void {
  // `at` comes from the surface on every repaint and reports LIVE positions, so a
  // marker on a card that is mid-drag travels with it. It is threaded into the
  // gestures rather than asked for again, so there is one source for where things
  // are.
  return (group, scale, at) => {
    const t = tokens();
    for (const marker of host.markers()) {
      const point = markerPoint(marker, at);
      if (!point) continue;
      group.add(drawMarker(marker, point, scale, t, host, at));
    }
    // A repaint destroys the disc under the pointer without a mouseleave, so a
    // tip of ours left up would hang there; the next move over a disc brings it
    // back.
    if (tipShowing !== undefined && !host.markers().some((m) => m.id === tipShowing)) clearTip();
  };
}

function drawMarker<T extends CanvasItem>(
  marker: CommentMarkerDto,
  point: { x: number; y: number },
  scale: number,
  tokens: CanvasTokens,
  host: MarkerHost,
  at: (id: string) => T | undefined,
): Konva.Group {
  // Constant on screen: everything below is divided by the camera.
  const r = R / scale;
  // The group LISTENS, and it has to: Konva inherits `listening` down the tree,
  // so a listening disc inside a silent group receives nothing at all. Found by
  // hovering a marker and getting no tooltip and no cursor.
  //
  // Nothing is lost by that, because Konva hit-tests SHAPES and a group has no
  // fill of its own: the gap around the disc belongs to whatever is underneath.
  // The disc is the only shape here that listens; the glyph and the badge do not,
  // so they cannot swallow a click meant for the disc or for a card.
  const group = new Konva.Group({ x: point.x, y: point.y });

  // Resolved threads are drawn QUIETLY rather than hidden: an author looking at a
  // canvas should be able to see that a place was discussed and settled.
  const done = marker.open === 0;

  const disc = hoverCursor(new Konva.Circle({
    radius: r,
    fill: done ? tokens.surface : tokens.accent,
    stroke: done ? tokens.muted : tokens.surface,
    strokeWidth: 1.5 / scale,
    // The only SHAPE in the marker that listens.
    listening: true,
  }), "pointer");
  disc.setAttr("markerId", marker.id);
  group.add(disc);

  // The vocabulary's `comment` shape, traced from the same drawing the DOM
  // bubbles use (one source), scaled so its 20-unit body sits inside the disc.
  // The stroke scales with the path (Konva's default), so 2.571 on the 24 grid
  // is the family's weight at this size, as it is everywhere else.
  const k = (r * 1.25) / ICON_GRID;
  group.add(new Konva.Path({
    data: commentPath(),
    stroke: done ? tokens.muted : tokens.surface,
    strokeWidth: 2.571,
    lineCap: "round", lineJoin: "round",
    x: -(ICON_GRID / 2) * k, y: -(ICON_GRID / 2) * k, scaleX: k, scaleY: k,
    listening: false,
  }));

  // A reply count, only when there is more than one message: a bare marker
  // already means "one comment", and "1" everywhere would be noise.
  if (marker.open > 1) {
    group.add(new Konva.Text({
      text: String(marker.open),
      fontSize: r * 0.8,
      fontStyle: "bold",
      fill: tokens.accent,
      stroke: tokens.surface,
      strokeWidth: 2 / scale,
      fillAfterStrokeEnabled: true,
      x: r * 0.5, y: -r * 1.6,
      listening: false,
    }));
  }

  wireGestures(disc, group, marker, host, at, scale);
  return group;
}

/**
 * Hover, click and drag on one marker.
 *
 * `cancelBubble` throughout: a marker gesture is not also a canvas gesture, or
 * clicking one would start a marquee and dragging one would pan the view. The
 * map's vertex handles set the same flag for the same reason.
 */
function wireGestures<T extends CanvasItem>(
  disc: Konva.Circle, group: Konva.Group, marker: CommentMarkerDto, host: MarkerHost,
  at: (id: string) => T | undefined, scale: number,
): void {
  const container = host.host();

  // The cursor is the surface's to set (the disc says what it wants with
  // `hoverCursor`); the hover line is the shell's tooltip, the one every other
  // tip in the app is, rather than a bubble of the marker's own.
  disc.on("mouseenter", () => {
    if (marker.gist !== "") showTip(container, group, marker);
  });
  disc.on("mouseleave", () => clearTip());

  disc.on("click", (e) => {
    e.cancelBubble = true;
    clearTip();
    host.open(marker.id, proxyAt(container, group));
  });

  // The drag moves the GROUP (disc plus its glyph), so the whole marker travels.
  disc.on("dragstart", (e) => { e.cancelBubble = true; clearTip(); });
  disc.draggable(true);
  disc.on("dragmove", (e) => {
    e.cancelBubble = true;
    // The disc drags within the group; move the group instead and put the disc
    // back, so the glyph keeps up and the drop maths stays in canvas space.
    group.x(group.x() + disc.x());
    group.y(group.y() + disc.y());
    disc.position({ x: 0, y: 0 });
  });
  disc.on("dragend", (e) => {
    e.cancelBubble = true;
    const x = group.x(), y = group.y();
    // Re-decide the anchor from where it LANDED. Dropped on a card it follows
    // that card, with the offset preserving where it was put; dropped on empty
    // canvas it stays where it is. Dragging one OFF a card is the second case,
    // which is why detaching needs no code of its own.
    const item = host.itemAt(x, y, scale);
    const origin = item === undefined ? undefined : at(item);
    if (item !== undefined && origin) host.moved(marker.id, x - origin.x, y - origin.y, item);
    else host.moved(marker.id, x, y);
  });
}

// --- the hover line and the popover's anchor ---------------------------------
//
// The line is the shell's tooltip; the anchor is DOM, since a popover wants an
// element to hang off. Both are placed from the marker's screen box.

const PROXY = "cmt-marker-proxy";

/**
 * Where a marker is ON SCREEN, in the container's own pixels.
 *
 * `getClientRect()` with no `relativeTo`, and that is the whole point. It used
 * to ask for the box `relativeTo` the stage, which is the stage's LOCAL space -
 * world coordinates, before the camera is applied. The tooltip and the popover
 * were then positioned at the world point as though it were a screen point, so
 * they sat exactly one camera-pan away from the marker they belonged to (and at
 * the wrong distance again once zoomed). On a canvas panned by 241px they landed
 * 241px off, which is what "a long way from the object" looks like.
 */
function screenBox(group: Konva.Group): { left: number; top: number; bottom: number; width: number; height: number } {
  const box = group.getClientRect();
  return { left: box.x + box.width / 2, top: box.y, bottom: box.y + box.height, width: box.width, height: box.height };
}

/** The marker whose line is up, so a repaint can take it down. */
let tipShowing: string | undefined;

/** WHO, then what. A marker is a person asking something, and on a canvas with
 *  several of them the name is what tells them apart at a glance; the gist alone
 *  reads as an anonymous sticky. */
export function markerTipText(marker: { gist: string; author: string }): string {
  return marker.author === "" ? marker.gist : `${marker.author}: ${marker.gist}`;
}

function showTip(container: HTMLElement, group: Konva.Group, marker: CommentMarkerDto): void {
  const box = group.getClientRect();
  const origin = container.getBoundingClientRect();
  tipShowing = marker.id;
  tipAt(`cmt-marker:${marker.id}`, {
    left: origin.left + box.x, top: origin.top + box.y, width: box.width, height: box.height,
  }, markerTipText(marker));
}

function clearTip(): void {
  if (tipShowing === undefined) return;
  tipShowing = undefined;
  hideTip();
}

/** A zero-size element at a point in the container's own pixels, for the
 *  shell's anchored panel to hang off: it measures an element, and a canvas has
 *  none at an arbitrary spot. Replaced rather than accumulated, and left in
 *  place while the panel is open so it has something to measure. */
export function markerProxy(container: HTMLElement, at: { x: number; y: number }): HTMLElement {
  container.querySelector(`.${PROXY}`)?.remove();
  const proxy = document.createElement("div");
  proxy.className = PROXY;
  proxy.style.left = `${Math.round(at.x)}px`;
  proxy.style.top = `${Math.round(at.y)}px`;
  container.append(proxy);
  return proxy;
}

function proxyAt(container: HTMLElement, group: Konva.Group): HTMLElement {
  const at = screenBox(group);
  return markerProxy(container, { x: at.left, y: at.top });
}

// --- the comment tool ------------------------------------------------------------

export interface CommentToolDeps<T extends CanvasItem> {
  surface: CanvasSurface<T>;
  /** The stage's container. */
  host: HTMLElement;
  /** Every item on the canvas, in draw order. */
  items: () => readonly T[];
  /** Which of them a comment can be filed against: a card, a pin. */
  carries: (item: T) => boolean;
  markers: () => CommentMarkerDto[];
  openThread: (threadId: string, anchor: HTMLElement) => void;
  startThread: (at: { x: number; y: number }, item: string | undefined, anchor: HTMLElement) => void;
  moveMarker: (threadId: string, x: number, y: number, item?: string) => void;
  tokens: () => CanvasTokens;
  /** The tool was armed or put down: the strip says so. */
  changed: () => void;
}

export interface CommentTool {
  arm: () => void;
  disarm: () => void;
  armed: () => boolean;
  /** Open one marker's thread from OUTSIDE the canvas, centring on it: the
   *  feedback walk's way in. False when that thread is not a marker here. */
  open: (threadId: string) => boolean;
}

/**
 * The comment tool and the markers, for one canvas.
 *
 * Arming it makes the next click drop a marker and open its composer. The click
 * creates nothing: nothing is written until the first message is posted, which
 * is the rule the whole comment feature keeps, since opening a composer and
 * thinking better of it must leave nothing behind.
 *
 * Dropped on something that carries comments, the stored position is an OFFSET
 * from it, so the marker keeps its place beside the thing when the thing moves.
 * "On" is judged as drawn (canvas-geometry `itemAt`): a pin by its disc, which
 * holds its size on screen, and not by its box, which does not.
 */
export function createCommentTool<T extends CanvasItem>(deps: CommentToolDeps<T>): CommentTool {
  let armed = false;
  const { surface, host } = deps;
  const carrierAt = (point: { x: number; y: number }, scale: number): T | undefined =>
    itemAt(deps.items(), point, scale, deps.carries);
  const proxyFor = (at: { x: number; y: number }): HTMLElement => markerProxy(host, surface.toScreen(at));

  surface.setMarkers(markerPainter<T>({
    markers: deps.markers,
    open: deps.openThread,
    moved: deps.moveMarker,
    itemAt: (x, y, scale) => carrierAt({ x, y }, scale)?.id,
    host: () => host,
  }, deps.tokens));

  function disarm(): void {
    armed = false;
    surface.setTool(undefined);
    deps.changed();
  }

  function arm(): void {
    armed = true;
    surface.setTool({
      cursor: "crosshair",
      onClick: (at) => {
        disarm();
        const over = carrierAt(at, surface.scale());
        const point = over ? { x: at.x - over.x, y: at.y - over.y } : at;
        deps.startThread(point, over?.id, proxyFor(at));
      },
      // Escape, or another tool replacing this one.
      onCancel: () => { armed = false; deps.changed(); },
    });
    deps.changed();
  }

  function open(threadId: string): boolean {
    const marker = deps.markers().find((m) => m.id === threadId);
    if (!marker) return false;
    const point = markerPoint(marker, (id) => deps.items().find((i) => i.id === id));
    if (!point) return false;
    // A marker is a Konva shape, so it cannot be reached the way the walk
    // reaches a document's topline bubble: the canvas centres on it and the
    // popover hangs off a proxy at its point. The camera eases there, so the
    // proxy goes where the point is GOING: the middle of the view.
    surface.centreAt(point);
    deps.openThread(threadId, markerProxy(host, { x: host.clientWidth / 2, y: host.clientHeight / 2 }));
    return true;
  }

  return { arm, disarm, armed: () => armed, open };
}

// The `d` of the vocabulary's comment drawing, read once from the shell's own
// node so the canvas cannot drift from the DOM. Lazy: the module is imported by
// tests that never draw, and where there is no document there is no canvas.
let commentD: string | undefined;
function commentPath(): string {
  commentD ??= iconNode("comment").querySelector("path")?.getAttribute("d") ?? "";
  return commentD;
}
