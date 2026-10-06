// ---------------------------------------------------------------------------
// The pack op (Reboot 7.1): snapshot a sharded project into a single portable
// `.storyletpack` - the send-and-return envelope for handing a project to
// someone with no shared version control.
//
// Patter's `.patterpack`, carried over exactly. Two properties matter and they
// pull in the same direction:
//
//   - It is a LOSSLESS COPY OF THE SHARDS, never a second source of truth. The
//     raw file bytes are zipped rather than re-serialised through the model, so
//     hand edits, comments and formatting survive the round trip untouched.
//   - It is SINGLE-FILE ON PURPOSE. A zip (like a .docx) cannot be
//     shard-merged, which is the point: it reads as "this is a delivery", not
//     as the canonical files. The canonical files stay in version control.
//
// `unpack` is the inverse, and `unpack --merge` is the return leg.
// ---------------------------------------------------------------------------

import { CONFLICT_SIDECAR_EXTENSION } from "./merge.js";
import JSZip from "jszip";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseSource, walkProjectFiles } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS } from "@storylet-studio/model";
import type { ProjectShard } from "@storylet-studio/model";
import { ASSETS_DIR, assetUse } from "./assets.js";
import { findProjectDir, loadProject } from "./load.js";
import type { LoadedProject } from "./load.js";
import { ARCHIVE_ENTRY_OPTS } from "@wildwinter/toolkit/archive";
import { GAME_SCOPES_DIR } from "@wildwinter/scoperegistry/scopes";
import { readGameScopes } from "./game-scopes.js";

export const PACK_MANIFEST = "storylets.manifest.json";
export const PACK_EXTENSION = ".storyletpack";
export const PACK_SCHEMA = "storylets/pack@0";

/** The manifest at the pack root: what this envelope is, and what is in it. */
export interface PackManifest {
  schema: typeof PACK_SCHEMA;
  project: { id: string; name: string };
  /** Shard paths (relative, forward-slashed), sorted: the pack's contents. */
  files: string[];
  /** Binary assets carried, if any (relative, forward-slashed, sorted). Listed
   *  APART from the shards because a reader has to treat them differently: a
   *  merge parses a shard and must not parse a picture. Absent, rather than
   *  empty, when a pack carries none, so an older reader sees the shape it
   *  expects. */
  assets?: string[];
  /** The game's shared scopes files carried, if any: file names, sorted, each
   *  in the pack as `game-scopes/<name>`. A read-only snapshot for the
   *  recipient, so their tool checks, offers and previews the other engines'
   *  names (patterkit design/shared-scopes.md, "Packs"); never a shard, and
   *  never written back by a merge. Absent, rather than empty, when the project
   *  has no folder, so such a pack is the pack it always was. */
  gameScopes?: string[];
}

export interface PackOptions {
  /**
   * Carry the project's binary assets (the project map's background images).
   *
   * Undefined means "ask the project", whose export block holds the default. A
   * pack is a DELIVERY, though, and the same project might send a designer the
   * whole site plan and a writer only the words, so the caller can override it
   * per pack (2026-08-07: a project setting with a pack-time override).
   */
  assets?: boolean;
}

/** Every shard extension a pack carries. */
const SHARD_EXTS = Object.values(SHARD_EXTENSIONS);

// A fixed timestamp keeps the zip byte-reproducible: re-packing unchanged
// source yields an identical file, so a pack can be diffed and hashed.
// `createFolders` must stay off - JSZip stamps implicit folder entries with
// new Date() whatever the entry's own `date` says, which would leak wall-clock
// time into the bytes.
// The reproducibility settings are @wildwinter/toolkit's: a fixed entry date
// and no folder entries, so an unchanged project packs to the same bytes.
const ENTRY_OPTS = ARCHIVE_ENTRY_OPTS;

export class PackError extends Error {}

/** Bytes that are not a pack at all: not a zip. `which` says which of the two
 *  packs a merge was given, since the message has to name the file. */
export class NotAPackError extends PackError {
  constructor(readonly which: "pack" | "base" = "pack") {
    super("not a .storyletpack");
  }
}

/**
 * Pack a project's source shards into `.storyletpack` bytes.
 *
 * `project` is a path at or inside the project, or the project already loaded:
 * a caller that has loaded it to report its problems (the CLI) or has it open
 * (the editor) passes it, and the project is not read a second time. The tree is
 * walked ONCE, for the shards and the conflict sidecars together.
 */
