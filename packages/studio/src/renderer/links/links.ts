// ---------------------------------------------------------------------------
// The Links window: one card's immediate neighbourhood, drawn. What can turn this
// card on or off, to the left; what this card turns on or off, to the right;
// across every deck and box, because "what breaks if I delete this" does not
// respect deck boundaries (design/graphical-views.md section 4).
//
// Unreal's References viewer is the model, and as of 2026-08-05 it is drawn like
// one: the focus card in the middle, neighbours either side, links drawn between
// them. It was a table of rows first, which read as a report about cards rather
// than as cards. Same surface, same faces and same four edge inks as the node
// canvas, so a reader who has learnt one has learnt the other.
//
// What is NOT shared with the node canvas: nothing here is arranged by the author.
// The layout is generated from the graph every time the focus moves, so there is
// nothing to persist and nothing to drag - the arrangement IS the answer.
//
// A LENS, not a destination. It follows the editor's selection, so it is cheap to
// leave open and cheap to ignore. Nothing here computes: main hands over a
// display-ready view (LinksView) so this file renders and nothing more.
//
// One hop only. The whole-project graph is a hairball - the old system learned
// that and refused it - but one hop across the project stays readable.
// ---------------------------------------------------------------------------

import "../src/theme.css";
import "../src/card-open.css";
import "./links.css";
import "@wildwinter/app-shell/tooltip.css";
import { applyTheme } from "../src/theme.js";
import { toolWindowHead } from "../src/tool-window-head.js";
import { el } from "../src/dom.js";
import { initTooltips } from "@wildwinter/app-shell";
import { openContextMenu } from "../src/context-menu.js";
import { mountCanvasSurface, type CanvasSurface } from "../src/canvas-surface.js";
import { readCanvasTokens, watchCanvasTokens } from "../src/canvas-tokens.js";
import { drawCardNode, paintCaptions, paintEdges, NODE_H, NODE_W, NODE_RADIUS, type CardNode, TITLE_FLOOR } from "../src/node-art.js";
import { mountOpenChip } from "../src/card-open.js";
import { linksLayout } from "./links-layout.js";
import { explainLink, type Explanation } from "./links-explain.js";
import { edgeEvidence } from "./links-evidence.js";
import type { GraphEdge, LinkCard, LinkNeighbour, LinkReason, LinksView, StudioApi } from "../../shared/api.js";

declare global { interface Window { studio: StudioApi; } }
const studio = window.studio;

const root = document.getElementById("links")!;
let view: LinksView | undefined;
/** Set when the author walks the graph here, so the window can stop following
 *  the editor until they come back. */
let walked: string | undefined;
let pinned = true;

/** What a coverage run saw, carried through to the drawing.
 *
 *  Both keys are REQUIRED here while their values may be undefined, which is the
 *  point: `Pick<LinkNeighbour, ...>` keeps them optional, so when `drawable`
 *  below silently stopped copying them (2026-08-29) the compiler had nothing to
 *  say and the whole evidence overlay drew as `possible` for every edge. A
 *  required key cannot be forgotten. */
type Evidence = { observed: LinkNeighbour["observed"]; flagged: LinkNeighbour["flagged"] };

/** A neighbour that is actually in the analysed set, so it can be drawn. */
type Neighbour = { card: LinkCard; cls: GraphEdge["cls"]; via: LinkReason[] } & Evidence;

interface LinksCanvas {
  destroy: () => void;
  /** Escape means "drop the selection" first and "close the window" only when
   *  there is no selection left to drop. */
  hasSelection: () => boolean;
}

/** The live canvas, if there is a card to draw. Torn down on every re-render: a
 *  Konva stage owns window listeners and an observer. */
let canvas: LinksCanvas | undefined;


async function show(cardId?: string): Promise<void> {
  walked = cardId;
  view = await studio.linksFor(cardId);
  pinned = view.pinned;
  render();
}

/** Every neighbour that is actually in the analysed set, with its edge. */
const drawable = (rows: LinkNeighbour[]): Neighbour[] =>
  rows.flatMap((n) => (n.card
    ? [{ card: n.card, cls: n.cls, via: n.via, observed: n.observed, flagged: n.flagged }]
    : []));

