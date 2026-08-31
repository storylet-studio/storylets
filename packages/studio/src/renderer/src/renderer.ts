// ---------------------------------------------------------------------------
// The shell: navigator | centre. Module-level state + render functions (the
// Patterpad shape). The centre holds the open DOCUMENT and everything about
// it, including the machinery: the inspector pane was retired in July 2026
// (ux-changes v3), which is why editors live in `inspector.ts` under a name
// that outlived the pane. The navigator toggles with Cmd+1, remembered per
// user. Top commands live in the native menus, not a button bar.
//
// TWO CLAIMS THAT USED TO BE HERE AND WERE NOT TRUE. A third "inspector
// (editing)" pane, gone for a month before this header said so; and a Writing
// View on Shift+Cmd+M, which has never existed in any form - no menu item, no
// command, no exit affordance. The second survived a year of reading because
// a file header is the one place nobody checks against the code. It is now a
// recorded DEPARTURE rather than a missing feature (storyletter.md 2):
// full-bleed focus answers a problem a page of prose has, and a card is not
// that (design review 2026-08, A3 and A17).
//
// The pane grid, the toggle and the toast now come from the shared shell
// package; the surfaces (nav, centre content) stay storylets-specific.
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
import "@wildwinter/expr-editor/styles.css";
import { applyTheme } from "./theme.js";
import { baseName } from "./paths.js";
import { el } from "./dom.js";
import { hydrateCameras } from "./canvas-memory.js";
import { confirmDialog } from "./confirm.js";

import {
  askIdentity, closeAnchoredPanel, createSaveController, initTooltips, mountPaneShell, icon, openComments, saveIndicator, showAbout,
} from "@wildwinter/app-shell";
import type { PaneShell } from "@wildwinter/app-shell";
import {
  renderBoxCentre, renderDeckCentre, renderDecksCentre, renderHandsCentre, renderNav, renderProblems, renderProjectCentre, renderReviewBar,
} from "./views.js";
import { cardHasContent, crumbTrail, navId, setCameFrom, vcKeys } from "./views.js";
import type { Focus, ViewActions } from "./views.js";
import { foldVc, lockControls, lockNotice, paintVcBadges } from "./vc-view.js";
import {
  renderCardWorkspace, renderTemplateWorkspace, renderHandWorkspace, renderTagGroupWorkspace,
  renderBoxTabBody, renderDeckTabBody, docTabFor, expandOutcome, setDocTab, resetDocTabMemory,
} from "./inspector.js";
import type { Detail, Inspected, InspectorHost } from "./inspector.js";
import { createProjectSettings } from "./project-settings.js";
import { mountPropertyList } from "./prop-list.js";
import { setPropertyNavigator } from "./expr-panels.js";
import { createNavHistory, historyNav } from "@wildwinter/app-shell";
import type { MountedNodeView } from "./node-view.js";
import type { MountedMapView } from "./map-view.js";
import type { SearchSelection } from "./search.js";
import { openContextMenu } from "./context-menu.js";
import { openKitPicker } from "./kit-picker.js";
import { mountLiveLinkChip } from "./live-link.js";   // Live Link: the bottom-right connect chip
import type { LiveLinkChip } from "./live-link.js";
import { canvasId, MAP_CANVAS } from "../../shared/api.js";
import { showUpdaterDialog, feedUpdaterDownloadProgress } from "./updater-dialog.js";
import type {
  BoxEdit, BoxKit, CardDto, CardEdit, ConditionProperty, TagGroupEdit, MenuCommand, OpenResult, Problem, ProjectDto,
  ShardVcDto, TemplateEdit, StudioApi, StudioState, ThemeChoice,
  BoxDto, CommentDto, CommentMarkerDto, CoverageOverlayDto, ReviewAt, ReviewItemDto } from "../../shared/api.js";

declare global { interface Window { studio: StudioApi; } }
const studio = window.studio;

// --- state -------------------------------------------------------------------
let state: StudioState = { theme: "system", recents: [], panes: { nav: true, inspector: true }, autoRebuild: false, viewMode: "node", boardPinned: true, boardFollow: false, boardView: "map", searchPinned: true, coveragePinned: true, linksPinned: true, showResolved: false, reviewWalk: false, coverageOverlay: false };
// navExpanded hydrates from state after getState() resolves (see boot).
let project: ProjectDto | undefined;
/** Live Link's bottom-right chip; mounted at boot, shown while a project is open. */
let liveLinkChip: LiveLinkChip | undefined;
let problems: Problem[] = [];
/** Which problem the bar is showing, Patterpad's one-at-a-time model. */
let problemAt = 0;
let browseCursor: string | undefined;   // keyboard cursor on the deck browse
/** Every selected card in the focused deck, shared by its three views: a
 *  selection made on the canvas shows in the card and table views too, because
 *  they are three views OF one deck rather than three separate places. The
 *  cursor above is the one within it that the keyboard and Links follow. */
let cardSelection: string[] = [];
/** Select cards across the deck's views. The cursor moves to the last one
 *  touched, so keyboard browsing and the Links lens keep an anchor even when the
 *  author has several cards in hand. */
function selectCards(ids: string[]): void {
  cardSelection = ids;
  browseCursor = ids.length > 0 ? ids[ids.length - 1] : undefined;
  void studio.setLinkFocus(browseCursor);
}
/** The live node-view canvas, if the deck is in Node view. Held so the centre
 *  can tear it down: a Konva stage owns window listeners and an observer. */
let nodeView: MountedNodeView | undefined;
/** The live map canvas, held for the same reason. */
let mapView: MountedMapView | undefined;
/** Which spatial group each box's map is showing, for this session. Not persisted:
 *  which of a box's maps you were last looking at is a glance, not a decision. */
/** Which spatial group each box's map is showing. Seeded from the user's state
 *  at boot and written through on the pick: the map is a box's landing page, so
 *  which map is part of where the author was. */
const mapGroup = new Map<string, string>();

/**
 * Arriving SIDEWAYS: from a canvas, from Find, from Links. Up and back are two
 * moves, and this is the one the hierarchy cannot answer (structure rule 12).
 *
 * Every navigation clears it, so the return is offered exactly once and only where
 * it makes sense; `arriving` is the flag that lets the sideways jump itself set it
 * without immediately wiping it again.
 */
let arriving = false;
function goingSomewhere(): void {
  // Popovers do not survive navigation: a WHERE picker floating over a
  // different page taught nobody anything (the audit's orphan find). The
  // anchored panel closes through its own door; the body-portaled poppers
  // (ours and the expression editor's) are removed directly - their
  // click-away listeners self-heal on the next pointer-down.
  closeAnchoredPanel();
  for (const n of document.querySelectorAll(".popover, .ctxmenu, .exed-pop")) n.remove();
  if (!arriving) setCameFrom(undefined);
  // Every navigation records the place it LEAVES (the browser model, shell's
  // createNavHistory) - except a back/forward restore itself, which travels
  // through these same actions and must not push what it just left.
  if (!travelling) { const here = capturePlace(); if (here) history.visit(here); }
}
/** Navigate, and remember the way back here. */
function arriveFrom(label: string, back: () => void, navigate: () => void): void {
  arriving = true;
  try { navigate(); } finally { arriving = false; }
  setCameFrom({ label, go: () => { setCameFrom(undefined); back(); } });
  renderWorkspace();
}

/** Where the author is standing: focus + open document + its tab, the one
 *  shape rememberPlace persists, returnHere labels and the history stacks. */
interface CapturedPlace { focus: Focus; inspected?: Inspected; key?: string; tab?: string }
function capturePlace(): CapturedPlace | undefined {
  if (!project || !focus) return undefined;
  const f = { ...focus } as Focus;
  const doc = inspected ? { ...inspected } as Inspected : undefined;
  const key = doc === undefined ? undefined
    : doc.kind === "card" ? `card:${doc.deck}:${doc.card}`
    : doc.kind === "deck" ? `deck:${doc.deck}`
    : doc.kind === "box" ? `box:${doc.box}`
    : doc.kind === "template" ? `template:${doc.template}`
    : doc.kind === "hand" ? `hand:${doc.hand}`
    : `tagGroup:${doc.group}`;
  const tab = key === undefined ? undefined : docTabFor(key);
  return { focus: f, ...(doc ? { inspected: doc } : {}), ...(key !== undefined ? { key } : {}), ...(tab !== undefined ? { tab } : {}) };
}

/** Re-dispatch through the same actions the original navigation used, so the
 *  document's detail loads the way it always does. */
function restorePlace(p: CapturedPlace): void {
  const doc = p.inspected;
  if (doc?.kind === "card") actions.inspectCard(doc.box, doc.deck, doc.card);
  else if (doc?.kind === "template") actions.inspectTemplate(doc.box, doc.template);
  else if (doc?.kind === "tagGroup") actions.inspectTagGroup(doc.box, doc.group);
  else if (doc?.kind === "hand") actions.inspectHand(doc.box, doc.hand);
  else actions.focus(p.focus);
  if (p.key !== undefined && p.tab !== undefined) setDocTab(p.key, p.tab);
  renderWorkspace();
}

/** Still restorable against the project as it is NOW? A place whose document
 *  was deleted since (a merge, a VC update, plain editing) must be skipped,
 *  not restored into a blank page. */
function placeUsable(p: CapturedPlace): boolean {
  if (!project) return false;
  if (p.focus.kind === "story" || p.focus.kind === "project") return true;
  const box = project.boxes.find((b) => b.id === p.focus.box);
  if (!box) return false;
  const doc = p.inspected;
  if (doc?.kind === "card") return box.decks.some((d) => d.id === doc.deck && d.cards.some((c) => c.id === doc.card));
  if (doc?.kind === "deck" || p.focus.kind === "deck") {
    const id = doc?.kind === "deck" ? doc.deck : (p.focus as { deck: string }).deck;
    return box.decks.some((d) => d.id === id);
  }
  if (doc?.kind === "template") return box.templates.some((t) => t.id === doc.template);
  if (doc?.kind === "hand") return box.hands.some((h) => h.id === doc.hand);
  if (doc?.kind === "tagGroup") return box.tagGroups.some((g) => g.id === doc.group);
  return true;   // box / decks / hands pages: the box exists, that is enough
}

/** Same DOCUMENT: tab and selection twitches coalesce instead of stacking. */
const samePlace = (a: CapturedPlace, b: CapturedPlace): boolean =>
  a.focus.kind === b.focus.kind && a.focus.box === b.focus.box
  && (a.focus.kind !== "deck" || a.focus.deck === (b.focus as { deck?: string }).deck)
  && (a.key ?? "") === (b.key ?? "");

/** The back/forward stack (the shell's, over our own idea of a place). */
const history = createNavHistory<CapturedPlace>({ same: samePlace, usable: placeUsable });
let histPair: ReturnType<typeof historyNav> | undefined;
let travelling = false;
function travel(step: (current: CapturedPlace) => CapturedPlace | undefined): void {
  const current = capturePlace();
  if (!current) return;
  const there = step(current);
  if (!there) return;
  travelling = true;
  try { restorePlace(there); } finally { travelling = false; }
}

/**
 * Where the author is standing right now, as an arriveFrom return: a label
 * naming the open document and the way back to it, tab included.
 */
function returnHere(): { label: string; go: () => void } | undefined {
  const place = capturePlace();
  if (!place || !project) return undefined;
  const doc = place.inspected;
  const box = place.focus.box === undefined ? undefined : project.boxes.find((b) => b.id === place.focus.box);
  let label = place.focus.kind === "story" ? "Story" : place.focus.kind === "project" ? project.name
    : box?.title ?? box?.gameId ?? "where you were";
  if (doc?.kind === "card") {
    const card = box?.decks.find((d) => d.id === doc.deck)?.cards.find((c) => c.id === doc.card);
    if (card?.title) label = card.title;
  } else if (doc?.kind === "deck") {
    const deck = box?.decks.find((d) => d.id === doc.deck);
    if (deck?.title) label = deck.title;
  }
  return { label, go: () => restorePlace(place) };
}
let pendingFocusTitle = false;          // autofocus the title after a create
let focusTitleTimer: ReturnType<typeof setTimeout> | undefined;
let focus: Focus | undefined;
let inspected: Inspected | undefined;
let catalogue: ConditionProperty[] = [];
let catalogueDeck: string | undefined;
let catalogueBox: string | undefined;
let detail: Detail | undefined;
let navExpanded = new Set<string>();
let welcomeError = "";

const app = document.getElementById("app")!;

// --- theming -----------------------------------------------------------------
async function setTheme(theme: ThemeChoice): Promise<void> {
  applyTheme(theme);
  await remember("theme", theme);
  if (!project) renderWelcome();
}

// --- welcome -----------------------------------------------------------------
//
// Three jobs, kept apart (2026-08-29, the author: "a sea of text", and "some
// separation between the various functions of that entrypoint page"). They are
// START (open or make one), LEARN (the shipped examples) and RETURN (recents),
// and before this pass they were one centred column of eleven stacked things
// with a theme picker on the end.
//
// Patterpad-first, read before designing: its welcome is a CARD of min(34rem)
// centred in the space the panes would take, a title, one italic sub, two
// dialog-opening buttons, and recents as two-line items. We take the card, the
// geometry and the recents shape; we are wider because we have examples to lay
// out, and we caption the three groups because we have three where it has two.
//
// Two things came OFF, both duplicates rather than losses:
//   - the theme row: five buttons of app settings, on the first screen, and
//     already in the menu (as they are in Patterpad, which has no theme control
//     on its welcome at all)
//   - the inline name box: it called createProject DIRECTLY, so the welcome's
//     Create was the one New Project path that never saw the kit picker. With
//     project kits arriving that would have been the path that silently offered
//     none of them. Now both routes are openNewProject.
function renderWelcome(): void {
  liveLinkChip?.setVisible(false);   // Live Link: no project, no control
  // THE WORKED EXAMPLES, which shipped in the repo and were never offered
  // (design review 2026-08, B10). For an app whose main obstacle is its
  // concepts, a finished project is the cheapest teaching surface there is. A
  // kit gives you a starting shape; an example shows you a finished one, and
  // the concepts are learned from the finished one.
  //
  // Three sizes of teaching, side by side rather than stacked so they read as
  // three choices at one glance instead of a list to work down.
  const examples = [
    { file: "the-hamlet.storylets", name: "The Hamlet", size: "Small",
      hint: "Places, hands and a deck to deal. Start here." },
    { file: "the-village.storylets", name: "The Village", size: "Full",
      hint: "Thirteen decks, a drawn map, qualities at work." },
    { file: "port-meridian.storylets", name: "Port Meridian", size: "With a game",
      hint: "Five boxes driving contracts, encounters, items, codex and news." },
  ];
  const group = (label: string, ...body: (Node | null)[]): HTMLElement =>
    el("section", { className: "wel-group" },
      el("h2", { className: "wel-label", text: label }), ...body);

  app.replaceChildren(el("div", { className: "welcome" }, el("div", { className: "welcome-card" },
    el("h1", { className: "wel-title", text: "Storyletter" }),
    el("p", { className: "wel-sub", text: "Which story beat happens next? Open a project and deal a hand." }),

    group("Start",
      el("div", { className: "wel-actions" },
        el("button", { className: "primary", text: "Open a project…", onClick: () => void adopt(studio.openProjectDialog()) }),
        el("button", { text: "New project…", onClick: () => openNewProject() }))),

    // An example is never opened in place (it lives inside the installed app,
    // which is read-only and replaced by the next update), so clicking one asks
    // for a folder. Say so BEFORE the click: the folder chooser arriving
    // unannounced reads as the wrong dialog rather than the second half of Open.
    group("Learn from a finished project",
      el("p", { className: "wel-note", text: "Each opens as your own copy, in a folder you choose." }),
      el("div", { className: "wel-examples" },
        ...examples.map((x) => el("button", { className: "wel-example", onClick: () => void adopt(studio.openExample(x.file)) },
          el("span", { className: "wel-example-size", text: x.size }),
          el("span", { className: "wel-example-name", text: x.name }),
          el("span", { className: "wel-example-hint", text: x.hint }))))),

    state.recents.length > 0
      // What the project CALLS itself, with the folder stem as the fallback for
      // an entry recorded before names were stored (app-shell 0.25.0). The path
      // stays beside it: two projects may legitimately share a name, and the
      // folder is how you tell them apart.
      ? group("Recent", el("div", { className: "wel-recents" },
        ...state.recents.slice(0, 5).map((recent) => {
          const stem = baseName(recent.path).replace(/\.storylets$/, "");
          return el("button", { className: "wel-recent", onClick: () => void adopt(studio.openProjectPath(recent.path)) },
            el("span", { className: "wel-recent-name", text: recent.name ?? stem }),
            el("span", { className: "wel-recent-path", text: recent.path }));
        })))
      : null,

    welcomeError ? el("p", { className: "error", text: welcomeError }) : null,
  )));
}

