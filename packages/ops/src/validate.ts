// ---------------------------------------------------------------------------
// The validate op: the publish gate (compile without writing), the bundle
// staleness gate (schema 2.8), and the canonical-form check (source doc
// section 8 - drift is a warning; `format` fixes it).
// ---------------------------------------------------------------------------

import { sidecarIssues } from "./merge.js";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { bundleIsFresh, canonicalStringify, compileProject, parseSource } from "@storylet-studio/compiler";
import type { Issue, SourceBox, SourceProject } from "@storylet-studio/compiler";
import { backgroundsOf, effectiveGameId, isSpatial, polygonOf, SPATIAL } from "@storylet-studio/model";
import type { Bundle, TagGroup } from "@storylet-studio/model";
import { ASSETS_DIR, assetPath } from "./assets.js";
import { deadStateIssues } from "./deadstate.js";
import { reachabilityIssues } from "./reachability.js";
import type { LoadedProject } from "./load.js";
import { bundleOutputPath } from "./export.js";

export interface ValidateResult {
  issues: Issue[];
  /** True when there are no error-severity issues. */
  ok: boolean;
}

export interface ValidateOptions {
  /** Check the committed .storyletsc against the shards (the publish/CI gate).
   *  Default true. The studio editor turns this OFF: it compiles a fresh bundle
   *  on demand for the Board, so a stale committed bundle is not an editing
   *  problem - only a concern when running the simulation (the Board handles
   *  its own out-of-date prompt). */
  checkBundle?: boolean;
}

/** Canonical-form verdicts, keyed by shard path and validated by exact text.
 *  Bounded by the project's shard count: an entry is replaced when its bytes
 *  change (see the note at the check itself). */
const canonical = new Map<string, { text: string; ok: boolean }>();

/** Empty the canonical-form cache. Bounded by ONE project's shard count, so a
 *  CLI run never needs this; the editor opens many projects in a session and
 *  would otherwise keep every one of them. Correctness never depends on it:
 *  entries are validated by exact text. Pairs with the compiler's
 *  `clearParseCache`, and the editor calls both together. */
export function clearCanonicalCache(): void { canonical.clear(); }

const reportDrift = (issues: Issue[], path: string): void => {
  issues.push({ severity: "warning", path, message: "not in canonical form; run: storyletengine format" });
};

