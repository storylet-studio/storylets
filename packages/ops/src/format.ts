// ---------------------------------------------------------------------------
// The format op: rewrite shards to the canonical byte form (source doc
// section 8). Pure planned writes; `--check` mode is the caller reading
// `changed` without committing.
//
// It also carries the migrations a formatter is allowed to carry, both about
// where a value BELONGS, which is part of canonical form:
//
//   - a box map still living in its view shard is moved into `map.storyletmap`
//     (design/engine-server.md 9.1 point 5)
//   - per-box map groups are collapsed into the one PROJECT MAP at the root,
//     or refused with a sentence per difference (design/project-map-contract.md
//     4.2; project-map-migration.ts)
//
// Putting them here is what lets the compiler's warnings and errors name a
// single command instead of describing a hand edit, which nobody should ever do
// to a shard.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { Issue } from "@storylet-studio/compiler";
import type { LoadedProject } from "./load.js";
import { planMapMigration } from "./map.js";
import { planProjectMapMigration } from "./project-map-migration.js";
import type { PlannedMove } from "./project-map-migration.js";
import type { PlannedWrite } from "./write.js";

export interface FormatResult {
  /** Shards whose bytes are not canonical, with their canonical content. */
  changed: PlannedWrite[];
  /** Absolute paths of shards the format DELETES: a view shard that held
   *  nothing but a map, once the map has moved out, or a box map shard that
   *  held nothing but frames, once they have moved to the project map. Emptied
   *  to its schema it would be a file saying nothing, and the project format's
   *  rule is that a shard exists because it has something in it. */
  removed: string[];
  /** Files the format MOVES rather than rewrites: the project map's pictures,
   *  from a box's `assets/` to the project's (design/project-map-contract.md
   *  4.2 step 8). Bytes, which a `PlannedWrite` cannot carry; the caller moves
   *  them after committing `changed`. */
  moved: PlannedMove[];
  /** What a migration did, a line each, for a person reading the output.
   *  Empty when nothing migrated. */
  migrated: string[];
  issues: Issue[];
}

export function runFormat(loaded: LoadedProject): FormatResult {
  // No project here at all: the loader's error, not "all shards canonical"
  // over a folder that has none (ruling M, 2026-10-06). A project whose files
  // fail to load in other ways is still formatted, file by file: the caller
  // prints its load issues.
  if (loaded.source === undefined && loaded.files.length === 0) {
    return { changed: [], removed: [], moved: [], migrated: [], issues: loaded.issues.filter((i) => i.severity === "error") };
  }
  const changed: PlannedWrite[] = [];
  const removed: string[] = [];
  const issues: Issue[] = [];

  // The migrations first, so a moved value is canonicalised by the same pass
  // that moved it rather than left for the next one. The project map's goes
  // first and, when it plans anything, wholly replaces the view-to-map move: it
  // moves every box's map itself, view shard and all, and two planners writing
  // one file would leave the second to undo the first.
  const projectMap = loaded.source !== undefined
    ? planProjectMapMigration(loaded.dir, loaded.source)
    : undefined;
  if (projectMap !== undefined) issues.push(...projectMap.issues);
  if (issues.some((i) => i.severity === "error")) {
    return { changed: [], removed: [], moved: [], migrated: [], issues };
  }
  const migrated = new Map<string, string>(projectMap?.writes ?? []);
  if (migrated.size === 0) {
    for (const box of loaded.source?.boxes ?? []) {
      for (const write of planMapMigration(loaded.dir, box)) migrated.set(write.path, write.content);
    }
  }
  const dropped = new Set(projectMap?.removed ?? []);

  for (const file of loaded.files) {
    const path = join(loaded.dir, file.path);
    if (dropped.has(path)) { removed.push(path); continue; }
    const moved = migrated.get(path);
    if (moved !== undefined) {
      migrated.delete(path);
      // A view shard whose only content was the map is deleted rather than left
      // holding a schema tag and nothing else.
      if (moved === canonicalStringify(emptyOf(moved))) { removed.push(path); continue; }
      if (moved !== file.text) changed.push({ path, content: moved });
      continue;
    }
    let canonical: string;
    try {
      canonical = canonicalStringify(parseSource(file.text));
    } catch (e) {
      issues.push({
        severity: "error", path: file.path,
        message: `unparseable JSON5: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }
    if (canonical !== file.text) {
      changed.push({ path, content: canonical });
    }
  }
  // Whatever is left is a file a migration CREATES: a new map shard, the
  // project map, the project's own notes.
  for (const [path, content] of migrated) changed.push({ path, content });

  return { changed, removed, moved: projectMap?.moved ?? [], migrated: projectMap?.report ?? [], issues };
}

/** The same shard with nothing in it but its schema: what "this file now says
 *  nothing" looks like, compared by canonical bytes rather than by counting
 *  keys, so it stays true if a shard ever grows a second required field. */
function emptyOf(content: string): Record<string, unknown> {
  const parsed = parseSource(content) as Record<string, unknown>;
  return { schema: parsed["schema"] };
}