// --- navigation + selection ---------------------------------------------------
const actions: ViewActions = {
  focus(next: Focus): void {
    goingSomewhere();
    void flushSaves();   // persist the previous selection before switching
    focus = next;
    if (next.kind === "deck") { inspected = { kind: "deck", box: next.box, deck: next.deck }; }
    else if (next.kind === "box") inspected = { kind: "box", box: next.box };
    else inspected = undefined;
    renderWorkspace();
  },
  // Opening a card also selects it, so coming back to any view of the deck (the
  // canvas included) shows where you were.
  inspectCard(box, deck, card) { goingSomewhere(); void flushSaves(); focus = { kind: "deck", box, deck }; inspected = { kind: "card", box, deck, card }; selectCards([card]); void loadCatalogue(deck); },
  // Setup items (templates, tag groups) open as centre documents while the
  // focus stays the box: their home is the box page's setup tab, not a nav
  // collection, so the nav lights the box row (the Mail model, rule 9).
  inspectTemplate(box, template) { goingSomewhere(); void flushSaves(); setDocTab(`box:${box}`, "templates"); focus = { kind: "box", box }; inspected = { kind: "template", box, template }; detail = undefined; renderWorkspace(); void loadTemplateDetail(box, template); },
  inspectTagGroup(box, group) { goingSomewhere(); void flushSaves(); setDocTab(`box:${box}`, "tags"); focus = { kind: "box", box }; inspected = { kind: "tagGroup", box, group }; detail = undefined; renderWorkspace(); void loadTagGroupDetail(box, group); },
  inspectHand(box, hand) { goingSomewhere(); void flushSaves(); focus = { kind: "hands", box }; inspected = { kind: "hand", box, hand }; detail = undefined; renderWorkspace(); void loadHandDetail(box, hand); },
  newCard(box, deck) {
    void (async () => {
      const created = await studio.createCard(deck);
      if (!ok(created)) return;
      applyResult(created.result);
      pendingFocusTitle = true;
      // Creation is authoring from the top: the new document opens on its
      // default tab, recorded as the type's choice (the one carve-out from
      // the sticky-tab ruling, design/editor-legibility.md piece 6).
      setDocTab(`card:${deck}/${created.cardId}`, "dealing");
      actions.inspectCard(box, deck, created.cardId);
    })();
  },
  newDeck(box) {
    void (async () => {
      const created = await studio.createDeck(box);
      if (!ok(created)) return;
      applyResult(created.result);
      pendingFocusTitle = true;
      setDocTab(`deck:${created.deckId}`, "cards");
      actions.focus({ kind: "deck", box, deck: created.deckId });
    })();
  },
  newBox() {
    // The New Box moment is a kit picker (RebootAmendments A10): Blank always
    // present, RPG the narrated starter. Kits are scaffold - the box is yours
    // (and indistinguishable from hand-made) the moment it lands.
    openBoxKitPicker((kit) => {
      void (async () => {
        const created = await studio.createBox(kit);
        if (!ok(created)) return;
        applyResult(created.result);
        actions.focus({ kind: "box", box: created.boxId });
      })();
    });
  },
  duplicateBox(box) {
    void (async () => {
      await flushSaves();
      const created = await studio.duplicateBox(box);
      if (!ok(created)) return;
      applyResult(created.result);
      actions.focus({ kind: "box", box: created.boxId });
    })();
  },
  deleteBox(box) {
    const b = project?.boxes.find((x) => x.id === box);
    if (!b) return;
    const cards = b.decks.reduce((n, d) => n + d.cards.length, 0);
    const what = `${b.decks.length} deck${b.decks.length === 1 ? "" : "s"}, ${cards} card${cards === 1 ? "" : "s"}, ${b.hands.length} hand${b.hands.length === 1 ? "" : "s"}`;
    void (async () => {
      const ok = await confirmDialog({
        title: `Delete "${b.title ?? b.gameId}"?`,
        body: `The box and its contents (${what}) are removed. Undo restores it.`,
        confirmLabel: "Delete box",
      });
      if (!ok) return;
      const result = await studio.deleteBox(box);
      if (!applied(result)) return;
      focus = defaultFocus();
      inspected = focus?.kind === "deck" ? { kind: "deck", box: focus.box, deck: focus.deck } : undefined;
      detail = undefined;
      renderWorkspace();
    })();
  },
  newTemplate(box) { inspectorHost.createTemplate(box); },
  newTagGroup(box) { inspectorHost.createTagGroup(box); },
  newMap(box) { inspectorHost.createMap(box); },
  newHand(box) { inspectorHost.createHand(box); },
  editBox(box) { setDocTab(`box:${box}`, "template"); actions.focus({ kind: "box", box }); },
  toggleNav(id) {
    if (navExpanded.has(id)) navExpanded.delete(id); else navExpanded.add(id);
    void studio.setNavExpanded([...navExpanded]);
    renderNavPane();
  },
  openProjectSettings() { if (project) projectSettingsPanel.open(); },
  revealProject() { studio.revealProject(); },
  saveDeck(deckId, edit) { inspectorHost.saveDeck(deckId, edit); },
  saveBox(boxId, edit) { saveBoxIdentityNow(boxId, edit); },
  duplicateCard(box, deck, card) {
    void (async () => {
      await flushSaves();
      const created = await studio.duplicateCard(deck, card);
      if (!ok(created)) return;
      applyResult(created.result);
      actions.inspectCard(box, deck, created.cardId);
    })();
  },
  // Every route to deleting a card goes through the guard: the context menus in
  // all three views, the Delete key, and the canvas.
  deleteCard(_box, _deck, card) { void deleteCards([card]); },
  // Asking about a card does not select it: the lens is pointed straight at it, so
  // a look at what touches a card leaves the editor exactly where it was.
  showLinks(card) { void studio.openLinks(card); },
  moveBox(box, target, before) { void (async () => { const r = await studio.moveBox(box, target, before); if ("error" in r) { flashError(r.error); return; } applyResult(r); renderWorkspace(); })(); },
  moveDeck(_box, deck, target, before) { void (async () => { const r = await studio.moveDeck(deck, target, before); if ("error" in r) { flashError(r.error); return; } applyResult(r); renderWorkspace(); })(); },
  moveHand(box, hand, target, before) { void (async () => { const r = await studio.moveHand(box, hand, target, before); if ("error" in r) { flashError(r.error); return; } applyResult(r); renderWorkspace(); })(); },
  duplicateDeck(box, deck) {
    void (async () => {
      await flushSaves();
      const created = await studio.duplicateDeck(deck);
      if (!ok(created)) return;
      applyResult(created.result);
      actions.focus({ kind: "deck", box, deck: created.deckId });
    })();
  },
  deleteDeck(box, deck) { inspectorHost.deleteDeck(box, deck); },
  duplicateTemplate(box, template) {
    void (async () => {
      await flushSaves();
      const created = await studio.duplicateTemplate(box, template);
      if (!ok(created)) return;
      applyResult(created.result);
      actions.inspectTemplate(box, created.templateId);
    })();
  },
  deleteTemplate(box, template) { inspectorHost.deleteTemplate(box, template); },
  duplicateHand(box, hand) {
    void (async () => {
      await flushSaves();
      const created = await studio.duplicateHand(box, hand);
      if (!ok(created)) return;
      applyResult(created.result);
      actions.inspectHand(box, created.handId);
    })();
  },
  deleteHand(box, hand) { inspectorHost.deleteHand(box, hand); },
  duplicateTagGroup(box, group) {
    void (async () => {
      await flushSaves();
      const created = await studio.duplicateTagGroup(box, group);
      if (!ok(created)) return;
      applyResult(created.result);
      actions.inspectTagGroup(box, created.groupId);
    })();
  },
  deleteTagGroup(box, group) { inspectorHost.deleteTagGroup(box, group); },
  selectCard(card, extend) {
    const next = extend
      ? (cardSelection.includes(card) ? cardSelection.filter((id) => id !== card) : [...cardSelection, card])
      : [card];
    selectCards(next);
    renderCentre();
  },
  setViewMode(mode) { void remember("viewMode", mode); renderCentre(); },
  openThreads(id) { return project?.threads?.[id] ?? 0; },
  showComments(id, subject, anchor) {
    void (async () => {
      const threads = await studio.commentsFor(id);
      openComments({
        anchor, subject, threads,
        showResolved: state.showResolved,
        newThreadId: () => `cmt_${Math.random().toString(36).slice(2, 10)}`,
        post: (threadId, body) => {
          void (async () => {
            const result = await studio.postComment(id, threadId, body);
            if (!applied(result)) return;
            void refreshVc();
            // renderWORKSPACE, not renderCentre: the bubble has to be redrawn (the
            // count it read came from the project DTO), and a card or a hand is
            // rendered by the editor dispatch that renderCentre skips. Calling
            // the wrong one threw you back to the deck the moment you posted on a
            // card - found by using it, not by a test.
            renderWorkspace();
            // And the markers, because this thread may BE one: posting on a card
            // from its editor changes the badge on the marker sitting beside that
            // card on the deck's canvas.
            void refreshCurrentMarkers();
            void gatherReview();
          })();
        },
        setResolved: (threadId, resolved) => {
          void (async () => {
            const result = await studio.setCommentResolved(threadId, resolved);
            if (!applied(result)) return;
            void refreshVc();
            renderWorkspace();
            // A resolved thread's marker is drawn quietly rather than removed, so
            // it has to be redrawn to change.
            void refreshCurrentMarkers();
            // And it leaves (or joins) the walk, depending on Show Resolved.
            void gatherReview();
          })();
        },
        deleteMessage,
      });
    })();
  },
  mountNodeView(host, deck) {
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
      nodeView?.destroy();
      nodeView = mountNodeView(host, deck, graph, cardSelection, {
        open: (cardId) => {
          const box = currentBox();
          if (box) actions.inspectCard(box.id, deck.id, cardId);
        },
        select: (cardIds) => selectCards(cardIds),
        setFurniture: (furniture, label, coalesce) => {
          const box = currentBox();
          if (!box) return;
          void (async () => {
            const result = await studio.setCanvasFurniture(
              box.id, { kind: "deck", deck: deck.id }, furniture, label, coalesce);
            if (!applied(result)) return;
            void refreshVc();
            renderCentre();
          })();
        },
        duplicate: (cardId) => {
          const box = currentBox();
          if (box) actions.duplicateCard(box.id, deck.id, cardId);
        },
        remove: (cardId) => {
          const box = currentBox();
          if (box) actions.deleteCard(box.id, deck.id, cardId);
        },
        showLinks: (cardId) => actions.showLinks(cardId),
        addAt: (at, pinned) => {
          void (async () => {
            // One call, one commit, one undo step: the card and its position are
            // the same act, and pinning the others means nothing else shifts.
            const created = await studio.createCardOnCanvas(deck.id, at, pinned);
            if (!ok(created)) return;
            applyResult(created.result);
            selectCards([created.cardId]);
            renderCentre();
          })();
        },
        removeMany: (cardIds) => { void deleteCards(cardIds); },
        layOut: async (ids, current, size) => {
          const laid = await studio.layoutDeck(deck.id, ids, current, size);
          if ("error" in laid) { flashError(laid.error); return undefined; }
          applyResult(laid.result);
          void refreshVc();
          return { positions: laid.positions, cycles: laid.cycles };
        },
        moved: (placements) => {
          void (async () => {
            const result = await studio.moveCardsOnCanvas(deck.id, placements);
            if ("error" in result) { flashError(result.error); return; }
            // Deliberately NOT renderCentre(): the canvas already shows the move,
            // and rebuilding the centre would throw the canvas away mid-arranging,
            // losing the camera and the selection after every single drop.
            applyResult(result);
            // The sidecar changed on disk, so the version-control chip and badges
            // are now stale; the centre itself is not.
            void refreshVc();
          })();
        },
        // --- comment markers (design/annotation.md 3) ------------------------
        //
        // Held in a local list rather than read from the project DTO, because a
        // marker carries more than a count: which kind it is, its badge and its
        // hover line, all resolved in main. Re-fetched after every change, and
        // repainted through the marker group alone so the canvas is not rebuilt.
        markers: () => markerList,
      coverage: () => coverage,
      coverageOn: () => state.coverageOverlay,
        openThread: (threadId, anchor) => {
          showThread(threadId, anchor, canvasId({ kind: "deck", deck: deck.id }));
        },
        startThread: (at, item, anchor) => {
          startThread(canvasId({ kind: "deck", deck: deck.id }), at, item, anchor);
        },
        moveMarker: (threadId, x, y, item) => {
          void (async () => {
            const result = await studio.moveComment(
              threadId, canvasId({ kind: "deck", deck: deck.id }), x, y, item);
            if (!applied(result)) return;
            void refreshVc();
            void refreshMarkers(canvasId({ kind: "deck", deck: deck.id }));
          })();
        },
      });
      // The canvas hands back its own marker repaint, so a refresh does not have
      // to know which canvas is mounted.
      repaintMarkers = () => nodeView?.repaintMarkers();
      refreshCoverage = () => nodeView?.refreshCoverage();
      openMarkerOn = (id) => nodeView?.openMarker(id) ?? false;
      void refreshMarkers(canvasId({ kind: "deck", deck: deck.id }));
    })();
  },
  mountMapView(host, box) {
    void (async () => {
      // The same chunking as the node view: Konva only loads for a session that
      // actually opens a canvas.
      const [{ mountMapView }, map] = await Promise.all([
        import("./map-view.js"),
        studio.boxMap(box.id, mapGroup.get(box.id)),
      ]);
      // The centre may have moved on while main was reading (a click, a save):
      // mounting into a detached container leaks a canvas nothing can reach.
      if (!host.isConnected) return;
      mapView?.destroy();
      /** A map edit that changed a shard: take the result, and repaint the canvas
       *  from the new truth. Unlike a card drag (which the canvas has already
       *  drawn), a placed zone or a re-bound pin changes what the map IS. */
      const applyAndRedraw = (result: OpenResult | { error: string }): void => {
        if (!applied(result)) return;
        void refreshVc();
        renderCentre();
      };
      const group = map.groupId ?? "";
      /** Back to this map: the box page, on its Map tab, with this group showing. */
      const backToMap = (): void => {
        setDocTab(`box:${box.id}`, "map");
        actions.focus({ kind: "box", box: box.id });
      };
      mapView = mountMapView(host, box.id, map, {
        // Opening a zone or a hand from the map is a SIDEWAYS arrival: the thing's
        // parent is not where the author came from, so the page offers the way back
        // here as well as the way up (structure rule 12).
        openZone: () => arriveFrom("Map", backToMap, () => actions.inspectTagGroup(box.id, group)),
        openHand: (handId) => arriveFrom("Map", backToMap, () => actions.inspectHand(box.id, handId)),
        // A traced shape for a zone that exists, and one for a zone that does not:
        // both change what the map IS, so both repaint it from the new truth.
        placeZone: (tagId, polygon) => {
          void (async () => {
            const shaped = await studio.setZonePolygon(box.id, group, tagId, polygon);
            if ("error" in shaped) { flashError(shaped.error); return; }
            applyAndRedraw(shaped.result);
          })();
        },
        newZone: (polygon) => {
          void (async () => {
            const created = await studio.createZone(box.id, group, polygon);
            if ("error" in created) { flashError(created.error); return; }
            applyAndRedraw(created.result);
          })();
        },
        reshapeZone: (tagId, polygon) => {
          void (async () => {
            // An empty polygon clears the outline, which takes the zone off the map:
            // that changes the map's shape, so it is a redraw rather than a quiet save.
            const shaped = await studio.setZonePolygon(box.id, group, tagId, polygon.length === 0 ? undefined : polygon);
            if ("error" in shaped) { flashError(shaped.error); return; }
            if (polygon.length === 0) { applyAndRedraw(shaped.result); return; }
            applyResult(shaped.result);
            // A dragged outline can take hands in and turn others loose. The canvas
            // is still up and holding a selection, so it is TOLD rather than rebuilt.
            mapView?.rebound(shaped.rebound);
            void refreshVc();
          })();
        },
        addBackground: (place) => {
          void (async () => {
            const added = await studio.addBackground(box.id, group, place);
            if (added === null) return;                       // cancelled
            if ("error" in added) { flashError(added.error); return; }
            // A new picture changes what the map IS, so it is re-read rather than
            // patched: the canvas has never heard of this file.
            applyAndRedraw(added.result);
          })();
        },
        editBackground: (id, edit, opts) => {
          void (async () => {
            const result = await studio.editBackground(box.id, group, id, edit, opts);
            if ("error" in result) { flashError(result.error); return; }
            // A drag or a scale: the canvas has already drawn it, so this is a
            // quiet save. Anything else (hide, lock) changes what the map OFFERS,
            // so the view is re-read.
            const quiet = opts?.coalesce === true;
            if (quiet) { applyResult(result); void refreshVc(); return; }
            applyAndRedraw(result);
          })();
        },
        restackBackground: (id, move) => {
          void (async () => {
            const result = await studio.restackBackground(box.id, group, id, move);
            if ("error" in result) { flashError(result.error); return; }
            applyAndRedraw(result);   // the drawing order changed: re-read it
          })();
        },
        removeBackground: (id) => {
          void (async () => {
            const result = await studio.removeBackground(box.id, group, id);
            if ("error" in result) { flashError(result.error); return; }
            applyAndRedraw(result);
          })();
        },
        restackZone: (tagId, move) => {
          void (async () => {
            const moved = await studio.restackZone(box.id, group, tagId, move);
            if ("error" in moved) { flashError(moved.error); return; }
            // The drawing order changed, so the canvas is re-read rather than
            // told: which zone is in front is what the whole picture is made of.
            applyAndRedraw(moved.result);
          })();
        },
        removeSite: (handId) => {
          // The map changes shape (the hand joins the "waiting to be placed" chips
          // again), so this is a redraw rather than a quiet save.
          void (async () => applyAndRedraw(await studio.removeSitesFromMap(box.id, [handId])))();
        },
        movedSites: (moves) => {
          void (async () => {
            const moved = await studio.moveSitesOnMap(box.id, group, moves);
            if ("error" in moved) { flashError(moved.error); return; }
            // NOT renderCentre() for a drag: the canvas has already drawn it, and a
            // rebuild mid-arranging would cost the camera and the selection after
            // every drop (the node view learnt this). A PLACEMENT is different: the
            // pin was not on the map before, so the strip's "waiting to be placed"
            // chips have changed and the map has to be re-read.
            const placed = moves.some((m) => !map.sites.some((p) => p.id === m.id));
            if (placed) { applyAndRedraw(moved.result); return; }
            applyResult(moved.result);
            // A rebinding is a change to the HAND, so the canvas recolours from
            // main's answer rather than from its own guess about the geometry.
            mapView?.rebound(moved.rebound);
            void refreshVc();
          })();
        },
        showGroup: (groupId) => {
          mapGroup.set(box.id, groupId);
          void studio.setMapGroups(Object.fromEntries(mapGroup));
          renderCentre();
        },
        setFurniture: (furniture, label, coalesce) => {
          void (async () => {
            applyAndRedraw(await studio.setCanvasFurniture(box.id, { kind: "map" }, furniture, label, coalesce));
          })();
        },
        // The same four as the node view. A map has no id of its own, so its
        // canvas borrows the box's behind the `map:` prefix (canvasId).
        markers: () => markerList,
      coverage: () => coverage,
      coverageOn: () => state.coverageOverlay,
        openThread: (threadId, anchor) => {
          showThread(threadId, anchor, canvasId({ kind: "map", box: box.id }));
        },
        startThread: (at, item, anchor) => {
          startThread(canvasId({ kind: "map", box: box.id }), at, item, anchor);
        },
        moveMarker: (threadId, x, y, item) => {
          void (async () => {
            const canvas = canvasId({ kind: "map", box: box.id });
            const result = await studio.moveComment(threadId, canvas, x, y, item);
            if (!applied(result)) return;
            void refreshVc();
            void refreshMarkers(canvas);
          })();
        },
      });
      repaintMarkers = () => mapView?.repaintMarkers();
      refreshCoverage = () => mapView?.refreshCoverage();
      openMarkerOn = (id) => mapView?.openMarker(id) ?? false;
      void refreshMarkers(canvasId({ kind: "map", box: box.id }));
    })();
  },
  moveCard(_box, deck, card, target, before) {
    void (async () => {
      await flushSaves();
      const result = await studio.moveCard(deck, card, target, before);
      if ("error" in result) { flashError(result.error); return; }
      applyResult(result); renderCentre();
    })();
  },
};

