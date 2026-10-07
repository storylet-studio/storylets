// ---------------------------------------------------------------------------
// Live mode (design/live-link.md): the Board shows a connected game's run in
// place of its own session, observe-only. The run itself is rebuilt from the
// game's frames by live.ts; this is the mode around it - entering and leaving,
// which participant to follow, the "Watch it?" banner, and the read-only
// board and clocks.
// ---------------------------------------------------------------------------

import { el, iconNode } from "@wildwinter/app-shell";
import type { LiveLinkFrame, LiveLinkStatus } from "../../shared/api.js";
import { createLiveRun } from "./live.js";
import type { LiveRun } from "./live.js";
import { NO_MARKS } from "./run-marks.js";
import type { Board } from "./board-state.js";
import { handCell } from "./hand-cells.js";
import { activeFilters, matchesFilters } from "./box-nav.js";
import { revealCard } from "./session.js";

/** The run, wired to this bundle's labels (so a game's deals name their cards)
 *  and hand-to-box map (so a trace event is stamped with its box's clock). A
 *  card the running game knows that this bundle does not (the game is on a
 *  different build) still gets a face, named by its gameId. */
function ensureLiveRun(b: Board): LiveRun {
  const s = b.state;
  if (!s.liveRun) {
    s.liveRun = createLiveRun({
      handBox: (hand) => s.table?.hands().find((h) => h.gameId === hand)?.box,
      label: (id) => s.table?.label(id) ?? { gameId: id },
    });
  }
  return s.liveRun;
}

/** Enter Live mode: seed the run from whatever the game has sent so far (a
 *  Board opening mid-run has the table at once), then render the game. */
async function enterLive(b: Board): Promise<void> {
  const run = ensureLiveRun(b);
  run.reset();
  const snap = await b.studio.liveLinkSnapshot();
  // Follow whoever the server says we are following (the game's first flow
  // until somebody switches), seeded from that flow's last board so the table
  // is there at once.
  const followed = snap.status.state === "connected" ? snap.status.following : null;
  if (followed) run.follow(followed, snap.boards[followed]);
  for (const frame of snap.trace) run.apply(frame);
  b.state.liveMode = true;
  b.render();
}

/** Leave Live mode: the Board's own session was never touched, so it is just
 *  shown again. */
function leaveLive(b: Board): void {
  b.state.liveMode = false;
  b.render();
}

/** Main reports the link's state: a game connecting offers the banner again,
 *  and a game leaving puts the Board back on its own session. */
export function liveStatusChanged(b: Board, status: LiveLinkStatus): void {
  const s = b.state;
  s.liveStatus = status;
  if (status.state !== "connected") {
    s.liveBannerDismissed = false;   // a fresh connect offers the banner again
    if (s.liveMode) { leaveLive(b); return; }   // the game left: back to our own session
  }
  b.render();
}

/** A frame from the game: always folded into the run, drawn only in Live mode. */
export function liveFrame(b: Board, frame: LiveLinkFrame): void {
  const s = b.state;
  const applied = ensureLiveRun(b).apply(frame);
  if (!s.liveMode) return;   // kept up to date, but only shown in Live mode
  // Follow in the editor, in Live mode: the game deals a card, the editor opens
  // it (a play wins over a deal, being the more recent act). Never steals focus.
  if (s.follow) {
    const id = applied.played ?? applied.dealt[applied.dealt.length - 1];
    if (id !== undefined) revealCard(b, id);
  }
  b.render();
}

/** The Live / Local switch (the session strip). Offered whenever a game is
 *  connected, or while Live mode is on. */
export function liveSwitch(b: Board): HTMLElement | null {
  const s = b.state;
  if (s.liveStatus.state !== "connected" && !s.liveMode) return null;
  // Built ONCE: two calls made two <select> elements, with two change
  // listeners, on every render.
  const follow = followPicker(b);
  return el("div", { className: "seg viewswitch livemode" },
    el("button", {
      className: `seg-opt vbtn${s.liveMode ? " on" : ""}`, text: "Live",
      tip: "Watch the connected game's run",
      onClick: () => { if (!s.liveMode) void enterLive(b); },
    }),
    el("button", {
      className: `seg-opt vbtn${s.liveMode ? "" : " on"}`, text: "Local",
      tip: "Play your own session on the Board",
      onClick: () => { if (s.liveMode) leaveLive(b); },
    }),
    ...(follow ? [follow] : []));
}

