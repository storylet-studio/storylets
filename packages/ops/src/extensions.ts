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
import { canonicalStringify } from "@storylet-studio/compiler";
import type { SourceExtension, SourceProject } from "@storylet-studio/compiler";
import { EXTENSIONS_DIR, MANIFEST_EXTENSION } from "@storylet-studio/model";
import type { ProjectExtension } from "@storylet-studio/model";
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
 * unsound is left alone, as its data is.
 */
export function planExtensionUpgrades(dir: string, source: SourceProject): ExtensionUpgrade {
  const writes = new Map<string, string>();
  const report: string[] = [];
  const taken = source.project.extensions ?? {};
  const moved: Record<string, ProjectExtension> = {};
  for (const [id, pin] of Object.entries(taken)) {
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
