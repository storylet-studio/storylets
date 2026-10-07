// ---------------------------------------------------------------------------
// The Board's state, owned in one place. Every part of the window (the session
// strip, the box navigator, the map stage, Live mode, the rail and its panels,
// the head) reads and writes this one object through the context it is handed,
// rather than a module-level variable of its own; table.ts makes it once.
//
// Beside it, the readings derived from it that more than one part needs: which
// maps the view is showing, and whether that makes it a List or a Map.
// ---------------------------------------------------------------------------

import { el } from "@wildwinter/app-shell";
import type { Performance } from "@storylet-studio/with-patter";
import type { DebugLink } from "@patterkit/play-helpers";
import type { BoxMapDto, LiveLinkStatus, ProjectMapDto, StudioApi } from "../../shared/api.js";
import type { BoardLogEntry, BoardSaveFile, DealtView, LogEntry, Table } from "./model.js";
import type { LiveRun } from "./live.js";
import type { MountedBoardMap } from "./board-map.js";
import { runMarks } from "./run-marks.js";
import type { RunMarks } from "./run-marks.js";
import { trackSockets } from "./patter-socket.js";
import type { SocketTracker } from "./patter-socket.js";

/** What every part of the Board is handed: the bridge to main, the state, and
 *  the way to draw the window again. */
export interface Board {
  readonly studio: StudioApi;
  readonly state: BoardState;
  /** Draw the window again (table.ts: the head stays, the rest is rebuilt). */
  render(): void;
}

export interface BoardState {
  // --- the session ---------------------------------------------------------------
  table: Table | undefined;
  seed: number;
  name: string;
  /** What `projectHash()` returns while the built bundle is current (tableBundle's `stamp`). */
  builtStamp: string;
  /** No project is open: the Board says so, and how to fix it, where the table
   *  would be. */
  noProject: boolean;
  /** Why the project would not build or play: shown where the table would be. */
  loadError: string;
  /** A play or a restore that failed: shown under the board until the next thing
   *  done succeeds. Apart from `loadError`, which only a rebuild clears. */
  runError: string;
  /** Set once the project has changed under a running session (out of date):
   *  "edit" for an edit to the same project, "project" when another one was
   *  opened, or the project closed. */
  stale: "edit" | "project" | "closed" | undefined;
  /** How long the journal was once the board was dealt: the opening deal is the
   *  curtain going up, not something the author did, so it puts nothing at
   *  stake. A restore sets it to 0, since a restored position is the author's. */
  openedAt: number;
  /** True while a confirm is up: Escape belongs to the dialog, not the layers. */
  asking: boolean;

  // --- the board and the card in play ----------------------------------------------
  board: { hand: string; cards: DealtView[] }[];
  /** Board filters: tag group -> tag ("" = any). */
  filters: Record<string, string>;
  /** The open card: its id and the hand it sits in. */
  open: { card: string; hand: string } | undefined;
  /** The chosen-but-uncommitted outcome (the two-step commit). */
  pending: string | undefined;
  /** The open card's Patter scene, while the Board performs it (performance.ts). Keyed to the card:
   *  a different open card starts its own. */
  performing: Performance | undefined;
  /** One-shot: focus Continue after the render that shows the confirm step. */
  focusPending: boolean;
  /** Where this run has been: the live position and its trail (run-marks.ts).
   *  Marking, never navigating: the editor's selection is nobody's business here. */
  marks: RunMarks;
  /** The selected hand, the same in both views: whose cards the map's float
   *  shows, and whose latest deal the Why not? tab explains. Chosen by clicking
   *  a hand's name or its pin, or by opening one of its cards. */
  selectedHand: string | undefined;
  /** Hands changed by the LAST board refresh (a play or a turn): the pulse and
   *  the box-header badges. Replaced by the next refresh, cleared on rebuild -
   *  no memory to manage (design/board-ripple.md). */
  pulsed: ReadonlySet<string>;
  /** Bumped whenever `pulsed` is replaced with a non-empty set: the map's pulse
   *  clock (it cannot diff a function, so it watches this). */
  pulseStamp: number;

