// ---------------------------------------------------------------------------
// The canvas lab: canvas-surface driven by hand, outside Electron.
//
//   npm run canvas-lab   (from packages/studio)
//
// It exists because a canvas cannot be proven by a unit test. Panning, snapping
// and a marquee across a dense cluster are judged with a hand on a trackpad, in
// both themes. Not shipped, not part of the app's build.
//
// The face and the edges come from src/renderer/src/node-art.ts: the SAME ink
// the app's node view uses. If the lab drew its own, the lab would stop being
// evidence about the app.
//
// What the lab still owns is the AWKWARD data: a title longer than two lines, a
// deck name longer than the face, all four edge classes at once. The app's own
// corpus is tidy, and a face that has only been shown tidy data is not a face
// that works.
// ---------------------------------------------------------------------------

import "../src/renderer/src/theme.css";
import "@wildwinter/app-shell/tooltip.css";
// The REAL chip styling, not a copy: a copy is how a cascade bug hid in here.
import "../src/renderer/src/card-open.css";
import { mountOpenChip } from "../src/renderer/src/card-open.js";
import { mountCanvasSurface, type BackdropPainter } from "../src/renderer/src/canvas-surface.js";
import { readCanvasTokens, watchCanvasTokens } from "../src/renderer/src/canvas-tokens.js";
import { drawCardNode, gridLayout, paintEdges, NODE_H, NODE_W, type CardNode, TITLE_FLOOR } from "../src/renderer/src/node-art.js";
import { layoutByDependency } from "../../ops/src/layout.js";
import type { GraphEdge } from "../src/shared/api.js";

/** Titles in the corpus's sentence case ("Step through the gate"). */
const nodes: CardNode[] = gridLayout([
  ["Arrive at the inn", "The Inn"],
  ["The landlord remembers your last visit, and is not at all pleased about it", "The Inn"],
  ["A room for the night", "The Inn"],
  ["Last orders", "The Inn"],
  ["The forge is cold", "The Forge"],
  ["Bellows and patience", "The Forge"],
  ["A blade reforged", "The Forge"],
  ["Market rumours", "The Market"],
  ["The turnip seller", "The Market"],
  ["A purse cut", "The Market"],
  ["The mystic tree", "The Mystic Tree at the Crossroads"],
  ["Leaves in the wind", "The Mystic Tree at the Crossroads"],
].map(([title, deck]) => ({
  // The id IS the gameId, derived from the title the way the model derives it.
  id: String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  title: String(title),
  deck: String(deck),
})));

/** One of each class, so the four inks are judged together rather than one at a
 *  time in whatever project happens to be open. */
const edges: GraphEdge[] = [
  { from: "arrive-at-the-inn", to: "the-landlord-remembers-your-last-visit-and-is-not-at-all-pleased-about-it", cls: "enable" },
  { from: "arrive-at-the-inn", to: "a-room-for-the-night", cls: "enable" },
  { from: "a-room-for-the-night", to: "last-orders", cls: "influence" },
  { from: "the-forge-is-cold", to: "bellows-and-patience", cls: "enable" },
  { from: "bellows-and-patience", to: "a-blade-reforged", cls: "enable" },
  { from: "market-rumours", to: "a-purse-cut", cls: "disable" },
  { from: "the-mystic-tree", to: "leaves-in-the-wind", cls: "reference" },
  // A LOOP, because cycles are normal in storylets and the layout has to be
  // judged on one: these two enable each other.
  { from: "the-turnip-seller", to: "a-purse-cut", cls: "enable" },
  { from: "a-purse-cut", to: "the-turnip-seller", cls: "enable" },
];

const host = document.getElementById("stage")!;
const zoom = document.getElementById("zoom") as HTMLOutputElement;
const sel = document.getElementById("sel") as HTMLOutputElement;
const events = document.getElementById("events") as HTMLOutputElement;
const hover = document.getElementById("hover") as HTMLOutputElement;

