// Storyletter and the game's shared scopes folder (patterkit design/shared-scopes.md),
// headlessly, against a scratch game: a repository with a `game-scopes/` folder beside a copy
// of the example project. What an author does, and what lands on disk:
//
//   - any save of the project shard brings storylets.scopes.json up to date, and rewrites the
//     project's copy of @world from game.scopes.json, in one undoable step;
//   - the World settings read game.scopes.json, and write it FIRST, keeping its other scopes,
//     then copy the same declarations into the project (which stays self-contained);
//   - the picker offers the other tools' properties, with who declares them;
//   - Share Scopes makes the folder, keeping the project's copy of @world;
//   - with no folder, nothing outside the project is ever written.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { ProjectShard } from "@storylet-studio/model";
import { compileBundle, exportBundle, openProject, projectSettings, shareScopes, shareScopesDefault } from "./project.js";
import type { ProjectSession } from "./project.js";
import { cardCatalogue, declareProperty, saveProjectSettings, undo } from "./mutate.js";
import { runPack, runUnpack, runUnpackMerge } from "@storylet-studio/ops";
import { applyStates } from "./history.js";
import { returnedWorldSummary, returnedWorldWrites } from "./game-scopes.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

const PATTER = { version: 1, owner: "Patter", scopes: [{ token: "patter", declarations: [
  { name: "visits", type: "number", default: 1, purpose: "How often the guard has shouted" },
] }] };
const GAME = { version: 1, owner: "Game", scopes: [
  { token: "world", declarations: [{ name: "danger", type: "number", default: 2, purpose: "How bad it is out there" }] },
  { token: "player", declarations: [{ name: "hp", type: "number", default: 10 }] },
  { token: "weather" },
] };
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

function scratch(withFolder: boolean): { root: string; session: ProjectSession } {
  const root = mkdtempSync(join(tmpdir(), "studio-scopes-"));
  mkdirSync(join(root, ".git"));
  if (withFolder) {
    mkdirSync(join(root, "game-scopes"));
    writeFileSync(join(root, "game-scopes", "patter.scopes.json"), json(PATTER));
    writeFileSync(join(root, "game-scopes", "game.scopes.json"), json(GAME));
  }
  const dir = join(root, "cards", "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return { root, session: opened.session };
}
const projectShard = (session: ProjectSession): ProjectShard =>
  parseSource(readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8")) as ProjectShard;
const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));

describe("saving the project writes the Storylet Engine's file", () => {
  it("a story declaration lands in storylets.scopes.json, the project's @world copy is synced, and one undo takes both back", () => {
    const { root, session } = scratch(true);
    const ours = join(root, "game-scopes", "storylets.scopes.json");
    expect(existsSync(ours)).toBe(false);
    const r = declareProperty(session, "story", "debt", "");
    expect("error" in r).toBe(false);
    expect(readJson(ours)).toEqual({
      version: 1, owner: "Storylet Engine",
      scopes: [{ token: "story", declarations: [
        { name: "reputation", type: "number", default: 0 },
        { name: "visited", type: "flags", values: ["docks", "market"], default: [] },
        { name: "debt", type: "number", default: 0 },
      ] }],
    });
    // The copy of @world now says what game.scopes.json says (the shared file wins).
    expect(projectShard(session).world.properties).toEqual([{ name: "danger", type: "number", default: 2, purpose: "How bad it is out there" }]);

    undo(session);
    expect(existsSync(ours)).toBe(false);
    expect(projectShard(session).story.properties.map((p) => p.name)).toEqual(["reputation", "visited"]);
    expect(projectShard(session).world.properties).toEqual([{ name: "danger", type: "number", default: 0 }]);
  });

  it("publishing writes it too, and never when it already says the same", () => {
    const { root, session } = scratch(true);
    const ours = join(root, "game-scopes", "storylets.scopes.json");
    expect("error" in exportBundle(session)).toBe(false);
    const first = readFileSync(ours, "utf8");
    expect(readJson(ours).scopes[0].token).toBe("story");
    expect("error" in exportBundle(session)).toBe(false);
    expect(readFileSync(ours, "utf8")).toBe(first);
  });
});

