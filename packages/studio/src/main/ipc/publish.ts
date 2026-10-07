// ---------------------------------------------------------------------------
// Publishing: the bundle, the spreadsheet, the playable page and the pack;
// and the Board's session saves, in and out. Everything written to a place the
// author picks goes through a native picker (design-language: dialogs themed,
// pickers OS) and lands through the VC layer, like every other write.
// ---------------------------------------------------------------------------

import { dialog } from "electron";
import type { BaseWindow, SaveDialogOptions } from "electron";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { writeBinaryFile, writeTextFile } from "@wildwinter/simple-vc-lib";
import { PACK_EXTENSION, runPack } from "@storylet-studio/ops";
import { SAVEFILE_SCHEMA, SAVE_SCHEMA, SAVE_SCHEMA_V1 } from "@storylet-studio/model";
import type { LoadReport, SaveFile } from "@storylet-studio/model";
import { Engine } from "@storylet-studio/runtime";
import { compileBundle, exportBundle } from "../project.js";
import type { ProjectSession } from "../project.js";
import { pinForPublish } from "../pin.js";
import { spreadsheetExport } from "../spreadsheet.js";   // Publish Spreadsheet
import { playableExport } from "../playable.js";   // Publish Playable HTML
import { serialised } from "../mutate/write-path.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";

type VcWrite = ReturnType<typeof writeTextFile>;

/**
 * Ask where, then write there through the VC layer. The one shape of every
 * export that lands a file the author named: the author may well be saving into
 * the project's own repo, so a read-only or locked target is checked out (or
 * its refusal surfaced), not choked on. Null when the picker was cancelled.
 */
