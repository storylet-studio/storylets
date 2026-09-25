// ---------------------------------------------------------------------------
// The paired Patter project (the project shard's `patter`): where it is, where
// its published bundle is, and whether the cards and the scenes line up.
//
// Reboot 10: a card's gameId IS its Patter scene's address, and an outcome's
// gameId is what that scene names, on the option the player takes or in a
// `gameEvent`, with a single-outcome card needing neither. Nothing declares
// those links, so nothing validated them outside one demo's build; this is
// that check (lifted from the Hamlet's `scripts/pairing.mjs`), run by
// `validate` whenever the project names its Patter project.
//
// It reads Patter's PUBLISHED bundle, the file its game loads, never its
// shards: no Patter package is imported, and what is checked is exactly what
// ships. The bundle is found where Patterpad writes it: the Patter project's
// `export.bundle`, else `../patter-dist/<name>.patterc` beside the project.
//
// A card finds its scene exactly as Patter's runtime resolves a scene reference
// (`resolveSceneRef`): an internal id first, else an address (a pinned gameId,
// else the name's slug). The Hamlet's check used ids alone, which holds for its
// hand-written scenes and misses every scene Patterpad makes, whose id is
// `scn_...` and whose address is the only thing a card's gameId can match.
//
// What it can see without knowing which boxes the game performs through Patter
// (the host's choice, Reboot 10): for every card that HAS a scene, whether the
// scene names only outcomes the card declares and whether every branch can say
// which one it reached. It cannot say a card is missing its scene, since a box
// may have no dialogue at all; a host that knows its boxes checks that itself.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { parseSource } from "@storylet-studio/compiler";
import type { Issue, SourceProject } from "@storylet-studio/compiler";
import { effectiveGameId, gameIdify } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";

/** The one Patter bundle schema this check reads. A newer one is reported, not guessed at. */
export const PATTER_BUNDLE_SCHEMA = "patter/bundle@0";

/** The part of a compiled Patter scene the check reads. */
export interface PatterSceneShape {
  id: string;
  name: string;
  gameId?: string;
  [key: string]: unknown;
}

/** A published bundle's scenes, looked up the way Patter's runtime looks them up. */
export interface PatterScenes {
  byId: ReadonlyMap<string, PatterSceneShape>;
  byAddress: ReadonlyMap<string, PatterSceneShape>;
}

/** The scene a reference names: an internal id first, else an address (Patter's `resolveSceneRef`). */
export const findScene = (scenes: PatterScenes, ref: string): PatterSceneShape | undefined =>
  scenes.byId.get(ref) ?? scenes.byAddress.get(ref);

export interface PatterLink {
  /** The Patter project folder, absolute. */
  dir: string;
  /** Its `.patterproj`, absolute, when there is one. */
  projectFile?: string;
  /** Where its published bundle is (or would be), absolute. */
  bundlePath: string;
  /** The published bundle's scenes, when it was there and readable. */
  scenes?: PatterScenes;
}

const posix = (path: string): string => path.split("\\").join("/");

/** A scene's address, as Patter's runtime resolves it. */
const sceneAddress = (scene: PatterSceneShape): string => scene.gameId?.trim() || gameIdify(scene.name);

/**
 * Resolve the project's Patter link: the folder, its bundle, and the bundle's scenes.
 * Absent `patter` is the ordinary case and returns nothing. Every problem short of a
 * malformed field is a WARNING: the check simply cannot run yet.
 */