/** A card's display name. Titles, never gameIds: the address is the programmer's
 *  handle and belongs in the inspector and the CLI. */
const nameOf = (card: LinkCard): string => card.title ?? card.gameId;

function mountCanvas(host: HTMLElement, strip: HTMLElement, v: LinksView & { card: LinkCard }): LinksCanvas {
  // A card can be on BOTH sides: it opens the focus and the focus opens it, which
  // is a mutual link and a perfectly ordinary thing to write. It gets ONE node,
  // on the left, and keeps both of its edges - so the mutuality reads as two
  // arrows rather than as the same card drawn twice. (Drawn twice is not a
  // cosmetic problem: the surface keys items by id, so a duplicate would collide
  // in the group map and in the selection.) The focus itself is excluded from
  // both columns for the same reason: a card whose outcome writes what its own
  // condition reads is a self-link, not a neighbour.
  const seen = new Set<string>([v.card.id]);
  const once = (rows: LinkNeighbour[]): Neighbour[] =>
    drawable(rows).filter((r) => (seen.has(r.card.id) ? false : (seen.add(r.card.id), true)));
  const reaching = once(v.predecessors);
  const reached = once(v.dependents);
  // Every edge is still drawn, including those of a card that was deduplicated
  // out of the right-hand column.
  const allIn = drawable(v.predecessors);
  const allOut = drawable(v.dependents);

  const face = (card: LinkCard, emphasis = false): CardNode => ({
    id: card.id,
    title: nameOf(card),
    deck: card.deckTitle,
    x: 0, y: 0, width: NODE_W, height: NODE_H, cornerRadius: NODE_RADIUS,
    ...(emphasis ? { emphasis: true } : {}),
  });

  const nodes: CardNode[] = [
    face(v.card, true),
    ...reaching.map((r) => face(r.card)),
    ...reached.map((r) => face(r.card)),
  ];

  const laid = linksLayout(
    v.card.id, reaching.map((r) => r.card.id), reached.map((r) => r.card.id),
    { width: NODE_W, height: NODE_H },
  );
  for (const place of laid.placements) {
    const node = nodes.find((n) => n.id === place.id);
    if (node) { node.x = place.x; node.y = place.y; }
  }

  // Direction is the claim: a card that affects the focus points AT it. Built from
  // the full lists, so a mutual link draws both of its arrows even though its card
  // is only on one side.
  // Evidence, when a coverage run exists (design/graphical-views.md 4). Three
  // states, and the third is the interesting one:
  //   observed  - a run saw it happen, drawn solid with its count
  //   possible  - statically derived, never seen, drawn faint
  //   flagged   - seen but never derived: the analyser missed something
  // With no run at all every edge stays `possible`, which is exactly how the
  // view looked before any of this and is the 2026-08-03 ruling: static edges
  // ARE the feature, and evidence only sharpens them.
  const evidenceOf = (n: Neighbour): GraphEdge["evidence"] => edgeEvidence(n, v.evidence);
  const edges: GraphEdge[] = [
    ...allIn.map((r) => ({ from: r.card.id, to: v.card.id, cls: r.cls, ...(evidenceOf(r) ? { evidence: evidenceOf(r) } : {}) })),
    ...allOut.map((r) => ({ from: v.card.id, to: r.card.id, cls: r.cls, ...(evidenceOf(r) ? { evidence: evidenceOf(r) } : {}) })),
  ];

  // What the strip says when a neighbour is selected. Keyed by card and holding a
  // LIST, so a mutual link explains both of its directions rather than losing one.
  const focusName = nameOf(v.card);
  const why = new Map<string, Explanation[]>();
  const add = (id: string, e: Explanation): void => {
    const had = why.get(id);
    if (had) had.push(e); else why.set(id, [e]);
  };
  for (const r of allIn) add(r.card.id, explainLink(focusName, nameOf(r.card), "into", r.cls, r.via));
  for (const r of allOut) add(r.card.id, explainLink(focusName, nameOf(r.card), "out of", r.cls, r.via));

  const cardsById = new Map([v.card, ...allIn.map((r) => r.card), ...allOut.map((r) => r.card)].map((c) => [c.id, c]));

  let tokens = readCanvasTokens();
  const surface: CanvasSurface<CardNode> = mountCanvasSurface<CardNode>({
    host,
    tokens,
    // No grid: nothing here snaps, because nothing here is arranged by hand.
    grid: 0,
    // Room for the captions, which are backdrop rather than items: without it a
    // tall column loses its headings off the top, and an EMPTY column ends up half
    // off the side with nothing next to it to explain what it is.
    fitMargin: laid.fitMargin,
    draw: drawCardNode,
    // Same faces as the node canvas, so the same rule: once the title has gone,
    // the rollover is the only way to tell one neighbour from another.
    hoverTip: (node, scale) => (scale < TITLE_FLOOR ? node.title : undefined),
    onActivate: (id) => reveal(cardsById.get(id)),
    onHover: (id) => {
      const rect = id === undefined || surface.scale() < 0.6 ? undefined : surface.screenRect(id);
      if (id !== undefined && rect) chip.show(id, rect);
      else chip.hideSoon();
    },
    onDragStart: () => chip.hide(),
    onCamera: () => {
      const id = chip.target();
      const rect = id === undefined ? undefined : surface.screenRect(id);
      if (id !== undefined && rect && surface.scale() >= 0.6) chip.show(id, rect);
      else chip.hideSoon();
    },
    // Selecting a neighbour explains its link: the reason an edge exists is the
    // difference between a diagram and a debugging tool, and it was the one thing
    // the old table had that a drawing does not.
    onSelectionChange: (ids) => {
      const one = ids.length === 1 ? ids[0] : undefined;
      paintStrip(strip, one === undefined ? undefined : why.get(one), v);
    },
    onContext: (id, _world, e) => {
      if (id === undefined || id === v.card.id) return;
      const card = cardsById.get(id);
      if (!card) return;
      openContextMenu(e.clientX, e.clientY, [
        // Walking the graph without opening anything: the viewer's own move.
        { label: "Centre on this card", onClick: () => void show(id) },
        { label: "Open in the editor", onClick: () => reveal(card) },
      ]);
    },
  });

  // The chip BEFORE anything that can trigger a camera callback, and after the
  // surface, which is the only order that works: Konva empties its container when
  // it builds the stage (so the chip cannot come first), and onCamera reaches for
  // the chip (so it cannot come last). setItems and fitAll therefore wait.
  const chip = mountOpenChip(host, (id) => reveal(cardsById.get(id)));

  // Captions ride on the canvas so they pan and zoom with their columns.
  surface.setBackdrop((layer, scale, at) => {
    paintEdges(layer, scale, tokens, edges, at);
    paintCaptions(layer, tokens, laid.captions);
  });
  surface.setItems(nodes);
  surface.fitAll();

  const unwatch = watchCanvasTokens((next) => { tokens = next; surface.setTokens(next); });

  return {
    destroy() { unwatch(); chip.destroy(); surface.destroy(); },
    hasSelection: () => surface.selection().length > 0,
  };
}


