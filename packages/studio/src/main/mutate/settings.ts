// ---------------------------------------------------------------------------
// The project shard's settings, saved whole from the settings dialog.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { projectDialect, sharedWorld } from "@storylet-studio/compiler";
import type { SourceProject } from "@storylet-studio/compiler";
import { bundleHostScopes, migrateLegacyWorld } from "@storylet-studio/model";
import type { CoverageDriver, HostScopeSpec, ProjectShard } from "@storylet-studio/model";
import { OWN_SCOPES, EXTERNAL_SCOPES } from "@storylet-studio/dialect";
import { renameScope, vcsSwitchPlan } from "@storylet-studio/ops";
import { gameHostScopesWrite, settingsHostScopes } from "../game-scopes.js";
import type { ProjectSession } from "../project.js";
import { declsFromDtos } from "../decls.js";
import type { CoverageDriverDto, HostScopeDto, ProjectSettingsDto } from "../../shared/api.js";
import type { FileState } from "../history.js";
import { commit, freshKey, refuse } from "./write-path.js";
import { renameResultWrites } from "./stages.js";
import type { Written } from "./write-path.js";
import { projectWrite } from "./shards.js";

/** A scope token as the expression grammar reads one: what `@token.name` can name. */
const TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why these host scopes can't be saved, or undefined when they can: a token no expression
 *  could reach, one of the Storylet Engine's own or another engine's, or one twice. The
 *  dialog says the same at the field; this is the gate behind it. */
export function hostScopesProblem(scopes: readonly HostScopeDto[]): string | undefined {
  const seen = new Set<string>();
  for (const h of scopes) {
    const t = h.token.trim();
    if (!TOKEN.test(t)) return `"@${t}" can't be a host scope: a token is letters, digits and _, not starting with a digit`;
    if (t !== "world" && (OWN_SCOPES as readonly string[]).includes(t)) return `@${t} is the Storylet Engine's own scope, so the game can't provide it`;
    if (EXTERNAL_SCOPES.includes(t)) return `@${t} belongs to another engine in the family, so the game can't declare it here`;
    if (seen.has(t)) return `@${t} is declared twice`;
    seen.add(t);
  }
  return undefined;
}

/** The host scopes as the shard keeps them (Patter's `scopeRegistry` shape): `@world` only
 *  when it declares something or the project already had it, so a project that never
 *  declared one isn't given an empty scope by opening the dialog. */
function hostScopesFromDtos(dtos: readonly HostScopeDto[], had: ReadonlySet<string>): HostScopeSpec[] {
  const out: HostScopeSpec[] = [];
  for (const h of dtos) {
    const token = h.token.trim();
    const declarations = h.opaque === true ? undefined : declsFromDtos(h.declarations);
    if (token === "world" && !had.has("world") && h.writable !== false && declarations !== undefined && declarations.length === 0) continue;
    out.push({
      token,
      // Writable is the default, so only the other answer is written.
      ...(h.writable === false ? { writable: false } : {}),
      ...(declarations !== undefined ? { declarations } : {}),
    });
  }
  return out;
}

/** The settings dialog's save: the whole project shard in one undo step (and
 *  the game's own scopes file with it, where the game shares its scopes). */
