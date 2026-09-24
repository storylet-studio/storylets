// ---------------------------------------------------------------------------
// The unpack op (Reboot 7.1): explode a `.storyletpack` back into source
// shards. The inverse of `pack`, and the return leg of the round trip.
//
// Two modes:
//   - EXTRACT (`runUnpack`): write the pack's shards into a target directory.
//     What the receiving author does with a pack that arrives.
//   - MERGE (`runUnpackMerge`): fold a RETURNED pack's edits back into an
//     existing working copy through the id-keyed 3-way merge. The common
//     ancestor comes from the pack that was originally SENT (`--base`), which
//     the sender keeps: the round trip is then self-contained, with no version
//     control lookup at either end. (Embedding the base in the returned pack is
//     a later refinement; it would make `--base` optional.)
//
// A pack may arrive from someone outside the team, over a channel nobody
// controls, so entry paths are validated before anything is written. TWO
// independent checks, because neither alone is enough:
//
//   1. `isUnsafeEntry` on the entry name. This catches an ABSOLUTE path, which
//      JSZip's loader preserves verbatim ("/etc/passwd" stays "/etc/passwd").
//   2. Containment of the RESOLVED write path inside the target. This catches
//      traversal, which check 1 cannot see: JSZip's loader silently collapses
//      "../../evil" to "evil", so by the time we read the entry name the `..`
//      is gone. That collapse happens to keep us inside the target, but it is
//      JSZip's behaviour rather than our guarantee, and another reader might
//      not do it. This check does not care who built the zip or which library
//      read it: the path either lands inside the target or it does not.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS } from "@storylet-studio/model";
import { CONFLICT_SIDECAR_EXTENSION, conflictSidecar, runMerge, MergeInputError } from "./merge.js";
import type { MergeResult } from "./merge.js";
import { ASSETS_DIR } from "./assets.js";
import { PACK_MANIFEST } from "./pack.js";
import type { PlannedBinaryWrite, PlannedWrite } from "./write.js";
import { escapesTarget, isUnsafeEntry } from "@wildwinter/toolkit/archive";
import { GAME_SCOPES_DIR, GAME_SCOPES_FILE, SCOPES_FILE_SUFFIX } from "@wildwinter/scoperegistry/scopes";
import type { ProjectShard, PropertyDecl } from "@storylet-studio/model";
import { planGameWorld, readGameScopes } from "./game-scopes.js";

/** A pack entry whose path escapes the target directory (always rejected). */
export class UnsafeEntryError extends Error {}

// The entry guards are @wildwinter/toolkit's. Both families had a correct copy,
// which is the state BEFORE a drift rather than proof there will not be one: a
// subtle weakening of one is a vulnerability nobody reads a diff for.
// Re-exported so nothing that imports it has to move.
export { isUnsafeEntry } from "@wildwinter/toolkit/archive";
/** Is this entry one of a box's binary assets rather than a shard? By WHERE it
 *  is, matching how a pack collects them: a format nobody thought of still
 *  travels, and still must not be read as text. */
const isAssetEntry = (name: string): boolean => name.split("/").includes(ASSETS_DIR);

/** Is this entry one of the game's shared scopes files a pack carries as a
 *  snapshot (`game-scopes/<name>.scopes.json`)? Neither a shard nor an asset.
 *  Only a scopes file directly in the folder, as a pack writes them, so a box
 *  folder that happened to share the name would still be read as shards. */
const isScopesEntry = (name: string): boolean => {
  const parts = name.split("/");
  return parts.length === 2 && parts[0] === GAME_SCOPES_DIR && parts[1]!.endsWith(SCOPES_FILE_SUFFIX);
};

/** Check an entry is bound for somewhere inside the target. Both checks, for the
 *  reasons in the header: neither is enough alone. */
function refuseEscape(targetDir: string, name: string): void {
  if (isUnsafeEntry(name) || escapesTarget(targetDir, name)) {
    throw new UnsafeEntryError(`pack entry escapes the target directory: ${name}`);
  }
}

