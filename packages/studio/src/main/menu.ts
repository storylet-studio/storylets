// ---------------------------------------------------------------------------
// The native application menu (Patterpad's pattern, held deliberately
// consistent with it): menu items never act in main - they send a MenuCommand
// to the renderer, which runs the same handlers as the in-window buttons.
// Rebuilt whenever recents or the theme change.
// ---------------------------------------------------------------------------

import { app, Menu, shell } from "electron";
import type { BrowserWindow } from "electron";
import { basename, resolve, sep } from "node:path";
import { PROJECT_FOLDER_EXTENSION } from "@storylet-studio/model";
import { APP_MENU, EDIT_MENU, GO_MENU, HELP_MENU, PANE_MENU, namedMenuItems } from "@wildwinter/app-shell/menu";
import type { MenuCommand, StudioState } from "../shared/api.js";

const isMac = process.platform === "darwin";

/** A path with the home directory as `~`, so a recents entry stays readable at
 *  menu width. Patterpad's `tildePath`, same shape. */
function tildePath(p: string): string {
  const home = app.getPath("home");
  const abs = resolve(p);
  return abs === home || abs.startsWith(home + sep) ? `~${abs.slice(home.length)}` : abs;
}

/** `liveLink`: the Live Link server is up (listening or connected), so Play >
 *  Live Link shows ticked; it is the server's state, not a remembered one. */
