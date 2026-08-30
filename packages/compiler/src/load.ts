// ---------------------------------------------------------------------------
// The filesystem loader: the thin fs edge of the persistence seam. Reads a
// `.storylets` project folder into SourceFile[] for the pure core
// (parseProjectFiles / compileProject). The hosted shard store feeds the same
// shapes without touching this file.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { SHARD_EXTENSIONS } from "@storylet-studio/model";
import type { SourceFile } from "./project.js";

const SHARD_EXTENSION_LIST = Object.values(SHARD_EXTENSIONS);

/** Read every shard file under a `.storylets` project folder. */
/**
 * Every file under `dir` whose name ends in one of `exts`, absolute, sorted.
 *
 * The one walker. There were three, with three different skip rules: this one
 * and ops' sidecar scan skipped dot-entries, and `pack`'s did not - so a
 * project with a shard inside any dot-directory (an editor backup, a stray
 * `.trash`) packed something that `validate` and `export` had never read. What
 * a pack SHIPS and what the project IS have to be the same set.
 *
 * Dot-entries are skipped, directories and files alike: nothing a tool wrote
 * for itself is authored content.
 */
export function walkProjectFiles(dir: string, exts: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.some((ext) => entry.name.endsWith(ext))) found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

export function loadProjectFiles(dir: string): SourceFile[] {
  const files: SourceFile[] = walkProjectFiles(dir, SHARD_EXTENSION_LIST).map((full) => ({
    path: relative(dir, full).split("\\").join("/"),
    text: readFileSync(full, "utf8"),
  }));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
