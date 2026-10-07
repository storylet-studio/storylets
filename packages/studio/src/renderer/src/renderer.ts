// ---------------------------------------------------------------------------
// The editor window's composition root: the shell (navigator | centre), the
// modules that do the work, wired together, and the render dispatch.
//
// The centre holds the open DOCUMENT and everything about it, including the
// machinery: the inspector pane was retired in July 2026 (ux-changes v3),
// which is why editors live in `inspector.ts` under a name that outlived the
// pane. The navigator toggles with Cmd+1, remembered per user. Top commands
// live in the native menus, not a button bar. The pane grid, the toggle and the
// toast come from the shared shell package; the surfaces stay ours.
//
// What lives where, since October 2026's split of a 3,700-line file:
//   session.ts      what is open (the project, its server, the app state)
//   navigation.ts   where the author is, the history, the remembered place
//   actions.ts      what the pages can ask for: creates, deletes, moves
//   save-queue.ts   the autosave queue, Auto Rebuild, the delete flush
//   comments.ts     the comment panel, canvas markers, the review walk
//   problems.ts     the problems bar and chip, quick fixes, problem jumps
//   vc-view.ts      version-control badges, the chip, read-only documents
//   exchange.ts     Publish, packs, and the server exchange
//   commands.ts     the menus and the window's own keys
//   kits.ts, catalogues.ts, map-page.ts, story-page.ts, deck-canvas.ts
// What stays here is the frame, the project's arrival and departure, and
// drawing: which page the centre shows, and when.
//
// TWO CLAIMS THAT USED TO BE IN THIS HEADER AND WERE NOT TRUE. A third
// "inspector (editing)" pane, gone for a month before the header said so; and a
// Writing View on Shift+Cmd+M, which has never existed in any form - no menu
// item, no command, no exit affordance. The second survived a year of reading
// because a file header is the one place nobody checks against the code. It is
// now a recorded DEPARTURE rather than a missing feature (storyletter.md 2):
// full-bleed focus answers a problem a page of prose has, and a card is not
// that (design review 2026-08, A3 and A17).
// ---------------------------------------------------------------------------

import "./theme.css";
import "./shell.css";
import "@wildwinter/app-shell/tooltip.css";
import "@wildwinter/app-shell/about.css";
import "@wildwinter/app-shell/anchored.css";
import "@wildwinter/app-shell/vc.css";
import "@wildwinter/app-shell/identity.css";
import "@wildwinter/app-shell/notes-editor.css";
import "@wildwinter/app-shell/comments.css";
import "@wildwinter/app-shell/toast.css";
import "@wildwinter/app-shell/updater.css";
import "@wildwinter/app-shell/welcome.css";
import "@wildwinter/app-shell/kit-gallery.css";
import "@wildwinter/app-shell/link-status.css";
import "@wildwinter/app-shell/job.css";
import "@wildwinter/expr-editor/styles.css";
import {
  askIdentity, el, feedUpdaterDownloadProgress, historyNav, iconNode, initTooltips, keyLabel, mountLinkStatus, mountPaneShell,
  revealRowWhenReady, saveIndicator, showUpdaterDialog, tipWithKey,
} from "@wildwinter/app-shell";
import type { LinkStatus, LinkStatusChip, PaneShell } from "@wildwinter/app-shell";
import { applyTheme } from "./theme.js";
import { setBoxColours } from "./box-tint.js";
import { hydrateCameras } from "./canvas-memory.js";
import {
  renderBoxCentre, renderDeckCentre, renderDecksCentre, renderHandsCentre, renderNav, renderProjectCentre,
  crumbTrail, projectLead,
} from "./views.js";
import {
  renderCardWorkspace, renderTemplateWorkspace, renderHandWorkspace, renderTagGroupWorkspace,
  renderBoxTabBody, renderDeckTabBody, refreshGameIds, setDocTab,
} from "./inspector.js";
import { keepPlace } from "./keep-place.js";
import { createProjectSettings } from "./project-settings.js";
import { setSettingsOpener } from "./solo-pointer.js";
import { setPlayRung } from "./play-ladder.js";
import { setGameScopes, setPropertyNavigator } from "./expr-panels.js";
import { askLeave, settleLeave } from "./server-dialog.js";
import { flash, flashError, ok } from "./results.js";
import { INITIAL_STATE, remember } from "./session.js";
import { createNavigation } from "./navigation.js";
import { createSaveQueue } from "./save-queue.js";
import { createComments } from "./comments.js";
import { createProblems } from "./problems.js";
import { createVcView } from "./vc-view.js";
import { createCatalogues } from "./catalogues.js";
import { createMapPage } from "./map-page.js";
import { renderStoryCentre } from "./story-page.js";
import { createDeckCanvas } from "./deck-canvas.js";
import { createExchange } from "./exchange.js";
import { createActions } from "./actions.js";
import { createCommands } from "./commands.js";
import { createLifecycle } from "./lifecycle.js";
import type { Session } from "./session.js";
import type { StoryPageContext } from "./story-page.js";
import type {
  CoverageOverlayDto, LiveLinkStatus, OpenResult, StudioApi, ThemeChoice,
} from "../../shared/api.js";

