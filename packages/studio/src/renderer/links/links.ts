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
// leave open and cheap to ignore. Walking the graph here (Centre on this card)
// stops the following until Follow the editor is pressed again, an explicit
// Links... request lands, or the project changes underneath. Nothing here
// analyses: main hands over the analysed view (LinksView), and this file lays
// it out (links-layout.ts), words it (links-explain.ts) and draws it.
//
// One hop only. The whole-project graph is a hairball - the old system learned
// that and refused it - but one hop across the project stays readable.
// ---------------------------------------------------------------------------

import "../src/theme.css";
import "../tool-window/base.css";
import "../src/card-open.css";
import "./links.css";
import "@wildwinter/app-shell/tooltip.css";
// The arrows' key opens in the shell's anchored panel.
import "@wildwinter/app-shell/anchored.css";
// The shell's toast is mounted here as in every tool window (parity row 19);
// nothing in this lens fails today, so there is no call yet, only the home.
import "@wildwinter/app-shell/toast.css";
import { el, pinButton, plural, relativeTime, toolWindowHead } from "@wildwinter/app-shell";
import { bootToolWindow } from "../tool-window/boot.js";
import { escapeSnapshot, pointerHeld } from "../tool-window/escape.js";
import { openContextMenu } from "@wildwinter/app-shell/context-menu";
import { mountCanvasSurface, type CanvasSurface } from "../src/canvas-surface.js";
import { readCanvasTokens, watchCanvasTokens } from "../src/canvas-tokens.js";
import { drawCardNode, paintCaptions, paintEdges, NODE_H, NODE_W, NODE_RADIUS, type CardNode, TITLE_FLOOR } from "../src/node-art.js";
import { mountOpenChip } from "../src/card-open.js";
import { edgeKeyButton, edgeTip } from "../src/edge-key.js";
import { linksLayout } from "./links-layout.js";
import { explainLink, type Explanation } from "./links-explain.js";
import { edgeEvidence } from "./links-evidence.js";
import type { GraphEdge, LinkCard, LinkNeighbour, LinkReason, LinksView } from "../../shared/api.js";

const studio = window.studio;

const root = document.getElementById("links")!;
let view: LinksView | undefined;
/** Set when the author walks the graph here, so the window can stop following
 *  the editor until they come back. */
let walked: string | undefined;
/** Bumped when the project changes or closes (onLinkReset): a canvas drawn for
 *  an earlier generation is never updated in place, whatever card it shows. */
let generation = 0;
/** The latest request for a view, so an older answer arriving late is dropped. */
let requested = 0;

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

/** A view with a card in it, which is the only kind the canvas draws. */
type FocusedView = LinksView & { card: LinkCard };

interface LinksCanvas {
  /** The card in the middle, and the project generation it was drawn for. */
  focus: string;
  generation: number;
  /** The same focus, freshly analysed (an edit elsewhere): the nodes and the
   *  arrows change in place, and the camera and the selection stay. */
  update: (v: FocusedView) => void;
  destroy: () => void;
  /** Escape means "drop the selection" first and "close the window" only when
   *  there is no selection left to drop. */
  hasSelection: () => boolean;
}

/** The live canvas, if there is a card to draw. Kept while the focus holds, and
 *  torn down when it moves: a Konva stage owns window listeners and an observer. */
let canvas: LinksCanvas | undefined;

/**
 * Ask main for a view and draw it. `walk` says whether this is the author
 * walking the graph here (the window then stops following the editor) or a
 * view the editor chose (its selection, or an explicit Links... request).
 */
async function load(cardId: string | undefined, walk: boolean): Promise<void> {
  const mine = ++requested;
  const next = await studio.linksFor(cardId);
  if (mine !== requested) return;   // a newer request has the floor
  view = next;
  walked = walk ? cardId : undefined;
  pin.set(next.pinned);
  render();
}

/** Back to the editor's selection. */
const follow = (): Promise<void> => load(undefined, false);

/** Every neighbour that is actually in the analysed set, with its edge. */
const drawable = (rows: LinkNeighbour[]): Neighbour[] =>
  rows.flatMap((n) => (n.card
    ? [{ card: n.card, cls: n.cls, via: n.via, observed: n.observed, flagged: n.flagged }]
    : []));

