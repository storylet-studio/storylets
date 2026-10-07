// ---------------------------------------------------------------------------
// Comments: the one panel, the markers on a canvas, and the Review Feedback
// walk (design/annotation.md).
//
// The markers are held here rather than in either canvas, because both canvases
// want the same three things and neither should own them: the resolved marker
// list, the threads behind it, and one popover.
//
// The list is separate from the project DTO's `threads` counts on purpose. A
// count is enough for a document's bubble; a marker needs where it is, which
// kind it is, its badge and its hover line, all of which main resolves.
// ---------------------------------------------------------------------------

import { closeAnchoredPanel, el, openComments } from "@wildwinter/app-shell";
import { repaintBubbles, setDocTab } from "./inspector.js";
import { renderReviewBar } from "./views.js";
import { remember } from "./session.js";
import type { ViewActions } from "./views.js";
import type { Session } from "./session.js";
import { MAP_CANVAS, PROJECT_MAP_CANVAS_ID } from "../../shared/api.js";
import type { CommentDto, CommentMarkerDto, OpenResult, ReviewAt, ReviewItemDto } from "../../shared/api.js";

/** Settle checks before the walk gives up on finding a comment's bubble. At four
 *  frames apiece that is about a second: long enough for a card's catalogue to
 *  come back from main, short enough that a thread on something that has since
 *  gone does not hold the walk. */
const REVIEW_TRIES = 15;

const newThreadId = (): string => `cmt_${Math.random().toString(36).slice(2, 10)}`;

const frames = async (n: number): Promise<void> => {
  for (let frame = 0; frame < n; frame++) {
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  }
};

/** What a mounted canvas hands the comment machinery: its marker repaint, and
 *  its way of opening one marker for the feedback walk. They belong to the
 *  same view, so they are attached and detached together. */
export interface MarkerSurface {
  repaint: () => void;
  openMarker: (threadId: string) => boolean;
}

export interface CommentsContext {
  session: Session;
  applied: (r: OpenResult | { error: string }) => boolean;
  refreshVc: () => void;
  flushSaves: () => Promise<void>;
  /** The centre pane, whose bubbles a comment change repaints in place. */
  centre: () => HTMLElement;
  /** The views' actions: the walk opens the map and switches to node view. */
  actions: () => ViewActions;
  /** Navigate to where a comment lives (navigation.ts `goTo`). */
  goTo: (at: ReviewAt) => void;
}

export type Comments = ReturnType<typeof createComments>;