describe("the World settings, where the game shares its scopes", () => {
  it("read game.scopes.json, and name it", () => {
    const { session } = scratch(true);
    const s = projectSettings(session);
    expect(s.world.map((d) => [d.name, d.default])).toEqual([["danger", "2"]]);
    expect(s.worldFile).toBe("game-scopes/game.scopes.json");
  });

  it("write game.scopes.json first, keep its other scopes, and copy the same declarations into the project", () => {
    const { root, session } = scratch(true);
    const s = projectSettings(session);
    s.world = [...s.world, { name: "is_night", type: "boolean", default: "false" }];
    expect("error" in saveProjectSettings(session, s)).toBe(false);
    const game = readJson(join(root, "game-scopes", "game.scopes.json"));
    expect(game.scopes).toEqual([
      { token: "world", declarations: [
        { name: "danger", type: "number", default: 2, purpose: "How bad it is out there" },
        { name: "is_night", type: "boolean", default: false },
      ] },
      GAME.scopes[1], GAME.scopes[2],
    ]);
    // The project keeps a synced copy, so it compiles packed or checked out alone.
    expect(projectShard(session).world.properties).toEqual([
      { name: "danger", type: "number", default: 2, purpose: "How bad it is out there" },
      { name: "is_night", type: "boolean", default: false },
    ]);
    expect(session.dto.gameScopes!.sharedWorld).toBe(true);
  });

  it("re-read game.scopes.json before writing: another tool's new scope survives", () => {
    const { root, session } = scratch(true);
    const s = projectSettings(session);
    const path = join(root, "game-scopes", "game.scopes.json");
    writeFileSync(path, json({ ...GAME, scopes: [...GAME.scopes, { token: "party", declarations: [{ name: "size", type: "number", default: 3 }] }] }));
    expect("error" in saveProjectSettings(session, s)).toBe(false);
    expect(readJson(path).scopes.map((x: { token: string }) => x.token)).toEqual(["world", "player", "weather", "party"]);
  });

  it("refuse to write over a game.scopes.json that won't parse, and change nothing", () => {
    const { root, session } = scratch(true);
    const s = projectSettings(session);
    writeFileSync(join(root, "game-scopes", "game.scopes.json"), "{ broken");
    const before = readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8");
    const r = saveProjectSettings(session, s);
    expect("error" in r && r.error).toMatch(/game.scopes.json can't be read/);
    expect(readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8")).toBe(before);
  });

  it("the declare quick-fix for @world goes to the game's file as well", () => {
    const { root, session } = scratch(true);
    expect("error" in declareProperty(session, "world", "is_night", "", { type: "boolean", default: false })).toBe(false);
    expect(readJson(join(root, "game-scopes", "game.scopes.json")).scopes[0].declarations.map((d: { name: string }) => d.name))
      .toEqual(["danger", "is_night"]);
    expect(projectShard(session).world.properties.map((d) => d.name)).toEqual(["danger", "is_night"]);
  });
});

describe("what the editors are told", () => {
  it("the picker offers the other tools' properties with their owner, and @world from the game's file", () => {
    const { session } = scratch(true);
    const cat = cardCatalogue(session, "k_docks");
    expect(cat.find((p) => p.scope === "patter" && p.name === "visits")).toEqual({
      scope: "patter", name: "visits", type: "number", purpose: "How often the guard has shouted", owner: "Patter",
    });
    expect(cat.find((p) => p.scope === "player")).toEqual({ scope: "player", name: "hp", type: "number", owner: "Game" });
    expect(cat.filter((p) => p.scope === "world").map((p) => p.purpose)).toEqual(["How bad it is out there"]);
    expect(cat.some((p) => p.scope === "story" && p.owner !== undefined)).toBe(false);   // our own, from the project
  });

  it("the project says which tokens the folder declares, and which are opaque", () => {
    const { root, session } = scratch(true);
    expect(session.dto.gameScopes).toEqual({ dir: join(root, "game-scopes"), tokens: ["player", "weather", "patter"], opaque: ["weather"], sharedWorld: true });
  });

  it("the Board gets the folder beside the bundle", () => {
    const { session } = scratch(true);
    const r = compileBundle(session);
    if ("error" in r) throw new Error(r.error);
    expect(r.scopes!.owners["patter"]).toEqual({ owner: "Patter", fileName: "patter.scopes.json" });
    expect(r.scopes!.spec.scopes.map((x) => x.token)).toEqual(["world", "player", "weather", "patter"]);
  });
});

describe("Share Scopes with Other Tools", () => {
  it("makes the folder at the repository root, writes both files, and keeps the project's @world", () => {
    const { root, session } = scratch(false);
    expect(shareScopesDefault(session)).toBe(root);
    const before = readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8");
    expect(shareScopes(session, root)).toBeUndefined();
    expect(readJson(join(root, "game-scopes", "game.scopes.json"))).toEqual({
      version: 1, owner: "Game", scopes: [{ token: "world", declarations: [{ name: "danger", type: "number", default: 0 }] }],
    });
    expect(readJson(join(root, "game-scopes", "storylets.scopes.json")).owner).toBe("Storylet Engine");
    expect(readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8")).toBe(before);   // found by the walk, so not named
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.problems).toEqual([]);
    expect(shareScopes(reopened.session, root)).toEqual({ error: `this project already shares its scopes, through ${join(root, "game-scopes")}` });
  });

  it("names the folder in the project when the walk wouldn't find it", () => {
    const { session } = scratch(false);
    const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
    expect(shareScopes(session, elsewhere)).toBeUndefined();
    const shard = projectShard(session);
    expect(shard.gameScopes).toMatch(/game-scopes$/);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    expect(reopened.session.loaded.source!.gameScopes!.dir).toBe(join(elsewhere, "game-scopes"));
  });
});

describe("with no folder", () => {
  it("a save writes the project and nothing else, and the World settings name no file", () => {
    const { root, session } = scratch(false);
    const s = projectSettings(session);
    expect(s.worldFile).toBeUndefined();
    s.world = [...s.world, { name: "is_night", type: "boolean", default: "false" }];
    expect("error" in saveProjectSettings(session, s)).toBe(false);
    expect(existsSync(join(root, "game-scopes"))).toBe(false);
    expect(projectShard(session).world.properties.map((d) => d.name)).toEqual(["danger", "is_night"]);
    expect(session.dto.gameScopes).toBeUndefined();
    expect(cardCatalogue(session, "k_docks").some((p) => p.owner !== undefined)).toBe(false);
  });
});

describe("merging a returned pack, where the game shares its scopes", () => {
  /** Send the project, let the other author change their unpacked copy, and pack it back. */
  async function roundTrip(session: ProjectSession, work: (theirs: string) => void) {
    const sent = await runPack(session.loaded.dir);
    const theirs = join(mkdtempSync(join(tmpdir(), "studio-theirs-")), "copy.storylets");
    const { shards, scopes } = await runUnpack(sent, theirs);
    for (const w of [...shards, ...scopes]) {
      mkdirSync(join(w.path, ".."), { recursive: true });
      writeFileSync(w.path, w.content);
    }
    work(theirs);
    return { sent, returned: await runPack(theirs) };
  }
  /** What Merge Returned Storyletpack writes, as its commit batches it. */
  async function merge(session: ProjectSession, sent: Buffer, returned: Buffer) {
    const merged = await runUnpackMerge(returned, sent, session.loaded.dir);
    expect(applyStates([...merged.writes, ...merged.sidecars, ...returnedWorldWrites(merged.gameWorld)])).toBe(true);
    const reopened = openProject(session.loaded.dir);
    if ("error" in reopened) throw new Error(reopened.error);
    return { merged, session: reopened.session };
  }

  it("a World edit they made reaches game.scopes.json, is named in the summary, and survives the next save", async () => {
    const { root, session } = scratch(true);
    // A save first, so the project's copy of @world is level with the game's file, as it is
    // for any project Storyletter has saved since the folder was made.
    expect("error" in declareProperty(session, "story", "debt", "")).toBe(false);
    const { sent, returned } = await roundTrip(session, (theirs) => {
      const path = join(theirs, "saltmarsh.storyletproj");
      const shard = parseSource(readFileSync(path, "utf8")) as ProjectShard;
      shard.world.properties.push({ name: "tide", type: "number", default: 3 });
      writeFileSync(path, canonicalStringify(shard));
    });
    const { merged, session: after } = await merge(session, sent, returned);
    expect(returnedWorldSummary(merged.gameWorld)).toEqual({ gameWorld: "game-scopes/game.scopes.json" });
    expect(readJson(join(root, "game-scopes", "game.scopes.json")).scopes[0].declarations.map((d: { name: string }) => d.name))
      .toEqual(["danger", "tide"]);

    // The next save re-syncs the project's copy from the game's file, and the edit is still there.
    expect("error" in declareProperty(after, "story", "owed", "")).toBe(false);
    expect(projectShard(after).world.properties.map((d) => d.name)).toEqual(["danger", "tide"]);
  });

  it("with the World left alone, nothing is said and game.scopes.json is not touched", async () => {
    const { root, session } = scratch(true);
    expect("error" in declareProperty(session, "story", "debt", "")).toBe(false);
    const before = readFileSync(join(root, "game-scopes", "game.scopes.json"), "utf8");
    const { sent, returned } = await roundTrip(session, (theirs) => {
      // Their snapshot changed, which is never merged back.
      writeFileSync(join(theirs, "game-scopes", "game.scopes.json"), json({ ...GAME, scopes: [] }));
    });
    const { merged } = await merge(session, sent, returned);
    expect(returnedWorldSummary(merged.gameWorld)).toEqual({});
    expect(returnedWorldWrites(merged.gameWorld)).toEqual([]);
    expect(readFileSync(join(root, "game-scopes", "game.scopes.json"), "utf8")).toBe(before);
  });

  it("says why when game.scopes.json won't parse, and writes nothing there", () => {
    const gameWorld = { path: "/g/game-scopes/game.scopes.json", error: "game.scopes.json can't be read" };
    expect(returnedWorldSummary(gameWorld)).toEqual({ gameWorldError: "game.scopes.json can't be read" });
    expect(returnedWorldWrites(gameWorld)).toEqual([]);
  });
});