async function saveThroughVc(
  parent: BaseWindow, options: SaveDialogOptions, write: (path: string) => VcWrite,
): Promise<{ path: string } | { error: string } | null> {
  const picked = await dialog.showSaveDialog(parent, options);
  if (picked.canceled || !picked.filePath) return null;
  try {
    const res = write(picked.filePath);
    return res.success ? { path: picked.filePath } : { error: res.message || res.status };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * What loading this save into the open project would cost (the engine's
 * LoadReport: cards evicted, properties dropped, defaulted or retyped), for the
 * Board to show with the restore (review 2026-10, item 20). Worked out against
 * the project as it compiles now, without touching any engine the Board runs.
 * A save from another project is refused here, as the load itself would; a
 * project that cannot be stood up headless (it needs another engine's scopes)
 * gives no report rather than refusing a save the Board can load.
 */
function previewSaveLoad(open: ProjectSession, file: SaveFile): { report: LoadReport } | { error: string } | undefined {
  const compiled = compileBundle(open);
  if ("error" in compiled) return undefined;
  let engine: Engine;
  try { engine = new Engine(compiled.bundle); } catch { return undefined; }
  try {
    return { report: engine.previewLoad(file.engine) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function registerPublish(ipc: Ipc, deps: Pick<MainContext, "session" | "editor" | "windows" | "flushEditor" | "runJob">): void {
  // Publish Bundle. The manual one pins first (design/pin-on-publish.md): the
  // editor flushes its pending edits, since one carrying an old empty gameId
  // would otherwise land on top of the pin and undo it, then the pins commit
  // as one undo step, then the export reads the pinned shards, so the
  // bundle's staleness hash matches them. Auto Rebuild passes no `pin`.
  ipc.handle("bundle:export", async (_e, opts) => {
    const s = deps.session();
    if (!s) return { error: "no project open" };
    return deps.runJob("bundle", async () => {
      let pinned = 0;
      if (opts?.pin === true) {
        await deps.flushEditor();
        const pins = await serialised(() => pinForPublish(s));
        if ("error" in pins) return pins;
        pinned = pins.pinned.length;
      }
      const r = exportBundle(s);
      return "error" in r ? r : { ...r, pinned };
    });
  });

  // Publish Spreadsheet: the readable workbook through a Save dialog (Patterpad's
  // exportReport shape: the op hands back bytes, main picks the path and lands
  // them through the VC layer, so a locked target is checked out, not choked on).
  ipc.handle("xlsx:export", async (): Promise<{ path: string } | { error: string } | null> => {
    const s = deps.session();
    if (!s) return { error: "no project open" };
    const out = await deps.runJob("spreadsheet", () => spreadsheetExport(s));
    if ("error" in out) return out;
    return saveThroughVc(deps.editor()!, {
      title: "Publish Spreadsheet",
      defaultPath: out.defaultPath,
      filters: [{ name: "Excel spreadsheet", extensions: ["xlsx"] }],
    }, (path) => writeBinaryFile(path, out.buffer));
  });

  // Publish Playable HTML: one self-contained page through a Save dialog
  // (Patterpad's exportPlayableHtml shape, the spreadsheet's write path).
  ipc.handle("html:export", async (): Promise<{ path: string } | { error: string } | null> => {
    const s = deps.session();
    if (!s) return { error: "no project open" };
    const out = await deps.runJob("playable", async () => playableExport(s));
    if ("error" in out) return out;
    return saveThroughVc(deps.editor()!, {
      title: "Publish Playable HTML",
      defaultPath: out.defaultPath,
      filters: [{ name: "HTML page", extensions: ["html"] }],
    }, (path) => writeTextFile(path, out.html));
  });

  // --- the send envelope (.storyletpack) --------------------------------------
  // A pack is a DELIVERY, not the canonical files, so everything that touches
  // one goes through a file picker: nothing is ever written back to a pack
  // silently, and unpacking always names its own destination (exchange.ts).
  ipc.handle("pack:export", async (): Promise<{ path: string } | { error: string } | null> => {
    const session = deps.session();
    if (!session) return { error: "no project open" };
    const name = session.loaded.source?.project.project.name ?? "project";
    const picked = await dialog.showSaveDialog(deps.editor()!, {
      title: "Export as Storyletpack",
      defaultPath: `${name}${PACK_EXTENSION}`,
      filters: [{ name: "Storyletpack", extensions: ["storyletpack"] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    const dir = deps.session()!.loaded.dir, path = picked.filePath;
    return deps.runJob("pack", async () => {
      try {
        const bytes = await runPack(dir);
        const res = writeBinaryFile(path, bytes);
        return res.success ? { path } : { error: res.message || res.status };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
  });

  // --- the Board's session saves: the .storyletsave round trip ------------------
  ipc.handle("table:bundle", () => {
    const session = deps.session();
    return session ? compileBundle(session) : { error: "no project open" };
  });
  ipc.handle("table:exportSave", (_e, file, suggestedName) =>
    saveThroughVc(deps.windows().get("board") ?? deps.editor()!, {
      title: "Export the session state",
      defaultPath: `${suggestedName || "session"}.storyletsave`,
      filters: [{ name: "Storylets save", extensions: ["storyletsave"] }],
    }, (path) => writeTextFile(path, JSON.stringify(file, null, 2))));
  ipc.handle("table:importSave", async () => {
    const picked = await dialog.showOpenDialog(deps.windows().get("board") ?? deps.editor()!, {
      title: "Import a session state",
      message: "Choose a .storyletsave to load into the Board.",
      buttonLabel: "Import",
      filters: [{ name: "Storylets save", extensions: ["storyletsave"] }],
      properties: ["openFile"],
    });
    const path = picked.filePaths[0];
    if (path === undefined) return null;
    try {
      const file = JSON.parse(readFileSync(path, "utf8")) as SaveFile;
      // What play-helpers' `loadState` accepts, which is what the Board loads it
      // with: a version 1 engine envelope is still read (review 2026-10, item 20).
      if (file?.schema !== SAVEFILE_SCHEMA || (file.engine?.schema !== SAVE_SCHEMA && file.engine?.schema !== SAVE_SCHEMA_V1)) {
        return { error: "not a storylets save file" };
      }
      const session = deps.session();
      const preview = session ? previewSaveLoad(session, file) : undefined;
      if (preview !== undefined && "error" in preview) return preview;
      return { file, name: basename(path, ".storyletsave"), ...(preview !== undefined ? { report: preview.report } : {}) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}
