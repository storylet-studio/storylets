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
import { effectiveGameId, gameIdify, isValidGameId } from "@storylet-studio/model";
import type { Card } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";
import { optionsOf, outcomesReported } from "@storylet-studio/with-patter";
import type { BundleOption } from "@storylet-studio/with-patter";

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
  /** The default locale's strings (string id -> text), for an option's words. Empty for a bundle
   *  published with its strings left out (localisation by ids). */
  text: ReadonlyMap<string, string>;
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
  /** Every scene in the Patter project's own files, published or not, by internal id and by
   *  address: so a card whose scene exists but hasn't been published is told to publish, not
   *  to write it. */
  sourceScenes?: ReadonlySet<string>;
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
  let project: { export?: { bundle?: unknown }; layout?: { flow?: string } };
  try {
    project = parseSource(readFileSync(projectFile, "utf8")) as typeof project;
    if (typeof project.export?.bundle === "string" && project.export.bundle.trim()) declared = project.export.bundle;
  } catch {
    return { issues: [at("warning", `${posix(relative(loaded.dir, projectFile))} doesn't parse, so cards aren't checked against their scenes`)] };
  }
  const rel = declared ?? `../patter-dist/${basename(projectFile).replace(/\.patterproj$/, "")}.patterc`;
  const bundlePath = isAbsolute(rel) ? rel : resolve(dir, rel);
  const flowDir = resolve(dir, (project.layout?.flow ?? "scenes/"));
  const link: PatterLink = { dir, projectFile, bundlePath, sourceScenes: readSourceScenes(flowDir) };
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

/** Each scene file read, by path, kept while its size and modification time hold. */
const sourceCache = new Map<string, { mtimeMs: number; size: number; names: string[] }>();

/** The ids and addresses of every scene in a Patter project's flow folder (`*.patterflow`). */
function readSourceScenes(flowDir: string): Set<string> {
  const found = new Set<string>();
  const walk = (d: string): void => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      const full = join(d, name);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) { walk(full); continue; }
      if (!name.endsWith(".patterflow")) continue;
      let hit = sourceCache.get(full);
      if (!hit || hit.mtimeMs !== stat.mtimeMs || hit.size !== stat.size) {
        let names: string[] = [];
        try {
          const scene = (parseSource(readFileSync(full, "utf8")) as { scene?: PatterSceneShape }).scene;
          if (scene) names = [scene.id, sceneAddress(scene)];
        } catch { /* a scene file that doesn't parse is Patterpad's to report */ }
        hit = { mtimeMs: stat.mtimeMs, size: stat.size, names };
        sourceCache.set(full, hit);
      }
      for (const n of hit.names) found.add(n);
    }
  };
  walk(flowDir);
  return found;
}

/** The last bundle read, by path, kept while its size and modification time hold: the editor
 *  validates on every save, and the Patter bundle only changes when Patterpad publishes. */
const bundleCache = new Map<string, { mtimeMs: number; size: number; scenes: PatterScenes }>();

