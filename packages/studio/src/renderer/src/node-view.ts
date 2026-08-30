// ---------------------------------------------------------------------------
// The node view: a deck's cards on a canvas, with their dependencies drawn.
//
// An ORDINARY view of a deck, not a mode: it is the third setting of the same
// Cards / Table switch every collection already has, it reads the same DeckDto
// the other two read, and clicking a card means what clicking a card means
// everywhere else.
//
// Arranging is real now: a card lands where you drop it, and the box's
// `.storyletview` sidecar remembers (design/graphical-views.md section 1.2). The
// arrangement is the author's, so nothing here ever moves a card on its own.
// ---------------------------------------------------------------------------

import Konva from "konva";
import { el } from "./dom.js";
import { openContextMenu } from "./context-menu.js";
import { mountCanvasSurface, type CanvasItem, type CanvasSurface } from "./canvas-surface.js";
import { nodeCameraKey, recallCamera, rememberCamera } from "./canvas-memory.js";
import { readCanvasTokens, watchCanvasTokens } from "./canvas-tokens.js";
import { drawCardNode, gridLayout, paintEdges, NODE_H, NODE_W, TITLE_FLOOR, type CardNode } from "./node-art.js";
import {
  drawFrame, frameShape, type FrameShape,
} from "./furniture-art.js";
import { createFurniture, type FurnitureController } from "./furniture-edit.js";
import { mountOpenChip } from "./card-open.js";
import { markerPainter, markerPoint } from "./comment-markers.js";
import { cardHeat, coverageLegend } from "./coverage-art.js";
import type { DeckDto, DeckGraph, CanvasFurnitureDto, CommentMarkerDto, CoverageOverlayDto } from "../../shared/api.js";

export interface NodeViewActions {
  /** Double-click: the full card, in the editor, as everywhere else. */
  open: (cardId: string) => void;
  /** Right-click on a card. */
  duplicate: (cardId: string) => void;
  remove: (cardId: string) => void;
  /** Point the Links lens at this card, without selecting or opening it. */
  showLinks: (cardId: string) => void;
  /** Right-click on empty canvas: a new card, placed WHERE the author asked for
   *  it rather than at the end of the default grid. `pinned` is where every other
   *  card currently sits, so the insertion cannot shift them. */
  addAt: (at: { x: number; y: number }, pinned: { id: string; x: number; y: number }[]) => void;
  /** Delete a selection, with whatever guard the app applies. */
  removeMany: (cardIds: string[]) => void;
  /** Arrange by dependency; resolves to the new positions and any loops found. */
  layOut: (
    ids: string[], current: { id: string; x: number; y: number }[],
    size: { width: number; height: number; gapX: number; gapY: number },
  ) => Promise<{ positions: { id: string; x: number; y: number }[]; cycles: string[][] } | undefined>;
  /** The selection changed: the WHOLE of it, so the other views of this deck can
   *  show the same cards selected. */
  select: (cardIds: string[]) => void;
  /** The furniture changed: the whole list, with the gesture named for undo. */
  setFurniture: (furniture: CanvasFurnitureDto, label: string, coalesce?: string) => void;
  /** A drop: record where the cards now sit. */
  moved: (placements: { id: string; x: number; y: number }[]) => void;
  /** The comment markers drawn on this canvas, as main resolved them: which kind
   *  each is, its badge, its hover line. Re-fetched after any comment change. */
  markers: () => CommentMarkerDto[];
  /** The coverage overlay, or undefined when it is off. A getter, like
   *  `markers`: it changes underneath a mounted canvas (a run finishes, the
   *  overlay is switched off) and the view repaints rather than remounts. */
  coverage: () => CoverageOverlayDto | undefined;
  /** Whether the overlay is ON, which is not the same as having a report: the
   *  mode with no run yet is exactly when the strip has something to say. */
  coverageOn: () => boolean;
  /** Open a thread's popover, anchored to an element at the marker. */
  openThread: (threadId: string, anchor: HTMLElement) => void;
  /** Start a thread HERE: on empty canvas, or on the card it was dropped on. The
   *  thread is not created until the first message is posted, so this opens a
   *  composer rather than writing anything. */
  startThread: (
    at: { x: number; y: number }, item: string | undefined, anchor: HTMLElement,
  ) => void;
  /** A marker was dragged: its new place, and what it landed on. */
  moveMarker: (threadId: string, x: number, y: number, item?: string) => void;
}

