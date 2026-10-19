// Version control parity with Patter (patterkit design/family-parity-2026-10.md
// item 13): init sets a project up for git, Perforce, Plastic SCM or SVN from
// the family's shared setup, records the choice, and a switch of system
// rewrites the setup and takes the old system's files away.

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseSource } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS } from "@storylet-studio/model";
import type { VcsKind } from "@storylet-studio/model";
import {
  VCS_KINDS, currentBundlePosture, isStoryletSource, runInit, vcsConfigWrites, vcsSwitchPlan,
} from "../src/index.js";

const rel = (dir: string, path: string): string => path.slice(dir.length + 1).replaceAll("\\", "/");
const written = (dir: string, writes: { path: string; content: string }[]): void => {
  for (const w of writes) { mkdirSync(dirname(w.path), { recursive: true }); writeFileSync(w.path, w.content); }
};

describe("init, for each version control system", () => {
  const SETUP: Record<VcsKind, string[]> = {
    git: [".gitattributes", ".gitignore", "vcs-setup.md"],
    perforce: [".p4ignore", "vcs-setup.md"],
    plastic: ["ignore.conf", "vcs-setup.md"],
    svn: ["vcs-setup.md"],
  };
  const VCS_FILES = new Set([".gitattributes", ".gitignore", ".p4ignore", "ignore.conf", "vcs-setup.md"]);

  for (const vcs of VCS_KINDS) {
    it(`${vcs}: writes that system's setup and records it on the project`, () => {
      const result = runInit({ dir: mkdtempSync(join(tmpdir(), `init-${vcs}-`)), name: "Kit", vcs });
      const files = result.writes.map((w) => rel(result.dir, w.path)).filter((p) => VCS_FILES.has(p)).sort();
      expect(files).toEqual(SETUP[vcs]);
      const project = parseSource(result.writes.find((w) => w.path === result.projectFile)!.content) as { vcs?: string };
      expect(project.vcs).toBe(vcs);
    });
  }

  it("with none chosen: only the guide, covering every system, and no `vcs` on the project", () => {
    const result = runInit({ dir: mkdtempSync(join(tmpdir(), "init-none-")), name: "Kit" });
    const files = result.writes.map((w) => rel(result.dir, w.path)).filter((p) => VCS_FILES.has(p));
    expect(files).toEqual(["vcs-setup.md"]);
    const guide = result.writes.find((w) => w.path.endsWith("vcs-setup.md"))!.content;
    for (const heading of ["## git", "## Perforce", "## Plastic SCM", "## SVN"]) expect(guide).toContain(heading);
    expect((parseSource(result.writes.at(-1)!.content) as { vcs?: string }).vcs).toBeUndefined();
  });

  it("\"none\" is recorded as none, with only the guide: a choice of no version control, not a missing one", () => {
    const result = runInit({ dir: mkdtempSync(join(tmpdir(), "init-explicit-none-")), name: "Kit", vcs: "none" });
    expect(result.writes.map((w) => rel(result.dir, w.path)).filter((p) => VCS_FILES.has(p))).toEqual(["vcs-setup.md"]);
    expect((parseSource(result.writes.at(-1)!.content) as { vcs?: string }).vcs).toBe("none");
    expect(vcsSwitchPlan("/p", "none", undefined)).toEqual({ writes: [], removes: [] });
  });

  it("the ignore file keeps the packed document and the conflict sidecar out, and the bundle under --bundle ignore", () => {
    const ignore = (bundle: "commit" | "ignore"): string =>
      runInit({ dir: mkdtempSync(join(tmpdir(), "init-ignore-")), name: "Kit", vcs: "perforce", bundle })
        .writes.find((w) => w.path.endsWith(".p4ignore"))!.content;
    expect(ignore("commit")).toMatch(/^\*\.storyletpack$/m);
    expect(ignore("commit")).toMatch(/^\*\.storyletconflict$/m);
    expect(ignore("commit")).not.toMatch(/^\*\.storyletsc$/m);
    expect(ignore("ignore")).toMatch(/^\*\.storyletsc$/m);
  });

  it("Perforce's typemap and SVN's auto-props name every shard extension, from the one list", () => {
    const dir = mkdtempSync(join(tmpdir(), "init-typemap-"));
    const guide = (vcs: VcsKind): string => vcsConfigWrites(dir, vcs).find((w) => w.path.endsWith("vcs-setup.md"))!.content;
    for (const ext of Object.values(SHARD_EXTENSIONS)) {
      expect(guide("perforce"), ext).toContain(`text   //...${ext}`);
      expect(guide("svn"), ext).toContain(`*${ext} = svn:eol-style=LF`);
    }
    expect(guide("perforce")).toContain("storyletengine mergetool --fallback");
  });
});

describe("switching a project's system", () => {
  it("git to Perforce: writes the Perforce setup and takes git's files away, keeping the guide", () => {
    const dir = mkdtempSync(join(tmpdir(), "vcs-switch-"));
    written(dir, vcsConfigWrites(dir, "git"));
    const plan = vcsSwitchPlan(dir, "git", "perforce");
    expect(plan.writes.map((w) => rel(dir, w.path)).sort()).toEqual([".p4ignore", "vcs-setup.md"]);
    expect(plan.removes.map((p) => rel(dir, p)).sort()).toEqual([".gitattributes", ".gitignore"]);
    expect(plan.writes.find((w) => w.path.endsWith("vcs-setup.md"))!.content).toContain("## Perforce");
  });

  it("carries the bundle posture across, read from the old system's files", () => {
    const dir = mkdtempSync(join(tmpdir(), "vcs-posture-"));
    written(dir, vcsConfigWrites(dir, "git", "ignore"));
    expect(currentBundlePosture(dir, "git")).toBe("ignore");
    const plan = vcsSwitchPlan(dir, "git", "plastic");
    expect(plan.writes.find((w) => w.path.endsWith("ignore.conf"))!.content).toMatch(/^\*\.storyletsc$/m);
    // SVN keeps its ignores in a property, so the guide carries the posture.
    written(dir, plan.writes);
    const toSvn = vcsSwitchPlan(dir, "plastic", "svn");
    written(dir, toSvn.writes);
    expect(currentBundlePosture(dir, "svn")).toBe("ignore");
    expect(readFileSync(join(dir, "vcs-setup.md"), "utf8")).toContain("*.storyletsc");
  });

  it("to none: removes the old system's files and writes nothing; the guide stays as it was", () => {
    const dir = mkdtempSync(join(tmpdir(), "vcs-none-"));
    written(dir, vcsConfigWrites(dir, "git"));
    const plan = vcsSwitchPlan(dir, "git", undefined);
    expect(plan.writes).toEqual([]);
    expect(plan.removes.map((p) => rel(dir, p)).sort()).toEqual([".gitattributes", ".gitignore"]);
  });

  it("no change is no plan", () => {
    expect(vcsSwitchPlan("/p", "svn", "svn")).toEqual({ writes: [], removes: [] });
  });
});

describe("isStoryletSource", () => {
  it("is every shard extension, and not the bundle, a pack or anything else", () => {
    for (const ext of Object.values(SHARD_EXTENSIONS)) expect(isStoryletSource(`/p/x${ext}`), ext).toBe(true);
    for (const other of ["/p/x.storyletsc", "/p/x.storyletpack", "/p/readme.md", "/p/x.extension.json"]) expect(isStoryletSource(other)).toBe(false);
  });
});
