// ---------------------------------------------------------------------------
// The export op: compile a loaded project to its bundle, as a planned write
// at the project's declared output path (or a caller override).
// ---------------------------------------------------------------------------

import { sidecarIssues } from "./merge.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { compileProject, serialiseBundle } from "@storylet-studio/compiler";
import type { Issue } from "@storylet-studio/compiler";
import { BUNDLE_EXTENSION, backgroundsOf, bundleAssetPath, effectiveGameId, isSpatial } from "@storylet-studio/model";
import type { Bundle } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";
import { assetPath } from "./assets.js";
import type { PlannedBinaryWrite, PlannedWrite } from "./write.js";

export interface ExportResult {
  issues: Issue[];
  bundle?: Bundle;
  /** The bundle write (absent when compilation failed or `-o -` asked for stdout). */
  write?: PlannedWrite;
  /** The serialised bundle (for stdout output). */
  text?: string;
  /**
   * The background files the bundle refers to, ready to sit beside it.
   *
   * Empty unless the project (or the caller) asked for maps. Bytes, not text,
   * and separate from `write` for the reason `PlannedBinaryWrite` exists at all:
   * a caller must decide what to do with bytes rather than have them handed to
   * something built for shards.
   */
  assets: PlannedBinaryWrite[];
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
 *  the project folder. */
export function bundleOutputPath(loaded: LoadedProject): string {
  const declared = loaded.source?.project.export?.bundle ?? `dist/bundle${BUNDLE_EXTENSION}`;
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
  if (!loaded.source) return [];
  const root = dirname(bundlePath);
  const writes: PlannedBinaryWrite[] = [];
  const seen = new Set<string>();

  for (const box of loaded.source.boxes) {
    const boxGameId = effectiveGameId(box.box.box);
    for (const group of box.tags.groups) {
      if (!isSpatial(group)) continue;
      for (const background of backgroundsOf(group)) {
        if (background.hidden === true) continue;   // not shipped, so not copied
        const rel = bundleAssetPath(boxGameId, background.file);
        if (seen.has(rel)) continue;                // two maps may share a picture
        const from = assetPath(loaded.dir, box, background.file);
        if (from === undefined || !existsSync(from)) continue;
        seen.add(rel);
        writes.push({ path: join(root, rel), bytes: readFileSync(from) });
      }
    }
  }
  return writes;
}

export function runExport(loaded: LoadedProject, out?: string, opts: ExportOptions = {}): ExportResult {
  if (!loaded.source) return { issues: loaded.issues, assets: [] };
  // An unresolved merge must not reach a bundle: the merged model is valid
  // canonical source with conflicted values resolved PROVISIONALLY to ours, so
  // exporting it ships somebody's discarded edit as though it were agreed.
  // merge.ts has said so since it was written; only validate enforced it.
  const unresolved = sidecarIssues(loaded.sidecars);
  if (unresolved.length > 0) return { issues: [...loaded.issues, ...unresolved], assets: [] };

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
  if (!bundle) return { issues: all, assets: [] };
  const text = serialiseBundle(bundle);
  if (out === "-") return { issues: all, bundle, text, assets: [] };

  const path = out ?? bundleOutputPath(loaded);
  return {
    issues: all,
    bundle,
    text,
    write: { path, content: text },
    assets: bundle.maps !== undefined ? mapAssets({ ...loaded, source }, path) : [],
  };
}
