// ---------------------------------------------------------------------------
// Commands: the native menus' clicks (main sends them as MenuCommands) and the
// keys the window answers itself.
//
// Each menu command runs the SAME path its key or button runs, so the menu is
// a second door rather than a second implementation. The keyboard map is the
// half the menus deliberately do not advertise (OS text keys first, Esc as up
// a level, the deck browse), registered once at boot.
// ---------------------------------------------------------------------------

import { isEditableTarget, showAbout } from "@wildwinter/app-shell";
import type { PaneShell } from "@wildwinter/app-shell";
import { STORYLETTER_WORDMARK } from "./wordmark.js";
import { flash, flashError, ok } from "./results.js";
import { showInPatterpad } from "./show-in-patterpad.js";
import { remember } from "./session.js";
import type { Navigation } from "./navigation.js";
import type { SaveQueue } from "./save-queue.js";
import type { Comments } from "./comments.js";
import type { Exchange } from "./exchange.js";
import type { ViewActions } from "./views.js";
import type { Session } from "./session.js";
import type { MenuCommand, OpenResult, ThemeChoice } from "../../shared/api.js";

/** Everything that can sit on top of the page and take an Esc for itself. */
const OVERLAYS = "dialog[open], .shell-anchored, .popover, .ctxmenu, .exed-pop";

export interface CommandsContext {
  session: Session;
  nav: Navigation;
  actions: () => ViewActions;
  saves: SaveQueue;
  comments: Comments;
  exchange: Exchange;
  shell: () => PaneShell;
  render: () => void;
  renderCentre: () => void;
  refreshVc: () => void;
  applied: (r: OpenResult | { error: string }) => boolean;
  deleteSelection: () => Promise<void>;
  adopt: (pending: Promise<OpenResult | { error: string } | null>) => Promise<void>;
  clearRecents: () => Promise<void>;
  closeProject: () => Promise<void>;
  openNewProject: () => void;
  saveIdentity: (mode: "welcome" | "edit") => Promise<void>;
  setTheme: (theme: ThemeChoice) => Promise<void>;
  setCoverageOverlay: (on: boolean) => void;
  openSettings: (section?: string) => void;
  /** Live Link: the chip's click, from the menu. */
  toggleLiveLink: () => void;
}

