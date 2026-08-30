// ---------------------------------------------------------------------------
// The Board window: the game, played by hand. The author sits in the
// player's chair: explore the dealt hands on the board (filtered by tag),
// pick a card, read its outcomes, play one and watch the world change; time
// passes on the turn dial. The journal keeps the story of the session
// (deals, plays, property changes, turns); snapshots save and restore the
// whole game. Everything diagnostic - the stock peek, why-not reasons, the
// raw state - waits behind the curtain. You never play a card from inside
// the deck (schema 3.1): plays come from hands on the board.
// ---------------------------------------------------------------------------

import "../src/theme.css";
import "./table.css";
import "@wildwinter/app-shell/tooltip.css";
import { applyTheme } from "../src/theme.js";
import { toolWindowHead } from "../src/tool-window-head.js";
import { el } from "../src/dom.js";
import { initTooltips, icon, staleBar } from "@wildwinter/app-shell";
import { confirmDialog } from "../src/confirm.js";
import { colourIndex } from "../../shell/colour.js";
import { Table, coerceStateInput, diffBoards, journalPlan } from "./model.js";
import { runMarks } from "./run-marks.js";
import { createLiveRun } from "./live.js";   // Live Link: the game's run, rebuilt from its frames
import type { LiveRun } from "./live.js";
import type { BoardLogEntry, DealtView, LogEntry, NotDealt } from "./model.js";
import type { SaveFile } from "@storylet-studio/model";
import type { BoxMapDto, LiveLinkStatus, ProjectMapDto, StudioApi } from "../../shared/api.js";
import type { MountedBoardMap } from "./board-map.js";

declare global { interface Window { studio: StudioApi; } }
const studio = window.studio;

const root = document.getElementById("table")!;
let table: Table | undefined;
let seed = 0;
let name = "";
/** Board filters: tag group -> tag ("" = any). */
const filters: Record<string, string> = {};
/** The open card: its id and the hand it sits in. */
let open: { card: string; hand: string } | undefined;
/** The chosen-but-uncommitted outcome (the two-step commit). */
let pending: string | undefined;
/** One-shot: focus Continue after the render that shows the confirm step. */
let focusPending = false;
let board: { hand: string; cards: DealtView[] }[] = [];
let snapPanel: "save" | "restore" | undefined;
let snapshots: { name: string; file: SaveFile }[] = [];
/** Journal kinds hidden by the filter chips (empty = the full story). */
const journalHidden = new Set<LogEntry["type"]>();
/** The rail's open tab: the record (journal) or the state (the old curtain). */
let railTab: "journal" | "state" = "journal";
/** State-tab state (the diagnostic surfaces). */
let peekBox = "";
const criteria: Record<string, string> = {};
let peeked: DealtView[] = [];
let notDealt: NotDealt[] = [];
/** When the last peek was taken: the box, its clock, and the log's last seq -
 *  so a listing the session has moved past can say so instead of standing
 *  there looking fresh (the antagonist review's stale-peek finding). */
let peekStamp: { box: string; clock: number; lastSeq: number } | undefined;
let loadError = "";
/** Where this run has been: the live position and its trail (run-marks.ts).
 *  Marking, never navigating: the editor's selection is nobody's business here. */
const marks = runMarks();
/** List or Map: two ways of looking at the same board, exactly as Node is a
 *  view of a deck. Map is only offered when the project has one. */
let view: "list" | "map" = "list";
/** Every spatial group in the project. The bundle cannot say (geometry is
 *  source-only), so main is asked at build time. */
let maps: ProjectMapDto[] = [];
let mapPick = 0;
/** The box navigator's selection: a box gameId, or undefined for Everything
 *  (the all-boxes list). Session-local, like the open card. */
let boxSel: string | undefined;
/** The persisted box choice ("" = Everything, undefined = never chose), seeded
 *  from the store at boot and kept fresh by every pick, so a restart lands on
 *  the latest choice rather than the boot-time one. */
let rememberedBox: string | undefined;
/** The selected box's maps (a map belongs to a box; the nav picks the box). */
const boxMaps = (): typeof maps => (boxSel === undefined ? [] : maps.filter((m) => m.boxGameId === boxSel));
/** The SHARED SPACES: maps stamped as one place carried by several boxes
 *  (design/playable-maps.md, the author's ruling that they should feel like
 *  the same space). Everything draws a space once, every member's pins on it
 *  - which also answers the review's "ripples land off-stage": the news
 *  screens ring on the same picture the contract was played on. */
const spaceList = (): (typeof maps)[] => {
  const byIdx = new Map<number, typeof maps>();
  for (const m of maps) {
    if (m.space === undefined) continue;
    const list = byIdx.get(m.space) ?? [];
    list.push(m);
    byIdx.set(m.space, list);
  }
  return [...byIdx.values()].filter((list) => list.length > 1);
};
/** What the map view is showing: a box's own maps, or (on Everything) the
 *  first member of each shared space. */
const mapChoices = (): (typeof maps) => (boxSel !== undefined ? boxMaps() : spaceList().map((list) => list[0]!));
const currentPick = (): (typeof maps)[number] | undefined => mapChoices()[mapPick];
/** What actually shows: a box with a map, or Everything with a shared space,
 *  honours the remembered List|Map preference; anything else is the list. */
const effectiveView = (): "list" | "map" => (mapChoices().length > 0 ? view : "list");
let mapData: BoxMapDto | undefined;
/** The hand whose cards the side column is showing, in map mode. */
let onMap: string | undefined;
/** Hands changed by the LAST board refresh (a play or a turn): the pulse and
 *  the box-header badges. Replaced by the next refresh, cleared on rebuild -
 *  no memory to manage (design/board-ripple.md). */
let pulsed: ReadonlySet<string> = new Set();
/** Bumped whenever `pulsed` is replaced with a non-empty set: the map's pulse
 *  clock (it cannot diff a function, so it watches this). */
let pulseStamp = 0;
function setPulsed(next: ReadonlySet<string>): void {
  pulsed = next;
  if (next.size > 0) pulseStamp++;
}
/** The canvas host, kept ACROSS renders: rebuilding a Konva stage every time the
 *  board redraws would throw away the camera on every play. */
const mapHost = el("div", { className: "boardmap" });
let mapView: MountedBoardMap | undefined;
/** True once the project has changed under a running session (out of date). */
let stale = false;
/** Always-on-top over the editor (Patterpad's Play pin); remembered. */
let pinned = true;
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
let follow = false;

// --- Live Link (design/live-link.md) -------------------------------------------
/** The link's state, as main last reported it. */
let liveStatus: LiveLinkStatus = { state: "off" };
/**
 * Live mode: the Board shows the connected game's run instead of its own.
 *
 * Observe-only (the game is in control): the session's own controls (Deal,
 * Next turn, playing a card, the raw-state editor, seed, Save state, Restore,
 * Restart) are disabled or hidden, and the hands, the journal and "Not listed ·
 * why" come from the game's frames. Leaving it (the link drops, or Local)
 * restores the Board's own session, untouched underneath.
 */
let liveMode = false;
/** The game's run, while one is connected: filled from `board` snapshots and
 *  the `trace` stream. Kept across a mode switch so Local -> Live is instant. */
let liveRun: LiveRun | undefined;
/** The "A game is connected. Watch it?" banner is dismissed until the next
 *  connect, so an author who chose Local is not nagged. */
let liveBannerDismissed = false;