declare global { interface Window { studio: StudioApi; } }
const studio = window.studio;

// --- what is open ------------------------------------------------------------
const session: Session = { studio, project: undefined, remote: undefined, state: { ...INITIAL_STATE } };
/** Live Link's bottom-right chip; mounted at boot, shown while a project is open. */
let liveLinkChip: LinkStatusChip | undefined;

const app = document.getElementById("app")!;

// --- the frame -----------------------------------------------------------------
// The frame is the shared pane shell (@wildwinter/app-shell): built and mounted
// ONCE (mountShell), its bodies refilled per render so any pane can repaint
// independently. Mounted once, not re-appended per render: moving the frame
// threw away every scroll offset and the caret on each render, so an alt-tab
// scrolled the navigator to the top (the October 2026 review, finding 3).
let shell!: PaneShell;
/** The back/forward pair in the topbar, mounted with the frame. */
let histPair: ReturnType<typeof historyNav> | undefined;
// The save indicator is the shell's (app-shell 0.18.0): the controller that
// computes the three states already lived there, and the six lines that DREW
// them were the half each app kept - so both apps hand-rendered one machine's
// output and drifted on it (design review 2026-08, A4).
const saveEl = saveIndicator();
/** The welcome screen's host, beside the workspace in #app: whichever is not
 *  showing is hidden, and neither is ever torn down. */
const welcomeHost = el("div", { className: "welcome-host" });
/** The project's frame and its bars, as one hideable group. */
const workspace = el("div", { className: "workspace" });
workspace.hidden = true;

// --- the modules, wired ----------------------------------------------------------
const nav = createNavigation({ session, actions: () => actions, render: () => renderWorkspace() });

const saves = createSaveQueue({
  session,
  applied: (r) => applied(r),
  onStatus: (status) => saveEl.set(status),
  repaintAfterSave: () => repaintAfterSave(),
  refreshVc: () => void vc.refresh(),
  refreshProject: () => refreshProject(),
});

const vc = createVcView({
  session,
  place: () => ({ focus: nav.focus, inspected: nav.inspected }),
  centre: () => shell.centre,
  afterLock: refreshGameIds,
});

const comments = createComments({
  session,
  applied: (r) => applied(r),
  refreshVc: () => void vc.refresh(),
  flushSaves: saves.flush,
  centre: () => shell.centre,
  actions: () => actions,
  goTo: (at) => nav.goTo(at),
});

const problems = createProblems({
  session,
  actions: () => actions,
  render: () => renderWorkspace(),
  applied: (r) => applied(r),
  applyResult: (r) => applyResult(r),
  refreshProject: () => refreshProject(),
  flushSaves: saves.flush,
  mayStepAway: saves.mayStepAway,
  goTo: (at) => nav.goTo(at),
  offerMapUpgrade: (asked) => offerMapUpgrade(asked),
  openSettings: (section) => projectSettingsPanel.open(section),
});

const catalogues = createCatalogues({
  session,
  render: () => renderWorkspace(),
  renderCentre: () => renderCentre(),
  boxDecks: () => nav.currentBox()?.decks.map((d) => d.id) ?? [],
  onBoxPage: (boxId) => nav.focus?.kind === "box" && nav.focus.box === boxId,
});

// --- the coverage overlay (design/coverage-overlays.md) -----------------------
//
// A remembered MODE, like the feedback walk: the canvases wear the last run's
// evidence until told otherwise.

/**
 * The last coverage run, for the overlay.
 *
 * Held in the renderer rather than fetched per repaint: a canvas repaints on
 * every pan and a round trip to main for numbers that only change when a sweep
 * finishes would put IPC in the middle of a drag.
 */
let coverage: CoverageOverlayDto | undefined;
/** Whichever canvas is mounted, told the overlay has changed. */
let refreshCoverage: (() => void) | undefined;

/** Re-read the last run and put it on whichever canvas is up. */
async function gatherCoverage(): Promise<void> {
  coverage = session.state.coverageOverlay ? await studio.coverageOverlay() : undefined;
  refreshCoverage?.();
}

studio.onCoverageDone(() => { void gatherCoverage(); });

function setCoverageOverlay(on: boolean): void {
  void remember(session, "coverageOverlay", on);
  void gatherCoverage();
}

const canvasHooks = {
  comments,
  coverage: () => coverage,
  setCoverageRefresh: (refresh: (() => void) | undefined) => { refreshCoverage = refresh; },
};

const mapPage = createMapPage({
  session,
  actions: () => actions,
  applied: (r) => applied(r),
  refreshVc: () => void vc.refresh(),
  renderNavPane: () => renderNavPane(),
  renderCentre: () => renderCentre(),
  arriveFrom: nav.arriveFrom,
  newCardAt: (...args) => made.newCardAt(...args),
  ...canvasHooks,
});

const deckCanvas = createDeckCanvas({
  session,
  actions: () => actions,
  currentBox: nav.currentBox,
  selection: () => nav.selection,
  selectCards: nav.selectCards,
  deleteCards: (deckId, cardIds) => made.deleteCards(deckId, cardIds),
  applied: (r) => applied(r),
  applyResult: (r) => applyResult(r),
  refreshVc: () => void vc.refresh(),
  renderCentre: () => renderCentre(),
  ...canvasHooks,
});