export interface MountedNodeView {
  /** The selection changed elsewhere (the browse, Find, Links). */
  setSelected: (cardIds: string[]) => void;
  /** Redraw the comment markers alone, after one is posted, moved or resolved.
   *  Not a full remount: that would lose the camera and the selection. */
  /** Open one marker's thread, centring the canvas on it: the feedback walk's
   *  way in. False when that thread is not a marker on this canvas. */
  openMarker: (threadId: string) => boolean;
  repaintMarkers: () => void;
  /** The overlay came, went or was re-run: re-read it onto the faces. NOT a
   *  remount, which would throw away the camera and the selection. */
  refreshCoverage: () => void;
  destroy: () => void;
}

// Where the author was looking is remembered per deck, and put back on the way
// in: the centre is rebuilt for all sorts of reasons (switching to Cards and
// back, an undo, a save elsewhere) and each rebuild remounts the canvas, so
// re-fitting every time would read as the view lurching about on its own. It
// outlives the session too - see canvas-memory.ts for where it is kept and why
// that is the user's state rather than the project's sidecar.

/** Mount the canvas into `host`. The caller owns the fetch, so this stays
 *  synchronous and testable in shape: hand it the deck and its graph. */
export function mountNodeView(
  host: HTMLElement, deck: DeckDto, graph: DeckGraph,
  selected: readonly string[], actions: NodeViewActions,
): MountedNodeView {
  const stage = el("div", { className: "nodestage" });
  const strip = el("div", { className: "nodestrip" });
  host.replaceChildren(stage, strip);

  // The cards come from the DeckDto: one truth for a card's face, and the deck's
  // order is the default layout's only input.
  const deckTitle = deck.title ?? deck.gameId;
  // One surface, three kinds of thing. A card carries no `kind` of its own: it
  // predates the furniture and is shared with the Links canvas, so the union
  // narrows on the presence of one rather than making every other caller add it.
  type NodeItem = CardNode | FrameShape;
  const isCard = (item: NodeItem): item is CardNode => !("kind" in item);

  const cards = gridLayout(deck.cards.map((c) => ({
    id: c.id,
    title: c.title ?? c.gameId,
    deck: deckTitle,
  })), graph.positions);
  /** Re-read the coverage reading onto the faces. Called on every repaint rather
   *  than baked in at mount, because the overlay is a mode that can come and go
   *  while this canvas stays up. */
  const dressCoverage = (): void => {
    const cover = actions.coverage();
    for (const card of cards) card.heat = cover === undefined ? undefined : cardHeat(card.id, cover);
  };
  dressCoverage();
  /** Frames behind the cards: the same order the map uses,
   *  and the same two objects (furniture-art.ts). */
  const nodes: NodeItem[] = [
    ...graph.furniture.frames.map((r): NodeItem => frameShape(r)),
    ...cards,
  ];
  /** The frames, shared with the map. Built after the surface. */
  let furniture: FurnitureController | undefined;
  /** The comment tool is armed: the next click drops a marker. Held here rather
   *  than asked of the surface, because the strip needs to say so. */
  let commentArmed = false;
  /** The CARDS, where they now are: what the deck's own commands take. */
  const cardsNow = (): { id: string; x: number; y: number }[] =>
    nodes.filter(isCard).map((n) => ({ id: n.id, x: n.x, y: n.y }));

  // The camera controls are NOT here: fit, fit-the-selection and zoom belong to
  // the cluster the surface mounts in the canvas's own bottom-right corner, the
  // same one on all three canvases (canvas-controls.ts). This strip is for what
  // is true of THIS view, which on a deck means arranging and what the last
  // arrangement had to say.
  //
  // Built BEFORE the surface, and it has to be: mounting seeds the selection,
  // which fires onSelectionChange, which repaints this strip - and a strip whose
  // buttons did not exist yet threw during mount, so any deck arrived at WITH a
  // card selected came up with no strip at all. (Found in use: "some decks have
  // lost the buttons".)
  //
  // The label says which cards it will touch, because the answer changes with the
  // selection and "arrange" is not a command you want to guess the scope of.
  const tidy = el("button", {
    className: "camerabtn", text: "Arrange all by links",
    tip: "Arrange by what links the cards (L)",
    onClick: () => layOut(),
  });
  /** What the last layout had to say, if anything. Cleared by the next one. */
  let layoutNote: string | undefined;

  /**
   * Arrange by dependency. The SELECTION when there is one, everything
   * otherwise: "lay out" means "tidy what I am working on", and a selection is
   * the author saying what that is. Cards outside it do not move.
   *
   * The arranging itself happens in main (see `layoutDeck`), which is also where
   * it is written, so the whole tidy is one undo step.
   */
  function layOut(): void {
    const chosen = surface.selection();
    const scope = chosen.length > 1 ? chosen.filter((id) => furniture?.owns(id) !== true) : cardsNow().map((n) => n.id);
    if (scope.length === 0) return;
    void (async () => {
      const was = new Map(cardsNow().map((n) => [n.id, { x: n.x, y: n.y }]));
      const laid = await actions.layOut(scope, cardsNow(),
        { width: NODE_W, height: NODE_H, gapX: 50, gapY: 40 });
      if (!laid) return;
      let moved = false;
      for (const p of laid.positions) {
        const node = nodes.find((n) => n.id === p.id);
        if (!node) continue;
        const before = was.get(p.id);
        if (before && (before.x !== p.x || before.y !== p.y)) moved = true;
        node.x = p.x;
        node.y = p.y;
      }
      surface.setItems(nodes);
      // The camera intervenes only if it has to. An arrangement that barely
      // changed anything, or one whose result is already on screen, is no reason
      // to move an author's view: they asked to arrange cards, not to be taken
      // somewhere. A result left off-screen has technically worked and
      // practically not, so that case still gets framed.
      if (moved) surface.revealIfOffscreen(scope);
      // Cycles are reported, never hidden: cards that enable each other are a
      // legitimate thing to write, and the layout has just stacked them in one
      // column, which is worth explaining.
      layoutNote = laid.cycles.length === 0 ? undefined : describeCycles(laid.cycles, deck);
      paintStrip();
    })();
  }

  function paintStrip(): void {
    // A tool is armed: one instruction and a way out, the same shape the map's
    // tracer uses. The comment tool joins the furniture's own hints here rather
    // than inventing a second armed-state grammar for the same strip.
    const hint = commentArmed ? "Comment: click where it goes" : furniture?.hint();
    if (hint !== undefined) {
      strip.replaceChildren(
        el("span", { className: "hint", text: hint }),
        el("span", { className: "stripgap" }),
        el("button", {
          className: "stripbtn cancel", text: "Cancel", tip: "Abandon this (Esc)",
          onClick: () => { if (commentArmed) disarmComment(); else furniture?.cancel(); },
        }),
      );
      return;
    }
    tidy.textContent = surface.selection().length > 1 ? "Arrange by links" : "Arrange all by links";
    const note = layoutNote === undefined ? [] : [el("span", { className: "hint", text: layoutNote })];
    // The overlay names itself in the strip and DATES its evidence: a canvas
    // silently wearing an hour-old run is the one way this can mislead, so the
    // age is not optional chrome.
    const legend = actions.coverageOn()
      ? [el("span", { className: "hint cover-legend", text: coverageLegend(actions.coverage(), Date.now()) })]
      : [];
    // THE MAP'S GRAMMAR, adopted (2026-08-15). The two canvases had drifted into
    // opposite readings of the same strip: the map put its verbs first as real
    // buttons and its status last, this one put status first and its verbs last
    // as quiet camera controls. Frame and Comment are the SAME two verbs on both
    // canvases, so they now look and sit the same on both, and `.stripbtn` gives
    // them the map's "+" affordance for free.
    //
    // "Arrange" stays at the far right, and that is not an oversight: the left
    // group is things you ADD to the canvas, and rearranging what is already on
    // it is a different kind of act. The map has no equivalent, which is why it
    // ends at its status.
    strip.replaceChildren(
      el("div", { className: "striptools" },
        el("button", {
          className: "stripbtn", text: "Frame", tip: "Draw a titled frame behind a group of cards",
          onClick: () => furniture?.drawFrame(),
        }),
        el("button", {
          className: "stripbtn", text: "Comment", tip: "Drop a comment on the canvas or on a card",
          onClick: () => armComment(),
        }),
      ),
      ...describe(deck, graph), ...note, ...legend,
      el("span", { className: "stripgap" }),
      tidy,
    );
  }

  let tokens = readCanvasTokens();
  const surface: CanvasSurface<NodeItem> = mountCanvasSurface<NodeItem>({
    host: stage,
    tokens,
    grid: 20,
    draw: (item, ctx) => {
      if (isCard(item)) return drawCardNode(item, ctx);
      return drawFrame(item, ctx);
    },
    onActivate: (id) => { if (furniture?.activate(id) !== true) actions.open(id); },
    onDelete: (ids) => {
      const rest = furniture?.absorbDelete(ids) ?? ids;
      if (rest.length > 0) actions.removeMany(rest);
    },
    // No grace period here: a chip left beside a card that has moved away reads
    // as a bug, and nobody needs an Open button while they are dragging.
    onDragStart: () => chip.hide(),
    onKey: (key) => { if (key === "l") layOut(); },
    // Below the title floor a card face is a blank rectangle with a deck stripe,
    // which is right at that size and leaves a board of anonymous cards. The tip
    // is the name back, at a size the zoom cannot touch.
    hoverTip: (node, scale) => {
      if (scale >= TITLE_FLOOR) return undefined;
      if (isCard(node)) return node.title;
      return node.title;
    },
    onHover: (id) => {
      // Too small to hold a chip legibly: below this the face is abbreviated to a
      // title, and the affordance would cover most of it.
      //
      // FURNITURE gets no chip. It used to: `onActivate` below asks the furniture
      // first and only then falls through to `actions.open`, but the chip called
      // `actions.open` unconditionally, so hovering a frame offered to open
      // something with no card behind it and clicking did nothing at all. A frame
      // is opened by double-clicking its bar, which already works
      // (design/annotation.md 6).
      const openable = id !== undefined && furniture?.owns(id) !== true;
      const rect = openable && surface.scale() >= 0.6 ? surface.screenRect(id) : undefined;
      if (openable && rect) chip.show(id, rect);
      else chip.hideSoon();
    },
    onCamera: () => {
      // Follow the node while the camera moves; if it has gone, let it lapse.
      const id = chip.target();
      const rect = id === undefined || furniture?.owns(id) === true ? undefined : surface.screenRect(id);
      if (id !== undefined && rect && surface.scale() >= 0.6) chip.show(id, rect);
      else chip.hideSoon();
    },
    // The same context menu the card and table views use, with the same words in
    // the same order. On empty canvas it offers the one thing the other two views
    // have that a canvas was missing: a way to add a card.
    onContext: (id, world, e) => {
      if (id !== undefined && furniture?.menu(id, e) === true) return;
      openContextMenu(e.clientX, e.clientY, id === undefined
        ? [
            { label: "New card here", onClick: () => actions.addAt(world, cardsNow()) },
            { label: "Draw a frame", onClick: () => furniture?.drawFrame() },
            { label: "Arrange all by links", onClick: () => { surface.select([]); layOut(); } },
          ]
        : [
            // Same menu as a card in the other two views, in the same order.
            { label: "Links...", onClick: () => actions.showLinks(id) },
            { label: "Duplicate", onClick: () => actions.duplicate(id) },
            { label: "Delete", danger: true, onClick: () => actions.remove(id) },
            ...(surface.selection().length > 1
              ? [{ label: "Arrange by links", onClick: () => layOut() }]
              : []),
          ]);
    },
    onSelectionChange: (ids) => { actions.select(ids); paintStrip(); },
    onMove: (rawMoves) => {
      // Furniture is arrangement of the canvas rather than of the cards, so it
      // takes its own out of the drop before the deck hears about it.
      const moves = furniture?.absorbMoves(rawMoves) ?? rawMoves;
      // Keep our own copy in step so a later repaint (a theme change, a resize)
      // draws the cards where they now are rather than where they loaded.
      for (const move of moves) {
        const node = nodes.find((n) => n.id === move.id);
        if (node) { node.x = move.x; node.y = move.y; }
      }
      if (moves.length > 0) actions.moved(moves);
    },
  });
  furniture = createFurniture({
    surface: () => surface as unknown as CanvasSurface<CanvasItem>,
    container: () => stage,
    get: () => graph.furniture,
    save: (next, label, coalesce) => actions.setFurniture(next, label, coalesce),
    repaint: () => { paintStrip(); paintBehind(); },
  });

  /**
   * Comment markers, in the surface's marker group (design/annotation.md 3).
   *
   * `itemAt` answers with CARDS only. A marker dropped on a frame should sit on
   * the canvas rather than follow the frame: a frame is a thing an author drew
   * around content, it has no identity worth commenting on, and it moves for
   * layout reasons that have nothing to do with what the comment is about.
   */
  surface.setMarkers(markerPainter<NodeItem>({
    markers: () => actions.markers(),
    open: (threadId, anchor) => actions.openThread(threadId, anchor),
    moved: (threadId, x, y, item) => actions.moveMarker(threadId, x, y, item),
    itemAt: (x, y) => {
      const hit = nodes.find((n) =>
        isCard(n) && x >= n.x && y >= n.y && x <= n.x + n.width && y <= n.y + n.height);
      return hit?.id;
    },
    host: () => stage,
  }, () => tokens));

  /**
   * Arm the comment tool: the next click drops a marker and opens its composer.
   *
   * The thread is not created by the click. Nothing is written until the first
   * message is posted, which is the rule the whole comment feature keeps: opening
   * a composer and thinking better of it must leave nothing behind.
   */
  function armComment(): void {
    commentArmed = true;
    surface.setTool({
      cursor: "crosshair",
      onClick: (at) => {
        disarmComment();
        const over = nodes.find((n) =>
          isCard(n) && at.x >= n.x && at.y >= n.y && at.x <= n.x + n.width && at.y <= n.y + n.height);
        // On a card, the marker's stored position is an OFFSET from that card, so
        // it keeps its place beside the thing when the card moves.
        const point = over ? { x: at.x - over.x, y: at.y - over.y } : at;
        actions.startThread(point, over?.id, proxyFor(at));
      },
      // Escape, or another tool replacing this one.
      onCancel: () => { commentArmed = false; paintStrip(); },
    });
    paintStrip();
  }

  function disarmComment(): void {
    commentArmed = false;
    surface.setTool(undefined);
    paintStrip();
  }


  /**
   * Open a marker's thread from OUTSIDE the canvas: the Review Feedback walk
   * stepping onto a comment that lives here.
   *
   * A marker is a Konva shape, so it cannot be reached the way the walk reaches
   * a document's topline bubble. It is centred first and its popover hangs off a
   * proxy at its point, which is the whole reason a comment was dropped on a
   * canvas rather than filed against the container: the place IS the subject.
   */
  function openMarker(threadId: string): boolean {
    const marker = actions.markers().find((m) => m.id === threadId);
    if (!marker) return false;
    const point = markerPoint(marker, (id) => nodes.find((n) => n.id === id));
    if (!point) return false;
    surface.centreAt(point);
    actions.openThread(threadId, proxyFor(point));
    return true;
  }

  /** A zero-size element at a canvas point, for the composer popover to hang
   *  off: the shell's anchored panel measures an element, and a canvas has none
   *  at an arbitrary spot. */
  function proxyFor(at: { x: number; y: number }): HTMLElement {
    stage.querySelector(".cmt-marker-proxy")?.remove();
    const screen = surface.toScreen(at);
    const proxy = el("div", { className: "cmt-marker-proxy" });
    proxy.style.left = `${Math.round(screen.x)}px`;
    proxy.style.top = `${Math.round(screen.y)}px`;
    stage.append(proxy);
    return proxy;
  }

  // `at` comes from the surface: it reports live positions, so the edges stay
  // attached to a card while it moves rather than catching up when it lands.
  /** The edge painter asks for cards, so furniture is filtered out of the lookup
   *  rather than taught to paintEdges, which has no business knowing it exists. */
  const cardAt = (at: (id: string) => NodeItem | undefined) =>
    (id: string): CardNode | undefined => { const item = at(id); return item && isCard(item) ? item : undefined; };
  /** The edges, plus the rectangle a frame is being dragged out as. Re-set
   *  rather than mutated: setting the painter is what forces the layer to repaint,
   *  which is how the map draws its own previews too. */
  const paintBehind = (): void => {
    surface.setBackdrop((layer, scale, at) => {
      paintEdges(layer, scale, tokens, graph.edges, cardAt(at));
      const band = furniture?.draft();
      if (band) {
        layer.add(new Konva.Rect({
          x: band.x, y: band.y, width: band.w, height: band.h,
          stroke: tokens.accent, strokeWidth: 1.5 / scale, dash: [6 / scale, 4 / scale],
          listening: false,
        }));
      }
    });
  };
  paintBehind();
  surface.setItems(nodes);
  if (selected.length > 0) surface.select([...selected]);
  // Back where the author left off, or framed for the first time.
  const remembered = recallCamera(nodeCameraKey(deck.id));
  if (remembered) surface.setCamera(remembered);
  else surface.fitAll();

  // AFTER the surface: Konva empties its container when it builds the stage
  // (Stage.js, `container.innerHTML = ''`), so anything added first is silently
  // wiped. That is why the chip appeared in the two DOM views and never here.
  // The guard is in onHover, so this cannot be reached with a furniture id; the
  // check is here as well because the two must not be able to disagree.
  const chip = mountOpenChip(stage, (id) => { if (furniture?.owns(id) !== true) actions.open(id); });

  paintStrip();

  const unwatch = watchCanvasTokens((next) => {
    tokens = next;
    surface.setTokens(next);
    paintBehind();
  });

  return {
    setSelected(cardIds) { surface.select([...cardIds]); paintStrip(); },
    repaintMarkers() { surface.repaintMarkers(); },
    openMarker,
    refreshCoverage() { dressCoverage(); surface.setItems(nodes); paintStrip(); },
    destroy() {
      // Remember the camera on the way out: this is the one moment we know both
      // the deck and where its canvas was looking.
      rememberCamera(nodeCameraKey(deck.id), surface.camera());
      chip.destroy();
      unwatch();
      surface.destroy();
    },
  };
}