function readScenes(bundlePath: string): PatterScenes | "unreadable" | { unknown: string } {
  let stat;
  try { stat = statSync(bundlePath); } catch { return "unreadable"; }
  const hit = bundleCache.get(bundlePath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.scenes;
  let bundle: { schema?: unknown; scenes?: unknown; locales?: { default?: unknown }; strings?: unknown };
  try {
    bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as typeof bundle;
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
  const locale = typeof bundle.locales?.default === "string" ? bundle.locales.default : undefined;
  const table = locale !== undefined && bundle.strings && typeof bundle.strings === "object"
    ? (bundle.strings as Record<string, unknown>)[locale] : undefined;
  const text = new Map<string, string>();
  if (table && typeof table === "object") {
    for (const [id, words] of Object.entries(table as Record<string, unknown>)) if (typeof words === "string") text.set(id, words);
  }
  const scenes: PatterScenes = { byId, byAddress, text };
  bundleCache.clear(); // one project's bundle at a time: the editor opens many projects in a session
  bundleCache.set(bundlePath, { mtimeMs: stat.mtimeMs, size: stat.size, scenes });
  return scenes;
}

// The two walkers over a compiled Patter scene are the with-patter package's, so the game's
// build-time check and this one read a scene the same way. Re-exported under the names ops has
// always exported them by.
export { optionsOf, outcomesReported };
export type PatterOption = BundleOption;

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
export function patterPairingIssues(source: SourceProject, scenes: PatterScenes, performed = performedBoxes(source), sourceScenes?: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  const played = new Set<PatterSceneShape>();
  for (const box of source.boxes) {
    // Named boxes, when the project names any: only those are Patter's, and in them a card with no
    // scene is a card the game will try to perform and can't.
    if (performed && !performed.has(box.box.box.id)) continue;
    for (const deck of box.decks) {
      for (const card of deck.shard.cards) {
        const scene = findScene(scenes, effectiveGameId(card));
        if (!scene) {
          if (performed) {
            const name = effectiveGameId(card);
            // Written but not yet published: the fix is Patterpad's Publish, not a new scene.
            if (sourceScenes?.has(name)) {
              issues.push({ severity: "warning", path: deck.path, where: card.id, message: `the Patter project has a scene named "${name}", but it hasn't been published yet: Publish Bundle in Patterpad` });
            } else {
              issues.push({
                severity: "error", path: deck.path, where: card.id,
                message: `this box is performed by Patter, and the Patter project has no scene named "${name}"`,
                fix: { kind: "create-scene", card: card.id },
              });
            }
          }
          continue;
        }
        played.add(scene);
        const at = (severity: Issue["severity"], message: string): Issue => ({ severity, path: deck.path, where: card.id, field: "outcomes", message });
        const declared = card.outcomes.map((o) => effectiveGameId(o));
        const options = optionsOf(scene);
        const events = outcomesReported(scene);
        const named = [...new Set([...events, ...options.flatMap((o) => (o.outcome ? [o.outcome] : []))])];

        for (const n of named) {
          if (!declared.includes(n)) {
            // The generate direction: the scene already says what the outcome is called, so the
            // repair is to give the card one by that name (when the name is a legal address).
            issues.push({
              ...at("error", `its Patter scene names outcome "${n}", which this card doesn't have (it has ${declared.join(", ") || "none"})`),
              ...(isValidGameId(n) ? { fix: { kind: "add-outcome" as const, card: card.id, gameId: n } } : {}),
            });
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

/** How a card's scene reaches one of its outcomes, in the words an author reads. */
export type PatterReport =
  /** The player picks this option, whose words are `text` (its id, when the bundle carries none). */
  | { kind: "option"; text: string }
  /** A gameEvent fires it: inside the branch of the option whose words are `option`, or, with no
   *  `option`, elsewhere in the scene. */
  | { kind: "event"; option?: string }
  /** The card has one outcome and the scene names none: reaching the end reaches it. */
  | { kind: "ending" };

/**
 * For each of a card's outcomes, how its Patter scene reaches it, by the host's rule (a gameEvent
 * wins, else the option's label, else the only outcome). Undefined when the card has no scene.
 * An outcome nothing reaches is absent: the check already says so.
 */
export function patterOutcomeReports(card: Card<unknown>, scenes: PatterScenes): { scene: string; reports: Map<string, PatterReport[]> } | undefined {
  const scene = findScene(scenes, effectiveGameId(card));
  if (!scene) return undefined;
  const reports = new Map<string, PatterReport[]>();
  const add = (outcome: string, report: PatterReport): void => { reports.set(outcome, [...(reports.get(outcome) ?? []), report]); };
  const options = optionsOf(scene);
  const words = (o: PatterOption): string => (o.promptId !== undefined ? scenes.text.get(o.promptId) : undefined) ?? o.id;
  const insideOptions: string[] = [];
  for (const o of options) {
    insideOptions.push(...o.overrides);
    if (o.overrides.length > 0) { for (const e of o.overrides) add(e, { kind: "event", option: words(o) }); }
    else if (o.outcome) add(o.outcome, { kind: "option", text: words(o) });
  }
  // The events outside every option: the scene's own, not any one choice's.
  const outside = [...outcomesReported(scene)];
  for (const e of insideOptions) { const i = outside.indexOf(e); if (i >= 0) outside.splice(i, 1); }
  for (const e of outside) add(e, { kind: "event" });
  if (card.outcomes.length === 1 && reports.size === 0) add(effectiveGameId(card.outcomes[0]!), { kind: "ending" });
  return { scene: scene.name, reports };
}

/**
 * The boxes the project says Patter performs (`patterBoxes`), by id, or undefined when it names
 * none: then every card with a scene is checked, and none has to have one.
 */
export function performedBoxes(source: SourceProject): Set<string> | undefined {
  const ids = source.project.patterBoxes;
  return Array.isArray(ids) && ids.length > 0 ? new Set(ids) : undefined;
}

/** Is this card in a box the project says Patter performs? False when the project names none. */
export function isPerformed(source: SourceProject, cardId: string): boolean {
  const performed = performedBoxes(source);
  return performed !== undefined && source.boxes.some((b) => performed.has(b.box.box.id)
    && b.decks.some((d) => d.shard.cards.some((c) => c.id === cardId)));
}

/** Everything `validate` says about the Patter pairing: the link's own problems, then the check. */
export function patterIssues(loaded: LoadedProject): Issue[] {
  const { link, issues } = readPatterLink(loaded);
  const source = loaded.source;
  if (source?.project.patterBoxes !== undefined) {
    const known = new Set(source.boxes.map((b) => b.box.box.id));
    for (const id of source.project.patterBoxes) {
      if (!known.has(id)) issues.push({ severity: "warning", path: source.path, where: "patterBoxes", message: `patterBoxes names a box that doesn't exist (${id})` });
    }
    if (source.project.patter === undefined) {
      issues.push({ severity: "warning", path: source.path, where: "patterBoxes", message: "patterBoxes names boxes for Patter, but the project isn't paired with a Patter project" });
    }
  }
  if (link?.scenes && source) issues.push(...patterPairingIssues(source, link.scenes, performedBoxes(source), link.sourceScenes));
  return issues;
}
