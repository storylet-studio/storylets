// ---------------------------------------------------------------------------
// The Board's session: building it from the project's bundle, and everything
// done to it - play a card, advance a clock, restart, a new run, close - with
// the confirm that guards throwing a session away. The surfaces (the hand
// cells, the session strip, the head) call these; none of them draws anything.
// ---------------------------------------------------------------------------

import { confirmDialog, toast } from "@wildwinter/app-shell";
import { Table, boardRefusal, diffBoards, loadReportNote } from "./model.js";
import type { BoardSaveFile } from "./model.js";
import type { LoadReport } from "@storylet-studio/model";
import { setPlayRung } from "../src/play-ladder.js";
import { setImageProject } from "../src/image-cache.js";
import { setPulsed } from "./board-state.js";
import type { Board, BoardState } from "./board-state.js";
import { watchPatterpad } from "./patterpad.js";
import { loadMap } from "./map-stage.js";

export async function build(b: Board): Promise<void> {
  const s = b.state;
  const result = await b.studio.tableBundle();
  s.runError = "";
  if ("error" in result) {
    s.table = undefined;
    watchPatterpad(b);
    // No project at all is not a failure, it is an empty state (the project was
    // closed under the Board).
    s.noProject = (await b.studio.project()) === null;
    s.loadError = s.noProject ? "" : result.error;
    // The Board shows the error where the table would be; the toast is the
    // family's voice for a failure in a tool window (parity row 19).
    if (!s.noProject) toast(`The Board could not build the project: ${result.error}`, "error");
    b.render();
    return;
  }
  s.noProject = false;
  s.loadError = "";
  s.name = result.name;
  // The play ladder's rung (design/engine-server.md 4.10). It comes beside the
  // bundle rather than in it: the bundle deliberately does not carry the
  // setting, and this window has no other source for it.
  setPlayRung(result.play);
  // A refused project (boardRefusal says when) is shown where the table would be, like a build error.
  s.builtStamp = result.stamp;
  s.performing = undefined;
  // The Board's own picture cache, scoped by project as the editor's is: two
  // projects' maps can share a file name.
  const opened = await b.studio.project();
  if (opened) setImageProject(opened.project.dir);
  try {
    const table = new Table(result.bundle, s.seed, result.scopes, result.patter);
    s.table = table;
    if (s.latestPatterPush !== undefined && table.patter) table.applyPatterBundle(s.latestPatterPush);
  }
  catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    s.loadError = boardRefusal(why, result.scopes);
    s.table = undefined;
    watchPatterpad(b);
    toast(`The Board could not play the project: ${why}`, "error");
    b.render();
    return;
  }
  watchPatterpad(b);
  for (const k of Object.keys(s.filters)) delete s.filters[k];
  s.stale = undefined;   // this bundle is fresh as of now
  // Snapshots belong to their project: another one's would only be refused.
  const project = result.bundle.content.project;
  if (s.snapshotsOf !== project) { s.snapshots = []; s.snapshotsOf = project; }
  dealAfresh(s);   // the game starts with the board dealt
  s.selectedHand = undefined;
  s.maps = await b.studio.projectMaps();
  // A project with no map shows the list (effectiveView), and the remembered
  // List | Map choice is left alone for the next project that has one.
  // The remembered box wins when it still exists in this bundle ("" is an
  // explicitly chosen Everything). Never chose: a project with a map opens on
  // the Map - on EVERYTHING when the boxes share a space (the whole world at
  // once), else the first mapped box - when the remembered preference is map;
  // otherwise Everything.
  if (s.rememberedBox === "") s.boxSel = undefined;
  else if (s.rememberedBox !== undefined && s.table!.boxes().some((x) => x.gameId === s.rememberedBox)) s.boxSel = s.rememberedBox;
  else if (s.view === "map" && s.maps.length > 0) s.boxSel = s.maps.some((m) => m.space !== undefined) ? undefined : s.maps[0]!.boxGameId;
  else s.boxSel = undefined;
  s.mapPick = 0;
  b.render();
  void loadMap(b);
}