async function loadCatalogue(deckId: string): Promise<void> {
  catalogueDeck = deckId; catalogueBox = undefined;
  catalogue = await studio.cardCatalogue(deckId);
  // The card edits in the centre now; don't force the inspector open (that would
  // steal the width the editor needs). The preview shows if it is already open.
  renderWorkspace();
}
async function loadBoxCatalogue(boxId: string): Promise<void> {
  catalogueBox = boxId; catalogueDeck = undefined;
  catalogue = await studio.boxCatalogue(boxId);
  renderWorkspace();
}
function ensureBoxCatalogue(boxId: string): void {
  if (catalogueBox !== boxId) { catalogueBox = boxId; void loadBoxCatalogue(boxId); }
}
// Keep the focused deck's catalogue loaded so card faces can preview conditions.
// Set catalogueDeck optimistically at fetch start to avoid a render→fetch loop.
function ensureCatalogue(deckId: string): void {
  if (catalogueDeck === deckId) return;
  catalogueDeck = deckId; catalogueBox = undefined;
  void (async () => { catalogue = await studio.cardCatalogue(deckId); renderWorkspace(); })();
}
async function loadTemplateDetail(boxId: string, templateId: string): Promise<void> {
  const t = await studio.templateDetail(boxId, templateId);
  if (inspected?.kind === "template" && inspected.template === templateId && t) { detail = { kind: "template", template: t }; renderWorkspace(); }
}
async function loadHandDetail(boxId: string, handId: string): Promise<void> {
  const hand = await studio.handDetail(boxId, handId);
  if (inspected?.kind === "hand" && inspected.hand === handId && hand) { detail = { kind: "hand", hand }; renderWorkspace(); }
}
async function loadTagGroupDetail(boxId: string, groupId: string): Promise<void> {
  const g = await studio.tagGroupDetail(boxId, groupId);
  if (inspected?.kind === "tagGroup" && inspected.group === groupId && g) { detail = { kind: "tagGroup", group: g }; renderWorkspace(); }
}
// A Find hit opens the item's own editor (v3: items are first-class docs).
// Hits arrive over IPC from the detached Find window (Cmd+F).
function applySearchSelection(sel: SearchSelection): void {
  if (!project) return;
  if (sel.kind === "card") actions.inspectCard(sel.box, sel.deck, sel.card);
  else if (sel.kind === "deck") actions.focus({ kind: "deck", box: sel.box, deck: sel.deck });
  else if (sel.kind === "template") actions.inspectTemplate(sel.box, sel.template);
  else if (sel.kind === "hand") actions.inspectHand(sel.box, sel.hand);
  else actions.inspectTagGroup(sel.box, sel.group);
}

// --- inspector host (editing) --------------------------------------------------
function saveBoxIdentityNow(boxId: string, edit: BoxEdit): void {
  void (async () => {
    const result = await studio.saveBox(boxId, edit);
    if ("error" in result) { flashError(result.error); return; }
    applyResult(result); renderNavPane();
  })();
}
const inspectorHost: InspectorHost = {
  // The same four the views get: one implementation, in `actions`.
  openThreads: (id) => actions.openThreads(id),
  showComments: (id, subject, anchor) => actions.showComments(id, subject, anchor),
  saveCard: (deckId, cardId, edit) => queueCard(deckId, cardId, edit),
  saveDeck: (deckId, edit) => void (async () => {
    const result = await studio.renameDeck(deckId, edit);
    if ("error" in result) { flashError(result.error); return; }
    // The deck heading / inspector are a live editor - repaint the browse views
    // (nav title, problems) but not the editor the author is in.
    applyResult(result); renderNavPane();
  })(),
  // Through the guard, like every other route to deleting a card: this one is the
  // card's own page, where the content at risk is on screen in front of you.
  deleteCard: (_deckId, cardId) => void deleteCards([cardId]),
  deleteDeck: (boxId, deckId) => void (async () => {
    const result = await studio.deleteDeck(deckId);
    if ("error" in result) { flashError(result.error); return; }
    applyResult(result); focus = { kind: "box", box: boxId }; inspected = { kind: "box", box: boxId }; renderWorkspace();
  })(),
  saveBox: (boxId, edit: BoxEdit) => queueStruct(() => studio.saveBox(boxId, edit)),
  saveDeckConfig: (deckId, edit) => queueStruct(() => studio.renameDeck(deckId, edit)),
  saveBoxIdentity: (boxId, edit) => saveBoxIdentityNow(boxId, edit),
  saveTemplate: (boxId, templateId, edit: TemplateEdit) => queueStruct(() => studio.saveTemplate(boxId, templateId, edit)),
  saveTagGroup: (boxId, groupId, edit: TagGroupEdit) => queueStruct(() => studio.saveTagGroup(boxId, groupId, edit)),
  createTemplate: (boxId) => void (async () => {
    const created = await studio.createTemplate(boxId);
    if ("error" in created) { flashError(created.error); return; }
    applyResult(created.result); actions.inspectTemplate(boxId, created.templateId);
  })(),
  deleteTemplate: (boxId, templateId) => void (async () => {
    const result = await studio.deleteTemplate(boxId, templateId);
    if ("error" in result) { flashError(result.error); return; }
    applyResult(result); detail = undefined;
    setDocTab(`box:${boxId}`, "templates"); actions.focus({ kind: "box", box: boxId });
  })(),
  saveHand: (boxId, handId, edit) => queueStruct(() => studio.saveHand(boxId, handId, edit)),
  createHand: (boxId) => void (async () => {
    const created = await studio.createHand(boxId);
    if ("error" in created) { flashError(created.error); return; }
    applyResult(created.result); actions.inspectHand(boxId, created.handId);
  })(),
  deleteHand: (boxId, handId) => void (async () => {
    const result = await studio.deleteHand(boxId, handId);
    if ("error" in result) { flashError(result.error); return; }
    applyResult(result); detail = undefined; actions.focus({ kind: "hands", box: boxId });
  })(),
  createTagGroup: (boxId) => void (async () => {
    const created = await studio.createTagGroup(boxId);
    if ("error" in created) { flashError(created.error); return; }
    applyResult(created.result); actions.inspectTagGroup(boxId, created.groupId);
  })(),
  // The same group, already a map. Composed from the two existing calls rather
  // than given its own main-side path: a map is not a second kind of thing, and
  // a second write path is how the two would drift.
  createMap: (boxId) => void (async () => {
    const created = await studio.createTagGroup(boxId);
    if ("error" in created) { flashError(created.error); return; }
    applyResult(created.result);
    const spatial = await studio.setGroupSpatial(boxId, created.groupId, true);
    if (!applied(spatial)) return;
    actions.inspectTagGroup(boxId, created.groupId);
    renderWorkspace();   // the Map tab appears
    void refreshVc();
  })(),
  setGroupSpatial: (boxId, groupId, on) => void (async () => {
    const result = await studio.setGroupSpatial(boxId, groupId, on);
    if (!applied(result)) return;
    // The whole box page repaints: the Map tab appears or goes, and the group's own
    // page has to show the switch in its new state.
    renderWorkspace();
    void refreshVc();
  })(),
  deleteTagGroup: (boxId, groupId) => void (async () => {
    const result = await studio.deleteTagGroup(boxId, groupId);
    if ("error" in result) { flashError(result.error); return; }
    applyResult(result); detail = undefined;
    setDocTab(`box:${boxId}`, "tags"); actions.focus({ kind: "box", box: boxId });
  })(),
};

// --- comment markers on a canvas (design/annotation.md 3) ---------------------
//
// Held here rather than in either canvas, because both canvases want the same
// three things and neither should own them: the resolved marker list, the
// threads behind it, and one popover.
//
// The list is separate from the project DTO's `threads` counts on purpose. A
// count is enough for a document's bubble; a marker needs where it is, which
// kind it is, its badge and its hover line, all of which main resolves.

/** The markers on the canvas currently mounted, as main resolved them. */
let markerList: CommentMarkerDto[] = [];
/** Which canvas that list describes, so a late answer can be discarded. */
let markerCanvas: string | undefined;
/** The mounted canvas's marker repaint, so this machinery can refresh without
 *  knowing which of the two canvases it is talking to. */
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
let repaintMarkers: (() => void) | undefined;
/** The mounted canvas's way of opening one marker, for the feedback walk. Set
 *  and cleared with `repaintMarkers`, because they belong to the same view. */
let openMarkerOn: ((threadId: string) => boolean) | undefined;

/**
 * Re-read a canvas's markers and repaint just them.
 *
 * Deliberately NOT renderCentre: rebuilding the centre would throw the canvas
 * away, losing the camera and the selection, which is the same mistake the card
 * drag had to unlearn. The surface repaints its marker group alone.
 */
/**
 * Refresh whichever canvas is mounted, if any.
 *
 * For a comment posted or resolved from a document's TOPLINE: that thread may
 * also be a marker on the canvas behind, and its badge would otherwise sit there
 * stale until the next remount. A function rather than a const so the comment
 * handlers above can call it.
 */
async function refreshCurrentMarkers(): Promise<void> {
  if (markerCanvas !== undefined) await refreshMarkers(markerCanvas);
}

async function refreshMarkers(canvas: string): Promise<void> {
  markerCanvas = canvas;
  const markers = await studio.commentMarkers(canvas);
  // The author may have navigated to another canvas while main was answering.
  if (markerCanvas !== canvas) return;
  markerList = markers;
  repaintMarkers?.();
}

/**
 * Open a marker's thread.
 *
 * The thread is fetched HERE rather than kept beside the marker list. A marker
 * needs only what it draws with; the conversation is wanted once, when somebody
 * clicks, so this is one round trip per open instead of one per marker on every
 * refresh.
 */