const made = createActions({
  session, nav, saves, comments, catalogues, mapPage, deckCanvas,
  render: () => renderWorkspace(),
  renderCentre: () => renderCentre(),
  renderNavPane: () => renderNavPane(),
  applied: (r) => applied(r),
  applyResult: (r) => applyResult(r),
  refreshVc: () => void vc.refresh(),
  offerMapUpgrade: (asked) => offerMapUpgrade(asked),
  openSettings: (section) => projectSettingsPanel.open(section),
  focusNewTitle: () => focusNewTitle(),
});
const { actions, host: inspectorHost } = made;

const lifecycle = createLifecycle({
  session, nav, saves, comments, problems, vc, catalogues,
  actions: () => actions,
  applyResult: (r) => applyResult(r),
  applied: (r) => applied(r),
  render: () => renderWorkspace(),
  renderNavPane: () => renderNavPane(),
  renderCentre: () => renderCentre(),
  welcomeHost,
  showWorkspace: (on) => showWorkspace(on),
  signalReady: () => signalReady(),
  tellDeckFocused: (on) => tellDeckFocused(on),
  liveLink: (on) => { if (on) showLiveLinkChip(); else liveLinkChip?.setVisible(false); },
  gatherCoverage: () => gatherCoverage(),
});
const { adopt, refreshProject, offerMapUpgrade, repaintReplacedProject } = lifecycle;

const exchange = createExchange({
  session,
  flushSaves: saves.flush,
  applied: (r) => applied(r),
  applyResult: (r) => applyResult(r),
  refreshProject: () => refreshProject(),
  render: () => renderWorkspace(),
  repaintReplacedProject: () => repaintReplacedProject(),
  adopt: (pending) => adopt(pending),
  reloadCatalogue: catalogues.reload,
});

const commands = createCommands({
  session, nav, saves, comments, exchange,
  actions: () => actions,
  shell: () => shell,
  render: () => renderWorkspace(),
  renderCentre: () => renderCentre(),
  refreshVc: () => void vc.refresh(),
  applied: (r) => applied(r),
  deleteSelection: made.deleteSelection,
  adopt: (pending) => adopt(pending),
  clearRecents: lifecycle.clearRecents,
  closeProject: lifecycle.closeProject,
  openNewProject: () => lifecycle.newProject(),
  saveIdentity: (mode) => saveIdentity(mode),
  setTheme: (theme) => setTheme(theme),
  setCoverageOverlay,
  openSettings: (section) => projectSettingsPanel.open(section),
  toggleLiveLink: () => liveLinkChip?.toggle(),
});

const storyPage: StoryPageContext = {
  session,
  actions: () => actions,
  focus: () => nav.focus,
  queue: saves.queueStruct,
  openSettings: (section) => projectSettingsPanel.open(section),
};

// Project Settings dialog (the shared settings shell + storylet sections). A
// save reloads the project (new properties change the expr-editor catalogue).
const projectSettingsPanel = createProjectSettings(
  studio,
  (result) => { applyResult(result); catalogues.forgetDeck(); renderWorkspace(); },
  flashError,
  // The project file is the shape: under an author's key this dialog is to be
  // read, not typed into (design/engine-server.md 9.1).
  () => session.remote?.role === "author",
);
setSettingsOpener((section) => { if (session.project) projectSettingsPanel.open(section); });

// --- taking main's answers -------------------------------------------------------

/**
 * Take a result from main: the project, and the problems that go with it.
 *
 * It PAINTS the problems bar as well as recording them, because taking the new
 * list and leaving the old one on screen is the same bug written twenty times.
 * Found by fixing a loose hand on the map: dragging the pin back into a zone
 * cleared the error in the shard and in the renderer, and the bar went on
 * saying it, because only two of the callers happened to repaint. A function
 * that receives the answer is the right place to show it.
 */
function applyResult(result: OpenResult): void {
  session.project = result.project;
  setBoxColours(result.project.boxes);
  session.remote = result.remote;
  // The game's shared scopes folder, for the expression editors' dialect: seeded on every
  // result, since sharing the project's scopes comes back through here.
  setGameScopes(result.project.gameScopes);
  // The lead carries the unpushed count, and every write moves it: redrawn here
  // rather than only on a full workspace render, which a keystroke does not do.
  renderProjectLead();
  // Every surface asks play-ladder.ts what it may draw, and this is the one
  // place the answer arrives (design/engine-server.md 4.10). Seeded on every
  // result, not only on open: changing Play in Project Settings comes back
  // through here.
  setPlayRung(result.project.play);
  problems.take(result.problems);
}

/** Take a mutation's answer whole: report it, or apply it. True when it
 *  landed, for a caller with more to do. */
function applied(r: OpenResult | { error: string }): boolean {
  if (!ok(r)) return false;
  applyResult(r);
  return true;
}