/** A card's display name. Titles, never gameIds: the address is the programmer's
 *  handle and belongs in the inspector and the CLI. */
const nameOf = (card: LinkCard): string => card.title ?? card.gameId;

function mountCanvas(host: HTMLElement, strip: HTMLElement, first: FocusedView): LinksCanvas {
  let v = first;
  let nodes: CardNode[] = [];
  let edges: GraphEdge[] = [];
  let laid = linksLayout(first.card.id, [], [], { width: NODE_W, height: NODE_H });
  /** What the strip says when a neighbour is selected. Keyed by card and holding
   *  a LIST, so a mutual link explains both of its directions rather than losing
   *  one. */
  let why = new Map<string, Explanation[]>();
  let cardsById = new Map<string, LinkCard>();

  /** Everything drawn, from a view: the nodes and where they sit, the arrows,
   *  and what each neighbour's link means. Run again for an update in place. */
  const derive = (next: FocusedView): void => {
    // A card can be on BOTH sides: it opens the focus and the focus opens it,
    // which is a mutual link and a perfectly ordinary thing to write. It gets ONE
    // node, on the left, and keeps both of its edges - so the mutuality reads as
    // two arrows rather than as the same card drawn twice. (Drawn twice is not a
    // cosmetic problem: the surface keys items by id, so a duplicate would
    // collide in the group map and in the selection.) The focus itself is
    // excluded from both columns for the same reason: a card whose outcome
    // writes what its own condition reads is a self-link, not a neighbour.
    const seen = new Set<string>([next.card.id]);
    const once = (rows: LinkNeighbour[]): Neighbour[] =>
      drawable(rows).filter((r) => (seen.has(r.card.id) ? false : (seen.add(r.card.id), true)));
    const reaching = once(next.predecessors);
    const reached = once(next.dependents);
    // Every edge is still drawn, including those of a card that was
    // deduplicated out of the right-hand column.
    const allIn = drawable(next.predecessors);
    const allOut = drawable(next.dependents);

    const face = (card: LinkCard, emphasis = false): CardNode => ({
      id: card.id,
      title: nameOf(card),
      deck: card.deckTitle,
      x: 0, y: 0, width: NODE_W, height: NODE_H, cornerRadius: NODE_RADIUS,
      ...(emphasis ? { emphasis: true } : {}),
    });
    nodes = [face(next.card, true), ...reaching.map((r) => face(r.card)), ...reached.map((r) => face(r.card))];

    laid = linksLayout(
      next.card.id, reaching.map((r) => r.card.id), reached.map((r) => r.card.id),
      { width: NODE_W, height: NODE_H },
    );
    for (const place of laid.placements) {
      const node = nodes.find((n) => n.id === place.id);
      if (node) { node.x = place.x; node.y = place.y; }
    }

    // Direction is the claim: a card that affects the focus points AT it. Built
    // from the full lists, so a mutual link draws both of its arrows even though
    // its card is only on one side.
    // Evidence, when a coverage run exists (design/graphical-views.md 4). Three
    // states, and the third is the interesting one:
    //   observed  - a run saw it happen, drawn solid with its count
    //   possible  - statically derived, never seen, drawn faint
    //   flagged   - seen but never derived: the analyser missed something
    // With no run at all every edge stays `possible`, which is exactly how the
    // view looked before any of this and is the 2026-08-03 ruling: static edges
    // ARE the feature, and evidence only sharpens them.
    const edge = (from: string, to: string, r: Neighbour): GraphEdge => {
      const evidence = edgeEvidence(r, next.evidence);
      return { from, to, cls: r.cls, via: r.via, ...(evidence ? { evidence } : {}) };
    };
    edges = [
      ...allIn.map((r) => edge(r.card.id, next.card.id, r)),
      ...allOut.map((r) => edge(next.card.id, r.card.id, r)),
    ];

    const focusName = nameOf(next.card);
    why = new Map();
    const add = (id: string, e: Explanation): void => {
      const had = why.get(id);
      if (had) had.push(e); else why.set(id, [e]);
    };
    for (const r of allIn) add(r.card.id, explainLink(focusName, nameOf(r.card), "into", r.cls, r.via));
    for (const r of allOut) add(r.card.id, explainLink(focusName, nameOf(r.card), "out of", r.cls, r.via));

    cardsById = new Map([next.card, ...allIn.map((r) => r.card), ...allOut.map((r) => r.card)].map((c) => [c.id, c]));
  };
  derive(first);

  /** The strip for whatever is selected now. */
  const explain = (): void => {
    const ids = surface.selection();
    paintStrip(strip, ids.length === 1 ? why.get(ids[0]!) : undefined, v);
  };

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
    // Hovering an arrow says what selecting its card would, in the same words.
    backdropTip: edgeTip<CardNode>(() => edges, (id) => {
      const card = cardsById.get(id);
      return card ? nameOf(card) : id;
    }, (at) => at),
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
    onSelectionChange: () => explain(),
    onContext: (id, _world, e) => {
      if (id === undefined || id === v.card.id) return;
      const card = cardsById.get(id);
      if (!card) return;
      openContextMenu(e.clientX, e.clientY, [
        // Walking the graph without opening anything: the viewer's own move.
        { label: "Centre on this card", onClick: () => void load(id, true) },
        { label: "Open in the editor", onClick: () => reveal(card) },
      ]);
    },
  });

  // The chip BEFORE anything that can trigger a camera callback, and after the
  // surface, which is the only order that works: Konva empties its container when
  // it builds the stage (so the chip cannot come first), and onCamera reaches for
  // the chip (so it cannot come last). setItems and fitAll therefore wait.
  const chip = mountOpenChip(host, (id) => reveal(cardsById.get(id)));

  // Captions ride on the canvas so they pan and zoom with their columns. The
  // painter reads the current layout, so an update in place repaints it.
  surface.setBackdrop((layer, scale, at) => {
    paintEdges(layer, scale, tokens, edges, at);
    paintCaptions(layer, tokens, laid.captions);
  });
  surface.setItems(nodes);
  surface.fitAll();

  const unwatch = watchCanvasTokens((next) => { tokens = next; surface.setTokens(next); });

  return {
    focus: first.card.id,
    generation,
    update(next) {
      v = next;
      derive(next);
      // setItems keeps the selection for anything still present and repaints the
      // backdrop; the camera is left where the author put it.
      surface.setItems(nodes);
      explain();
    },
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
  const neighbours = [...v.predecessors, ...v.dependents];
  const outside = neighbours.filter((n) => !n.card).length;
  const flagged = neighbours.filter((n) => n.flagged).length;
  strip.replaceChildren(
    el("p", { className: "lead quiet", text: "Select a card to see why it is linked. Double-click to open it." }),
    ...(outside > 0
      ? [el("p", { className: "caveat", text: `${plural(outside, "linked card")} ${outside === 1 ? "sits" : "sit"} outside the analysed set.` })]
      : []),
    // Quiet, and only when a run would add something: the view is complete
    // without one, so this is an offer rather than a warning (the 2026-08-03
    // ruling). With a run, it dates the evidence, because a stale sweep is a
    // different claim from a fresh one.
    el("p", { className: "caveat quiet" },
      v.evidence === undefined
        ? "Run a fresh coverage test to see which of these links actually happen."
        : `Seen counts are from ${v.evidence.runs} runs, ${relativeTime(v.evidence.at)}.`,
      // The arrows' key, beside the line that talks about them. With a run it
      // also keys the three evidence strokes, which every arrow then wears.
      ...(v.card !== undefined && neighbours.some((n) => n.card)
        ? [edgeKeyButton({
            className: "edgekey-inline",
            tokens: () => readCanvasTokens(),
            evidence: () => v.evidence !== undefined,
          })]
        : []),
    ),
    ...(flagged > 0
      ? [el("p", { className: "caveat", text: `${plural(flagged, "link")} ${flagged === 1 ? "was" : "were"} seen in a run but not predicted, so the analysis may be missing something.` })]
      : []),
    ...v.notes.map((note) => el("p", { className: "caveat", text: note })),
  );
}

