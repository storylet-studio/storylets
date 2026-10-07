// ---------------------------------------------------------------------------
// The app's lifecycle: one running copy, files handed over by the OS, and the
// ways out (closing the editor, quitting, installing an update), each of which
// asks first when the server has not seen the whole project (9.1).
// ---------------------------------------------------------------------------

import { BrowserWindow, app, autoUpdater } from "electron";
import { launchLocationFromArgv, launchPathFromArgv, sameProject } from "./launch.js";
import type { LaunchHost } from "./launch-host.js";
import type { ProjectSession } from "./project.js";
import { push } from "./ipc/push.js";

export interface Lifecycle {
  /** Stop a close of the Board that the Board did not start (ruling Q). */
  guardBoardClose(win: BrowserWindow): void;
  /** The Board has asked its own question: let its next close through. */
  allowBoardClose(): void;
  /** The editor's `close`: wait for an answer when the server has not seen it all. */
  editorClose(event: Electron.Event, window: BrowserWindow): void;
}

export interface LifecycleDeps {
  session(): ProjectSession | undefined;
  launch: Pick<LaunchHost, "hold" | "openInWindow" | "navigateInWindow" | "surfaceWindow">;
  mayLeaveProject(act: "quit" | "close"): Promise<boolean>;
  /** The last chance to tidy, on the way out. */
  sweep(ending: ProjectSession | undefined): void;
}

/**
 * Wire the lifecycle. Called once, at load, BEFORE `whenReady`: on macOS an
 * open-file can arrive before the app is ready, and the single-instance lock
 * has to be taken before anything else happens.
 */
export function startLifecycle(deps: LifecycleDeps): Lifecycle {
  /** The author has answered the leaving question (or there was none to ask), so
   *  the next close and the next quit go straight through (9.1). */
  let leaving = false;

  /** An update is installing: electron's autoUpdater closes every window BEFORE
   *  before-quit, so `leaving` is not yet set; nothing may stand in its way. */
  let installingUpdate = false;
  // electron-updater installs through electron's own updater only on macOS; on
  // Windows and Linux it quits the app first, which sets `leaving`.
  if (process.platform === "darwin") autoUpdater.on("before-quit-for-update", () => { installingUpdate = true; });

  /** The Board closing only through its own question (ruling Q, review 2026-10):
   *  a close it did not start (Ctrl+W, Alt+F4, the window menu) is stopped and
   *  handed to the Board, which asks when the session is at stake and then calls
   *  `board:close`, which lets the next close through. Quitting and installing
   *  an update are never stopped. */
  let boardMayClose = false;
  function guardBoardClose(win: BrowserWindow): void {
    boardMayClose = false;
    win.on("close", (event) => {
      if (boardMayClose || leaving || installingUpdate) return;
      event.preventDefault();
      push(win.webContents, "board:askClose");
    });
  }

  // One running copy. A second `storyletter …` hands its command line to the
  // window that is already open (second-instance) and quits, rather than
  // starting a rival. This process's argv rides along in additionalData: on
  // Windows the argv Chromium delivers to the event can drop or reorder user
  // switches, so `--at` could vanish from it (Patterpad's finding).
  // Windows ties a running window to its Start Menu shortcut (taskbar grouping,
  // pinning, notifications) by AppUserModelID; electron-builder stamps the
  // shortcut with package.json's build.appId, so the running app must claim the
  // same string. No-op elsewhere. Patterpad sets it beside its lock, as here.
  app.setAppUserModelId("studio.storylet.storyletter");

  if (!app.requestSingleInstanceLock({ argv: process.argv })) {
    app.quit();
  } else {
    // A path on OUR command line: Windows / Linux file associations, and
    // `storyletter <path>` on any platform. (macOS double-clicks arrive as
    // open-file instead, below; both feed the same pending path.)
    deps.launch.hold(launchPathFromArgv(process.argv, app.isPackaged), launchLocationFromArgv(process.argv, app.isPackaged));

    app.on("second-instance", (_event, argv, _wd, additionalData) => {
      const forwarded = (additionalData as { argv?: string[] } | undefined)?.argv;
      const eff = forwarded?.length ? forwarded : argv;
      const path = launchPathFromArgv(eff, app.isPackaged);
      const at = launchLocationFromArgv(eff, app.isPackaged);
      if (path !== undefined && sameProject(path, deps.session()?.loaded.dir)) {
        // Already the open project: jump in place, never reload. A reload drops
        // the editor back to its landing page, and the jump would race it.
        if (at !== undefined) deps.launch.navigateInWindow(at);
        deps.launch.surfaceWindow();
      } else if (path !== undefined) {
        deps.launch.openInWindow(path, at);
      } else {
        // Bare `storyletter --at x` (or a bare relaunch): the project already open.
        if (at !== undefined) deps.launch.navigateInWindow(at);
        deps.launch.surfaceWindow();
      }
    });
  }

  // Registered before `whenReady`: on macOS an open-file can arrive before the
  // app is ready, and preventDefault stops the OS default handling.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    deps.launch.openInWindow(path);
  });

  // Quit-clean on every platform: no window-less macOS process left hanging
  // (the Patterpad stance, kept for family consistency).
  app.on("window-all-closed", () => app.quit());

  // The last chance to tidy: after this there is no undo chain to protect.
  //
  // And the last chance to ask, too. A push at quit stages a revision and
  // advances nothing, so pushing half-done work is harmless; a push that is
  // REFUSED leaves the app open on the problems bar, because a refusal reached
  // at the moment of quitting is the one an author most needs to still be there
  // to act on.
  app.on("before-quit", (event) => {
    if (leaving) { deps.sweep(deps.session()); return; }
    event.preventDefault();
    void deps.mayLeaveProject("quit").then((go) => {
      if (!go) return;
      leaving = true;
      app.quit();
    });
  });

  return {
    guardBoardClose,
    allowBoardClose: () => { boardMayClose = true; },
    // Closing the editor is one of the three ways out (9.1): with edits the
    // server has not seen, the close waits for an answer. `leaving` is what an
    // answered prompt sets so the second close goes straight through, and it is
    // also what Quit sets, so Cmd+Q asks once rather than twice.
    editorClose: (event, window) => {
      if (leaving) return;
      event.preventDefault();
      void deps.mayLeaveProject("quit").then((go) => {
        if (!go) return;
        leaving = true;
        if (!window.isDestroyed()) window.close();
      });
    },
  };
}

/**
 * The dock icon, on macOS. Every platform quits when its last window closes
 * (`window-all-closed` above), so in the ordinary run of things this never
 * finds zero windows: it matters only if the process outlives them (a quit
 * held up or turned down after the last window went). macOS is the one
 * platform where a windowless app stays alive and a dock click fires
 * `activate`, and without this that click would do nothing at all. Kept as a
 * net for that case, as Patterpad keeps the same line; `activate` is macOS's
 * alone, so it costs nothing elsewhere.
 */
export function reopenOnActivate(createWindow: () => void): void {
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
