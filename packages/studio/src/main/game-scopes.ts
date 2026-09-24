// ---------------------------------------------------------------------------
// Storyletter's side of the game's shared scopes folder (patterkit
// design/shared-scopes.md). Everything that reads or writes the folder is in
// ops, shared with the CLI; this is the editor's use of it:
//
//   - every write of the project shard brings the Storylet Engine's own file
//     (`storylets.scopes.json`) up to date, and rewrites the project's copy of
//     `@world` from the game's file, in the same undoable step;
//   - the World settings write the game's file first, then that copy;
//   - what the renderer and the Board are told about the folder.
//
// With no folder, every function here is the identity or says nothing, so a
// project on its own is edited exactly as it always was.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  canonicalStringify, fromScopeDeclaration, gameTokens, parseSource, sharedWorld, storyletsScopesFile, STORYLETS_SCOPES_FILE,
} from "@storylet-studio/compiler";
import type { SourceProject } from "@storylet-studio/compiler";
import { OWN_SCOPES } from "@storylet-studio/dialect";
import { planGameWorld } from "@storylet-studio/ops";
import type { LoadedProject, UnpackMergeResult } from "@storylet-studio/ops";
import type { ProjectShard, PropertyDecl } from "@storylet-studio/model";
import { GAME_SCOPES_DIR, GAME_SCOPES_FILE, parseScopesFile, serialiseScopesFile } from "@wildwinter/scoperegistry/scopes";
import type { BoardScopesDto, ConditionProperty, GameScopesDto, PackMergeSummary } from "../shared/api.js";
import type { FileState } from "./history.js";

const read = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf8") : null);

/**
 * The writes of one commit, with the folder's share added: when the batch writes the project
 * shard and the game shares its scopes, the project's `@world` is rewritten from the shared
 * file (the synced copy a project keeps so it compiles on its own), and `storylets.scopes.json`
 * joins the batch whenever its text would change. One batch, so one undo puts all of it back.
 *
 * The shared world is read from the batch when the batch writes it (the World settings do,
 * first), and from disk otherwise, since any tool may have changed it since the project loaded.
 */
export function withGameScopes(source: SourceProject | undefined, dir: string, writes: FileState[]): FileState[] {
  const gameScopes = source?.gameScopes;
  if (!source || !gameScopes) return writes;
  const projectPath = join(dir, source.path);
  const index = writes.findIndex((w) => w.path === projectPath && w.content !== null);
  if (index < 0) return writes;
  const out = [...writes];
  let shard: ProjectShard;
  try { shard = parseSource(out[index]!.content!) as ProjectShard; } catch { return writes; }

  // The synced copy of @world, from whichever file declares it (game.scopes.json, by the design).
  const worldFile = join(gameScopes.dir, gameScopes.merged.owners.get("world")?.fileName ?? GAME_SCOPES_FILE);
  const worldText = out.find((w) => w.path === worldFile)?.content ?? read(worldFile);
  const world = worldText === null ? undefined
    : parseScopesFile(worldText, GAME_SCOPES_FILE).file?.scopes.find((s) => s.token === "world");
  if (world?.declarations) {
    const copy: PropertyDecl[] = world.declarations.map((d) => fromScopeDeclaration(d, world.writable));
    if (canonicalStringify(copy) !== canonicalStringify(shard.world.properties)) {
      shard.world.properties = copy;
      out[index] = { path: projectPath, content: canonicalStringify(shard) };
    }
  }

  // The Storylet Engine's own file: what the other tools read of this project.
  const ours = join(gameScopes.dir, STORYLETS_SCOPES_FILE);
  const text = serialiseScopesFile(storyletsScopesFile(shard));
  if (read(ours) !== text && !out.some((w) => w.path === ours)) out.push({ path: ours, content: text });
  return out;
}