/** Which participant the Board is watching, when the game is running more than
 *  one (design/live-link.md). One playhead pointed at one flow, switched here:
 *  a Board showing four runs at once shows none of them. Absent for a
 *  single-flow game, which is every ordinary one, so nothing new appears until
 *  a run actually has participants to choose between. */
function followPicker(b: Board): HTMLElement | null {
  const status = b.state.liveStatus;
  if (!b.state.liveMode || status.state !== "connected" || status.flows.length < 2) return null;
  const sel = el("select", { className: "vbtn liveflow" }) as HTMLSelectElement;
  // The themed rollover, as every other tip here: never a native `title`.
  sel.dataset["tip"] = "Which playthrough to watch";
  for (const id of status.flows) {
    const opt = el("option", { text: id }) as HTMLOptionElement;
    opt.value = id;
    if (id === status.following) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener("change", () => { void switchFollow(b, sel.value); });
  return sel;
}

/** Follow another participant: tell main, then re-seed the view from that
 *  flow's last board so their table is there at once rather than blank until
 *  they move. */
async function switchFollow(b: Board, flowId: string): Promise<void> {
  b.state.liveStatus = await b.studio.liveLinkFollow(flowId);
  const snap = await b.studio.liveLinkSnapshot();
  ensureLiveRun(b).follow(flowId, snap.boards[flowId]);
  for (const frame of snap.trace) ensureLiveRun(b).apply(frame);
  b.render();
}

/** "A game is connected. Watch it?", until dismissed or watched. */
export function liveBanner(b: Board): HTMLElement | null {
  const s = b.state;
  if (s.liveMode || s.liveBannerDismissed || s.liveStatus.state !== "connected") return null;
  return el("div", { className: "livebanner" },
    el("span", { className: "livebanner-msg", text: "A game is connected. Watch it?" }),
    el("button", { className: "btn primary livebanner-go", text: "Watch it", onClick: () => void enterLive(b) }),
    el("button", { className: "btn ghost icon livebanner-no", tip: "Dismiss", onClick: () => { s.liveBannerDismissed = true; b.render(); } }, iconNode("close")));
}

/** The turn dial in Live mode: read-only, from the game's `board.turns`. Every
 *  clock is the game's, so there is no Next turn here (the game advances time). */
export function liveTurnDial(b: Board): HTMLElement {
  const turns = Object.entries(b.state.liveRun?.turns ?? {});
  if (turns.length <= 1) {
    return el("div", { className: "dial" },
      el("span", { className: "caption", text: "Turn" }),
      el("span", { className: "dialnum", text: String(turns[0]?.[1] ?? 0) }));
  }
  return el("div", { className: "dial clocksdial" },
    el("div", { className: "clockshead" },
      el("span", { className: "caption", text: "Clocks", tip: "Every box keeps its own clock. The game advances them." })),
    el("div", { className: "clocks" },
      ...turns.map(([box, turn]) => el("span", { className: "clockrow" },
        el("span", { className: "clockbox", text: box }),
        el("span", { className: "clockval", text: String(turn) })))));
}

/** The board in Live mode: a cell per hand the game reports, its cards named by
 *  the gameIds the game sent. Hand metadata (title, tags) comes from the bundle
 *  where it is known; a hand the bundle does not have still shows, named by its
 *  gameId. Cards are not playable here (observe-only). */
export function liveCells(b: Board): HTMLElement {
  const s = b.state;
  const table = s.table;
  const cells = el("div", { className: "board" });
  const declared = table?.hands() ?? [];
  const active = activeFilters(s.filters);
  const entries = Object.entries(s.liveRun?.hands ?? {});
  let shown = 0;
  for (const [handGameId, cardGameIds] of entries) {
    const known = declared.find((h) => h.gameId === handGameId);
    // Filter by the hand's declared tags where we know them; a hand the bundle
    // does not know is always shown (we cannot say it does not match).
    if (known && !matchesFilters(known.tags, active)) continue;
    const hand = known ?? { gameId: handGameId, tags: {} as Record<string, string> };
    const faces = table ? cardGameIds.map((g) => table.faceByGameId(g, handGameId)) : cardGameIds.map((g) => ({ id: g, gameId: g, from: handGameId }));
    // No run marks here: they are the local session's, not the game's.
    cells.append(handCell(b, hand, faces, NO_MARKS));
    shown++;
  }
  if (shown === 0) {
    cells.append(el("span", { className: "empty", text: entries.length === 0 ? "The game hasn't dealt anything yet." : "No hands match these filters." }));
  }
  return cells;
}
