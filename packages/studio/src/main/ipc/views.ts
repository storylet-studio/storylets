// ---------------------------------------------------------------------------
// View extensions over the bridge (patterkit design/view-extensions.md, app-shell
// README v0.58 and v0.60): the Extensions window (patterkit design/extensions-window.md),
// whose Add Extension is the one way in (it takes an extension into the project, or
// installs the views of one the project takes and offers a newer version), whose
// Remove from Project keeps the extension's data, and whose Uninstall takes one
// version off this machine; and each view's window. A view opens in a sandboxed tool window of its own (the
// shell's `openViewWindow`), one per view, pinned to the editor and remembering
// its bounds as the tool windows do; main hands it and the editor a port pair
// and stays out of the path. Every view window closes when the project does.
// ---------------------------------------------------------------------------

import { app, dialog } from "electron";
import type { BrowserWindow } from "electron";
import { createRequire } from "node:module";
import {
  chooseInstalled, installExtensionPackage, installedExtensions, openViewWindow, readExtensionPackage, uninstallViews,
} from "@wildwinter/app-shell/view-host";
import { extensionRows, planPackageAdd, planPackageUpdate, planProjectRemoval, sameAsInstalled } from "@wildwinter/app-shell/view-package";
import type { TakenExtension } from "@wildwinter/app-shell/view-package";
import type { ExtensionPackage, ViewWindow } from "@wildwinter/app-shell/view-host";
import { frontForModal, pinToolWindow, rescueToolWindow, savedWindowRect } from "@wildwinter/app-shell/tool-window";
import { MANIFEST_FILE_SUFFIX, manifestProblems, missingRequirements, viewsFor } from "@wildwinter/toolkit/extensions";
import type { Manifest } from "@wildwinter/toolkit/extensions";
import { join } from "node:path";
import { manifestPath } from "@storylet-studio/ops";
import { addExtension, extensionDataCount, removeExtension } from "../mutate/extensions.js";
import { readRemote, refuseWrite } from "../remote.js";
import { serialised } from "../mutate/write-path.js";
import { VIEW_SCHEME, installRefusal, offeredViews, packageRefusal, viewWindowKey, viewsDir } from "../view-extensions.js";
import type { OfferedView } from "../view-extensions.js";
import { watchInDev } from "../windows.js";
import { push } from "./push.js";
import type { MainContext } from "../context.js";
import type { ProjectSession } from "../project.js";
import type { ExtensionsAsk, ExtensionsWinState, OpenResult } from "../../shared/api.js";
import type { Ipc } from "./registrar.js";

const VIEW_DEFAULT = { width: 760, height: 560 };
const VIEW_MIN = { width: 360, height: 240 };

export type ViewHostDeps = Pick<MainContext, "session" | "editor" | "store" | "menu"> & Partial<Pick<MainContext, "windows">>;

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
  /** Send the open Extensions window its rows again (a project opened or closed, say). */
  sendExtensions(): Promise<void>;
}

/** The extensions a project takes with a sound manifest, each with its pin: what the Extensions window lists
 *  and what Remove from Project checks. */
