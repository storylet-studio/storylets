// ---------------------------------------------------------------------------
// The export op: compile a loaded project to its bundle, as a planned write
// at the project's declared output path (or a caller override).
// ---------------------------------------------------------------------------

import { sidecarIssues } from "./merge.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, basename } from "node:path";
import { compileProject, serialiseBundle } from "@storylet-studio/compiler";
import type { Issue } from "@storylet-studio/compiler";
import { BUNDLE_EXTENSION, PROJECT_FOLDER_EXTENSION, backgroundsOf, bundleAssetPath } from "@storylet-studio/model";
import type { Bundle } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";
import { assetPath } from "./assets.js";
import { planStoryletsScopes } from "./game-scopes.js";
import type { PlannedBinaryWrite, PlannedFileWrite } from "./write.js";

export interface ExportResult {
  issues: Issue[];
  bundle?: Bundle;
  /** The serialised bundle (for stdout output). */
  text?: string;
  /** Where the bundle goes (absent when compilation failed or `-o -` asked for stdout). */
  path?: string;
  /**
   * Everything the export writes, in the order to write it, for the caller to
   * commit as it stands (the CLI and Storyletter used to order these three
   * themselves, and differently):
   *
   * 1. The background files the bundle refers to, beside it. Empty unless the
   *    project (or the caller) asked for maps. Bytes, not text, for the reason
   *    `PlannedBinaryWrite` exists at all: a caller must decide what to do with
   *    bytes rather than have them handed to something built for shards. First,
   *    so a bundle never lands naming pictures that failed to.
   * 2. The bundle.
   * 3. The Storylet Engine's file in the game's shared scopes folder
   *    (`game-scopes/storylets.scopes.json`), when the project has a folder and
   *    the file does not already say what the project would write (patterkit
   *    design/shared-scopes.md). Never when there is no folder: creating one is
   *    an explicit act.
   *
   * Empty for stdout, which skips the pictures and the scopes file.
   */
  writes: PlannedFileWrite[];
}

export interface ExportOptions {
  /**
   * Carry the maps, overriding the project's `export.map`.
   *
   * A per-export override for the same reason packing has one: a build is a
   * delivery, and the one going to a level editor may want the map when the one
   * going to a shipping branch does not.
   */
  map?: boolean;
}

/** The bundle output path: the project's `export.bundle`, resolved against
 *  the project folder; when the project pins none, a sibling `storylet-dist/`
 *  folder named after the project, never a path inside it (the folder is the
 *  document). Patterpad's `../patter-dist/<name>.patterc`, name for name. */
export function bundleOutputPath(loaded: LoadedProject): string {
  const stem = basename(loaded.dir).replace(new RegExp(`${PROJECT_FOLDER_EXTENSION.replace(".", "\\.")}$`), "");
  const declared = loaded.source?.project.export?.bundle ?? `../storylet-dist/${stem}${BUNDLE_EXTENSION}`;
  return isAbsolute(declared) ? declared : join(loaded.dir, declared);
}

/**
 * The picture files a shipped map needs, copied next to the bundle.
 *
 * Paths come from `bundleAssetPath`, the same function the compiler wrote into
 * the bundle, so the name in the JSON and the file on disk cannot drift.
 *
 * A file that is not there is SKIPPED rather than fatal. Validation already
 * reports a missing background by name, and refusing to export a whole project
 * over one absent picture would be a poor trade for a payload the engine does
 * not even read.
 */
function mapAssets(loaded: LoadedProject, bundlePath: string): PlannedBinaryWrite[] {
  const group = loaded.source?.map?.group;
  if (group === undefined) return [];
  const root = dirname(bundlePath);
  const writes: PlannedBinaryWrite[] = [];
  const seen = new Set<string>();
  for (const background of backgroundsOf(group)) {
    if (background.hidden === true) continue;   // not shipped, so not copied
    const rel = bundleAssetPath(background.file);
    if (seen.has(rel)) continue;                // two backgrounds may share a picture
    const from = assetPath(loaded.dir, background.file);
    if (from === undefined || !existsSync(from)) continue;
    seen.add(rel);
    writes.push({ path: join(root, rel), bytes: readFileSync(from) });
  }
  return writes;
}

export function runExport(loaded: LoadedProject, out?: string, opts: ExportOptions = {}): ExportResult {
  // A load error refuses (ruling M, 2026-10-06). The loader drops what it
  // cannot read and carries on, so one unparseable deck used to leave its cards
  // out of a bundle that shipped with exit 0, and Live Link pushed the same
  // gutted build into a running game. A warning still exports.
  if (!loaded.source || loaded.issues.some((i) => i.severity === "error")) return { issues: loaded.issues, writes: [] };
  // An unresolved merge must not reach a bundle: the merged model is valid
  // canonical source with conflicted values resolved PROVISIONALLY to ours, so
  // exporting it ships somebody's discarded edit as though it were agreed.
  // merge.ts has said so since it was written; only validate enforced it.
  const unresolved = sidecarIssues(loaded.sidecars);
  if (unresolved.length > 0) return { issues: [...loaded.issues, ...unresolved], writes: [] };

  // The override is applied to the source the compiler sees, so there is one
  // rule about what a bundle carries and it lives in the compiler.
  const source = opts.map === undefined
    ? loaded.source
    : {
      ...loaded.source,
      project: { ...loaded.source.project, export: { ...loaded.source.project.export, map: opts.map } },
    };

  const { bundle, issues } = compileProject(source);
  const all = [...loaded.issues, ...issues];
  if (!bundle) return { issues: all, writes: [] };
  const text = serialiseBundle(bundle);
  if (out === "-") return { issues: all, bundle, text, writes: [] };

  const path = out ?? bundleOutputPath(loaded);
  const scopesWrite = planStoryletsScopes(loaded);
  return {
    issues: all,
    bundle,
    text,
    path,
    writes: [
      ...(bundle.map?.geometry !== undefined ? mapAssets({ ...loaded, source }, path) : []),
      { path, content: text },
      ...(scopesWrite !== undefined ? [scopesWrite] : []),
    ],
  };
}
