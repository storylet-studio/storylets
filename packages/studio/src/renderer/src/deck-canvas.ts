// ---------------------------------------------------------------------------
// A deck's node view, mounted: the canvas half of the deck page.
//
// views.ts draws DOM and never talks to main, so a deck in Node view hands the
// renderer an empty container and this fills it once the deck's links are in.
// It owns the live canvas while it is mounted, and turns what the canvas asks
// for (open, select, add, move, delete, arrange, comment) into the editor's own
// actions and main's calls.
// ---------------------------------------------------------------------------

import { noteMadeInDeck } from "./inspector.js";
import { ok } from "./results.js";
import type { MountedNodeView } from "./node-view.js";
import type { Comments } from "./comments.js";
import type { ViewActions } from "./views.js";
import type { Session } from "./session.js";
import { canvasId } from "../../shared/api.js";
import type { BoxDto, CoverageOverlayDto, DeckDto, OpenResult } from "../../shared/api.js";

export interface DeckCanvasContext {
  session: Session;
  actions: () => ViewActions;
  currentBox: () => BoxDto | undefined;
  /** The deck's selected cards, shared with its other two views. */
  selection: () => string[];
  selectCards: (ids: string[]) => void;
  /** Delete cards from one deck, through the guard (actions.ts). */
  deleteCards: (deckId: string, cardIds: string[]) => Promise<boolean>;
  applied: (r: OpenResult | { error: string }) => boolean;
  applyResult: (r: OpenResult) => void;
  refreshVc: () => void;
  renderCentre: () => void;
  comments: Comments;
  coverage: () => CoverageOverlayDto | undefined;
  setCoverageRefresh: (refresh: (() => void) | undefined) => void;
}

export type DeckCanvas = ReturnType<typeof createDeckCanvas>;

export function createDeckCanvas(ctx: DeckCanvasContext) {
  const { session } = ctx;
  const studio = session.studio;
  /** The live node-view canvas, held so the centre can tear it down: a Konva
   *  stage owns window listeners and an observer. */
  let nodeView: MountedNodeView | undefined;

  /** Fill a node-view container: fetch the deck's links, then mount the canvas. */
  function mount(host: HTMLElement, deck: DeckDto): void {
    void (async () => {
      // Konva is most of a megabyte unminified and only the canvas needs it, so
      // the node view is a separate chunk. That used to mean an editor session
      // never paid for a canvas it did not open; now that a deck opens on the
      // canvas it mostly will, and the chunk earns its keep by keeping Konva out
      // of the FIRST paint rather than out of the session.
      const [{ mountNodeView }, graph] = await Promise.all([
        import("./node-view.js"),
        studio.deckGraph(deck.id),
      ]);
      // The centre may have moved on while main was analysing (a click, a save,
      // a rebuild). Mounting into a detached container would leak a canvas that
      // nothing can reach.
      if (!host.isConnected) return;
      const actions = ctx.actions();
      const canvas = canvasId({ kind: "deck", deck: deck.id });
      nodeView?.destroy();
      nodeView = mountNodeView(host, deck, graph, ctx.selection(), {
        open: (cardId) => {
          const box = ctx.currentBox();
          if (box) actions.inspectCard(box.id, deck.id, cardId);
        },
        select: (cardIds) => ctx.selectCards(cardIds),
        setFurniture: (furniture, label, coalesce) => {
          const box = ctx.currentBox();
          if (!box) return;
          void (async () => {
            const result = await studio.setCanvasFurniture(
              box.id, { kind: "deck", deck: deck.id }, furniture, label, coalesce);
            if (!ctx.applied(result)) return;
            ctx.refreshVc();
            ctx.renderCentre();
          })();
        },
        duplicate: (cardId) => {
          const box = ctx.currentBox();
          if (box) actions.duplicateCard(box.id, deck.id, cardId);
        },
        remove: (cardId) => { void ctx.deleteCards(deck.id, [cardId]); },
        showLinks: (cardId) => actions.showLinks(cardId),
        addAt: (at, pinned) => {
          void (async () => {
            // One call, one commit, one undo step: the card and its position are
            // the same act, and pinning the others means nothing else shifts.
            const created = await studio.createCardOnCanvas(deck.id, at, pinned);
            if (!ok(created)) return;
            ctx.applyResult(created.result);
            noteMadeInDeck(created.cardId);
            ctx.selectCards([created.cardId]);
            ctx.renderCentre();
          })();
        },
        removeMany: (cardIds) => ctx.deleteCards(deck.id, cardIds),
        layOut: async (ids, current, size) => {
          const laid = await studio.layoutDeck(deck.id, ids, current, size);
          if (!ok(laid)) return undefined;
          ctx.applyResult(laid.result);
          ctx.refreshVc();
          return { positions: laid.positions, cycles: laid.cycles };
        },
        moved: (placements) => {
          void (async () => {
            const result = await studio.moveCardsOnCanvas(deck.id, placements);
            if (!ok(result)) return;
            // Deliberately NOT renderCentre(): the canvas already shows the move,
            // and rebuilding the centre would throw the canvas away mid-arranging,
            // losing the camera and the selection after every single drop.
            ctx.applyResult(result);
            // The sidecar changed on disk, so the version-control chip and badges
            // are now stale; the centre itself is not.
            ctx.refreshVc();
          })();
        },
        // --- comment markers (design/annotation.md 3) ------------------------
        //
        // Held by comments.ts rather than read from the project DTO, because a
        // marker carries more than a count: which kind it is, its badge and its
        // hover line, all resolved in main. Re-fetched after every change, and
        // repainted through the marker group alone so the canvas is not rebuilt.
        markers: () => ctx.comments.markers(),
        coverage: () => ctx.coverage(),
        coverageOn: () => session.state.coverageOverlay,
        openThread: (threadId, anchor) => ctx.comments.showThread(threadId, anchor, canvas),
        startThread: (at, item, anchor) => ctx.comments.startThread(canvas, at, item, anchor),
        moveMarker: (threadId, x, y, item) => ctx.comments.moveMarker(canvas, threadId, x, y, item),
        // Nothing locks the arranging: a deck's canvas is the AUTHOR's, and has
        // been since the map moved to a shard of its own (design/engine-server.md
        // 9.1 point 5; vc-view.ts says where that rule went).
      });
      // The canvas hands back its own marker and coverage repaints, so a refresh
      // does not have to know which canvas is mounted.
      ctx.setCoverageRefresh(() => nodeView?.refreshCoverage());
      ctx.comments.attach(canvas, {
        repaint: () => nodeView?.repaintMarkers(),
        openMarker: (id) => nodeView?.openMarker(id) ?? false,
      });
    })();
  }

  return {
    mount,
    /** The centre moved on: the canvas's element went with it, but not its
     *  window listeners or its ResizeObserver. */
    release(): void {
      nodeView?.destroy();
      nodeView = undefined;
    },
  };
}
