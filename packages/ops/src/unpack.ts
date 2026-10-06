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
//
// Containment is not enough on its own, though: `.git/config` is inside the
// target, and git runs what it names (CLI review 2026-10, item 1). So an entry
// is also refused outright when any segment of it starts with a dot, which no
// pack of ours carries (`pack` walks as the loader does, dot entries skipped),
// and only three kinds are ever written: a shard (by its extension), a picture
// directly in the root `assets/` under a name `isSafeAssetName` accepts, and a
// scopes file directly in `game-scopes/`. Anything else comes back in `other`,
// unwritten: that is where a server's `storylets.server.json` arrives.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS } from "@storylet-studio/model";
import { planShardMerge } from "./merge.js";
import type { MergeResult } from "./merge.js";
import { ASSETS_DIR, isSafeAssetName } from "./assets.js";
import { NotAPackError, PACK_MANIFEST } from "./pack.js";
import type { PlannedBinaryWrite, PlannedWrite } from "./write.js";
import { escapesTarget, isUnsafeEntry } from "@wildwinter/toolkit/archive";
import { GAME_SCOPES_DIR, GAME_SCOPES_FILE, SCOPES_FILE_SUFFIX } from "@wildwinter/scoperegistry/scopes";
import type { ProjectShard, PropertyDecl } from "@storylet-studio/model";
import { planGameWorld, readGameScopes } from "./game-scopes.js";

/** A pack entry whose path escapes the target directory, or that names a
 *  dot-file or dot-folder (always rejected). */
export class UnsafeEntryError extends Error {}

// The entry guards are @wildwinter/toolkit's. Both families had a correct copy,
// which is the state BEFORE a drift rather than proof there will not be one: a
// subtle weakening of one is a vulnerability nobody reads a diff for.
// Re-exported so nothing that imports it has to move.
export { isUnsafeEntry } from "@wildwinter/toolkit/archive";

/** Every shard extension, which is what makes an entry a shard wherever it is. */
const SHARD_EXTS: readonly string[] = Object.values(SHARD_EXTENSIONS);

/** What an entry is, by its name. A shard by its extension, wherever it sits, so
 *  a box folder called `assets` still holds shards; a picture only directly in
 *  the ROOT `assets/`, which is the one folder a project keeps them in; a scopes
 *  file only directly in `game-scopes/`, as a pack writes them; and anything
 *  else is `other`, never written. */
function entryKind(name: string): "shard" | "asset" | "scopes" | "other" {
  if (SHARD_EXTS.some((ext) => name.endsWith(ext))) return "shard";
  const parts = name.split("/");
  if (parts.length === 2 && parts[0] === ASSETS_DIR && isSafeAssetName(parts[1]!)) return "asset";
  if (parts.length === 2 && parts[0] === GAME_SCOPES_DIR && parts[1]!.endsWith(SCOPES_FILE_SUFFIX)) return "scopes";
  return "other";
}

/** Check an entry is bound for somewhere inside the target and names no
 *  dot-file: both checks of the header, then the third. */
function refuseUnsafe(targetDir: string, name: string): void {
  if (isUnsafeEntry(name) || escapesTarget(targetDir, name)) {
    throw new UnsafeEntryError(`pack entry escapes the target directory: ${name}`);
  }
  if (name.split("/").some((segment) => segment.startsWith("."))) {
    throw new UnsafeEntryError(`pack entry names a dot-file or dot-folder: ${name}`);
  }
}

/** A pack, read once: its shards, pictures and scopes snapshot, and the entries
 *  that are none of those (`other`, by entry name, never written). */
interface ReadPack {
  shards: Map<string, string>;
  assets: Map<string, Uint8Array>;
  scopes: Map<string, string>;
  other: Map<string, string>;
}

/** Read a pack, ONE inflation of the zip, every entry checked by one set of
 *  rules. A PNG read with `async("string")` is corrupted and a JSON5 parser
 *  handed one throws, so what an entry IS is decided before it is read.
 *  `targetDir` is where the entries are bound for, so containment is checked
 *  here rather than left to each caller to remember. */
async function readPack(bytes: Buffer | Uint8Array, targetDir: string, which: "pack" | "base" = "pack"): Promise<ReadPack> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new NotAPackError(which); }
  const out: ReadPack = { shards: new Map(), assets: new Map(), scopes: new Map(), other: new Map() };
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === PACK_MANIFEST) continue;
    refuseUnsafe(targetDir, name);
    const kind = entryKind(name);
    if (kind === "asset") out.assets.set(name, await entry.async("uint8array"));
    else (kind === "shard" ? out.shards : kind === "scopes" ? out.scopes : out.other).set(name, await entry.async("string"));
  }
  return out;
}

