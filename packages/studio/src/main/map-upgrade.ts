// ---------------------------------------------------------------------------
// Upgrade a project from before the project map, in the app.
//
// The compiler refuses a box group still marked as a map (E2) and names
// `storyletengine format`, which an author in Storyletter has no way to run; the
// map then vanishes from the editor, because a box group is no longer drawn as
// one. So the app offers the move itself (design/project-map-contract.md 4.2:
// "Storyletter offers the same planner when it opens an old project"): the SAME
// planner the CLI runs, `runFormat` in ops, shown before it is applied and
// refused in its own sentences when it cannot be.
//
// Patterpad has no analogue to follow here. Its older formats are folded on
// read (`bool` to `boolean`, a flat status list to objects) and written back on
// the next save, silently, because those folds are lossless one-file renames
// that can never refuse. This one restructures several files, moves pictures,
// and refuses projects whose copies disagree, so it is asked for, not assumed.
//
// ONE UNDO STEP. Every shard the move writes or deletes goes through `commit`,
// which records the whole set as one history entry, exactly as a merged pack's
// or a deleted box's writes are. The pictures are the exception, as they are
// for Add a background (mutate.ts `addBackground`): bytes are not in the undo
// history, so they are COPIED to the project's assets folder rather than moved,
// and the box's own copies are left where they were. Undo then puts the old
// shards back and the old map finds its pictures where it always did; the
// copies at the root are harmless orphans until the redo needs them again.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { writeBinaryFile } from "@wildwinter/simple-vc-lib";
import { loadProject, planProjectMapMigration, runFormat } from "@storylet-studio/ops";
import type { MapUpgradeDto, OpenResult } from "../shared/api.js";
import type { FileState } from "./history.js";
import { commit } from "./mutate.js";
import type { ProjectSession } from "./project.js";

/**
 * What the upgrade would do to the open project, or undefined when the project
 * needs none (already on the project map, nothing stray in its boxes). Read
 * fresh from disk, as validation is, so a hand edit since the last load counts.
 */
export function planMapUpgrade(session: ProjectSession): MapUpgradeDto | undefined {
  const loaded = loadProject(session.loaded.dir);
  if (loaded.source === undefined) return undefined;
  const plan = planProjectMapMigration(loaded.dir, loaded.source);
  const refusals = plan.issues.filter((i) => i.severity === "error").map((i) => i.message);
  if (plan.writes.size === 0 && refusals.length === 0) return undefined;
  return {
    report: plan.report,
    warnings: plan.issues.filter((i) => i.severity === "warning").map((i) => i.message),
    refusals,
  };
}

/**
 * Run the upgrade: `format` as the CLI runs it, one undo step. Refused, it
 * writes nothing and returns the planner's sentences.
 */
export function upgradeProjectMap(session: ProjectSession): OpenResult | { error: string } | { refused: string[] } {
  const loaded = loadProject(session.loaded.dir);
  if (loaded.source === undefined) return { error: "the project could not be read" };
  const result = runFormat(loaded);
  const refused = result.issues.filter((i) => i.severity === "error").map((i) => i.message);
  if (refused.length > 0) return { refused };
  if (result.migrated.length === 0) return { error: "this project is already on the project map" };

  // The pictures first, as the CLI does, so no shard names a picture at its new
  // address before it is there.
  for (const move of result.moved) {
    if (existsSync(move.to)) continue;
    // The VC layer's binary write makes no folders (its text batch does), and a
    // project from before the project map has no assets folder at its root.
    try { mkdirSync(dirname(move.to), { recursive: true }); } catch { /* said below */ }
    const written = writeBinaryFile(move.to, readFileSync(move.from));
    if (!written.success) return { error: `could not copy ${basename(move.from)} to the project's assets folder` };
  }
  const states: FileState[] = [
    ...result.changed.map((w) => ({ path: w.path, content: w.content })),
    ...result.removed.map((path) => ({ path, content: null })),
  ];
  session.loaded = loaded;
  return commit(session, "Upgrade the project", "upgrade-project-map", states);
}