async function build(): Promise<void> {
  const result = await studio.tableBundle();
  if ("error" in result) { loadError = result.error; table = undefined; render(); return; }
  loadError = "";
  name = result.name;
  table = new Table(result.bundle, seed);
  peekBox = table.boxes()[0]?.gameId ?? "";
  for (const k of Object.keys(criteria)) delete criteria[k];
  for (const k of Object.keys(filters)) delete filters[k];
  open = undefined; pending = undefined; snapPanel = undefined;
  peeked = []; notDealt = []; peekStamp = undefined;
  stale = false;   // this bundle is fresh as of now
  marks.reset();   // a new run: nowhere has been anywhere yet
  board = table.dealAll();   // the game starts with the board dealt
  setPulsed(new Set());        // an opening deal is a curtain up, not a ripple
  onMap = undefined;
  maps = await studio.projectMaps();
  if (maps.length === 0) view = "list";
  // The remembered box wins when it still exists in this bundle ("" is an
  // explicitly chosen Everything). Never chose: "a project with a map opens
  // on the Map" - the nav starts on the first box that has one when the
  // remembered preference is map; otherwise Everything.
  if (rememberedBox === "") boxSel = undefined;
  else if (rememberedBox !== undefined && table.boxes().some((b) => b.gameId === rememberedBox)) boxSel = rememberedBox;
  // Never chose: a project with a map opens on the Map - on EVERYTHING when
  // the boxes share a space (the whole world at once), else the first
  // mapped box.
  else if (view === "map" && maps.length > 0) boxSel = maps.some((m) => m.space !== undefined) ? undefined : maps[0]!.boxGameId;
  else boxSel = undefined;
  mapPick = 0;
  render();
  void loadMap();
}

/**
 * Fetch the chosen map's geometry.
 *
 * Read once per session build rather than live: the Board plays a COMPILED
 * bundle, so its map should be the map as it was when that bundle was made. An
 * author editing zones while a session runs gets the same answer as an author
 * editing anything else - the out-of-date bar, and a restart.
 */
async function loadMap(): Promise<void> {
  const pick = currentPick();
  if (!pick) { mapData = undefined; return; }
  if (boxSel === undefined) {
    // Everything: the shared space, drawn once - the first member's geometry
    // and furniture, EVERY member's placed hands. The members' zones are
    // identical by the space's own definition.
    const members = spaceList()[mapPick] ?? [];
    const parts = await Promise.all(members.map((m) => studio.boxMap(m.box, m.group)));
    const first = parts[0];
    mapData = first === undefined ? undefined : { ...first, sites: parts.flatMap((p) => p.sites) };
  } else {
    mapData = await studio.boxMap(pick.box, pick.group);
  }
  if (effectiveView() === "map") render();
}

// Out of date: the project changed since this session was built. Checked when
// the window regains focus (you leave the Board to edit, then come back).
async function checkStale(): Promise<void> {
  if (!table || stale) return;
  const hash = await studio.projectHash();
  if (hash && hash !== table.bundle.content.hash) { stale = true; render(); }
}

// A different project was opened underneath the Board: this table is dealing a
// game from a bundle nobody has open any more. Say so at once rather than
// waiting for the focus check, which was only ever about EDITS to the same one.
studio.onProjectChanged(() => { if (table) { stale = true; render(); } });

// --- Live Link ------------------------------------------------------------------
/** The run, wired to this bundle's labels (so a game's deals name their cards)
 *  and hand-to-box map (so a trace event is stamped with its box's clock). A
 *  card the running game knows that this bundle does not (the game is on a
 *  different build) still gets a face, named by its gameId. */
function ensureLiveRun(): LiveRun {
  if (!liveRun) {
    liveRun = createLiveRun({
      handBox: (hand) => table?.hands().find((h) => h.gameId === hand)?.box,
      label: (id) => table?.label(id) ?? { gameId: id },
    });
  }
  return liveRun;
}

/** Enter Live mode: seed the run from whatever the game has sent so far (a
 *  Board opening mid-run has the table at once), then render the game. */
async function enterLive(): Promise<void> {
  const run = ensureLiveRun();
  run.reset();
  const snap = await studio.liveLinkSnapshot();
  // Follow whoever the server says we are following (the game's first flow
  // until somebody switches), seeded from that flow's last board so the table
  // is there at once.
  const followed = snap.status.state === "connected" ? snap.status.following : null;
  if (followed) run.follow(followed, snap.boards[followed]);
  for (const frame of snap.trace) run.apply(frame);
  liveMode = true;
  render();
}

/** Leave Live mode: the Board's own session was never touched, so it is just
 *  shown again. */
function leaveLive(): void {
  liveMode = false;
  render();
}

studio.onLiveLinkStatus((status) => {
  liveStatus = status;
  if (status.state !== "connected") {
    liveBannerDismissed = false;   // a fresh connect offers the banner again
    if (liveMode) { leaveLive(); return; }   // the game left: back to our own session
  }
  render();
});

studio.onLiveLinkFrame((frame) => {
  const run = ensureLiveRun();
  const applied = run.apply(frame);
  if (!liveMode) return;   // kept up to date, but only shown in Live mode
  // Follow in the editor, in Live mode: the game deals a card, the editor opens
  // it (a play wins over a deal, being the more recent act). Never steals focus.
  if (follow) {
    const id = applied.played ?? applied.dealt[applied.dealt.length - 1];
    const home = id !== undefined ? table?.home(id) : undefined;
    if (home) void studio.searchReveal({ kind: "card", box: home.box, deck: home.deck, card: home.card });
  }
  render();
});

// --- actions -----------------------------------------------------------------
function redeal(): void {
  if (!table) return;
  board = table.dealAll();
  // The open card may have left its hand; the board is the truth.
  if (open && !board.some((h) => h.hand === open!.hand && h.cards.some((c) => c.id === open!.card))) {
    open = undefined; pending = undefined;
  }
  render();
}

/** The world moved: refresh the whole board and pulse what changed. */
function refreshBoard(): void {
  if (!table) return;
  const before = board;
  board = table.dealAll();
  setPulsed(diffBoards(before, board));
}

function playPending(): void {
  if (!table || !open || !pending) return;
  try {
    table.play(open.card, pending, open.hand);
    // The running position, recorded before `open` is cleared: this hand is
    // where we are, and this card has now been seen for the rest of the run.
    marks.played(open.hand, open.card);
    // Follow: open what was just played, in the editor. Never steals focus (main
    // sends the editor a message; it does not raise the window), so the Board
    // stays under the hand that is playing.
    if (follow) {
      const home = table.home(open.card);
      if (home) void studio.searchReveal({ kind: "card", box: home.box, deck: home.deck, card: home.card });
    }
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }
  open = undefined; pending = undefined;
  refreshBoard();   // the world moved: the whole board refreshes
  render();
}

function nextTurn(): void {
  if (!table) return;
  table.nextTurn();
  refreshBoard();   // time passed: cooldowns lapse, hands refresh
  render();
}

function restart(): void {
  // Elide the dialog when nothing is at stake: an untouched session restarts silently.
  if (!table || table.log.length === 0) { void build(); return; }
  void confirmDialog({
    title: "Restart the game?",
    body: "The session and its journal are discarded.",
    confirmLabel: "Restart",
  }).then((ok) => { if (ok) void build(); });
}

function peek(): void {
  if (!table) return;
  const bound = Object.fromEntries(Object.entries(criteria).filter(([, v]) => v !== ""));
  try {
    const r = table.peek(peekBox, bound);
    peeked = r.dealt; notDealt = r.notDealt;
    peekStamp = { box: peekBox, clock: table.turn(peekBox), lastSeq: table.log[table.log.length - 1]?.seq ?? -1 };
  }
  catch (e) { loadError = e instanceof Error ? e.message : String(e); }
  render();
}

// --- little pieces -------------------------------------------------------------
const chip = (text: string): HTMLElement => {
  const dot = el("i");
  dot.style.background = `var(--char-${colourIndex(text)})`;
  return el("span", { className: "chip" }, dot, text);
};

/** Union of tag groups across boxes, for the board filter bar. */
function filterGroups(): { gameId: string; values: string[] }[] {
  const out = new Map<string, Set<string>>();
  for (const box of table!.boxes()) {
    for (const g of box.groups) {
      const set = out.get(g.gameId) ?? new Set<string>();
      for (const v of g.values) set.add(v);
      out.set(g.gameId, set);
    }
  }
  return [...out.entries()].map(([gameId, values]) => ({ gameId, values: [...values] }));
}