function reveal(card: LinkCard | undefined): void {
  if (!card) return;
  // Opening a card in the editor moves the editor's selection, which this window
  // follows: opening and walking are the same act, so the graph walk needs no
  // gesture of its own beyond the double-click every view already has.
  void studio.searchReveal({ kind: "card", box: card.box, deck: card.deck, card: card.id });
}

/** The panel under the canvas, in one of two states.
 *
 *  Nothing selected: how to use this, and the standing facts about the analysis
 *  (what it left out, what it cannot see). Something selected: why THAT link
 *  exists, and nothing else. The two never share the space, because they were
 *  fighting over it and the loser was the answer to the question the author had
 *  just asked. Deselect to read the caveats again.
 *
 *  Its height is fixed and it scrolls INSIDE, which is not a style choice: a panel
 *  that grew with its content would resize the canvas underneath a gesture, and the
 *  node view learnt what that does to a drag. */
function paintStrip(strip: HTMLElement, links: Explanation[] | undefined, v: LinksView): void {
  if (links !== undefined && links.length > 0) {
    strip.replaceChildren(...links.flatMap((link) => [
      el("p", { className: "lead", text: link.lead }),
      ...link.rows.map((r) => el("p", { className: "reason" },
        el("code", { text: r.property }),
        el("span", { className: "detail", text: ` ${r.detail}` }),
        ...(r.note !== undefined ? [el("span", { className: "rnote", text: ` (${r.note})` })] : []),
      )),
    ]));
    return;
  }
  const outside = [...v.predecessors, ...v.dependents].filter((n) => !n.card).length;
  const flagged = [...v.predecessors, ...v.dependents].filter((n) => n.flagged).length;
  strip.replaceChildren(
    el("p", { className: "lead quiet", text: "Select a card to see why it is linked. Double-click to open it." }),
    ...(outside > 0
      ? [el("p", { className: "caveat", text: `${outside} linked card(s) are outside the analysed set` })]
      : []),
    // Quiet, and only when a run would add something: the view is complete
    // without one, so this is an offer rather than a warning (the 2026-08-03
    // ruling). With a run, it dates the evidence, because a stale sweep is a
    // different claim from a fresh one.
    el("p", { className: "caveat quiet", text: v.evidence === undefined
      ? "Run a fresh coverage test for more info: which of these links actually happen."
      : `Seen counts are from ${v.evidence.runs} runs, ${sinceWhen(v.evidence.at)}.` }),
    ...(flagged > 0
      ? [el("p", { className: "caveat", text: `${flagged} link(s) were seen in a run but not predicted: the analysis may be missing something.` })]
      : []),
    ...v.notes.map((note) => el("p", { className: "caveat", text: note })),
  );
}

