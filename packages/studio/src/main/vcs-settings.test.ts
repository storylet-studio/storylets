// Version control parity with Patterpad (patterkit design/family-parity-2026-10.md item 13): New Project
// records the system chosen and writes its setup; Project Settings switches it, rewriting the setup and
// taking the old system's files away in one undoable step; and Storyletter talks to the project's own
// system, never one guessed from the folders, except for a project that has not chosen.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@storylet-studio/compiler";
import { vcsConfigWrites } from "@storylet-studio/ops";
import { createProject, openProject, projectSettings } from "./project.js";
import type { ProjectSession } from "./project.js";
import { saveProjectSettings, undo } from "./mutate.js";
import { pinnedVcs } from "./vc.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

function scratch(): ProjectSession {
  const dir = join(mkdtempSync(join(tmpdir(), "studio-vcs-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened.session;
}
const projectFile = (s: ProjectSession): string => join(s.loaded.dir, s.loaded.source!.path);
const vcsOnDisk = (s: ProjectSession): unknown => (parseSource(readFileSync(projectFile(s), "utf8")) as { vcs?: unknown }).vcs;

describe("New Project's version control", () => {
  it("records the system chosen and writes its setup", () => {
    const parent = mkdtempSync(join(tmpdir(), "studio-vcs-new-"));
    const made = createProject(parent, "Harbour", "starter", "perforce");
    if ("error" in made) throw new Error(made.error);
    expect(existsSync(join(made.path, ".p4ignore"))).toBe(true);
    expect(existsSync(join(made.path, ".gitattributes"))).toBe(false);
    expect(readFileSync(join(made.path, "vcs-setup.md"), "utf8")).toContain("## Perforce");
    const opened = openProject(made.path);
    if ("error" in opened) throw new Error(opened.error);
    expect(opened.session.loaded.source!.project.vcs).toBe("perforce");
    expect(pinnedVcs()).toBe("perforce");
  });

  it("None, the picker's default, is recorded as none: plain writes, no version control", () => {
    const parent = mkdtempSync(join(tmpdir(), "studio-vcs-none-"));
    const made = createProject(parent, "Harbour", "starter");
    if ("error" in made) throw new Error(made.error);
    const opened = openProject(made.path);
    if ("error" in opened) throw new Error(opened.error);
    expect(opened.session.loaded.source!.project.vcs).toBe("none");
    expect(pinnedVcs()).toBe("none");
    expect(existsSync(join(made.path, ".gitignore"))).toBe(false);
  });
});

describe("Project Settings' version control", () => {
  it("a project that has not chosen says so, and is found from the folders", () => {
    const session = scratch();
    expect(session.loaded.source!.project.vcs).toBeUndefined();
    expect(projectSettings(session).vcs).toBe("");
    expect(pinnedVcs()).toBeUndefined();
  });

  it("leaving it unset changes nothing: no setup files are written", async () => {
    const session = scratch();
    const r = await saveProjectSettings(session, { ...projectSettings(session), name: "Renamed" });
    expect("error" in r).toBe(false);
    expect(vcsOnDisk(session)).toBeUndefined();
    expect(existsSync(join(session.loaded.dir, ".p4ignore"))).toBe(false);
  });

  it("git to Perforce: the Perforce setup lands, git's files go, and Storyletter talks to Perforce", async () => {
    const session = scratch();
    const dir = session.loaded.dir;
    // Set up for git first, as a project made with --vcs git is.
    expect("error" in await saveProjectSettings(session, { ...projectSettings(session), vcs: "git" })).toBe(false);
    expect(existsSync(join(dir, ".gitattributes"))).toBe(true);
    expect(pinnedVcs()).toBe("git");

    const r = await saveProjectSettings(session, { ...projectSettings(session), vcs: "perforce" });
    expect("error" in r).toBe(false);
    expect(vcsOnDisk(session)).toBe("perforce");
    expect(existsSync(join(dir, ".p4ignore"))).toBe(true);
    expect(existsSync(join(dir, ".gitattributes"))).toBe(false);
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
    expect(readFileSync(join(dir, "vcs-setup.md"), "utf8")).toContain("## Perforce");
    expect(pinnedVcs()).toBe("perforce");

    // One step: its Undo puts git back, files and all, and Storyletter talks to git again.
    const back = await undo(session);
    expect(back !== null && !("error" in back)).toBe(true);
    expect(vcsOnDisk(session)).toBe("git");
    expect(existsSync(join(dir, ".gitattributes"))).toBe(true);
    expect(existsSync(join(dir, ".p4ignore"))).toBe(false);
    expect(pinnedVcs()).toBe("git");
  });

  it("carries the bundle posture across a switch", async () => {
    const session = scratch();
    const dir = session.loaded.dir;
    expect("error" in await saveProjectSettings(session, { ...projectSettings(session), vcs: "git" })).toBe(false);
    // As `init --bundle ignore` would have left it.
    for (const w of vcsConfigWrites(dir, "git", "ignore")) writeFileSync(w.path, w.content);
    expect("error" in await saveProjectSettings(session, { ...projectSettings(session), vcs: "plastic" })).toBe(false);
    expect(readFileSync(join(dir, "ignore.conf"), "utf8")).toMatch(/^\*\.storyletsc$/m);
  });
});