function showThread(threadId: string, anchor: HTMLElement, canvas: string): void {
  const marker = markerList.find((m) => m.id === threadId);
  if (!marker) return;
  const subject = marker.item ?? canvas;
  void (async () => {
    const threads = (await studio.commentsFor(subject)).filter((t) => t.id === threadId);
    openComments({
      anchor,
      subject: marker.gist === "" ? "Comment" : marker.gist,
      threads,
      showResolved: state.showResolved,
      newThreadId: () => `cmt_${Math.random().toString(36).slice(2, 10)}`,
      post: (id, body) => {
        void (async () => {
          const result = await studio.postComment(subject, id, body);
          if (!applied(result)) return;
          void refreshVc();
          void refreshMarkers(canvas);
        })();
      },
      setResolved: (id, resolved) => {
        void (async () => {
          const result = await studio.setCommentResolved(id, resolved);
          if (!applied(result)) return;
          void refreshVc();
          void refreshMarkers(canvas);
        })();
      },
      deleteMessage,
    });
  })();
}

/**
 * Start a thread at a place on a canvas.
 *
 * Nothing is written by the drop: this opens an empty composer, and the thread
 * exists only once a message is posted. That is the rule the whole comment
 * feature keeps, and it is why a mis-click costs nothing.
 *
 * The ANCHOR of the new thread is the item when it was dropped on one, and the
 * canvas itself otherwise: a comment about a card and a comment about a place are
 * different subjects, and the mark records only where it is drawn.
 */
/**
 * Withdraw one message, and put back whatever was showing it.
 *
 * Shared by all three places a thread can be read (a document's topline, a
 * canvas marker, the feedback walk), because they all have the same three things
 * to refresh afterwards and the panel closes either way: the thread it was
 * showing has changed underneath it, and a stale one is worse than a reopen.
 */
function deleteMessage(threadId: string, index: number): void {
  void (async () => {
    const result = await studio.deleteComment(threadId, index);
    if (!applied(result)) return;
    closeAnchoredPanel();
    renderWorkspace();
    void refreshCurrentMarkers();
    void gatherReview();
  })();
}

function startThread(
  canvas: string, at: { x: number; y: number }, item: string | undefined, anchor: HTMLElement,
): void {
  const threadId = `cmt_${Math.random().toString(36).slice(2, 10)}`;
  openComments({
    anchor, subject: item === undefined ? "A comment here" : "A comment on this",
    threads: [], showResolved: state.showResolved,
    newThreadId: () => threadId,
    post: (id, body) => {
      void (async () => {
        const result = await studio.postComment(
          item ?? canvas, id, body, { canvas, x: at.x, y: at.y });
        if (!applied(result)) return;
        void refreshVc();
        void refreshMarkers(canvas);
        // Close it. The panel was opened on a composer for a thread that did not
        // exist; once the first message is posted the thread does exist, and
        // leaving an empty composer sitting there reads as "that did not work".
        // Re-opening it is one click on the marker that is now under it.
        closeAnchoredPanel();
      })();
    },
    setResolved: () => { /* a thread that does not exist yet cannot be resolved */ },
    // Centred on the click: this anchor is a POINT somebody chose, not a control.
    // Aligning an edge to it put the panel up and to the left of the spot they
    // pointed at, which read as the comment appearing somewhere else.
    prefer: "centre",
  });
}

/**
 * Did a mutation land? Flashes the error and answers false if not.
 *
 * A type guard, so the caller's `r` narrows afterwards. The error branch was
 * hand-written at every one of ~60 call sites, which is the half `applyResult`
 * could not absorb when the repaint half was fixed the same way - and every
 * new call site was another chance to leave it out.
 */
function ok<T extends object>(r: T | { error: string }): r is T {
  if ("error" in r) { flashError((r as { error: string }).error); return false; }
  return true;
}

/** Take a mutation's answer whole: report it, or apply it. True when it
 *  landed, for a caller with more to do. */
function applied(r: OpenResult | { error: string }): boolean {
  if (!ok(r)) return false;
  applyResult(r);
  return true;
}

/**
 * Change a remembered state field, and persist it, in one act.
 *
 * Every one of these was two lines - `state.x = v` and a matching
 * `void studio.setX(v)` - paired by convention and nothing else, in six places
 * across a 2,600-line file. Naming the pairing here makes "change it and
 * forget to save it" a missing table entry rather than a silent bug that only
 * shows up after a restart.
 *
 * Returns the persist promise, for the two callers that wait on it.
 */
const PERSIST: { [K in keyof StudioState]?: (value: StudioState[K]) => Promise<unknown> } = {
  theme: (v) => studio.setTheme(v),
  viewMode: (v) => studio.setViewMode(v),
  coverageOverlay: (v) => studio.setCoverageOverlay(v),
  reviewWalk: (v) => studio.setReviewWalk(v),
  showResolved: (v) => studio.setShowResolved(v),
  autoRebuild: (v) => studio.setAutoRebuild(v),
};

function remember<K extends keyof StudioState>(key: K, value: StudioState[K]): Promise<unknown> {
  state[key] = value;
  const save = PERSIST[key] as ((v: StudioState[K]) => Promise<unknown>) | undefined;
  return save ? save(value) : Promise.resolve();
}

// --- saving (Patterpad's dirty + autosave pattern) ----------------------------
// Edits autosave ~700ms after they settle, with a visible status. Any pending
// write is flushed first on a transition (switching selection, opening the
// Table/Coverage, leaving or closing the window, Cmd+S) so nothing is lost and
// the simulation reads current disk.
/** Unwritten card edits, keyed by card so a later edit of the same one wins and
 *  edits of DIFFERENT cards queue up rather than evicting each other. */
const pendingCards = new Map<string, { deckId: string; cardId: string; edit: CardEdit }>();
/** Unwritten STRUCTURAL edits (box, deck config, template, tag group, hand), in
 *  the order they were made.
 *
 *  A LIST, for the same reason `pendingCards` above is a map: this was a single
 *  slot until 2026-08-29, so a second structural edit inside the 700ms window
 *  overwrote the first and it was never written at all. Renaming a tag group and
 *  then editing a hand, quickly, silently lost the rename. Unlike cards there is
 *  no key to collapse on - these are opaque closures over different documents -
 *  so they all run, in order, and two edits to one document leave the later
 *  one's state last. */
const pendingStructs: (() => Promise<OpenResult | { error: string }>)[] = [];
const AUTOSAVE_MS = 700;

/**
 * Take a result from main: the project, and the problems that go with it.
 *
 * It PAINTS the problems bar as well as recording them, because taking the new
 * list and leaving the old one on screen is the same bug written twenty times.
 * Found by fixing a loose hand on the map: dragging the pin back into a zone
 * cleared the error in the shard and in this variable, and the bar went on
 * saying it, because only two of the callers here happened to repaint. A
 * function that receives the answer is the right place to show it.
 */
function applyResult(result: OpenResult): void {
  project = result.project;
  problems = result.problems;
  // Stay on the same problem where that still makes sense; a shorter list
  // clamps rather than jumping to the start.
  problemAt = Math.min(problemAt, Math.max(0, problems.length - 1));
  renderProblemsBar();
}
/**
 * The clock and the status are the shell's (0.14.0); WHAT is pending is ours.
 *
 * Two things came back with it that this file did not have. A maximum age, so
 * an author typing without pause is still written every few seconds rather than
 * only when they stop. And re-entrancy: this used to clear its queue and then
 * await the write, so a flush arriving mid-write saw nothing pending and said
 * "Saved" over bytes still in the air.
 */
const saver = createSaveController({
  delayMs: AUTOSAVE_MS,
  onStatus: (status) => saveEl.set(status),
  write: async () => {
    const cards = [...pendingCards.values()]; pendingCards.clear();
    const structs = pendingStructs.splice(0);   // take and clear in one step (re-entrancy)
    let ok = true;
    for (const pc of cards) {
      const r = await studio.saveCard(pc.deckId, pc.cardId, pc.edit);
      if ("error" in r) { flashError(r.error); ok = false; } else applyResult(r);
    }
    for (const run of structs) {
      const r = await run();
      if ("error" in r) { flashError(r.error); ok = false; } else applyResult(r);
    }
    repaintAfterSave();   // update the card face on the left; leave the inspector
    void refreshVc();     // a write changes the local bits (checked out, read-only): re-badge
    if (ok) scheduleAutoRebuild();
    return ok;
  },
});
/** Write any pending edit now, and wait for it. */
const flushSaves = (): Promise<void> => saver.flush();

function queueCard(deckId: string, cardId: string, edit: CardEdit): void {
  pendingCards.set(cardId, { deckId, cardId, edit });
  saver.touch();
}
function queueStruct(run: () => Promise<OpenResult | { error: string }>): void {
  pendingStructs.push(run);
  saver.touch();
}

// Auto Rebuild: when on, re-export the bundle shortly after edits settle so the
// committed .storyletsc never goes stale. Quiet (no toast); the manual Publish
// Bundle keeps its confirmation.
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAutoRebuild(): void {
  if (!state.autoRebuild) return;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    void (async () => { const r = await studio.exportBundle(); if (!("error" in r)) void revalidate(); })();
  }, 600);
}
/**
 * Delete cards from the focused deck: the one path for the Delete key, the
 * context menus and the canvas, in every view.
 */
async function deleteCards(cardIds: string[]): Promise<void> {
  const at = focus;
  if (cardIds.length === 0 || at?.kind !== "deck") return;
  const deck = currentBox()?.decks.find((d) => d.id === at.deck);
  if (!deck) return;
  const cards = cardIds.map((id) => deck.cards.find((c) => c.id === id)).filter((c): c is CardDto => c !== undefined);
  if (cards.length === 0) return;

  const worth = cards.filter(cardHasContent);
  if (worth.length > 0) {
    const ok = await confirmDialog({
      title: cards.length === 1
        ? `Delete "${cards[0]!.title ?? cards[0]!.gameId}"?`
        : `Delete ${cards.length} cards?`,
      body: cards.length === 1
        ? "This card has content. Undo restores it."
        : `${worth.length} of them have content. Undo restores them.`,
      confirmLabel: cards.length === 1 ? "Delete card" : "Delete cards",
    });
    if (!ok) return;
  }
  for (const card of cards) await removeCard(deck.id, card.id);
  selectCards([]);
}

async function removeCard(deckId: string, cardId: string): Promise<void> {
  // Writing an edit of a card we are about to delete would recreate it.
  pendingCards.delete(cardId);
  if (pendingCards.size === 0 && pendingStructs.length === 0) saver.cancel();
  const result = await studio.deleteCard(deckId, cardId);
  if (!applied(result)) return;
  const boxId = inspected && "box" in inspected ? inspected.box : project?.boxes[0]?.id;
  inspected = focus?.kind === "deck" ? { kind: "deck", box: focus.box, deck: deckId } : (boxId ? { kind: "box", box: boxId } : undefined);
  renderWorkspace();
}

// --- workspace ----------------------------------------------------------------
// The frame is the shared pane shell (@wildwinter/app-shell): built once, its
// bodies refilled per render so any pane can repaint independently - e.g. a
// save repaints nav + centre while leaving the mid-edit inspector untouched.
const problembar = el("div", { className: "stepbar problembar" });
const reviewbar = el("div", { className: "stepbar reviewbar" });
// Hidden until the walk says otherwise. Without this it is an empty strip along
// the bottom of a project nobody is reviewing: the bar carries the problems
// bar's padding and border, so "no children" still draws a band.
reviewbar.hidden = true;
const probEl = el("button", { className: "probstat ok", text: icon.tick });
// The save indicator is the shell's now (app-shell 0.18.0): the controller that
// computes the three states already lived there, and the six lines that DREW
// them were the half each app kept - so both apps hand-rendered one machine's
// output and drifted on it (design review 2026-08, A4).
const saveEl = saveIndicator();
// The open document's version-control state, when it has one to report (quiet
// chrome: hidden entirely on the clean, writable, up-to-date common case).
const vcEl = el("span", { className: "vcstat" });
vcEl.hidden = true;
let toastNode: HTMLElement | undefined;

