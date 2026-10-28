// Host scopes like Patter's, in Storyletter: a game can declare scopes besides @world
// (@player, ...), each with declarations or opaque, and a scope-level `writable`. What an
// author does in Project Settings and around the editor, and what lands on disk:
//
//   - the settings list @world first, always; a save writes the shard's `scopeRegistry` in
//     one undoable step, with a scope added, made opaque, made read-only or removed;
//   - where the game shares its scopes, game.scopes.json is written first and the project
//     keeps the same as its synced copy; a scope removed here goes from the file too;
//   - the expression editors are told the project's own tokens, folder or none;
//   - the catalogue, the declare quick fix and property and stage renames reach @player.

import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { bundleHostScopes, setHostScopeDecls } from "@storylet-studio/model";
import type { DeckShard, ProjectShard } from "@storylet-studio/model";
import { openProject, projectSettings } from "./project.js";
import type { ProjectSession } from "./project.js";
import { cardCatalogue, declareProperty, saveProjectSettings, undo } from "./mutate.js";
import { renamePropertyEverywhere, renameQualityStage } from "./mutate/stages.js";
import type { HostScopeDto } from "../shared/api.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const GAME = { version: 1, owner: "Game", scopes: [
  { token: "world", declarations: [{ name: "danger", type: "number", default: 2 }] },
  { token: "party", declarations: [{ name: "size", type: "number", default: 3 }] },
] };

/** A copy of the example, optionally beside a game scopes folder, with the project's own
 *  shards changed first (parsed, changed, written back canonically, never by text). */