export function readPatterLink(loaded: LoadedProject): { link?: PatterLink; issues: Issue[] } {
  const source = loaded.source;
  const field = source?.project.patter;
  if (!source || field === undefined) return { issues: [] };
  const at = (severity: Issue["severity"], message: string): Issue => ({ severity, path: source.path, where: "patter", message });
  if (typeof field !== "string" || !field.trim()) {
    return { issues: [at("error", "patter must be the Patter project's folder, relative to the project file")] };
  }
  const dir = resolve(loaded.dir, field);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { issues: [at("warning", `the paired Patter project isn't at ${field}, so cards aren't checked against their scenes`)] };
  }
  let projectFile: string | undefined;
  try {
    const name = readdirSync(dir).find((f) => f.endsWith(".patterproj"));
    if (name !== undefined) projectFile = join(dir, name);
  } catch { /* unreadable: reported below as no project file */ }
  if (projectFile === undefined) {
    return { issues: [at("warning", `${field} has no .patterproj, so it isn't a Patter project`)] };
  }

  // Where Patterpad publishes: the project's export.bundle, else the sibling patter-dist/.
  let declared: string | undefined;
  try {
    const project = parseSource(readFileSync(projectFile, "utf8")) as { export?: { bundle?: unknown } };
    if (typeof project.export?.bundle === "string" && project.export.bundle.trim()) declared = project.export.bundle;
  } catch {
    return { issues: [at("warning", `${posix(relative(loaded.dir, projectFile))} doesn't parse, so cards aren't checked against their scenes`)] };
  }
  const rel = declared ?? `../patter-dist/${basename(projectFile).replace(/\.patterproj$/, "")}.patterc`;
  const bundlePath = isAbsolute(rel) ? rel : resolve(dir, rel);
  const link: PatterLink = { dir, projectFile, bundlePath };
  const shown = posix(relative(loaded.dir, bundlePath));

  if (!existsSync(bundlePath)) {
    return { link, issues: [at("warning", `the Patter project hasn't been published (no ${shown}), so cards aren't checked against their scenes. Publish it from Patterpad.`)] };
  }
  const read = readScenes(bundlePath);
  if (read === "unreadable") {
    return { link, issues: [at("warning", `${shown} isn't a readable Patter bundle, so cards aren't checked against their scenes`)] };
  }
  if (typeof read === "object" && "unknown" in read) {
    return { link, issues: [at("warning", `${shown} is a Patter bundle this version doesn't recognise (${read.unknown}), so cards aren't checked against their scenes`)] };
  }
  return { link: { ...link, scenes: read }, issues: [] };
}

/** The last bundle read, by path, kept while its size and modification time hold: the editor
 *  validates on every save, and the Patter bundle only changes when Patterpad publishes. */
const bundleCache = new Map<string, { mtimeMs: number; size: number; scenes: PatterScenes }>();