/** A pack's shards as relative path -> text. The manifest is not a shard, and
 *  neither is an asset: reading a PNG with `async("string")` corrupts it, and
 *  handing one to a JSON5 parser is how a merge would throw on somebody's site
 *  plan. `targetDir` is where the shards are bound for, so containment is checked
 *  here rather than left to each caller to remember. */
async function readPackShards(bytes: Buffer | Uint8Array, targetDir: string): Promise<Map<string, string>> {
  return (await readPack(bytes, targetDir)).shards;
}

/** A pack's shards, assets AND game scopes snapshot, from ONE read of the zip.
 *
 *  `runUnpack` used to call two readers that each did their own
 *  `JSZip.loadAsync`, so every unpack inflated the archive twice - and the
 *  containment check `refuseEscape` was applied by two separate passes that
 *  had to stay in step. One pass, one set of rules. */
async function readPack(
  bytes: Buffer | Uint8Array,
  targetDir: string,
): Promise<{ shards: Map<string, string>; assets: Map<string, Uint8Array>; scopes: Map<string, string> }> {
  const zip = await JSZip.loadAsync(bytes);
  const shards = new Map<string, string>();
  const assets = new Map<string, Uint8Array>();
  const scopes = new Map<string, string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === PACK_MANIFEST) continue;
    // Every entry that is not the manifest is going somewhere on disk, so it
    // is checked once, here, whichever part it belongs to.
    refuseEscape(targetDir, name);
    if (isScopesEntry(name)) scopes.set(name, await entry.async("string"));
    else if (isAssetEntry(name)) assets.set(name, await entry.async("uint8array"));
    else shards.set(name, await entry.async("string"));
  }
  return { shards, assets, scopes };
}

/** What a pack explodes into: text to write, and bytes to write. */
export interface UnpackResult {
  shards: PlannedWrite[];
  assets: PlannedBinaryWrite[];
  /** The game's shared scopes the pack carried, bound for `game-scopes/` INSIDE
   *  the unpacked project folder, where discovery looks first: the recipient's
   *  checks, pickers and previews then know the other engines' names. Empty for
   *  a pack from a project with no folder, and for any pack from before packs
   *  carried scopes. */
  scopes: PlannedWrite[];
}

/** Explode a pack into planned writes under `targetDir`. Pure: the caller
 *  commits, so the same op serves the CLI and the editor. */
