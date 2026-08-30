// ---------------------------------------------------------------------------
// The format op: rewrite shards to the canonical byte form (source doc
// section 8). Pure planned writes; `--check` mode is the caller reading
// `changed` without committing.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { Issue } from "@storylet-studio/compiler";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";

export interface FormatResult {
  /** Shards whose bytes are not canonical, with their canonical content. */
  changed: PlannedWrite[];
  issues: Issue[];
}

export function runFormat(loaded: LoadedProject): FormatResult {
  const changed: PlannedWrite[] = [];
  const issues: Issue[] = [];
  for (const file of loaded.files) {
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
      changed.push({ path: join(loaded.dir, file.path), content: canonical });
    }
  }
  return { changed, issues };
}