/** "just now" / "6 minutes ago" / "at 14:02". Coarse on purpose: the question a
 *  reader has is whether the evidence is from THIS sitting, not how many
 *  seconds ago it was. */
function sinceWhen(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  return `at ${new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function render(): void {
  canvas?.destroy();
  canvas = undefined;

  const v = view;
  const head = toolWindowHead({
    title: "Links",
    pinned,
    onPin: (on) => { pinned = on; void studio.setLinksPinned(on); },
    onClose: () => void studio.closeLinks(),
    // Walking away from the editor's selection is a state worth showing, with one
    // click back: otherwise the window looks stuck.
    trail: [walked !== undefined
      ? el("button", { className: "swin-follow", text: "Follow the editor", onClick: () => void show(undefined) })
      : el("span", { className: "swin-note", text: "following the editor" })],
  });

  const body = el("main", { className: "lbody" });
  const strip = el("div", { className: "lstrip" });

  if (!v || !v.hasProject) {
    body.append(el("p", { className: "hint", text: "No project open." }));
    root.replaceChildren(head, body);
    return;
  }
  if (!v.card) {
    body.append(el("p", { className: "hint", text: "Open a card in the editor to see what reaches it." }));
    root.replaceChildren(head, body);
    return;
  }

  // The canvas container carries the node view's class, so the Open chip and the
  // canvas styling are the same rules in both places rather than a copy.
  const stage = el("div", { className: "nodestage" });
  body.append(stage);
  root.replaceChildren(head, body, strip);
  paintStrip(strip, undefined, v);
  canvas = mountCanvas(stage, strip, v as LinksView & { card: LinkCard });
}

// The editor's selection moved: follow it, unless the author has walked away.
studio.onLinkFocus(() => { if (walked === undefined) void show(undefined); });

window.addEventListener("keydown", (e) => {
  // Escape does the smallest useful thing first. The canvas also takes Escape to
  // clear its selection, and this listener runs before it (it was registered
  // first), so it has to stand aside rather than close the window under it.
  if (e.key === "Escape" && !canvas?.hasSelection()) void studio.closeLinks();
});

async function boot(): Promise<void> {
  initTooltips();
  applyTheme((await studio.getState()).theme);
  // The canvas follows on its own: watchCanvasTokens is listening for data-theme.
  studio.onTheme(applyTheme);
  // Reset View re-pins every helper window in main and tells the window after
  // the fact (app-shell 0.23.0). Re-rendering is the whole fix here: this head
  // is rebuilt from `pinned` on every render, so the button comes back agreeing
  // with the window instead of showing the state it last chose itself.
  studio.onWindowPinned((on) => { pinned = on; render(); });
  await show(undefined);
}
void boot();