/** Name the loops in an author's own words: card titles, not ids. */
function describeCycles(cycles: string[][], deck: DeckDto): string {
  const title = (id: string): string => {
    const card = deck.cards.find((c) => c.id === id);
    return card?.title ?? card?.gameId ?? id;
  };
  const one = (members: string[]): string => members.map(title).join(", ");
  return cycles.length === 1
    ? `These cards enable each other, so they share a column: ${one(cycles[0]!)}.`
    : `${cycles.length} groups of cards enable each other, so each shares a column: `
      + cycles.map((c) => one(c)).join("; ") + ".";
}

/** The strip under the canvas. Quiet, and only ever says something worth saying:
 *  an empty canvas has to explain itself, because a deck with no internal links
 *  is perfectly normal (its cards answer to cards in other decks) and a blank
 *  board would read as a bug. */
function describe(deck: DeckDto, graph: DeckGraph): Node[] {
  const out: Node[] = [];
  // The naive-user pass the map had and this canvas had not (2026-08-15). An
  // empty state that only STATES leaves a beginner looking for the button; the
  // map's voice names the next move ("add one and trace its outline"), so this
  // one does too.
  if (deck.cards.length === 0) {
    out.push(el("span", { className: "hint", text: "No cards yet: right-click the canvas for \u201cNew card here\u201d." }));
    return out;
  }
  if (graph.edges.length === 0) {
    out.push(el("span", {
      className: "hint",
      // "Nothing links to anything" reads as a fault to somebody who does not
      // yet know that a deck of independent cards is completely normal here.
      // Say the normal thing first, and only then the count.
      text: graph.outsideLinks > 0
        ? `These cards stand on their own; ${graph.outsideLinks} outcome${graph.outsideLinks === 1 ? " leads" : "s lead"} to cards in other decks.`
        : "These cards stand on their own: none of them leads to another here.",
    }));
  } else {
    out.push(el("span", {
      className: "hint",
      // "Link" was the jargon: an arrow here is an OUTCOME leading somewhere, and
      // that is the word the rest of the app uses for it.
      text: `${graph.edges.length} outcome${graph.edges.length === 1 ? "" : "s"} lead${graph.edges.length === 1 ? "s" : ""} between these cards`
        + (graph.outsideLinks > 0 ? `, and ${graph.outsideLinks} to cards in other decks.` : "."),
    }));
  }
  // Analysis caveats (notably the @hand one) deliberately do NOT appear here. It
  // is the same sentence under every deck in the project, which is the definition
  // of noise; the Links window carries it where a reader is actually asking why an
  // edge is missing.
  return out;
}