/**
 * A new position on the board: nothing open, nowhere visited yet, the board
 * dealt afresh, and no ripple (an opening deal is a curtain up, not a ripple).
 * A build, a new run and a restore all start here. The journal so far, the
 * opening deal included, puts nothing at stake; a restored position is the
 * author's own, so all of it does (`restored`).
 */
function dealAfresh(s: BoardState, restored = false): void {
  s.performing = undefined;
  s.open = undefined; s.pending = undefined; s.snapPanel = undefined;
  s.marks.reset();
  s.board = s.table!.dealAll();
  s.openedAt = restored ? 0 : s.table!.log.length;
  setPulsed(s, new Set());
}

// Out of date: the project changed since this session was built. Checked when
// the window regains focus (you leave the Board to edit, then come back).
export async function checkStale(b: Board): Promise<void> {
  const s = b.state;
  if (!s.table || s.stale) return;
  const hash = await b.studio.projectHash();
  // The stamp, not the bundle's hash alone: it also moves when Patterpad republishes the scenes.
  if (hash && hash !== s.builtStamp) { s.stale = "edit"; b.render(); }
}

/** A different project was opened underneath the Board (or the project
 *  closed): this table is dealing a game from a bundle nobody has open any
 *  more. Say so at once rather than waiting for the focus check, which was only
 *  ever about EDITS to the same one. */
export function projectChanged(b: Board): void {
  const s = b.state;
  s.latestPatterPush = undefined;
  if (!s.table) { void build(b); return; }   // nothing at stake: show what is open now
  void b.studio.project().then((open) => { s.stale = open === null ? "closed" : "project"; b.render(); });
}

/** Open a card in the editor, by any reference the Board holds (its id, or a
 *  game's gameId in Live mode). Never steals focus: main sends the editor a
 *  message and does not raise its window. A card the build does not know has
 *  no page, and nothing happens. */
export function revealCard(b: Board, cardRef: string): void {
  const home = b.state.table?.home(cardRef);
  if (home) void b.studio.searchReveal({ kind: "card", box: home.box, deck: home.deck, card: home.card });
}

/** Something done on the Board went through: a failure from before it no
 *  longer describes the board, so it goes. */
export function succeeded(s: BoardState): void { s.runError = ""; }

/** Something done on the Board failed: say so under the board, and in the
 *  toast, the family's voice for a failure in a tool window. */
export function failed(s: BoardState, what: string, e: unknown): void {
  s.runError = `${what}: ${e instanceof Error ? e.message : String(e)}`;
  toast(`${s.runError}.`, "error");
}

/** The world moved: refresh the whole board and pulse what changed. */
export function refreshBoard(s: BoardState): void {
  if (!s.table) return;
  const before = s.board;
  s.board = s.table.dealAll();
  setPulsed(s, diffBoards(before, s.board));
}

/** Play the open card: with the chosen outcome, or with none ("") for a card
 *  that has no outcomes (its Done button). */
export function playOpen(b: Board, outcome: string): void {
  const s = b.state;
  if (!s.table || !s.open) return;
  try {
    s.table.play(s.open.card, outcome, s.open.hand);
    s.performing = undefined;
    // The running position, recorded before `open` is cleared: this hand is
    // where we are, and this card has now been seen for the rest of the run.
    s.marks.played(s.open.hand, s.open.card);
    succeeded(s);
    // Follow: open what was just played, in the editor. Never steals focus, so
    // the Board stays under the hand that is playing.
    if (s.follow) revealCard(b, s.open.card);
  } catch (e) {
    failed(s, "The card could not be played", e);
  }
  s.open = undefined; s.pending = undefined;
  refreshBoard(s);   // the world moved: the whole board refreshes
  b.render();
}

/** Play the open card with the outcome chosen at step one (Continue). */
export function playPending(b: Board): void {
  if (b.state.pending !== undefined) playOpen(b, b.state.pending);
}

