// ---------------------------------------------------------------------------
// A project's Storylet extensions, as the tools that touch files find them.
//
// The merge reads the manifest from the PROJECT, never from what is installed
// on the machine (patterkit design/proposals/patter-storylet-extensions.md,
// "Merge"), so every machine and CI merge alike. A git merge driver is handed
// three temp files and the shard's real path, so it finds the project from the
// path and the manifest in the working tree, which is this file's one job.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalStringify, extensionNodes } from "@storylet-studio/compiler";
import type { SourceExtension, SourceProject } from "@storylet-studio/compiler";
import { EXTENSIONS_DIR, EXTENSION_SCHEMA, MANIFEST_EXTENSION, SHARD_EXTENSIONS, UNRESOLVED_KEY } from "@storylet-studio/model";
import type { ExtensionShard, ProjectExtension } from "@storylet-studio/model";
import { manifestProblems, parseManifest, renameStages, targetOf } from "@wildwinter/toolkit/extensions";
import type { Manifest } from "@wildwinter/toolkit/extensions";

/** Conflict markers a text merge leaves: a manifest that has them is in conflict itself. */
const CONFLICT_MARKERS = /^(<{7}|={7}|>{7})( |$)/m;

/** Where a project keeps an extension's manifest. */
export const manifestPath = (projectDir: string, id: string): string =>
  join(projectDir, EXTENSIONS_DIR, `${id}${MANIFEST_EXTENSION}`);

/**
 * The project's copy of an extension's manifest, when there is a sound one.
 * Undefined when it is missing, will not parse, is itself mid-conflict, or has
 * errors: the merge then takes each node's entry as one value, which is always
 * safe (rule 4 of the merge).
 */
export function readProjectManifest(projectDir: string, id: string): Manifest | undefined {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) return undefined;
  let text: string;
  try { text = readFileSync(manifestPath(projectDir, id), "utf8"); } catch { return undefined; }
  return soundManifest(text);
}

/** A manifest's text as a merge may use it: undefined when it will not parse, is
 *  mid-conflict itself, or has errors. For a host holding files as text (a server). */
export function soundManifest(text: string): Manifest | undefined {
  if (CONFLICT_MARKERS.test(text)) return undefined;
  try {
    const manifest = parseManifest(text);
    return manifestProblems(manifest).some((p) => p.severity === "error") ? undefined : manifest;
  } catch {
    return undefined;
  }
}

/** A manifest lookup for a merge in one project folder. */
export const projectManifests = (projectDir: string) => (id: string): Manifest | undefined =>
  readProjectManifest(projectDir, id);

/** What taking new extension versions writes: each data shard with its renamed
 *  stages renamed, and the project shard with the new pins. */
export interface ExtensionUpgrade {
  /** Absolute path to canonical content. */
  readonly writes: Map<string, string>;
  /** A line per change, for a person reading the output. */
  readonly report: string[];
}

/**
 * Take every extension whose manifest is a version other than the project's pin
 * (`storyletengine format`): the stages the manifest says it renamed are renamed
 * in that extension's data, and the pin moves to the manifest's version, as one
 * step (the proposal's "renamedStages" rule). A manifest that is missing or
 * unsound is left alone, as its data is. `only` limits it to one extension (Add Extension...'s update).
 */
export function planExtensionUpgrades(dir: string, source: SourceProject, only?: string): ExtensionUpgrade {
  const writes = new Map<string, string>();
  const report: string[] = [];
  const taken = source.project.extensions ?? {};
  const moved: Record<string, ProjectExtension> = {};
  for (const [id, pin] of Object.entries(taken)) {
    if (only !== undefined && id !== only) continue;
    const file = (source.manifests ?? []).find((m) => m.id === id);
    if (file === undefined || manifestProblems(file.manifest).some((p) => p.severity === "error")) continue;
    const manifest = file.manifest as Manifest;
    if (pin?.version === manifest.version) continue;
    moved[id] = { ...pin, version: manifest.version };
    report.push(`took the Storylet extension "${id}" at version ${manifest.version}${pin?.version ? ` (was ${pin.version})` : ""}`);
    const shards: SourceExtension[] = [...(source.extensions ?? []), ...source.boxes.flatMap((b) => b.extensions ?? [])];
    for (const shard of shards.filter((s) => s.shard.extension === id)) {
      let renamed = 0;
      const entries: Record<string, Record<string, Record<string, unknown>>> = {};
      for (const [kind, byNode] of Object.entries(shard.shard.entries ?? {})) {
        const target = targetOf(manifest, "storylets", kind);
        entries[kind] = {};
        for (const [node, entry] of Object.entries(byNode ?? {})) {
          if (target === undefined || typeof entry !== "object" || entry === null) { entries[kind]![node] = entry; continue; }
          const r = renameStages(target, entry);
          renamed += r.renames.length;
          entries[kind]![node] = r.entry;
        }
      }
      if (renamed > 0) {
        writes.set(join(dir, shard.path), canonicalStringify({ ...shard.shard, entries }));
        report.push(`  renamed ${renamed} stage value${renamed === 1 ? "" : "s"} in ${shard.path}`);
      }
    }
  }
  if (Object.keys(moved).length > 0) {
    writes.set(join(dir, source.path), canonicalStringify({ ...source.project, extensions: { ...taken, ...moved } }));
  }
  return { writes, report };
}

