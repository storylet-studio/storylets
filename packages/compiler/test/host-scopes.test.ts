// Host scopes like Patter's (ruled 2026-10-28): a project declares any game
// scope, not only @world, in `scopeRegistry`; references into each are checked
// as @world's are, and the bundle carries them as `scopeRegistry`.
import { describe, expect, it } from "vitest";
import { mergeScopes, parseScopesFile } from "@wildwinter/scoperegistry/scopes";
import type { ScopesFile } from "@wildwinter/scoperegistry/scopes";
import type { HostScopeRegistry } from "@storylet-studio/model";
import { canonicalStringify, compileProject, parseProjectFiles, projectDialect } from "../src/index.js";
import type { GameScopes, Issue, SourceFile, SourceProject } from "../src/index.js";

const shard = (path: string, value: unknown): SourceFile => ({ path, text: canonicalStringify(value) });

function project(condition: string, changes: Record<string, string> = {}, hosts?: HostScopeRegistry, extra: Record<string, unknown> = {}): SourceProject {
  const { project: p, issues } = parseProjectFiles([
    shard("p.storyletproj", {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.0.1" },
      settings: { playAdvancesTurns: 1 },
      ...(hosts !== undefined ? { scopeRegistry: hosts } : {}),
      story: { properties: [] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
      ...extra,
    }),
    shard("b/box.storyletbox", { schema: "storylets/box@0", box: { id: "b_1", gameId: "b1", ranking: { specificity: true }, fields: [], properties: [] } }),
    shard("b/tags.storylettags", { schema: "storylets/tags@0", groups: [] }),
    shard("b/hands.storylethands", { schema: "storylets/hands@0", templates: [], hands: [{ id: "h_1", gameId: "h1", rule: { slots: 1 } }] }),
    shard("b/decks/main.storyletdeck", {
      schema: "storylets/deck@0",
      deck: { id: "k_1", gameId: "main", properties: [] },
      cards: [{ id: "c_1", gameId: "c1", condition, outcomes: [{ id: "o_1", gameId: "go", changes }] }],
    }),
  ]);
  expect(issues).toEqual([]);
  return p!;
}

const PLAYER: HostScopeRegistry = { version: 1, scopes: [
  { token: "world", declarations: [{ name: "clock", type: "number", writable: false }] },
  { token: "player", declarations: [
    { name: "hp", type: "number", default: 10 },
    { name: "rank", type: "quality", stages: ["novice", "adept"] },
  ] },
  { token: "fx" },
] };
const errors = (issues: Issue[]): string[] => issues.filter((i) => i.severity === "error").map((i) => i.message);
const warnings = (issues: Issue[]): string[] => issues.filter((i) => i.severity === "warning").map((i) => i.message);

describe("a project's host scopes", () => {
  it("compile into the bundle's scopeRegistry, every default resolved, and no world block", () => {
    const { bundle, issues } = compileProject(project('@player.hp > 3 && @player.rank >= "adept" && @fx.anything', {}, PLAYER));
    expect(issues).toEqual([]);
    expect(bundle!.world).toBeUndefined();
    expect(bundle!.scopeRegistry).toEqual({ version: 1, scopes: [
      { token: "world", declarations: [{ name: "clock", type: "number", default: 0, writable: false }] },
      { token: "player", declarations: [
        { name: "hp", type: "number", default: 10 },
        { name: "rank", type: "quality", stages: ["novice", "adept"], default: "novice" },
      ] },
      { token: "fx" },
    ] });
    expect(bundle!.externalScopes).toBeUndefined();   // the game's, not another engine's
  });

  it("is absent from a bundle whose project declares none", () => {
    expect(compileProject(project("true", {}, undefined)).bundle!.scopeRegistry).toBeUndefined();
  });

  it("checks references into a declared scope: an undeclared name, a stage a ladder doesn't have", () => {
    expect(errors(compileProject(project("@player.mana > 3", {}, PLAYER)).issues).length).toBeGreaterThan(0);
    expect(errors(compileProject(project('@player.rank >= "master"', {}, PLAYER)).issues).length).toBeGreaterThan(0);
  });

  it("lets an outcome write a writable name, an opaque scope any name, and refuses a read-only one", () => {
    expect(errors(compileProject(project("true", { "@player.hp": "@player.hp - 1", "@fx.glow": "3" }, PLAYER)).issues)).toEqual([]);
    expect(errors(compileProject(project("true", { "@world.clock": "1" }, PLAYER)).issues)).toEqual([
      'change target "@world.clock" is read-only to the story (writable: false): the game owns it, and a condition may read it but an outcome may not write it',
    ]);
    const locked: HostScopeRegistry = { version: 1, scopes: [{ token: "player", writable: false, declarations: [
      { name: "hp", type: "number" }, { name: "xp", type: "number", writable: true },
    ] }] };
    expect(errors(compileProject(project("true", { "@player.hp": "1" }, locked)).issues)).toHaveLength(1);
    expect(errors(compileProject(project("true", { "@player.xp": "1" }, locked)).issues)).toEqual([]);
  });

  it("refuses a token the engine or another engine answers to, or two of one", () => {
    const bad = (token: string): string[] => errors(compileProject(project("true", {}, { version: 1, scopes: [{ token, declarations: [] }] })).issues);
    expect(bad("story")).toEqual(["@story is the Storylet Engine's own scope, so it can't be a host scope"]);
    expect(bad("patter")).toEqual(["@patter is another engine's scope, so it can't be a host scope"]);
    expect(bad("Player")[0]).toMatch(/host scope token "Player" cannot be used/);
    expect(errors(compileProject(project("true", {}, { version: 1, scopes: [{ token: "player" }, { token: "player" }] })).issues))
      .toEqual(["the host scope @player is declared twice"]);
  });

  it("drives coverage on any host scope's property", () => {
    const coverage = { drivers: { "@player.hp": { kind: "initial", values: [1, 20] }, "@fx.glow": { kind: "initial", values: ["x"] } } };
    expect(errors(compileProject(project("@player.hp > 3", {}, PLAYER, { coverage })).issues)).toEqual([]);
    const wrong = { drivers: { "@player.hp": { kind: "initial", values: ["many"] } } };
    expect(errors(compileProject(project("@player.hp > 3", {}, PLAYER, { coverage: wrong })).issues)).toHaveLength(1);
  });

  it("reads a project not yet formatted: its world block is the scope world", () => {
    const old = project("@world.clock > 1", {}, undefined, { world: { properties: [{ name: "clock", type: "number", default: 2 }] } });
    expect(compileProject(old).bundle!.scopeRegistry).toEqual({ version: 1, scopes: [
      { token: "world", declarations: [{ name: "clock", type: "number", default: 2 }] },
    ] });
  });

  it("parses a declared token in the project's dialect", () => {
    expect(() => projectDialect(project("true", {}, PLAYER))).not.toThrow();
  });
});

describe("a host scope from game.scopes.json", () => {
  const GAME: ScopesFile = { version: 1, owner: "Game", scopes: [
    { token: "world", declarations: [{ name: "clock", type: "number", default: 0 }] },
    { token: "player", declarations: [{ name: "hp", type: "number", default: 12 }, { name: "gold", type: "number", default: 0 }] },
  ] };
  const withFolder = (source: SourceProject): SourceProject => {
    const named = [{ fileName: "game.scopes.json", file: parseScopesFile(JSON.stringify(GAME), "game.scopes.json").file! }];
    const merged = mergeScopes(named);
    const gameScopes: GameScopes = { dir: "/g/game-scopes", path: "../game-scopes", files: ["game.scopes.json"], merged, issues: merged.issues };
    return { ...source, gameScopes };
  };

  it("wins over the project's copy of a scope it declares, with a warning when they differ", () => {
    const result = compileProject(withFolder(project("@player.gold > 0", {}, { version: 1, scopes: [
      { token: "world", declarations: [{ name: "clock", type: "number", default: 0 }] },
      { token: "player", declarations: [{ name: "hp", type: "number", default: 10 }] },
    ] })));
    expect(errors(result.issues)).toEqual([]);
    expect(warnings(result.issues)).toEqual([
      "the project's @player declarations differ from ../game-scopes/game.scopes.json, which wins: save the project in Storyletter to bring its copy up to date",
    ]);
    expect(result.bundle!.scopeRegistry!.scopes.find((s) => s.token === "player")!.declarations!.map((d) => [d.name, d.default]))
      .toEqual([["hp", 12], ["gold", 0]]);
  });

  it("is another tool's, checked as a warning and never bundled, when the project doesn't declare it", () => {
    const result = compileProject(withFolder(project("@player.hp > 0", {}, { version: 1, scopes: [
      { token: "world", declarations: [{ name: "clock", type: "number", default: 0 }] },
    ] })));
    expect(errors(result.issues)).toEqual([]);
    expect(result.bundle!.scopeRegistry!.scopes.map((s) => s.token)).toEqual(["world"]);
    expect(result.bundle!.externalScopes).toEqual(["player"]);
  });
});