/** Move a clock (Next turn, a box's +1, a timed step), then refresh the board. */
export function advance(b: Board, move: (table: Table) => void): void {
  const s = b.state;
  if (!s.table) return;
  move(s.table);
  succeeded(s);
  refreshBoard(s);
  b.render();
}

/** Time passed: cooldowns lapse, hands refresh. */
export function nextTurn(b: Board): void {
  advance(b, (t) => t.nextTurn());
}

/** The session holds something worth asking about: the journal has moved on
 *  from the opening deal. Closing the window also loses the snapshots, which a
 *  Restart keeps. */
const atStake = (s: BoardState, closing: boolean): boolean =>
  (s.table !== undefined && s.table.log.length > s.openedAt) || (closing && s.snapshots.length > 0);

/**
 * The confirm before something that throws the session and its journal away:
 * Restart, and closing the Board (ruling Q). One wording, so the two never
 * drift. Elided when nothing is at stake: an untouched session goes silently.
 * Escape answers the dialog while it is up, never the Board's own layers.
 */
async function discardSession(s: BoardState, title: string, confirmLabel: string, closing = false): Promise<boolean> {
  if (!atStake(s, closing)) return true;
  s.asking = true;
  try {
    const body = closing && s.snapshots.length > 0
      ? "The session, its journal, and its snapshots are discarded."
      : "The session and its journal are discarded.";
    return await confirmDialog({ title, body, confirmLabel });
  } finally {
    s.asking = false;
  }
}

export function restart(b: Board): void {
  void discardSession(b.state, "Restart the game?", "Restart").then((ok) => { if (ok) void build(b); });
}

/** Close the Board, from Escape or its close button: asks first when the
 *  journal holds a session (ruling Q), as Restart does. */
export function closeBoard(b: Board): void {
  if (b.state.asking) return;
  void discardSession(b.state, "Close the Board?", "Close the Board", true).then((ok) => { if (ok) void b.studio.closeBoard(); });
}

/**
 * A NEW RUN (design/engine-server.md 4.2): the world restarts overnight and the
 * pockets come with it, which is what a designer needs in order to play a
 * RETURNING party. The model does the work; this is the gesture.
 *
 * No confirmation: it keeps everything durable, and everything else it drops
 * is the same session Restart drops without asking either. The journal starts
 * afresh, so the run boundary is legible in the record rather than hidden in it.
 */
export function newRun(b: Board): void {
  const s = b.state;
  if (!s.table) return;
  s.table.newRun();
  succeeded(s);
  dealAfresh(s);
  b.render();
}

/**
 * FORGET EVERYONE (4.2): the durable half goes too, so the designer can play
 * the first day again. That is exactly what a Restart already does - the Board
 * builds a fresh engine - so this IS Restart, under the name that says what it
 * costs, with a confirmation that names it. It is the one act in the system
 * that forgets people on purpose, and it should never be a slip of the mouse.
 */
export function forgetEveryone(b: Board): void {
  b.state.asking = true;
  void confirmDialog({
    title: "Forget everyone?",
    body: "The session and its journal are discarded, and so is everything durable "
      + "(every pocket and the installation's own memory). The next run is the first day again.",
    confirmLabel: "Forget everyone",
  }).then((ok) => { b.state.asking = false; if (ok) void build(b); });
}

/**
 * Restore a save into the session: a snapshot, or an imported file. Says what
 * the save cost against this build (loadReportNote) when it cost anything, and
 * puts a refused one under the board. True when it went in.
 */
export function restore(s: BoardState, file: BoardSaveFile): boolean {
  if (!s.table) return false;
  let report: LoadReport;
  try { report = s.table.loadFile(file); }
  catch (e) { failed(s, "The save could not be restored", e); return false; }
  succeeded(s);
  // A restored world is a different position; the trail that led to the old
  // one never led to this.
  dealAfresh(s, true);
  const note = loadReportNote(report);
  if (note !== undefined) toast(note, "info");
  return true;
}