export function runValidate(loaded: LoadedProject, opts: ValidateOptions = {}): ValidateResult {
  const checkBundle = opts.checkBundle ?? true;
  const issues: Issue[] = [...loaded.issues];

  // A lingering merge sidecar means an unresolved merge: it must never
  // reach CI or export silently (the merge design's demotion net).
  issues.push(...sidecarIssues(loaded.sidecars));

  if (loaded.source) {
    const compiled = compileProject(loaded.source);
    issues.push(...compiled.issues);
    issues.push(...spatialIssues(loaded.source, loaded.dir));
    // Dead state: half-wired latches and flags (deadstate.ts says why this is
    // static rather than coverage's job). Reuses the compile from just above.
    issues.push(...deadStateIssues(loaded.source, compiled.bundle));
    // ...and conditions that can never hold at all: dead state's neighbour,
    // for the fault it cannot see (reachability.ts, design/reachability.md).
    issues.push(...reachabilityIssues(loaded.source, compiled.bundle));

    // Canonical-form drift: the byte contract merges and the hosted store
    // depend on. A warning, because git still merges non-canonical text.
    //
    // This was the most expensive thing in a validate and nobody had noticed: it
    // parses every shard a SECOND time and re-serialises it, which at 3,600 cards
    // costs more than the compile it sits next to (55ms against 11ms). The
    // verdict is cached per shard and validated by exact text, so an unchanged
    // file is answered from memory: identical bytes cannot drift differently.
    for (const file of loaded.files) {
      const remembered = canonical.get(file.path);
      if (remembered && remembered.text === file.text) {
        if (!remembered.ok) reportDrift(issues, file.path);
        continue;
      }
      let formatted: string;
      try {
        formatted = canonicalStringify(parseSource(file.text));
      } catch {
        continue;   // unparseable files already errored above
      }
      canonical.set(file.path, { text: file.text, ok: formatted === file.text });
      if (formatted !== file.text) {
        reportDrift(issues, file.path);
      }
    }

    // The staleness gate: a committed bundle that no longer matches the
    // shards is an error, never a silent ship (schema 2.8). Publish/CI only.
    const bundlePath = bundleOutputPath(loaded);
    if (checkBundle && existsSync(bundlePath)) {
      const rel = relative(loaded.dir, bundlePath);
      try {
        const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;
        if (!bundleIsFresh(bundle, loaded.source)) {
          issues.push({
            severity: "error", path: rel,
            message: "bundle is stale (content hash does not match the shards); run: storyletengine export",
          });
        }
      } catch (e) {
        issues.push({
          severity: "error", path: rel,
          message: `bundle is unreadable: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }
  return { issues, ok: !issues.some((i) => i.severity === "error") };
}

/**
 * The spatial template's own checks: a zone whose outline is not an outline.
 *
 * WARNINGS, never errors, and deliberately so. Geometry never reaches the bundle,
 * so no polygon can break a game: a shard that publishes fine but draws oddly must
 * not block a release. But it must be SAID, because the alternative is a zone that
 * silently fails to appear on the map and an author hunting for why.
 *
 * The compiler does not do this. It validates what it compiles, and it compiles
 * none of this: a template of play checking its own bags is the arrangement Reboot
 * 6 asks for ("core validates only what it knows").
 */
function spatialIssues(source: SourceProject, dir: string): Issue[] {
  const issues: Issue[] = [];
  for (const box of source.boxes) {
    const path = `${box.path}/tags`;
    for (const group of box.tags.groups) {
      const spatial = isSpatial(group);
      if (spatial) issues.push(...backgroundIssues(box, group, dir, path));
      for (const tag of group.tags) {
        const where = `${effectiveGameId(group)}.${effectiveGameId(tag)}`;
        const raw = (tag.templates?.[SPATIAL] as { polygon?: unknown } | undefined)?.polygon;
        if (raw === undefined) continue;
        // Geometry on a tag whose group is not a map: harmless, and almost
        // certainly a group that lost its marker in a merge, so worth saying.
        if (!spatial) {
          issues.push({
            severity: "warning", path, where,
            message: `has a zone outline but "${effectiveGameId(group)}" is not a spatial group, so no map will show it`,
          });
        }
        if (polygonOf(tag) === undefined) {
          issues.push({
            severity: "warning", path, where,
            message: Array.isArray(raw) && raw.length < 3
              ? `zone outline needs at least 3 points, not ${raw.length}`
              : "zone outline is not a list of {x, y} numbers and will not be drawn",
          });
        }
      }
    }
  }
  return issues;
}

/**
 * A background that will not appear, said out loud.
 *
 * Warnings, never errors, exactly as a broken zone outline is: no picture can
 * break a game, so a missing one must not block a release, but an author who
 * cannot see their site plan needs to be told why rather than left wondering.
 *
 * The MISSING FILE case is the one that will actually happen: a pack that
 * travelled without its assets (they are opt-in), a file renamed outside the app,
 * a merge that brought somebody's placement without their picture.
 */
function backgroundIssues(box: SourceBox, group: TagGroup, dir: string, path: string): Issue[] {
  const issues: Issue[] = [];
  const where = effectiveGameId(group);
  const bag = group.templates?.[SPATIAL] as { backgrounds?: unknown } | undefined;
  const raw = bag?.backgrounds;
  if (raw === undefined) return issues;
  if (!Array.isArray(raw)) {
    issues.push({ severity: "warning", path, where, message: "backgrounds is not a list, so no image will be shown" });
    return issues;
  }

  // What the model accepted, so the two disagreeing is what we report.
  const good = new Set(backgroundsOf(group).map((b) => b.id));
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const id = typeof (entry as { id?: unknown })?.id === "string" ? (entry as { id: string }).id : undefined;
    if (id === undefined || !good.has(id)) {
      issues.push({
        severity: "warning", path, where,
        message: `background ${index + 1} is missing something it needs (a name, a file, and a rectangle with size), so it will not be shown`,
      });
      return;
    }
    if (seen.has(id)) {
      issues.push({ severity: "warning", path, where, message: `two backgrounds share the id "${id}"; only one will be shown` });
      return;
    }
    seen.add(id);

    const file = (entry as { file: string }).file;
    const resolved = assetPath(dir, box, file);
    if (resolved === undefined) {
      issues.push({
        severity: "warning", path, where,
        message: `background "${file}" is not a plain file name, so it will not be loaded`,
      });
      return;
    }
    if (!existsSync(resolved)) {
      issues.push({
        severity: "warning", path, where,
        message: `background "${file}" is not in this box's ${ASSETS_DIR} folder, so nothing will be drawn where it sits`,
      });
    }
  });
  return issues;
}
