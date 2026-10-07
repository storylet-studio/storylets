// ---------------------------------------------------------------------------
// What the composition root (index.ts) hands each domain: read through, never
// captured, because the window, the store and the tool windows are built at
// whenReady and the session changes with every open. Each domain takes the
// part it needs (a `Pick` of this) as an argument, so what it depends on is
// written at its signature rather than reached for as a global.
// ---------------------------------------------------------------------------

import type { BrowserWindow } from "electron";
import type { ToolWindows } from "@wildwinter/app-shell/tool-window";
import type { ProjectSession } from "./project.js";
import type { StudioStore } from "./store.js";
import type { OpenResult } from "../shared/api.js";

/** The four tool windows, as rows of the shell's table (windows.ts). */
export type ToolName = "board" | "find" | "links" | "coverage";

export interface MainContext {
  /** The open project, or none. */
  session(): ProjectSession | undefined;
  /** The editor window, while it exists. */
  editor(): BrowserWindow | undefined;
  /** The app's settings. */
  store(): StudioStore;
  /** The tool windows' table. */
  windows(): ToolWindows<ToolName>;
  /** Rebuild the menu and the window title from where things now stand. */
  menu(): void;
  /** Open a project in place of the current one (the shell's sequence). */
  openAt(path: string): OpenResult | { error: string };
  /** Ask the editor to put its pending edits on disk, and wait (briefly) for it. */
  flushEditor(): Promise<void>;
  /** Run a blocking act as a job, with its strip (jobs.ts). */
  runJob<T>(kind: string, work: () => Promise<T>): Promise<T | { error: string }>;
}
