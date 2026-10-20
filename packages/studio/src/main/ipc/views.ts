// ---------------------------------------------------------------------------
// View extensions over the bridge (patterkit design/view-extensions.md, app-shell
// README v0.58): File > Add Extension..., Install <Name> on This Machine..., and
// each view's window. A view opens in a sandboxed tool window of its own (the
// shell's `openViewWindow`), one per view, pinned to the editor and remembering
// its bounds as the tool windows do; main hands it and the editor a port pair
// and stays out of the path. Every view window closes when the project does.
// ---------------------------------------------------------------------------

import { app, dialog } from "electron";
import type { BrowserWindow } from "electron";
import { createRequire } from "node:module";
import {
  chooseInstalled, installExtensionPackage, installedExtensions, openViewWindow, readExtensionPackage,
} from "@wildwinter/app-shell/view-host";
import type { ExtensionPackage, ViewWindow } from "@wildwinter/app-shell/view-host";
import { pinToolWindow, rescueToolWindow, savedWindowRect } from "@wildwinter/app-shell/tool-window";
import { MANIFEST_FILE_SUFFIX } from "@wildwinter/toolkit/extensions";
import { join } from "node:path";
import { manifestPath } from "@storylet-studio/ops";
import { addExtension } from "../mutate/extensions.js";
import { readRemote, refuseWrite } from "../remote.js";
import { serialised } from "../mutate/write-path.js";
import { VIEW_SCHEME, installRefusal, offeredViews, packageRefusal, viewWindowKey, viewsDir } from "../view-extensions.js";
import type { OfferedView } from "../view-extensions.js";
import { watchInDev } from "../windows.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";

const VIEW_DEFAULT = { width: 760, height: 560 };
const VIEW_MIN = { width: 360, height: 240 };

export type ViewHostDeps = Pick<MainContext, "session" | "editor" | "store" | "menu">;

export interface ViewHost {
  register(ipc: Ipc): void;
  /** The open project's views, as last worked out (for the menu). */
  offered(): readonly OfferedView[];
  /** Work out the project's views again; the menu is rebuilt when they changed, and a window whose view the
   *  project no longer offers (an undone Add Extension...) closes. `rescan` reads what's installed again even
   *  when the project's extensions haven't changed (after an install). */
  refresh(rescan?: boolean): Promise<void>;
  /** Close every view window: the project changed or closed. */
  closeAll(): void;
  /** Reset View: every open view window back to its default size, centred, and pinned. */
  rescue(): void;
  /** Is this window one of the views? Its Undo is the project's. */
  isView(win: BrowserWindow | null | undefined): boolean;
}

/** The view preload, from the shell's package: main is bundled, so the shell can't find it beside itself. */
let preloadPath: string | undefined;
const viewPreload = (): string => (preloadPath ??= createRequire(import.meta.url).resolve("@wildwinter/app-shell/view-preload.cjs"));