export function createComments(ctx: CommentsContext) {
  const { session } = ctx;
  const studio = session.studio;

  /** The markers on the canvas currently mounted, as main resolved them. */
  let markerList: CommentMarkerDto[] = [];
  /** Which canvas that list describes, so a late answer can be discarded. */
  let markerCanvas: string | undefined;
  /** The mounted canvas, so this machinery can refresh without knowing which
   *  of the two canvases it is talking to. */
  let surface: MarkerSurface | undefined;

  // The walk's state.
  let reviewItems: ReviewItemDto[] = [];
  let reviewAt = 0;
  const reviewbar = el("div", { className: "stepbar reviewbar" });
  // Hidden until the walk says otherwise. Without this it is an empty strip along
  // the bottom of a project nobody is reviewing: the bar carries the problems
  // bar's padding and border, so "no children" still draws a band.
  reviewbar.hidden = true;

  /** How many OPEN threads an item has, for its bubble. */
  const openThreads = (id: string): number => session.project?.threads?.[id] ?? 0;

  /**
   * Re-read a canvas's markers and repaint just them.
   *
   * Deliberately NOT a re-render of the document: that would throw the canvas
   * away, losing the camera and the selection, which is the same mistake the
   * card drag had to unlearn. The surface repaints its marker group alone.
   */
  async function refreshMarkers(canvas: string): Promise<void> {
    markerCanvas = canvas;
    const markers = await studio.commentMarkers(canvas);
    // The author may have navigated to another canvas while main was answering.
    if (markerCanvas !== canvas) return;
    markerList = markers;
    surface?.repaint();
  }

  /** Refresh whichever canvas is mounted, if any: a thread posted or resolved
   *  from a document's topline may also be a marker on the canvas behind. */
  async function refreshCurrentMarkers(): Promise<void> {
    if (markerCanvas !== undefined) await refreshMarkers(markerCanvas);
  }

  /**
   * Bring everything that shows a comment up to date after one changed: the
   * version-control badges (a comment is a write), the bubbles on the open page
   * (their counts come from the project DTO, repainted in place so the document
   * keeps its caret and scroll), the markers on a mounted canvas (the thread may
   * BE one, and a resolved one is drawn differently), and the review walk, which
   * a resolved thread leaves or joins depending on Show Resolved.
   */
  function afterComment(): void {
    ctx.refreshVc();
    repaintBubbles(ctx.centre(), openThreads);
    void refreshCurrentMarkers();
    void gatherReview();
  }

  /**
   * The comment panel, from any of its three doors: a document's topline bubble,
   * a marker on a canvas, or a place on a canvas where a new thread starts.
   *
   * `subjectId` is what a new message is filed against; `at` places a new
   * thread's marker on a canvas. A thread that does not exist yet (a fresh drop
   * on a canvas) cannot be resolved, and once its first message is posted the
   * panel closes: leaving an empty composer up reads as "that did not work", and
   * the marker now under it reopens it.
   */
  function commentPanel(opts: {
    anchor: HTMLElement; subject: string; threads: CommentDto[]; subjectId: string;
    at?: { canvas: string; x: number; y: number }; fresh?: boolean; prefer?: "centre";
  }): void {
    const fixedId = opts.fresh === true ? newThreadId() : undefined;
    openComments({
      anchor: opts.anchor, subject: opts.subject, threads: opts.threads,
      showResolved: session.state.showResolved,
      newThreadId: () => fixedId ?? newThreadId(),
      post: (threadId, body) => void (async () => {
        if (!ctx.applied(await studio.postComment(opts.subjectId, threadId, body, opts.at))) return;
        afterComment();
        if (opts.fresh === true) closeAnchoredPanel();
      })(),
      setResolved: opts.fresh === true
        ? () => { /* a thread that does not exist yet cannot be resolved */ }
        : (threadId, resolved) => void (async () => {
            if (!ctx.applied(await studio.setCommentResolved(threadId, resolved))) return;
            afterComment();
          })(),
      deleteMessage,
      ...(opts.prefer !== undefined ? { prefer: opts.prefer } : {}),
    });
  }

  /** A document's threads, from its topline bubble (or an outcome's). */
  function showComments(id: string, subject: string, anchor: HTMLElement): void {
    void (async () => {
      commentPanel({ anchor, subject, threads: await studio.commentsFor(id), subjectId: id });
    })();
  }

  /**
   * Withdraw one message, and put back whatever was showing it.
   *
   * Shared by all three places a thread can be read (a document's topline, a
   * canvas marker, the feedback walk). The panel closes either way: the thread
   * it was showing has changed underneath it, and a stale one is worse than a
   * reopen.
   */
  function deleteMessage(threadId: string, index: number): void {
    void (async () => {
      if (!ctx.applied(await studio.deleteComment(threadId, index))) return;
      closeAnchoredPanel();
      afterComment();
    })();
  }

  // --- the Review Feedback walk ----------------------------------------------
  //
  // Patterpad's walk, adopted whole: a looping bottom bar over every thread in
  // the project, F8 / Shift+F8, first press ENTERS the mode rather than stepping.
  //
  // The one thing it has to get right is that the list is gathered from DISK. A
  // thread posted a second ago may still be in a pending write, and a walk that
  // missed the comment you just made would be worse than no walk, so every entry
  // flushes first. That is Patterpad's rule and its comment says why.

  /** Re-read the walk's list and repaint its bar. Called on entry and after
   *  every comment mutation, so resolving an item drops it from the loop. */
  async function gatherReview(): Promise<void> {
    if (!session.state.reviewWalk) return;
    await ctx.flushSaves();
    reviewItems = session.project ? await studio.reviewFeedback(session.state.showResolved) : [];
    if (reviewAt >= reviewItems.length) reviewAt = 0;
    renderReviewWalk();
  }

  function renderReviewWalk(): void {
    renderReviewBar(reviewbar, reviewItems, reviewAt, session.state.reviewWalk,
      (next) => { reviewAt = next; renderReviewWalk(); void goToReview(reviewItems[next]); },
      (item) => void goToReview(item),
      () => setReviewWalk(false));
  }

  /**
   * Arrive at one comment: open what it is about, then its thread, in place.
   *
   * The waits are the same lesson Patterpad wrote down: the reveal has to finish
   * and lay out before the popover is anchored, or the panel is positioned
   * against an element that is still moving and lands somewhere else entirely.
   */
  async function goToReview(item: ReviewItemDto | undefined): Promise<void> {
    if (!item || !session.project) return;
    const actions = ctx.actions();
    const at = item.at;
    // A MARKER is a place on a canvas, so the canvas has to be the view that
    // comes up: arriving at the deck's card list and opening the thread off the
    // topline bubble answers "what was said" but throws away "where", which is
    // the only reason the comment was dropped there instead of filed against the
    // deck. The project map's canvas is its own page: a thread there is opened ON
    // the map, whatever it is anchored to (a site's thread is about a hand, but
    // its marker is on the map, which is where it was dropped).
    if (item.canvas === PROJECT_MAP_CANVAS_ID) {
      actions.focus({ kind: "map" });
      if (await openMarkerWhenMounted(item.thread)) return;
    }
    if (item.canvas !== undefined) {
      if (item.canvas.startsWith(MAP_CANVAS)) setDocTab(`box:${item.canvas.slice(MAP_CANVAS.length)}`, "map");
      // Through the action, so the switch is REMEMBERED. The walk really did
      // change which view of the deck is up, and an app that shows node view
      // while remembering cards contradicts itself on the next open.
      else if (session.state.viewMode !== "node") actions.setViewMode("node");
    }
    ctx.goTo(at);

    // A marker's thread is opened from the canvas, where the marker is: that is
    // the whole point of having put it there, and the view centres on it. It can
    // still fail (the canvas may not have mounted, or may be a different one),
    // and then the container's own bubble is the honest fallback rather than
    // nothing.
    if (item.canvas !== undefined && await openMarkerWhenMounted(item.thread)) return;
    // Everything else opens from the bubble in its document's topline, and the
    // bubble has to be THIS thread's. Opening a card loads its catalogue first,
    // so the document arrives some frames after the navigation, and a single
    // rAF anchored the popover to the OUTGOING document's bubble: it opened,
    // then the re-render removed the element under it and took the popover with it.
    const bubble = await bubbleFor(item.anchor);
    if (bubble) showComments(item.anchor, item.where, bubble);
  }

  /** Wait for the canvas to finish mounting, then open the marker on it.
   *
   * A canvas view fetches before it draws (the deck's links, the box's map), so
   * the surface that owns this marker does not exist for some frames after the
   * navigation. False when the wait runs out, and the caller falls back to the
   * container's own bubble rather than showing nothing. */
  async function openMarkerWhenMounted(thread: string): Promise<boolean> {
    for (let tries = 0; tries < REVIEW_TRIES; tries++) {
      if (surface?.openMarker(thread) === true) return true;
      await frames(4);
    }
    return false;
  }

  /** Wait for the comment bubble filed against `id`, up to a short deadline.
   *
   * Bounded rather than open-ended: if the document never arrives (a thread on
   * something that has since gone), the walk should move on quietly rather
   * than hold a promise open for the rest of the session. */
  async function bubbleFor(id: string): Promise<HTMLElement | undefined> {
    // LAID OUT, not merely present. The bubble exists for a frame before the
    // document it is in has any size, and anchoring the popover to a zero rect
    // put it in the top-left corner of the window instead of beside the bubble.
    const query = (): HTMLElement | null => {
      const found = document.querySelector<HTMLElement>(`.doc-thread[data-thread-for="${CSS.escape(id)}"]`);
      return found && found.getBoundingClientRect().width > 0 ? found : null;
    };
    // SETTLED, not just laid out. Opening a card renders it twice: once from the
    // navigation and again when its catalogue arrives from main. Anchoring to
    // the first bubble worked until the second render replaced the element, at
    // which point the popover had lost what it was pinned to and fell to the
    // corner of the window. The same element twice running means the document
    // has stopped rebuilding underneath us.
    let last: HTMLElement | null = null;
    for (let tries = 0; tries < REVIEW_TRIES; tries++) {
      const found = query();
      if (found !== null && found === last) return found;
      last = found;
      await frames(4);
    }
    return last ?? undefined;
  }

  /** Review ▸ Review Feedback. A remembered mode: entering gathers, leaving hides. */
  function setReviewWalk(on: boolean): void {
    void remember(session, "reviewWalk", on);
    if (on) { reviewAt = 0; void gatherReview(); } else { reviewItems = []; renderReviewWalk(); }
  }

  return {
    /** The walk's bar, mounted by the workspace above the problems bar. */
    reviewbar,
    openThreads,
    showComments,
    deleteMessage,

    /** The markers the mounted canvas draws. */
    markers: (): CommentMarkerDto[] => markerList,
    refreshMarkers,

    /** A canvas has mounted: draw `canvas`'s markers on it. */
    attach(canvas: string, view: MarkerSurface): void {
      surface = view;
      void refreshMarkers(canvas);
    },
    /** The canvas went. Clearing everything means a comment posted from a
     *  document's topline cannot repaint into a surface that has been
     *  destroyed, and a late `commentMarkers` answer for the old canvas is
     *  discarded rather than drawn onto the new one. */
    detach(): void {
      surface = undefined;
      markerCanvas = undefined;
      markerList = [];
    },

    /**
     * Open a marker's thread.
     *
     * The thread is fetched HERE rather than kept beside the marker list. A
     * marker needs only what it draws with; the conversation is wanted once,
     * when somebody clicks, so this is one round trip per open instead of one
     * per marker on every refresh.
     */
    showThread(threadId: string, anchor: HTMLElement, canvas: string): void {
      const marker = markerList.find((m) => m.id === threadId);
      if (!marker) return;
      const subject = marker.item ?? canvas;
      void (async () => {
        const threads = (await studio.commentsFor(subject)).filter((t) => t.id === threadId);
        commentPanel({ anchor, subject: marker.gist === "" ? "Comment" : marker.gist, threads, subjectId: subject });
      })();
    },

    /**
     * Start a thread at a place on a canvas.
     *
     * Nothing is written by the drop: this opens an empty composer, and the
     * thread exists only once a message is posted. That is the rule the whole
     * comment feature keeps, and it is why a mis-click costs nothing.
     *
     * The ANCHOR of the new thread is the item when it was dropped on one, and
     * the canvas itself otherwise: a comment about a card and a comment about a
     * place are different subjects, and the mark records only where it is drawn.
     */
    startThread(canvas: string, at: { x: number; y: number }, item: string | undefined, anchor: HTMLElement): void {
      commentPanel({
        anchor, subject: item === undefined ? "A comment here" : "A comment on this", threads: [],
        subjectId: item ?? canvas, at: { canvas, x: at.x, y: at.y }, fresh: true,
        // Centred on the click: this anchor is a POINT somebody chose, not a
        // control. Aligning an edge to it put the panel up and to the left of the
        // spot they pointed at, which read as the comment appearing somewhere else.
        prefer: "centre",
      });
    },

    /** A marker dragged to a new place on `canvas`: written, then the markers
     *  re-read, never the canvas rebuilt. */
    moveMarker(canvas: string, threadId: string, x: number, y: number, item: string | undefined): void {
      void (async () => {
        if (!ctx.applied(await studio.moveComment(threadId, canvas, x, y, item))) return;
        ctx.refreshVc();
        void refreshMarkers(canvas);
      })();
    },

    gatherReview,
    renderReviewWalk,
    setReviewWalk,
    /** A different project's comments: the walk starts again at its first. */
    restartReview(): void {
      reviewAt = 0;
      renderReviewWalk();      // paints, or hides, whichever the remembered mode says
      void gatherReview();
    },
    /** F8 / Shift+F8. The first press ENTERS the walk rather than stepping,
     *  which is Patterpad's behaviour: the key means "show me the feedback". */
    stepReview(delta: number): void {
      if (!session.state.reviewWalk) { setReviewWalk(true); return; }
      if (reviewItems.length === 0) return;
      reviewAt = (reviewAt + delta + reviewItems.length) % reviewItems.length;
      renderReviewWalk();
      // Land what is being typed before the walk moves the document away from it.
      void (async () => { await ctx.flushSaves(); await goToReview(reviewItems[reviewAt]); })();
    },
  };
}