/** The pin, built once and driven with `set`: main re-pins the window on Reset
 *  View and tells it after the fact (app-shell 0.23.0). */
const pin = pinButton({ pinned: true, onToggle: (on) => { void studio.setLinksPinned(on); } });

/**
 * Follow the editor, as a toggle that stays put. It used to be a button while
 * walked and a note while following, so pressing it took the focus away with
 * it. On: the window follows the editor's selection. Off: it stays on the card
 * it shows (pressing it, or walking with Centre on this card).
 */
const followToggle = el("button", { className: "btn swin-follow", text: "Follow the editor", onClick: () => {
  if (walked !== undefined) void follow();
  else if (view?.card) { walked = view.card.id; syncFollow(); }
} }) as HTMLButtonElement;
followToggle.type = "button";

function syncFollow(): void {
  const on = walked === undefined;
  followToggle.classList.toggle("on", on);
  followToggle.setAttribute("aria-pressed", String(on));
  followToggle.dataset["tip"] = on
    ? "This window follows the card selected in the editor. Click to stay on this card."
    : "Go back to the card selected in the editor";
}

const body = el("main", { className: "lbody" });
/** A mouse held down on the canvas: a marquee or a pan in progress. */
const held = pointerHeld(body);
/** The state Escape was pressed in, read before the canvas drops its selection. */
const escapedFrom = escapeSnapshot(() => ({ selection: canvas?.hasSelection() ?? false, held: held() }));