// --- theming -----------------------------------------------------------------
async function setTheme(theme: ThemeChoice): Promise<void> {
  applyTheme(theme);
  await remember(session, "theme", theme);
  if (!session.project) lifecycle.renderWelcome();
}

// --- Live Link -------------------------------------------------------------------
// The bottom-right connect chip is the shell's (link-status.ts); what the game
// sends stays the Board's business.

/** Main's Live Link status in the chip's shape: the same fields, with the
 *  boxes the game's hello named as the tip's extra sentence. */
function linkStatusOf(s: LiveLinkStatus): LinkStatus {
  if (s.state !== "connected") return s;
  // A save held back from the game says why in the tip, beside the boxes.
  const note = [
    s.boxes.length > 0 ? `Boxes: ${s.boxes.join(", ")}.` : "",
    s.held !== undefined ? `Not sent, so the game runs the build before: ${s.held}` : "",
  ].filter(Boolean).join(" ");
  return {
    state: "connected", port: s.port, build: s.build,
    ...(s.project !== undefined ? { project: s.project } : {}),
    ...(note !== "" ? { note } : {}),
  };
}

/** Show the chip telling the truth: one hidden while the server kept running
 *  has to come back saying so, so the status is re-read as it appears. */
function showLiveLinkChip(): void {
  liveLinkChip?.setVisible(true);
  void studio.liveLinkStatus().then((s) => liveLinkChip?.apply(linkStatusOf(s)));
}

// --- revealing the window -------------------------------------------------------

/**
 * Tell main to reveal the window, ONCE, the moment the initial view is mounted
 * (the welcome screen, the restored project, or the first-run identity
 * question). The window is created hidden so nobody sees the pre-boot chrome
 * flash before boot() fills it. Signalled over IPC (a task), not
 * requestAnimationFrame, which is throttled while the window is hidden and
 * would never fire. A no-op after the first call, so later renders are free
 * to call it.
 */
let appRevealed = false;
function signalReady(): void {
  if (appRevealed) return;
  appRevealed = true;
  studio.appReady();
}

// --- the workspace ---------------------------------------------------------------

function mountShell(): void {
  const state = session.state;
  shell = mountPaneShell(el("div"), {
    nav: { defaultWidth: "224px", label: "navigator", shortcutHint: keyLabel("Mod+1") },
    // NOT OFFERED (app-shell 0.36.0): the slot is retired and its toggle
    // opened 384px of nothing - the audit's blank-pane find. The config
    // stays so the future reference pane inherits the width and label.
    inspector: { defaultWidth: "384px", label: "inspector", shortcutHint: keyLabel("Mod+2"), offered: false },
    initial: {
      // The inspector pane is retired (ux-changes v3): mounted dormant + closed,
      // its slot reserved for a future genuinely-optional reference pane.
      open: { nav: state.panes.nav, inspector: false },
      width: {
        ...(state.panes.navW !== undefined ? { nav: state.panes.navW } : {}),
        ...(state.panes.inspW !== undefined ? { inspector: state.panes.inspW } : {}),
      },
    },
    onChange: (s) => void studio.setPanes({
      nav: s.open.nav, inspector: false,
      ...(s.width.nav !== undefined ? { navW: s.width.nav } : {}),
      ...(s.width.inspector !== undefined ? { inspW: s.width.inspector } : {}),
    }),
  });
  // The fused title bar (the shell's family rule): the topbar IS the macOS
  // title bar, so it drags the window and leaves room for the traffic lights.
  // The inset is macOS-only, matching main's hiddenInset - elsewhere the
  // window keeps its native frame and the same bar sits beneath it.
  shell.topbar.classList.add("titlebar");
  if (navigator.platform.startsWith("Mac")) shell.topbar.classList.add("titlebar-inset");
  // The back/forward pair, at its family home: the topbar's lead, right after
  // the nav toggle (the ruling of 2026-08-28, ratifying Patterpad's placement;
  // arrows not chevrons, so it cannot be read as another pane toggle).
  histPair = historyNav(() => nav.back(), () => nav.forward());
  histPair.set(false, false);
  // Between the nav toggle and the lead slot, NOT inside the lead: renders
  // rebuild the lead's contents with replaceChildren, and a pair mounted in
  // there quietly vanished on the first repaint.
  shell.topbar.insertBefore(histPair.el, shell.topbarLead);
  // The primary loop's visible door (surface review F8): play what you wrote.
  // Cmd+P, as Play Scene is in Patterpad (ruling O).
  const play = el("button", { className: "btn topbtn", tip: tipWithKey("Play this project on the Board", "Mod+P") }, iconNode("play", 16), "Play");
  play.addEventListener("click", () => { if (session.project) void (async () => { await saves.flush(); await studio.openTable(); })(); });
  shell.topbarTrail.append(play, vc.chip, problems.chip, saveEl.el);
  // A locked document redraws itself in place on the controls that stay live,
  // which would hand back editable fields (vc-view.ts).
  shell.centre.addEventListener("click", () => vc.guardAfterClick(), true);
  // The walk's bar above the problems bar: a mode you entered outranks an
  // ambient one, and the pair keeps a stable order however they come and go.
  workspace.append(shell.root, exchange.jobStrip, comments.reviewbar, problems.bar);
  app.replaceChildren(welcomeHost, workspace);
}