  // --- snapshots -------------------------------------------------------------------
  snapPanel: "save" | "restore" | undefined;
  snapshots: { name: string; file: BoardSaveFile }[];
  /** The project the snapshots were taken in (the bundle's own name for it): a
   *  build of another project starts with none, since its engine would refuse
   *  every one of them. A new build of the same project keeps them, and a restore
   *  says what the save cost against it (loadReportNote). */
  snapshotsOf: string | undefined;

  // --- the rail --------------------------------------------------------------------
  /** Journal kinds hidden by the filter chips (empty = the full story). */
  journalHidden: Set<LogEntry["type"]>;
  /** The rail's open tab: the record (journal), the state (the old curtain), or
   *  why the selected hand's near misses did not come up. */
  railTab: "journal" | "state" | "why";
  /** What the list and the rail panel were showing at the last render, so a
   *  render that only changes what is in them keeps their scroll (selecting a
   *  hand or opening a card low in the list used to throw the reader back to the
   *  top), while moving to another box, view, tab or hand starts at the top. */
  scrollKeys: { list: string; panel: string };

  // --- boxes, views and maps ---------------------------------------------------------
  /** List or Map: two ways of looking at the same board, exactly as Node is a
   *  view of a deck. Map is only offered when the project has one. */
  view: "list" | "map";
  /** Every spatial group in the project. The bundle cannot say (geometry is
   *  source-only), so main is asked at build time. */
  maps: ProjectMapDto[];
  mapPick: number;
  mapData: BoxMapDto | undefined;
  /** The box navigator's selection: a box gameId, or undefined for Everything
   *  (the all-boxes list). Session-local, like the open card. */
  boxSel: string | undefined;
  /** The persisted box choice ("" = Everything, undefined = never chose), seeded
   *  from the store at boot and kept fresh by every pick, so a restart lands on
   *  the latest choice rather than the boot-time one. */
  rememberedBox: string | undefined;
  /** The canvas host, kept ACROSS renders: rebuilding a Konva stage every time the
   *  board redraws would throw away the camera on every play. */
  readonly mapHost: HTMLElement;
  mapView: MountedBoardMap | undefined;
  /** Which map the stage last showed (box, pick, group), so another one refits. */
  mapKey: string;

  // --- following in the editor -------------------------------------------------------
  /**
   * Does the EDITOR follow the run? Off by default and remembered.
   *
   * The Board marks rather than navigates (graphical-views 2): a playthrough
   * leaves a running-position mark and never moves the author's selection, because
   * an editor jumping under you mid-run is the disruption that rule exists to
   * avoid. This is the opt-in for the other way of working - reading the card you
   * just played, in the editor, while you play - and it is the author's choice to
   * make rather than ours.
   *
   * Named "Follow in the editor", not "Follow": the Links window's Follow means
   * THIS WINDOW follows the editor, and this is the opposite direction. Same word
   * with the arrow reversed would be worse than a longer label.
   */
  follow: boolean;

  // --- Live Link (design/live-link.md) -----------------------------------------------
  /** The link's state, as main last reported it. */
  liveStatus: LiveLinkStatus;
  /**
   * Live mode: the Board shows the connected game's run instead of its own.
   *
   * Observe-only (the game is in control): the session's own controls (Deal,
   * Next turn, playing a card, the raw-state editor, seed, Save state, Restore,
   * Restart) are disabled or hidden, and the hands, the journal and "Not listed ·
   * why" come from the game's frames. Leaving it (the link drops, or Local)
   * restores the Board's own session, untouched underneath.
   */
  liveMode: boolean;
  /** The game's run, while one is connected: filled from `board` snapshots and
   *  the `trace` stream. Kept across a mode switch so Local -> Live is instant. */
  liveRun: LiveRun | undefined;
  /** The "A game is connected. Watch it?" banner is dismissed until the next
   *  connect, so an author who chose Local is not nagged. */
  liveBannerDismissed: boolean;