let shell!: PaneShell;
function mountShell(): void {
  shell = mountPaneShell(el("div"), {
    nav: { defaultWidth: "224px", label: "navigator", shortcutHint: "Cmd+1" },
    // NOT OFFERED (app-shell 0.36.0): the slot is retired and its toggle
    // opened 384px of nothing - the audit's blank-pane find. The config
    // stays so the future reference pane inherits the width and label.
    inspector: { defaultWidth: "384px", label: "inspector", shortcutHint: "Cmd+2", offered: false },
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
  histPair = historyNav(() => travel((c) => history.back(c)), () => travel((c) => history.forward(c)));
  histPair.set(false, false);
  // Between the nav toggle and the lead slot, NOT inside the lead: renders
  // rebuild the lead's contents with replaceChildren, and a pair mounted in
  // there quietly vanished on the first repaint.
  shell.topbar.insertBefore(histPair.el, shell.topbarLead);
  // The health chip steps the bar to the FIRST problem: it is a count, so what
  // it promises is "show me them".
  probEl.addEventListener("click", () => {
    if (problems.length > 0) { problemAt = 0; renderProblemsBar(); return; }
    // The clean state answers instead of doing nothing: a dead control is
    // how the audit spent three clicks learning what this even was.
    flash(`No problems in ${project?.name ?? "this project"}`, "ok");
  });
  // The primary loop's visible door (surface review F8): play what you wrote.
  const play = el("button", { className: "topbtn", text: "▶ Play", tip: "Play this project on the Board (⌘T)" });
  play.addEventListener("click", () => { if (project) void (async () => { await flushSaves(); await studio.openTable(); })(); });
  shell.topbarTrail.append(play, vcEl, probEl, saveEl.el);
  // A locked document redraws itself in place on the controls that stay live
  // (a tab switch, an outcome opening), which would hand back editable fields.
  // Capture the click and re-apply the guard once the redraw has settled.
  shell.centre.addEventListener("click", () => {
    if (docLocked) queueMicrotask(() => applyDocVc());
  }, true);
}

// --- version control (Patterpad's #145, on our shards) -------------------------
// Writes already go through @wildwinter/simple-vc-lib, so a locked shard fails
// its save cleanly. This is the surfacing half: a per-shard snapshot from main
// (throttled there - a remote read is a server hit) drives a quiet badge on
// every item that names a shard, a topbar chip for the open document, and, when
// somebody ELSE holds the shard, a read-only document rather than a doomed edit.
//
// The snapshot arrives on a poll, so it must NEVER re-render: it paints badges
// onto the existing rows (via their data-vc keys) and toggles the open
// document's controls, leaving a mid-edit document alone.
let vcShards = new Map<string, ShardVcDto>();
let vcSystem = "";
let docLocked = false;
/** Who holds what the open page writes (its own shard, or a frame's). */
let docHolders: string[] = [];

const vcOf = (keys: string | undefined): ShardVcDto | undefined => foldVc(vcShards, keys);

/** Which shard the OPEN document's edits land in (see vcKeys). Masters (the
 *  decks list, the project's boxes) edit nothing themselves: their items badge. */
function docVcKeys(): string | undefined {
  const ins = inspected;
  if (ins?.kind === "card") return vcKeys.deck(ins.deck);
  if (ins?.kind === "template" || ins?.kind === "hand") return vcKeys.hands(ins.box);
  if (ins?.kind === "tagGroup") return vcKeys.tags(ins.box);
  const f = focus;
  if (f?.kind === "deck") return vcKeys.deck(f.deck);
  if (f?.kind === "box") return vcKeys.boxShard(f.box);
  if (f?.kind === "hands") return vcKeys.hands(f.box);
  if (f?.kind === "project") return vcKeys.project;
  return undefined;
}

/** Apply the open document's version-control state: read-only + a notice
 *  naming the holder when somebody else has it. */
function applyDocVc(): void {
  const host = shell.centre;
  const holders = new Set(vcOf(docVcKeys())?.lockedBy ?? []);
  lockControls(host, holders.size > 0);
  // A frame of the page that writes a DIFFERENT shard (the box page's Hand
  // templates and Tags tabs) takes its state from that shard instead.
  host.querySelectorAll<HTMLElement>("[data-vc-scope]").forEach((frame) => {
    const st = vcOf(frame.dataset["vcScope"]);
    if (st?.lockedBy?.length) { for (const who of st.lockedBy) holders.add(who); lockControls(frame, true); }
    else if (holders.size === 0) lockControls(frame, false);
  });
  docHolders = [...holders];
  docLocked = docHolders.length > 0;
  host.querySelector(":scope > .vc-lock")?.remove();
  if (docLocked) host.prepend(lockNotice(docHolders));
}

/** The topbar chip: the open page's state, in the same words as the badge and
 *  the notice (so a locked SETUP TAB of an otherwise-writable box says so too). */
function renderVcChip(): void {
  const s = vcOf(docVcKeys());
  // From the table, all three. The glyphs are identical to what was typed here,
  // which is the point: identical today, and one edit away from not being.
  const text = docHolders.length ? `${icon.locked} Locked by ${docHolders.join(", ")}`
    : s?.outOfDate ? `${icon.down} Out of date`
    : s && !s.writable ? `${icon.readOnly} Read-only` : "";
  vcEl.textContent = text;
  vcEl.hidden = text === "";
  vcEl.title = text === "" ? "" : `${text} (${vcSystem})`;
  vcEl.classList.toggle("locked", docHolders.length > 0);
}

/** Repaint everything the snapshot drives. Cheap + render-free, so it is safe
 *  to call from a poll or after any render. */
function applyVc(): void {
  if (!project) return;
  paintVcBadges(document, vcShards);
  applyDocVc();
  renderVcChip();
}

/** Pull a fresh snapshot (one throttled, coalesced query in main) and repaint. */
async function refreshVc(): Promise<void> {
  if (!project) return;
  const dto = await studio.vcStatus();
  if (!dto || !project) return;   // the project may have closed while we awaited
  vcSystem = dto.system;
  vcShards = new Map(dto.shards.map((s) => [s.key, s]));
  applyVc();
}

/** No project, no version-control state. */
function clearVc(): void {
  vcShards = new Map();
  docLocked = false;
  docHolders = [];
  vcEl.hidden = true;
}

function currentBox(): ProjectDto["boxes"][number] | undefined {
  const id = focus?.box ?? (inspected && "box" in inspected ? inspected.box : undefined);
  return project?.boxes.find((b) => b.id === id);
}

// --- the coverage overlay (design/coverage-overlays.md) -----------------------
//
// A remembered MODE, like the feedback walk: the canvases wear the last run's
// evidence until told otherwise.

/** Re-read the last run and put it on whichever canvas is up. */
async function gatherCoverage(): Promise<void> {
  coverage = state.coverageOverlay ? await studio.coverageOverlay() : undefined;
  refreshCoverage?.();
}

studio.onCoverageDone(() => { void gatherCoverage(); });

function setCoverageOverlay(on: boolean): void {
  void remember("coverageOverlay", on);
  void gatherCoverage();
}

// --- the Review Feedback walk (design/annotation.md) --------------------------
//
// Patterpad's walk, adopted whole: a looping bottom bar over every thread in the
// project, F8 / Shift+F8, first press ENTERS the mode rather than stepping.
//
// The one thing it has to get right is that the list is gathered from DISK. A
// thread posted a second ago may still be in a pending write, and a walk that
// missed the comment you just made would be worse than no walk, so every entry
// flushes first. That is Patterpad's rule and its comment says why.
/** Settle checks before the walk gives up on finding a comment's bubble. At four
 *  frames apiece that is about a second: long enough for a card's catalogue to
 *  come back from main, short enough that a thread on something that has since
 *  gone does not hold the walk. */
const REVIEW_TRIES = 15;
let reviewItems: ReviewItemDto[] = [];
let reviewAt = 0;

/** Re-read the walk's list and repaint its bar. Called on entry and after every
 *  comment mutation, so resolving an item drops it from the loop. */
async function gatherReview(): Promise<void> {
  if (!state.reviewWalk) return;
  await flushSaves();
  reviewItems = project ? await studio.reviewFeedback(state.showResolved) : [];
  if (reviewAt >= reviewItems.length) reviewAt = 0;
  renderReviewWalk();
}

function renderReviewWalk(): void {
  renderReviewBar(reviewbar, reviewItems, reviewAt, state.reviewWalk,
    (next) => { reviewAt = next; renderReviewWalk(); void goToReview(reviewItems[next]); },
    (item) => void goToReview(item),
    () => setReviewWalk(false));
}

/** Go to anywhere a comment can live or a `--at` launch can name: a Find
 *  hit's item, a box, or an outcome (its card, with that outcome expanded). */
function goTo(at: ReviewAt): void {
  if (!project) return;
  if (at.kind === "box") actions.focus({ kind: "box", box: at.box });
  else if (at.kind === "outcome") {
    actions.inspectCard(at.box, at.deck, at.card);
    // The card editor keys its tab state by DECK and card, because the same card
    // id opening under a different deck is a different document.
    setDocTab(`card:${at.deck}/${at.card}`, "outcomes");
    expandOutcome(at.deck, at.card, at.outcome);
    renderWorkspace();
  } else applySearchSelection(at);
}

/**
 * Arrive at one comment: open what it is about, then its thread, in place.
 *
 * The RAF is the same lesson Patterpad wrote down: the reveal has to finish and
 * lay out before the popover is anchored, or the panel is positioned against an
 * element that is still moving and lands somewhere else entirely.
 */
async function goToReview(item: ReviewItemDto | undefined): Promise<void> {
  if (!item || !project) return;
  const at = item.at;
  // A MARKER is a place on a canvas, so the canvas has to be the view that comes
  // up: arriving at the deck's card list and opening the thread off the topline
  // bubble answers "what was said" but throws away "where", which is the only
  // reason the comment was dropped there instead of filed against the deck.
  if (item.canvas !== undefined) {
    if (item.canvas.startsWith(MAP_CANVAS)) setDocTab(`box:${item.canvas.slice(MAP_CANVAS.length)}`, "map");
    // Through the action, so the switch is REMEMBERED. The walk really did change
    // which view of the deck is up, and an app that shows node view while
    // remembering cards contradicts itself on the next open.
    else if (state.viewMode !== "node") actions.setViewMode("node");
  }
  goTo(at);

  // A marker's thread is opened from the canvas, where the marker is: that is
  // the whole point of having put it there, and the view centres on it. It can
  // still fail (the canvas may not have mounted, or may be a different one), and
  // then the container's own bubble is the honest fallback rather than nothing.
  if (item.canvas !== undefined && await openMarkerWhenMounted(item.thread)) return;
  // Everything else opens from the bubble in its document's topline, and the
  // bubble has to be THIS thread's. Opening a card loads its catalogue first, so
  // the document arrives some frames after the navigation, and a single rAF
  // anchored the popover to the OUTGOING document's bubble: it opened, then the
  // re-render removed the element under it and took the popover with it.
  const bubble = await bubbleFor(item.anchor);
  if (bubble) actions.showComments(item.anchor, item.where, bubble);
}

/** Wait for the canvas to finish mounting, then open the marker on it.
 *
 * A canvas view fetches before it draws (the deck's links, the box's map), so
 * the surface that owns this marker does not exist for some frames after the
 * navigation. False when the wait runs out, and the caller falls back to the
 * container's own bubble rather than showing nothing. */
async function openMarkerWhenMounted(thread: string): Promise<boolean> {
  for (let tries = 0; tries < REVIEW_TRIES; tries++) {
    if (openMarkerOn?.(thread) === true) return true;
    for (let frame = 0; frame < 4; frame++) {
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
    }
  }
  return false;
}

/** Wait for the comment bubble filed against `id`, up to a short deadline.
 *
 * Bounded rather than open-ended: if the document never arrives (a thread on
 * something that has since gone), the walk should move on quietly rather than
 * hold a promise open for the rest of the session. */
async function bubbleFor(id: string): Promise<HTMLElement | undefined> {
  // LAID OUT, not merely present. The bubble exists for a frame before the
  // document it is in has any size, and anchoring the popover to a zero rect put
  // it in the top-left corner of the window instead of beside the bubble.
  const query = (): HTMLElement | null => {
    const found = document.querySelector<HTMLElement>(`.doc-thread[data-thread-for="${CSS.escape(id)}"]`);
    return found && found.getBoundingClientRect().width > 0 ? found : null;
  };
  // SETTLED, not just laid out. Opening a card renders it twice: once from the
  // navigation and again when its catalogue arrives from main. Anchoring to the
  // first bubble worked until the second render replaced the element, at which
  // point the popover had lost what it was pinned to and fell to the corner of
  // the window. The same element twice running means the document has stopped
  // rebuilding underneath us.
  let last: HTMLElement | null = null;
  for (let tries = 0; tries < REVIEW_TRIES; tries++) {
    const found = query();
    if (found !== null && found === last) return found;
    last = found;
    for (let frame = 0; frame < 4; frame++) {
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
    }
  }
  return last ?? undefined;
}

/** Review ▸ Review Feedback. A remembered mode: entering gathers, leaving hides. */
function setReviewWalk(on: boolean): void {
  void remember("reviewWalk", on);
  if (on) { reviewAt = 0; void gatherReview(); } else { reviewItems = []; renderReviewWalk(); }
}

/** F8 / Shift+F8. The first press ENTERS the walk rather than stepping, which is
 *  Patterpad's behaviour: the key means "show me the feedback". */
function stepReview(delta: number): void {
  if (!state.reviewWalk) { setReviewWalk(true); return; }
  if (reviewItems.length === 0) return;
  reviewAt = (reviewAt + delta + reviewItems.length) % reviewItems.length;
  renderReviewWalk();
  void goToReview(reviewItems[reviewAt]);
}

/**
 * Is it rude to move the document right now?
 *
 * The Board's rule, which A2 borrows: an ambient surface may move the VIEW but
 * must never move the author. Two cases where stepping stays put and only
 * updates what the bar says:
 *
 * - The cursor is in a field with an edit not yet written. Yanking the document
 *   away mid-sentence is the specific rudeness this exists to prevent, and the
 *   edit would be flushed by the navigation, so it would also be a silent save
 *   somebody did not ask for.
 * - Anything modal is up. A bar behind a dialog has no business changing what is
 *   underneath it.
 */
function mayStepAway(): boolean {
  if (document.querySelector("dialog[open]")) return false;
  const t = document.activeElement;
  const editing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
    || (t instanceof HTMLElement && t.isContentEditable);
  if (!editing) return true;
  return pendingCards.size === 0 && pendingStructs.length === 0;
}

function renderProblemsBar(): void {
  renderProblems(problembar, problems, problemAt,
    (next) => {
      problemAt = next;
      renderProblemsBar();
      // A2: STEPPING NAVIGATES, reversing a departure this app had argued for.
      //
      // The old reasoning was that a jump here swaps the open document where
      // Patterpad only moves a caret, so stepping should change what the bar
      // says and nothing else. It is true and it was still the wrong call:
      // identical chrome must not mean different things, and a family user
      // pressing the arrow got nothing. This app had already solved the actual
      // problem twice - in the Board and in the review walk - and the answer is
      // that an ambient surface moves the view, never the focus, and never over
      // an uncommitted edit (design-language.md, the ambient-versus-mode rule).
      const landed = problems[next];
      if (landed && mayStepAway()) jumpToProblem(landed);
    },
    (p) => jumpToProblem(p),
    (p, fix, anchor) => applyFix(p, fix, anchor),
    (p) => problemLabel(p));
  renderProblemChip();
}
// The topbar's quiet health chip: a tick when clean, the count when not.
function renderProblemChip(): void {
  const errs = problems.filter((p) => p.severity === "error").length;
  probEl.className = `probstat ${problems.length === 0 ? "ok" : errs > 0 ? "err" : "warn"}`;
  // icon.tick, not a hand-typed one. This chip was BUILT with icon.tick four
  // hundred lines up and then overwritten with a literal on every update, which
  // is the icon table being bypassed in the file that imports it (design review
  // 2026-08, A9).
  probEl.textContent = problems.length === 0 ? icon.tick : String(problems.length);
  probEl.dataset["tip"] = problems.length === 0
    ? "No problems"
    : `${problems.length} problem${problems.length === 1 ? "" : "s"} - click to review`;
  probEl.setAttribute("aria-label", probEl.dataset["tip"]);
}
/**
 * A quick-fix, applied (storyletter.md section 4).
 *
 * Both end in a re-validate, because the bar's whole job is to be current: a
 * repair that left the problem sitting there until something else refreshed
 * would read as having failed. And both then JUMP to what was changed, which is
 * the difference between a fix and a silent edit somewhere off-screen.
 */
function applyFix(problem: Problem, fix: NonNullable<Problem["fix"]>, anchor: HTMLElement): void {
  if (fix.kind === "declare-property") {
    void (async () => {
      const result = await studio.declareProperty(fix.scope, fix.name, fix.owner,
        fix.declType !== undefined ? { type: fix.declType, default: fix.declDefault! } : undefined);
      if (!applied(result)) return;
      await revalidate();
      // To the DECLARATION, not back to the problem site. The type is READ off
      // the value being written where that is readable (`= true` is a boolean),
      // and falls back to a number where it is not, so the author still lands
      // where they can change it. This is what the button's tooltip promised.
      goToDeclaration(fix);
    })();
    return;
  }
  // The tag repair ASKS, because there is no single right answer: the group has
  // several tags and only the author knows which was meant. The ellipsis on the
  // button already promised this.
  const at = anchor.getBoundingClientRect();
  openContextMenu(at.left, at.top, fix.options.map((option) => ({
    label: option.label,
    onClick: () => void (async () => {
      const result = await studio.repointTag(fix.holder, fix.group, fix.bad, option.id);
      if (!applied(result)) return;
      await revalidate();
    })(),
  })));
}

/**
 * The Story document: the project's @story properties as a first-class page
 * (the author's ruling, 2026-08-26; the navigator row above the boxes is its
 * address). Same list editor as Settings, saving as edits settle. @world stays
 * behind Project Settings because it is the other kind of state: a contract
 * with the game, set once by the principal designer, not working vocabulary.
 */
function renderStoryCentre(host: HTMLElement): void {
  host.classList.add("measured");
  const page = el("div", { className: "centre-editor" });
  host.replaceChildren(page);
  void (async () => {
    const dto = await studio.projectSettings();
    if (!dto || focus?.kind !== "story") return;
    const trail = crumbTrail([{ label: project?.name ?? "Project", go: () => actions.focus({ kind: "project" }) }]);
    const head = el("div", { className: "master-head" },
      el("div", { className: "doc-head" },
        el("span", { className: "insp-label", text: "Project" }),
        el("h2", { className: "collection-title", text: "Story" }),
        el("p", { className: "master-sub", text: "The story's own memory: state the cards read and write as a run unfolds (@story)." })));
    // Save as edits settle, the centre editors' usual rhythm. (The Settings
    // dialog saves on close because it is a dialog; this is a document.)
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void (async () => {
        const result = await studio.saveProjectSettings(dto);
        if (!applied(result)) return;
      })(), 400);
    };
    const list = el("div");
    // "Where do I see everything that reads or writes this?" - answered at
    // the property itself: a quiet uses chip per row, opening Find's property
    // mode. Counts fill in asynchronously (one usage scan per declaration).
    const useBtns = new Map<string, HTMLButtonElement>();
    mountPropertyList(list, dto.story, { onChange: save, rowExtras: (decl) => {
      const b = el("button", { className: "set-uses", text: "uses",
        tip: `Find every read and write of @story.${decl.name}`,
        onClick: () => void studio.openSearch({ mode: "property", query: `@story.${decl.name}` }) });
      if (decl.name) useBtns.set(decl.name, b);
      return b;
    } });
    // ONE call for the whole list. This was a loop awaiting one round trip per
    // property, and each of those recompiled the entire project in main, so a
    // project with forty declared story properties opened this page with forty
    // sequential compiles and the main process blocked throughout. The batch
    // compiles once and answers positionally.
    void (async () => {
      const props = [...useBtns.keys()];
      if (props.length === 0) return;
      const found = await studio.propertyUsageMany(props.map((p) => `@story.${p}`));
      props.forEach((prop, i) => {
        const b = useBtns.get(prop);
        const n = found[i]?.length ?? 0;
        if (b?.isConnected) b.textContent = `${n} use${n === 1 ? "" : "s"}`;
      });
    })();
    const foot = el("p", { className: "set-note" },
      el("span", { text: "Your game\u2019s own state (@world) is a contract the principal designer keeps. It lives in " }),
      el("button", { className: "linklike", text: "Project Settings \u203a World", onClick: () => projectSettingsPanel.open("world") }),
      el("span", { text: "." }));
    page.replaceChildren(trail, head, list, foot);
  })();
}