export function createCommands(ctx: CommandsContext) {
  const { session, nav, saves, comments, exchange } = ctx;
  const studio = session.studio;
  /** Whether the Esc being handled belonged to something on top. */
  let escOverlay = false;

  /** Run `work` once pending edits have landed: a window that reads the files
   *  (the Board, Coverage, Links) must see what was just typed. */
  const afterFlush = (work: () => Promise<unknown>): void => { void (async () => { await saves.flush(); await work(); })(); };

  /**
   * Edit > Select All, scoped as Patterpad scopes it (review 2026-10). The canvas
   * is offered it first, through the same key it answers when it holds the
   * keyboard (its own rule for when that is); then a focused field selects its
   * own text; anywhere else nothing happens, rather than the whole page lighting up.
   */
  function selectAllCommand(): void {
    const mac = navigator.platform.startsWith("Mac");
    const key = new KeyboardEvent("keydown", { key: "a", metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
    window.dispatchEvent(key);
    if (key.defaultPrevented) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) { active.select(); return; }
    if (active instanceof HTMLElement && isEditableTarget(active) && !(active instanceof HTMLSelectElement)) {
      const range = document.createRange();
      range.selectNodeContents(active);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  /** Edit > Undo / Redo: land pending edits, step history, and fall back calmly
   *  if the step took away what was open. */
  async function undoRedo(which: "undo" | "redo"): Promise<void> {
    if (!session.project) return;
    await saves.flush();   // land pending edits before stepping history
    const result = which === "undo" ? await studio.undo() : await studio.redo();
    // Null: nothing to step. A failed write is said, and nothing moves.
    if (!result || !ctx.applied(result)) return;
    // The reverted content may have removed what's selected; fall back calmly -
    // for EVERY item type, not just cards (v3 8).
    const box = nav.currentBox();
    const ins = nav.inspected;
    const still = !ins
      || (ins.kind === "card" ? (box?.decks.some((d) => d.id === ins.deck && d.cards.some((c) => c.id === ins.card)) ?? false)
      : ins.kind === "deck" ? (box?.decks.some((d) => d.id === ins.deck) ?? false)
      : ins.kind === "template" ? (box?.templates.some((t) => t.id === ins.template) ?? false)
      : ins.kind === "hand" ? (box?.hands.some((x) => x.id === ins.hand) ?? false)
      : ins.kind === "tagGroup" ? (box?.tagGroups.some((d) => d.id === ins.group) ?? false)
      : true);
    if (!box || !still) {
      nav.focus = nav.defaultFocus();
      nav.inspected = nav.focus && nav.focus.kind === "deck" ? { kind: "deck", box: nav.focus.box, deck: nav.focus.deck } : undefined;
      nav.detail = undefined;
    }
    ctx.render();
    ctx.refreshVc();
  }

  /** Edit > Duplicate: clone the open document (outcomes duplicate from their
   *  own right-click menu). */
  function duplicateSelection(): void {
    const actions = ctx.actions();
    const ins = nav.inspected;
    if (!ins) return;
    switch (ins.kind) {
      case "card": actions.duplicateCard(ins.box, ins.deck, ins.card); break;
      case "deck": actions.duplicateDeck(ins.box, ins.deck); break;
      case "template": actions.duplicateTemplate(ins.box, ins.template); break;
      case "hand": actions.duplicateHand(ins.box, ins.hand); break;
      case "tagGroup": actions.duplicateTagGroup(ins.box, ins.group); break;
      case "box": break;   // a box is a folder of shards; duplication is a VCS-level act
    }
  }

  /** Edit > Show Scene in Patterpad: the open card's scene, in the paired Patter
   *  project. Pending edits land first, since a gameId just typed is the address
   *  Patterpad is asked for. */
  async function editInPatterpad(): Promise<void> {
    const ins = nav.inspected;
    if (ins?.kind !== "card") { flashError("Open a card first. Its scene is the one named after it."); return; }
    await saves.flush();
    const result = await showInPatterpad(studio, ins.card);
    if (result === null) return;
    if (!ok(result)) return;
    flash(result.published
      ? `Opening ${result.address} in Patterpad`
      : `Opening Patterpad at ${result.address}. The published Patter bundle has no scene by that name yet.`, "ok");
  }

  function onMenu(command: MenuCommand): void {
    const project = session.project;
    switch (command.cmd) {
      case "select-all": selectAllCommand(); break;
      case "open": void ctx.adopt(studio.openProjectDialog()); break;
      case "open-recent": void ctx.adopt(studio.openProjectPath(command.path)); break;
      case "clear-recents": void ctx.clearRecents(); break;
      case "search": if (project) void studio.openSearch(); break;
      // Find's other tabs: Edit > Replace… and Review > Find Property Usage…
      case "replace": if (project) void studio.openSearch({ mode: "replace" }); break;
      case "search-property": if (project) void studio.openSearch({ mode: "property" }); break;
      case "undo": void undoRedo("undo"); break;
      case "redo": void undoRedo("redo"); break;
      case "table": if (project) afterFlush(() => studio.openTable()); break;
      case "coverage": if (project) afterFlush(() => studio.openCoverage()); break;
      // The card goes WITH the request, so the window cannot boot and read the
      // focus before the report of it arrives.
      case "links": if (project) afterFlush(() => studio.openLinks(nav.lensCard())); break;
      case "export": if (project) void exchange.exportBundle(); break;
      case "export-xlsx": if (project) void exchange.exportSpreadsheet(); break;   // Publish Spreadsheet
      case "export-html": if (project) void exchange.exportPlayable(); break;   // Publish Playable HTML
      case "export-pack": if (project) void exchange.exportPack(); break;
      case "share-scopes": if (project) void exchange.shareScopes(); break;
      case "open-pack": void exchange.openPack(); break;
      // The pack exchange. Connect is offered whatever is open; Pull and Push
      // only reach a project that came from a server, and their menu is not
      // there otherwise.
      case "connect-server": void exchange.connect({ ...(session.remote !== undefined ? { address: session.remote.address, offerForget: true } : {}) }); break;
      case "server-pull": if (project) void exchange.serverPull(); break;
      case "server-push": if (project) void exchange.serverPush(command.breaks); break;
      case "merge-pack": if (project) void exchange.mergePack(); break;
      case "project-settings": if (project) ctx.openSettings(command.section); break;
      case "identity": void ctx.saveIdentity("edit"); break;
      case "about": void showAbout({
        appName: "Storyletter",
        wordmark: STORYLETTER_WORDMARK,
        version: command.version,
        blurb: "A studio for storylets, the content that offers itself when the moment is right.",
        // Storylet Studio, not PatterKit. These two lines were scaffolded from
        // Patterpad's About and never changed, so the shipped app told anyone who
        // opened it that it belonged to the sibling project and sent them to the
        // sibling's site. The Help menu's own links were right all along, which is
        // how it went unnoticed: only this one dialog was wrong.
        credits: "Part of Storylet Studio. Made by Ian Thomas.",
        links: [
          { label: "storylets.dev", url: "https://storylets.dev" },
          { label: "ian.wildwinter.net", url: "https://ian.wildwinter.net" },
        ],
        onOpenLink: (url: string) => void studio.openExternal(url),
      }); break;
      case "show-resolved":
        void remember(session, "showResolved", command.on);
        // The toggle decides whether resolved threads are IN the walk, so the
        // loop has to be re-gathered rather than left describing the old rule.
        void comments.gatherReview();
        break;
      case "new-project": ctx.openNewProject(); break;
      // A6's four, each now reachable from a menu as well as a key. The handlers
      // are the SAME paths the keystrokes ran, so the menu is a second door rather
      // than a second implementation.
      case "new-card": {
        const f = nav.focus;
        if (f?.kind !== "deck") break;   // a card is made IN a deck; nowhere else has one to add to
        const box = nav.currentBox();
        const deck = box?.decks.find((d) => d.id === f.deck);
        if (box && deck) ctx.actions().newCard(box.id, deck.id);
        break;
      }
      case "save": if (project) void saves.flush(); break;
      case "go-up": if (project) nav.goUp(); break;
      case "close-project": if (project) void ctx.closeProject(); break;
      // Help > Open an Example: main asks before leaving an open project, then for a folder.
      case "open-example": void ctx.adopt(studio.openExample(command.file)); break;
      case "nav-back": if (project) nav.back(); break;
      case "nav-forward": if (project) nav.forward(); break;
      case "project-overview": if (project) ctx.actions().focus({ kind: "project" }); break;
      case "coverage-overlay": ctx.setCoverageOverlay(command.on); break;
      case "review-walk": comments.setReviewWalk(command.on); break;
      case "review-next": comments.stepReview(1); break;
      case "review-prev": comments.stepReview(-1); break;
      case "duplicate": if (project) void duplicateSelection(); break;
      case "edit-in-patterpad": if (project) void editInPatterpad(); break;
      case "toggle-nav": if (project) ctx.shell().togglePane("nav"); break;
      case "reset-view": if (project) { const shell = ctx.shell(); shell.resetWidths(); shell.setPaneOpen("nav", true); void studio.resetWindows(); } break;
      case "toggle-auto-rebuild": if (project) void saves.toggleAutoRebuild(); break;
      case "live-link": if (project) ctx.toggleLiveLink(); break;
      case "theme": void ctx.setTheme(command.theme); break;
    }
  }

  /**
   * Whether an Esc belonged to something on top (a menu, a popover, the
   * comments panel, a dialog): read in the capture phase, before any of them
   * closes itself on the same key, since by the time the event bubbles to the
   * map below they are on their way out.
   */
  function onKeyCapture(event: KeyboardEvent): void {
    if (event.key === "Escape") escOverlay = document.querySelector(OVERLAYS) !== null;
  }

  function onKey(event: KeyboardEvent): void {
    const project = session.project;
    const actions = ctx.actions();
    const focus = nav.focus;
    const inspected = nav.inspected;
    const viewMode = session.state.viewMode;
    const mod = event.metaKey || event.ctrlKey;
    // Cmd+1 (pane toggle) is a native menu accelerator (View menu), and Cmd+S a
    // menu accelerator too (File > Save), so neither reaches here: Electron
    // consumes them first. Handling them in both places would be two
    // implementations of one key, which is the drift this review is about.
    //
    // WHAT IS UNDER THE CURSOR, decided before any shortcut reads a key.
    //
    // This used to be computed below the up-a-level branch, and on macOS that
    // made Cmd+Left (start of line) and Cmd+Up (start of document) navigate out
    // of whatever you were typing in - a card title, a beat, any value field.
    // Both are OS-standard text keys, and the sibling app is keyboard-first by
    // charter, so an app in this family breaking one breaks the promise that a
    // hand trained on the other works here (design review 2026-08, A1).
    const editable = isEditableTarget(event.target);
    // Up a level: Cmd+Up and Cmd+Left, the platform's own back gesture, which is
    // what a hand trained on a browser or the Finder reaches for. Never while a
    // field has the cursor: the field's own meaning for those keys wins, and Esc
    // is the documented way out first. Cmd+[ is on the View menu (Up a Level)
    // and is consumed there; this is the pair the menu deliberately does NOT
    // advertise, because they are OS text keys first, which is why they are
    // gated on `editable` and why the menu names the unambiguous one instead.
    if (mod && !editable && (event.key === "ArrowUp" || event.key === "ArrowLeft")) {
      event.preventDefault();
      if (project) nav.goUp();
      return;
    }
    if (!project || mod) return;
    // Esc first leaves a field (whose own handler has already put back the
    // value it had at focus, fields.ts); otherwise it goes UP A LEVEL from any
    // page, as every back button's tip says (finding 16). Not while a menu, a
    // popover, a panel or a dialog had the Esc (`escOverlay`, taken before any
    // of them closed), and not when a canvas used it to drop a draw or a
    // selection: those mark it handled, and the move waits a task to see.
    if (event.key === "Escape") {
      if (editable) { (event.target as HTMLElement).blur(); return; }
      if (escOverlay || event.defaultPrevented) return;
      // On a canvas with cards selected, the first Esc is the canvas's: it
      // clears the selection.
      if (focus?.kind === "deck" && inspected?.kind === "deck" && viewMode === "node" && nav.selection.length > 0) return;
      setTimeout(() => { if (!event.defaultPrevented && session.project) nav.goUp(); }, 0);
      return;
    }
    if (editable) return;
    // The card editor: step through the deck (v3 3).
    if (inspected?.kind === "card" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const box = nav.currentBox();
      const deck = box?.decks.find((d) => d.id === inspected.deck);
      if (box && deck) {
        const at = deck.cards.findIndex((c) => c.id === inspected.card);
        const nextCard = deck.cards[at + (event.key === "ArrowDown" ? 1 : -1)];
        if (nextCard) { event.preventDefault(); actions.inspectCard(box.id, deck.id, nextCard.id); }
      }
      return;
    }
    // Delete the selection from the card and table views, and from a box's
    // Contents. The canvas has its own Delete, through the surface's keyboard
    // map, and both land on the same guarded path. Not while a card editor is
    // open: there Delete belongs to whatever the author is editing.
    // The Contents tab is the one box tab that draws cards to select.
    const onContents = focus?.kind === "box" && inspected?.kind === "box" && ctx.shell().centre.querySelector(".box-contents") !== null;
    if (((focus?.kind === "deck" && inspected?.kind === "deck" && viewMode !== "node") || onContents)
        && (event.key === "Delete" || event.key === "Backspace") && nav.selection.length > 0) {
      event.preventDefault();
      void ctx.deleteSelection();
      return;
    }
    // The deck browse: arrows move the cursor, Enter opens (v3 5). Not on the
    // canvas, which has its own arrows, and where redrawing the page per key
    // remounted it (the canvas review).
    if (focus?.kind === "deck" && inspected?.kind === "deck" && viewMode !== "node") {
      const box = nav.currentBox();
      const dk = box?.decks.find((d) => d.id === focus.deck);
      // The bare N is RETIRED (A6). It made a new card with no menu item and no
      // cue anywhere, and a bare letter as an accelerator appears nowhere in the
      // sibling app's vocabulary - so an author either knew it or never found
      // it. File > New Card on Shift+Cmd+N replaces it, which is Patterpad's key
      // for the same act one container down.
      if (!box || !dk || dk.cards.length === 0) return;
      const cursor = nav.cursor;
      const at = cursor ? dk.cards.findIndex((c) => c.id === cursor) : -1;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        nav.selectCards([dk.cards[Math.min(at + 1, dk.cards.length - 1)]!.id]);
        ctx.renderCentre();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        nav.selectCards([dk.cards[Math.max(at - 1, 0)]!.id]);
        ctx.renderCentre();
      } else if (event.key === "Enter" && cursor) {
        event.preventDefault();
        actions.inspectCard(box.id, dk.id, cursor);
      }
    }
  }

  return {
    onMenu,
    /** Register the window's own keys: the Esc capture first, then the map. */
    listen(): void {
      window.addEventListener("keydown", onKeyCapture, true);
      window.addEventListener("keydown", onKey);
    },
  };
}
