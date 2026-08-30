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

/** The manifest at the pack root: what this envelope is, and what is in it. */
export interface PackManifest {
  schema: "storylets/pack@0";
  project: { id: string; name: string };
  /** Shard paths (relative, forward-slashed), sorted: the pack's contents. */
  files: string[];
  /** Binary assets carried, if any (relative, forward-slashed, sorted). Listed
   *  APART from the shards because a reader has to treat them differently: a
   *  merge parses a shard and must not parse a picture. Absent, rather than
   *  empty, when a pack carries none, so an older reader sees the shape it
   *  expects. */
  assets?: string[];
}

export interface PackOptions {
  /**
   * Carry the boxes' binary assets (background images).
   *
   * Undefined means "ask the project", whose export block holds the default. A
   * pack is a DELIVERY, though, and the same project might send a designer the
   * whole site plan and a writer only the words, so the caller can override it
   * per pack (2026-08-07: a project setting with a pack-time override).
   */
  assets?: boolean;
}

export const PACK_MANIFEST = "storylets.manifest.json";
export const PACK_EXTENSION = ".storyletpack";
export const PACK_SCHEMA = "storylets/pack@0";

/** Every shard extension a pack carries. */
const SHARD_EXTS = Object.values(SHARD_EXTENSIONS);

// A fixed timestamp keeps the zip byte-reproducible: re-packing unchanged
// source yields an identical file, so a pack can be diffed and hashed.
// `createFolders` must stay off - JSZip stamps implicit folder entries with
// new Date() whatever the entry's own `date` says, which would leak wall-clock
// time into the bytes.
const FIXED_DATE = new Date("2000-01-01T00:00:00Z");
const ENTRY_OPTS = { date: FIXED_DATE, createFolders: false } as const;

/** Every file under `dir` (recursively) whose name ends in one of `exts`. */


export class PackError extends Error {}

/** Pack a project's source shards into `.storyletpack` bytes. */
export async function runPack(startPath: string, opts: PackOptions = {}): Promise<Buffer> {
  const root = findProjectDir(startPath);
  if (root === undefined) throw new PackError(`not a storylets project: ${startPath}`);

  const projectFileName = readdirSync(root).find((f) => f.endsWith(SHARD_EXTENSIONS.project));
  if (projectFileName === undefined) throw new PackError(`no project shard in ${root}`);
  const project = parseSource(readFileSync(join(root, projectFileName), "utf8")) as ProjectShard;

  // An unresolved merge must not travel. A pack is what somebody else opens and
  // works from, and the merged model resolves conflicted values PROVISIONALLY
  // to ours - so packing one hands over a discarded edit as though it were
  // agreed, with nothing on the receiving side to say so. merge.ts has stated
  // the rule since it was written ("an unresolved merge cannot reach CI or
  // export"); only validate enforced it until 2026-08-29, and pack does not
  // even parse the project, so nothing here was looking.
  const sidecars = walkProjectFiles(root, [CONFLICT_SIDECAR_EXTENSION])
    .map((abs) => relative(root, abs).split(sep).join("/"));
  if (sidecars.length > 0) {
    throw new PackError(
      `unresolved merge in this project, so it cannot be packed:\n  ${sidecars.join("\n  ")}\n`
      + "Resolve the conflicts and delete the .storyletconflict sidecars first.");
  }

  // Layout-independent: whatever the folder shape, every shard under the root
  // travels. The compiled bundle deliberately does NOT - a pack is source.
  const files = walkProjectFiles(root, SHARD_EXTS)
    .map((abs) => ({ abs, rel: relative(root, abs).split(sep).join("/") }))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  // Assets travel only when asked, and the ask has two levels: the project's own
  // default, overridden per pack. Some projects would benefit from sending their
  // pictures and others never would, so neither "always" nor "never" is right.
  const wanted = opts.assets ?? project.export?.packAssets ?? false;
  // REFERENCED assets only. An orphan is a file no map uses - ordinary work makes
  // them, since undoing an import keeps its bytes on purpose - and a delivery
  // should carry the project's content rather than everything that has ever been
  // in the folder. Nothing is lost: the sender still has the file.
  const assets = wanted ? referencedAssets(root) : [];

  const manifest: PackManifest = {
    schema: PACK_SCHEMA,
    project: { id: project.project.id, name: project.project.name },
    files: files.map((f) => f.rel),
    ...(assets.length > 0 ? { assets: assets.map((a) => a.rel) } : {}),
  };

  const zip = new JSZip();
  zip.file(PACK_MANIFEST, JSON.stringify(manifest, null, 2) + "\n", ENTRY_OPTS);
  for (const f of files) zip.file(f.rel, readFileSync(f.abs, "utf8"), ENTRY_OPTS);
  // Bytes, not text. Reading a PNG as utf8 and writing it back does not survive
  // the round trip, which is the whole reason assets needed this pass.
  for (const a of assets) zip.file(a.rel, readFileSync(a.abs), { ...ENTRY_OPTS, binary: true });

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: false });
}

/** Every asset a map in this project actually uses, project-relative and sorted.
 *  Orphans are left behind (see the note at the call). */
function referencedAssets(root: string): { abs: string; rel: string }[] {
  const loaded = loadProject(root);
  if (!loaded.source) return [];
  const out: { abs: string; rel: string }[] = [];
  for (const box of loaded.source.boxes) {
    for (const name of assetUse(root, box).used) {
      const abs = join(root, box.path, ASSETS_DIR, name);
      out.push({ abs, rel: relative(root, abs).split(sep).join("/") });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Read a pack's manifest without exploding it (the editor's "what is this?"). */
export async function readPackManifest(bytes: Buffer | Uint8Array): Promise<PackManifest | undefined> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(PACK_MANIFEST);
  if (!entry) return undefined;
  try {
    return JSON.parse(await entry.async("string")) as PackManifest;
  } catch {
    return undefined;
  }
}
