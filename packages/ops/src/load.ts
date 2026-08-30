// ---------------------------------------------------------------------------
// Project resolution + loading for the ops layer: given any path (the
// project folder, a shard inside it, or a folder above it is NOT searched -
// discovery walks UP, source doc section 2), find the `.storylets` project
// and parse it.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { SHARD_EXTENSIONS } from "@storylet-studio/model";
import { loadProjectFiles, parseProjectFiles, walkProjectFiles } from "@storylet-studio/compiler";
import type { Issue, SourceFile, SourceProject } from "@storylet-studio/compiler";
import { CONFLICT_SIDECAR_EXTENSION } from "./merge.js";

const hasProjectShard = (dir: string): boolean => {
  try {
    return readdirSync(dir).some((f) => f.endsWith(SHARD_EXTENSIONS.project));
  } catch {
    return false;
  }
};

/** Walk up from `path` (a file or directory) to the project folder - the
 *  nearest ancestor holding a `*.storyletproj`. */
export function findProjectDir(path: string): string | undefined {
  let dir = resolve(path);
  if (existsSync(dir) && !statSync(dir).isDirectory()) dir = dirname(dir);
  for (;;) {
    if (hasProjectShard(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface LoadedProject {
  dir: string;
  files: SourceFile[];
  source?: SourceProject;
  issues: Issue[];
  /** Unresolved merge sidecars (`*.storyletconflict`) found in the project -
   *  each is a validate error until resolved and deleted. */
  sidecars: string[];
}

/** Find unresolved merge sidecars under a project folder (project-relative paths). */
export function findConflictSidecars(dir: string): string[] {
  return walkProjectFiles(dir, [CONFLICT_SIDECAR_EXTENSION])
    .map((full) => relative(dir, full).split("\\").join("/"))
    .sort();
}

/** Load and parse the project at (or above) `path`. */
export function loadProject(path = "."): LoadedProject {
  const dir = findProjectDir(path);
  if (!dir) {
    return {
      dir: resolve(path),
      files: [],
      issues: [{ severity: "error", path: resolve(path), message: "no .storylets project here or above (no *.storyletproj found)" }],
      sidecars: [],
    };
  }
  const files = loadProjectFiles(dir);
  const { project, issues } = parseProjectFiles(files);
  return { dir, files, ...(project !== undefined ? { source: project } : {}), issues, sidecars: findConflictSidecars(dir) };
}
