// ---------------------------------------------------------------------------
// The game's shared scopes folder, as the compiler sees it (patterkit
// design/shared-scopes.md). Hand-written from the design's decisions, not read
// off a running compiler:
//
//   2. `@world` has one owner: when the folder declares it, the compiler checks
//      against those declarations and copies them into the bundle, and the
//      project's own (its synced copy) differing is a warning, the shared wins.
//   3. References into another tool's scope are WARNINGS: a name its file
//      doesn't declare, a type mismatch, a write to a property it marks
//      read-only. A token nobody declares keeps today's behaviour.
//
// And the folder's own tokens (a game's `@player`) compile, recorded in the
// bundle's externalScopes like another engine's.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { mergeScopes, parseScopesFile } from "@wildwinter/scoperegistry/scopes";
import type { ScopesFile } from "@wildwinter/scoperegistry/scopes";
import { storyletsDialectWith, storyletsDialect } from "@storylet-studio/dialect";
import { compile } from "@wildwinter/expr";
import {
  canonicalStringify, compileProject, parseProjectFiles, projectHash, sameDeclarations, storyletsScopesFile, worldDeclarations,
} from "../src/index.js";
import type { GameScopes, Issue, SourceFile, SourceProject } from "../src/index.js";

const shard = (path: string, value: unknown): SourceFile => ({ path, text: canonicalStringify(value) });

