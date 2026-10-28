// ---------------------------------------------------------------------------
// The game's shared scopes folder, the file-system half (patterkit
// design/shared-scopes.md). A game keeps one `game-scopes/` folder: each tool
// writes its own `<tool>.scopes.json` there, the game keeps `game.scopes.json`
// (the scopes it provides itself, `@world` among them), and every tool reads
// the others. The pure functions are `@wildwinter/scoperegistry/scopes`; this
// is the reading and writing each tool does for itself, and what the CLI and
// Storyletter share of it.
//
// No folder is the ordinary case, and changes nothing anywhere: the project
// works alone, other engines' tokens are accepted unchecked, and nothing is
// written. Creating the folder is an explicit act, never a side effect.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  GAME_SCOPES_DIR, GAME_SCOPES_FILE, SCOPES_FILE_SUFFIX, findGameScopes, mergeScopes, parseScopesFile,
  serialiseScopesFile, standInRegistry,
} from "@wildwinter/scoperegistry/scopes";
import type { MergedScopes, NamedScopesFile, ScopesFile, ScopesFs, ScopesIssue } from "@wildwinter/scoperegistry/scopes";
import type { ScopeDeclaration, ScopeRegistry } from "@wildwinter/scoperegistry";
import { STORYLETS_SCOPES_FILE, STORYLETS_TOKEN, canonicalStringify, storyletsScopesFile, toScopeDeclaration } from "@storylet-studio/compiler";
import type { GameScopes, Issue, SourceProject } from "@storylet-studio/compiler";
import { bundleHostScopes } from "@storylet-studio/model";
import type { Bundle, HostScopeSpec, PropertyDecl } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";

/** Node's file access, as discovery takes it. `join` resolves, so an override such as
 *  `../shared/game-scopes` comes back as a real folder rather than a path with `..` in it. */
export const nodeScopesFs: ScopesFs = {
  exists: (path) => existsSync(path),
  parent: (path) => dirname(path),
  join: (dir, name) => resolve(dir, name),
};

const posix = (path: string): string => path.split("\\").join("/");

/**
 * Find and read a project's game scopes folder: every `*.scopes.json` in it, parsed and
 * merged. The folder's problems come back as the project's issues, anchored to the file they
 * are about: errors for a file that doesn't parse or a token two files declare, and for an
 * override naming a folder that isn't there.
 *
 * `projectPath` is the project shard's path (for anchoring an override problem), and
 * `override` the project's `gameScopes` field, as read.
 */