export function takenExtensions(session: ProjectSession | undefined): TakenExtension[] {
  const source = session?.loaded.source;
  if (!source) return [];
  const out: TakenExtension[] = [];
  for (const [id, pin] of Object.entries(source.project.extensions ?? {})) {
    const manifest = source.manifests?.find((m) => m.id === id)?.manifest;
    if (manifest === undefined || manifestProblems(manifest).some((p) => p.severity === "error")) continue;
    out.push({ id, ...(pin.version !== undefined ? { pin: pin.version } : {}), manifest: manifest as Manifest });
  }
  return out;
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
    void sendExtensions();
    const now = JSON.stringify(offered.map((v) => [v.extension, v.view, v.name, v.choice.installed?.version, v.choice.why]));
    if (now === drawn) return;
    drawn = now;
    deps.menu();
    // The editor draws a field's Edit for the view that edits it only while that view opens here.
    const editor = deps.editor();
    if (editor && !editor.isDestroyed()) {
      push(editor.webContents, "views:offers", offered.map((v) => ({ extension: v.extension, view: v.view, installed: v.choice.installed !== null })));
    }
  }

  /** Ask the author a question in a native box; the button chosen, by index (the last is Cancel). The editor
   *  comes in front of the pinned windows while it's up (the Extensions window among them), so a question asked
   *  from one is never hidden under it. */
  async function ask(message: string, detail: string, buttons: string[]): Promise<number> {
    const editor = deps.editor()!;
    const release = frontForModal(editor);
    try {
      const r = await dialog.showMessageBox(editor, { type: "question", message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
      return r.response;
    } finally { release(); }
  }

  /** The Extensions window's extension to bring into view, until it closes. */
  let extensionsFocus: string | undefined;

  async function extensionsState(): Promise<ExtensionsWinState> {
    const session = deps.session();
    return {
      rows: extensionRows(takenExtensions(session), await installedExtensions(dir()), "storylets"),
      hasProject: session !== undefined,
      ...(extensionsFocus !== undefined ? { focus: extensionsFocus } : {}),
    };
  }

  /**
   * Update... (the Extensions window): the extension's package, then what will happen, asked first. A newer
   * version is taken into the project as one undo step (when the project takes it) and installed; the same
   * version is reinstalled (with the project's copy of its manifest, when the package changes it); an older
   * version, or another extension's package, is refused with both named. Null: cancelled.
   */
  async function updateExtension(id: string): Promise<OpenResult | { installed: string; name: string; note?: string; reinstalled?: true } | { error: string } | null> {
    const session = deps.session();
    const taken = takenExtensions(session);
    const installedAll = await installedExtensions(dir());
    const row = extensionRows(taken, installedAll, "storylets").find((r) => r.id === id);
    if (!row) return { error: `There's no extension \u201c${id}\u201d here to update.` };
    const path = await pickPackage(`Update ${row.name}`, `Choose ${row.name}'s package: its folder, or a .tgz file made by npm pack.`);
    if (path === null) return null;
    const pkg = await packageAt(path);
    if ("error" in pkg) return pkg;
    const mine = taken.find((t) => t.id === id);
    const installed = installedAll.filter((i) => i.id === id);
    const plan = planPackageUpdate(row, pkg.manifest, mine?.manifest ?? installed[installed.length - 1]?.manifest, "storylets", taken.map((t) => t.id));
    if (plan.kind === "refused") return { error: plan.why };
    const refused = packageRefusal(pkg, "updated");
    if (refused !== undefined) return { error: refused };
    const name = pkg.manifest.name;
    const text = new TextDecoder().decode(pkg.files.get(`${pkg.manifest.id}${MANIFEST_FILE_SUFFIX}`)!);
    // Its windows close before its files are replaced: a view left open would run on the old ones.
    const closeViews = (): void => { for (const [key, view] of [...open]) if (key.startsWith(viewWindowKey(id, ""))) { open.delete(key); view.close(); } };
    const mayWrite = (): string | undefined => {
      if (!session) return undefined;
      const dir0 = session.loaded.dir;
      const role = refuseWrite(readRemote(dir0)?.role, [join(dir0, session.loaded.source?.path ?? ""), manifestPath(dir0, id)]);
      return role === undefined ? undefined : `This project came from a server with an author's key, and updating an extension is the designer's to do, so nothing was updated.`;
    };

    if (plan.kind === "same") {
      const v = plan.version;
      const there = installed.find((i) => i.version === v);
      // A rebuilt development version can change the manifest without its version: the project's copy goes too.
      const differs = mine !== undefined && JSON.stringify(mine.manifest) !== JSON.stringify(pkg.manifest);
      if (there && !differs && await sameAsInstalled(pkg, there.root)) {
        return { installed: v, name, note: "Its files are the same as the ones installed here, so there's nothing to do." };
      }
      if (differs) { const why = mayWrite(); if (why !== undefined) return { error: why }; }
      const what = differs
        ? "Reinstalling replaces its installed files on this machine, and the project's copy of its manifest, which this package changes. You can undo the project's part."
        : "Reinstalling replaces its installed files on this machine. The project stays as it is.";
      if (await ask(`Reinstall ${name} ${v}?`, `This package is ${name} ${v}, the version ${mine ? "this project takes" : "installed here"}. ${what} Its open views close.`, [`Reinstall ${v}`, "Cancel"]) !== 0) return null;
      closeViews();
      const installedNow = await installExtensionPackage(pkg, dir());
      if (!installedNow.ok) return { error: installedNow.why };
      if (!differs || !session) { await refresh(true); return { installed: v, name, reinstalled: true }; }
      const result = await serialised(() => (deps.session() === session ? addExtension(session, [{ manifest: pkg.manifest, text }]) : { error: "The project changed meanwhile, so its manifest wasn't updated." }));
      await refresh(true);
      return result;
    }

    const lines = plan.changes.length > 0 ? plan.changes : ["No fields or views change."];
    const how = mine
      ? "The project takes it as one step you can undo, and its views install on this machine."
      : "Its views install on this machine. No project changes.";
    if (mine) { const why = mayWrite(); if (why !== undefined) return { error: why }; }
    if (await ask(`Update ${name}${plan.from ? ` from ${plan.from}` : ""} to ${plan.to}?`, `${lines.join(" ")} ${how} Values it no longer accepts show among the problems afterwards.`, [`Update to ${plan.to}`, "Cancel"]) !== 0) return null;
    let required: ExtensionPackage[] = [];
    if (mine && plan.missing.length > 0) {
      const got = await requirementsFor(pkg, plan.missing, taken.map((t) => t.id));
      if (got === null || "error" in got) return got;
      required = got;
    }
    closeViews();
    for (const p of [...required.filter((r) => viewsFor(r.manifest, "storylets").length > 0), pkg]) {
      const installedNow = await installExtensionPackage(p, dir());
      if (!installedNow.ok) return { error: installedNow.why };
    }
    if (!mine || !session) { await refresh(true); return { installed: plan.to, name }; }
    const items = [...required, pkg].map((p) => ({ manifest: p.manifest, text: new TextDecoder().decode(p.files.get(`${p.manifest.id}${MANIFEST_FILE_SUFFIX}`)!) }));
    const result = await serialised(() => (deps.session() === session ? addExtension(session, items) : { error: "The project changed meanwhile, so it wasn't updated." }));
    await refresh(true);
    if ("error" in result) return { error: `${result.error} ${name}'s views were installed on this machine.` };
    return result;
  }

  /** Send the open Extensions window its rows again: something it lists changed. */
  async function sendExtensions(): Promise<void> {
    const win = deps.windows?.().get("extensions");
    if (!win || win.isDestroyed()) return;
    const state = await extensionsState();
    if (!win.isDestroyed()) push(win.webContents, "extensions:show", state);
  }

  /** The packages of the extensions `pkg` requires that the project lacks, chosen one by one, in order; or why
   *  not (`null`: the author cancelled). */
  async function requirementsFor(pkg: ExtensionPackage, missing: readonly string[], taken: readonly string[]): Promise<ExtensionPackage[] | { error: string } | null> {
    const name = pkg.manifest.name;
    const out: ExtensionPackage[] = [];
    for (const id of missing) {
      const go = await ask(`${name} needs \u201c${id}\u201d`,
        `${name} works only in a project that also takes the extension \u201c${id}\u201d, which this one doesn't. Choose its package to add both, as one step you can undo.`,
        [`Choose \u201c${id}\u201d Package\u2026`, "Cancel"]);
      if (go !== 0) return null;
      const path = await pickPackage(`Add \u201c${id}\u201d`, `Choose the package of \u201c${id}\u201d, which ${name} needs: its folder, or a .tgz file made by npm pack.`);
      if (path === null) return null;
      const req = await packageAt(path);
      if ("error" in req) return req;
      if (req.manifest.id !== id) return { error: `That package is ${req.manifest.name ?? req.manifest.id}, not \u201c${id}\u201d, so ${name} wasn't added.` };
      const refused = packageRefusal(req);
      if (refused !== undefined) return { error: refused };
      // One level: what the requirement needs in turn must be in the project, or among what's being added.
      const further = missingRequirements(req.manifest, [...taken, pkg.manifest.id, ...missing]);
      if (further.length > 0) {
        return { error: `${req.manifest.name} needs ${further.map((f) => `\u201c${f}\u201d`).join(" and ")} too, which this project doesn't take. Add ${further.length > 1 ? "them" : "it"} first, then ${name}.` };
      }
      out.push(req);
    }
    return out;
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
        view.setPinned(true); // the window and its head's pin
      }
    },
    isView: (win) => win !== null && win !== undefined && [...open.values()].some((v) => v.window === win),
    sendExtensions,
    register(ipc) {
      // --- the Extensions window (patterkit design/extensions-window.md) -------------------------------------
      ipc.handle("extensions:open", (_event, focus) => {
        const windows = deps.windows?.();
        if (!windows) return;
        extensionsFocus = typeof focus === "string" ? focus : undefined;
        const already = windows.get("extensions") !== undefined;
        const win = windows.open("extensions");
        if (!already) win.once("closed", () => { extensionsFocus = undefined; });
        else win.show();
        void sendExtensions();
      });
      ipc.handle("extensions:state", () => extensionsState());
      ipc.handle("extension:update", async (_event, id) => (typeof id === "string" ? updateExtension(id) : null));
      // Add, Install and Remove are project steps: the editor runs them, as the menu would, so what's typed lands
      // first and the editor redraws over the project as it then is.
      ipc.handle("extensions:ask", (_event, ask: ExtensionsAsk) => {
        const editor = deps.editor();
        if (!editor || editor.isDestroyed() || typeof ask?.do !== "string") return;
        if (ask.do === "add") push(editor.webContents, "menu", { cmd: "add-extension" });
        else if (ask.do === "install" && typeof ask.extension === "string") push(editor.webContents, "menu", { cmd: "add-extension", extension: ask.extension });
        else if (ask.do === "remove" && typeof ask.extension === "string") push(editor.webContents, "menu", { cmd: "remove-extension", extension: ask.extension });
        // Update... is a project step when a project is open; with none, only this machine changes, here.
        else if (ask.do === "update" && typeof ask.extension === "string") {
          if (deps.session()) push(editor.webContents, "menu", { cmd: "update-extension", extension: ask.extension });
          else void updateExtension(ask.extension);
        }
      });
      ipc.handle("extensions:setPin", (_event, on) => {
        deps.store().window("extensions").setPinned(on === true);
        pinToolWindow(deps.windows?.().get("extensions"), deps.editor(), on === true);
      });
      ipc.handle("extensions:close", () => { deps.windows?.().get("extensions")?.close(); });

      // Remove from Project: refused while another extension the project takes needs it, asked first with how
      // much data it has, then one undo step that keeps the data (D2).
      ipc.handle("extension:remove", async (_event, id) => {
        const session = deps.session();
        if (!session || typeof id !== "string") return null;
        const plan = planProjectRemoval(id, takenExtensions(session));
        if (!plan.ok) return { error: plan.why };
        const { name } = plan;
        const dir0 = session.loaded.dir;
        const role = refuseWrite(readRemote(dir0)?.role, [join(dir0, session.loaded.source?.path ?? ""), manifestPath(dir0, id)]);
        if (role !== undefined) return { error: `This project came from a server with an author's key, and removing an extension is the designer's to do, so nothing was removed.` };
        const n = extensionDataCount(session, id);
        const data = n > 0
          ? `${name} has data in ${n} ${n === 1 ? "place" : "places"} in this project. It stays, unused, and comes back into use if you add ${name} again.`
          : `Nothing in this project has ${name} data yet.`;
        const go = await ask(`Remove ${name} from this project?`, `${data} Its views stay installed on this machine. You can undo this.`, [`Remove ${name}`, "Cancel"]);
        if (go !== 0) return null;
        const result = await serialised(() => (deps.session() === session ? removeExtension(session, id) : { error: "The project changed meanwhile, so it wasn't removed." }));
        await refresh(true); // its views go from the Window menu, and an open one closes
        return result;
      });

      // Uninstall: one version of an extension's views, off this machine, asked first (D3 to D5). Not a project
      // step, so no undo: Add (or Install on this machine) brings it back.
      ipc.handle("extension:uninstall", async (_event, id, version) => {
        if (typeof id !== "string" || typeof version !== "string") return;
        const mine = (await installedExtensions(dir())).filter((i) => i.id === id);
        const at = mine.find((i) => i.version === version);
        const editor = deps.editor();
        if (!at || !editor || editor.isDestroyed()) return;
        const name = at.manifest.name || id;
        const taken = takenExtensions(deps.session()).some((t) => t.id === id);
        const last = mine.length === 1;
        const detail = [
          ...(taken ? [`This project takes ${name}${last ? ", so its views will show as not installed until you install them again" : ""}.`] : []),
          "Other projects on this machine that use this version lose its views too.",
          last ? `${name}'s views keep their own settings on this machine, and those go too.` : "The other installed versions keep their views' settings.",
        ].join(" ");
        if (await ask(`Uninstall ${name} ${version} from this machine?`, detail, [`Uninstall ${version}`, "Cancel"]) !== 0) return;
        // Its windows close before its files go: a view left open would run on what's being removed.
        for (const [key, view] of [...open]) if (key.startsWith(viewWindowKey(id, ""))) { open.delete(key); view.close(); }
        await uninstallViews(dir(), id, version);
        await refresh(true);
        void sendExtensions();
      });

      // Add Extension...: the one way in. An extension the project doesn't take goes in (its manifest and pin, as
      // one undo step, with any it requires that the project lacks); for one it takes, a newer package is offered
      // and an older one never taken; either way its views install on this machine. With `expect` (a view "(not
      // installed)..." in the Window menu), only that extension's package will do. Installed first: an install
      // that fails leaves the project as it was, where a project that took the extension with nothing installed
      // would offer views that can't open.
      ipc.handle("extension:add", async (_event, expect) => {
        const session = deps.session();
        if (!session) return { error: "Open a project first." };
        const pins = session.loaded.source?.project.extensions ?? {};
        const wanted = typeof expect === "string" ? offered.find((v) => v.extension === expect) : undefined;
        const wantedName = wanted?.extensionName ?? (typeof expect === "string" ? expect : "");
        const path = typeof expect === "string"
          ? await pickPackage(`Install ${wantedName}`, `Choose ${wantedName}'s package: its folder, or a .tgz file made by npm pack.`)
          : await pickPackage("Add an extension", "Choose the extension's package: its folder, or a .tgz file made by npm pack.");
        if (path === null) return null;
        const pkg = await packageAt(path);
        if ("error" in pkg) return pkg;
        const refused = typeof expect === "string" ? installRefusal(pkg, expect, wantedName) : packageRefusal(pkg);
        if (refused !== undefined) return { error: refused };
        const name = pkg.manifest.name;
        const taken = Object.keys(pins);
        const plan = planPackageAdd(pkg.manifest, Object.entries(pins).map(([id, pin]) => ({ id, ...(pin.version !== undefined ? { pin: pin.version } : {}) })));
        let take = plan.project === "take";
        if (plan.project === "update") {
          take = await ask(`Update ${name} in this project?`,
            `This project takes ${name}${plan.pinned ? ` ${plan.pinned}` : ""}, and this package is ${plan.version}. Updating takes it into the project as one step you can undo. Its views are installed on this machine either way.`,
            [`Update to ${plan.version}`, "Not Now"]) === 0;
        }
        // What it requires and the project lacks goes in with it, in the same step, or nothing does.
        let required: ExtensionPackage[] = [];
        if (take && plan.missing.length > 0) {
          const got = await requirementsFor(pkg, plan.missing, taken);
          if (got === null || "error" in got) return got;
          required = got;
        }
        if (take) {
          // A project that may not take it (an author's key: the project file is the designer's) installs nothing.
          const dir0 = session.loaded.dir;
          const role = refuseWrite(readRemote(dir0)?.role, [join(dir0, session.loaded.source?.path ?? ""), ...[...required, pkg].map((p) => manifestPath(dir0, p.manifest.id))]);
          if (role !== undefined) return { error: `This project came from a server with an author's key, and adding an extension is the designer's to do, so nothing was added.` };
        }
        for (const p of [...required.filter((r) => viewsFor(r.manifest, "storylets").length > 0), pkg]) {
          const installed = await installExtensionPackage(p, dir());
          if (!installed.ok) return { error: installed.why };
        }
        if (!take) {
          await refresh(true);
          return { installed: pkg.manifest.version, name, ...(plan.note ? { note: plan.note } : {}) };
        }
        const items = [...required, pkg].map((p) => ({ manifest: p.manifest, text: new TextDecoder().decode(p.files.get(`${p.manifest.id}${MANIFEST_FILE_SUFFIX}`)!) }));
        const result = await serialised(() => (deps.session() === session ? addExtension(session, items) : { error: "The project changed meanwhile, so it wasn't added." }));
        await refresh(true);
        // Installed all the same: say so, since the views are now on this machine for the next try.
        if ("error" in result) return { error: `${result.error} ${name}'s views were installed on this machine.` };
        return result;
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
        pinTo: () => deps.editor(), pinned: slice.pinned(), onPin: (on) => slice.setPinned(on), remember: (bounds) => slice.remember(bounds),
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