  // --- Patterpad's Live Link (patterpad.ts) ------------------------------------------
  patterLink: DebugLink | undefined;
  /** The last scenes Patterpad pushed, kept across a rebuild (Restart, a stale refresh): Patterpad
   *  pushes on every save and every publish, so the last push is never older than the published
   *  bundle the rebuild reads, and dropping it would put the Board back on older lines. */
  latestPatterPush: string | undefined;
  patterRetry: ReturnType<typeof setInterval> | undefined;
  /** The WebSocket the link is made with, tracked so the Board knows when to try
   *  again: by the LATEST socket alone (patter-socket.ts), since an old link's
   *  close lands after its replacement has opened. */
  readonly patterSockets: SocketTracker<typeof WebSocket>;
}

/** The state of a Board that has not built anything yet. */
export function createBoardState(): BoardState {
  return {
    table: undefined, seed: 0, name: "", builtStamp: "",
    noProject: false, loadError: "", runError: "", stale: undefined, openedAt: 0, asking: false,
    board: [], filters: {}, open: undefined, pending: undefined, performing: undefined, focusPending: false,
    marks: runMarks(), selectedHand: undefined, pulsed: new Set(), pulseStamp: 0,
    snapPanel: undefined, snapshots: [], snapshotsOf: undefined,
    journalHidden: new Set(), railTab: "journal", scrollKeys: { list: "", panel: "" },
    view: "list", maps: [], mapPick: 0, mapData: undefined, boxSel: undefined, rememberedBox: undefined,
    mapHost: el("div", { className: "boardmap" }), mapView: undefined, mapKey: "",
    follow: false,
    liveStatus: { state: "off" }, liveMode: false, liveRun: undefined, liveBannerDismissed: false,
    patterLink: undefined, latestPatterPush: undefined, patterRetry: undefined,
    patterSockets: trackSockets(WebSocket),
  };
}

/** Replace the changed hands, ticking the map's pulse clock when any changed. */
export function setPulsed(s: BoardState, next: ReadonlySet<string>): void {
  s.pulsed = next;
  if (next.size > 0) s.pulseStamp++;
}

/** The journal's source: the game's run in Live mode, our own session
 *  otherwise. */
export function activeLog(s: BoardState): readonly BoardLogEntry[] {
  return s.liveMode && s.liveRun ? s.liveRun.log : (s.table?.log ?? []);
}

// --- which maps the view shows ---------------------------------------------------------

/** The SHARED SPACES: maps stamped as one place carried by several boxes
 *  (design/playable-maps.md, the author's ruling that they should feel like
 *  the same space). Everything draws a space once, every member's pins on it
 *  - which also answers the review's "ripples land off-stage": the news
 *  screens ring on the same picture the contract was played on. */
export function spaceList(maps: readonly ProjectMapDto[]): ProjectMapDto[][] {
  const byIdx = new Map<number, ProjectMapDto[]>();
  for (const m of maps) {
    if (m.space === undefined) continue;
    const list = byIdx.get(m.space) ?? [];
    list.push(m);
    byIdx.set(m.space, list);
  }
  return [...byIdx.values()].filter((list) => list.length > 1);
}

/** What the map view is showing: a box's own maps (a map belongs to a box; the
 *  nav picks the box), or (on Everything) the first member of each shared
 *  space. */
export function mapChoices(maps: readonly ProjectMapDto[], boxSel: string | undefined): ProjectMapDto[] {
  return boxSel !== undefined ? maps.filter((m) => m.boxGameId === boxSel) : spaceList(maps).map((list) => list[0]!);
}

export const currentMapChoices = (s: BoardState): ProjectMapDto[] => mapChoices(s.maps, s.boxSel);
export const currentPick = (s: BoardState): ProjectMapDto | undefined => currentMapChoices(s)[s.mapPick];

/** What actually shows: a box with a map, or Everything with a shared space,
 *  honours the remembered List|Map preference; anything else is the list. */
export const effectiveView = (s: BoardState): "list" | "map" => (currentMapChoices(s).length > 0 ? s.view : "list");
