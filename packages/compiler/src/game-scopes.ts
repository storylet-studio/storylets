// ---------------------------------------------------------------------------
// The game's shared scopes, as the compiler sees them (patterkit
// design/shared-scopes.md). A game keeps one `game-scopes/` folder: each tool
// writes its own `<tool>.scopes.json` there, the game keeps `game.scopes.json`
// (the scopes it provides itself, `@world` among them), and every tool reads
// the others. The loader finds and reads the folder (ops, which has the file
// system); this is the pure half, over what it read.
//
// Two things reach a compile from here. The shared `@world`, when the folder
// declares one, IS the project's @world (decision 2): it types the checks and
// fills the bundle's world, so a standalone engine self-backs it. And the other
// tools' scopes (`@patter`, a game's `@player`) are checked, as warnings only
// (decision 3), since the other project may be a save behind on someone's branch.
// ---------------------------------------------------------------------------

import { defaultFor } from "@wildwinter/scoperegistry";
import type { ScopeDeclaration } from "@wildwinter/scoperegistry";
import { GAME_SCOPES_DIR } from "@wildwinter/scoperegistry/scopes";
import type { MergedScopes, ScopesFile } from "@wildwinter/scoperegistry/scopes";
import type { PropertyDecl } from "@storylet-studio/model";
import type { SourceProject } from "./project.js";

/** The Storylet Engine's own game-wide token: the one scope its file declares. */
export const STORYLETS_TOKEN = "story";
/** Who the Storylet Engine's file says wrote it, as a game developer knows it. */
export const STORYLETS_OWNER = "Storylet Engine";
/** The Storylet Engine's file in the folder. */
export const STORYLETS_SCOPES_FILE = "storylets.scopes.json";

/** A project declaration as a scopes file carries it: the fields another tool can use. The
 *  sharing and durability axes stay behind, being this engine's own business. */
export const toScopeDeclaration = (d: PropertyDecl): ScopeDeclaration => ({
  name: d.name, type: d.type,
  ...(d.values !== undefined ? { values: d.values } : {}),
  ...(d.stages !== undefined ? { stages: d.stages } : {}),
  ...(d.default !== undefined ? { default: d.default } : {}),
  ...(d.writable !== undefined ? { writable: d.writable } : {}),
  ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
});

/** A scopes-file declaration as a project declaration: a default always (the type's own when
 *  the file gives none, as the registry seeds it), and a scope-level `writable` carried onto
 *  each declaration that doesn't say otherwise, as the registry reads it. */
export const fromScopeDeclaration = (d: ScopeDeclaration, scopeWritable?: boolean): PropertyDecl => {
  const writable = d.writable ?? scopeWritable;
  return {
    name: d.name, type: d.type, default: d.default ?? defaultFor(d),
    ...(d.values !== undefined ? { values: d.values } : {}),
    ...(d.stages !== undefined ? { stages: d.stages } : {}),
    ...(writable !== undefined ? { writable } : {}),
    ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
  };
};

/**
 * The shared `@world`, when the project's game scopes folder declares one (in
 * `game.scopes.json`, by the design; whichever file holds it, the folder has one owner per
 * token). Undefined with no folder, no `world` scope, or an opaque one, which says nothing to
 * check against: the project's own declarations apply then.
 */
export function sharedWorld(source: SourceProject): { decls: PropertyDecl[]; fileName: string } | undefined {
  const merged = source.gameScopes?.merged;
  const scope = merged?.spec.scopes.find((s) => s.token === "world");
  if (!merged || !scope?.declarations) return undefined;
  return {
    decls: scope.declarations.map((d) => fromScopeDeclaration(d, scope.writable)),
    fileName: merged.owners.get("world")?.fileName ?? "",
  };
}

/** The project's `@world`: the shared file's when the folder declares one, else its own. */
export function worldDeclarations(source: SourceProject): PropertyDecl[] {
  return sharedWorld(source)?.decls ?? source.project.world?.properties ?? [];
}

/** Do two lists of declarations say the same thing? Order aside, since a list is a set of
 *  names, and every field a declaration can carry counted, `purpose` included: the copy is
 *  rewritten whole, so any difference is an edit made outside the tools. */
export function sameDeclarations(a: readonly PropertyDecl[], b: readonly PropertyDecl[]): boolean {
  const norm = (list: readonly PropertyDecl[]): string => JSON.stringify(
    [...list].map((d) => fromScopeDeclaration(toScopeDeclaration(d)))
      .sort((x, y) => x.name.localeCompare(y.name))
      .map((d) => Object.fromEntries(Object.entries(d).sort(([x], [y]) => x.localeCompare(y)))),
  );
  return norm(a) === norm(b);
}

/** The Storylet Engine's scopes file for a project: one scope, `@story`, with its declarations,
 *  in the order the project gives them. Serialise it with `serialiseScopesFile`. */
export function storyletsScopesFile(project: SourceProject["project"]): ScopesFile {
  return {
    version: 1,
    owner: STORYLETS_OWNER,
    scopes: [{ token: STORYLETS_TOKEN, declarations: (project.story?.properties ?? []).map(toScopeDeclaration) }],
  };
}

/** A scopes file as a project-relative path, the way an issue about it is anchored. */
export const scopesFilePath = (source: SourceProject, fileName: string): string =>
  `${source.gameScopes?.path ?? GAME_SCOPES_DIR}/${fileName}`;

/** Every token the folder declares other than the engine's own scopes: the game-wide scopes
 *  content may name (`@patter`, a game's `@player`). */
export const gameTokens = (merged: MergedScopes | undefined, own: readonly string[]): string[] =>
  (merged?.spec.scopes ?? []).map((s) => s.token).filter((t) => !own.includes(t));
