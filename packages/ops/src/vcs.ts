// ---------------------------------------------------------------------------
// Version control: what this format's files are, for the family's shared
// setup (`@wildwinter/toolkit/vcs`, lifted from Patter: patterkit
// design/family-parity-2026-10.md item 13), and the plans `init`, the CLI and
// Storyletter's Project Settings write from it. Git, Perforce, Plastic SCM and
// SVN, each with its ignore file and its section of `vcs-setup.md`.
//
// Pure planned writes, as the rest of ops: the caller commits them.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { BUNDLE_EXTENSION, EXTENSIONS_DIR, MANIFEST_EXTENSION, SHARD_EXTENSIONS } from "@storylet-studio/model";
import type { VcsKind } from "@storylet-studio/model";
import { VCS_KINDS, bundlePostureOf, vcsConfigFiles } from "@wildwinter/toolkit/vcs";
import type { BundlePosture, VcsFormat, VcsKind as ToolkitVcsKind } from "@wildwinter/toolkit/vcs";
import { CONFLICT_SIDECAR_EXTENSION } from "./merge.js";
import { PACK_EXTENSION } from "./pack.js";
import type { PlannedWrite } from "./write.js";

export { VCS_KINDS, VCS_LABELS, isVcsKind, runMergetool } from "@wildwinter/toolkit/vcs";
export type { BundlePosture, MergetoolOptions } from "@wildwinter/toolkit/vcs";

// The model spells the list out rather than depend on the toolkit; these two
// lines fail to compile the day the two lists stop being the same one.
const sameKinds: readonly VcsKind[] = VCS_KINDS;
const sameKindsBack = (k: VcsKind): ToolkitVcsKind => k;
void sameKinds; void sameKindsBack;

const bare = (ext: string): string => ext.replace(/^\./, "");

/** A project's `vcs` as a system to set up for: none for `"none"` and for not chosen. */
export const systemOf = (vcs: VcsKind | "none" | undefined): VcsKind | undefined => (vcs === "none" ? undefined : vcs);

/** This format, as the shared setup describes one. */
export const STORYLETS_VCS_FORMAT: VcsFormat = {
  product: "Storylet Studio",
  tool: "storyletengine",
  driver: "storylets",
  source: Object.values(SHARD_EXTENSIONS).map(bare),
  manifest: { dir: EXTENSIONS_DIR, suffix: MANIFEST_EXTENSION },
  bundle: bare(BUNDLE_EXTENSION),
  pack: bare(PACK_EXTENSION),
  conflict: bare(CONFLICT_SIDECAR_EXTENSION),
  binary: [{
    pattern: "assets/**",
    note: "Background images (an orientation aid on a map): bytes, so nothing should ever\n"
      + "try to diff, merge or normalise line endings in one. Plain git is fine for a\n"
      + "few MB of floor plan; if yours grow, git-lfs is the escape hatch and nothing\n"
      + "here depends on it.",
  }],
};

/** Is this path a storylets source shard (what `mergetool` sends to the structured merge)? */
export const isStoryletSource = (path: string): boolean =>
  Object.values(SHARD_EXTENSIONS).some((ext) => path.endsWith(ext));

/** The setup files for `vcs` in the project folder `dir`: the guide always, git's attributes, the ignore file. */
export function vcsConfigWrites(dir: string, vcs: VcsKind | undefined, bundle: BundlePosture = "commit"): PlannedWrite[] {
  return vcsConfigFiles(STORYLETS_VCS_FORMAT, vcs, bundle).map((f) => ({ path: join(dir, f.path), content: f.content }));
}

/** Whether the project in `dir` was set up to commit or to ignore its bundle, read from the files `vcs` wrote. */
export function currentBundlePosture(dir: string, vcs: VcsKind | undefined): BundlePosture {
  return bundlePostureOf(STORYLETS_VCS_FORMAT, vcs, (path) => {
    try { return readFileSync(join(dir, path), "utf8"); } catch { return undefined; }
  });
}

/**
 * Moving a project from one system to another (or to none): the new system's
 * files to write, carrying the bundle posture the old one was set up with, and
 * the old system's files the new one does not have, to remove so a switched
 * project never carries stale setup. `vcs-setup.md` is kept either way: it is
 * rewritten for a real system and left as it is for none. Patterpad's Project
 * Settings switch, as a plan.
 */
export function vcsSwitchPlan(
  dir: string, fromSetting: VcsKind | "none" | undefined, toSetting: VcsKind | "none" | undefined,
): { writes: PlannedWrite[]; removes: string[] } {
  const from = systemOf(fromSetting), to = systemOf(toSetting);
  if (from === to) return { writes: [], removes: [] };
  const writes = to !== undefined ? vcsConfigWrites(dir, to, currentBundlePosture(dir, from)) : [];
  const keep = new Set([join(dir, "vcs-setup.md"), ...writes.map((w) => w.path)]);
  const removes = from !== undefined ? vcsConfigWrites(dir, from).map((w) => w.path).filter((p) => !keep.has(p)) : [];
  return { writes, removes };
}
