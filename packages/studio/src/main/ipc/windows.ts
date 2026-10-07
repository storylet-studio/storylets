// ---------------------------------------------------------------------------
// The tool windows over the bridge: opening, pinning and closing the Board,
// Find, Links and Coverage, what each is pointed at, and the editor brought
// forward from one of them.
// ---------------------------------------------------------------------------

import { pinToolWindow } from "@wildwinter/app-shell/tool-window";
import { linksFor } from "../read/links.js";
import type { CoverageEvidence } from "../read/links.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { push } from "./push.js";
import type { SearchOpen } from "../../shared/api.js";

export interface WindowsIpcDeps extends Pick<MainContext, "session" | "editor" | "store" | "windows"> {
  /** The last coverage run's evidence, for the Links lens. */
  coverage: { last(): CoverageEvidence | undefined };
  /** The Board asked its own question: let its next close through (lifecycle.ts). */
  allowBoardClose(): void;
  /** The editor has flushed its pending edits (windows.ts `createEditorFlush`). */
  editorFlushed(): void;
}

export interface WindowsIpc {
  /** The lens's focus goes with the project (the Links row's clear). */
  forgetLinkFocus(): void;
  /** A query waiting for Find describes the project it was asked about. */
  dropSearchSeed(): void;
  register(ipc: Ipc): void;
}

export function createWindowsIpc(deps: WindowsIpcDeps): WindowsIpc {
  /** The card the editor currently has open, so the Links lens can follow it. */
  let linkFocus: string | undefined;
  /** A tab and query handed to Find as it opens, waiting to be collected at its boot. */
  let searchSeed: SearchOpen | undefined;

  /** Bring the editor forward, unminimised, if it is there. */
  const editorForward = (): ReturnType<MainContext["editor"]> => {
    const window = deps.editor();
    if (!window || window.isDestroyed()) return undefined;
    if (window.isMinimized()) window.restore();
    return window;
  };

  return {
    forgetLinkFocus: () => { linkFocus = undefined; },
    dropSearchSeed: () => { searchSeed = undefined; },
    register: (ipc) => {
      // --- the Board ---------------------------------------------------------------
      // Braces, not an expression: `open` returns the window, which cannot cross
      // IPC ("An object could not be cloned"), and the caller only waits for it.
      ipc.handle("table:open", () => { deps.windows().open("board"); });
      ipc.handle("board:setPin", (_e, on) => {
        deps.store().window("board").setPinned(on);
        pinToolWindow(deps.windows().get("board"), deps.editor(), on);
      });
      ipc.handle("board:close", () => { deps.allowBoardClose(); deps.windows().get("board")?.close(); });

      // --- Find (Patterpad's detached search tool) ------------------------------------
      // It queries the project itself (revalidate) and drives the editor here.
      // A seeded open: the window may not exist yet, so the query waits here for
      // the new window to ask for it at boot; an open window is told directly.
      ipc.handle("search:open", (_event, open) => {
        const already = deps.windows().get("find") !== undefined;
        searchSeed = open;
        const find = deps.windows().open("find");
        if (already && open !== undefined) push(find.webContents, "search:seed", open);
      });
      ipc.handle("search:pendingQuery", (): SearchOpen | undefined => {
        const seed = searchSeed;
        searchSeed = undefined;
        return seed;
      });
      ipc.handle("search:setPin", (_e, on) => {
        deps.store().window("search").setPinned(on);
        pinToolWindow(deps.windows().get("find"), deps.editor(), on);
      });
      ipc.handle("search:reveal", (_e, selection) => {
        const window = editorForward();
        if (window) push(window.webContents, "search:navigate", selection);
      });
      ipc.handle("search:close", () => { deps.windows().get("find")?.close(); });
      // Find's Replace flushes the editor first (find.ts); this is the editor's answer.
      ipc.handle("editor:flushed", () => { deps.editorFlushed(); });

      // --- the Links lens ---------------------------------------------------------------
      // With a card: point the lens at THAT card and bring the window forward, which
      // is what "Links..." on a card means whether the window is open or not. Focus
      // first, so a window opening for the first time boots straight onto the right
      // card rather than showing the old one for a frame. The id rides on
      // `links:focus` here and only here: it is an explicit request, so the lens
      // re-centres on it and follows again.
      ipc.handle("links:open", (_event, cardId) => {
        if (cardId !== undefined) linkFocus = cardId;
        const already = deps.windows().get("links") !== undefined;
        const links = deps.windows().open("links");
        if (cardId !== undefined && already) push(links.webContents, "links:focus", cardId);
        // A lens the author has just asked for should be in front of the editor even
        // when it is not pinned.
        if (already) links.show();
      });
      // The editor's selection moved. Recorded, and the lens is told with NO id:
      // it reads the focus back through `links:for` and keeps its own walked or
      // Follow state, where an id would be taken as "Links..." and re-centre a
      // lens the author had told not to follow (2026-10-07).
      ipc.handle("links:setFocus", (_event, cardId) => {
        linkFocus = cardId;
        const links = deps.windows().get("links");
        if (links) push(links.webContents, "links:focus", undefined);
      });
      ipc.handle("links:for", (_event, cardId) =>
        linksFor(deps.session(), cardId ?? linkFocus, deps.coverage.last(), deps.store().get().linksPinned));
      ipc.handle("links:setPin", (_event, on) => {
        deps.store().window("links").setPinned(on);
        pinToolWindow(deps.windows().get("links"), deps.editor(), on);
      });
      ipc.handle("links:close", () => { deps.windows().get("links")?.close(); });

      ipc.handle("view:resetWindows", () => deps.windows().rescue());
      // The Coverage window's "Coverage drivers..." button: bring the editor
      // forward with the settings dialog open where the drivers are edited.
      ipc.handle("settings:open", (_event, section) => {
        const window = editorForward();
        if (window) {
          window.focus();
          push(window.webContents, "menu", { cmd: "project-settings", section });
        }
      });
    },
  };
}
