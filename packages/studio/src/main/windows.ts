// ---------------------------------------------------------------------------
// The windows: the editor, and the four tool windows on the shell's table
// (the shared tool-window kit; Patterpad's shape).
// ---------------------------------------------------------------------------

import { BrowserWindow } from "electron";
import { join } from "node:path";
import { defineToolWindows } from "@wildwinter/app-shell/tool-window";
import type { ToolWindows } from "@wildwinter/app-shell/tool-window";
import type { Satellite } from "@wildwinter/app-shell/session";
import type { StudioStore } from "./store.js";
import type { ToolName } from "./context.js";
import { COVERAGE_JOB } from "./jobs.js";
import { hear } from "./ipc/registrar.js";
import { push } from "./ipc/push.js";
import { PROJECT_CHANGED } from "../shared/api.js";

const BOARD_DEFAULT = { width: 1080, height: 760 };
const BOARD_MIN = { width: 720, height: 520 };
const SEARCH_DEFAULT = { width: 440, height: 480 };
const SEARCH_MIN = { width: 340, height: 240 };
const COVERAGE_DEFAULT = { width: 1080, height: 760 };
const COVERAGE_MIN = { width: 640, height: 420 };
const LINKS_DEFAULT = { width: 900, height: 560 };
const LINKS_MIN = { width: 520, height: 360 };

export interface ToolWindowDeps {
  store: StudioStore;
  editor(): BrowserWindow | undefined;
  /** The session's satellite registry: a row is told when the project changes. */
  addSatellite(satellite: Satellite): () => void;
  /** The job host, so the Coverage row can cancel a sweep still running. */
  jobs: { cancel(kind: string): unknown };
  /** The Links row's clear: the lens's focus goes with the project. */
  forgetLinkFocus(): void;
  /** The Coverage row's clear: the cached report goes with the project. */
  coverage: { forget(): void };
  /** Every tool window created: the Board's close is guarded (lifecycle.ts). */
  guardBoardClose(win: BrowserWindow): void;
}

/**
 * The four tool windows, as data, on the shell's table (defineToolWindows).
 *
 * They were four near-identical `openX()` functions, and the differences
 * between them were all mistakes: only the Board forwarded its console to a dev
 * terminal, and Reset View rescued two of the four because it kept its own
 * list. The table made both structurally impossible, and the shell now owns the
 * table: every row is a project-changed satellite the moment it is defined,
 * Reset View walks the rows (store reset, restore, centre, re-pin, then tell the
 * window), and `onOpened` runs for every window created.
 *
 * Frameless throughout (the shell's default): each draws its own slim drag bar
 * (toolWindowHead), remembers its bounds through its store slice, and has a
 * minimum size. Built once the store exists, since a row reads its remembered
 * rect from it.
 */
export function defineWindows(deps: ToolWindowDeps): ToolWindows<ToolName> {
  const { store, jobs, guardBoardClose } = deps;
  return defineToolWindows<ToolName>([
    { name: "board", title: "The Board", page: "table.html", def: BOARD_DEFAULT, min: BOARD_MIN, ...store.window("board") },
    // A small, always-on-top helper (Patterpad's search tool window): the
    // editor stays live underneath while you step through hits.
    { name: "find", title: "Find", page: "search.html", def: SEARCH_DEFAULT, min: SEARCH_MIN, ...store.window("search") },
    // A lens, so it opens beside the editor and follows the selection rather
    // than holding a place of its own. A project change is a channel of its
    // own, `links:reset`: on the focus channel it read as "look at nothing",
    // and a lens that had been walked ignored it (review 2026-10, item 8).
    // `links:focus` is now only the selection following and Links....
    { name: "links", title: "Links", page: "links.html", def: LINKS_DEFAULT, min: LINKS_MIN, ...store.window("links"),
      channel: "links:reset", clear: () => { deps.forgetLinkFocus(); } },
    // A cached report describes the project that produced it; a new project
    // underneath the Coverage window makes it a lie. A sweep still running is
    // cancelled for the same reason, and its result dropped (`coverageJob`).
    { name: "coverage", title: "Coverage", page: "coverage.html", def: COVERAGE_DEFAULT, min: COVERAGE_MIN, ...store.window("coverage"),
      clear: () => { jobs.cancel(COVERAGE_JOB); deps.coverage.forget(); } },
  ], {
    rendererDir: join(import.meta.dirname, "../renderer"),
    preload: join(import.meta.dirname, "../preload/index.cjs"),
    pinTo: () => deps.editor(),
    session: { addSatellite: deps.addSatellite, channel: PROJECT_CHANGED },
    resetStore: () => store.resetWindows(),
    // EVERY tool window, not just the Board: a renderer fault is invisible to a
    // scripted verifier otherwise, which is the whole reason watchInDev exists.
    onOpened: (win, name) => { watchInDev(win, name); if (name === "board") guardBoardClose(win); },
  });
}