let tokens = readCanvasTokens();
// `at` is the surface's own lookup, which reports LIVE positions: that is what
// keeps the edges attached to a card while it is being dragged.
const backdrop: BackdropPainter<CardNode> = (layer, scale, at) =>
  paintEdges(layer, scale, tokens, edges, at);

const surface = mountCanvasSurface<CardNode>({
  host,
  tokens,
  grid: 20,
  draw: drawCardNode,
  hoverTip: (node, scale) => (scale < TITLE_FLOOR ? node.title : undefined),
  onCamera: (scale) => { zoom.textContent = `${Math.round(scale * 100)}%`; },
  onSelectionChange: (ids) => {
    sel.textContent = ids.length === 0 ? "nothing selected"
      : ids.length === 1 ? ids[0]!
      : `${ids.length} selected`;
  },
  onMove: (moves) => {
    // The caller owns the model: writing the move back stands in for the sidecar
    // the node view will save to. The edges do not need poking, because the
    // backdrop reads the surface's live positions.
    for (const move of moves) {
      const node = nodes.find((n) => n.id === move.id);
      if (node) { node.x = move.x; node.y = move.y; }
    }
    events.textContent = `moved ${moves.length}: ${moves.map((m) => `${m.id} ${m.x},${m.y}`).join("  ")}`;
  },
  onActivate: (id) => { events.textContent = `activate ${id}`; },
  onContext: (id, world) => {
    events.textContent = id !== undefined
      ? `menu on ${id}`
      : `menu on empty at ${Math.round(world.x)},${Math.round(world.y)}`;
  },
  onHover: (id) => {
    hover.textContent = id ? `hover ${id}` : "no hover";
    // The app's own chip module, so the lab exercises the real hover handling
    // (including the grace period that keeps it alive as the pointer arrives on
    // it) rather than a lookalike.
    const rect = id === undefined || surface.scale() < 0.6 ? undefined : surface.screenRect(id);
    if (id !== undefined && rect) chip.show(id, rect);
    else chip.hideSoon();
  },
  onDelete: (ids) => { events.textContent = `delete ${ids.join(", ")}`; },
  onDragStart: () => chip.hide(),
});

surface.setItems(nodes);
surface.setBackdrop(backdrop);
// After the mount, because Konva empties its container when it builds the stage.
const chip = mountOpenChip(host, (id) => { events.textContent = `open ${id}`; });

watchCanvasTokens((next) => {
  tokens = next;
  surface.setTokens(next);
  surface.setBackdrop(backdrop);
});

// The app's own layout command, so the lab judges the real arrangement.
document.getElementById("layout")!.addEventListener("click", () => {
  const chosen = surface.selection();
  const scope = chosen.length > 1 ? chosen : nodes.map((n) => n.id);
  const anchor = nodes.filter((n) => scope.includes(n.id))
    .reduce((best, n) => (n.x < best.x || (n.x === best.x && n.y < best.y) ? n : best));
  const result = layoutByDependency(scope, edges, {
    width: NODE_W, height: NODE_H, gapX: 50, gapY: 40, origin: { x: anchor.x, y: anchor.y },
  });
  for (const p of result.positions) {
    const node = nodes.find((n) => n.id === p.id);
    if (node) { node.x = p.x; node.y = p.y; }
  }
  surface.setItems(nodes);
  // The same call the app makes after arranging, so the lab shows the same camera
  // behaviour: intervene only if the result would be off-screen.
  surface.revealIfOffscreen(scope);
  events.textContent = result.cycles.length === 0
    ? "laid out"
    : `laid out; loops: ${result.cycles.map((c) => c.join("+")).join(", ")}`;
});
(document.getElementById("theme") as HTMLSelectElement).addEventListener("change", (e) => {
  const value = (e.target as HTMLSelectElement).value;
  if (value) document.documentElement.setAttribute("data-theme", value);
  else document.documentElement.removeAttribute("data-theme");
});

surface.fitAll();

// A handle for the browser tools to drive the surface from outside, so the
// behaviours can be checked without a hand on the trackpad.
(window as unknown as { lab: unknown }).lab = { surface, nodes, edges };
