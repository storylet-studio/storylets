// ---------------------------------------------------------------------------
// The game's shared scopes folder, on disk (patterkit design/shared-scopes.md):
// discovery, reading, the Storylet Engine's own file, validate's staleness
// warning, the previews standing in other engines, and sharing a project's
// scopes for the first time. Hand-written from the design, against a scratch
// game folder holding a copy of the Saltmarsh example.
//
// The case pinned hardest is NO FOLDER: nothing may change, and nothing may be
// written, for the ordinary project that has never heard of one.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, compileProject, parseSource } from "@storylet-studio/compiler";
import { Engine } from "@storylet-studio/runtime";
import type { ScopesFile } from "@wildwinter/scoperegistry/scopes";
import { loadProject } from "../src/load.js";
import { runExport } from "../src/export.js";
import { runValidate } from "../src/validate.js";
import { runAsk } from "../src/draw.js";
import { runCoverage } from "../src/coverage.js";
import {
  defaultGameScopesParent, planGameWorld, planShareScopes, planStoryletsScopes, previewRegistry, readGameFile,
} from "../src/game-scopes.js";

const exampleDir = fileURLToPath(new URL("../../../examples/saltmarsh.storylets", import.meta.url));

const PATTER: ScopesFile = {
  version: 1, owner: "Patter",
  scopes: [{ token: "patter", declarations: [
    { name: "visits", type: "number", default: 1, purpose: "How often the guard has shouted" },
    { name: "gold", type: "number", default: 3, writable: false },
  ] }],
};
const GAME: ScopesFile = {
  version: 1, owner: "Game",
  scopes: [
    { token: "world", declarations: [{ name: "danger", type: "number", default: 0 }] },
    { token: "player", declarations: [{ name: "hp", type: "number", default: 10 }] },
  ],
};

const json = (file: ScopesFile): string => `${JSON.stringify(file, null, 2)}\n`;

/**
 * A game folder: `root/.git` (a repository), `root/game-scopes/` with the given files (none
 * at all when `scopes` is undefined), and the example at `root/cards/saltmarsh.storylets`.
 */
function game(scopes?: Record<string, string>): { root: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), "game-scopes-"));
  mkdirSync(join(root, ".git"));
  if (scopes !== undefined) {
    mkdirSync(join(root, "game-scopes"));
    for (const [name, text] of Object.entries(scopes)) writeFileSync(join(root, "game-scopes", name), text);
  }
  const project = join(root, "cards", "saltmarsh.storylets");
  cpSync(exampleDir, project, { recursive: true });
  return { root, project };
}

/** Rewrite one shard of the copy through a function over its parsed value. */
function edit(path: string, fn: (v: Record<string, any>) => void): void {
  const v = parseSource(readFileSync(path, "utf8")) as Record<string, any>;
  fn(v);
  writeFileSync(path, canonicalStringify(v));
}
const projectFile = (project: string): string => join(project, "saltmarsh.storyletproj");
const docksDeck = (project: string): string => join(project, "encounters", "decks", "docks.storyletdeck");

/** The rat job gated on Patter's visits, and its outcome counting another. */
function namePatter(project: string): void {
  edit(docksDeck(project), (v) => {
    const card = v.cards.find((c: { id: string }) => c.id === "c_rat_job");
    card.condition = "@patter.visits >= 1";
    card.outcomes[0].changes["@patter.visits"] = "@patter.visits + 1";
  });
}