export function refreshMenu(window: BrowserWindow | undefined, state: StudioState, liveLink = false): void {
  const send = (command: MenuCommand) => () => window?.webContents.send("menu", command);
  // The family's labels, from the shell's table rather than typed here (the menu
  // spine, app-shell 0.16.0). They read the same as the strings they replace -
  // that is the point. Two apps hand-typing "About Storyletter" and "About
  // Patterpad" agree until one of them is edited, and the whole reason the spine
  // exists is that somebody using both should not have to notice.
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
  const linkItem = (item: { label: string; url?: string; ready: boolean }): Electron.MenuItemConstructorOptions => {
    const url = item.url;
    return {
      label: item.label,
      enabled: item.ready,
      ...(url === undefined ? {} : { click: () => void shell.openExternal(url) }),
    };
  };
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
        { label: NAMED.about.label, click: send({ cmd: "about", version: app.getVersion() }) },
        { type: "separator" as const },
        { label: APP_MENU.userInfo.label, click: send({ cmd: "identity" }) },
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
        { label: "New Project…", accelerator: "CmdOrCtrl+N", click: send({ cmd: "new-project" }) },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: send({ cmd: "open" }) },
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
        { label: "Save", accelerator: "CmdOrCtrl+S", click: send({ cmd: "save" }) },
        {
          label: "Open Recent",
          submenu: state.recents.length === 0
            ? [{ label: "No recent projects", enabled: false }]
            // The project's OWN name where it is known, and the folder stem only
            // as a fallback: two projects can sit in folders called `draft`, and
            // renaming one never moved its folder (app-shell 0.25.0).
            //
            // ...and the PATH beside it, because the name alone cannot separate
            // two copies of one project, which is the case this menu is most
            // often reached in. Patterpad's exact treatment, including where the
            // native menus differ: macOS draws `sublabel` as a dimmed second line
            // and `toolTip` on hover, and other platforms draw neither, so there
            // the path is folded into the label itself.
            : state.recents.map((recent) => {
                const shown = tildePath(recent.path);
                const name = recent.name ?? basename(recent.path, PROJECT_FOLDER_EXTENSION);
                return {
                  label: isMac ? name : `${name}  \u00b7  ${shown}`,
                  sublabel: shown,
                  toolTip: recent.path,
                  click: send({ cmd: "open-recent", path: recent.path }),
                };
              }),
        },
        { label: "Project Settings\u2026", accelerator: "CmdOrCtrl+,", click: send({ cmd: "project-settings" }) },
        // Who comments are signed as. Beside Project Settings and NOT in it: the
        // name belongs to the person at the keyboard, not to the project, which
        // is the same reason it lives in the app's state.
        //
        // "User Information" is Patterpad's label, in Patterpad's place: the app
        // menu on macOS, the foot of File everywhere else. An earlier cut called
        // it "Your Name" - a nicer phrase and the wrong one, because a menu item
        // is part of the family's vocabulary.
        ...(isMac ? [] : [{ label: APP_MENU.userInfo.label, click: send({ cmd: "identity" }) }]),
        { type: "separator" },
        // The send envelope (Reboot 7.1): handing the project to someone with
        // no shared version control, and taking their edits back afterwards.
        // The way back to the welcome screen, and so to the shipped examples
        // (the author's report: once in a project there was none). JetBrains'
        // File > Close Project, with the shell owning the teardown order.
        { label: "Close Project", click: send({ cmd: "close-project" }) },
        { type: "separator" },
        { label: "Open Storyletpack\u2026", click: send({ cmd: "open-pack" }) },
        { label: "Export as Storyletpack\u2026", click: send({ cmd: "export-pack" }) },
        { label: "Merge Returned Storyletpack\u2026", click: send({ cmd: "merge-pack" }) },
        { type: "separator" },
        // A12: on macOS there is NO File > Close Window, which is Patterpad's
        // written decision and was reversed here without a note. Quit in the app
        // menu and the window's own close button already cover it, and a Close
        // that leaves the app running with no window is a state neither app
        // wants. Elsewhere, Quit belongs at the foot of File as it always does.
        ...(isMac ? [] : [{ role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Model undo/redo (file-state based), not the text-field native undo.
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: send({ cmd: "undo" }) },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: send({ cmd: "redo" }) },
        { type: "separator" },
        { label: "Duplicate", accelerator: "CmdOrCtrl+D", click: send({ cmd: "duplicate" }) },
        { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
        { type: "separator" },
        // Find lives in Edit (Patterpad's placement, the platform convention).
        { label: "Find…", accelerator: "CmdOrCtrl+F", click: send({ cmd: "search" }) },
        // Replace is Find's second tab, on the platform's key for it (Patterpad's
        // pair: Cmd+Alt+F on macOS, Ctrl+H elsewhere).
        { label: "Replace…", accelerator: isMac ? "Cmd+Alt+F" : "Ctrl+H", click: send({ cmd: "replace" }) },
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
        { label: "Live Link", type: "checkbox", checked: liveLink, click: send({ cmd: "live-link" }) },
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
          label: "Review Feedback", type: "checkbox", checked: state.reviewWalk ?? false,
          accelerator: "Shift+CmdOrCtrl+R", click: send({ cmd: "review-walk", on: !(state.reviewWalk ?? false) }),
        },
        { label: "Next Feedback", accelerator: "F8", click: send({ cmd: "review-next" }) },
        { label: "Previous Feedback", accelerator: "Shift+F8", click: send({ cmd: "review-prev" }) },
        { type: "separator" },
        { label: "Coverage\u2026", accelerator: "Shift+CmdOrCtrl+C", click: send({ cmd: "coverage" }) },
        // No accelerator, matching Patterpad's Find Property Usage: an
        // occasional lens, and Shift+Cmd+L is spoken for over there (Find
        // Lines by Writing Status), so the family keeps that key free.
        { label: "Links\u2026", click: send({ cmd: "links" }) },
        // Patterpad's item, in Patterpad's menu: Find's Property tab, for "where
        // is @x read or written?". No accelerator there either.
        { label: "Find Property Usage\u2026", click: send({ cmd: "search-property" }) },
        { type: "separator" },
        // Patterpad's item, and its default: a resolved thread is done, and a
        // reviewer asks to see the archive rather than being shown it.
        {
          label: "Show Resolved Comments", type: "checkbox", checked: state.showResolved,
          click: send({ cmd: "show-resolved", on: !state.showResolved }),
        },
      ],
    },
    {
      label: "Publish",
      submenu: [
        // The playable export (parity audit 9.3): Patterpad's first Publish item,
        // the page for players ahead of the workbook for readers.
        { label: "Publish Playable HTML…", click: send({ cmd: "export-html" }) },
        // The readable export (parity audit 9.5): Patterpad's "Publish Readable
        // Script…" slot, the person-facing output ABOVE the game-facing bundle,
        // and the menu's verb ("Publish", never "Export", for anything handed to
        // others). "Spreadsheet" needs no "Readable" the way a script does.
        { label: "Publish Spreadsheet…", click: send({ cmd: "export-xlsx" }) },
        { type: "separator" },
        { label: "Publish Bundle", accelerator: "Shift+CmdOrCtrl+B", click: send({ cmd: "export" }) },
        { type: "separator" },
        { label: "Auto Rebuild", type: "checkbox", checked: state.autoRebuild, click: send({ cmd: "toggle-auto-rebuild" }) },
      ],
    },
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
        { label: "Up a Level", accelerator: "CmdOrCtrl+[", click: send({ cmd: "go-up" }) },
        { label: "Project Overview", click: send({ cmd: "project-overview" }) },
        { label: PANE_MENU.resetView.label, click: send({ cmd: "reset-view" }) },
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
          label: "Colour Theme",
          submenu: [
            themeItem("Chambray", "chambray"), themeItem("Indigo", "indigo"),
            themeItem("Linen", "linen"), themeItem("Baize", "baize"),
            themeItem("Follow System", "system"),
          ],
        },
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
        // Enabled once the release feed exists (release-shape.md, still one of
        // the three open packaging decisions).
        { label: HELP_MENU.checkForUpdates.label, enabled: false },
        // macOS keeps About in the app menu; everywhere else this is its home.
        ...(isMac ? [] : [
          { type: "separator" as const },
          { label: NAMED.about.label, click: send({ cmd: "about", version: app.getVersion() }) },
        ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
