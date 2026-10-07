// ---------------------------------------------------------------------------
// Main process: the composition root. It makes the editor window and holds the
// open project, builds each domain with what that domain needs, and registers
// their handlers. The domains themselves are elsewhere: the write path and the
// edits in mutate/, what the pages read in read/, the bridge's handlers in
// ipc/, the pack exchange in exchange.ts, the windows and the app's lifecycle
// in windows.ts and lifecycle.ts. All fs, ops and VC work happens in main; the
// renderer sees only the typed contract in shared/api.ts. Hardened
// webPreferences (contextIsolation + sandbox), one preload bridge, quit when
// all windows close (no window-less process).
// ---------------------------------------------------------------------------

import { BrowserWindow, app, safeStorage } from "electron";
import type { ToolWindows } from "@wildwinter/app-shell/tool-window";
import { createProjectSession } from "@wildwinter/app-shell/session";
import { configureUpdater, startBackgroundUpdateCheck } from "@wildwinter/app-shell/updater";
import { clearParseCache } from "@storylet-studio/compiler";
import { clearCanonicalCache } from "@storylet-studio/ops";
import { StudioStore } from "./store.js";
import type { SecretCodec } from "./store.js";
import { refreshMenu } from "./menu.js";
import { forgetShardHashes, menuState } from "./remote.js";
import { openProject, openResult } from "./project.js";
import type { ProjectSession } from "./project.js";
import { setProjectWrittenListener } from "./mutate/write-path.js";
import type { MainContext, ToolName } from "./context.js";
import { createJobs } from "./jobs.js";
import { registerAssetScheme, serveAssets, sweepOrphanAssets } from "./assets.js";
import { createLiveLinkHost } from "./live-link-host.js";
import { createExchange } from "./exchange.js";
import { createLaunch } from "./launch-host.js";
import { reopenOnActivate, startLifecycle } from "./lifecycle.js";
import { createEditorFlush, createEditorWindow, defineWindows } from "./windows.js";
import { createCoverage } from "./ipc/coverage.js";
import { createWindowsIpc } from "./ipc/windows.js";
import { registerAll } from "./ipc/index.js";
import { electronIpc } from "./ipc/registrar.js";
import type { OpenResult } from "../shared/api.js";

registerAssetScheme();

// Opt-in remote debugging, for verifying a build without a person at the
// keyboard: with it on, the renderer can be inspected and driven over the
// devtools protocol on localhost. Off unless asked for, because it is a port
// into the app and no ordinary dev run needs one.
if (process.env["STORYLETTER_DEBUG_PORT"] !== undefined) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env["STORYLETTER_DEBUG_PORT"]);
}

/**
 * Where a paired key is held at rest: the OS's own store where there is one.
 *
 * `safeStorage` is the keychain on macOS, DPAPI on Windows, and the desktop's
 * secret service on Linux; where none of them answers it says so, and the key
 * sits in the settings file as it would have anyway. Nothing here fails
 * because of it: a key that cannot be unsealed reads as no key, and the author
 * is offered the dialog rather than a call that would be refused.
 */
function osSecret(): SecretCodec {
  return {
    seal: (plain) => (safeStorage.isEncryptionAvailable()
      ? `sealed:${safeStorage.encryptString(plain).toString("base64")}`
      : plain),
    unseal: (sealed) => {
      if (!sealed.startsWith("sealed:")) return sealed;
      try {
        return safeStorage.decryptString(Buffer.from(sealed.slice("sealed:".length), "base64"));
      } catch {
        return undefined;
      }
    },
  };
}

// --- what the root holds ---------------------------------------------------------

/** The editor window, while it exists. */
let window: BrowserWindow | undefined;
/** The app's settings, built at whenReady. */
let store: StudioStore;
/** The four tool windows, as rows of the shell's table (windows.ts). Built at
 *  whenReady, once the store exists to read their remembered bounds from; read
 *  through `windows.get(name)` rather than held by name. */
let windows: ToolWindows<ToolName>;
/** A mirror of `projects.current()`, refreshed at the one moment it can change. */
let session: ProjectSession | undefined;
/** The editor has a deck in focus, so New Card has somewhere to put a card.
 *  The renderer says so (`setDeckFocused`); main cannot see the editor's page. */