// --- the journal -----------------------------------------------------------------
const quote = (label: { gameId: string; title?: string }): string => label.title ?? label.gameId;

/** Are stamps box-qualified? Only where drift can exist: a multi-box project.
 *  A single box keeps the bare T-number the qualification would only bloat. */
const stampBoxes = (): boolean => (table?.boxes().length ?? 0) > 1;

/** The box a journal entry belongs to, as the gameId the clocks speak. */
function entryBoxName(entry: BoardLogEntry): string | undefined {
  if (!table) return undefined;
  switch (entry.type) {
    case "deal":
    case "evict":
      return table.hands().find((h) => h.gameId === entry.hand || h.id === entry.hand)?.box;
    case "play":
      return table.boxOf(entry.card);
    case "turns":
      return entry.box;
    default:
      return undefined;
  }
}

/** The stamp: "contracts 4" in a multi-box project (clocks forward, design/
 *  board-legibility.md piece 4 - bare T-numbers from different clocks read as
 *  time travel), "T4" where only one clock exists. */
function stampOf(entry: BoardLogEntry): string {
  const turn = "turn" in entry && entry.turn !== undefined ? entry.turn : undefined;
  if (turn === undefined) return "";
  if (!stampBoxes()) return `T${turn}`;
  const box = entryBoxName(entry);
  return box !== undefined ? `${box} ${turn}` : `T${turn}`;
}

function journalRow(entry: BoardLogEntry): HTMLElement | null {
  const row = (kind: string, cls: string, ...payload: (Node | string)[]): HTMLElement =>
    el("div", { className: `jrow ${cls}` },
      el("span", { className: "jt", text: stampOf(entry) }),
      el("span", { className: "jk", text: kind }),
      el("span", { className: "jp" }, ...payload));
  switch (entry.type) {
    case "deal": {
      const dealt = entry.cards.filter((c) => c.verdict === "dealt");
      if (dealt.length === 0) return null;   // a quiet refresh is not a story beat
      return row("dealt", "j-deal", `${dealt.map((c) => `“${quote(table!.label(c.id))}”`).join(", ")} → ${entry.hand}`);
    }
    case "play":
      return row("played", "j-play", `“${quote(table!.label(entry.card))}” → ${entry.outcome}`);
    case "write":
      return row("wrote", "j-write", `${entry.target} ${entry.prev !== undefined ? `${JSON.stringify(entry.prev)} → ` : ""}${JSON.stringify(entry.value)}`);
    case "evict":
      return row("left", "j-evict", `“${quote(table!.label(entry.card))}” (${entry.reason})`);
    case "turns":
      return row("turn", "j-turn", `${entry.box} advances to ${entry.turn}`);
    case "peek":
      return null;   // looking is not a story beat (the look/use rule)
    case "diagnostic":
      return row("⚠", "j-warn", `${entry.where}: ${entry.message}`);
    case "meddle":
      return row("meddled", "j-meddle", `${entry.label} ${entry.prev !== undefined ? `${JSON.stringify(entry.prev)} → ` : ""}${JSON.stringify(entry.value)}`);
  }
}

/** The journal's source: the game's run in Live mode, our own session
 *  otherwise. */
function activeLog(): readonly BoardLogEntry[] {
  return liveMode && liveRun ? liveRun.log : (table?.log ?? []);
}

function journalText(): string {
  // Copy takes what you see: the same plan the journal renders (piece 3 of
  // design/board-legibility.md), with the filter chips applied.
  const full = activeLog();
  const plan = journalPlan(full, (i) => (table ? table.rippleFor(full, i) : []), table?.boxes().length ?? 0);
  const handName = (h: string): string =>
    table?.hands().find((x) => x.gameId === h || x.id === h)?.gameId ?? h;
  const lines: string[] = [];
  for (const item of plan) {
    if (item.kind === "play") {
      if (journalHidden.has("play")) continue;
      const base = journalTextLine(item.entry);
      if (base !== null) lines.push(base);
      if (!journalHidden.has("write")) {
        for (const w of item.writes) {
          lines.push(`\twrote\t${w.target} ${w.prev !== undefined ? `${JSON.stringify(w.prev)} -> ` : ""}${JSON.stringify(w.value)}`);
        }
      }
      for (const r of item.ripple) {
        lines.push(r.kind === "dealt"
          ? `\tand so\t${quote(table!.label(r.card))} -> ${handName(r.hand)}${r.why === "slot" ? " (took the freed slot)" : ""}`
          : `\tand so\t${quote(table!.label(r.card))} left ${handName(r.hand)}`);
      }
    } else if (item.kind === "turns") {
      if (journalHidden.has("turns")) continue;
      lines.push(item.uniform !== undefined ? `T${item.uniform}\tturn\tevery box -> ${item.uniform}` : `--\tturn\tevery box +1`);
    } else {
      if (item.entry.type === "diagnostic" && !liveMode && table?.isPeekDiagnostic(item.entry.seq)) continue;
      const gate = item.entry.type === "meddle" ? "write" : item.entry.type;
      if (journalHidden.has(gate)) continue;
      const line = journalTextLine(item.entry);
      if (line !== null) lines.push(line);
    }
  }
  return lines.join("\n");
}

function journalTextLine(e: BoardLogEntry): string | null {
  {
    const t = stampOf(e) || "--";
    switch (e.type) {
      case "deal": {
        const dealt = e.cards.filter((c) => c.verdict === "dealt");
        return dealt.length ? `${t}\tdealt\t${dealt.map((c) => quote(table!.label(c.id))).join(", ")} -> ${e.hand}` : null;
      }
      case "play": return `${t}\tplayed\t${quote(table!.label(e.card))} -> ${e.outcome}`;
      case "write": return `${t}\twrote\t${e.target} ${e.prev !== undefined ? `${JSON.stringify(e.prev)} -> ` : ""}${JSON.stringify(e.value)}`;
      case "evict": return `${t}\tleft\t${quote(table!.label(e.card))} (${e.reason})`;
      case "turns": return `${t}\tturn\t${e.box} advances to ${e.turn}`;
      case "peek": return null;
      case "diagnostic": return `${t}\twarning\t${e.where}: ${e.message}`;
      case "meddle": return `${t}\tmeddled\t${e.label} ${e.prev !== undefined ? `${JSON.stringify(e.prev)} -> ` : ""}${JSON.stringify(e.value)}`;
    }
  }
}

/**
 * Put the map on screen, mounting the canvas the first time.
 *
 * Konva is most of a megabyte and only this view needs it, so the module is a
 * dynamic import: a Board session that never opens the map never pays for one.
 * The stage itself is mounted ONCE and updated after that - remounting per
 * render would throw away the camera every time a card was played.
 */
function showMap(): void {
  if (!mapData) return;
  const pick = currentPick();
  // The zone the Board is filtered to, translated from the filter's own terms
  // (a group gameId to a tag gameId) into the id the map draws by.
  const filteredName = pick ? filters[pick.groupGameId] ?? "" : "";
  const filtered = filteredName === ""
    ? undefined
    : mapData.zones.find((z) => z.gameId === filteredName)?.id;
  const state = {
    now: marks.now(),
    visited: (h: string) => marks.visitedHand(h),
    held: (h: string) => board.find((b) => b.hand === h)?.cards.length ?? 0,
    changed: (h: string) => pulsed.has(h),
    changedStamp: pulseStamp,
    ...(filtered !== undefined ? { filtered } : {}),
  };
  if (mapView) { mapView.update(mapData, onMap, state); return; }
  void (async () => {
    const { mountBoardMap } = await import("./board-map.js");
    if (!mapData || mapView) return;
    mapView = mountBoardMap(mapHost, mapData, onMap, state, {
      select: (hand) => { onMap = hand; open = undefined; pending = undefined; render(); },
      // Clicking a zone IS the Board's filter for that tag group: the same state
      // the dropdown writes, so the two always agree and either can clear it.
      filter: (zoneId) => {
        const group = currentPick();
        if (!group) return;
        const zone = zoneId === undefined ? undefined : mapData?.zones.find((z) => z.id === zoneId);
        if (zone) filters[group.groupGameId] = zone.gameId;
        else delete filters[group.groupGameId];
        render();
      },
      // Double-click reveals in the editor, the same gesture as everywhere else.
      // It is the author asking, not the Board driving: the Board marks.
      reveal: (hand) => {
        const hv = table?.hands().find((h) => h.gameId === hand);
        const home = maps.find((m) => m.boxGameId === hv?.box) ?? currentPick();
        if (home) void studio.searchReveal({ kind: "hand", box: home.box, hand });
      },
    });
  })();
}

