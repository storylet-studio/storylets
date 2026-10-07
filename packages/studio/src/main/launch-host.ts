// ---------------------------------------------------------------------------
// What the OS and the shell hand the app: a double-clicked project or pack,
// `storyletter <path> --at <where>`, and the same from a second launch while
// this one is running (Patterpad's shape).
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { PACK_EXTENSION } from "@storylet-studio/ops";
import { launchLocation } from "./launch.js";
import type { MainContext } from "./context.js";
import type { Exchange } from "./exchange.js";
import type { Ipc } from "./ipc/registrar.js";
import { push } from "./ipc/push.js";
import type { OpenResult, PackOffer } from "../shared/api.js";

type Opened = OpenResult | { error: string } | PackOffer | null;

export interface LaunchHost {
  /** Hold a path (and a `--at`) for the renderer to collect at boot. */
  hold(path: string | undefined, at: string | undefined): void;
  /** Open an OS- or shell-provided path in the running window (or hold it). */
  openInWindow(path: string, at?: string): void;
  /** Jump the running window to a `--at` item. */
  navigateInWindow(query: string): void;
  /** Bring the editor window to the front. */
  surfaceWindow(): void;
  register(ipc: Ipc): void;
}

export function createLaunch(
  ctx: Pick<MainContext, "session" | "editor" | "store" | "openAt">,
  exchange: Pick<Exchange, "landPack" | "readPackAddress" | "handedPacks">,
): LaunchHost {
  /** A path the OS handed us before the window existed (open-file fires during
   *  cold launch on macOS), waiting for the renderer to collect it at boot. */
  let pendingLaunchPath: string | undefined;

  /** A `--at <where>` from the command line, waiting beside the path (or alone:
   *  a bare `storyletter --at x` reopens the last project there). */
  let pendingLaunchAt: string | undefined;

  /**
   * Open whatever the OS passed us.
   *
   * A `.storyletpack` is a DELIVERY, never a project that can be opened in place,
   * so it lands (with a destination prompt) rather than being loaded; anything
   * else is treated as a project folder.
   *
   * ONE way to open a pack (review 2026-10, item 14): a double-clicked one lands
   * through `landPack`, as File > Open Storyletpack does, so it merges into a
   * folder that already holds the project and runs as a job with its strip. It
   * had a route of its own that wrote verbatim and never merged.
   *
   * A pack that NAMES AN ADDRESS is not opened here at all: it is handed back as
   * an offer, and the renderer asks the same question File ▸ Open Storyletpack
   * asks. A double-clicked pack and a picked one are the same pack, and until now
   * one of them quietly threw the address away.
   */
  async function resolveLaunchPath(path: string): Promise<Opened> {
    if (!path.toLowerCase().endsWith(PACK_EXTENSION)) return ctx.openAt(path);
    const address = await exchange.readPackAddress(path);
    if (address !== undefined) {
      exchange.handedPacks.add(path);   // the offer's Cancel opens it flat, through pack:openAt
      return { pack: { path, address } };
    }
    try {
      return await exchange.landPack(readFileSync(path), undefined);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Bring the editor window to the front (a launch while we are running). */
  function surfaceWindow(): void {
    const window = ctx.editor();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  }

  /** Aim an opened project at a `--at` item. The renderer lands on `at` instead
   *  of the remembered place, through the same path a Find hit takes. Nothing
   *  matching is said on the terminal and the open goes ahead as it would have,
   *  so a stale id in a bug report cannot keep anyone out. */
  function withLaunchLocation(result: Opened, query: string | undefined): Opened {
    const session = ctx.session();
    // An offer has not opened anything yet, so there is nowhere to land: the `--at`
    // is dropped with the same silence a stale id gets.
    if (query === undefined || result === null || "error" in result || "pack" in result || !session) return result;
    const at = launchLocation(session.loaded, query);
    if (!at) { console.error(`--at: nothing in this project matches '${query}'`); return result; }
    return { ...result, at };
  }

  /** A `--at <where>` while a project is open: jump the running window, down the
   *  channel the Find window drives the editor with. */
  function navigateInWindow(query: string): void {
    const window = ctx.editor();
    const session = ctx.session();
    if (!window || window.isDestroyed() || !session) return;
    const at = launchLocation(session.loaded, query);
    if (!at) { console.error(`--at: nothing in this project matches '${query}'`); return; }
    push(window.webContents, "search:navigate", at);
  }

  /** Open an OS- or shell-provided path in the running window (or hold it for
   *  boot when there is no window yet). A pack unpacks, with its destination
   *  prompt; anything else loads in place, landing on `at` when one rode in. */
  function openInWindow(path: string, at?: string): void {
    const window = ctx.editor();
    if (!window || window.isDestroyed()) {
      pendingLaunchPath = path;      // the renderer collects it at boot
      if (at !== undefined) pendingLaunchAt = at;
      return;
    }
    void (async () => {
      const result = withLaunchLocation(await resolveLaunchPath(path), at);
      if (result === null) return;
      surfaceWindow();
      const editor = ctx.editor();
      if (editor) push(editor.webContents, "project:opened", result);
    })();
  }

  return {
    hold: (path, at) => { pendingLaunchPath = path; pendingLaunchAt = at; },
    openInWindow,
    navigateInWindow,
    surfaceWindow,
    register: (ipc) => {
      // Whatever the OS handed us at launch (a double-clicked project or pack), if
      // anything. The renderer asks first and falls back to the last project, so
      // boot order stays the renderer's decision.
      ipc.handle("project:launchTarget", async (): Promise<Opened> => {
        const path = pendingLaunchPath;
        const at = pendingLaunchAt;
        pendingLaunchPath = undefined;
        pendingLaunchAt = undefined;
        if (path !== undefined) return withLaunchLocation(await resolveLaunchPath(path), at);
        // A bare `storyletter --at <where>`: the last project, straight at that item.
        if (at !== undefined) {
          const last = ctx.store().get().lastProject;
          if (last !== undefined && existsSync(last)) return withLaunchLocation(ctx.openAt(last), at);
          console.error(`--at: no project to open at '${at}'`);
        }
        return null;
      });
    },
  };
}