/** Where a freshly declared property now lives, so the author can retype it. */
function goToDeclaration(fix: { scope: string; owner: string }): void {
  if (fix.scope === "story") { actions.focus({ kind: "story" }); return; }
  if (fix.scope === "world") { projectSettingsPanel.open(fix.scope); return; }
  if (!project) return;
  if (fix.scope === "box") {
    actions.focus({ kind: "box", box: fix.owner });
    setDocTab(`box:${fix.owner}`, "properties");
  } else if (fix.scope === "deck") {
    const box = project.boxes.find((b) => b.decks.some((d) => d.id === fix.owner));
    if (!box) return;
    actions.focus({ kind: "deck", box: box.id, deck: fix.owner });
    setDocTab(`deck:${fix.owner}`, "properties");
  }
  renderWorkspace();
}

/** Best-effort jump from a problem's path + where to the offending entity. */
/** The deck / card / outcome a deck-shard problem names: `where` may be a
 *  bare card ("burner-rig") or card/outcome ("burner-rig/continue") - the
 *  slash form used to fall through to the deck, one hop short. */
function resolveDeckProblem(p: Problem, box: BoxDto) {
  if (!p.path.endsWith(".storyletdeck")) return undefined;
  const stem = baseName(p.path).replace(/\.storyletdeck$/, "");
  const deck = box.decks.find((d) => d.gameId === stem);
  if (!deck) return undefined;
  const [cardRef, outcomeRef] = (p.where ?? "").split("/");
  const card = cardRef ? deck.cards.find((c) => c.gameId === cardRef) : undefined;
  const outcome = card && outcomeRef ? card.outcomes.find((o) => o.gameId === outcomeRef) : undefined;
  return { deck, card, outcome };
}

/** The problem bar's voice: titles ("Burner Rig › Continue"), never storage
 *  paths, wherever the project can resolve them. */
function problemLabel(p: Problem): string | undefined {
  const box = project?.boxes.find((b) => p.path.includes(`${b.gameId}/`));
  if (!box) return p.path.endsWith(".storyletproj") ? "Project settings" : undefined;
  const named = resolveDeckProblem(p, box);
  if (named?.card) {
    const parts = [named.card.title ?? named.card.gameId];
    if (named.outcome) parts.push(named.outcome.gameId);
    return parts.join(" › ");
  }
  if (named) return named.deck.title ?? named.deck.gameId;
  if (p.path.endsWith(".storylethands")) return p.where ?? "Hands";
  if (p.path.endsWith(".storylettags")) return p.where ?? "Tags";
  if (p.path.endsWith(".storyletbox")) return box.title ?? box.gameId;
  return undefined;
}

/** Which of a card's tabs holds a given shard field (`Issue.field`). The
 *  compiler names the field; this is the half that knows the editor's own
 *  layout, so the two can change independently. */
function cardTabFor(field: string | undefined): string | undefined {
  switch (field) {
    case "condition": case "priority": case "copies": case "sharedCopies": case "tags": return "dealing";
    case "fields": return "fields";
    case "changes": return "outcomes";
    default: return undefined;
  }
}

function jumpToProblem(p: Problem): void {
  const box = project?.boxes.find((b) => p.path.includes(`${b.gameId}/`)) ?? project?.boxes[0];
  if (!box) return;
  const named = resolveDeckProblem(p, box);
  if (named) {
    const { deck, card, outcome } = named;
    if (card) {
      // Land INSIDE the problem, not one hop short: the card, the TAB the
      // problem is on, and - when it names an outcome - that outcome expanded.
      //
      // The tab used to move only for an outcome, so every other problem landed
      // on whichever tab was last used: clicking a condition error opened
      // Outcomes and said nothing about why (the author's report, 2026-08-30).
      // The tab now follows `field`, which the compiler raises with the
      // diagnostic rather than the editor reading it back out of the message.
      // An unknown field leaves the sticky tab alone, deliberately: the card's
      // name, gameId and purpose sit ABOVE the tabs and are on every one of
      // them, so moving for those would be motion without an answer.
      actions.inspectCard(box.id, deck.id, card.id);
      const tab = outcome ? "outcomes" : cardTabFor(p.field);
      if (tab) {
        setDocTab(`card:${deck.id}/${card.id}`, tab);
        if (outcome) expandOutcome(deck.id, card.id, outcome.id);
        renderWorkspace();
      }
      return;
    }
    actions.focus({ kind: "deck", box: box.id, deck: deck.id }); return;
  }
  if (p.path.endsWith(".storylethands")) {
    const template = p.where ? box.templates.find((t) => t.gameId === p.where) : undefined;
    if (template) { actions.inspectTemplate(box.id, template.id); return; }
    const hand = p.where ? box.hands.find((h) => h.gameId === p.where) : undefined;
    if (hand) { actions.inspectHand(box.id, hand.id); return; }
    setDocTab(`box:${box.id}`, "templates"); actions.focus({ kind: "box", box: box.id }); return;
  }
  if (p.path.endsWith(".storylettags")) {
    const group = p.where ? box.tagGroups.find((d) => d.gameId === p.where) : undefined;
    if (group) { actions.inspectTagGroup(box.id, group.id); return; }
    setDocTab(`box:${box.id}`, "tags"); actions.focus({ kind: "box", box: box.id }); return;
  }
  if (p.path.endsWith(".storyletbox")) { actions.editBox(box.id); return; }
  if (p.path.endsWith(".storyletproj")) { actions.openProjectSettings(); return; }
  actions.focus({ kind: "box", box: box.id });
}
// The inspector: a card's live preview (it edits in the centre now), else the
// deck / box / query / dimension editor.
// A selected card edits across both panes off one shared model: the centre is
// its authoring document, the inspector its settings + focused-outcome stack.
// Returns false (nothing rendered) when there is no card to edit.
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
// Hand templates, hands and tag groups are document-class too: their
// bindings, chosen tags and declared tags want the centre's width, exactly
// as a card does.
function renderDetailPanes(): boolean {
  const box = currentBox();
  const ins = inspected;
  if (!box || !ins) return false;
  // Setup items live behind the box page: their trail's second segment
  // returns there with the right tab active, mirroring how they were opened.
  const boxTabSeg = (label: string, tab: string): { label: string; go: () => void } =>
    ({ label, go: () => { setDocTab(`box:${box.id}`, tab); actions.focus({ kind: "box", box: box.id }); } });
  if (ins.kind === "template" && detail?.kind === "template" && detail.template.id === ins.template) {
    ensureBoxCatalogue(box.id);
    const cat = catalogueBox === box.id && !catalogueDeck ? catalogue : [];
    renderTemplateWorkspace(centreEditor([boxSeg(box), boxTabSeg("Hand templates", "templates")]), box, detail.template, cat, inspectorHost);
    return true;
  }
  if (ins.kind === "hand" && detail?.kind === "hand" && detail.hand.id === ins.hand) {
    ensureBoxCatalogue(box.id);
    const cat = catalogueBox === box.id && !catalogueDeck ? catalogue : [];
    renderHandWorkspace(centreEditor([boxSeg(box), { label: "Hands", go: () => actions.focus({ kind: "hands", box: box.id }) }]), box, detail.hand, cat, inspectorHost);
    return true;
  }
  if (ins.kind === "tagGroup" && detail?.kind === "tagGroup" && detail.group.id === ins.group) {
    renderTagGroupWorkspace(centreEditor([boxSeg(box), boxTabSeg("Tags", "tags")]), box, detail.group, inspectorHost);
    return true;
  }
  return false;
}
function renderCardPanes(): boolean {
  const box = currentBox();
  const ins = inspected;
  if (ins?.kind !== "card" || !box) return false;
  const deck = box.decks.find((d) => d.id === ins.deck);
  const card = deck?.cards.find((c) => c.id === ins.card);
  if (!deck || !card) return false;
  ensureCatalogue(deck.id);
  const cat = catalogueDeck === deck.id ? catalogue : [];
  // Scan-and-fix across the deck without round-tripping through browse (v3 3).
  const at = deck.cards.findIndex((c) => c.id === card.id);
  const step = (delta: number): void => {
    const next = deck.cards[at + delta];
    if (next) actions.inspectCard(box.id, deck.id, next.id);
  };
  const prev = el("button", { className: "centre-step", text: icon.back, tip: "Previous card (↑)" });
  prev.disabled = at <= 0; prev.addEventListener("click", () => step(-1));
  const next = el("button", { className: "centre-step", text: icon.forward, tip: "Next card (↓)" });
  next.disabled = at >= deck.cards.length - 1; next.addEventListener("click", () => step(1));
  const editor = centreEditor([
    boxSeg(box),
    { label: "Decks", go: () => actions.focus({ kind: "decks", box: box.id }) },
    { label: deck.title ?? deck.gameId, go: () => actions.focus({ kind: "deck", box: box.id, deck: deck.id }) },
  ], el("span", { className: "centre-step-pos", text: `${at + 1} / ${deck.cards.length}` }), prev, next);
  renderCardWorkspace(editor, box, deck, card, cat, inspectorHost);
  return true;
}
/** Cmd+Up: one level up the hierarchy trail. */
function goUp(): void {
  const box = currentBox();
  if (!box || !focus) return;
  if (inspected?.kind === "card" && focus.kind === "deck") { selectCards([inspected.card]); actions.focus({ kind: "deck", box: focus.box, deck: focus.deck }); return; }
  // Setup items go up to the box page with their tab active (rule 10).
  if (inspected?.kind === "template") { setDocTab(`box:${box.id}`, "templates"); actions.focus({ kind: "box", box: box.id }); return; }
  if (inspected?.kind === "tagGroup") { setDocTab(`box:${box.id}`, "tags"); actions.focus({ kind: "box", box: box.id }); return; }
  if (inspected?.kind === "hand") { actions.focus({ kind: "hands", box: box.id }); return; }
  if (focus.kind === "deck") { actions.focus({ kind: "decks", box: box.id }); return; }
  if (focus.kind === "decks" || focus.kind === "hands") { actions.focus({ kind: "box", box: box.id }); return; }
  if (focus.kind === "box" || focus.kind === "story") { actions.focus({ kind: "project" }); return; }
}

/** The expandable nodes on the way to the current focus - navigation expands
 *  (never collapses) so the path to where you are is always visible. */
function navPath(): string[] {
  const f = focus;
  if (!f || f.kind === "project" || f.kind === "story") return [];
  const ids = [navId.box(f.box)];
  if (f.kind === "deck" || f.kind === "decks") ids.push(navId.collection(f.box, "decks"));
  else if (f.kind === "hands") ids.push(navId.collection(f.box, "hands"));
  return ids;
}
function renderNavPane(): void {
  if (!project) return;
  // The focused path renders expanded TRANSIENTLY (v3: no ratchet) - only the
  // user's own chevron toggles persist. A path node's chevron is inert while
  // you are inside it, which is correct: the nav always shows where you are.
  const effective = new Set([...navExpanded, ...navPath()]);
  renderNav(shell.nav, project, focus, effective, actions);
  paintVcBadges(shell.nav, vcShards);
}
/** Fill the centre, then re-apply the version-control state to what it built
 *  (badges on the master items, read-only when the shard is somebody else's). */
function renderCentre(): void {
  fillCentre();
  applyVc();
}
function fillCentre(): void {
  // The centre is rebuilt by replacing children, which throws away a canvas's
  // element but not its window listeners or its ResizeObserver: the node view
  // has to be told.
  nodeView?.destroy();
  nodeView = undefined;
  // The markers went with it. Clearing both means a comment posted from a
  // document's topline cannot repaint into a surface that has been destroyed, and
  // a late `commentMarkers` answer for the old canvas is discarded rather than
  // drawn onto the new one.
  repaintMarkers = undefined;
  openMarkerOn = undefined;
  refreshCoverage = undefined;
  markerCanvas = undefined;
  markerList = [];
  const f = focus;
  if (f?.kind === "project" && project) { renderProjectCentre(shell.centre, project, actions); return; }
  if (f?.kind === "story" && project) { renderStoryCentre(shell.centre); return; }
  const box = currentBox();
  if (!box || !f) { shell.centre.classList.remove("measured"); shell.centre.replaceChildren(); return; }
  if (f.kind === "box") {
    renderBoxCentre(shell.centre, box, (h, tab) => renderBoxTabBody(h, box, tab, inspectorHost), actions);
  }
  else if (f.kind === "decks") renderDecksCentre(shell.centre, box, state.viewMode, actions);
  else if (f.kind === "hands") renderHandsCentre(shell.centre, box, actions);
  else if (f.kind === "deck") {
    const deck = box.decks.find((d) => d.id === f.deck);
    if (!deck) { shell.centre.classList.remove("measured"); shell.centre.replaceChildren(); return; }
    ensureCatalogue(deck.id);
    const cat = catalogueDeck === deck.id ? catalogue : [];
    renderDeckCentre(shell.centre, box, deck, cat, new Set(cardSelection), state.viewMode,
      (h, tab) => renderDeckTabBody(h, box, deck, tab, cat, inspectorHost), actions);
  }
  else { shell.centre.classList.remove("measured"); shell.centre.replaceChildren(); }
}
// Repaint the browse views after a background save, without rebuilding a live
// editor mid-edit (each owns its local model + cursor). A selected card splits
// its editing across both centre (authoring) and inspector (settings), so leave
// both alone and refresh only the nav + problems; otherwise the inspector edits
// and the centre is the deck browse, so repaint the centre.
function repaintAfterSave(): void {
  renderNavPane();
  const editing = inspected?.kind === "card" || inspected?.kind === "template"
    || inspected?.kind === "hand" || inspected?.kind === "tagGroup"
    || inspected?.kind === "deck" || focus?.kind === "box";
  if (!editing) renderCentre();
}
/** Ask who is at the keyboard, and keep the answer. The shell owns the dialog;
 *  where it is stored is the app's business (its own state file, never the
 *  project). */
async function saveIdentity(): Promise<void> {
  const current = await studio.identity();
  // Offer the VCS's name only when nothing is stored (simple-vc-lib 0.4.1): a
  // stored identity is the author's own answer and must not be overwritten by
  // what the working copy happens to be configured with.
  const suggested = current ? undefined : await studio.offeredIdentity();
  const answer = await askIdentity({
    ...(current ? { current } : {}),
    // The shell offers a whole Identity; the VCS only knows a name.
    ...(suggested ? { suggested: { name: suggested } } : {}),
  });
  if (answer) await studio.setIdentity(answer);
}