export async function runPack(project: string | LoadedProject, opts: PackOptions = {}): Promise<Buffer> {
  const root = typeof project === "string" ? findProjectDir(project) : project.dir;
  if (root === undefined) throw new PackError(`not a storylets project: ${String(project)}`);

  // The project shard as the loader read it, or straight off the disk when the
  // project would not load: a project somebody needs to FIX is still a delivery.
  const loaded = typeof project === "string" ? loadProject(root) : project;
  const projectFileName = loaded.source?.path ?? readdirSync(root).find((f) => f.endsWith(SHARD_EXTENSIONS.project));
  if (projectFileName === undefined) throw new PackError(`no project shard in ${root}`);
  const shard = loaded.source?.project
    ?? parseSource(readFileSync(join(root, projectFileName), "utf8")) as ProjectShard;

  // Layout-independent: whatever the folder shape, every shard under the root
  // travels. The compiled bundle deliberately does NOT - a pack is source.
  const walked = walkProjectFiles(root, [...SHARD_EXTS, CONFLICT_SIDECAR_EXTENSION])
    .map((abs) => ({ abs, rel: relative(root, abs).split(sep).join("/") }));

  // An unresolved merge must not travel. A pack is what somebody else opens and
  // works from, and the merged model resolves conflicted values PROVISIONALLY
  // to ours - so packing one hands over a discarded edit as though it were
  // agreed, with nothing on the receiving side to say so. merge.ts has stated
  // the rule since it was written ("an unresolved merge cannot reach CI or
  // export"); only validate enforced it until 2026-08-29.
  const sidecars = walked.filter((f) => f.rel.endsWith(CONFLICT_SIDECAR_EXTENSION)).map((f) => f.rel);
  if (sidecars.length > 0) {
    throw new PackError(
      `unresolved merge in this project, so it cannot be packed:\n  ${sidecars.join("\n  ")}\n`
      + "Resolve the conflicts and delete the .storyletconflict sidecars first.");
  }
  const files = walked.sort((a, b) => a.rel.localeCompare(b.rel));

  // Assets travel only when asked, and the ask has two levels: the project's own
  // default, overridden per pack. Some projects would benefit from sending their
  // pictures and others never would, so neither "always" nor "never" is right.
  const wanted = opts.assets ?? shard.export?.packAssets ?? false;
  // REFERENCED assets only. An orphan is a file no map uses - ordinary work makes
  // them, since undoing an import keeps its bytes on purpose - and a delivery
  // should carry the project's content rather than everything that has ever been
  // in the folder. Nothing is lost: the sender still has the file.
  const assets = wanted && loaded.source !== undefined
    ? assetUse(root, loaded.source).used.map((name) => ({ abs: join(root, ASSETS_DIR, name), rel: `${ASSETS_DIR}/${name}` }))
    : [];

  // The game's shared scopes, when the project has a folder: found exactly as
  // the loader finds it (the `gameScopes` override included), and carried as
  // the text on disk. The folder sits above the project, so without this the
  // recipient's tool would work alone. No folder carries nothing, and the pack
  // is byte for byte what it was before packs carried scopes.
  const scopes = gameScopesFiles(root, projectFileName, shard.gameScopes);

  const manifest: PackManifest = {
    schema: PACK_SCHEMA,
    project: { id: shard.project.id, name: shard.project.name },
    files: files.map((f) => f.rel),
    ...(assets.length > 0 ? { assets: assets.map((a) => a.rel) } : {}),
    ...(scopes.length > 0 ? { gameScopes: scopes.map((f) => f.name) } : {}),
  };

  const zip = new JSZip();
  zip.file(PACK_MANIFEST, JSON.stringify(manifest, null, 2) + "\n", ENTRY_OPTS);
  for (const f of files) zip.file(f.rel, readFileSync(f.abs, "utf8"), ENTRY_OPTS);
  // Bytes, not text. Reading a PNG as utf8 and writing it back does not survive
  // the round trip, which is the whole reason assets needed this pass.
  for (const a of assets) zip.file(a.rel, readFileSync(a.abs), { ...ENTRY_OPTS, binary: true });
  for (const f of scopes) zip.file(`${GAME_SCOPES_DIR}/${f.name}`, f.text, ENTRY_OPTS);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: false });
}

/** Every `*.scopes.json` in the project's game scopes folder, sorted, with its
 *  text; none when there is no folder, or when the one the project names is not
 *  there (validate says so; a pack is still a delivery). */
function gameScopesFiles(root: string, projectFileName: string, override: unknown): { name: string; text: string }[] {
  const found = readGameScopes(root, projectFileName, override).gameScopes;
  if (found === undefined) return [];
  const out: { name: string; text: string }[] = [];
  for (const name of found.files) {
    // A file that can't be read now has been reported by the loader; it is
    // left out rather than taking the whole delivery down.
    try { out.push({ name, text: readFileSync(join(found.dir, name), "utf8") }); } catch { /* left out */ }
  }
  return out;
}

/** Read a pack's manifest without exploding it (the editor's "what is this?").
 *  Undefined for a zip with no manifest, and for bytes that are not a zip. */
export async function readPackManifest(bytes: Buffer | Uint8Array): Promise<PackManifest | undefined> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return undefined; }
  const entry = zip.file(PACK_MANIFEST);
  if (!entry) return undefined;
  try {
    return JSON.parse(await entry.async("string")) as PackManifest;
  } catch {
    return undefined;
  }
}