describe("discovery and reading", () => {
  it("no folder: no game scopes, no issues, nothing written", () => {
    const { root, project } = game();
    const loaded = loadProject(project);
    expect(loaded.source!.gameScopes).toBeUndefined();
    expect(loaded.issues).toEqual([]);
    const result = runExport(loaded);
    expect(result.scopesWrite).toBeUndefined();
    expect(existsSync(join(root, "game-scopes"))).toBe(false);
    expect(runValidate(loaded, { checkBundle: false }).issues).toEqual([]);
  });

  it("walks up from the project to the folder, and reads and merges every file in it", () => {
    const { root, project } = game({ "patter.scopes.json": json(PATTER), "game.scopes.json": json(GAME), "notes.txt": "not a scopes file" });
    const gs = loadProject(project).source!.gameScopes!;
    expect(gs.dir).toBe(join(root, "game-scopes"));
    expect(gs.path).toBe("../../game-scopes");
    expect(gs.files).toEqual(["game.scopes.json", "patter.scopes.json"]);
    expect(gs.merged.spec.scopes.map((s) => s.token)).toEqual(["world", "player", "patter"]);
    expect(gs.issues).toEqual([]);
  });

  it("stops at the version-control root: a folder above the repository is never picked up", () => {
    const outer = mkdtempSync(join(tmpdir(), "outer-"));
    mkdirSync(join(outer, "game-scopes"));
    writeFileSync(join(outer, "game-scopes", "patter.scopes.json"), json(PATTER));
    const repo = join(outer, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    cpSync(exampleDir, join(repo, "saltmarsh.storylets"), { recursive: true });
    expect(loadProject(join(repo, "saltmarsh.storylets")).source!.gameScopes).toBeUndefined();
  });

  it("the project can name the folder instead, relative to its file; one that isn't there is an error", () => {
    const { root, project } = game();
    mkdirSync(join(root, "shared", "scopes"), { recursive: true });
    writeFileSync(join(root, "shared", "scopes", "patter.scopes.json"), json(PATTER));
    edit(projectFile(project), (v) => { v.gameScopes = "../../shared/scopes"; });
    const found = loadProject(project);
    expect(found.issues).toEqual([]);
    expect(found.source!.gameScopes!.dir).toBe(join(root, "shared", "scopes"));

    edit(projectFile(project), (v) => { v.gameScopes = "../../nowhere"; });
    const missing = loadProject(project);
    expect(missing.source!.gameScopes).toBeUndefined();
    expect(missing.issues).toEqual([{
      severity: "error", path: "saltmarsh.storyletproj", where: "gameScopes",
      message: `the project names a game scopes folder that doesn't exist: ${resolve(project, "../../nowhere")}`,
    }]);
  });

  it("a file that won't parse and a token two files declare are errors, anchored to the file", () => {
    const { project } = game({
      "patter.scopes.json": json(PATTER),
      "broken.scopes.json": "{ not json",
      "lockstep.scopes.json": json({ version: 1, owner: "Lockstep", scopes: [{ token: "patter" }] }),
    });
    const loaded = loadProject(project);
    const errs = loaded.issues.filter((i) => i.severity === "error");
    expect(errs.map((i) => i.path)).toEqual(["../../game-scopes/broken.scopes.json", "../../game-scopes/patter.scopes.json"]);
    expect(errs[0]!.message).toMatch(/^not valid JSON/);
    expect(errs[1]!.message).toBe("scope '@patter' is declared by both lockstep.scopes.json (Lockstep) and patter.scopes.json (Patter)");
    expect(runValidate(loaded, { checkBundle: false }).ok).toBe(false);
  });
});

describe("the Storylet Engine's file", () => {
  it("export writes it when the folder exists, and a second export leaves it byte-identical", () => {
    const { root, project } = game({ "patter.scopes.json": json(PATTER) });
    const first = runExport(loadProject(project));
    expect(first.scopesWrite!.path).toBe(join(root, "game-scopes", "storylets.scopes.json"));
    expect(JSON.parse(first.scopesWrite!.content)).toEqual({
      version: 1, owner: "Storylet Engine",
      scopes: [{ token: "story", declarations: [
        { name: "reputation", type: "number", default: 0 },
        { name: "visited", type: "flags", values: ["docks", "market"], default: [] },
      ] }],
    });
    writeFileSync(first.scopesWrite!.path, first.scopesWrite!.content);
    expect(runExport(loadProject(project)).scopesWrite).toBeUndefined();
    // ...and stdout never writes it.
    expect(runExport(loadProject(project), "-").scopesWrite).toBeUndefined();
  });

  it("validate warns while the file on disk isn't what the project would write", () => {
    const { project } = game({ "patter.scopes.json": json(PATTER) });
    const stale = runValidate(loadProject(project), { checkBundle: false }).issues;
    expect(stale).toEqual([{
      severity: "warning", path: "../../game-scopes/storylets.scopes.json",
      message: "game-scopes/storylets.scopes.json is out of date: save the project in Storyletter or run export",
    }]);
    const write = planStoryletsScopes(loadProject(project))!;
    writeFileSync(write.path, write.content);
    expect(runValidate(loadProject(project), { checkBundle: false }).issues).toEqual([]);
    edit(projectFile(project), (v) => { v.story.properties.push({ name: "debt", type: "number", default: 0 }); });
    expect(runValidate(loadProject(project), { checkBundle: false }).issues.map((i) => i.message))
      .toEqual(["game-scopes/storylets.scopes.json is out of date: save the project in Storyletter or run export"]);
  });
});

describe("previews stand in the other engines (decision 4)", () => {
  it("peek plays content naming @patter with a folder, from Patter's declared defaults", () => {
    const { project } = game({ "patter.scopes.json": json(PATTER) });
    namePatter(project);
    const result = runAsk(loadProject(project), { box: "encounters", criteria: { area: "docks" } });
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.cards!.map((c) => c.gameId)).toContain("rat-job");

    // The default is what decides it: at 0 visits the card is not eligible.
    writeFileSync(join(project, "..", "..", "game-scopes", "patter.scopes.json"),
      json({ ...PATTER, scopes: [{ token: "patter", declarations: [{ name: "visits", type: "number", default: 0 }] }] }));
    const quiet = runAsk(loadProject(project), { box: "encounters", criteria: { area: "docks" } });
    expect(quiet.cards!.map((c) => c.gameId)).not.toContain("rat-job");
  });

  it("without a folder the same content is refused, as it always was", () => {
    const { project } = game();
    namePatter(project);
    const result = runAsk(loadProject(project), { box: "encounters", criteria: { area: "docks" } });
    expect(result.cards).toBeUndefined();
    expect(result.issues.map((i) => i.message).join(" ")).toMatch(/this content names @patter/);
  });

  it("with a folder that doesn't declare the token, it is refused too", () => {
    const { project } = game({ "game.scopes.json": json(GAME) });
    namePatter(project);
    expect(runAsk(loadProject(project), { box: "encounters" }).issues.map((i) => i.message).join(" ")).toMatch(/this content names @patter/);
  });

  it("coverage runs it, a fresh stand-in per run", () => {
    const { project } = game({ "patter.scopes.json": json(PATTER) });
    namePatter(project);
    const report = runCoverage(loadProject(project).source!, { runs: 5, maxTurns: 10 });
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report.cards.find((c) => c.gameId === "rat-job")!.dealt).toBeGreaterThan(0);
  });

  it("the stand-in registry adds @world from the bundle when the folder has none, and is absent when there is nothing to stand in", () => {
    const { project } = game({ "patter.scopes.json": json(PATTER) });
    namePatter(project);
    const loaded = loadProject(project);
    const bundle = compileProject(loaded.source!).bundle!;
    const registry = previewRegistry(bundle, loaded.source!.gameScopes!.merged)!;
    expect(registry.has("story")).toBe(false);
    expect(registry.get("world", "danger")).toBe(0);
    expect(registry.get("patter", "visits")).toBe(1);
    // An engine on it: @world reads and writes through the registry by the engine's own address.
    const flow = new Engine(bundle, { registry }).openFlow("main");
    flow.setProperty("world.danger", 2);
    expect(registry.get("world", "danger")).toBe(2);

    const plain = compileProject(loadProject(game({ "patter.scopes.json": json(PATTER) }).project).source!).bundle!;
    expect(previewRegistry(plain, loaded.source!.gameScopes!.merged)).toBeUndefined();   // names no other engine
    expect(previewRegistry(bundle, undefined)).toBeUndefined();                            // no folder
  });
});

