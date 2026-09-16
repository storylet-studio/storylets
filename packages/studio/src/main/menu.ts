// ---------------------------------------------------------------------------
// The native application menu (Patterpad's pattern, held deliberately
// consistent with it): menu items never act in main - they send a MenuCommand
// to the renderer, which runs the same handlers as the in-window buttons.
// Rebuilt whenever recents or the theme change.
// ---------------------------------------------------------------------------

import { app, Menu, shell } from "electron";
import type { BrowserWindow } from "electron";
import { basename } from "node:path";
import { PROJECT_FOLDER_EXTENSION } from "@storylet-studio/model";
import {
  APP_MENU, EDIT_MENU, FILE_MENU, GO_MENU, HELP_MENU, PANE_MENU, PLAY_MENU, PUBLISH_MENU, REVIEW_MENU, VIEW_MENU,
  namedMenuItems, recentsSubmenu,
} from "@wildwinter/app-shell/menu";
import type { MenuCommand, StudioState } from "../shared/api.js";
import { manualCheckForUpdates } from "@wildwinter/app-shell/updater";

const isMac = process.platform === "darwin";

/**
 * The Server menu's state, or nothing at all.
 *
 * Nothing at all is the ordinary case and the important one: the menu does not
 * exist until the OPEN PROJECT came from a server and this app still holds the
 * key for it. It is conditional on the project, never on the install, so an
 * editor that has never been pointed at one has no trace of the exchange
 * beyond the single File item.
 */
export interface ServerMenuState {
  /** The line under Pull and Push: "In sync", "Behind: revision 7 on the
   *  server", "3 edits unpushed". Drawn as a disabled item, which is what a
   *  menu's own status line is. */
  status: string;
}

/** `liveLink`: the Live Link server is up (listening or connected), so Play >
 *  Live Link shows ticked; it is the server's state, not a remembered one.
 *  `server`: the open project came from one and we still hold its key. */
