// ---------------------------------------------------------------------------
// The format op: rewrite shards to the canonical byte form (source doc
// section 8). Pure planned writes; `--check` mode is the caller reading
// `changed` without committing.
//
// It also carries the ONE migration a formatter is allowed to carry: a box map
// still living in its view shard is moved into `map.storyletmap`
// (design/engine-server.md 9.1 point 5). Canonical form is what this op is for,
// and where a value BELONGS is part of that; putting it here is also what lets
// the compiler's warning name a single command instead of describing a hand
// edit, which nobody should ever do to a shard.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { Issue } from "@storylet-studio/compiler";
import type { LoadedProject } from "./load.js";
import { planMapMigration } from "./map.js";
import type { PlannedWrite } from "./write.js";

export interface FormatResult {
  /** Shards whose bytes are not canonical, with their canonical content. */
  changed: PlannedWrite[];
  /** Absolute paths of shards the format DELETES: a view shard that held
   *  nothing but a map, once the map has moved out. Emptied to its schema it
   *  would be a file saying nothing, and the project format's rule is that a
   *  shard exists because it has something in it. */
  removed: string[];
  issues: Issue[];
}

export function runFormat(loaded: LoadedProject): FormatResult {
  const changed: PlannedWrite[] = [];
  const removed: string[] = [];
  const issues: Issue[] = [];

  // The migration first, so a moved map is canonicalised by the same pass that
  // moved it rather than left for the next one.
  const migrated = new Map<string, string>();
  for (const box of loaded.source?.boxes ?? []) {
    for (const write of planMapMigration(loaded.dir, box)) migrated.set(write.path, write.content);
  }

  for (const file of loaded.files) {
    const path = join(loaded.dir, file.path);
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
  // Whatever is left is a file the migration CREATES: the new map shard.
  for (const [path, content] of migrated) changed.push({ path, content });

  return { changed, removed, issues };
}

/** The same shard with nothing in it but its schema: what "this file now says
 *  nothing" looks like, compared by canonical bytes rather than by counting
 *  keys, so it stays true if a shard ever grows a second required field. */
function emptyOf(content: string): Record<string, unknown> {
  const parsed = parseSource(content) as Record<string, unknown>;
  return { schema: parsed["schema"] };
}