let deckFocused = false;
/** Whether the menu last drew Show Scene in Patterpad (see `noteProjectWritten`). */
let shownPatter = false;

const jobs = createJobs();
const flush = createEditorFlush(() => window);

/** What every domain reads through. */
const ctx: MainContext = {
  session: () => session,
  editor: () => window,
  store: () => store,
  windows: () => windows,
  menu: () => menu(),
  openAt: (path) => openAt(path),
  flushEditor: () => flush.flush(),
  runJob: jobs.run,
};

const live = createLiveLinkHost(ctx);
const exchange = createExchange({ ...ctx, schedulePush: () => live.schedulePush(), noteProjectWritten: () => noteProjectWritten() });
const coverage = createCoverage(ctx, jobs.host);
const launch = createLaunch(ctx, exchange);
const lifecycle = startLifecycle({
  session: () => session,
  launch,
  mayLeaveProject: (act) => exchange.mayLeaveProject(act),
  sweep: sweepOrphanAssets,
});
const tools = createWindowsIpc({
  ...ctx, coverage, allowBoardClose: () => lifecycle.allowBoardClose(), editorFlushed: () => flush.flushed(),
});

// --- the menu, and the window's title -------------------------------------------

/** Is the open project paired with a Patter project (its `patter`)? Show Scene in Patterpad
 *  shows only then, and the menu is rebuilt when a write changes the answer. */
const patterPaired = (): boolean => session?.loaded.source?.project.patter !== undefined;

const menu = (): void => {
  const server = exchange.standing();
  refreshMenu(window, store.get(), live.isOn(), menuState(
    server.remote, server.keyed, server.standing?.edits ?? 0, server.head,
  ), shownPatter = patterPaired(), { open: session !== undefined, deckFocused: session !== undefined && deckFocused });
  exchange.retitle(server.remote, server.standing);
};

/** After every write that lands - a commit, an undo, a redo - the count may
 *  have moved. Compared rather than rebuilt blindly, because a write happens on
 *  every autosave and a menu rebuild does not belong on that path. */
function noteProjectWritten(): void {
  if (!exchange.countMoved() && patterPaired() === shownPatter) return;
  menu();
}

// --- the open project ------------------------------------------------------------

/**
 * Opening a project: the shell's sequence. The four tool windows register
 * themselves as satellites when their table is built (defineToolWindows), so
 * none of them can be forgotten.
 *
 * The shell (0.14.0) owns the order - open, forget on failure, close the
 * outgoing one, record the root, invalidate the satellites, rebuild the menu -
 * because both apps had written it and each had left a window out. Ours was the
 * Find window, which went on listing the previous project's cards until it next
 * took focus.
 */
const projects = createProjectSession<ProjectSession, OpenResult>({
  // Read through, not captured: `store` is built at whenReady, after this.
  store: {
    get: () => store.get(),
    touchProject: (path, name) => store.touchProject(path, name),
    forgetProject: (path) => store.forgetProject(path),
    clearLastProject: () => store.clearLastProject(),
  },
  open: (path) => {
    const result = openProject(path);
    if ("error" in result) return result;
    return {
      session: result.session,
      root: result.session.loaded.dir,
      // What the project calls itself, so Open Recent and the welcome screen can
      // name it rather than deriving a label from the folder (app-shell 0.25.0).
      // Returned rather than written to the store here: the session is the thing
      // that just opened it, so it records the name with the path in one go
      // (0.27.0, which closed the two-call dance this used to need).
      ...(result.session.loaded.source !== undefined
        ? { name: result.session.loaded.source.project.project.name }
        : {}),
      reply: openResult(result.session, result.problems),
    };
  },
  // The outgoing project's undo chain dies here, so its orphans can go with it.
  // The hook also drops main's own cross-IPC caches that describe the outgoing
  // project (the Patter side's close-hook lesson: the shell cannot know what a
  // host caches, and a stale pending merge would pass mergeCommit's session
  // guard against the WRONG project after a switch).
  close: (ending) => { sweepOrphanAssets(ending); exchange.dropPendingMerge(); tools.dropSearchSeed(); },
  refreshMenu: () => menu(),
});