/**
 * What is HERE, floated bottom-centre OVER the map (the author's call,
 * 2026-08-25): picking a site pops its cards up where the eye already is, and
 * an open card's play panel takes the same spot. The side column keeps only
 * what has HAPPENED (the journal); a panel docked there made the reader's eye
 * commute between the pin they clicked and the far edge of the window.
 */
function mapFloat(): HTMLElement | null {
  const panel = playPanel();
  if (panel) return el("div", { className: "stagefloat" }, panel);
  const hand = onMap === undefined ? undefined : table?.hands().find((h) => h.gameId === onMap);
  if (!hand) return null;
  return el("div", { className: "stagefloat" },
    handCell(hand, board.find((b) => b.hand === hand.gameId)?.cards ?? []));
}

/** The open card in List view, floated the same way: the panel used to render
 *  at the bottom of the scrolled column, where a first-timer read "clicking a
 *  card does nothing" and a blind second click could hit Back (the antagonist
 *  review's worst stretch, design/board-legibility.md piece 1). One grammar in
 *  both views: the stage floats where the eye already is. */
function listFloat(): HTMLElement | null {
  const panel = playPanel();
  return panel ? el("div", { className: "stagefloat" }, panel) : null;
}

// --- render ------------------------------------------------------------------
function handCell(hand: { gameId: string; title?: string; tags: Record<string, string>; slots?: number }, cards: DealtView[]): HTMLElement {
  // The running position (run-marks.ts): the hand the last play came from is
  // live, hands played from earlier keep a muted mark. Quiet by design - this
  // reports where the run is, it does not ask for anything.
  const here = marks.now() === hand.gameId;
  const been = marks.visitedHand(hand.gameId);
  const cell = el("div", { className: `hcell${here ? " here" : been ? " been" : ""}${pulsed.has(hand.gameId) ? " rippled" : ""}` },
    el("div", { className: "hhead" },
      here || been
        ? el("span", {
            className: `runmark${here ? " now" : ""}`,
            tip: here ? "The last card was played from here" : "Played from earlier this run",
          })
        : null,
      el("span", { className: "hname", text: hand.title ?? hand.gameId, tip: "A hand: a place on the board cards are dealt into." }),
      el("span", { className: "htags" }, ...Object.values(hand.tags).map(chip))));
  const row = el("div", { className: "hcards" });
  for (const c of cards) {
    const isOpen = open?.card === c.id && open.hand === hand.gameId;
    // A card played this run, come back round: the question an author asks of a
    // board is "have I seen this one already", and this is the answer.
    const seen = marks.visitedCard(c.id);
    const face = el("button", { className: `hcard${isOpen ? " on" : ""}${seen ? " seen" : ""}`, onClick: () => {
      // Live mode is observe-only: a card is not played here. Clicking it opens
      // it in the editor instead (the Board marks, it does not drive).
      if (liveMode) {
        const home = table?.home(c.id);
        if (home) void studio.searchReveal({ kind: "card", box: home.box, deck: home.deck, card: home.card });
        return;
      }
      open = isOpen ? undefined : { card: c.id, hand: hand.gameId };
      pending = undefined;
      render();
    } },
      seen ? el("span", { className: "runmark", tip: "Played earlier this run" }) : null,
      el("h4", { text: c.title ?? c.gameId }));
    row.append(face);
  }
  if (cards.length === 0) row.append(el("span", { className: "empty", text: "Nothing here right now." }));
  cell.append(row);
  return cell;
}

/** The open card: read it, choose an outcome, read what happens, Continue. */
function playPanel(): HTMLElement | null {
  if (liveMode) return null;   // observe-only: nothing is played in Live mode
  if (!table || !open) return null;
  const held = board.find((h) => h.hand === open!.hand)?.cards.find((c) => c.id === open!.card);
  if (!held) return null;
  const outcomes = table.outcomes(held.id, open.hand);
  const panel = el("section", { className: "playpanel" },
    el("div", { className: "pp-head" },
      el("h3", { text: held.title ?? held.gameId }),
      el("span", { className: "pp-hand", text: `in ${open.hand}` }),
      el("button", { className: "pp-close", text: icon.close, tip: "Put it back", onClick: () => { open = undefined; pending = undefined; render(); } })),
    held.purpose ? el("p", { className: "beat", text: held.purpose }) : null,
  );
  const chosen = pending !== undefined ? outcomes.find((o) => o.gameId === pending) : undefined;
  if (chosen) {
    // Step two: what happens, then commit.
    panel.append(
      el("div", { className: "pp-outcome" },
        el("span", { className: "overline", text: "Outcome" }),
        el("p", { className: "pp-otitle", text: chosen.title ?? chosen.gameId }),
        chosen.purpose ? el("p", { className: "beat", text: chosen.purpose }) : null),
      el("div", { className: "pp-actions" },
        el("button", { text: "Back", onClick: () => { pending = undefined; render(); } }),
        el("button", { className: "primary", text: "Continue", onClick: playPending })));
  } else {
    const rowEl = el("div", { className: "pp-actions" });
    for (const o of outcomes) {
      const b = el("button", { className: o.available ? "" : "disabled", text: `${o.title ?? o.gameId}${o.available ? "" : " (locked)"}` });
      if (!o.available) b.title = "Unavailable: this outcome's condition is not met in the current state";
      else b.addEventListener("click", () => { pending = o.gameId; focusPending = true; render(); });
      rowEl.append(b);
    }
    if (outcomes.length === 0) rowEl.append(el("span", { className: "empty", text: "This card has no outcomes." }));
    panel.append(rowEl);
  }
  return panel;
}

/** The clocks, forward (design/board-legibility.md piece 4). Per-box clocks
 *  are the real semantics; the old surface half-hid them behind one big number
 *  with a superscript and an undiscoverable click, and paid both costs. A
 *  single-box project keeps the single number, which is then the whole truth. */
function turnDial(): HTMLElement {
  const clocks = table!.clocks();
  if (clocks.length === 1) {
    return el("div", { className: "dial" },
      el("span", { className: "overline", text: "Turn" }),
      el("span", { className: "dialnum", text: String(clocks[0]!.turn) }),
      el("button", { className: "primary", text: "Next turn", tip: "Time passes: the clock advances, hands refresh", onClick: nextTurn }));
  }
  return el("div", { className: "dial clocksdial" },
    el("div", { className: "clockshead" },
      el("span", { className: "overline", text: "Clocks", tip: "Every box keeps its own clock; a play advances only its box" }),
      el("button", { className: "primary", text: "Next turn", tip: "Time passes: every box's clock advances, hands refresh", onClick: nextTurn })),
    el("div", { className: "clocks" },
      ...clocks.map((c) => el("span", { className: "clockrow" },
        el("span", { className: "clockbox", text: c.box }),
        el("span", { className: "clockval", text: String(c.turn) }),
        el("button", { className: "mini", text: "+1", tip: `Advance only ${c.box} (clocks run forward only)`,
          onClick: () => { table!.session.advanceTurns(c.box, 1); refreshBoard(); render(); } })))));
}

/** The turn dial in Live mode: read-only, from the game's `board.turns`. Every
 *  clock is the game's, so there is no Next turn here (the game advances time). */