/** Show the welcome or the workspace; the other is hidden, never rebuilt. */
function showWorkspace(on: boolean): void {
  workspace.hidden = !on;
  welcomeHost.hidden = on;
}

/**
 * The name, the way home, and - for a project a server has not seen the whole
 * of - where it stands. Built in views.ts so what it says is testable.
 *
 * Its own function because the unpushed count moves on every write, and a write
 * does not repaint the workspace: until 2026-09-07 the lead only caught up at
 * the next full render, so an edit showed up in it at whatever happened next.
 */
function renderProjectLead(): void {
  if (!session.project) return;
  shell.topbarLead.replaceChildren(projectLead(session.project, session.remote, () => actions.focus({ kind: "project" })));
}

function renderNavPane(): void {
  if (!session.project) return;
  // The focused path renders expanded TRANSIENTLY (v3: no ratchet) - only the
  // user's own chevron toggles persist. A path node's chevron is inert while
  // you are inside it, which is correct: the nav always shows where you are.
  const effective = new Set([...nav.expanded, ...nav.navPath()]);
  // The tree is redrawn whole; where it was scrolled to is not (keep-place.ts).
  const restore = keepPlace([shell.nav], undefined);
  renderNav(shell.nav, session.project, nav.focus, effective, actions);
  restore();
  vc.paint(shell.nav);
}

/**
 * Draw the open document into the centre, then re-apply the version-control
 * state to what it built (badges on the master items, read-only when the shard
 * is somebody else's).
 *
 * The ONE dispatch: a card, a setup document, or a page (fillCentre). This used
 * to dispatch only to the pages, so a call made while a card or a hand was open
 * redrew its deck or its box instead, and every caller had to know to reach for
 * renderWorkspace.
 *
 * A redraw of the SAME document (and tab) keeps the author's place, the scroll
 * and the focused field (keep-place.ts); another one starts at its own top.
 */
let drawnDoc: string | undefined;
function renderCentre(): void {
  const here = nav.capturePlace();
  const doc = here === undefined ? undefined
    : `${here.focus.kind}:${here.focus.box ?? ""}:${(here.focus as { deck?: string }).deck ?? ""}|${here.key ?? ""}|${here.tab ?? ""}`;
  const same = doc !== undefined && doc === drawnDoc;
  drawnDoc = doc;
  const restore = same ? keepPlace([shell.centre], shell.centre, { carryValue: saves.pending }) : undefined;
  if (!renderCardPanes() && !renderDetailPanes()) fillCentre(restore);
  else releaseCanvases();
  if (restore) restore(); else shell.centre.scrollTop = 0;
  vc.apply();
}

/** A canvas's element goes with the centre's children, but not its window
 *  listeners or its ResizeObserver: the node and map views have to be told. */
function releaseCanvases(): void {
  deckCanvas.release();
  mapPage.release();
  // The markers went with it (comments.ts says why), and so did the overlay.
  comments.detach();
  refreshCoverage = undefined;
}

/** The pages: the project, Story, the map, a box, its decks and hands masters,
 *  a deck. `restore` is the kept place, for the one page that fills in later. */
function fillCentre(restore?: () => void): void {
  releaseCanvases();
  const project = session.project;
  const centre = shell.centre;
  const f = nav.focus;
  const blank = (): void => { centre.classList.remove("measured"); centre.replaceChildren(); };
  if (f?.kind === "project" && project) { renderProjectCentre(centre, project, actions); return; }
  if (f?.kind === "story" && project) { renderStoryCentre(centre, storyPage, restore); return; }
  if (f?.kind === "map" && project) { mapPage.render(centre); return; }
  const box = nav.currentBox();
  if (!box || !f) { blank(); return; }
  if (f.kind === "box") {
    renderBoxCentre(centre, box, (h, tab) => renderBoxTabBody(h, box, tab, inspectorHost), actions,
      project?.map !== undefined ? { users: project.boxes.filter((b) => b.usesMap === true) } : undefined,
      new Set(nav.selection));
  }
  else if (f.kind === "decks") renderDecksCentre(centre, box, session.state.viewMode, actions);
  else if (f.kind === "hands") renderHandsCentre(centre, box, actions);
  else if (f.kind === "deck") {
    const deck = box.decks.find((d) => d.id === f.deck);
    if (!deck) { blank(); return; }
    const cat = catalogues.forDeck(deck.id);
    renderDeckCentre(centre, box, deck, cat, new Set(nav.selection), session.state.viewMode,
      (h, tab) => renderDeckTabBody(h, box, deck, tab, cat, inspectorHost), actions);
  }
  else blank();
}

/** Open an entity's editor in the centre beneath its hierarchy trail. */
function centreEditor(segments: { label: string; go: () => void }[], ...right: (Node | null)[]): HTMLElement {
  const editor = el("div", { className: "centre-editor" });
  // MEASURED: the trail and the editor share one right edge (shell.css,
  // ".pane-centre.measured"). Set here rather than on the editor, because the
  // trail is a sibling and it was the half that used to run wide.
  shell.centre.classList.add("measured");
  shell.centre.replaceChildren(crumbTrail(segments, ...right), editor);
  return editor;
}
const boxSeg = (box: { id: string; title?: string; gameId: string }): { label: string; go: () => void } =>
  ({ label: box.title ?? box.gameId, go: () => actions.focus({ kind: "box", box: box.id }) });