export function readGameScopes(projectDir: string, projectPath: string, override?: unknown): { gameScopes?: GameScopes; issues: Issue[] } {
  if (override !== undefined && typeof override !== "string") {
    return { issues: [{ severity: "error", path: projectPath, where: "gameScopes", message: "gameScopes must be a folder path, relative to the project file" }] };
  }
  const found = findGameScopes(projectDir, nodeScopesFs, override !== undefined ? { override } : {});
  if (found.issue !== undefined) return { issues: [{ severity: "error", path: projectPath, where: "gameScopes", message: found.issue }] };
  if (found.dir === undefined) return { issues: [] };
  const dir = found.dir;
  const path = posix(relative(projectDir, dir)) || ".";
  const anchor = (i: ScopesIssue): Issue => ({ severity: i.severity, path: `${path}/${i.file}`, message: i.message });

  let names: string[];
  try {
    if (!statSync(dir).isDirectory()) throw new Error("not a folder");
    names = readdirSync(dir).filter((n) => n.endsWith(SCOPES_FILE_SUFFIX)).sort();
  } catch (e) {
    return { issues: [{ severity: "error", path, message: `the game scopes folder can't be read: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const files: NamedScopesFile[] = [];
  const issues: ScopesIssue[] = [];
  for (const fileName of names) {
    let text: string;
    try { text = readFileSync(join(dir, fileName), "utf8"); }
    catch (e) { issues.push({ severity: "error", file: fileName, message: `can't be read: ${e instanceof Error ? e.message : String(e)}` }); continue; }
    const parsed = parseScopesFile(text, fileName);
    issues.push(...parsed.issues);
    if (parsed.file) files.push({ fileName, file: parsed.file });
  }
  const merged = mergeScopes(files);
  issues.push(...merged.issues);
  // `@story` is this engine's, so another file declaring it would be answering for us.
  // The merge has already said so when both files declare it; this is the case where
  // our own file isn't there to clash with.
  const story = merged.owners.get(STORYLETS_TOKEN);
  if (story !== undefined && story.fileName !== STORYLETS_SCOPES_FILE) {
    issues.push({ severity: "warning", file: story.fileName,
      message: `declares @${STORYLETS_TOKEN}, which is the Storylet Engine's own scope (its file is ${STORYLETS_SCOPES_FILE})` });
  }
  return {
    gameScopes: { dir, path, files: names, merged, issues },
    issues: issues.map(anchor),
  };
}

/** The text of the Storylet Engine's file for this project, canonical (every tool writes
 *  through the one serialiser, so comparing texts is the staleness check). */
export const storyletsScopesText = (source: SourceProject): string =>
  serialiseScopesFile(storyletsScopesFile(source.project));

/**
 * The write that brings `storylets.scopes.json` up to date, or undefined when it already is,
 * or when there is no folder (a folder is never created as a side effect). The project's
 * `@story` declarations are the file's whole content.
 */
export function planStoryletsScopes(loaded: LoadedProject): PlannedWrite | undefined {
  const gameScopes = loaded.source?.gameScopes;
  if (!loaded.source || !gameScopes) return undefined;
  const path = join(gameScopes.dir, STORYLETS_SCOPES_FILE);
  const content = storyletsScopesText(loaded.source);
  let current: string | undefined;
  try { current = readFileSync(path, "utf8"); } catch { current = undefined; }
  return current === content ? undefined : { path, content };
}

/** `validate`'s word on the file: a warning when what is on disk isn't what the project
 *  would write. Never an error: the file is for the other tools, and a stale one costs this
 *  project nothing. */
export function staleScopesIssues(loaded: LoadedProject): Issue[] {
  const gameScopes = loaded.source?.gameScopes;
  if (!gameScopes || planStoryletsScopes(loaded) === undefined) return [];
  const rel = `${GAME_SCOPES_DIR}/${STORYLETS_SCOPES_FILE}`;
  return [{
    severity: "warning", path: `${gameScopes.path}/${STORYLETS_SCOPES_FILE}`,
    message: `${rel} is out of date: save the project in Storyletter or run export`,
  }];
}

/**
 * The game's own file, `game.scopes.json`, read fresh from disk: what the World settings
 * edit (re-reading before each write, since any tool may have changed it since). Missing is
 * an empty file owned by the game; one that won't parse is an error, and nothing is written
 * over it.
 */
export function readGameFile(dir: string): { file: ScopesFile } | { error: string } {
  const path = join(dir, GAME_SCOPES_FILE);
  if (!existsSync(path)) return { file: { version: 1, owner: "Game", scopes: [] } };
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (e) { return { error: `${GAME_SCOPES_FILE} can't be read: ${e instanceof Error ? e.message : String(e)}` }; }
  const parsed = parseScopesFile(text, GAME_SCOPES_FILE);
  if (!parsed.file) return { error: `${GAME_SCOPES_FILE} can't be read (${parsed.issues.map((i) => i.message).join("; ")}), so it was left alone: fix it first` };
  return { file: parsed.file };
}

/**
 * `game.scopes.json` with its `world` scope replaced by these declarations, as text: every
 * other scope in the file kept as it was, `world` where it was (or last, when new). The
 * caller writes it; `undefined` when the file already says exactly this.
 */
export function planGameWorld(dir: string, decls: readonly PropertyDecl[]): { write?: PlannedWrite } | { error: string } {
  return planGameScopes(dir, { world: decls });
}

/**
 * `game.scopes.json` with each named scope's declarations replaced (any game scope: `world`,
 * `player`, ...), as text: every other scope in the file kept as it was, each named one where
 * it was (or last, when new, in the order given). The caller writes it; `undefined` when the
 * file already says exactly this.
 */
export function planGameScopes(dir: string, byToken: Record<string, readonly PropertyDecl[]>): { write?: PlannedWrite } | { error: string } {
  const read = readGameFile(dir);
  if ("error" in read) return read;
  let scopes = read.file.scopes;
  for (const [token, decls] of Object.entries(byToken)) {
    const declarations: ScopeDeclaration[] = decls.map(toScopeDeclaration);
    scopes = scopes.some((s) => s.token === token)
      ? scopes.map((s) => (s.token === token ? { ...s, declarations } : s))
      : [...scopes, { token, declarations }];
  }
  const path = join(dir, GAME_SCOPES_FILE);
  const content = serialiseScopesFile({ ...read.file, scopes });
  let current: string | undefined;
  try { current = readFileSync(path, "utf8"); } catch { current = undefined; }
  return current === content ? {} : { write: { path, content } };
}

/**
 * `game.scopes.json` with the project's host scopes written in, as text: what Project
 * Settings' host scopes save to where the game shares its scopes (Patter's `planWorldSave`).
 * Each of `scopes` replaces the file's scope of that token (its scope-level `writable` and
 * its declarations, none for an opaque one) where it was, or goes last when new; each of
 * `removed` (a scope the settings showed that is no longer there) is taken out; every other
 * scope in the file is kept exactly as it was. Re-read from disk, since any tool may have
 * changed it since. Each of `renames` (old token to new) renames the file's scope in place
 * first, so a scope renamed in the settings keeps its place in the file. `undefined` write
 * when the file already says exactly this.
 */
export function planGameHostScopes(
  dir: string, scopes: readonly HostScopeSpec[], removed: readonly string[] = [], renames: Readonly<Record<string, string>> = {},
): { write?: PlannedWrite } | { error: string } {
  const read = readGameFile(dir);
  if ("error" in read) return read;
  let next = read.file.scopes.map((s) => (Object.hasOwn(renames, s.token) ? { ...s, token: renames[s.token]! } : s)).filter((s) => !removed.includes(s.token) || scopes.some((h) => h.token === s.token));
  for (const h of scopes) {
    const spec = {
      token: h.token,
      ...(h.writable !== undefined ? { writable: h.writable } : {}),
      ...(h.declarations !== undefined ? { declarations: (h.declarations as PropertyDecl[]).map(toScopeDeclaration) } : {}),
    };
    next = next.some((s) => s.token === h.token) ? next.map((s) => (s.token === h.token ? spec : s)) : [...next, spec];
  }
  const path = join(dir, GAME_SCOPES_FILE);
  const content = serialiseScopesFile({ ...read.file, scopes: next });
  let current: string | undefined;
  try { current = readFileSync(path, "utf8"); } catch { current = undefined; }
  // No file and nothing to say: none is made.
  if (current === undefined && next.length === 0) return {};
  return current === content ? {} : { write: { path, content } };
}

/**
 * The registry a PREVIEW builds its engine on, when the project has a game scopes folder and
 * its content names another engine's scope (decision 4): every scope in the folder except
 * `@story`, stood in from its declared defaults, plus each host scope the bundle declares that
 * the folder doesn't, from the bundle's declarations (an engine given a registry doesn't
 * self-back its host scopes). Undefined
 * otherwise, and the engine runs alone exactly as it did: with no folder, content naming
 * another engine is refused as the flow opens.
 *
 * A fresh registry each call, since a registry is one game's state.
 */
export function previewRegistry(bundle: Bundle, merged: MergedScopes | undefined): ScopeRegistry | undefined {
  if (!merged || (bundle.externalScopes ?? []).length === 0) return undefined;
  const registry = standInRegistry(merged, { except: [STORYLETS_TOKEN] });
  for (const host of bundleHostScopes(bundle)) {
    if (registry.has(host.token)) continue;
    // Declared exactly as a standalone engine self-backs it: case-significant names, and
    // rows addressed `<token>.<name>`, the address the engine's own surface takes.
    registry.defineOwned(host.token, (host.declarations ?? []).map((d) => {
      const writable = d.writable ?? host.writable;
      return { ...d, ...(writable !== undefined ? { writable } : {}) } as ScopeDeclaration;
    }), { normalise: (name) => name, pathPrefix: `${host.token}.`, owner: "Game" });
  }
  return registry;
}

/**
 * Where "Share scopes with other tools" proposes to put a new `game-scopes/` folder: the
 * version-control root above the project (the first folder up holding `.git`), which is where
 * discovery stops and so where every project in the repository finds it; else the project's
 * parent folder. Never inside the project folder, which is the document.
 */
export function defaultGameScopesParent(projectDir: string): string {
  let dir = dirname(resolve(projectDir));
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return dirname(resolve(projectDir));
    dir = up;
  }
}

/**
 * Share a project's scopes with the other tools: a `game-scopes/` folder in `parent`, holding
 * the Storylet Engine's file and the game's own file with the project's host scopes (`@world`
 * and any others, which the project keeps, as its synced copy: a project compiles on its own).
 * Planned, not written.
 *
 * A folder already there is used rather than refused, and a `game.scopes.json` that already
 * declares a scope keeps it: the shared file is the source, so this never overwrites the
 * game's own declarations with one project's. `override` is set when discovery from the
 * project would not find the folder (outside the repository, or beside a project that is its
 * own repository), and the plan's last write then names it in the project as `gameScopes`.
 * The caller commits `writes` as one batch, and that is all it does.
 */
export function planShareScopes(loaded: LoadedProject, parent: string): { dir: string; writes: PlannedWrite[]; override?: string } | { error: string } {
  if (!loaded.source) return { error: "no project open" };
  if (loaded.source.gameScopes) return { error: `this project already shares its scopes, through ${loaded.source.gameScopes.dir}` };
  const dir = resolve(parent, GAME_SCOPES_DIR);
  const writes: PlannedWrite[] = [{ path: join(dir, STORYLETS_SCOPES_FILE), content: storyletsScopesText(loaded.source) }];
  const game = existsSync(dir) ? readGameFile(dir) : { file: { version: 1, owner: "Game", scopes: [] } as ScopesFile };
  if ("error" in game) return game;
  // The project's host scopes the file doesn't declare yet, `@world` always (empty when the
  // project declares none, as it always was).
  const own = bundleHostScopes(loaded.source.project);
  const hosts = own.some((s) => s.token === "world") ? own : [{ token: "world", declarations: [] }, ...own];
  const missing = hosts.filter((h) => !game.file.scopes.some((s) => s.token === h.token));
  if (missing.length > 0) {
    writes.push({
      path: join(dir, GAME_SCOPES_FILE),
      content: serialiseScopesFile({ ...game.file, scopes: [...game.file.scopes, ...missing.map((h) => ({
        token: h.token,
        ...(h.writable !== undefined ? { writable: h.writable } : {}),
        ...(h.declarations !== undefined ? { declarations: (h.declarations as PropertyDecl[]).map(toScopeDeclaration) } : {}),
      }))] }),
    });
  }
  // Would discovery find it? Asked of the real walk, with the folder counted as there.
  const found = findGameScopes(loaded.dir, { ...nodeScopesFs, exists: (p) => resolve(p) === dir || existsSync(p) });
  const override = found.dir !== undefined && resolve(found.dir) === dir ? undefined : posix(relative(loaded.dir, dir));
  // ...and when it would not, the project names the folder: a write of the plan
  // like the others, so the CLI and Storyletter commit one batch and cannot
  // disagree about it (they used to make this write themselves, one in the
  // batch and one after it).
  if (override !== undefined) {
    writes.push({ path: join(loaded.dir, loaded.source.path), content: canonicalStringify({ ...loaded.source.project, gameScopes: override }) });
  }
  return { dir, writes, ...(override !== undefined ? { override } : {}) };
}
