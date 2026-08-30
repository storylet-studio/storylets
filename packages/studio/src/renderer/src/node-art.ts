// ---------------------------------------------------------------------------
// What the node canvas draws: a card's abbreviated face, and the edges between
// them. The behaviour lives in canvas-surface; this is the ink.
//
// Shared with the canvas lab (packages/studio/dev), which is how the face gets
// judged by eye without launching the app. One face, two callers: if the lab
// drew its own the lab would stop being evidence.
//
// The rules here were settled by looking at it (design/graphical-views.md
// section 3, "The node face"):
//   - bands, and nothing shares a band with something that can grow
//   - titles, never gameIds
//   - no outcome count: tried three ways, removed
//   - anything carrying meaning holds a floor in SCREEN pixels
//   - anything inside the face is clipped to the face
// ---------------------------------------------------------------------------

import Konva from "konva";
import type { CanvasItem, DrawContext } from "./canvas-surface.js";
import { heatInk as coverageInk, type CardHeat } from "./coverage-art.js";
import { charColour, type CanvasTokens } from "./canvas-tokens.js";
import type { GraphEdge } from "../../shared/api.js";

export const NODE_W = 190;
export const NODE_H = 76;
export const NODE_RADIUS = 8;

/** A card as the canvas holds it. */
export interface CardNode extends CanvasItem {
  /** What the author called it. */
  title: string;
  /** The DECK's title, not its gameId. */
  deck: string;
  /** The subject of the view, drawn a shade stronger: the Links canvas's focus
   *  card. NOT selection - this never changes as the pointer moves, so it cannot
   *  drag the items into a repaint (see DrawContext). */
  emphasis?: boolean;
  /** The coverage overlay's reading, when it is on. "warm" and "absent" draw
   *  nothing: the overlay marks what is missing, not what is fine. */
  heat?: CardHeat;
}

// The face's bands.
const PAD_L = 14;
const PAD_R = 12;
const FOOT_H = 22;
/** Below this the glyphs are mush, so the face abbreviates rather than shrinks. */
export const TITLE_FLOOR = 0.34;
/** Below this the foot goes; the deck stripe carries the deck on its own. */
const FOOT_FLOOR = 0.6;

/** Where the author has put cards, keyed by card id. Sparse. */
export type Placed = Record<string, { x: number; y: number }>;

/**
 * Lay the deck out: the author's own positions where they exist, a default grid
 * where they do not.
 *
 * The default is deliberately dumb (the deck's order, in rows) because a clever
 * default the author then has to undo is worse than an obvious one, and
 * layout-as-a-verb is its own feature.
 *
 * A card added after an arrangement takes its grid slot, which can land it on top
 * of an arranged card. That is visible and one drag from fixed, whereas hunting
 * for a free space and putting it somewhere unpredictable is neither.
 */
export function gridLayout(
  cards: { id: string; title: string; deck: string }[], placed: Placed = {}, columns = 4,
): CardNode[] {
  const gapX = 50;
  const gapY = 74;
  return cards.map((card, i) => ({
    ...card,
    x: placed[card.id]?.x ?? 60 + (i % columns) * (NODE_W + gapX),
    y: placed[card.id]?.y ?? 60 + Math.floor(i / columns) * (NODE_H + gapY),
    width: NODE_W,
    height: NODE_H,
    cornerRadius: NODE_RADIUS,
  }));
}

export function drawCardNode(item: CardNode, ctx: DrawContext): Konva.Group {
  const { tokens, scale } = ctx;
  const group = new Konva.Group();
  group.add(new Konva.Rect({
    width: item.width, height: item.height,
    fill: tokens.card,
    // The border does NOT change when selected: the surface draws a ring on the
    // boundary, and doing both reads as one heavy band rather than a selection.
    // Emphasis is a different thing: it says "this is the card the view is ABOUT",
    // and it is fixed for as long as the view is.
    stroke: item.emphasis === true ? tokens.ink : tokens.line,
    strokeWidth: item.emphasis === true ? 2 : 1,
    cornerRadius: NODE_RADIUS,
    shadowColor: "#000", shadowOpacity: 0.1, shadowBlur: 6, shadowOffsetY: 1,
  }));

  // The deck stripe: the one piece of identity that survives every zoom, so a
  // cluster still reads as decks when the words have gone. It keeps a floor in
  // screen pixels for exactly that reason, and is clipped to the card's rounded
  // rect because Konva clamps a corner radius to a narrow shape's width - a
  // 4-wide stripe cannot curve by 8, and its square corners poked out past the
  // card's edge. The clip lives in a nested group so the card's shadow, drawn
  // outside it, survives.
  const stripe = new Konva.Group({
    clipFunc: (c) => { c.beginPath(); c.roundRect(0, 0, item.width, item.height, NODE_RADIUS); },
  });
  stripe.add(new Konva.Rect({
    width: Math.max(4, 4 / scale), height: item.height,
    fill: charColour(tokens, item.deck),
  }));
  group.add(stripe);

  if (scale < TITLE_FLOOR) return group;

  // Two lines, then Konva truncates on the real font metrics: a fixed height is
  // what arms the ellipsis on a wrapped block, and measuring beats guessing at
  // character counts.
  const titleSize = 14;
  group.add(new Konva.Text({
    x: PAD_L, y: 11,
    width: item.width - PAD_L - PAD_R,
    height: titleSize * 1.25 * 2,
    text: item.title,
    fontFamily: tokens.fontRead, fontSize: titleSize, lineHeight: 1.25,
    fill: tokens.ink,
    wrap: "word", ellipsis: true,
  }));

  // The coverage band, along the foot: the one place on the face that is not
  // already carrying identity. A tint over the whole card was the first try and
  // it fought the deck stripe for the same job (whose card is this), so the
  // finding gets its own band and the card keeps its colour.
  const heatInk = item.heat === undefined ? undefined : coverageInk(item.heat, tokens);
  if (heatInk !== undefined) {
    const band = new Konva.Group({
      clipFunc: (c) => { c.beginPath(); c.roundRect(0, 0, item.width, item.height, NODE_RADIUS); },
    });
    band.add(new Konva.Rect({
      y: item.height - Math.max(3, 3 / scale), width: item.width, height: Math.max(3, 3 / scale),
      fill: heatInk,
    }));
    group.add(band);
  }

  if (scale < FOOT_FLOOR) return group;

  // With the overlay on, the foot says what the band means. A colour nobody can
  // name is a decoration; the word is what makes it a report.
  const foot = item.heat === "cold" ? "never dealt"
    : item.heat === "unplayed" ? "never played"
    : item.deck;
  group.add(new Konva.Text({
    x: PAD_L, y: item.height - FOOT_H + 6,
    width: item.width - PAD_L - PAD_R,
    text: foot,
    fontFamily: tokens.fontMono, fontSize: 10,
    fill: heatInk ?? tokens.muted,
    wrap: "none", ellipsis: true,
  }));
  return group;
}