/** Hand templates, hands and tag groups are document-class too: their
 *  bindings, chosen tags and declared tags want the centre's width, exactly as
 *  a card does. False (nothing drawn) until the open one's detail is in. */
function renderDetailPanes(): boolean {
  const box = nav.currentBox();
  const ins = nav.inspected;
  const detail = nav.detail;
  if (!box || !ins) return false;
  // Setup items live behind the box page: their trail's second segment
  // returns there with the right tab active, mirroring how they were opened.
  const boxTabSeg = (label: string, tab: string): { label: string; go: () => void } =>
    ({ label, go: () => { setDocTab(`box:${box.id}`, tab); actions.focus({ kind: "box", box: box.id }); } });
  if (ins.kind === "template" && detail?.kind === "template" && detail.template.id === ins.template) {
    const cat = catalogues.forBox(box.id);
    renderTemplateWorkspace(centreEditor([boxSeg(box), boxTabSeg("Hand templates", "templates")]), box, detail.template, cat, inspectorHost);
    return true;
  }
  if (ins.kind === "hand" && detail?.kind === "hand" && detail.hand.id === ins.hand) {
    const cat = catalogues.forBox(box.id);
    renderHandWorkspace(centreEditor([boxSeg(box), { label: "Hands", go: () => actions.focus({ kind: "hands", box: box.id }) }]), box, detail.hand, cat, inspectorHost);
    return true;
  }
  if (ins.kind === "tagGroup" && detail?.kind === "tagGroup" && detail.group.id === ins.group) {
    renderTagGroupWorkspace(centreEditor([boxSeg(box), boxTabSeg("Tags", "tags")]), box, detail.group, inspectorHost);
    return true;
  }
  return false;
}

/** The open card's page. False (nothing drawn) when no card is open. */
function renderCardPanes(): boolean {
  const box = nav.currentBox();
  const ins = nav.inspected;
  if (ins?.kind !== "card" || !box) return false;
  const deck = box.decks.find((d) => d.id === ins.deck);
  const card = deck?.cards.find((c) => c.id === ins.card);
  if (!deck || !card) return false;
  const cat = catalogues.forDeck(deck.id);
  // Scan-and-fix across the deck without round-tripping through browse (v3 3).
  const at = deck.cards.findIndex((c) => c.id === card.id);
  const step = (delta: number): void => {
    const next = deck.cards[at + delta];
    if (next) actions.inspectCard(box.id, deck.id, next.id);
  };
  const prev = el("button", { className: "btn icon centre-step", tip: tipWithKey("Previous card", "Up") }, iconNode("back"));
  prev.disabled = at <= 0; prev.addEventListener("click", () => step(-1));
  const next = el("button", { className: "btn icon centre-step", tip: tipWithKey("Next card", "Down") }, iconNode("forward"));
  next.disabled = at >= deck.cards.length - 1; next.addEventListener("click", () => step(1));
  const editor = centreEditor([
    boxSeg(box),
    { label: "Decks", go: () => actions.focus({ kind: "decks", box: box.id }) },
    { label: deck.title ?? deck.gameId, go: () => actions.focus({ kind: "deck", box: box.id, deck: deck.id }) },
  ], el("span", { className: "centre-step-pos", text: `${at + 1} / ${deck.cards.length}` }), prev, next);
  renderCardWorkspace(editor, box, deck, card, cat, inspectorHost);
  return true;
}

/**
 * Repaint the browse views after a background save, without rebuilding a live
 * editor mid-edit (each owns its local model and its caret). The navigator
 * always; the centre only when it is a list rather than a document anyone
 * types into. (The problems bar is painted by the answer itself, applyResult.)
 */
function repaintAfterSave(): void {
  renderNavPane();
  const ins = nav.inspected;
  const f = nav.focus;
  const editing = ins?.kind === "card" || ins?.kind === "template"
    || ins?.kind === "hand" || ins?.kind === "tagGroup"
    || ins?.kind === "deck" || f?.kind === "box" || f?.kind === "story";
  if (!editing) renderCentre();
}

/** A freshly made thing asks to be named: its title is focused and selected on
 *  the next render that draws one (renderWorkspace). Every create path asks,
 *  through `focusNewTitle`. */
let pendingFocusTitle = false;
let focusTitleTimer: ReturnType<typeof setTimeout> | undefined;
function focusNewTitle(): void {
  pendingFocusTitle = true;
  // A page whose detail never arrives must not keep the request for some later,
  // unrelated render to act on.
  clearTimeout(focusTitleTimer);
  focusTitleTimer = setTimeout(() => { pendingFocusTitle = false; }, 2000);
}