/**
 * The World settings' write when the game shares its scopes: `game.scopes.json` with its
 * `world` replaced (re-read now, every other scope in it kept), to go FIRST in the batch,
 * ahead of the project's copy. Nothing when there is no folder or the file already says it.
 */
export function gameWorldWrite(source: SourceProject | undefined, world: PropertyDecl[]): FileState[] | { error: string } {
  const gameScopes = source?.gameScopes;
  if (!gameScopes) return [];
  const planned = planGameWorld(gameScopes.dir, world);
  if ("error" in planned) return planned;
  return planned.write ? [{ path: planned.write.path, content: planned.write.content }] : [];
}

/** The folder, as the renderer's expression editors need it. */
export function gameScopesDto(loaded: LoadedProject): GameScopesDto | undefined {
  const gameScopes = loaded.source?.gameScopes;
  if (!gameScopes) return undefined;
  const tokens = gameTokens(gameScopes.merged, OWN_SCOPES);
  return {
    dir: gameScopes.dir,
    tokens,
    opaque: tokens.filter((t) => gameScopes.merged.spec.scopes.find((s) => s.token === t)?.declarations === undefined),
    sharedWorld: sharedWorld(loaded.source!) !== undefined,
  };
}

/**
 * A merged returned pack's World edit (patterkit design/shared-scopes.md, "Packs"), as the
 * merge's confirmation tells it: the game's file it goes to, named as the World settings name
 * it, or why it can't. Nothing when the other author left the World alone, or there is no folder.
 */
export function returnedWorldSummary(gameWorld: UnpackMergeResult["gameWorld"]): Pick<PackMergeSummary, "gameWorld" | "gameWorldError"> {
  if (gameWorld === undefined) return {};
  if ("error" in gameWorld) return { gameWorldError: gameWorld.error };
  return { gameWorld: `${basename(dirname(gameWorld.path))}/${basename(gameWorld.path)}` };
}

/** ...and the write it adds to the merge's batch, so the one undo puts it back with the rest.
 *  Without it the next save would rewrite the project's copy from the game's file, and lose
 *  the edit without a word. */
export function returnedWorldWrites(gameWorld: UnpackMergeResult["gameWorld"]): FileState[] {
  return gameWorld !== undefined && !("error" in gameWorld) ? [{ path: gameWorld.path, content: gameWorld.content }] : [];
}

/** Where the World settings write first, as the dialog names it; undefined with no folder. */
export const worldFileLabel = (source: SourceProject): string | undefined =>
  (source.gameScopes ? `${GAME_SCOPES_DIR}/${source.gameScopes.merged.owners.get("world")?.fileName ?? GAME_SCOPES_FILE}` : undefined);

/** The other tools' properties for the picker: every declared scope in the folder except the
 *  engine's own (`@world` among them, which the project's catalogue already carries from the
 *  shared file), each with who declares it. */
export function otherToolsCatalogue(source: SourceProject): ConditionProperty[] {
  const merged = source.gameScopes?.merged;
  if (!merged) return [];
  const out: ConditionProperty[] = [];
  for (const s of merged.spec.scopes) {
    if ((OWN_SCOPES as readonly string[]).includes(s.token)) continue;
    const owner = merged.owners.get(s.token)?.owner;
    for (const d of s.declarations ?? []) {
      out.push({
        scope: s.token, name: d.name, type: d.type,
        ...(d.values !== undefined ? { enumValues: d.values } : {}),
        ...(d.stages !== undefined ? { stages: d.stages } : {}),
        ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
        ...(owner !== undefined ? { owner } : {}),
      });
    }
  }
  return out;
}

/** The folder for the Board, as plain data (a Map does not cross the window boundary as one). */
export function boardScopes(source: SourceProject): BoardScopesDto | undefined {
  const merged = source.gameScopes?.merged;
  if (!merged) return undefined;
  return { spec: structuredClone(merged.spec) as BoardScopesDto["spec"], owners: Object.fromEntries(merged.owners) };
}