function liveTurnDial(): HTMLElement {
  const turns = Object.entries(liveRun?.turns ?? {});
  if (turns.length <= 1) {
    return el("div", { className: "dial" },
      el("span", { className: "overline", text: "Turn" }),
      el("span", { className: "dialnum", text: String(turns[0]?.[1] ?? 0) }));
  }
  return el("div", { className: "dial clocksdial" },
    el("div", { className: "clockshead" },
      el("span", { className: "overline", text: "Clocks", tip: "Every box keeps its own clock; the game advances them" })),
    el("div", { className: "clocks" },
      ...turns.map(([box, turn]) => el("span", { className: "clockrow" },
        el("span", { className: "clockbox", text: box }),
        el("span", { className: "clockval", text: String(turn) })))));
}

/** The board in Live mode: a cell per hand the game reports, its cards named by
 *  the gameIds the game sent. Hand metadata (title, tags) comes from the bundle
 *  where it is known; a hand the bundle does not have still shows, named by its
 *  gameId. Cards are not playable here (observe-only). */
function liveCells(): HTMLElement {
  const cells = el("div", { className: "board" });
  const declared = table?.hands() ?? [];
  const active = Object.entries(filters).filter(([, v]) => v !== "");
  const entries = Object.entries(liveRun?.hands ?? {});
  let shown = 0;
  for (const [handGameId, cardGameIds] of entries) {
    const known = declared.find((h) => h.gameId === handGameId);
    // Filter by the hand's declared tags where we know them; a hand the bundle
    // does not know is always shown (we cannot say it does not match).
    if (known && !active.every(([g, v]) => known.tags[g] === v)) continue;
    const hand = known ?? { gameId: handGameId, tags: {} as Record<string, string> };
    const faces = table ? cardGameIds.map((g) => table!.faceByGameId(g, handGameId)) : cardGameIds.map((g) => ({ id: g, gameId: g, from: handGameId }));
    cells.append(handCell(hand, faces));
    shown++;
  }
  if (shown === 0) {
    cells.append(el("span", { className: "empty", text: entries.length === 0 ? "The game hasn't dealt anything yet." : "No hands match these filters." }));
  }
  return cells;
}

/** "Not listed · why" in Live mode: every hand's latest deal, and the cards it
 *  looked at and rejected. The Board's own version lives behind the curtain; in
 *  Live mode the curtain is closed, so this stands on its own. */
function liveNotDealt(): HTMLElement | null {
  const byHand = Object.entries(liveRun?.notDealt ?? {}).filter(([, ns]) => ns.length > 0);
  if (byHand.length === 0) return null;
  const nd = el("details", { className: "curtain" }) as HTMLDetailsElement;
  nd.append(el("summary", { text: "Not listed · why" }));
  for (const [hand, ns] of byHand) {
    const block = el("div", { className: "notdealt" });
    block.append(el("span", { className: "overline", text: hand }));
    for (const n of ns) {
      block.append(el("div", { className: "ndrow" },
        el("span", { className: "ndname", text: n.title ?? n.gameId }),
        el("span", { className: "ndreason", text: n.reason })));
    }
    nd.append(block);
  }
  return nd;
}

/** The Live / Local switch (the session strip), and the "Watch it?" banner.
 *  Offered whenever a game is connected, or while Live mode is on. */
function liveSwitch(): HTMLElement | null {
  if (liveStatus.state !== "connected" && !liveMode) return null;
  // Built ONCE. This was `...(followPicker() ? [followPicker()!] : [])`, which
  // made two <select> elements with two change listeners on every render and
  // threw the first away; the `!` was there to paper over the second call.
  const follow = followPicker();
  return el("div", { className: "viewswitch livemode" },
    el("button", {
      className: `vbtn${liveMode ? " on" : ""}`, text: "Live",
      tip: "Watch the connected game's run",
      onClick: () => { if (!liveMode) void enterLive(); },
    }),
    el("button", {
      className: `vbtn${liveMode ? "" : " on"}`, text: "Local",
      tip: "Play your own session on the Board",
      onClick: () => { if (liveMode) leaveLive(); },
    }),
    ...(follow ? [follow] : []));
}

/** Which participant the Board is watching, when the game is running more than
 *  one (design/live-link.md). One playhead pointed at one flow, switched here:
 *  a Board showing four runs at once shows none of them. Absent for a
 *  single-flow game, which is every ordinary one, so nothing new appears until
 *  a run actually has participants to choose between. */
function followPicker(): HTMLElement | null {
  if (!liveMode || liveStatus.state !== "connected" || liveStatus.flows.length < 2) return null;
  const sel = el("select", { className: "vbtn liveflow" }) as HTMLSelectElement;
  sel.title = "Which playthrough to watch";
  for (const id of liveStatus.flows) {
    const opt = el("option", { text: id }) as HTMLOptionElement;
    opt.value = id;
    if (id === liveStatus.following) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener("change", () => { void switchFollow(sel.value); });
  return sel;
}

/** Follow another participant: tell main, then re-seed the view from that
 *  flow's last board so their table is there at once rather than blank until
 *  they move. */
async function switchFollow(flowId: string): Promise<void> {
  liveStatus = await studio.liveLinkFollow(flowId);
  const snap = await studio.liveLinkSnapshot();
  ensureLiveRun().follow(flowId, snap.boards[flowId]);
  for (const frame of snap.trace) ensureLiveRun().apply(frame);
  render();
}

function liveBanner(): HTMLElement | null {
  if (liveMode || liveBannerDismissed || liveStatus.state !== "connected") return null;
  return el("div", { className: "livebanner" },
    el("span", { className: "livebanner-msg", text: "A game is connected. Watch it?" }),
    el("button", { className: "livebanner-go", text: "Watch it", onClick: () => void enterLive() }),
    el("button", { className: "livebanner-no", text: icon.close, tip: "Dismiss", onClick: () => { liveBannerDismissed = true; render(); } }));
}

function snapshotPanel(): HTMLElement | null {
  if (!snapPanel || !table) return null;
  if (snapPanel === "save") {
    const input = el("input", { className: "snapname" });
    input.placeholder = "<snapshot name>";
    const save = (): void => {
      const label = input.value.trim() || "snapshot";
      snapshots = [...snapshots, { name: label, file: table!.saveFile() }];
      snapPanel = undefined; render();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { snapPanel = undefined; render(); } });
    const panel = el("div", { className: "snappanel" }, input, el("button", { text: "Save", onClick: save }),
      el("button", { text: "Export…", tip: "Write the current state to a .storyletsave file", onClick: () => {
        void studio.exportSave(table!.saveFile(), name || "session").then((r) => {
          if (r === null) return;   // cancelled: the panel stays
          if ("error" in r) { loadError = r.error; } else { snapPanel = undefined; }
          render();
        });
      } }));
    setTimeout(() => input.focus(), 0);
    return panel;
  }
  const list = el("div", { className: "snappanel" });
  snapshots.forEach((s, i) => {
    list.append(el("div", { className: "snaprow" },
      el("button", { className: "snappick", text: s.name, onClick: () => {
        try { table!.loadFile(s.file); } catch (e) { loadError = e instanceof Error ? e.message : String(e); }
        // A restored world is a different position; the trail that led to the
        // old one never led to this.
        marks.reset();
        open = undefined; pending = undefined; snapPanel = undefined;
        board = table!.dealAll();
        render();
      } }),
      el("button", { className: "snapdel", text: icon.close, tip: "Delete snapshot", onClick: () => { snapshots = snapshots.filter((_, j) => j !== i); render(); } })));
  });
  if (snapshots.length === 0) list.append(el("span", { className: "empty", text: "No snapshots yet." }));
  list.append(el("button", { text: "Import…", tip: "Load a .storyletsave file (it also joins the snapshots)", onClick: () => {
    void studio.importSave().then((r) => {
      if (r === null) return;   // cancelled
      if ("error" in r) { loadError = r.error; render(); return; }
      try { table!.loadFile(r.file); } catch (e) {
        loadError = e instanceof Error ? e.message : String(e); render(); return;
      }
      snapshots = [...snapshots, { name: r.name, file: r.file }];
      marks.reset();
      open = undefined; pending = undefined; snapPanel = undefined;
      board = table!.dealAll();
      render();
    });
  } }));
  return list;
}