export function refreshMenu(
  window: BrowserWindow | undefined, state: StudioState, liveLink = false, server?: ServerMenuState,
): void {
  const send = (command: MenuCommand) => () => window?.webContents.send("menu", command);
  // The family's labels AND keys, from the shell's tables rather than typed
  // here (the menu spine, app-shell 0.16.0; the File / Play / Review / Publish /
  // View tables since the 2026-09 review). Every spine item is SPREAD, so an
  // accelerator the spine adds later is not dropped by a hand-typed label.
  // Two apps hand-typing "About Storyletter" and "About Patterpad" agree until
  // one of them is edited, and the whole reason the spine exists is that
  // somebody using both should not have to notice.
  // Patterpad's pair, one suite over: its app docs + the PatterKit home. Ours
  // are the Storyletter track + the Storylet Studio home. The suite is Storylet
  // Studio, not Patter: Patter is a sibling project, and a Storyletter user
  // reaching for "Documentation Home" wants this family's front door.
  const NAMED = namedMenuItems({
    appName: "Storyletter",
    docsUrl: "https://storylet.studio/storyletter/overview/",
    suiteName: "Storylet Studio",
    suiteDocsUrl: "https://storylet.studio/",
  });
  /** An item whose destination does not exist yet: shown, and disabled. */
  const linkItem = (item: { label: string; accelerator?: string; url?: string; ready: boolean }): Electron.MenuItemConstructorOptions => {
    const { url, ready, ...named } = item;
    return {
      ...named,
      enabled: ready,
      ...(url === undefined ? {} : { click: () => void shell.openExternal(url) }),
    };
  };
  // The project's OWN name where it is known, and the folder stem only as a
  // fallback: two projects can sit in folders called `draft`, and renaming one
  // never moved its folder (app-shell 0.25.0).
  const recents = state.recents.map((r) => ({ ...r, name: r.name ?? basename(r.path, PROJECT_FOLDER_EXTENSION) }));
  const themeItem = (label: string, theme: StudioState["theme"]): Electron.MenuItemConstructorOptions => ({
    label, type: "radio", checked: state.theme === theme, click: send({ cmd: "theme", theme }),
  });

  const template: Electron.MenuItemConstructorOptions[] = [
    // On macOS an explicit app menu replaces the stock `role: "appMenu"`, so
    // About opens OUR themed surface rather than the grey OS panel, and User
    // Information sits where Patterpad's does. The rest mirrors the standard.
    ...(isMac ? [{
      label: "Storyletter",
      submenu: [
        { ...NAMED.about, click: send({ cmd: "about", version: app.getVersion() }) },
        { type: "separator" as const },
        { ...APP_MENU.userInfo, click: send({ cmd: "identity" }) },
        { type: "separator" as const },
        { role: "services" as const },
        { type: "separator" as const },
        { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const },
        { type: "separator" as const },
        { role: "quit" as const },
      ],
    } as Electron.MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        // New before Open, as Patterpad has it and as every File menu does.
        // There was no New item at all and no Cmd+N: the only route to a new
        // project was a bare input on the welcome screen, so with one already
        // open you could not start another (design review 2026-08, A5).
        { ...FILE_MENU.newProject, click: send({ cmd: "new-project" }) },
        { ...FILE_MENU.openProject, click: send({ cmd: "open" }) },
        { type: "separator" },
        // A6: half the keyboard was folklore. New Card was a BARE N with no menu
        // item and no cue - a bare letter as an accelerator appears nowhere in
        // Patterpad's vocabulary - and Save was handled in the keydown while
        // being absent from File. A menu item is where a family user looks, and
        // it makes the accelerator discoverable for nothing.
        //
        // Shift+Cmd+N is Patterpad's key for New Scene, which is the same act one
        // container down.
        { label: "New Card", accelerator: "Shift+CmdOrCtrl+N", click: send({ cmd: "new-card" }) },
        { type: "separator" },
        { ...FILE_MENU.save, click: send({ cmd: "save" }) },
        {
          ...FILE_MENU.openRecent,
          // The shell's submenu: the name with the PATH beside it, because the
          // name alone cannot separate two copies of one project, which is the
          // case this menu is most often reached in (macOS draws `sublabel` and
          // `toolTip`; elsewhere the path folds into the label). Empty, it is
          // the one disabled "No Recent Projects"; otherwise Clear Recents sits
          // under a separator, forgetting every entry (parity row 24).
          submenu: recentsSubmenu(recents, {
            onOpen: (path) => send({ cmd: "open-recent", path })(),
            onClear: send({ cmd: "clear-recents" }),
            home: app.getPath("home"),
          }),
        },
        { ...FILE_MENU.projectSettings, click: send({ cmd: "project-settings" }) },
        // Who comments are signed as. Beside Project Settings and NOT in it: the
        // name belongs to the person at the keyboard, not to the project, which
        // is the same reason it lives in the app's state.
        //
        // "User Information" is Patterpad's label, in Patterpad's place: the app
        // menu on macOS, the foot of File everywhere else. An earlier cut called
        // it "Your Name" - a nicer phrase and the wrong one, because a menu item
        // is part of the family's vocabulary.
        ...(isMac ? [] : [{ ...APP_MENU.userInfo, click: send({ cmd: "identity" }) }]),
        { type: "separator" },
        // The send envelope (Reboot 7.1): handing the project to someone with
        // no shared version control, and taking their edits back afterwards.
        // The way back to the welcome screen, and so to the shipped examples
        // (the author's report: once in a project there was none). JetBrains'
        // File > Close Project, with the shell owning the teardown order.
        { ...FILE_MENU.closeProject, click: send({ cmd: "close-project" }) },
        { type: "separator" },
        { label: "Open Storyletpack\u2026", click: send({ cmd: "open-pack" }) },
        { label: "Export as Storyletpack\u2026", click: send({ cmd: "export-pack" }) },
        { label: "Merge Returned Storyletpack\u2026", click: send({ cmd: "merge-pack" }) },
        // The pack exchange's one door, beside the other pack items because it
        // is the same act over a wire: it asks for an address and a code, and
        // it is for somebody who already has both. Everything else the exchange
        // grows - the Server menu, the status, the role - waits for a project
        // that came from one.
        //
        // Not in the shell's `namedMenuItems` yet, and it should be: Patterpad
        // has no remote of its own, so there is nothing to mirror today, but a
        // pack is shared between the two apps and so is this label. It goes to
        // from-storylets as a proposal, and the spine takes it if Patterpad
        // ever grows the other half.
        { label: "Connect to a Server\u2026", click: send({ cmd: "connect-server" }) },
        { type: "separator" },
        // A12: on macOS there is NO File > Close Window, which is Patterpad's
        // written decision and was reversed here without a note. Quit in the app
        // menu and the window's own close button already cover it, and a Close
        // that leaves the app running with no window is a state neither app
        // wants. Elsewhere, Quit belongs at the foot of File as it always does,
        // under the word Windows and Linux menus use for it (parity row 24).
        ...(isMac ? [] : [{ role: "quit" as const, label: "Exit" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Model undo/redo (file-state based), not the text-field native undo:
        // the spine's items, spelled out rather than Electron's roles for
        // exactly that reason (EDIT_MENU's note).
        { ...EDIT_MENU.undo, click: send({ cmd: "undo" }) },
        { ...EDIT_MENU.redo, click: send({ cmd: "redo" }) },
        { type: "separator" },
        { ...EDIT_MENU.duplicate, click: send({ cmd: "duplicate" }) },
        { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
        { type: "separator" },
        // Find lives in Edit (Patterpad's placement, the platform convention).
        { ...EDIT_MENU.find, click: send({ cmd: "search" }) },
        // Replace is Find's second tab, on the platform's key for it.
        {
          label: EDIT_MENU.replace.label,
          accelerator: isMac ? EDIT_MENU.replace.acceleratorMac : EDIT_MENU.replace.acceleratorOther,
          click: send({ cmd: "replace" }),
        },
      ],
    },
    {
      label: "Play",
      submenu: [
        { label: "The Board", accelerator: "CmdOrCtrl+T", click: send({ cmd: "table" }) },
        { type: "separator" },
        // Live Link (design/live-link.md): Patterpad's item, label and place.
        // Ticked while the server is up (listening or connected); the
        // bottom-right connect chip mirrors the same state. No accelerator,
        // as Patterpad has none.
        { ...PLAY_MENU.liveLink, type: "checkbox", checked: liveLink, click: send({ cmd: "live-link" }) },
      ],
    },
    // Patterpad's REVIEW menu, adopted: it is where that app keeps Coverage
    // Test and Find Property Usage, which is exactly this class of feature -
    // examining what you have built rather than building or playing it. Sits
    // between Play and Publish, as it does there.
    {
      label: "Review",
      submenu: [
        // PATTERPAD'S ORDER, which the comment below used to claim while this
        // menu led with Coverage and put the walk third (design review 2026-08,
        // A11). A comment asserting a parity it does not have is worse than no
        // comment, because the next reader trusts it instead of checking.
        //
        // The walk is a MODE you enter, which is what earns it the right to
        // navigate on each step where the ambient problems bar does not.
        {
          ...REVIEW_MENU.reviewFeedback, type: "checkbox", checked: state.reviewWalk ?? false,
          click: send({ cmd: "review-walk", on: !(state.reviewWalk ?? false) }),
        },
        { ...REVIEW_MENU.nextFeedback, click: send({ cmd: "review-next" }) },
        { ...REVIEW_MENU.previousFeedback, click: send({ cmd: "review-prev" }) },
        { type: "separator" },
        // "Coverage Test…", the family's name for it and its key (parity row 24).
        { ...REVIEW_MENU.coverageTest, click: send({ cmd: "coverage" }) },
        // No accelerator, matching Patterpad's Find Property Usage: an
        // occasional lens, and Shift+Cmd+L is spoken for over there (Find
        // Lines by Writing Status), so the family keeps that key free.
        { label: "Links\u2026", click: send({ cmd: "links" }) },
        // Patterpad's item, in Patterpad's menu: Find's Property tab, for "where
        // is @x read or written?". No accelerator there either.
        { ...REVIEW_MENU.findPropertyUsage, click: send({ cmd: "search-property" }) },
        { type: "separator" },
        // Patterpad's item, and its default: a resolved thread is done, and a
        // reviewer asks to see the archive rather than being shown it.
        {
          ...REVIEW_MENU.showResolvedComments, type: "checkbox", checked: state.showResolved,
          click: send({ cmd: "show-resolved", on: !state.showResolved }),
        },
      ],
    },
    {
      label: "Publish",
      submenu: [
        // The playable export (parity audit 9.3): Patterpad's first Publish item,
        // the page for players ahead of the workbook for readers.
        { ...PUBLISH_MENU.playableHtml, click: send({ cmd: "export-html" }) },
        // The readable export (parity audit 9.5): Patterpad's "Publish Readable
        // Script…" slot, the person-facing output ABOVE the game-facing bundle,
        // and the menu's verb ("Publish", never "Export", for anything handed to
        // others). "Spreadsheet" needs no "Readable" the way a script does.
        { label: "Publish Spreadsheet…", click: send({ cmd: "export-xlsx" }) },
        { type: "separator" },
        { ...PUBLISH_MENU.bundle, click: send({ cmd: "export" }) },
        { type: "separator" },
        { ...PUBLISH_MENU.autoRebuild, type: "checkbox", checked: state.autoRebuild, click: send({ cmd: "toggle-auto-rebuild" }) },
      ],
    },
    // Beside Publish, and only while there is one: Publish is the other menu
    // that sends the project somewhere, and this is that act over a wire.
    ...(server === undefined ? [] : [{
      label: "Server",
      submenu: [
        { label: "Pull", click: send({ cmd: "server-pull" }) },
        // The ellipsis is the promise it makes: a note, and the ticks a refusal
        // that can be acknowledged comes back with, before anything is sent.
        { label: "Push…", click: send({ cmd: "server-push" }) },
        { type: "separator" as const },
        { label: server.status, enabled: false },
      ],
    } as Electron.MenuItemConstructorOptions]),
    {
      label: "View",
      submenu: [
        // The inspector pane is retired (ux-changes v3); its menu slot and Cmd+2
        // are reserved for a future genuinely-optional reference pane.
        { label: PANE_MENU.showNav.label, type: "checkbox", checked: state.panes.nav, accelerator: PANE_MENU.showNav.accelerator, click: send({ cmd: "toggle-nav" }) },
        // The overview's second door, and the one a family user looks for first
        // (A13). Patterpad has View > Project Overview.
        // The up-level trio had no menu home either. Cmd+[ is the one advertised
        // because it is unambiguous: Cmd+Up and Cmd+Left do the same thing but
        // are OS text keys first, which is exactly what A1 had to fix.
        // History's axis, beside hierarchy's: Back retraces jumps, Up a Level
        // climbs. The labels and platform-split keys are the shell's (GO_MENU),
        // so the family cannot disagree on them. Always enabled: the arrows in
        // the trail carry the greyed state, and a step with nowhere to go is a
        // quiet no-op.
        { label: GO_MENU.back.label, accelerator: process.platform === "darwin" ? GO_MENU.back.acceleratorMac : GO_MENU.back.acceleratorOther, click: send({ cmd: "nav-back" }) },
        { label: GO_MENU.forward.label, accelerator: process.platform === "darwin" ? GO_MENU.forward.acceleratorMac : GO_MENU.forward.acceleratorOther, click: send({ cmd: "nav-forward" }) },
        { ...VIEW_MENU.upALevel, click: send({ cmd: "go-up" }) },
        { ...VIEW_MENU.projectOverview, click: send({ cmd: "project-overview" }) },
        { ...PANE_MENU.resetView, click: send({ cmd: "reset-view" }) },
        { type: "separator" },
        // No accelerator, deliberately. Patterpad has no analogue to copy a key
        // from, and inventing one here would spend a shortcut the two apps then
        // disagree about. It is a mode you set and forget, not a key you tap.
        {
          label: "Coverage Overlay", type: "checkbox", checked: state.coverageOverlay,
          click: send({ cmd: "coverage-overlay", on: !state.coverageOverlay }),
        },
        { type: "separator" },
        {
          ...VIEW_MENU.colourTheme,
          submenu: [
            themeItem("Chambray", "chambray"), themeItem("Indigo", "indigo"),
            themeItem("Linen", "linen"), themeItem("Baize", "baize"),
            themeItem("Follow System", "system"),
          ],
        },
        { type: "separator" },
        // The platform's own zoom and full-screen items, which Patterpad's View
        // menu carries and this one had left out (parity row 24).
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [
          { type: "separator" as const },
          { role: "reload" as const },
          { role: "toggleDevTools" as const },
        ]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        linkItem(NAMED.docs),
        linkItem(NAMED.suiteDocs),
        { type: "separator" },
        // CHECK FOR UPDATES is here, DISABLED, and this reverses a decision this
        // file used to state the other way round.
        //
        // It read: absent until there is a feed to check, because "a menu item
        // that cannot do its job is worse than an obvious gap". The Patter side
        // answered that directly (to-storylets/shell-menu-spine.md) and built the
        // placeholder rule for it: an app whose content does not exist yet still
        // gets the ITEM, disabled. The menu then has its family shape from day
        // one, and wiring the feed later is one line rather than a redesign.
        //
        // That is the better answer and Patterpad is canonical on family shape.
        // The gap it was protecting against does not arise: a greyed item with
        // its normal label says "this app does that, not yet here", where an
        // absence says "this app does not do that" - which would be the lie.
        // ENABLED 2026-08-30: the feed exists. Storyletter 0.1.0 published
        // latest-mac.yml / latest.yml / latest-linux.yml to its GitHub Release,
        // which is what electron-updater walks, so the item can now do its job.
        { ...HELP_MENU.checkForUpdates, click: () => void manualCheckForUpdates(window) },
        // macOS keeps About in the app menu; everywhere else this is its home.
        ...(isMac ? [] : [
          { type: "separator" as const },
          { ...NAMED.about, click: send({ cmd: "about", version: app.getVersion() }) },
        ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
