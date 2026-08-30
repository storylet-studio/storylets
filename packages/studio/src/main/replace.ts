// ---------------------------------------------------------------------------
// The Find window's Property and Replace tabs, main side. Both are thin over
// the ops: property usage is a read; a replace is previewed as a read and
// applied through `commit`, the one mutation path, so it is ONE undo step
// (Patterpad's applyReplace is one VC commit for the same reason), the files
// are written canonically, and the project is re-read and re-validated after.
// ---------------------------------------------------------------------------

import { runPropertyUsage, runPropertyUsageMany, runReplace } from "@storylet-studio/ops";
import type { PropertyUsage, ReplaceHit, ReplaceOptions } from "@storylet-studio/ops";
import { commit } from "./mutate.js";
import type { ProjectSession } from "./project.js";
import type { OpenResult } from "../shared/api.js";

/** Every read and write of the property `query` names. A query that is not a
 *  ref, or a project that does not compile, is no hits rather than an error:
 *  the window shows "nothing matches" either way. */
export function propertyUsage(session: ProjectSession, query: string): PropertyUsage[] {
  if (!query.trim()) return [];
  return runPropertyUsage(session.loaded, query);
}

/** The same for several properties at once, compiling the project once rather
 *  than once per query. The Story page asks for a count beside every declared
 *  `@story` property, and one call per property meant one compile per property
 *  with the main process blocked for all of them. */
export function propertyUsageMany(session: ProjectSession, queries: string[]): PropertyUsage[][] {
  return runPropertyUsageMany(session.loaded, queries.map((q) => q.trim()));
}

/** The hits a Replace-all would make: no writes. Capped like Patterpad's, so a
 *  one-letter query does not ship the whole project to the window. */
export function replacePreview(session: ProjectSession, opts: ReplaceOptions): { hits: ReplaceHit[]; items: number } {
  if (!opts.query.trim()) return { hits: [], items: 0 };
  const plan = runReplace(session.loaded, opts);
  return { hits: plan.hits.slice(0, 500), items: plan.items };
}

let replaceCounter = 0;

/** Apply: every touched shard in one commit, one undo step. The caller has
 *  had the editor flush its pending edits first, so nothing in the air is
 *  lost or overwritten. */
export function applyReplace(session: ProjectSession, opts: ReplaceOptions): (OpenResult & { count: number; items: number }) | { error: string } {
  if (!opts.query.trim()) return { error: "nothing to find" };
  const plan = runReplace(session.loaded, opts);
  if (plan.writes.length === 0) return { error: "nothing matches" };
  const result = commit(session, `Replace "${opts.query}"`, `replace:${replaceCounter++}`,
    plan.writes.map((w) => ({ path: w.path, content: w.content })));
  if ("error" in result) return result;
  return { ...result, count: plan.hits.length, items: plan.items };
}