/** Sorted by path, which is the order every caller lists and commits them in. */
const byPath = <T extends { path: string }>(writes: T[]): T[] => writes.sort((a, b) => a.path.localeCompare(b.path));

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
  /** Every other entry, by its name in the pack, as text: NEVER to be written.
   *  A server's `storylets.server.json` arrives here, for the caller that wants
   *  it; anything else is a file no pack of ours carries. */
  other: Map<string, string>;
}

/** Explode a pack into planned writes under `targetDir`. Pure: the caller
 *  commits, so the same op serves the CLI and the editor. Throws
 *  `NotAPackError` for bytes that are not a zip, and `UnsafeEntryError` for an
 *  entry that would land outside the target or names a dot-file. */
export async function runUnpack(bytes: Buffer | Uint8Array, targetDir: string): Promise<UnpackResult> {
  const { shards, assets, scopes, other } = await readPack(bytes, targetDir);
  return {
    shards: byPath([...shards].map(([name, content]) => ({ path: join(targetDir, name), content }))),
    assets: byPath([...assets].map(([name, data]) => ({ path: join(targetDir, name), bytes: data }))),
    scopes: byPath([...scopes].map(([name, content]) => ({ path: join(targetDir, name), content }))),
    other,
  };
}

/** One shard's outcome in a merge-unpack. */
export interface MergedShard {
  /** Path relative to the project root. */
  path: string;
  /** The merge result; absent when the shard was ADDED by the other author. */
  result?: MergeResult;
  added: boolean;
  /** Whether there is a write for it: false when the merge left the shard
   *  saying exactly what it already says. */
  changed: boolean;
}

export interface UnpackMergeResult {
  shards: MergedShard[];
  /** Merged (and added) shard contents to write into the project: only the
   *  shards the merge changed. Commit `sidecars` FIRST: a merged shard whose
   *  sidecar never landed is a conflict resolved to ours without a word. */
  writes: PlannedWrite[];
  /** Conflict sidecars for shards that did not merge cleanly. */
  sidecars: PlannedWrite[];
  /** The returned pack's entries that are none of a shard, an asset or a
   *  scopes file, by name: never written. */
  other: Map<string, string>;
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
 * Per shard, `planShardMerge`: a 3-way merge, or a verbatim write when the
 * shard is new to us, and no write at all when the merge leaves a shard saying
 * what it already says. A shard the other author DELETED is left alone rather
 * than removed: a whole-file delete is not propagated, which loses nothing and
 * cannot destroy work that was never theirs to remove.
 */
export async function runUnpackMerge(
  returnedBytes: Buffer | Uint8Array,
  baseBytes: Buffer | Uint8Array,
  projectDir: string,
): Promise<UnpackMergeResult> {
  // Each pack read ONCE: until 2026-10-06 the returned one was inflated twice,
  // once for its shards and again for its pictures.
  const returned = await readPack(returnedBytes, projectDir, "pack");
  const theirs = returned.shards;
  const base = (await readPack(baseBytes, projectDir, "base")).shards;

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
    // The disposition is the one Storyletter's pull uses, from the one planner:
    // a shard we do not have is taken as it stands (refusing it would silently
    // drop new content), and one we do is three-wayed against the pack we sent.
    const step = planShardMerge({
      rel, path: outPath, theirs: theirText, base: base.get(rel),
      ours: existsSync(outPath) ? readFileSync(outPath, "utf8") : undefined,
      sides: { theirs: "returned", base: "sent" },
    });
    if (step.write !== undefined) writes.push(step.write);
    if (step.sidecar !== undefined) sidecars.push(step.sidecar);
    const result = step.result;
    if (result !== undefined) {
      conflicts += result.conflicts.length;
      warnings += result.warnings.length;
    }
    shards.push({ path: rel, ...(result !== undefined ? { result } : {}), added: step.outcome === "added", changed: step.write !== undefined });
    if (rel.endsWith(SHARD_EXTENSIONS.project)) {
      if (result !== undefined) mergedProject = { rel, shard: result.merged };
      else try { mergedProject = { rel, shard: parseSource(theirText) }; } catch { /* cannot say */ }
    }
  }

  // Assets are not merged, they are ADDED. There is no id-keyed structure inside
  // a PNG to three-way anything, so the only choices are take theirs, keep ours,
  // or refuse. Keep ours: an author's original must never be silently replaced by
  // a collaborator's re-saved copy, and a picture nobody has is worth having.
  const assets: PlannedBinaryWrite[] = [];
  const keptAssets: string[] = [];
  for (const [rel, data] of [...returned.assets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
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
    shards, writes, sidecars, other: returned.other, assets, keptAssets, conflicts, warnings, provenance,
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