/** Where a node's extension values live: its box's shard, or the root shard for the project's own nodes. */
export function extensionShardPath(dir: string, source: SourceProject, extension: string, nodeId: string): string | undefined {
  const info = extensionNodes(source).get(nodeId);
  if (info === undefined) return undefined;
  const file = `${extension}${SHARD_EXTENSIONS.extension}`;
  if (info.box === undefined) return join(dir, file);
  const box = source.boxes.find((b) => b.box.box.id === info.box);
  return box === undefined ? undefined : join(dir, box.path, file);
}

/** One value set on one node, or cleared when `value` is undefined. */
export interface ExtensionValueEdit {
  readonly node: string;
  readonly field: string;
  readonly value?: unknown;
}

/**
 * The write that sets one extension field on one node, or clears it (`value` undefined): the node's shard
 * with the entry changed, created when the node had none, and deleted (`content: null`) when nothing is left
 * in it. Every other entry, and anything else in the shard (an `unresolved` mark), is kept as it is. Undefined
 * when the node does not exist.
 */
export function planExtensionValue(
  dir: string, source: SourceProject, extension: string, nodeId: string, field: string, value: unknown,
): { path: string; content: string | null } | undefined {
  const planned = planExtensionValues(dir, source, extension, [{ node: nodeId, field, value }]);
  return "gone" in planned ? undefined : planned[0];
}

/**
 * The writes that make several edits to one extension's values at once: each shard touched written once,
 * with every edit to it applied in order (a view's write, which is one undo step however many nodes and
 * boxes it reaches). The rules are `planExtensionValue`'s; `{ gone }` names the first node that does not
 * exist, and nothing is planned then.
 */
export function planExtensionValues(
  dir: string, source: SourceProject, extension: string, edits: readonly ExtensionValueEdit[],
): { path: string; content: string | null }[] | { gone: string } {
  const nodes = extensionNodes(source);
  const shards: SourceExtension[] = [...(source.extensions ?? []), ...source.boxes.flatMap((b) => b.extensions ?? [])];
  /** Each shard touched, by its absolute path, as the edits so far leave it. */
  const touched = new Map<string, ExtensionShard>();
  for (const edit of edits) {
    const kind = nodes.get(edit.node)?.kind;
    const path = extensionShardPath(dir, source, extension, edit.node);
    if (kind === undefined || path === undefined) return { gone: edit.node };
    let shard = touched.get(path);
    if (shard === undefined) {
      const rel = path.slice(dir.length + 1).split("\\").join("/");
      const existing = shards.find((s) => s.path === rel)?.shard;
      shard = existing !== undefined ? structuredClone(existing) : { schema: EXTENSION_SCHEMA, extension, entries: {} };
      touched.set(path, shard);
    }
    const entries = shard.entries;
    const byNode = { ...(entries[kind] ?? {}) };
    const entry = { ...(byNode[edit.node] ?? {}) };
    if (edit.value === undefined) delete entry[edit.field]; else entry[edit.field] = edit.value;
    if (Object.keys(entry).length > 0) byNode[edit.node] = entry; else delete byNode[edit.node];
    if (Object.keys(byNode).length > 0) entries[kind] = byNode; else delete entries[kind];
  }
  return [...touched].map(([path, shard]) => {
    const empty = Object.keys(shard.entries).length === 0 && !Object.prototype.hasOwnProperty.call(shard, UNRESOLVED_KEY);
    return { path, content: empty ? null : canonicalStringify(shard) };
  });
}

/** What taking an extension's manifest into a project writes, and what it was. */
export interface ExtensionTake {
  /** Absolute path to content: the manifest as given, the project shard with its pin, any shard whose stages
   *  the new version renames. */
  readonly writes: Map<string, string>;
  /** The version the project took it at before, when it already did. */
  readonly was?: string;
  /** A line per change, for a person reading the output. */
  readonly report: string[];
}

/**
 * Take an extension's manifest into the project (Add Extension...): the manifest written where the project
 * keeps manifests, as its text was given, and the project pinned to its version, its settings kept. A project
 * that already takes the extension at another version takes the new one as `storyletengine format` does
 * (`planExtensionUpgrades`: renamed stages renamed, then the pin), for this extension only; at the same
 * version only the manifest is written.
 */
export function planTakeExtension(dir: string, source: SourceProject, manifest: Manifest, text: string): ExtensionTake {
  const id = manifest.id;
  const file = manifestPath(dir, id);
  const writes = new Map<string, string>([[file, text]]);
  const taken = source.project.extensions ?? {};
  const pin = taken[id];
  if (pin === undefined) {
    writes.set(join(dir, source.path), canonicalStringify({ ...source.project, extensions: { ...taken, [id]: { version: manifest.version } } }));
    return { writes, report: [`took the Storylet extension "${id}" at version ${manifest.version}`] };
  }
  const rel = `${EXTENSIONS_DIR}/${id}${MANIFEST_EXTENSION}`;
  const manifests = [...(source.manifests ?? []).filter((m) => m.id !== id), { path: rel, id, manifest }];
  const upgrade = planExtensionUpgrades(dir, { ...source, manifests }, id);
  for (const [path, content] of upgrade.writes) writes.set(path, content);
  return { writes, ...(pin.version !== undefined ? { was: pin.version } : {}), report: upgrade.report };
}