/** A column caption drawn ON the canvas, so it pans and zooms with the column it
 *  belongs to (Blueprints does the same with its comment titles). Used by the
 *  Links canvas, whose three columns need naming. */
export function paintCaptions(
  layer: Konva.Container, tokens: CanvasTokens,
  captions: { text: string; x: number; y: number; width: number }[],
): void {
  for (const caption of captions) {
    layer.add(new Konva.Text({
      x: caption.x, y: caption.y, width: caption.width,
      text: caption.text.toUpperCase(),
      fontFamily: tokens.fontUi, fontSize: 10, letterSpacing: 0.7,
      fill: tokens.muted, align: "center", listening: false,
    }));
  }
}

/** The four classes' inks: the SAME colours the Links window gives those four
 *  words (links.css), so a reader who has learnt one surface has learnt the
 *  other. Never `--line`: that is for rules between rows, and an edge in it is
 *  invisible on either ground. */
function edgeInk(tokens: CanvasTokens, cls: GraphEdge["cls"]): string {
  return cls === "enable" ? tokens.ok
    : cls === "disable" ? tokens.danger
    : cls === "influence" ? tokens.warn
    : tokens.muted;
}

/** Where a ray leaving a box's centre crosses its edge, so a line stops at the
 *  border and its arrowhead lands on the card rather than under it. */
function borderPoint(cx: number, cy: number, hw: number, hh: number, dx: number, dy: number): [number, number] {
  const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);
  return [cx + dx * t, cy + dy * t];
}

/** Draw the edges into a backdrop layer. Arrowheads always: direction is the
 *  whole claim of an influence graph. Widths hold constant on screen. */
export function paintEdges(
  layer: Konva.Container, scale: number, tokens: CanvasTokens,
  edges: GraphEdge[], at: (id: string) => CardNode | undefined,
): void {
  for (const edge of edges) {
    const a = at(edge.from);
    const b = at(edge.to);
    if (!a || !b) continue;
    const [ax, ay] = [a.x + a.width / 2, a.y + a.height / 2];
    const [bx, by] = [b.x + b.width / 2, b.y + b.height / 2];
    // Two cards at the same spot have no direction to draw.
    if (ax === bx && ay === by) continue;
    const ink = edgeInk(tokens, edge.cls);
    // Evidence rides on TOP of the class ink rather than replacing it: an edge
    // is still an enable or an influence, and what a coverage run saw about it
    // is a second axis (design/graphical-views.md 4). Weight for observed,
    // fade for possible-but-never-seen, and a heavier stroke for flagged, which
    // is the one that wants a second look. With no run every edge is `possible`
    // in the data sense but arrives here undefined, and draws exactly as before.
    const faded = edge.evidence === "possible";
    const flagged = edge.evidence === "flagged";
    layer.add(new Konva.Arrow({
      points: [
        ...borderPoint(ax, ay, a.width / 2, a.height / 2, bx - ax, by - ay),
        ...borderPoint(bx, by, b.width / 2, b.height / 2, ax - bx, ay - by),
      ],
      stroke: ink,
      fill: ink,
      strokeWidth: (flagged ? 3 : 1.75) / scale,
      pointerLength: 9 / scale,
      pointerWidth: 7 / scale,
      // A reference is the weakest of the four classes and says so without
      // needing a legend. A flagged edge borrows the same dash for the opposite
      // reason: it is not a settled fact, it is a disagreement.
      dash: edge.cls === "reference" || flagged ? [6 / scale, 4 / scale] : undefined,
      opacity: faded ? 0.35 : edge.cls === "reference" ? 0.8 : 1,
    }));
  }
}