describe("the game's own file (World settings)", () => {
  it("replaces @world and keeps every other scope in the file as it was", () => {
    const { root } = game({ "game.scopes.json": json(GAME) });
    const dir = join(root, "game-scopes");
    const planned = planGameWorld(dir, [{ name: "danger", type: "number", default: 5, purpose: "How bad it is" }]);
    if ("error" in planned) throw new Error(planned.error);
    writeFileSync(planned.write!.path, planned.write!.content);
    const read = readGameFile(dir);
    if ("error" in read) throw new Error(read.error);
    expect(read.file.scopes).toEqual([
      { token: "world", declarations: [{ name: "danger", type: "number", default: 5, purpose: "How bad it is" }] },
      GAME.scopes[1],
    ]);
    // The same again changes nothing, so nothing is written.
    expect(planGameWorld(dir, [{ name: "danger", type: "number", default: 5, purpose: "How bad it is" }])).toEqual({});
  });

  it("refuses to write over a file it can't read", () => {
    const { root } = game({ "game.scopes.json": "{ broken" });
    const planned = planGameWorld(join(root, "game-scopes"), []);
    expect("error" in planned && planned.error).toMatch(/game.scopes.json can't be read .* fix it first/);
  });
});

describe("sharing a project's scopes for the first time", () => {
  it("proposes the repository root, and writes both files there with the project's @world kept", () => {
    const { root, project } = game();
    const loaded = loadProject(project);
    expect(defaultGameScopesParent(project)).toBe(root);
    const plan = planShareScopes(loaded, root);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.dir).toBe(join(root, "game-scopes"));
    expect(plan.override).toBeUndefined();   // discovery finds it from the project
    expect(plan.writes.map((w) => w.path)).toEqual([join(root, "game-scopes", "storylets.scopes.json"), join(root, "game-scopes", "game.scopes.json")]);
    expect(JSON.parse(plan.writes[1]!.content)).toEqual({
      version: 1, owner: "Game", scopes: [{ token: "world", declarations: [{ name: "danger", type: "number", default: 0 }] }],
    });
    mkdirSync(plan.dir);
    for (const w of plan.writes) writeFileSync(w.path, w.content);
    const after = loadProject(project);
    expect(after.issues).toEqual([]);
    expect(runValidate(after, { checkBundle: false }).issues).toEqual([]);
    expect(planShareScopes(after, root)).toEqual({ error: `this project already shares its scopes, through ${join(root, "game-scopes")}` });
  });

  it("names the folder in the project when discovery wouldn't find it, and leaves an existing @world alone", () => {
    const { root, project } = game();
    const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
    mkdirSync(join(elsewhere, "game-scopes"));
    writeFileSync(join(elsewhere, "game-scopes", "game.scopes.json"), json(GAME));
    const plan = planShareScopes(loadProject(project), elsewhere);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.override).toMatch(/game-scopes$/);
    expect(resolve(project, plan.override!)).toBe(join(elsewhere, "game-scopes"));
    expect(plan.writes.map((w) => w.path)).toEqual([join(elsewhere, "game-scopes", "storylets.scopes.json")]);
    expect(readdirSync(root)).not.toContain("game-scopes");
  });

  it("a project that is its own repository proposes its parent folder", () => {
    const parent = mkdtempSync(join(tmpdir(), "alone-"));
    const project = join(parent, "saltmarsh.storylets");
    cpSync(exampleDir, project, { recursive: true });
    mkdirSync(join(project, ".git"));
    expect(defaultGameScopesParent(project)).toBe(parent);
    const plan = planShareScopes(loadProject(project), parent);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.override).toBe("../game-scopes");   // the walk stops at the project's own .git
  });
});