function flash(message: string, kind: "error" | "ok" = "error"): void {
  toastNode?.remove();
  toastNode = el("div", { className: `toast ${kind}`, text: message });
  document.body.append(toastNode);
  setTimeout(() => { toastNode?.remove(); toastNode = undefined; }, 4000);
}
const flashError = (m: string): void => flash(m, "error");

// Project Settings dialog (the shared settings shell + storylet sections). A
// save reloads the project (new properties change the expr-editor catalogue).
const projectSettingsPanel = createProjectSettings(
  studio,
  (result) => { applyResult(result); catalogueDeck = undefined; renderWorkspace(); },
  flashError,
);

// Right-click on a property pill: Go to definition / Find usages (the ruling
// of 2026-08-26, with the Story page). A box or deck ref names no owner, and
// needs none: a @deck pill in a card can only mean that card's own deck, so
// definition is "in the box/deck you are looking at". An @hand ref that names
// a tag group's own enum opens that group; any other @hand name is declared on
// tags, so the box's Tags tab is its home.
setPropertyNavigator({
  goToDefinition(ref) {
    if (ref.scope === "world") { projectSettingsPanel.open("world"); return; }
    // A jump, so it remembers the way back: the crumb bar's return control
    // (the Map's arriveFrom grammar) rather than leaving the author stranded
    // at the declaration (reported from use, 2026-08-26). World is exempt
    // above because a dialog dismisses back to where you were by itself.
    const here = returnHere();
    const jump = (navigate: () => void): void =>
      here ? arriveFrom(here.label, here.go, navigate) : (navigate(), renderWorkspace());
    if (ref.scope === "story") { jump(() => actions.focus({ kind: "story" })); return; }
    const box = currentBox();
    if (!box) return;
    if (ref.scope === "box") {
      jump(() => { actions.focus({ kind: "box", box: box.id }); setDocTab(`box:${box.id}`, "properties"); });
    } else if (ref.scope === "deck") {
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

// The two kit SCALES have their own names (the author's ruling, 2026-08-29):
// a BOX KIT scaffolds one box, a GAME KIT scaffolds a whole project. "Kit"
// alone said the same sentence at both scales, which read as deliberate but
// left an author unable to say which one they meant. Reboot's glossary called
// the project-scale thing a "template of play"; that phrase stays for the
// LAYERING idea it also names (the spatial map, story acts), and the pickable
// thing is a game kit.
//
// The New Box kit picker: the new-document moment (Word / Photoshop). One
// card per kit; Esc or a backdrop click cancels.
/** New box: the kit picker, no name field - a box is named after the fact. */
function openBoxKitPicker(onPick: (kit: BoxKit) => void): void {
  openKitPicker<BoxKit>({
    title: "New box",
    what: "A box holds one self-contained set of cards, places and tags: one region, one chapter, one cast.",
    sub: "A box kit is a starting point you own: fully editable the moment it lands.",
    kits: [
      { id: "blank", name: "Blank", blurb: "An empty box. Add your own decks, tags, hand templates and hands." },
      { id: "rpg", name: "RPG encounters", blurb: "The place-based starter: an area tag group, an encounters-at template with one place already on the board, and an encounter whose outcome raises the tension. Teaches boxes, tags, and what playing a card does." },
      { id: "dialogue", name: "Dialogue topics", blurb: "One hand of topics per NPC, including a shared rumour with a single copy - whoever offers it first claims it. Teaches hands, exclusivity and copies." },
    ],
    onPick: (kit) => onPick(kit),
  });
}

/**
 * New project: the same picker, one scale up, with a name.
 *
 * The kit LIST is deliberately one entry. A project kit library is wanted (the
 * design review's A5 says so, and it is why this is a picker rather than a
 * form), but nobody has specified what the shapes are, and inventing four
 * plausible ones would be putting content in front of a decision. The shape is
 * here; filling it is a content job.
 */
function openNewProject(): void {
  openKitPicker<"blank">({
    title: "New project",
    what: "A project is one game's worth of storylets: boxes of cards, the places they are dealt to, and the bundle your game loads.",
    sub: "A game kit is a starting point you own: fully editable the moment it lands.",
    namePlaceholder: "<e.g. The Village>",
    // NOT "Empty project ... and nothing else", which was false: init lands a box,
    // a `whats-next` hand and two wired cards, so a new project plays immediately.
    // The old blurb undersold the one thing that gets a newcomer to press Play.
    kits: [{ id: "blank", name: "Starter project", blurb: "One box, one place to deal to, and two cards that already work together. Add kits to it as you go." }],
    onPick: (_kit, name) => { if (name !== undefined) void adopt(studio.createProject(name)); },
  });
}

function renderWorkspace(): void {
  reportLinkFocus();
  if (!project) return;
  // A13: the project name is a WAY HOME, as it is in Patterpad. The project
  // overview page existed with exactly one route to it - the navigator's project
  // row - so collapsing the navigator made the page unreachable. Patterpad
  // reaches its overview two ways, the topbar name being one.
  // ...and the tooltip says WHERE, because two projects can share a name and
  // nothing else on the screen tells them apart - which bit the author on a
  // second copy of the Village. Patterpad's topbar name carries the root path
  // for exactly this reason; ours keeps the destination line above it, since
  // this button also goes somewhere and Patterpad's does not say so.
  shell.topbarLead.replaceChildren(el("button", {
    className: "pname",
    text: `${project.name} - Storyletter`,
    tip: `The project overview\n${project.dir}`,
    onClick: () => actions.focus({ kind: "project" }),
  }));
  renderNavPane();
  if (!renderCardPanes() && !renderDetailPanes()) fillCentre();
  renderProblemsBar();
  saveEl.set(saver.status);
  applyVc();
  // The walk's bar above the problems bar: a mode you entered outranks an
  // ambient one, and the pair keeps a stable order however they come and go.
  app.replaceChildren(shell.root, reviewbar, problembar);
  histPair?.set(history.canBack(), history.canForward());
  // A freshly created thing asks to be named: the title focused, the
  // placeholder text selected so typing replaces it. Generalised here so
  // every create path (card, deck, box, hand) gets the same manners. The
  // flag survives a short settling window rather than one render, because
  // an async follow-up (the deck page's catalogue load) repaints the centre
  // right behind the first render and was dropping the focus on the floor.
  if (pendingFocusTitle) {
    const t = document.querySelector<HTMLInputElement>(".pane-centre .doc-title");
    if (t) { t.focus(); t.select(); }
    if (focusTitleTimer === undefined) {
      focusTitleTimer = setTimeout(() => { pendingFocusTitle = false; focusTitleTimer = undefined; }, 400);
    }
  }
  rememberPlace();
}

/** Remember the page for next launch (structure rule 13). Called on every render
 *  rather than at each navigation, so a tab switch counts too; main writes only
 *  when the value actually changes. */
function rememberPlace(): void {
  const place = capturePlace();
  if (!place) return;
  void studio.setLastPlace({
    focus: place.focus,
    ...(place.inspected ? { inspected: place.inspected } : {}),
    ...(place.tab !== undefined ? { tab: place.tab } : {}),
  });
}

// --- flows ---------------------------------------------------------------------
function defaultFocus(): Focus | undefined {
  const box = project?.boxes[0];
  if (!box) return undefined;
  const deck = box.decks[0];
  return deck ? { kind: "deck", box: box.id, deck: deck.id } : { kind: "box", box: box.id };
}

/**
 * The page the app was last closed on, checked against the project as it is NOW
 * and falling back UP THE TREE when what was open has gone: card, then its deck,
 * then its box, then the project's own default. A project edited on another branch
 * must never reopen to an error (structure rule 13).
 *
 * Returns undefined when there is nothing usable, and the caller falls back to the
 * ordinary default.
 */
function restoredPlace(): { focus: Focus; inspected?: Inspected } | undefined {
  const place = state.lastPlace;
  if (!place || !project) return undefined;
  if (place.focus.kind === "story") return { focus: { kind: "story" } };
  const box = project.boxes.find((b) => b.id === place.focus.box);
  const deck = box?.decks.find((d) => d.id === place.focus.deck);
  const doc = place.inspected;

  // The document first, because it is the specific thing the author was looking at.
  if (doc && box) {
    const docDeck = box.decks.find((d) => d.id === doc.deck);
    const card = docDeck?.cards.find((c) => c.id === doc.card);
    if (doc.kind === "card" && docDeck && card) {
      if (place.tab) setDocTab(`card:${docDeck.id}:${card.id}`, place.tab);
      return { focus: { kind: "deck", box: box.id, deck: docDeck.id }, inspected: { kind: "card", box: box.id, deck: docDeck.id, card: card.id } };
    }
    if (doc.kind === "template" && box.templates.some((x) => x.id === doc.template)) {
      if (place.tab) setDocTab(`template:${doc.template}`, place.tab);
      return { focus: { kind: "box", box: box.id }, inspected: { kind: "template", box: box.id, template: doc.template! } };
    }
    if (doc.kind === "hand" && box.hands.some((x) => x.id === doc.hand)) {
      if (place.tab) setDocTab(`hand:${doc.hand}`, place.tab);
      return { focus: { kind: "hands", box: box.id }, inspected: { kind: "hand", box: box.id, hand: doc.hand! } };
    }
    if (doc.kind === "tagGroup" && box.tagGroups.some((x) => x.id === doc.group)) {
      return { focus: { kind: "box", box: box.id }, inspected: { kind: "tagGroup", box: box.id, group: doc.group! } };
    }
  }
  // Then the deck it was in, then its box: the fallback up the tree.
  if (box && deck) {
    if (place.tab) setDocTab(`deck:${deck.id}`, place.tab);
    return { focus: { kind: "deck", box: box.id, deck: deck.id }, inspected: { kind: "deck", box: box.id, deck: deck.id } };
  }
  if (box) {
    // A box page remembers WHICH tab, which is the whole point for the Map.
    if (place.tab) setDocTab(`box:${box.id}`, place.tab);
    const kind = place.focus.kind === "decks" || place.focus.kind === "hands" ? place.focus.kind : "box";
    return { focus: { kind, box: box.id } as Focus, inspected: { kind: "box", box: box.id } };
  }
  return undefined;
}

/** Close Project: flush what's pending, tell main (which tears the session
 *  down and closes the tool windows), then return this window to the welcome
 *  screen - the same no-project rendering boot uses. */
async function closeProject(): Promise<void> {
  await flushSaves();
  await studio.closeProject();
  project = undefined;
  focus = undefined;
  inspected = undefined;
  detail = undefined;
  catalogueDeck = undefined;
  setCameFrom(undefined);
  liveLinkChip?.setVisible(false);
  clearVc();
  state = await studio.getState();   // recents may have changed; welcome reads them
  welcomeError = "";
  renderWelcome();
}

async function adopt(pending: Promise<OpenResult | { error: string } | null>): Promise<void> {
  const result = await pending;
  if (result === null) return;
  if ("error" in result) { welcomeError = result.error; project = undefined; clearVc(); state = await studio.getState(); renderWelcome(); return; }
  welcomeError = "";
  // A different project is a different sitting: tab choices do not carry over.
  if (project !== undefined && project.dir !== result.project.dir) resetDocTabMemory();
  project = result.project;
  problems = result.problems;
  problemAt = 0;
  liveLinkChip?.setVisible(true);   // Live Link: the control is available once a project is open
  state = await studio.getState();
  navExpanded = new Set(state.navExpanded ?? []);
  // A remembered walk comes back with the project, not with the app: its list is
  // this project's comments.
  reviewAt = 0;
  renderReviewWalk();      // paints, or hides, whichever the remembered mode says
  void gatherReview();
  void gatherCoverage();
  const restored = restoredPlace();
  focus = restored?.focus ?? defaultFocus();
  inspected = restored
    ? restored.inspected
    : focus && focus.kind === "deck" ? { kind: "deck", box: focus.box, deck: focus.deck }
    : focus && focus.kind === "box" ? { kind: "box", box: focus.box } : undefined;
  clearVc();
  renderWorkspace();
  // A `--at` launch: the item named on the command line, over the remembered place.
  if (result.at) goTo(result.at);
  void refreshVc();   // badge the shards + apply read-only from the VC snapshot
}

async function revalidate(): Promise<void> {
  if (!project) return;
  const result = await studio.revalidate();
  if (!result) return;
  applyResult(result);
  // Fall back only when the focus POINTS INTO a box that no longer resolves.
  // The project page and the Story document carry no box, and treating that
  // as dangling threw the author onto the first deck on every window focus -
  // which is what made the Story restore look flaky: boot restored it, and
  // the first revalidate stomped it (reported 2026-08-27).
  if (!focus || (focus.box !== undefined && !currentBox())) { focus = defaultFocus(); inspected = undefined; }
  renderWorkspace();
  void refreshVc();
}

async function exportBundle(): Promise<void> {
  const result = await studio.exportBundle();
  if ("error" in result) { flashError(result.error); return; }
  flash(`Exported ${baseName(result.path)}`, "ok");
  void revalidate();
}

/** Publish Spreadsheet: the whole project as a readable .xlsx, to a path chosen
 *  in a native Save dialog (main). The workbook is read from the FILES, so
 *  pending edits land first. */
async function exportSpreadsheet(): Promise<void> {
  await flushSaves();
  const result = await studio.exportXlsx();
  if (result === null) return;
  if ("error" in result) { flashError(result.error); return; }
  flash(`Published ${baseName(result.path)}`, "ok");
}

/** Publish Playable HTML: the project as one self-contained page that plays
 *  in any browser, to a path chosen in a native Save dialog (main). Compiled
 *  from the FILES, so pending edits land first. */
async function exportPlayable(): Promise<void> {
  await flushSaves();
  const result = await studio.exportHtml();
  if (result === null) return;
  if ("error" in result) { flashError(result.error); return; }
  flash(`Published ${baseName(result.path)}`, "ok");
}

// --- the send envelope (.storyletpack) ---------------------------------------

/** Export the project as a pack, to hand to someone with no shared VCS. */
async function exportPack(): Promise<void> {
  await flushSaves();   // a pack is a snapshot of the FILES, so land edits first
  const result = await studio.exportPack();
  if (result === null) return;
  if ("error" in result) { flashError(result.error); return; }
  flash(`Packed ${baseName(result.path)}`, "ok");
}

/** Open a pack: explode it somewhere the author chooses, then open that. The
 *  result is an ordinary project open, so it goes through `adopt` like any
 *  other - a pack that has been unpacked is just a project. */
async function openPack(): Promise<void> {
  await flushSaves();
  await adopt(studio.openPack());
}

/**
 * Merge a returned pack back in, against the pack that was sent.
 *
 * PLAN, confirm, commit. The op is pure, so the whole merge runs before anything
 * is written and the confirmation can quote REAL counts - "7 merged, 2 added, 3
 * conflicts will keep yours" - rather than describing what is about to be
 * attempted. A confirmation that cannot say what will happen is only a speed bump.
 * (Adopted from the Patter side, which built this shape first.)
 */
async function mergePack(): Promise<void> {
  await flushSaves();
  const planned = await studio.mergePackPlan();
  if (planned === null) return;                       // a picker was cancelled
  if ("error" in planned) { flashError(planned.error); return; }
  const { shards, conflicts, assets, keptAssets, provenance } = planned.summary;
  const added = shards.filter((s) => s.added).length;
  const merged = shards.length - added;

  const counts = [
    `${merged} merged`,
    ...(added > 0 ? [`${added} added`] : []),
    ...(assets > 0 ? [`${assets} picture${assets === 1 ? "" : "s"} added`] : []),
    ...(keptAssets > 0 ? [`${keptAssets} of yours kept`] : []),
  ].join(", ");
  const conflictLine = conflicts > 0
    ? ` ${conflicts} conflict${conflicts === 1 ? "" : "s"} will keep YOUR version, with a .storyletconflict file beside each.`
    : "";
  // The mismatch is the HEADLINE when there is one, because it is the thing most
  // likely to mean the author picked the wrong file. Cancel is the shell confirm's
  // focused button either way, so the safe answer is the one already under the
  // keyboard. It warns and never refuses: an id can legitimately differ.
  const ok = await confirmDialog({
    title: provenance !== undefined ? "This pack may not belong to this project" : "Merge the returned pack?",
    // ONE paragraph, deliberately: `.confirm-body` sets no `white-space`, so a
    // newline here collapses to a space and a `\n\n` is two characters that do
    // nothing. Written as prose that reads without the break rather than as prose
    // that needs one it will not get.
    body: provenance !== undefined
      ? `${provenance} Merging anyway would give you ${counts}.${conflictLine}`
      : `${counts}.${conflictLine} Undo restores the project as it was.`,
    confirmLabel: "Merge",
  });
  if (!ok) { await studio.mergePackDrop(); return; }

  const result = await studio.mergePackCommit();
  if (result === null) return;
  if (!applied(result)) return;
  // A conflict is not a failure, but it is not a success either: the shard was
  // written provisionally with OURS and a sidecar sits beside it.
  if (conflicts > 0) flashError(`${counts}; ${conflicts} conflict(s) need a look - see the .storyletconflict files`);
  else flash(`Merged the returned pack (${counts})`, "ok");
}

/** Tell main which card the lens should be looking at: the card the author last
 *  touched, whether that is a card OPEN in the editor or one selected in a deck's
 *  three views. Fire and forget: the lens is a convenience, never a dependency.
 *
 *  The fallback is load-bearing rather than a nicety. This runs on every render,
 *  and while it reported only the open document it cleared the focus a
 *  card selection had just set the moment anything re-rendered: select a card on
 *  the node canvas, open Links, and the window said "open a card in the editor"
 *  about the card you had in hand. Two writers, one value, and the wrong one
 *  landed last. */
function lensCard(): string | undefined {
  return inspected?.kind === "card" ? inspected.card : browseCursor;
}
function reportLinkFocus(): void {
  void studio.setLinkFocus(lensCard());
}

async function undoRedo(which: "undo" | "redo"): Promise<void> {
  if (!project) return;
  await flushSaves();   // land pending edits before stepping history
  const result = which === "undo" ? await studio.undo() : await studio.redo();
  if (!result) return;
  applyResult(result);
  // The reverted content may have removed what's selected; fall back calmly -
  // for EVERY item type, not just cards (v3 8).
  const box = currentBox();
  const ins = inspected;
  const ok = !ins
    || (ins.kind === "card" ? (box?.decks.some((d) => d.id === ins.deck && d.cards.some((c) => c.id === ins.card)) ?? false)
    : ins.kind === "deck" ? (box?.decks.some((d) => d.id === ins.deck) ?? false)
    : ins.kind === "template" ? (box?.templates.some((t) => t.id === ins.template) ?? false)
    : ins.kind === "hand" ? (box?.hands.some((x) => x.id === ins.hand) ?? false)
    : ins.kind === "tagGroup" ? (box?.tagGroups.some((d) => d.id === ins.group) ?? false)
    : true);
  if (!box || !ok) {
    focus = defaultFocus();
    inspected = focus && focus.kind === "deck" ? { kind: "deck", box: focus.box, deck: focus.deck } : undefined;
    detail = undefined;
  }
  renderWorkspace();
  void refreshVc();
}

function onMenu(command: MenuCommand): void {
  switch (command.cmd) {
    case "open": void adopt(studio.openProjectDialog()); break;
    case "open-recent": void adopt(studio.openProjectPath(command.path)); break;
    case "search": if (project) void studio.openSearch(); break;
    // Find's other tabs: Edit > Replace… and Review > Find Property Usage…
    case "replace": if (project) void studio.openSearch({ mode: "replace" }); break;
    case "search-property": if (project) void studio.openSearch({ mode: "property" }); break;
    case "undo": void undoRedo("undo"); break;
    case "redo": void undoRedo("redo"); break;
    case "table": if (project) void (async () => { await flushSaves(); await studio.openTable(); })(); break;
    case "coverage": if (project) void (async () => { await flushSaves(); await studio.openCoverage(); })(); break;
    // The card goes WITH the request, so the window cannot boot and read the focus
    // before the report of it arrives.
    case "links": if (project) void (async () => { await flushSaves(); await studio.openLinks(lensCard()); })(); break;
    case "export": if (project) void exportBundle(); break;
    case "export-xlsx": if (project) void exportSpreadsheet(); break;   // Publish Spreadsheet
    case "export-html": if (project) void exportPlayable(); break;   // Publish Playable HTML
    case "export-pack": if (project) void exportPack(); break;
    case "open-pack": void openPack(); break;
    case "merge-pack": if (project) void mergePack(); break;
    case "project-settings": if (project) projectSettingsPanel.open(command.section); break;
    case "identity": void saveIdentity(); break;
    case "about": void showAbout({
      appName: "Storyletter",
      version: command.version,
      blurb: "A studio for storylets: content that offers itself when the moment is right.",
      credits: "Part of PatterKit. Made by Ian Thomas.",
      links: [
        { label: "patterkit.dev", url: "https://patterkit.dev" },
        { label: "ian.wildwinter.net", url: "https://ian.wildwinter.net" },
      ],
      onOpenLink: (url: string) => void studio.openExternal(url),
    }); break;
    case "show-resolved":
      void remember("showResolved", command.on);
      // The toggle decides whether resolved threads are IN the walk, so the loop
      // has to be re-gathered rather than left describing the old rule.
      void gatherReview();
      break;
    case "new-project": openNewProject(); break;
    // A6's four, each now reachable from a menu as well as a key. The handlers
    // are the SAME paths the keystrokes ran, so the menu is a second door rather
    // than a second implementation.
    case "new-card": {
      const f = focus;
      if (f?.kind !== "deck") break;   // a card is made IN a deck; nowhere else has one to add to
      const box = currentBox();
      const deck = box?.decks.find((d) => d.id === f.deck);
      if (box && deck) actions.newCard(box.id, deck.id);
      break;
    }
    case "save": if (project) void flushSaves(); break;
    case "go-up": if (project) goUp(); break;
    case "close-project": if (project) void closeProject(); break;
    case "nav-back": if (project) travel((c) => history.back(c)); break;
    case "nav-forward": if (project) travel((c) => history.forward(c)); break;
    case "project-overview": if (project) actions.focus({ kind: "project" }); break;
    case "coverage-overlay": setCoverageOverlay(command.on); break;
    case "review-walk": setReviewWalk(command.on); break;
    case "review-next": stepReview(1); break;
    case "review-prev": stepReview(-1); break;
    case "duplicate": if (project) void duplicateSelection(); break;
    case "toggle-nav": if (project) shell.togglePane("nav"); break;
    case "reset-view": if (project) { shell.resetWidths(); shell.setPaneOpen("nav", true); void studio.resetWindows(); } break;
    case "toggle-auto-rebuild": if (project) void toggleAutoRebuild(); break;
    case "live-link": if (project) liveLinkChip?.toggle(); break;   // Live Link: the chip's click, from the menu
    case "theme": void setTheme(command.theme); break;
  }
}

/** Edit > Duplicate: clone the inspected card (outcomes duplicate from their
 *  own right-click menu). */
function duplicateSelection(): void {
  if (!inspected) return;
  switch (inspected.kind) {
    case "card": actions.duplicateCard(inspected.box, inspected.deck, inspected.card); break;
    case "deck": actions.duplicateDeck(inspected.box, inspected.deck); break;
    case "template": actions.duplicateTemplate(inspected.box, inspected.template); break;
    case "hand": actions.duplicateHand(inspected.box, inspected.hand); break;
    case "tagGroup": actions.duplicateTagGroup(inspected.box, inspected.group); break;
    case "box": break;   // a box is a folder of shards; duplication is a VCS-level act
  }
}

async function toggleAutoRebuild(): Promise<void> {
  await remember("autoRebuild", !state.autoRebuild);
  if (state.autoRebuild) void exportBundle();   // rebuild once on enable
}

// --- boot ----------------------------------------------------------------------
async function boot(): Promise<void> {
  state = await studio.getState();
  navExpanded = new Set(state.navExpanded ?? []);
  hydrateCameras(state.canvasCameras);
  for (const [boxId, groupId] of Object.entries(state.mapGroups ?? {})) mapGroup.set(boxId, groupId);
  // One delegated controller for every `data-tip` in the window (Patterpad's
  // themed tooltip, now shell-side): our own bubble on our own delay, rather
  // than the platform's unstyled one after a second of waiting.
  initTooltips();
  applyTheme(state.theme);
  studio.onTheme(applyTheme);
  mountShell();   // build the pane frame once, seeded from the persisted pane state
  liveLinkChip = mountLiveLinkChip(studio);   // Live Link: hidden until a project is open
  studio.onMenu(onMenu);
  // The updater's four channels. Registered at boot, not lazily: main starts its
  // first background check 10 seconds after ready, and a prompt that arrives with
  // nobody listening waits 300 seconds and then answers itself.
  studio.onUpdaterCheckDirty(() => saver.pending);
  studio.onUpdaterSaveBeforeInstall(async () => { await saver.flush(); return { ok: !saver.pending }; });
  studio.onUpdaterPrompt((opts) => showUpdaterDialog(opts));
  studio.onUpdaterDownloadProgress(feedUpdaterDownloadProgress);
  studio.onSearchNavigate(goTo);   // Find hits, and the `--at` jump of a running app
  // Find's Replace tab: main asks for pending edits on disk before it rewrites,
  // and says when it has, so the open document shows the new text.
  studio.onEditorFlush(() => void (async () => { await flushSaves(); await studio.editorFlushed(); })());
  studio.onReplaceApplied((count) => void (async () => {
    await revalidate();
    flash(`Replaced ${count} across the project`, "ok");
  })());
  // The OS asked the running app to open something else.
  studio.onProjectOpened((result) => void adopt(Promise.resolve(result)));
  window.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    // Cmd+1 (pane toggle) is a native menu accelerator now (View menu).
    // Cmd+S is a MENU accelerator now (File > Save), so it never reaches here:
    // Electron consumes it first. Handling it in both places would be two
    // implementations of one key, which is the drift this review is about.
    // WHAT IS UNDER THE CURSOR, decided before any shortcut reads a key.
    //
    // This used to be computed below the up-a-level branch, and on macOS that
    // made Cmd+Left (start of line) and Cmd+Up (start of document) navigate out
    // of whatever you were typing in - a card title, a beat, any value field.
    // Both are OS-standard text keys, and the sibling app is keyboard-first by
    // charter, so an app in this family breaking one breaks the promise that a
    // hand trained on the other works here (design review 2026-08, A1).
    const t = event.target as HTMLElement | null;
    const editable = !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable);
    // Up a level: Cmd+Up as before, plus the platform's own back gesture
    // (Cmd+[ and Cmd+Left), because that is what a hand trained on a browser or
    // the Finder reaches for. Never while a field has the cursor: the field's
    // own meaning for those keys wins, and Esc is the documented way out first,
    // which is the same two-step Esc already uses below.
    // Cmd+[ is on the View menu now (Up a Level) and is consumed there. What is
    // left here is the pair the menu deliberately does NOT advertise: Cmd+Up and
    // Cmd+Left are OS text keys first, which is why they are gated on `editable`
    // and why the menu names the unambiguous one instead.
    if (mod && !editable && (event.key === "ArrowUp" || event.key === "ArrowLeft")) {
      event.preventDefault();
      if (project) goUp();
      return;
    }
    if (!project || mod) return;
    // Esc first blurs a field; from the card editor it returns to the deck.
    if (event.key === "Escape") {
      if (editable) { t.blur(); return; }
      if (inspected?.kind === "card" && focus?.kind === "deck") {
        event.preventDefault();
        selectCards([inspected.card]);
        actions.focus({ kind: "deck", box: focus.box, deck: focus.deck });
      }
      return;
    }
    if (editable) return;
    // The card editor: step through the deck (v3 3).
    if (inspected?.kind === "card" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const box = currentBox();
      const deck = box?.decks.find((d) => d.id === (inspected as { deck: string }).deck);
      if (box && deck) {
        const at = deck.cards.findIndex((c) => c.id === (inspected as { card: string }).card);
        const nextCard = deck.cards[at + (event.key === "ArrowDown" ? 1 : -1)];
        if (nextCard) { event.preventDefault(); actions.inspectCard(box.id, deck.id, nextCard.id); }
      }
      return;
    }
    // Delete the selection from the card and table views. The canvas has its own
    // Delete, through the surface's keyboard map, and both land on the same
    // guarded path. Not while a card editor is open: there Delete belongs to
    // whatever the author is editing.
    if (focus?.kind === "deck" && inspected?.kind === "deck"
        && (event.key === "Delete" || event.key === "Backspace") && cardSelection.length > 0
        && state.viewMode !== "node") {
      event.preventDefault();
      void deleteCards([...cardSelection]);
      return;
    }
    // The deck browse: arrows move the cursor, Enter opens, N creates (v3 5).
    if (focus?.kind === "deck" && inspected?.kind === "deck") {
      const box = currentBox();
      const dk = box?.decks.find((d) => d.id === (focus as { deck: string }).deck);
      // The bare N is RETIRED (A6). It made a new card with no menu item and no
      // cue anywhere, and a bare letter as an accelerator appears nowhere in the
      // sibling app's vocabulary - so an author either knew it or never found
      // it. File > New Card on Shift+Cmd+N replaces it, which is Patterpad's key
      // for the same act one container down.
      if (!box || !dk || dk.cards.length === 0) return;
      const at = browseCursor ? dk.cards.findIndex((c) => c.id === browseCursor) : -1;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        selectCards([dk.cards[Math.min(at + 1, dk.cards.length - 1)]!.id]);
        renderCentre();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        selectCards([dk.cards[Math.max(at - 1, 0)]!.id]);
        renderCentre();
      } else if (event.key === "Enter" && browseCursor) {
        event.preventDefault();
        actions.inspectCard(box.id, dk.id, browseCursor);
      }
    }
  });
  // Persist pending edits when leaving or closing the editor window (so the
  // Table reads current disk, and a close never drops the last keystrokes).
  window.addEventListener("blur", () => { if (project) void flushSaves(); });
  window.addEventListener("beforeunload", () => { if (project) void flushSaves(); });
  window.addEventListener("focus", () => { if (project) void revalidate(); });
  // Version-control state changes under us (somebody takes a lock, a newer
  // revision lands), so poll as well as refreshing on focus / save / load.
  // Cheap: main throttles the server round-trip and coalesces the callers.
  window.setInterval(() => void refreshVc(), 30_000);
  // Who is at the keyboard, asked ONCE on first run and skippable: Patterpad's
  // first-run identity, at Patterpad's moment. An earlier cut asked at the first
  // comment instead, on the grounds that somebody who never comments should
  // never be asked - which was a preference dressed up as a reason, and not
  // enough to make the two apps behave differently. The two apps are a family.
  if (!(await studio.identity())) await saveIdentity();

  // A double-clicked project or pack wins over the last project: the author
  // just said which one they want.
  const launched = await studio.launchTarget();
  if (launched !== null) { await adopt(Promise.resolve(launched)); if (project) return; }
  if (state.lastProject) { await adopt(studio.openProjectPath(state.lastProject)); if (project) return; }
  renderWelcome();
}
void boot();