function renderWorkspace(): void {
  // Tell main which card the Links lens should be looking at (navigation.ts
  // `lensCard`). Fire and forget: the lens is a convenience, never a dependency.
  void studio.setLinkFocus(nav.lensCard());
  if (!session.project) return;
  showWorkspace(true);
  renderProjectLead();
  renderNavPane();
  renderCentre();
  problems.renderBar();
  signalReady();   // the project is drawn: safe to reveal the window (no-op after the first)
  saveEl.set(saves.status);
  histPair?.set(nav.canBack(), nav.canForward());
  // A freshly created thing asks to be named: the title focused, the
  // placeholder text selected so typing replaces it, for every kind (card,
  // deck, box, hand, hand template, tag group, and every duplicate). Waits
  // for the first render that draws a title, since a setup document's detail
  // arrives a moment after the navigation; once taken, later redraws of the
  // same document keep the focus and the selection themselves (keep-place.ts).
  if (pendingFocusTitle) {
    const t = shell.centre.querySelector<HTMLInputElement>(".doc-title");
    if (t && !t.disabled) { t.focus(); t.select(); pendingFocusTitle = false; clearTimeout(focusTitleTimer); }
  }
  nav.rememberPlace();
  tellDeckFocused(nav.focus?.kind === "deck");
}

/** Tell main whether the open page has a deck (a deck's page or one of its
 *  cards), so File > New Card is live only where it can make one. Sent only
 *  when it changes. */
let deckFocused: boolean | undefined;
function tellDeckFocused(on: boolean): void {
  if (on === deckFocused) return;
  deckFocused = on;
  void studio.setDeckFocused(on);
}

// --- the property navigator ----------------------------------------------------
//
// Right-click on a property pill: Go to definition / Find usages (the ruling
// of 2026-08-26, with the Story page). A box or deck ref names no owner, and
// needs none: a @deck pill in a card can only mean that card's own deck, so
// definition is "in the box/deck you are looking at". An @hand ref that names
// a tag group's own enum opens that group; any other @hand name is declared on
// tags, so the box's Tags tab is its home.

/**
 * The jump's second half: the page is open, now the ROW, through app-shell's
 * revealRowWhenReady. It used to stop at the page, and a declaration below the
 * fold was nowhere to be seen (reported 2026-09-14). A box's or a deck's tab
 * can still be filling in from main when the render returns, and the World tab
 * lives in a dialog that opens on its own time, so the shell asks again on the
 * next frames rather than once, and gives up quietly after a moment: a name no
 * page shows as a row (a tag group's, whose own page IS the definition) is not
 * a fault. SCOPED to the page that was opened (the settings dialog for World,
 * the centre pane for the rest): one name can be declared at two scopes, and a
 * search of the whole document could light a row on a page that is not showing.
 */
function landOn(within: ParentNode, name: string): void {
  void revealRowWhenReady(within, name);
}

setPropertyNavigator({
  goToDefinition(ref) {
    if (ref.scope === "world") {
      projectSettingsPanel.open("world");
      landOn(document.querySelector(".settings-dialog") ?? document, ref.name);
      return;
    }
    // A jump, so it remembers the way back: the crumb bar's return control
    // (the Map's arriveFrom grammar) rather than leaving the author stranded
    // at the declaration (reported from use, 2026-08-26). World is exempt
    // above because a dialog dismisses back to where you were by itself.
    const here = nav.returnHere();
    const jump = (navigate: () => void): void => {
      if (here) nav.arriveFrom(here.label, here.go, navigate); else { navigate(); renderWorkspace(); }
      landOn(shell.centre, ref.name);
    };
    if (ref.scope === "story") { jump(() => actions.focus({ kind: "story" })); return; }
    const box = nav.currentBox();
    if (!box) return;
    if (ref.scope === "box") {
      jump(() => { actions.focus({ kind: "box", box: box.id }); setDocTab(`box:${box.id}`, "properties"); });
    } else if (ref.scope === "deck") {
      const focus = nav.focus;
      const inspected = nav.inspected;
      const deck = focus?.kind === "deck" ? focus.deck
        : inspected && "deck" in inspected ? inspected.deck : undefined;
      if (deck === undefined) return;
      jump(() => { actions.focus({ kind: "deck", box: box.id, deck }); setDocTab(`deck:${deck}`, "properties"); });
    } else if (ref.scope === "hand") {
      const group = box.tagGroups.find((g) => g.gameId === ref.name);
      if (group) { jump(() => actions.inspectTagGroup(box.id, group.id)); return; }
      jump(() => { actions.focus({ kind: "box", box: box.id }); setDocTab(`box:${box.id}`, "tags"); });
    }
  },
  findUsages(ref) { void studio.openSearch({ mode: "property", query: `@${ref.scope}.${ref.name}` }); },
});

// --- a project arrives, changes under us, or goes --------------------------------

/** Ask who is at the keyboard, and keep the answer. The shell owns the dialog;
 *  where it is stored is the app's business (its own state file, never the
 *  project). */