function scratch(opts: { folder?: boolean; project?: (p: ProjectShard) => void; deck?: (d: DeckShard) => void } = {}): { root: string; session: ProjectSession } {
  const root = mkdtempSync(join(tmpdir(), "studio-hosts-"));
  mkdirSync(join(root, ".git"));
  if (opts.folder) {
    mkdirSync(join(root, "game-scopes"));
    writeFileSync(join(root, "game-scopes", "game.scopes.json"), json(GAME));
  }
  const dir = join(root, "cards", "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const edit = <T>(path: string, change: ((shard: T) => void) | undefined): void => {
    if (!change) return;
    const shard = parseSource(readFileSync(path, "utf8")) as T;
    change(shard);
    writeFileSync(path, canonicalStringify(shard));
  };
  edit<ProjectShard>(join(dir, "saltmarsh.storyletproj"), opts.project);
  edit<DeckShard>(join(dir, "encounters", "decks", "docks.storyletdeck"), opts.deck);
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return { root, session: opened.session };
}
const projectShard = (session: ProjectSession): ProjectShard =>
  parseSource(readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8")) as ProjectShard;
const deckShard = (session: ProjectSession): DeckShard =>
  parseSource(readFileSync(join(session.loaded.dir, "encounters", "decks", "docks.storyletdeck"), "utf8")) as DeckShard;
const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const withPlayer = (p: ProjectShard): void => {
  setHostScopeDecls(p, "player", [
    { name: "hp", type: "number", default: 10 },
    { name: "mood", type: "quality", stages: ["calm", "tense"], default: "calm" },
  ]);
};
/** The first card reads and writes @player. */
const cardOnPlayer = (d: DeckShard): void => {
  const card = d.cards[0]!;
  card.condition = "@player.hp > 0 and @player.mood >= \"calm\"";
  card.outcomes[0]!.changes = { ...card.outcomes[0]!.changes, "@player.hp": "@player.hp - 1" };
};

describe("Project Settings' host scopes", () => {
  it("lists @world first, then the project's other scopes", () => {
    const { session } = scratch({ project: withPlayer });
    const s = projectSettings(session);
    expect(s.hostScopes.map((h) => h.token)).toEqual(["world", "player"]);
    expect(s.hostScopes[1]!.declarations.map((d) => d.name)).toEqual(["hp", "mood"]);
  });

  it("lists an empty @world for a project that declares none, and saving it adds no scope", async () => {
    const { session } = scratch({ project: (p) => { delete p.scopeRegistry; } });
    const s = projectSettings(session);
    expect(s.hostScopes).toEqual([{ token: "world", savedAs: "world", declarations: [] }]);
    expect("error" in await saveProjectSettings(session, s)).toBe(false);
    expect(projectShard(session).scopeRegistry).toBeUndefined();
  });

  it("adds a scope with its properties, one opaque, and a read-only one, as one undo step", async () => {
    const { session } = scratch();
    const before = readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8");
    const s = projectSettings(session);
    s.hostScopes.push(
      { token: "player", writable: false, declarations: [{ name: "hp", type: "number", default: "10" }] },
      { token: "weather", opaque: true, declarations: [] },
    );
    expect("error" in await saveProjectSettings(session, s)).toBe(false);
    expect(projectShard(session).scopeRegistry!.scopes).toEqual([
      { token: "world", declarations: [{ name: "danger", type: "number", default: 0 }] },
      { token: "player", writable: false, declarations: [{ name: "hp", type: "number", default: 10 }] },
      { token: "weather" },
    ]);
    // Back up into the dialog as it was saved.
    const again = projectSettings(session).hostScopes;
    expect(again[1]).toEqual({ token: "player", savedAs: "player", writable: false, declarations: [{ name: "hp", type: "number", default: "10" }] });
    expect(again[2]).toEqual({ token: "weather", savedAs: "weather", opaque: true, declarations: [] });
    await undo(session);
    expect(readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8")).toBe(before);
  });

  it("removes a scope", async () => {
    const { session } = scratch({ project: withPlayer });
    const s = projectSettings(session);
    s.hostScopes = s.hostScopes.filter((h) => h.token !== "player");
    expect("error" in await saveProjectSettings(session, s)).toBe(false);
    expect(bundleHostScopes(projectShard(session)).map((h) => h.token)).toEqual(["world"]);
  });

  it("refuses a token the game can't provide, and changes nothing", async () => {
    const { session } = scratch();
    const before = readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8");
    for (const bad of ["story", "patter", "2nd", "world"] as const) {
      const s = projectSettings(session);
      s.hostScopes.push({ token: bad, declarations: [] } as HostScopeDto);
      const r = await saveProjectSettings(session, s);
      expect("error" in r, bad).toBe(true);
    }
    expect(readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8")).toBe(before);
  });
});

describe("host scopes where the game shares its scopes", () => {
  it("writes game.scopes.json first, keeps the scopes it doesn't show, and copies the same into the project", async () => {
    const { root, session } = scratch({ folder: true });
    const s = projectSettings(session);
    expect(s.hostScopes.map((h) => h.token)).toEqual(["world"]);
    s.hostScopes.push({ token: "player", writable: false, declarations: [{ name: "hp", type: "number", default: "10" }] });
    expect("error" in await saveProjectSettings(session, s)).toBe(false);
    const file = readJson(join(root, "game-scopes", "game.scopes.json"));
    expect(file.scopes).toEqual([
      GAME.scopes[0], GAME.scopes[1],
      { token: "player", writable: false, declarations: [{ name: "hp", type: "number", default: 10 }] },
    ]);
    expect(projectShard(session).scopeRegistry!.scopes.find((h) => h.token === "player"))
      .toEqual({ token: "player", writable: false, declarations: [{ name: "hp", type: "number", default: 10 }] });
  });

  it("takes a scope removed here out of the game's file too", async () => {
    const { root, session } = scratch({ folder: true, project: (p) => { setHostScopeDecls(p, "party", [{ name: "size", type: "number", default: 3 }]); } });
    const s = projectSettings(session);
    expect(s.hostScopes.map((h) => h.token)).toEqual(["world", "party"]);
    s.hostScopes = s.hostScopes.filter((h) => h.token !== "party");
    expect("error" in await saveProjectSettings(session, s)).toBe(false);
    expect(readJson(join(root, "game-scopes", "game.scopes.json")).scopes.map((x: { token: string }) => x.token)).toEqual(["world"]);
  });

  it("an edit to @player in the game's file reaches the project's copy on the next save", async () => {
    const { root, session } = scratch({ folder: true, project: withPlayer });
    const path = join(root, "game-scopes", "game.scopes.json");
    writeFileSync(path, json({ ...GAME, scopes: [...GAME.scopes, { token: "player", declarations: [{ name: "hp", type: "number", default: 12 }] }] }));
    expect("error" in await declareProperty(session, "story", "debt", "")).toBe(false);
    expect(projectShard(session).scopeRegistry!.scopes.find((h) => h.token === "player"))
      .toEqual({ token: "player", declarations: [{ name: "hp", type: "number", default: 12 }] });
  });
});

describe("what the editors are told about @player", () => {
  it("the project's own tokens, with no folder", () => {
    const { session } = scratch({ project: (p) => { withPlayer(p); p.scopeRegistry!.scopes.push({ token: "weather" }); } });
    expect(session.dto.gameScopes).toBeUndefined();
    expect(session.dto.hostTokens).toEqual({ tokens: ["player", "weather"], opaque: ["weather"] });
  });

  it("none for a project with @world alone", () => {
    expect(scratch().session.dto.hostTokens).toBeUndefined();
  });

  it("the catalogue offers @player's properties, read-only where the scope is", () => {
    const { session } = scratch({ project: (p) => { withPlayer(p); p.scopeRegistry!.scopes[1]!.writable = false; } });
    const player = cardCatalogue(session, "k_docks").filter((p) => p.scope === "player");
    expect(player.map((p) => [p.name, p.writable])).toEqual([["hp", false], ["mood", false]]);
    expect(player[1]!.stages).toEqual(["calm", "tense"]);
  });
});

describe("the declare quick fix on a host scope", () => {
  it("declares on @player", async () => {
    const { session } = scratch({ project: withPlayer });
    expect("error" in await declareProperty(session, "player", "gold", "")).toBe(false);
    expect(projectShard(session).scopeRegistry!.scopes[1]!.declarations!.map((d) => d.name)).toEqual(["hp", "mood", "gold"]);
  });

  it("goes to the game's file first where the folder declares the scope", async () => {
    const { root, session } = scratch({ folder: true });
    expect("error" in await declareProperty(session, "party", "morale", "")).toBe(false);
    const party = readJson(join(root, "game-scopes", "game.scopes.json")).scopes.find((x: { token: string }) => x.token === "party");
    expect(party.declarations.map((d: { name: string }) => d.name)).toEqual(["size", "morale"]);
  });

  it("refuses a scope the game doesn't have, and an opaque one", async () => {
    const { session } = scratch({ project: (p) => { p.scopeRegistry!.scopes.push({ token: "weather" }); } });
    const typo = await declareProperty(session, "playr", "hp", "");
    expect("error" in typo && typo.error).toMatch(/isn't one of the game's scopes/);
    const opaque = await declareProperty(session, "weather", "rain", "");
    expect("error" in opaque && opaque.error).toMatch(/opaque/);
  });
});

describe("renames on @player", () => {
  it("a property renamed carries into the cards that read and write it", async () => {
    const { session } = scratch({ project: withPlayer, deck: cardOnPlayer });
    const r = await renamePropertyEverywhere(session, { kind: "property", scope: "player", name: "hp" }, "hp", "health");
    expect("error" in r).toBe(false);
    expect(projectShard(session).scopeRegistry!.scopes[1]!.declarations!.map((d) => d.name)).toEqual(["health", "mood"]);
    const card = deckShard(session).cards[0]!;
    expect(card.condition).toBe("@player.health > 0 and @player.mood >= \"calm\"");
    expect(Object.keys(card.outcomes[0]!.changes)).toContain("@player.health");
    expect(card.outcomes[0]!.changes["@player.health"]).toBe("@player.health - 1");
  });

  it("a stage renamed carries into the literals naming it", async () => {
    const { session } = scratch({ project: withPlayer, deck: cardOnPlayer });
    const r = await renameQualityStage(session, { kind: "property", scope: "player", name: "mood" }, "calm", "serene");
    expect("error" in r).toBe(false);
    expect(projectShard(session).scopeRegistry!.scopes[1]!.declarations![1]!.stages).toEqual(["serene", "tense"]);
    expect(deckShard(session).cards[0]!.condition).toBe("@player.hp > 0 and @player.mood >= \"serene\"");
  });
});

// A scope renamed in Project Settings is the same scope under a new token (Ian, 2026-10-28):
// every reference follows it, in the one undo step the save makes.
describe("a scope renamed in Project Settings", () => {
  const files = (session: ProjectSession, root?: string): string[] => [
    readFileSync(join(session.loaded.dir, "saltmarsh.storyletproj"), "utf8"),
    readFileSync(join(session.loaded.dir, "encounters", "decks", "docks.storyletdeck"), "utf8"),
    ...(root !== undefined ? [readFileSync(join(root, "game-scopes", "game.scopes.json"), "utf8")] : []),
  ];

  it("carries @player to @hero through the cards and the drivers, compiles clean, and one Undo puts it all back", async () => {
    const { session } = scratch({
      project: (p) => { withPlayer(p); p.coverage = { ...p.coverage, drivers: { ...p.coverage?.drivers, "@player.hp": { kind: "initial", values: [3] } } }; },
      deck: cardOnPlayer,
    });
    const before = files(session);
    const s = projectSettings(session);
    expect(s.hostScopes[1]!.savedAs).toBe("player");
    s.hostScopes[1]!.token = "hero";
    const r = await saveProjectSettings(session, s);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(bundleHostScopes(projectShard(session)).map((h) => h.token)).toEqual(["world", "hero"]);
    expect(Object.keys(projectShard(session).coverage!.drivers!)).toContain("@hero.hp");
    expect(Object.keys(projectShard(session).coverage!.drivers!)).not.toContain("@player.hp");
    const card = deckShard(session).cards[0]!;
    expect(card.condition).toBe("@hero.hp > 0 and @hero.mood >= \"calm\"");
    expect(card.outcomes[0]!.changes["@hero.hp"]).toBe("@hero.hp - 1");
    expect(files(session).join("\n")).not.toMatch(/@player\b/);
    await undo(session);
    expect(files(session)).toEqual(before);
  });

  it("refuses a rename onto a token the project already has, and changes nothing", async () => {
    const { session } = scratch({ project: (p) => { withPlayer(p); setHostScopeDecls(p, "hero", []); }, deck: cardOnPlayer });
    const before = files(session);
    const s = projectSettings(session);
    // The hero scope removed and player renamed onto it in one save: the cards' old @hero
    // references would quietly become player's.
    s.hostScopes = s.hostScopes.filter((h) => h.token !== "hero");
    s.hostScopes[1]!.token = "hero";
    const r = await saveProjectSettings(session, s);
    expect("error" in r && r.error).toMatch(/already has an @hero scope/);
    expect(files(session)).toEqual(before);
  });

  it("renames the scope in game.scopes.json where it stands, leaving the other tools' scopes alone", async () => {
    const made = scratch({
      folder: true,
      project: (p) => { setHostScopeDecls(p, "party", [{ name: "size", type: "number", default: 3 }]); },
      deck: (d) => { d.cards[0]!.condition = "@party.size > 1"; },
    });
    const root = made.root;
    const path = join(root, "game-scopes", "game.scopes.json");
    writeFileSync(path, json({ ...GAME, scopes: [...GAME.scopes, { token: "faction", declarations: [{ name: "rep", type: "number", default: 0 }] }] }));
    const opened = openProject(made.session.loaded.dir);
    if ("error" in opened) throw new Error(opened.error);
    const session = opened.session;
    const before = files(session, root);
    const s = projectSettings(session);
    expect(s.hostScopes.map((h) => h.token)).toEqual(["world", "party"]);
    s.hostScopes[1]!.token = "crew";
    const r = await saveProjectSettings(session, s);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(readJson(path).scopes).toEqual([
      GAME.scopes[0], { ...GAME.scopes[1], token: "crew" },
      { token: "faction", declarations: [{ name: "rep", type: "number", default: 0 }] },
    ]);
    expect(bundleHostScopes(projectShard(session)).map((h) => h.token)).toEqual(["world", "crew"]);
    expect(deckShard(session).cards[0]!.condition).toBe("@crew.size > 1");
    await undo(session);
    expect(files(session, root)).toEqual(before);
  });
});