export async function saveProjectSettings(session: ProjectSession, dto: ProjectSettingsDto): Promise<Written> {
  const source = session.loaded.source;
  if (!source) return { error: "no project open" };
  const p = source.project;
  const problem = hostScopesProblem(dto.hostScopes);
  if (problem !== undefined) return { error: problem };
  // Where the game shares its scopes, the host scopes are the game's file: written FIRST,
  // with the project's own its synced copy (the same scopes, written below), so the project
  // still compiles packed or checked out alone (patterkit design/shared-scopes.md). A scope
  // the dialog showed and no longer holds goes from the file too. Asked before anything is
  // changed, so a game file that can't be read refuses the save whole.
  // What the project (or, for @world, the game's file) already declares.
  const had = new Set([...bundleHostScopes(p).map((h) => h.token), ...(sharedWorld(source) !== undefined ? ["world"] : [])]);
  const scopes = hostScopesFromDtos(dto.hostScopes, had);
  // A scope renamed in the dialog is the same scope under a new token: every reference to it
  // follows, rather than the old one going and a new one arriving (Ian, 2026-10-28).
  const renames = scopeRenames(dto.hostScopes, had);
  const clash = renameClash(source, renames, had);
  if (clash !== undefined) return { error: clash };
  const shown = settingsHostScopes(source).map((h) => h.token);
  const removed = shown.filter((t) => !scopes.some((h) => h.token === t) && !Object.hasOwn(renames, t) && (t !== "world" || had.has("world")));
  const shared = gameHostScopesWrite(source, scopes, removed, renames);
  if ("error" in shared) return shared;
  // Carried before the dialog's own edits land: the references are read in the project's
  // dialect as it stands, which still knows the old tokens.
  const dialect = projectDialect(source);
  const carried: FileState[] = [];
  for (const [from, to] of Object.entries(renames)) {
    const result = renameScope(source, from, to, dialect);
    if (result === undefined) return refuse(session, `@${from} can't be renamed to @${to}`);
    carried.push(...renameResultWrites(session, result));
  }
  p.project.name = dto.name;
  p.project.version = dto.version;
  // Host scopes like Patter's: the shard's `scopeRegistry`, none declared, none written.
  migrateLegacyWorld(p);
  if (scopes.length > 0) p.scopeRegistry = { version: p.scopeRegistry?.version ?? 1, scopes };
  else delete p.scopeRegistry;
  p.story.properties = declsFromDtos(dto.story);
  p.export.bundle = dto.bundlePath;
  p.export.metadata = dto.metadata;
  // Off is the default, so off is written as ABSENT rather than as `false`: a
  // shard says what an author chose, and a key nobody set is noise in a diff.
  if (dto.exportMap) p.export.map = true; else delete p.export.map;
  if (dto.warnUnreadWrites) p.validation = { warnUnreadWrites: true }; else delete p.validation;
  // The paired Patter project: absent when none, like every setting nobody chose.
  const patter = (dto.patterProject ?? "").trim();
  if (patter) p.patter = patter; else delete p.patter;
  p.settings.playAdvancesTurns = dto.playAdvancesTurns;
  // The play ladder's rung (design/engine-server.md 4.10). Written whatever it
  // is, "solo" included: it is a three-way choice, not an off/on flag, and a
  // shard that names its rung is one an author can read. The dialog refuses a
  // move down while content sits above the rung, so nothing arrives here that
  // would hide something the project contains.
  p.settings.play = dto.play;
  // The dialog's drivers still name a renamed scope by its old token.
  writeDrivers(p, dto.drivers.map((d) => ({ ...d, ref: renamedRef(d.ref.trim(), renames) })));
  // Version control (Patterpad's switch): the new system's setup files written, the old one's that the new
  // one does not have removed, all in this one step, so its Undo puts the old system back as it was. The
  // bundle posture carries across. A project that chose nothing yet keeps that until a system is picked.
  const fromVcs = p.vcs;
  const toVcs = dto.vcs === "" ? fromVcs : dto.vcs;
  if (toVcs !== undefined) p.vcs = toVcs;
  const vcs = vcsSwitchPlan(session.loaded.dir, fromVcs, toVcs);
  const vcsFiles: FileState[] = [
    ...vcs.writes.map((w) => ({ path: w.path, content: w.content })),
    ...vcs.removes.filter((path) => existsSync(path)).map((path) => ({ path, content: null })),
  ];
  // One step: the game's file, the project, every shard the renames rewrote (the project
  // shard last written wins, so it carries the dialog's edits) and the version control files.
  return commit(session, "Project settings", freshKey(), [...shared, ...dedupe([...carried, projectWrite(session)]), ...vcsFiles]);
}

/** The scopes the dialog renamed, old token to new: each saved under a token (other than
 *  @world, whose token is fixed) that the project still declares, now under another. */
function scopeRenames(dtos: readonly HostScopeDto[], had: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of dtos) {
    const from = h.savedAs?.trim();
    const to = h.token.trim();
    if (from === undefined || from === to || from === "world" || !had.has(from)) continue;
    out[from] = to;
  }
  return out;
}

/** Why the renames can't be made, or undefined when they can: a rename onto a token the
 *  project already declares (two scopes would become one, and the references of both would
 *  read as one), or one another tool in the game's scopes folder declares. */
function renameClash(source: SourceProject, renames: Record<string, string>, had: ReadonlySet<string>): string | undefined {
  for (const [from, to] of Object.entries(renames)) {
    if (had.has(to)) return `@${from} can't be renamed to @${to}: the project already has an @${to} scope. Save the change to @${to} first.`;
    if (source.gameScopes?.merged.owners.has(to)) return `@${from} can't be renamed to @${to}: the game's shared scopes already declare @${to}.`;
  }
  return undefined;
}

/** A driver's ref (`@player.hp`) under its scope's new token (`@hero.hp`). */
function renamedRef(ref: string, renames: Record<string, string>): string {
  const m = /^@([A-Za-z_][A-Za-z0-9_]*)\./.exec(ref);
  return m !== null && Object.hasOwn(renames, m[1]!) ? `@${renames[m[1]!]}${ref.slice(m[0].length - 1)}` : ref;
}

/** Writes by path, the last of each kept (in the place of the first). */
function dedupe(writes: FileState[]): FileState[] {
  const last = new Map(writes.map((w) => [w.path, w]));
  return [...new Map(writes.map((w) => [w.path, last.get(w.path)!])).values()];
}

/** Fold the edited driver list back into the shard's map. A driver with no
 *  property name or an empty pool is inert, so a half-typed row is dropped
 *  rather than written; a repeated ref keeps the last one, matching what the
 *  editor's duplicate guard has already flagged. */
function writeDrivers(p: ProjectShard, dtos: CoverageDriverDto[]): void {
  const drivers: Record<string, CoverageDriver> = {};
  for (const d of dtos) {
    const ref = d.ref.trim();
    if (ref === "" || ref.endsWith(".") || d.values.length === 0) continue;
    drivers[ref] = {
      kind: d.kind,
      ...(d.kind === "recurring" ? { cadence: d.cadence ?? "sometimes" } : {}),
      values: [...d.values],
    };
  }
  if (Object.keys(drivers).length > 0) {
    p.coverage = { ...p.coverage, drivers };
  } else if (p.coverage) {
    delete p.coverage.drivers;
    // Removing the last driver removes the block, rather than leaving an
    // empty `coverage: {}` behind in the shard.
    if (Object.keys(p.coverage).length === 0) delete p.coverage;
  }
}