async function saveIdentity(mode: "welcome" | "edit"): Promise<void> {
  const current = await studio.identity();
  // Offer the VCS's name only when nothing is stored (simple-vc-lib 0.4.1): a
  // stored identity is the author's own answer and must not be overwritten by
  // what the working copy happens to be configured with.
  const suggested = current?.name ? undefined : await studio.offeredIdentity();
  const answer = await askIdentity({
    // Patterpad's options, so the two apps ask the same way: first run says
    // "Welcome to Storyletter", and a Skip there is FINAL (the shell resolves a
    // blank name, which is stored, so the next launch does not ask again). A
    // skip from the menu changes nothing.
    mode,
    appName: "Storyletter",
    neverAskAgainOnSkip: mode === "welcome",
    ...(current ? { current } : {}),
    // The shell offers a whole Identity; the VCS only knows a name.
    ...(suggested ? { suggested: { name: suggested } } : {}),
  });
  if (answer) await studio.setIdentity(answer);
}

// --- boot ----------------------------------------------------------------------

async function boot(): Promise<void> {
  session.state = await studio.getState();
  nav.expanded = new Set(session.state.navExpanded ?? []);
  hydrateCameras(session.state.canvasCameras);
  // One delegated controller for every `data-tip` in the window (Patterpad's
  // themed tooltip, now shell-side): our own bubble on our own delay, rather
  // than the platform's unstyled one after a second of waiting.
  initTooltips();
  applyTheme(session.state.theme);
  studio.onTheme(applyTheme);
  mountShell();   // build the pane frame once, seeded from the persisted pane state
  // Live Link: hidden until a project is open. Off or failed starts the
  // server; anything else stops it. The chip applies whatever comes back.
  liveLinkChip = mountLinkStatus(document.body, {
    label: "Live Link",
    onToggle: async (current) => linkStatusOf(await (
      current.state === "off" || current.state === "error" ? studio.liveLinkStart() : studio.liveLinkStop())),
  });
  studio.onLiveLinkStatus((s) => liveLinkChip?.apply(linkStatusOf(s)));
  studio.onMenu(commands.onMenu);
  // The updater's four channels. Registered at boot, not lazily: main starts its
  // first background check 10 seconds after ready, and a prompt that arrives with
  // nobody listening waits 300 seconds and then answers itself.
  studio.onUpdaterCheckDirty(() => saves.pending);
  studio.onUpdaterSaveBeforeInstall(async () => { await saves.flush(); return { ok: !saves.pending }; });
  studio.onUpdaterPrompt((opts) => showUpdaterDialog(opts));
  studio.onUpdaterDownloadProgress(feedUpdaterDownloadProgress);
  // The way out of a project the server has not seen the whole of. Registered
  // at boot for the same reason as the four above: main asks at the moment of
  // quitting, and a question nobody is listening for falls back to a native box
  // the app is not supposed to be wearing.
  studio.onLeavePrompt((opts) => askLeave(opts));
  // ...and what becomes of it: the dialog is held open past the click, so main
  // either turns it into the revision the push landed as or takes it down.
  studio.onLeaveSettled((opts) => settleLeave(opts));
  studio.onSearchNavigate((at) => nav.goTo(at));   // Find hits, and the `--at` jump of a running app
  // The job strip: only the job this window is waiting on (exchange.ts).
  studio.onJobProgress((p) => exchange.onJobProgress(p));
  // Find's Replace tab: main asks for pending edits on disk before it rewrites,
  // and says when it has, so the open document shows the new text.
  studio.onEditorFlush(() => void (async () => { await saves.flush(); await studio.editorFlushed(); })());
  studio.onReplaceApplied((count) => void (async () => {
    await refreshProject();
    flash(`Replaced ${count} across the project`, "ok");
  })());
  // The OS asked the running app to open something else.
  studio.onProjectOpened((result) => void exchange.arrive(result));
  commands.listen();
  // Persist pending edits when leaving or closing the editor window (so the
  // Board reads current disk, and a close never drops the last keystrokes).
  window.addEventListener("blur", () => { if (session.project) void saves.flush(); });
  window.addEventListener("beforeunload", () => { if (session.project) void saves.flush(); });
  window.addEventListener("focus", () => { if (session.project) void lifecycle.onWindowFocus(); });
  // Version-control state changes under us (somebody takes a lock, a newer
  // revision lands), so poll as well as refreshing on focus / save / load.
  // Cheap: main throttles the server round-trip and coalesces the callers.
  window.setInterval(() => void vc.refresh(), 30_000);
  // Who is at the keyboard, asked ONCE on first run and skippable: Patterpad's
  // first-run identity, at Patterpad's moment. An earlier cut asked at the first
  // comment instead, on the grounds that somebody who never comments should
  // never be asked - which was a preference dressed up as a reason, and not
  // enough to make the two apps behave differently. The two apps are a family.
  // The question needs a window to be asked in: the frame is mounted, so show it.
  if (!(await studio.identity())) { signalReady(); await saveIdentity("welcome"); }

  // A double-clicked project or pack wins over the last project: the author
  // just said which one they want.
  const launched = await studio.launchTarget();
  if (launched !== null) { await exchange.arrive(launched); if (session.project) return; }
  if (session.state.lastProject) { await adopt(studio.openProjectPath(session.state.lastProject)); if (session.project) return; }
  lifecycle.renderWelcome();
}
void boot();