/** The State tab: the raw state and the stock peek. This was "Behind the
 *  curtain", a collapsed fold at the bottom of one view behind a coy name -
 *  and the antagonist review found it was the single most valuable designer
 *  surface in the window, invisible in Map view and nearly invisible in List
 *  (design/board-legibility.md piece 2). Now a rail tab, in both views. */
function statePanel(): HTMLElement {
  const details = el("div", { className: "statepanel" });

  // The raw state, editable (poking it simulates the game writing).
  details.append(el("span", { className: "overline", text: "Story state" }));
  const stateEl = el("div", { className: "statestrip" });
  for (const r of table!.stateRows()) {
    const wrap = el("span", { className: "sr" }, el("span", { className: "srlabel", text: r.label }));
    if (r.stages !== undefined) {
      // A quality renders as its LADDER with the current rung marked
      // (design/quality.md section 4). Clicking a rung pokes the stage
      // directly: a free-text input here would invite the exact stage typos
      // the compiler exists to refuse, and jumping an arc to "resolved" to
      // look at the late cards is the whole reason a tester wants this row.
      const ladder = el("span", { className: "srladder" });
      for (const stage of r.stages) {
        ladder.append(el("button", {
          className: `srrung${r.value === stage ? " on" : ""}`, text: stage,
          tip: r.value === stage ? "the current stage" : `jump to "${stage}"`,
          onClick: () => {
            try { table!.meddle(r.path, stage, r.label); refreshBoard(); render(); }
            catch { /* ignore a bad poke */ }
          },
        }));
      }
      wrap.append(ladder);
    } else if (r.editable) {
      const input = el("input", { className: "srval" });
      input.value = String(r.value);
      input.addEventListener("change", () => {
        try { table!.meddle(r.path, coerceStateInput(input.value), r.label); refreshBoard(); render(); }
        catch { /* ignore a bad poke */ }
      });
      wrap.append(input);
    } else {
      wrap.append(el("span", { className: "srval ro", text: JSON.stringify(r.value) }));
    }
    stateEl.append(wrap);
  }
  details.append(stateEl);

  // The stock peek: look without touching (nothing here can be played).
  const runner = el("div", { className: "runner" });
  const select = el("select", { className: "qselect" });
  const info = table!.boxes().find((b) => b.gameId === peekBox);
  for (const b of table!.boxes()) {
    const opt = el("option", { text: b.gameId });
    opt.value = b.gameId;
    if (b.gameId === peekBox) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener("change", () => { peekBox = select.value; render(); });
  runner.append(el("span", { className: "overline", text: "Peek the stock" }), select);
  for (const group of info?.groups ?? []) {
    const sel = el("select", { className: "arg" });
    const any = el("option", { text: `${group.gameId}: any` }); any.value = "";
    if ((criteria[group.gameId] ?? "") === "") any.selected = true;
    sel.append(any);
    for (const v of group.values) {
      const o = el("option", { text: `${group.gameId}: ${v}` }); o.value = v;
      if (criteria[group.gameId] === v) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener("change", () => { criteria[group.gameId] = sel.value; });
    runner.append(sel);
  }
  runner.append(el("button", { text: "Peek", onClick: peek }));
  details.append(runner);

  if (peekStamp !== undefined && (peeked.length > 0 || notDealt.length > 0)) {
    // Stamped, and honest about age: the moment the session moves on, the
    // listing greys out and says so - it used to contradict the visible
    // board while looking perfectly fresh.
    const lastSeq = table!.log[table!.log.length - 1]?.seq ?? -1;
    const staleP = lastSeq !== peekStamp.lastSeq;
    const results = el("div", { className: `peekresults${staleP ? " stale" : ""}` });
    results.append(el("div", { className: "peeknote" },
      el("span", { className: "overline", text: `Peeked ${peekStamp.box} at clock ${peekStamp.clock}` }),
      staleP ? el("span", { className: "empty", text: "The session has moved on - peek again." }) : null));
    if (peeked.length > 0) {
      const list = el("div", { className: "peeked" });
      for (const c of peeked) {
        list.append(el("div", { className: "ndrow" },
          el("span", { className: "ndname", text: c.title ?? c.gameId }),
          el("span", { className: "ndreason", text: `priority ${c.priority ?? 0}${c.specificity !== undefined ? ` · specificity ${c.specificity}` : ""} · looked at, put back` })));
      }
      results.append(list);
    }
    if (notDealt.length > 0) {
      const nd = el("div", { className: "notdealt" });
      nd.append(el("span", { className: "overline", text: "Not listed · why" }));
      for (const n of notDealt) {
        nd.append(el("div", { className: "ndrow" },
          el("span", { className: "ndname", text: n.title ?? n.gameId }),
          el("span", { className: "ndreason", text: n.reason })));
      }
      results.append(nd);
    }
    details.append(results);
  }
  return details;
}

function render(): void {
  if (loadError && !table) {
    root.replaceChildren(el("div", { className: "loaderr" },
      el("h2", { text: "The Board can't run yet" }),
      el("pre", { text: loadError }),
      el("button", { className: "primary", text: "Try again", onClick: () => void build() }),
    ));
    return;
  }
  if (!table) { root.replaceChildren(el("div", { className: "loaderr" }, el("p", { text: "Compiling…" }))); return; }

  // The shell's bar (app-shell 0.18.0), which is this one: Patterpad had grown
  // the same sentence for the same situation a word apart, and two apps
  // arriving independently at one wording is what "shape-level" looks like. We
  // supply the noun and the callback and nothing else.
  const staleNote = stale && !liveMode ? staleBar({ subject: "The project", onRestart: restart }) : null;
  // Live Link: the "A game is connected. Watch it?" banner, and the switch that
  // rides in the boardbar below.
  const bannerNote = liveBanner();

  // List | Map: the same board, two ways of looking at it. Offered only when the
  // project has a map, and never a mode with different RULES - the filters, the
  // selection and the reveal gesture are the same in both.
  const viewSwitch = mapChoices().length === 0 ? null : el("div", { className: "viewswitch" },
    ...(["list", "map"] as const).map((v) => el("button", {
      className: `vbtn${view === v ? " on" : ""}`, text: v === "list" ? "List" : "Map",
      tip: v === "list" ? "This box's hands as a list" : "This box seen from above",
      onClick: () => { view = v; void studio.setBoardView(v); if (v === "map") { void loadMap(); showMap(); } render(); },
    })));

  // Which map, when there is more than one. Same grammar as the editor's own
  // group control: a name when there is nothing to choose.
  const scoped = mapChoices();
  const mapPicker = effectiveView() !== "map" || scoped.length === 0 ? null : (() => {
    const here = currentPick()!;
    if (scoped.length === 1) {
      return el("span", { className: "maphere" },
        el("span", { className: "maphere-of", text: "Map of" }),
        el("span", { className: "maphere-name", text: here.groupGameId }));
    }
    const sel = document.createElement("select");
    sel.className = "arg";
    scoped.forEach((m, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = m.groupGameId;
      o.selected = i === mapPick;
      sel.append(o);
    });
    sel.addEventListener("change", () => {
      mapPick = Number(sel.value);
      onMap = undefined;
      void loadMap();
    });
    return sel;
  })();

  // The box navigator (design/board-ripple.md section 4): the left column
  // that makes every box VISIBLE AS A THING, whatever the main area shows -
  // the Map-mode finding was an author who never learned the Codex existed.
  // Each row: the box, how many cards its hands hold now, and the last
  // refresh's changed-count. Everything is the all-boxes list.
  const heldIn = (boxGameId: string): number => {
    const hands = new Set(table!.hands().filter((h) => h.box === boxGameId).map((h) => h.gameId));
    return board.reduce((n, b) => n + (hands.has(b.hand) ? b.cards.length : 0), 0);
  };
  const changedIn = (boxGameId: string): number =>
    table!.hands().filter((h) => h.box === boxGameId && pulsed.has(h.gameId)).length;
  const pickBox = (sel: string | undefined): void => {
    // Leaving a box is its read-receipt: you were looking at it, so its marks
    // clear - which is the only way a box with nothing to play (the Codex)
    // ever sheds its badge. Arriving deliberately does NOT clear: the marks
    // are the guidance for what you came to see.
    if (boxSel !== undefined && boxSel !== sel) {
      const leaving = new Set(table!.hands().filter((h) => h.box === boxSel).map((h) => h.gameId));
      pulsed = new Set([...pulsed].filter((h) => !leaving.has(h)));
    }
    boxSel = sel; mapPick = 0; onMap = undefined; open = undefined; pending = undefined;
    mapData = undefined;
    rememberedBox = sel ?? "";
    void studio.setBoardBox(rememberedBox);   // remembered per project, "" = Everything
    if (mapChoices().length > 0 && view === "map") void loadMap();
    render();
  };
  const boxNav = el("nav", { className: "bnav" },
    el("button", { className: `bnav-row${boxSel === undefined ? " sel" : ""}`, onClick: () => pickBox(undefined) },
      el("span", { className: "bnav-name", text: "Everything" })),
    ...table.boxes().map((b) => {
      const changed = changedIn(b.gameId);
      const held = heldIn(b.gameId);
      return el("button", { className: `bnav-row${boxSel === b.gameId ? " sel" : ""}`,
        tip: `${held} card${held === 1 ? "" : "s"} held${changed > 0 ? ` · ${changed} changed by the last action` : ""}`,
        onClick: () => pickBox(b.gameId) },
        el("span", { className: "bnav-name", text: b.title ?? b.gameId }),
        changed > 0 ? el("span", { className: "bbadge", text: String(changed) }) : null,
        el("span", { className: "bnav-n", text: String(held) }));
    }));

  // The filter bar: "show all hands in the forest".
  const groups = filterGroups();
  const filterBar = el("div", { className: "filters" });
  if (groups.length > 0) {
    filterBar.append(el("span", { className: "overline", text: "Showing" }));
    for (const group of groups) {
      const sel = el("select", { className: "arg" });
      const any = el("option", { text: `${group.gameId}: all` }); any.value = "";
      if ((filters[group.gameId] ?? "") === "") any.selected = true;
      sel.append(any);
      for (const v of group.values) {
        const o = el("option", { text: `${group.gameId}: ${v}` }); o.value = v;
        if (filters[group.gameId] === v) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener("change", () => { filters[group.gameId] = sel.value; render(); });
      filterBar.append(sel);
    }
  }

  // The board: every hand that matches the filters, with its cards.
  const active = Object.entries(filters).filter(([, v]) => v !== "");
  const dealtBy = new Map(board.map((h) => [h.hand, h.cards]));
  const cells = el("div", { className: "board" });
  const declared = table.hands()
    .filter((h) => active.every(([g, v]) => h.tags[g] === v))
    .filter((h) => boxSel === undefined || h.box === boxSel);
  // A filter that hides hands says so: SHOWING district: docks silently
  // vanishing the Codex read as loss, not as filtering.
  const inScope = table.hands().filter((h) => boxSel === undefined || h.box === boxSel).length;
  const hiddenCount = inScope - declared.length;
  if (active.length > 0 && hiddenCount > 0) {
    filterBar.append(el("span", { className: "empty", text: `${hiddenCount} hand${hiddenCount === 1 ? "" : "s"} hidden` }));
  }
  const boxes = table.boxes();
  if (boxSel === undefined && boxes.length > 1) {
    // A multi-box project gets box sections (design/board-ripple.md piece 1):
    // you cannot perceive "another box reacted" if the boxes are not visible
    // as things. The header's quiet badge counts the LAST refresh's changes.
    for (const b of boxes) {
      const ours = declared.filter((h) => h.box === b.gameId);
      if (ours.length === 0) continue;
      const changed = ours.filter((h) => pulsed.has(h.gameId)).length;
      cells.append(el("div", { className: "boardbox-head" },
        el("span", { className: "bbname", text: b.title ?? b.gameId }),
        changed > 0 ? el("span", { className: "bbadge", text: `${changed} changed` }) : null));
      for (const h of ours) cells.append(handCell(h, dealtBy.get(h.gameId) ?? []));
    }
  } else {
    for (const h of declared) cells.append(handCell(h, dealtBy.get(h.gameId) ?? []));
  }
  if (declared.length === 0) {
    cells.append(el("span", { className: "empty", text: table.hands().length === 0 ? "No hands on this board yet - seat one in the editor." : "No hands match these filters." }));
  }

  // The journal (right): the story of the session so far. The filter chips
  // mute kinds of beat (a muted chip greys out); Copy takes what you see.
  const warnCount = activeLog().filter((e) =>
    e.type === "diagnostic" && !(!liveMode && table?.isPeekDiagnostic(e.seq))).length;
  const kinds: { type: LogEntry["type"]; label: string }[] = [
    { type: "deal", label: "dealt" }, { type: "play", label: "played" },
    { type: "write", label: "wrote" }, { type: "evict", label: "left" },
    { type: "turns", label: "turns" },
    // The count keeps a warning that scrolled away from being missed.
    { type: "diagnostic", label: warnCount > 0 ? `⚠ ${warnCount}` : "⚠" },
  ];
  const jfilters = el("div", { className: "jfilters" }, ...kinds.map(({ type, label }) =>
    el("button", { className: `jflt${journalHidden.has(type) ? "" : " on"}`, text: label,
      tip: journalHidden.has(type) ? `Show ${label} entries` : `Hide ${label} entries`,
      onClick: () => {
        if (journalHidden.has(type)) journalHidden.delete(type); else journalHidden.add(type);
        render();
      } })));
  const journal = el("div", { className: `journal${stampBoxes() ? " stamped" : ""}` });
  // The plan (journalPlan, model.ts): a play carries its writes and its
  // consequences; an attributed deal/evict never renders flat again; a full
  // every-box advance is one beat. The chips gate kinds: a play's group rides
  // the played chip, its writes also honour wrote, meddles ride wrote too
  // (both are state changes).
  const full = activeLog();
  const plan = journalPlan(full, (i) => (table ? table.rippleFor(full, i) : []), table?.boxes().length ?? 0);
  // Evict events carry the hand's ID where deal events carry its gameId (a
  // trace quirk that is a four-runtime fixture change to fix at source):
  // translate here so the ripple always names hands the way the board does.
  const handName = (h: string): string =>
    table?.hands().find((x) => x.gameId === h || x.id === h)?.gameId ?? h;
  const rows: HTMLElement[] = [];
  for (const item of plan) {
    if (item.kind === "play") {
      if (journalHidden.has("play")) continue;
      const row = journalRow(item.entry);
      if (row) rows.push(row);
      if (!journalHidden.has("write")) {
        for (const w of item.writes) {
          rows.push(el("div", { className: "jrow j-write j-in" },
            el("span", { className: "jt" }),
            el("span", { className: "jk", text: "wrote" }),
            el("span", { className: "jp", text: `${w.target} ${w.prev !== undefined ? `${JSON.stringify(w.prev)} → ` : ""}${JSON.stringify(w.value)}` })));
        }
      }
      for (const r of item.ripple) {
        rows.push(el("div", { className: "jrow j-ripple" },
          el("span", { className: "jt" }),
          el("span", { className: "jk", text: "and so" }),
          el("span", { className: "jp", text: r.kind === "dealt"
            ? `“${quote(table!.label(r.card))}” → ${handName(r.hand)}${r.why === "slot" ? " (took the freed slot)" : ""}`
            : `“${quote(table!.label(r.card))}” left ${handName(r.hand)}` })));
      }
    } else if (item.kind === "turns") {
      if (journalHidden.has("turns")) continue;
      rows.push(el("div", { className: "jrow j-turn" },
        el("span", { className: "jt", text: item.uniform !== undefined ? `T${item.uniform}` : "" }),
        el("span", { className: "jk", text: "turn" }),
        el("span", { className: "jp", text: item.uniform !== undefined ? `every box → ${item.uniform}` : "every box +1" })));
    } else {
      // A diagnostic the peek produced belongs to the peek's results, not the
      // journal (live mode's seqs are the game's own, never peek-marked).
      if (item.entry.type === "diagnostic" && !liveMode && table?.isPeekDiagnostic(item.entry.seq)) continue;
      const gate = item.entry.type === "meddle" ? "write" : item.entry.type;
      if (journalHidden.has(gate)) continue;
      const row = journalRow(item.entry);
      if (row) rows.push(row);
    }
  }
  if (rows.length === 0) journal.append(el("span", { className: "empty", text: journalHidden.size > 0 ? "Nothing matches these filters." : "Nothing has happened yet." }));
  for (const r of rows.slice(-80)) journal.append(r);

  // The rail: Journal and State as tabs, in both views (design/
  // board-legibility.md piece 2). Live mode is observe-only - nothing to
  // poke - so its rail is the journal alone.
  const withState = !liveMode;
  const showJournal = railTab === "journal" || !withState;
  const rail = el("aside", { className: "rail" },
    el("div", { className: "railtabs" },
      el("button", { className: `railtab${showJournal ? " on" : ""}`, text: "Journal",
        onClick: () => { railTab = "journal"; render(); } }),
      withState ? el("button", { className: `railtab${railTab === "state" ? " on" : ""}`, text: "State",
        tip: "The live story state, and the stock peek",
        onClick: () => { railTab = "state"; render(); } }) : null,
      el("span", { className: "railgap" }),
      showJournal ? el("button", { className: "mini", text: "Copy", tip: "Copy the journal (as filtered)",
        onClick: () => void navigator.clipboard.writeText(journalText()) }) : null),
    // The filter chips stay put while the story scrolls beneath them.
    showJournal ? jfilters : null,
    showJournal ? journal : statePanel());

  root.replaceChildren(
    // TWO BARS, because there were two kinds of thing in one (A16). The window's
    // chrome - what this window IS and how it sits beside the editor - is the
    // shell's swin-head, the same as Find, Links and Coverage. The session's
    // controls are about the game being played and get a strip of their own.
    toolWindowHead({
      title: "The Board",
      pinned,
      onPin: (on) => { pinned = on; void studio.setBoardPinned(on); },
      onClose: () => void studio.closeBoard(),
      lead: [el("span", { className: "tname", text: name })],
      trail: [el("button", {
        className: `followbtn${follow ? " on" : ""}`, text: "Follow in the editor",
        tip: follow
          ? "The editor is opening each card as you play it: click to stop"
          : "Open each card in the editor as you play it",
        onClick: () => { follow = !follow; void studio.setBoardFollow(follow); render(); },
      })],
    }),
    // The session strip. In Live mode the game is in control, so its own
    // controls (seed, Save state, Restore, Restart) are hidden and only the
    // Live / Local switch stays.
    liveMode
      ? el("div", { className: "tbar" },
          el("span", { className: "livenote", text: "Watching the connected game (observe only)." }),
          el("span", { className: "tbargap" }),
          liveSwitch())
      : el("div", { className: "tbar" },
          el("label", { className: "seed" }, "seed ",
            (() => {
              const s = el("input", { className: "seedin", tip: "The session's random seed - changing it restarts the run" });
              s.value = String(seed);
              s.addEventListener("change", () => { const n = Number(s.value); if (Number.isInteger(n)) { seed = n; void build(); } });
              return s;
            })()),
          el("span", { className: "tbargap" }),
          liveSwitch(),
          el("button", { text: "Save state…", onClick: () => { snapPanel = snapPanel === "save" ? undefined : "save"; render(); } }),
          el("button", { text: "Restore…",
            onClick: () => { snapPanel = snapPanel === "restore" ? undefined : "restore"; render(); } }),
          el("button", { text: `${icon.restart} Restart`, onClick: restart }),
        ),
    liveMode
      // Live mode: the game's run, always as a list (its board, its journal,
      // its "Not listed · why"). The List/Map switch, the box navigator and
      // the local controls step aside; the turn dial is read-only.
      ? el("div", { className: "tbody nonav" },
          el("main", { className: "tmain" },
            bannerNote,
            el("div", { className: "boardbar" }, liveTurnDial(), filterBar),
            liveCells(),
            liveNotDealt()),
          rail,
        )
      : effectiveView() === "map"
      ? el("div", { className: "tbody mapbody" },
          boxNav,
          el("main", { className: "tmain mapmain" },
            staleNote,
            bannerNote,
            snapshotPanel(),
            el("div", { className: "boardbar" }, turnDial(), viewSwitch, mapPicker, filterBar),
            mapData
              ? el("div", { className: "mapstage-wrap" }, mapHost, mapFloat())
              : el("div", { className: "empty", text: "This map has nothing drawn on it yet." }),
            loadError ? el("div", { className: "runerr", text: loadError }) : null),
          el("div", { className: "tside" }, rail),
        )
      : el("div", { className: "tbody" },
          boxNav,
          el("main", { className: "tmain listmain" },
            el("div", { className: "tscroll" },
              staleNote,
              bannerNote,
              snapshotPanel(),
              el("div", { className: "boardbar" }, turnDial(), viewSwitch, filterBar),
              cells,
              loadError ? el("div", { className: "runerr", text: loadError }) : null),
            listFloat()),
          rail,
        ),
  );
  // An outcome was just chosen: Continue takes focus, so Enter commits the
  // play and the keyboard never has to find the button.
  if (focusPending) {
    focusPending = false;
    root.querySelector<HTMLButtonElement>(".playpanel .pp-actions .primary")?.focus();
  }
  // Keep the journal reading like a story: newest visible.
  if (showJournal) journal.scrollTop = journal.scrollHeight;
  // The map is a live view of the same session: a play moves the running mark,
  // a deal changes what a pin holds. Never in Live mode, which is list-only.
  if (!liveMode && view === "map") showMap();
}

async function boot(): Promise<void> {
  initTooltips();
  // Escape closes, as it does in Find, Links and Coverage - but LAYERED, the way
  // Escape is layered everywhere else in this app: it dismisses the snapshot
  // panel first if one is up, and only closes the window when there is nothing
  // smaller to close. A play session is a thing an author is in the middle of,
  // so the window is the last thing Escape should take.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    // Innermost first: the pending outcome, then the open card, then the
    // snapshot panel, and the window only when nothing smaller is left.
    if (pending !== undefined) { pending = undefined; render(); return; }
    if (open !== undefined) { open = undefined; render(); return; }
    if (snapPanel !== undefined) { snapPanel = undefined; render(); return; }
    void studio.closeBoard();
  });
  const state = await studio.getState();
  applyTheme(state.theme);
  studio.onTheme(applyTheme);
  // Reset View re-pins every helper window in main and tells the window after
  // the fact (app-shell 0.23.0). Re-rendering is the whole fix here: this head
  // is rebuilt from `pinned` on every render, so the button comes back agreeing
  // with the window instead of showing the state it last chose itself.
  studio.onWindowPinned((on) => { pinned = on; render(); });
  pinned = state.boardPinned;
  follow = state.boardFollow;
  // The remembered List | Map choice; "map" is the default and build() falls
  // back to List when the project has no map to show.
  view = state.boardView;
  rememberedBox = state.boardBox;
  // Live Link: a game may already be connected when the Board opens.
  liveStatus = await studio.liveLinkStatus();
  await build();
}
// Re-check freshness whenever the Board regains focus (the moment you return
// from editing) - it flips to the out-of-date banner if the project changed.
window.addEventListener("focus", () => void checkStale());
void boot();