const head = toolWindowHead({
  title: "Links",
  pin,
  onClose: () => void studio.closeLinks(),
  // Escape does the smallest useful thing first: the canvas takes it to clear
  // its selection or abandon a marquee, and the window only closes when there
  // is neither. Read as the key went down (escape.ts), so it does not depend
  // on whether the canvas heard it first.
  onEscape: () => {
    const at = escapedFrom();
    return (at?.selection ?? false) || (at?.held ?? false);
  },
  // Walking away from the editor's selection is a state worth showing, with one
  // click back: otherwise the window looks stuck.
  trail: [followToggle],
});
const strip = el("div", { className: "lstrip" });

function teardown(): void {
  canvas?.destroy();
  canvas = undefined;
}

function render(): void {
  syncFollow();
  const v = view;
  if (!v || !v.hasProject || !v.card) {
    teardown();
    strip.hidden = true;
    body.replaceChildren(el("p", { className: "empty tw-empty", text: !v || !v.hasProject
      ? "Open a project to see how its cards link."
      : "Select a card in the editor to see what reaches it." }));
    return;
  }
  strip.hidden = false;
  const focused = v as FocusedView;
  // The same card in the same project (an edit somewhere, or the editor
  // re-sending its selection): update in place. Tearing the stage down here
  // threw away the pan, the zoom and the selected neighbour on every render the
  // editor did.
  if (canvas && canvas.focus === focused.card.id && canvas.generation === generation) {
    canvas.update(focused);
    return;
  }
  teardown();
  // The canvas container carries the node view's class, so the Open chip and the
  // canvas styling are the same rules in both places rather than a copy.
  const stage = el("div", { className: "nodestage" });
  body.replaceChildren(stage);
  paintStrip(strip, undefined, focused);
  canvas = mountCanvas(stage, strip, focused);
}

// The editor's selection moved: follow it, unless the author has walked away.
// An explicit Links... request names its card, and always lands: it re-centres
// and the window follows the editor again.
studio.onLinkFocus((cardId) => {
  if (cardId !== undefined && walked !== undefined) { void load(cardId, false); return; }
  if (walked === undefined) void follow();
});

// The project changed or closed: whatever the window was walking is gone, so it
// follows the editor again, from a fresh stage.
studio.onLinkReset(() => {
  generation++;
  walked = undefined;
  void follow();
});

async function boot(): Promise<void> {
  // The canvas follows the theme on its own: watchCanvasTokens is listening for
  // data-theme.
  await bootToolWindow({ onPinned: (on) => pin.set(on) });
  root.replaceChildren(head, body, strip);
  await follow();
}
void boot();
