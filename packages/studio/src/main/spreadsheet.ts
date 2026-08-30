// ---------------------------------------------------------------------------
// Publish > Publish Spreadsheet: the readable export (the whole project as an
// .xlsx workbook, parity audit 9.5). Main owns the Save dialog and the write,
// as Patterpad's exportReport does; this renders the bytes and suggests where
// they go, from a FRESH load of the files, because the files are the truth
// (exportBundle's rule) and a spreadsheet of a stale session would be the one
// thing a lead reads in a meeting that nobody can check against the editor.
// ---------------------------------------------------------------------------

import { dirname, join } from "node:path";
import { loadProject, runExportXlsx, spreadsheetFileName } from "@storylet-studio/ops";
import type { ProjectSession } from "./project.js";

/** The workbook bytes and the default save path: `<Project name>.xlsx` beside
 *  the project folder, never inside it (it is a delivery, not a shard, and a
 *  sibling of the folder is where a Storyletpack lands too). */
export async function spreadsheetExport(session: ProjectSession): Promise<{ buffer: Buffer; defaultPath: string } | { error: string }> {
  const loaded = loadProject(session.loaded.dir);
  if (!loaded.source) {
    return { error: loaded.issues.map((i) => i.message).join("; ") || "not a storylets project" };
  }
  const { buffer } = await runExportXlsx(loaded.source);
  return { buffer, defaultPath: join(dirname(loaded.dir), spreadsheetFileName(loaded.source)) };
}
