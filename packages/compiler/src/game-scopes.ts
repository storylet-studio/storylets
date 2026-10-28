// ---------------------------------------------------------------------------
// The game's shared scopes, as the compiler sees them (patterkit
// design/shared-scopes.md). A game keeps one `game-scopes/` folder: each tool
// writes its own `<tool>.scopes.json` there, the game keeps `game.scopes.json`
// (the scopes it provides itself, `@world` among them), and every tool reads
// the others. The loader finds and reads the folder (ops, which has the file
// system); this is the pure half, over what it read.
//
// Two things reach a compile from here. The project's HOST scopes (the game's
// own, `@world`, `@player`, ...), except that the folder wins where it declares
// the same token: its file is the source and the project keeps a synced copy
// (decision 2). `@world` from the folder joins them even when the project
// doesn't declare it, because a standalone engine self-backs `@world` from the
// bundle. These are strict and ship in the bundle's `scopeRegistry`. And
// everything else in the folder (`@patter`, a game's `@player` the project
// doesn't declare) is checked, as warnings only (decision 3), since the other
// project may be a save behind on someone's branch. Patter's rule, its
// `projectScopes`.
// ---------------------------------------------------------------------------

import { defaultFor } from "@wildwinter/scoperegistry";
import type { ScopeDeclaration } from "@wildwinter/scoperegistry";
import { GAME_SCOPES_DIR } from "@wildwinter/scoperegistry/scopes";
import type { MergedScopes, ScopesFile } from "@wildwinter/scoperegistry/scopes";
import { bundleHostScopes } from "@storylet-studio/model";
import type { HostScopeSpec, PropertyDecl } from "@storylet-studio/model";
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
 * A game scope as the project's game scopes folder declares it (in `game.scopes.json`, by the
 * design; whichever file holds it, the folder has one owner per token), its scope-level
 * `writable` carried onto each declaration. Undefined with no folder, no such scope, an opaque
 * one, which says nothing to check against, or the Storylet Engine's own `@story`: the
 * project's own declarations apply then.
 */
export function sharedHostScope(source: SourceProject, token: string): { decls: PropertyDecl[]; fileName: string } | undefined {
  const merged = source.gameScopes?.merged;
  const scope = token === STORYLETS_TOKEN ? undefined : merged?.spec.scopes.find((s) => s.token === token);
  if (!merged || !scope?.declarations) return undefined;
  return {
    decls: scope.declarations.map((d) => fromScopeDeclaration(d, scope.writable)),
    fileName: merged.owners.get(token)?.fileName ?? "",
  };
}

/** The shared `@world`, when the folder declares one (`sharedHostScope(source, "world")`). */
export function sharedWorld(source: SourceProject): { decls: PropertyDecl[]; fileName: string } | undefined {
  return sharedHostScope(source, "world");
}

/** One host scope the compile treats as the project's: where its declarations come from, for
 *  anchoring an issue about them, and whether the project's own copy differs from the folder. */
export interface ProjectHostScope {
  spec: HostScopeSpec;
  /** The shard or scopes file its declarations are read from, project-relative. */
  path: string;
  /** The scopes file it was read from, when it was the folder's. */
  sharedFile?: string;
  /** True when the folder's declarations won over a project copy that says otherwise. */
  differs?: boolean;
}

/**
 * The project's host scopes once its game's folder is taken into account, in the project's
 * order and then `@world` from the folder when the project doesn't declare it: each scope
 * the project declares, the folder's declarations winning where the folder declares the same
 * token (with `differs` set when the project's copy says otherwise). With no folder they are
 * the project's own, a project not yet formatted reading its `world` block as the scope
 * `world`.
 */
export function projectHostScopes(source: SourceProject): ProjectHostScope[] {
  const out: ProjectHostScope[] = [];
  for (const own of bundleHostScopes(source.project)) {
    const shared = sharedHostScope(source, own.token);
    if (shared === undefined) { out.push({ spec: own, path: source.path }); continue; }
    // The project's copy as the folder's reads: the scope's own `writable` carried onto each.
    const mine = (own.declarations ?? []).map((d): PropertyDecl => {
      const writable = d.writable ?? own.writable;
      return { ...d, ...(writable !== undefined ? { writable } : {}) };
    });
    out.push({
      spec: { token: own.token, declarations: shared.decls },
      path: scopesFilePath(source, shared.fileName), sharedFile: shared.fileName,
      ...(own.declarations === undefined || !sameDeclarations(mine, shared.decls) ? { differs: true } : {}),
    });
  }
  const world = out.some((s) => s.spec.token === "world") ? undefined : sharedHostScope(source, "world");
  if (world !== undefined) {
    // The project keeps a synced copy, so having none differs too.
    out.push({
      spec: { token: "world", declarations: world.decls }, path: scopesFilePath(source, world.fileName), sharedFile: world.fileName,
      ...(world.decls.length > 0 ? { differs: true } : {}),
    });
  }
  return out;
}

/** The project's `@world`: the shared file's when the folder declares one, else its own. */
export function worldDeclarations(source: SourceProject): PropertyDecl[] {
  return hostScopeDeclarations(source, "world");
}

/** One host scope's declarations as the compile reads them (`projectHostScopes`): empty when
 *  the project doesn't declare it, or declares it opaque. */
export function hostScopeDeclarations(source: SourceProject, token: string): PropertyDecl[] {
  return (projectHostScopes(source).find((s) => s.spec.token === token)?.spec.declarations ?? []) as PropertyDecl[];
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