/**
 * In dev, put a window's console on the terminal.
 *
 * A renderer's errors are otherwise only visible in devtools, which needs a
 * person at the keyboard to open. That makes a whole class of fault - a blocked
 * subresource, a failed image, an exception during a paint - invisible to anyone
 * verifying a build from a script, which is exactly how the asset scheme shipped
 * with a CSP that forbade it. Dev only, and quiet unless something speaks.
 */
export function watchInDev(win: BrowserWindow, name: string): void {
  if (process.env["ELECTRON_RENDERER_URL"] === undefined) return;
  win.webContents.on("console-message", (event) => {
    console.log(`[${name}] ${event.level}: ${event.message}`);
  });
  win.webContents.on("did-fail-load", (_e, code, description, url) => {
    console.log(`[${name}] load failed ${code} ${description} ${url}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.log(`[${name}] renderer gone: ${details.reason}`);
  });
}

/** The editor window: built hidden, shown once its renderer has mounted. Its
 *  close and its closing are the lifecycle's (lifecycle.ts), passed in. */
export function createEditorWindow(on: {
  close(event: Electron.Event): void;
  closed(): void;
}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, "../preload/index.cjs"),
    },
  });
  // Reveal only once the renderer signals (`app:ready`) that its INITIAL view is
  // mounted: the restored project or the welcome screen. NOT on `ready-to-show`,
  // which fires on the first paint of the pre-boot chrome and flashed an empty
  // frame before boot() filled it (Patterpad's handshake, parity row 13). A
  // fallback timer still reveals the window if the renderer errors before
  // signalling, so a broken boot cannot leave it hidden.
  let revealed = false;
  const reveal = (): void => {
    if (revealed) return;
    revealed = true;
    stopHearing();
    if (!window.isDestroyed()) window.show();
  };
  const stopHearing = hear("app:ready", reveal);
  setTimeout(reveal, 4000);
  window.on("close", on.close);
  window.on("closed", on.closed);
  watchInDev(window, "editor");

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return window;
}

/**
 * Ask the editor to put its pending edits on disk, and resolve once it says so
 * (or after a short wait if it cannot). Before a project-wide Replace, a pull, a
 * push or a pinned publish, so an edit still in the air is neither lost nor
 * written over. The editor answers "editor:flush" with "editor:flushed"
 * (Patterpad's pair); `flushed` is that answer arriving.
 */
export function createEditorFlush(editor: () => BrowserWindow | undefined): { flush(): Promise<void>; flushed(): void } {
  let flushWaiters: Array<() => void> = [];
  return {
    flush: () => new Promise((resolve) => {
      const window = editor();
      if (!window || window.isDestroyed()) { resolve(); return; }
      flushWaiters.push(resolve);
      push(window.webContents, "editor:flush");
      setTimeout(() => { const i = flushWaiters.indexOf(resolve); if (i >= 0) { flushWaiters.splice(i, 1); resolve(); } }, 1500);
    }),
    flushed: () => { const w = flushWaiters; flushWaiters = []; for (const r of w) r(); },
  };
}