/** One box, one hand, one card whose condition and outcome changes are the case. */
function project(condition: string, changes: Record<string, string> = {}, world: unknown[] = []): SourceProject {
  const { project: p, issues } = parseProjectFiles([
    shard("p.storyletproj", {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.0.1" },
      settings: { playAdvancesTurns: 1, play: "venue" },
      world: { properties: world },
      story: { properties: [{ name: "act", type: "number", default: 1, purpose: "Where the story is" }] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
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

const PATTER: ScopesFile = {
  version: 1, owner: "Patter",
  scopes: [{ token: "patter", declarations: [
    { name: "visits", type: "number", default: 0, purpose: "How often the guard has shouted" },
    { name: "gold", type: "number", default: 3, writable: false },
    { name: "mood", type: "enum", values: ["calm", "angry"], default: "calm" },
  ] }],
};
const GAME: ScopesFile = {
  version: 1, owner: "Game",
  scopes: [
    { token: "world", declarations: [{ name: "is_night", type: "boolean", default: false }, { name: "clock", type: "number", default: 0, writable: false }] },
    { token: "player", declarations: [{ name: "hp", type: "number", default: 10 }] },
    { token: "weather" },   // opaque: any name, unchecked
  ],
};

/** The folder, as the loader would have read it. */
function folder(...files: [string, ScopesFile][]): GameScopes {
  const named = files.map(([fileName, file]) => ({ fileName, file: parseScopesFile(JSON.stringify(file), fileName).file! }));
  const merged = mergeScopes(named);
  return { dir: "/game/game-scopes", path: "../game-scopes", files: named.map((f) => f.fileName).sort(), merged, issues: merged.issues };
}
const both = (): GameScopes => folder(["patter.scopes.json", PATTER], ["game.scopes.json", GAME]);

const withScopes = (source: SourceProject, gameScopes: GameScopes = both()): SourceProject => ({ ...source, gameScopes });
const errors = (issues: Issue[]): string[] => issues.filter((i) => i.severity === "error").map((i) => i.message);
const warnings = (issues: Issue[]): string[] => issues.filter((i) => i.severity === "warning").map((i) => i.message);

/** The project's @world copy, identical to game.scopes.json's (the synced state). */
const SYNCED_WORLD = [{ name: "is_night", type: "boolean", default: false }, { name: "clock", type: "number", default: 0, writable: false }];

describe("references into another tool's scope (decision 3: warnings)", () => {
  it("a name the owner declares, used as it says, is silent", () => {
    const result = compileProject(withScopes(project("@patter.visits >= 1 && @patter.mood == \"angry\"", { "@patter.visits": "@patter.visits + 1" }, SYNCED_WORLD)));
    expect(result.issues).toEqual([]);
    expect(result.bundle!.externalScopes).toEqual(["patter"]);
  });

  it("a misspelt name is a warning naming the file that should declare it, and still publishes", () => {
    const result = compileProject(withScopes(project("@patter.vists >= 1", {}, SYNCED_WORLD)));
    expect(errors(result.issues)).toEqual([]);
    expect(warnings(result.issues)).toEqual(["condition: @patter.vists is not declared by Patter (game-scopes/patter.scopes.json)"]);
    expect(result.bundle).toBeDefined();
  });

  it("a type mismatch is a warning", () => {
    const result = compileProject(withScopes(project("@patter.visits == \"lots\"", {}, SYNCED_WORLD)));
    expect(errors(result.issues)).toEqual([]);
    expect(warnings(result.issues)).toEqual(["condition: '==' compares number with string; the values can never be equal"]);
    expect(result.bundle).toBeDefined();
  });

  it("an outcome writing a property its owner marks read-only is a warning", () => {
    const result = compileProject(withScopes(project("true", { "@patter.gold": "1" }, SYNCED_WORLD)));
    expect(errors(result.issues)).toEqual([]);
    expect(warnings(result.issues)).toEqual(["change @patter.gold: @patter.gold is read-only: Patter (game-scopes/patter.scopes.json) declares it so"]);
  });

  it("an outcome writing a name the owner doesn't declare is a warning", () => {
    const result = compileProject(withScopes(project("true", { "@patter.glod": "1" }, SYNCED_WORLD)));
    expect(errors(result.issues)).toEqual([]);
    expect(warnings(result.issues)).toEqual(["change @patter.glod: @patter.glod is not declared by Patter (game-scopes/patter.scopes.json)"]);
  });

  it("with no folder, the same content is accepted unchecked, exactly as before", () => {
    for (const [cond, changes] of [["@patter.vists >= 1", {}], ["@patter.visits == \"lots\"", {}], ["true", { "@patter.gold": "1" }]] as const) {
      const result = compileProject(project(cond, changes));
      expect(result.issues).toEqual([]);
      expect(result.bundle!.externalScopes).toEqual(["patter"]);
    }
  });

  it("a folder that doesn't declare the token leaves it unchecked too (the shared vocabulary)", () => {
    const result = compileProject(withScopes(project("@patter.vists == \"lots\"", {}, SYNCED_WORLD), folder(["game.scopes.json", GAME])));
    expect(result.issues).toEqual([]);
  });
});

describe("the game's own scopes", () => {
  it("a token the folder declares compiles, is checked, and is recorded as another owner's", () => {
    const ok = compileProject(withScopes(project("@player.hp > 0", { "@player.hp": "@player.hp - 1" }, SYNCED_WORLD)));
    expect(ok.issues).toEqual([]);
    expect(ok.bundle!.externalScopes).toEqual(["player"]);
    const typo = compileProject(withScopes(project("@player.hpp > 0", {}, SYNCED_WORLD)));
    expect(errors(typo.issues)).toEqual([]);
    expect(warnings(typo.issues)).toEqual(["condition: @player.hpp is not declared by Game (game-scopes/game.scopes.json)"]);
  });

  it("an opaque scope takes any name, unchecked", () => {
    const result = compileProject(withScopes(project("@weather.anything == \"rain\"", { "@weather.wind": "3" }, SYNCED_WORLD)));
    expect(result.issues).toEqual([]);
    expect(result.bundle!.externalScopes).toEqual(["weather"]);
  });

  it("without the folder, a game token is not a scope at all", () => {
    expect(errors(compileProject(project("@player.hp > 0")).issues).length).toBeGreaterThan(0);
    expect(errors(compileProject(project("true", { "@player.hp": "1" })).issues).join(" ")).toMatch(/change target "@player.hp"/);
  });

  it("the dialect gains the folder's tokens, and is the plain dialect when there are none", () => {
    expect(storyletsDialectWith([])).toBe(storyletsDialect);
    expect(storyletsDialectWith(["patter", "story"])).toBe(storyletsDialect);   // known already
    expect(() => compile("@player.hp > 0", storyletsDialect)).toThrow();
    expect(compile("@player.hp > 0", storyletsDialectWith(["player"]))).toBeDefined();
  });
});

describe("@world from game.scopes.json (decision 2)", () => {
  it("the shared declarations are the bundle's world and what conditions are checked against", () => {
    const result = compileProject(withScopes(project("@world.is_night", {}, SYNCED_WORLD)));
    expect(result.issues).toEqual([]);
    expect(result.bundle!.world.properties).toEqual([
      { name: "is_night", type: "boolean", default: false },
      { name: "clock", type: "number", default: 0, writable: false },
    ]);
  });

  it("a project copy that differs is a warning, and the shared file wins", () => {
    const stale = [{ name: "is_day", type: "boolean", default: true }];
    const result = compileProject(withScopes(project("@world.is_night", {}, stale)));
    expect(errors(result.issues)).toEqual([]);
    expect(warnings(result.issues)).toEqual([
      "the project's @world declarations differ from ../game-scopes/game.scopes.json, which wins: save the project in Storyletter to bring its copy up to date",
    ]);
    expect(result.bundle!.world.properties.map((d) => d.name)).toEqual(["is_night", "clock"]);
    // A name only the stale copy has is not @world any more.
    expect(errors(compileProject(withScopes(project("@world.is_day", {}, stale))).issues).length).toBeGreaterThan(0);
  });

  it("the shared file's read-only is kept, as the project's own always was (an error: @world is this project's)", () => {
    const result = compileProject(withScopes(project("true", { "@world.clock": "1" }, SYNCED_WORLD)));
    expect(errors(result.issues).join(" ")).toMatch(/change target "@world.clock" is read-only/);
  });

  it("with no world in the folder, the project's own declarations apply", () => {
    const own = [{ name: "is_day", type: "boolean", default: true }];
    const source = withScopes(project("@world.is_day", {}, own), folder(["patter.scopes.json", PATTER]));
    expect(compileProject(source).issues).toEqual([]);
    expect(worldDeclarations(source)).toEqual(own);
  });

  it("the shared world is part of the content hash, and a project with no folder hashes as it always did", () => {
    const plain = project("true", {}, SYNCED_WORLD);
    const before = projectHash(plain);
    expect(projectHash({ ...plain })).toBe(before);
    const shared = withScopes(plain);
    expect(projectHash(shared)).not.toBe(before);
    const moved: ScopesFile = { ...GAME, scopes: [{ token: "world", declarations: [{ name: "is_night", type: "boolean", default: true }] }] };
    expect(projectHash(withScopes(plain, folder(["game.scopes.json", moved])))).not.toBe(projectHash(shared));
  });

  it("sameDeclarations ignores order, and counts every field", () => {
    const a = [{ name: "a", type: "number" as const, default: 0 }, { name: "b", type: "boolean" as const, default: false }];
    expect(sameDeclarations(a, [...a].reverse())).toBe(true);
    expect(sameDeclarations(a, [a[0]!, { ...a[1]!, purpose: "why" }])).toBe(false);
    expect(sameDeclarations(a, [a[0]!])).toBe(false);
  });
});

describe("the Storylet Engine's own file", () => {
  it("holds @story alone, with every declaration's fields, in the project's order", () => {
    const source = project("true");
    source.project.story.properties.push({ name: "stage", type: "quality", stages: ["a", "b"], default: "a", shared: false, durable: true });
    expect(storyletsScopesFile(source.project)).toEqual({
      version: 1, owner: "Storylet Engine",
      scopes: [{ token: "story", declarations: [
        { name: "act", type: "number", default: 1, purpose: "Where the story is" },
        { name: "stage", type: "quality", stages: ["a", "b"], default: "a" },
      ] }],
    });
  });
});
