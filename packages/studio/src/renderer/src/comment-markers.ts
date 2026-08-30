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
// ---------------------------------------------------------------------------

import Konva from "konva";
import type { CanvasItem } from "./canvas-surface.js";
import type { CanvasTokens } from "./canvas-tokens.js";
import type { CommentMarkerDto } from "../../shared/api.js";

/** The disc's radius in SCREEN pixels: big enough to hit, small enough to sit
 *  beside a card without hiding its title. */
const R = 11;

export interface MarkerHost {
  /** The markers to draw, as main resolved them. */
  markers: () => CommentMarkerDto[];
  /** Open the thread. `anchor` is the DOM element the popover hangs off, which
   *  for a canvas marker is a zero-size proxy at the marker's screen position:
   *  the shell's anchored panel wants an element, and a Konva node is not one. */
  open: (threadId: string, anchor: HTMLElement) => void;
  /** A drag ended: `item` is what it was dropped on, absent for empty canvas. */
  moved: (threadId: string, x: number, y: number, item?: string) => void;
  /** What is under this canvas point, for deciding a drop's anchor. Cards only:
   *  furniture and other markers do not carry comments. */
  itemAt: (x: number, y: number) => string | undefined;
  /** The stage's container, for the popover proxy and the cursor. */
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

  const disc = new Konva.Circle({
    radius: r,
    fill: done ? tokens.surface : tokens.accent,
    stroke: done ? tokens.muted : tokens.surface,
    strokeWidth: 1.5 / scale,
    // The only SHAPE in the marker that listens.
    listening: true,
  });
  disc.setAttr("markerId", marker.id);
  group.add(disc);

  group.add(new Konva.Text({
    text: "❝",
    fontSize: r * 1.1,
    fill: done ? tokens.muted : tokens.surface,
    x: -r * 0.55, y: -r * 0.62,
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

  wireGestures(disc, group, marker, host, at);
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
  at: (id: string) => T | undefined,
): void {
  const container = host.host();

  disc.on("mouseenter", () => {
    container.style.cursor = "pointer";
    if (marker.gist !== "") showTip(container, group, marker.gist, marker.author);
  });
  disc.on("mouseleave", () => {
    container.style.cursor = "";
    hideTip(container);
  });

  disc.on("click", (e) => {
    e.cancelBubble = true;
    hideTip(container);
    host.open(marker.id, proxyAt(container, group));
  });

  // The drag moves the GROUP (disc plus its glyph), so the whole marker travels.
  disc.on("dragstart", (e) => { e.cancelBubble = true; hideTip(container); });
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
    const item = host.itemAt(x, y);
    const origin = item === undefined ? undefined : at(item);
    if (item !== undefined && origin) host.moved(marker.id, x - origin.x, y - origin.y, item);
    else host.moved(marker.id, x, y);
  });
}

// --- the hover line and the popover's anchor ---------------------------------
//
// Both are DOM, not Konva: a tooltip wants to wrap text and a popover wants an
// element to hang off. They sit in the stage's container, positioned from the
// marker's screen box.

const TIP = "cmt-marker-tip";
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
function screenBox(group: Konva.Group): { left: number; top: number; bottom: number } {
  const box = group.getClientRect();
  return { left: box.x + box.width / 2, top: box.y, bottom: box.y + box.height };
}

function showTip(container: HTMLElement, group: Konva.Group, text: string, author: string): void {
  hideTip(container);
  const tip = document.createElement("div");
  tip.className = TIP;
  // WHO, then what. A marker is a person asking something, and on a canvas with
  // several of them the name is what tells them apart at a glance; the gist alone
  // reads as an anonymous sticky.
  if (author !== "") {
    const who = document.createElement("b");
    who.textContent = author;
    tip.append(who, document.createTextNode(` ${text}`));
  } else {
    tip.textContent = text;
  }
  const at = screenBox(group);
  tip.style.left = `${Math.round(at.left)}px`;
  tip.style.top = `${Math.round(at.bottom + 6)}px`;
  container.append(tip);
}

function hideTip(container: HTMLElement): void {
  container.querySelector(`.${TIP}`)?.remove();
}

/** A zero-size element at the marker, for the shell's anchored panel to hang
 *  off. Replaced rather than accumulated, and left in place while the panel is
 *  open so it has something to measure. */
function proxyAt(container: HTMLElement, group: Konva.Group): HTMLElement {
  container.querySelector(`.${PROXY}`)?.remove();
  const proxy = document.createElement("div");
  proxy.className = PROXY;
  const at = screenBox(group);
  proxy.style.left = `${Math.round(at.left)}px`;
  proxy.style.top = `${Math.round(at.top)}px`;
  container.append(proxy);
  return proxy;
}