/** Both shard caches, dropped together.
 *
 *  The compiler's parse cache and ops' canonical-form cache are each keyed by
 *  shard path and validated by exact text, so they are bounded by ONE project
 *  and never go stale. A CLI run therefore never needs this. The editor is the
 *  host they were written for and it opens many projects in a session, so
 *  without this every project ever opened stays in memory: `clearParseCache`
 *  existed for exactly this and had no caller anywhere until now. */
function dropShardCaches(): void {
  clearParseCache();
  clearCanonicalCache();
  forgetShardHashes();
}

function openAt(path: string): OpenResult | { error: string } {
  // Before the new project's shards land, so the outgoing project's entries go
  // rather than accumulating across a session of switching.
  dropShardCaches();
  // EVERY PIECE OF SERVER STATE GOES WITH THE PROJECT IT DESCRIBES (2026-09-07).
  // A head learned in the background and a count last drawn are facts about the
  // project being left; keeping them meant the window said where the OLD project
  // stood while the new one was on screen.
  exchange.forget();
  const reply = projects.openAt(path);
  session = projects.current();
  deckFocused = false;   // the editor says again once it lands on a deck
  // ...and the menu the shell rebuilt DURING that open described the old project
  // too, because this mirror only becomes true on the line above. Drawn again
  // here, from the project that is actually open.
  menu();
  // A project that came from a server: ask in the background where the server
  // has got to. A no-op otherwise.
  exchange.refreshHead();
  return reply;
}

/** Close Project: the shell's teardown, then everything that hangs off the
 *  project. Live Link is a project facility: with no project there is nothing
 *  to serve, so the server stops (a project SWITCH deliberately keeps it - the
 *  running game follows the editor across builds via the re-hello), and a push
 *  still waiting would compile a project that is no longer open. The menu
 *  rebuild puts the Play > Live Link tick back in step. */
function closeProject(): void {
  projects.closeCurrent();
  session = undefined;
  deckFocused = false;
  dropShardCaches();
  for (const w of windows.all()) w.close();
  live.stop();
  menu();
}

function createWindow(): void {
  window = createEditorWindow({
    close: (event) => { if (window !== undefined) lifecycle.editorClose(event, window); },
    // Closing the editor closes the live link.
    closed: () => { window = undefined; live.stop(); },
  });
}

void app.whenReady().then(() => {
  store = new StudioStore(app.getPath("userData"), osSecret());
  // Review Feedback and Show Resolved Comments start off, as Patterpad's do.
  store.resetReviewToggles();
  windows = defineWindows({
    store, editor: () => window, addSatellite: projects.addSatellite, jobs: jobs.host,
    forgetLinkFocus: () => tools.forgetLinkFocus(), coverage, guardBoardClose: (win) => lifecycle.guardBoardClose(win),
  });
  serveAssets(() => session);
  registerAll(electronIpc, {
    ...ctx,
    mayLeaveProject: (act) => exchange.mayLeaveProject(act),
    isKnownPath: (path) => projects.isKnownPath(path),
    closeProject,
    setDeckFocused: (on) => {
      if (deckFocused === on) return false;
      deckFocused = on;
      return true;
    },
    hosts: [exchange, live, coverage, launch, tools],
  });
  // Live Link: every saved edit reaches a connected game. And the unpushed
  // count may have moved with it, which the menu and the title say.
  setProjectWrittenListener(() => { live.schedulePush(); noteProjectWritten(); });
  createWindow();
  menu();
  // Auto-update. `configureUpdater` FIRST, or every prompt is addressed to "This
  // app" and hung off whatever window happened to be focused (Patterpad's note,
  // and the reason the order is written down rather than assumed). The EDITOR
  // first, as Patterpad orders it: only the editor answers the prompt, so one
  // sent to the Board or Find in front waited five minutes and answered
  // itself (review 2026-10, item 10).
  configureUpdater({
    appName: "Storyletter",
    activeWindow: () => (window && !window.isDestroyed() ? window : null) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
  });
  // Let the window settle before the first check, then every six hours. The delay
  // is not cosmetic: the renderer registers its four updater handlers at boot, and
  // a prompt that arrives before them waits 300 seconds and then answers itself.
  setTimeout(startBackgroundUpdateCheck, 10_000);
  setInterval(startBackgroundUpdateCheck, 6 * 60 * 60 * 1000);
  reopenOnActivate(createWindow);
});