export async function runUnpack(bytes: Buffer | Uint8Array, targetDir: string): Promise<UnpackResult> {
  const { shards, assets, scopes } = await readPack(bytes, targetDir);
  return {
    shards: [...shards.entries()]
      .map(([name, content]) => ({ path: join(targetDir, name), content }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    assets: [...assets.entries()]
      .map(([name, data]) => ({ path: join(targetDir, name), bytes: data }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    scopes: [...scopes.entries()]
      .map(([name, content]) => ({ path: join(targetDir, name), content }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** One shard's outcome in a merge-unpack. */
export interface MergedShard {
  /** Path relative to the project root. */
  path: string;
  /** The merge result; absent when the shard was ADDED by the other author. */
  result?: MergeResult;
  added: boolean;
}

export interface UnpackMergeResult {
  shards: MergedShard[];
  /** Merged (and added) shard contents to write into the project. */
  writes: PlannedWrite[];
  /** Conflict sidecars for shards that did not merge cleanly. */
  sidecars: PlannedWrite[];
  /** Assets the returned pack brought that we do not have. One we DO have is
   *  never overwritten (see the note at the merge). */
  assets: PlannedBinaryWrite[];
  /** Assets the pack carried that we already had, and therefore kept. Reported
   *  so the receiving author is told rather than left guessing. */
  keptAssets: string[];
  conflicts: number;
  warnings: number;
  /** Whether the three project ids agree. Never a refusal - see `ProvenanceCheck`. */
  provenance: ProvenanceCheck;
  /**
   * The recipient's World edit, carried to the game's own `game.scopes.json`:
   * the write, or why it cannot be made (that file will not parse). Present
   * only when the project has a game scopes folder AND the returned project
   * declares other World properties than the pack that was sent; absent
   * otherwise, and then nothing outside the project is touched. See the note
   * at the end of `runUnpackMerge`.
   */
  gameWorld?: PlannedWrite | { path: string; error: string };
}

/**
 * Do the returned pack, the base pack and the target project agree about which
 * project this is?
 *
 * A WARNING, never a refusal, and the Patter side argued us out of the opposite
 * (patterkit to-storylets, provenance-we-built-different-things). Three reasons
 * that hold: an id can legitimately differ, because projects get forked and ids
 * get reissued after a template copy; a refusal with no override is a wall rather
 * than a guard, and the only way past it would be hand-editing a project file to
 * fake an id, which is a far worse thing to teach than a confirmation; and the
 * refusal contradicted this file's own fail-soft reasoning, which accepts the
 * wrong-ANCESTOR case precisely because it degrades into visible, recoverable
 * conflicts. A wrong-project merge does the same, only more so.
 *
 * THREE ids rather than two, which is the case a two-way check cannot see: the
 * author picks the right returned pack and the wrong BASE. The base is the second
 * prompt, answered from memory about which outbox file went out in March, so it is
 * the likeliest slip in the whole flow - and returned-versus-project agrees
 * cleanly while the merge mints exactly the pile of spurious conflicts this exists
 * to prevent.
 *
 * An id that cannot be read cannot disagree: a pack with no project shard, or one
 * that will not parse, is a "cannot say" and merges. This catches a slip of the
 * file picker, not a zip from another tool.
 */
export interface ProvenanceCheck {
  /** The project id each side claims, where it could be read at all. */
  returned?: string;
  base?: string;
  project?: string;
  /** The returned pack is from another project than the one being merged into. */
  wrongProject: boolean;
  /** The base pack is from another project: the wrong ancestor was chosen. */
  wrongBase: boolean;
  /** Anything to say at all. False is the quiet, common case. */
  mismatch: boolean;
  /** One line for a dialog headline or a CLI warning, or undefined when quiet. */
  message?: string;
}

/**
 * Compare the three project ids: the returned pack's, the base pack's, and the
 * project being merged into. See `ProvenanceCheck` for why it warns rather than
 * refuses, and why the base is worth comparing.
 */
function checkProvenance(
  theirs: Map<string, string>, base: Map<string, string>, projectDir: string,
): ProvenanceCheck {
  const returned = projectIdOf(theirs);
  const baseId = projectIdOf(base);
  const project = localProjectId(projectDir, theirs);
  const differs = (a: string | undefined, b: string | undefined): boolean =>
    a !== undefined && b !== undefined && a !== b;
  const wrongProject = differs(returned, project);
  const wrongBase = differs(baseId, project) || differs(baseId, returned);
  const mismatch = wrongProject || wrongBase;
  // Named ids in the message, because "a different project" leaves an author with
  // nothing to check against. The Patter side asked for this wording specifically.
  const message = !mismatch ? undefined
    : wrongProject
      ? `The returned pack is from a different project: it carries project id ${returned}, and this project is ${project}. That usually means the wrong file was chosen.`
      : `The pack you sent is from a different project: it carries project id ${baseId}, and this project is ${project}. Merging against the wrong ancestor produces conflicts that are not real.`;
  return {
    ...(returned !== undefined ? { returned } : {}),
    ...(baseId !== undefined ? { base: baseId } : {}),
    ...(project !== undefined ? { project } : {}),
    wrongProject, wrongBase, mismatch,
    ...(message !== undefined ? { message } : {}),
  };
}

/** The `id` of the project shard in a pack's shard map, or undefined when the
 *  pack carries no project shard or it has no id (a "cannot say", not a match). */
function projectIdOf(shards: Map<string, string>): string | undefined {
  const ext = SHARD_EXTENSIONS.project;
  for (const [rel, text] of shards) {
    if (!rel.endsWith(ext)) continue;
    // GUARDED, like localProjectId below. The doc four lines up promises that
    // a project shard "that will not parse" is a cannot-say and merges; this
    // parsed it bare, so a corrupt one threw a raw JSON5 error out of
    // runUnpackMerge and took the whole return leg down - every shard, not
    // just this one - instead of warning and proceeding. Found by the
    // pre-release audit, 2026-08-29.
    try {
      const parsed = parseSource(text) as { project?: { id?: unknown } };
      const id = parsed.project?.id;
      return typeof id === "string" && id !== "" ? id : undefined;
    } catch { return undefined; }
  }
  return undefined;
}

/** The local project's id, found at the same relative path the pack used for its
 *  project shard. Undefined when that file is absent or unreadable. */
function localProjectId(projectDir: string, theirs: Map<string, string>): string | undefined {
  const ext = SHARD_EXTENSIONS.project;
  const rel = [...theirs.keys()].find((r) => r.endsWith(ext));
  if (rel === undefined) return undefined;
  const path = join(projectDir, rel);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = parseSource(readFileSync(path, "utf8")) as { project?: { id?: unknown } };
    const id = parsed.project?.id;
    return typeof id === "string" && id !== "" ? id : undefined;
  } catch { return undefined; }
}

/**
 * Merge a RETURNED pack (`theirs`) into the project at `projectDir` (`ours`),
 * using the pack originally sent (`base`) as the common ancestor.
 *
 * Per shard: a 3-way merge, or a verbatim write when the shard is new to us.
 * A shard the other author DELETED is left alone rather than removed: a
 * whole-file delete is not propagated, which loses nothing and cannot destroy
 * work that was never theirs to remove.
 */
export async function runUnpackMerge(
  returnedBytes: Buffer | Uint8Array,
  baseBytes: Buffer | Uint8Array,
  projectDir: string,
): Promise<UnpackMergeResult> {
  const theirs = await readPackShards(returnedBytes, projectDir);
  const base = await readPackShards(baseBytes, projectDir);

  // The provenance check: three ids, and a WARNING rather than a refusal. The
  // reasoning is on `ProvenanceCheck`, and the shape is the Patter side's, which
  // this repo adopted after building the two-way refusing version first.
  const provenance = checkProvenance(theirs, base, projectDir);

  const shards: MergedShard[] = [];
  const writes: PlannedWrite[] = [];
  const sidecars: PlannedWrite[] = [];
  let conflicts = 0;
  let warnings = 0;
  /** The project shard as the merge leaves it, for the World check below. */
  let mergedProject: { rel: string; shard: unknown } | undefined;

  for (const [rel, theirText] of [...theirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const outPath = join(projectDir, rel);
    if (!existsSync(outPath)) {
      // A shard we do not have: take it as it stands. There is nothing to
      // merge against, and refusing it would silently drop new content.
      writes.push({ path: outPath, content: theirText });
      shards.push({ path: rel, added: true });
      if (rel.endsWith(SHARD_EXTENSIONS.project)) {
        try { mergedProject = { rel, shard: parseSource(theirText) }; } catch { /* cannot say */ }
      }
      continue;
    }
    const baseText = base.get(rel);
    // Named parses. A shard that will not parse still stops the merge - you
    // cannot three-way what you cannot read, and half-merging a return leg is
    // worse than refusing it - but it used to stop it with a raw JSON5 error
    // naming no file, out of a call the author made on a whole project. Now it
    // says which shard and which side. Found by the pre-release audit.
    const read = (text: string, side: string): Record<string, unknown> => {
      try { return parseSource(text) as Record<string, unknown>; }
      catch (e) {
        throw new MergeInputError(
          `${rel}: the ${side} copy will not parse (${e instanceof Error ? e.message : String(e)})`);
      }
    };
    const ours = read(readFileSync(outPath, "utf8"), "local");
    const theirsObj = read(theirText, "returned");
    // No base entry means the shard did not exist when we sent the pack, so
    // there is no ancestor: an empty base makes every field of theirs an add.
    // `runMerge` exempts an empty base from its schema-skew check for exactly
    // this case - until 2026-09-06 it did not, and a file two people had each
    // created independently took the whole return leg down with it.
    const baseObj = baseText !== undefined ? read(baseText, "sent") : {};

    const result = runMerge(baseObj, ours, theirsObj);
    if (rel.endsWith(SHARD_EXTENSIONS.project)) mergedProject = { rel, shard: result.merged };
    writes.push({ path: outPath, content: canonicalStringify(result.merged) });
    if (result.conflicts.length > 0) {
      sidecars.push({ path: `${outPath}${CONFLICT_SIDECAR_EXTENSION}`, content: conflictSidecar(result) });
      conflicts += result.conflicts.length;
    }
    warnings += result.warnings.length;
    shards.push({ path: rel, result, added: false });
  }

  // Assets are not merged, they are ADDED. There is no id-keyed structure inside
  // a PNG to three-way anything, so the only choices are take theirs, keep ours,
  // or refuse. Keep ours: an author's original must never be silently replaced by
  // a collaborator's re-saved copy, and a picture nobody has is worth having.
  const theirAssets = (await readPack(returnedBytes, projectDir)).assets;
  const assets: PlannedBinaryWrite[] = [];
  const keptAssets: string[] = [];
  for (const [rel, data] of [...theirAssets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const outPath = join(projectDir, rel);
    if (existsSync(outPath)) keptAssets.push(rel);
    else assets.push({ path: outPath, bytes: data });
  }

  // The game's shared scopes are NOT merged: the snapshot either pack carries
  // is never written anywhere, since the sender's folder is the truth and the
  // returned copy is only what the recipient was shown. One thing in it can
  // have been edited on purpose, though: the World properties, which the
  // recipient's tool wrote to its snapshot AND to the project's synced copy.
  // That copy has just merged, but the next save here rewrites it from
  // `game.scopes.json`, which would drop the edit without a word. So where the
  // project has a folder and the returned project's World differs from the
  // sent one's, the merged World goes to the game's file too, and is reported.
  const gameWorld = mergedProject !== undefined
    ? planReturnedWorld(projectDir, mergedProject, theirs, base)
    : undefined;

  return {
    shards, writes, sidecars, assets, keptAssets, conflicts, warnings, provenance,
    ...(gameWorld !== undefined ? { gameWorld } : {}),
  };
}

/** A project shard's World declarations, canonical, or undefined when they
 *  cannot be read (a "cannot say", which writes nothing). */
function worldText(shards: Map<string, string>, rel: string): string | undefined {
  const text = shards.get(rel);
  if (text === undefined) return undefined;
  try {
    const properties = (parseSource(text) as Partial<ProjectShard>).world?.properties;
    return Array.isArray(properties) ? canonicalStringify(properties) : undefined;
  } catch { return undefined; }
}

/** The local project shard's `gameScopes` override, as the loader would read
 *  it, or undefined (none, or a shard that will not parse, which the merge has
 *  already refused). */
function localOverride(projectDir: string, rel: string): unknown {
  const path = join(projectDir, rel);
  if (!existsSync(path)) return undefined;
  try { return (parseSource(readFileSync(path, "utf8")) as Partial<ProjectShard>).gameScopes; }
  catch { return undefined; }
}

/** The write that carries a returned World edit to `game.scopes.json`, or
 *  undefined when there is nothing to carry: no folder, no edit, or the file
 *  already says it. See the note at the call. */
function planReturnedWorld(
  projectDir: string, merged: { rel: string; shard: unknown },
  theirs: Map<string, string>, base: Map<string, string>,
): PlannedWrite | { path: string; error: string } | undefined {
  const returned = worldText(theirs, merged.rel);
  const sent = worldText(base, merged.rel);
  if (returned === undefined || sent === undefined || returned === sent) return undefined;
  const shard = merged.shard as Partial<ProjectShard>;
  const world = shard.world?.properties;
  if (!Array.isArray(world)) return undefined;
  // The folder as the loader finds it for the project being merged into, its
  // own `gameScopes` override included: ours as it stands on disk, since where
  // this game keeps its folder is not the recipient's to say.
  const found = readGameScopes(projectDir, merged.rel, localOverride(projectDir, merged.rel)).gameScopes;
  if (found === undefined) return undefined;
  const planned = planGameWorld(found.dir, world as PropertyDecl[]);
  if ("error" in planned) return { path: join(found.dir, GAME_SCOPES_FILE), error: planned.error };
  return planned.write;
}
