// ---------------------------------------------------------------------------
// Publish > Publish Playable HTML: one self-contained .html that plays the
// project in any browser (parity audit 9.3). Main owns the Save dialog and
// the write, as Patterpad's exportPlayableHtml does; this renders the page
// and suggests where it goes, from a FRESH load of the files, as the
// spreadsheet does and for the same reason: the files are the truth.
// ---------------------------------------------------------------------------

import { dirname, join } from "node:path";
import { loadProject, playableFileName, runExportHtml } from "@storylet-studio/ops";
import type { ProjectSession } from "./project.js";

/** The page text and the default save path: `<Project name>.html` beside the
 *  project folder, never inside it (a delivery, not a shard). */
export function playableExport(session: ProjectSession): { html: string; defaultPath: string } | { error: string } {
  const loaded = loadProject(session.loaded.dir);
  const result = runExportHtml(loaded);
  if (result.html === undefined || !loaded.source) {
    const errors = result.issues.filter((i) => i.severity === "error").map((i) => i.message);
    return { error: errors.join("; ") || "the project does not compile" };
  }
  return { html: result.html, defaultPath: join(dirname(loaded.dir), playableFileName(loaded.source)) };
}