export function createViewHost(deps: ViewHostDeps): ViewHost {
  /** The open view windows, by `viewWindowKey`. */
  const open = new Map<string, ViewWindow>();
  let offered: OfferedView[] = [];
  /** What the menu last drew of them. */
  let drawn = "";
  /** The project's extensions as last worked out (pins and manifests), so a write that changes none of them
   *  (every autosave) doesn't read the disk again. */
  let worked = "";
  /** Each refresh's turn: only the latest one's answer is taken, since a slower earlier scan can finish last. */
  let generation = 0;
  /** A view window being opened, by key: a second ask while it opens waits for it rather than opening another. */
  const opening = new Map<string, Promise<{ error: string } | undefined>>();
  const dir = (): string => viewsDir(app.getPath("userData"));

  async function refresh(rescan = false): Promise<void> {
    const session = deps.session();
    const source = session?.loaded.source;
    const facts = source ? JSON.stringify([session!.loaded.dir, source.project.extensions ?? {}, (source.manifests ?? []).map((m) => [m.id, m.manifest])]) : "";
    if (!rescan && facts === worked) return;
    const turn = ++generation;
    const installed = source ? await installedExtensions(dir()) : [];
    if (turn !== generation) return;
    worked = facts;
    offered = source ? offeredViews(source, installed, chooseInstalled) : [];
    // A view the project no longer offers (an undone Add Extension...) goes, as on a project change.
    for (const [key, view] of [...open]) {
      if (offered.some((v) => v.choice.installed !== null && viewWindowKey(v.extension, v.view) === key)) continue;
      open.delete(key);
      view.close();
    }
    const now = JSON.stringify(offered.map((v) => [v.extension, v.view, v.name, v.choice.installed?.version, v.choice.why]));
    if (now === drawn) return;
    drawn = now;
    deps.menu();
  }

  /**
   * Ask for an extension's package: a folder or an npm pack tarball. macOS's panel takes either; elsewhere a
   * panel takes files or folders, not both, so the author says which first.
   */
  async function pickPackage(title: string, prompt: string): Promise<string | null> {
    const editor = deps.editor()!;
    let properties: ("openFile" | "openDirectory")[] = ["openFile", "openDirectory"];
    if (process.platform !== "darwin") {
      const asked = await dialog.showMessageBox(editor, {
        type: "question", message: title, detail: "An extension's package is a folder, or a .tgz file made by npm pack.",
        buttons: ["Package File\u2026", "Package Folder\u2026", "Cancel"], defaultId: 0, cancelId: 2,
      });
      if (asked.response === 2) return null;
      properties = asked.response === 0 ? ["openFile"] : ["openDirectory"];
    }
    const picked = await dialog.showOpenDialog(editor, {
      title, message: prompt, buttonLabel: "Choose", properties,
      filters: [{ name: "Extension package", extensions: ["tgz"] }],
    });
    return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]!;
  }

  /** The package at a path the author chose, or why it can't be read. */
  async function packageAt(path: string): Promise<ExtensionPackage | { error: string }> {
    const read = await readExtensionPackage(path);
    return read.ok ? read : { error: read.why };
  }

  function closeAll(): void {
    for (const [key, view] of [...open]) {
      // The shell tells the editor the window has closed (its meta with `closed`), and its handle goes.
      open.delete(key);
      view.close();
    }
  }

  return {
    offered: () => offered,
    refresh,
    closeAll,
    rescue() {
      for (const view of open.values()) {
        if (view.window.isDestroyed()) continue;
        rescueToolWindow(view.window, VIEW_DEFAULT);
        pinToolWindow(view.window, deps.editor(), true);
      }
    },
    isView: (win) => win !== null && win !== undefined && [...open.values()].some((v) => v.window === win),
    register(ipc) {
      // Add Extension...: the manifest into the project and the pin, as one undo step, and the views installed.
      // Installed first: an install that fails leaves the project as it was, where a project that took the
      // extension with nothing installed would offer views that can't open.
      ipc.handle("extension:add", async () => {
        const session = deps.session();
        if (!session) return { error: "Open a project first." };
        const path = await pickPackage("Add an extension", "Choose the extension's package: its folder, or a .tgz file made by npm pack.");
        if (path === null) return null;
        const pkg = await packageAt(path);
        if ("error" in pkg) return pkg;
        const refused = packageRefusal(pkg);
        if (refused !== undefined) return { error: refused };
        // A project that may not take it (an author's key: the project file is the designer's) installs nothing.
        const dir0 = session.loaded.dir;
        const role = refuseWrite(readRemote(dir0)?.role, [join(dir0, session.loaded.source?.path ?? ""), manifestPath(dir0, pkg.manifest.id)]);
        if (role !== undefined) return { error: `This project came from a server with an author's key, and adding an extension is the designer's to do, so nothing was added.` };
        const installed = await installExtensionPackage(pkg, dir());
        if (!installed.ok) return { error: installed.why };
        const text = new TextDecoder().decode(pkg.files.get(`${pkg.manifest.id}${MANIFEST_FILE_SUFFIX}`)!);
        const result = await serialised(() => (deps.session() === session ? addExtension(session, pkg.manifest, text) : { error: "The project changed meanwhile, so it wasn't added." }));
        await refresh(true);
        // Installed all the same: say so, since the views are now on this machine for the next try.
        if ("error" in result) return { error: `${result.error} ${pkg.manifest.name}'s views were installed on this machine.` };
        return result;
      });

      // Install <Name> on This Machine...: a project that takes the extension, on a machine without its views.
      ipc.handle("extension:install", async (_event, extension) => {
        const view = offered.find((v) => v.extension === extension);
        const name = view?.extensionName ?? extension;
        const path = await pickPackage(`Install ${name} on this machine`, `Choose ${name}'s package: its folder, or a .tgz file made by npm pack.`);
        if (path === null) return null;
        const pkg = await packageAt(path);
        if ("error" in pkg) return pkg;
        const refused = installRefusal(pkg, extension, name);
        if (refused !== undefined) return { error: refused };
        const installed = await installExtensionPackage(pkg, dir());
        if (!installed.ok) return { error: installed.why };
        await refresh(true);
        return { installed: installed.installed.version };
      });

      // One window per view: asked again, the open one comes forward.
      ipc.handle("view:open", async (_event, extension, viewId) => {
        const editor = deps.editor();
        if (!deps.session() || !editor || editor.isDestroyed()) return { error: "Open a project first." };
        const key = viewWindowKey(extension, viewId);
        const already = open.get(key);
        if (already && !already.window.isDestroyed()) { already.window.show(); already.window.focus(); return undefined; }
        // Two quick asks would both pass the check above across the await below, and the first window would be
        // orphaned: the second waits for the first's opening instead.
        const inFlight = opening.get(key);
        if (inFlight) return inFlight;
        const work = openView(key, extension, viewId, editor);
        opening.set(key, work);
        try { return await work; } finally { opening.delete(key); }
      });
    },
  };

  /** Open a view's window: the project's views worked out again, then the installed version the pin chooses. */
  async function openView(key: string, extension: string, viewId: string, editor: BrowserWindow): Promise<{ error: string } | undefined> {
    await refresh(true);
    const view = offered.find((v) => v.extension === extension && v.view === viewId);
    if (!view) return { error: "This project has no such view." };
    const { installed, warning, why } = view.choice;
    if (!installed) return { error: why ?? `${view.extensionName} isn't installed on this machine.` };
    const slice = deps.store().window(key);
    let opened: ViewWindow;
    try {
      opened = openViewWindow({
        installed, view: viewId, host: "storylets", scheme: VIEW_SCHEME, editor, pinnedVersion: view.pinned,
        // The versions differ but share a major version: it opens, and its head says so.
        ...(warning !== undefined ? { title: `${view.name} (${warning})` } : {}),
        rect: savedWindowRect(slice.bounds(), VIEW_DEFAULT, VIEW_MIN), min: VIEW_MIN,
        pinTo: () => deps.editor(), pinned: slice.pinned(), remember: (bounds) => slice.remember(bounds),
        devTools: !app.isPackaged, preload: viewPreload(),
        onClosed: () => { if (open.get(key) === opened) open.delete(key); },
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    open.set(key, opened);
    watchInDev(opened.window, key);
    return undefined;
  }
}