function readScenes(bundlePath: string): PatterScenes | "unreadable" | { unknown: string } {
  let stat;
  try { stat = statSync(bundlePath); } catch { return "unreadable"; }
  const hit = bundleCache.get(bundlePath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.scenes;
  let bundle: { schema?: unknown; scenes?: unknown };
  try {
    bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as { schema?: unknown; scenes?: unknown };
  } catch {
    return "unreadable";
  }
  if (bundle.schema !== PATTER_BUNDLE_SCHEMA || typeof bundle.scenes !== "object" || bundle.scenes === null) {
    return { unknown: String(bundle.schema) };
  }
  const byId = new Map<string, PatterSceneShape>();
  const byAddress = new Map<string, PatterSceneShape>();
  for (const [id, scene] of Object.entries(bundle.scenes as Record<string, PatterSceneShape>)) {
    byId.set(id, scene);
    byAddress.set(sceneAddress(scene), scene);
  }
  const scenes: PatterScenes = { byId, byAddress };
  bundleCache.clear(); // one project's bundle at a time: the editor opens many projects in a session
  bundleCache.set(bundlePath, { mtimeMs: stat.mtimeMs, size: stat.size, scenes });
  return scenes;
}

/** Every gameEvent outcome id anywhere under a compiled node, in document order. */
export function outcomesReported(node: unknown): string[] {
  const found: string[] = [];
  (function walk(n: unknown): void {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    const o = n as { kind?: unknown; gameData?: { outcome?: unknown } };
    if (o.kind === "gameEvent" && typeof o.gameData?.outcome === "string") found.push(o.gameData.outcome);
    for (const v of Object.values(n)) walk(v);
  })(node);
  return found;
}

/** Every choice option in a compiled scene (a group carrying a prompt): the outcome it labels
 *  itself with, and the gameEvent outcomes its branch fires, which would win over the label. */
export function optionsOf(scene: unknown): { id: string; outcome: string | null; overrides: string[] }[] {
  const found: { id: string; outcome: string | null; overrides: string[] }[] = [];
  (function walk(n: unknown): void {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    const o = n as { type?: unknown; prompt?: unknown; id?: unknown; gameData?: { outcome?: unknown }; children?: unknown };
    if (o.type === "group" && o.prompt !== undefined) {
      found.push({
        id: String(o.id),
        outcome: typeof o.gameData?.outcome === "string" ? o.gameData.outcome : null,
        overrides: outcomesReported(o.children ?? []),
      });
    }
    // The prompt is text, never structure: walking it could mistake a nested group for an option.
    for (const [k, v] of Object.entries(n)) if (k !== "prompt") walk(v);
  })(scene);
  return found;
}

/**
 * Cards against their scenes. THE RESOLUTION RULE this enforces is the host's (the Hamlet's
 * `performance.js`): a gameEvent wins, else the label on the option the player took, else the
 * card's only outcome. So a scene whose card has one outcome need say nothing, and a scene whose
 * card has several must leave no path that says nothing: the mistake nobody sees until a player
 * takes the one branch that was never labelled.
 *
 * Errors for what would misplay (an outcome the card doesn't have; a branch that can't say which
 * outcome it reached); warnings for what merely can't be reached yet (an outcome no branch names,
 * a scene no card plays).
 */
export function patterPairingIssues(source: SourceProject, scenes: PatterScenes): Issue[] {
  const issues: Issue[] = [];
  const played = new Set<PatterSceneShape>();
  for (const box of source.boxes) {
    for (const deck of box.decks) {
      for (const card of deck.shard.cards) {
        const scene = findScene(scenes, effectiveGameId(card));
        if (!scene) continue;
        played.add(scene);
        const at = (severity: Issue["severity"], message: string): Issue => ({ severity, path: deck.path, where: card.id, field: "outcomes", message });
        const declared = card.outcomes.map((o) => effectiveGameId(o));
        const options = optionsOf(scene);
        const events = outcomesReported(scene);
        const named = [...new Set([...events, ...options.flatMap((o) => (o.outcome ? [o.outcome] : []))])];

        for (const n of named) {
          if (!declared.includes(n)) {
            issues.push(at("error", `its Patter scene names outcome "${n}", which this card doesn't have (it has ${declared.join(", ") || "none"})`));
          }
        }
        if (declared.length > 1) {
          if (options.length === 0 && events.length === 0) {
            issues.push(at("error", `its Patter scene never says which of its ${declared.length} outcomes (${declared.join(", ")}) it reached: label the scene's options, or fire a gameEvent`));
          }
          for (const o of options) {
            if (!o.outcome && o.overrides.length === 0) {
              issues.push(at("error", `an option in its Patter scene (${o.id}) names no outcome and fires no gameEvent, so taking it leaves the game guessing between ${declared.join(", ")}`));
            }
          }
          for (const d of declared) {
            if (!named.includes(d)) issues.push(at("warning", `outcome "${d}" is named by no option and no gameEvent in its Patter scene, so the scene can never reach it`));
          }
        }
      }
    }
  }
  for (const scene of scenes.byId.values()) {
    if (!played.has(scene)) {
      issues.push({ severity: "warning", path: source.path, where: "patter", message: `Patter scene "${scene.name}" (${sceneAddress(scene)}) matches no card, so nothing deals it` });
    }
  }
  return issues;
}

/** Everything `validate` says about the Patter pairing: the link's own problems, then the check. */
export function patterIssues(loaded: LoadedProject): Issue[] {
  const { link, issues } = readPatterLink(loaded);
  if (link?.scenes && loaded.source) issues.push(...patterPairingIssues(loaded.source, link.scenes));
  return issues;
}
