// ---------------------------------------------------------------------------
// The paired Patter project: finding it, finding its published bundle, and
// checking cards against their scenes. Expectations hand-written against the
// Hamlet fixture's cards and small Patter bundles built here by hand, each
// shaped like Patter's compiled output (patter/bundle@0): scenes keyed by
// internal id, options as groups carrying a prompt, an option's outcome label
// in its gameData, and gameEvent beats reporting one in theirs.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { ProjectShard } from "@storylet-studio/model";
import { loadProject } from "../src/load.js";
import { patterIssues, readPatterLink } from "../src/patter-link.js";
import { runValidate } from "../src/validate.js";

const exampleDir = fileURLToPath(new URL("./fixtures/the-hamlet.storylets", import.meta.url));
const PROJECT = "the-hamlet.storyletproj";

// --- compiled Patter shapes, the minimum the check reads --------------------------------------

type Node = Record<string, unknown>;
const line = (): Node => ({ type: "snippet", beats: [{ kind: "line", id: "L" }] });
const option = (id: string, outcome?: string, children: Node[] = [line()]): Node =>
  ({ type: "group", id, prompt: { id: `${id}_p` }, children, ...(outcome ? { gameData: { outcome } } : {}) });
const event = (outcome: string): Node => ({ type: "snippet", beats: [{ kind: "gameEvent", id: "ev", gameData: { outcome } }] });
const scene = (id: string, name: string, children: Node[], gameId?: string): Node =>
  ({ id, type: "scene", name, ...(gameId ? { gameId } : {}), blocks: [{ id: `${id}_b`, type: "block", name: "Main", children }] });
const bundle = (...scenes: Node[]): Node =>
  ({ schema: "patter/bundle@0", scenes: Object.fromEntries(scenes.map((s) => [s.id as string, s])) });

/**
 * A scratch game folder: the fixture's storylet project, with `patter` pointing at a sibling
 * Patter project whose published bundle is `published` (none when undefined). `layout` lets a
 * test break one piece of that on purpose.
 */
function game(published: Node | undefined, layout: { link?: unknown; noProjectFile?: boolean; exportBundle?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "patter-link-"));
  const dir = join(root, "the-hamlet.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const project = parseSource(readFileSync(join(dir, PROJECT), "utf8")) as ProjectShard;
  (project as { patter?: unknown }).patter = "link" in layout ? layout.link : "../story.patter";
  writeFileSync(join(dir, PROJECT), canonicalStringify(project));
  mkdirSync(join(root, "story.patter"));
  if (!layout.noProjectFile) {
    const patterProject = { schema: "patter/project@0", project: { id: "p", name: "Story" }, ...(layout.exportBundle ? { export: { bundle: layout.exportBundle } } : {}) };
    writeFileSync(join(root, "story.patter", "story.patterproj"), JSON.stringify(patterProject));
  }
  if (published) {
    const at = layout.exportBundle ? join(root, "story.patter", layout.exportBundle) : join(root, "patter-dist", "story.patterc");
    mkdirSync(join(at, ".."), { recursive: true });
    writeFileSync(at, JSON.stringify(published));
  }
  return dir;
}

const messages = (dir: string): string[] => patterIssues(loadProject(dir)).map((i) => `${i.severity}: ${i.message}`);

// Every fixture card the check could meet, answered cleanly: one outcome says nothing, several
// are labelled on their options.
const clean = (): Node[] => [
  scene("scn_market", "Market Bustle", [line()]),
  scene("scn_men", "The Moneylender's Men", [option("o1", "pay-them-off"), option("o2", "stand-with-gareth"), option("o3", "walk-away")]),
];

describe("readPatterLink", () => {
  it("is silent for a project that names no Patter project", () => {
    expect(patterIssues(loadProject(exampleDir))).toEqual([]);
  });

  it("refuses a patter field that is not a path", () => {
    expect(messages(game(bundle(), { link: 3 }))).toEqual([
      "error: patter must be the Patter project's folder, relative to the project file",
    ]);
  });

  it("warns, and checks nothing, when the folder is missing or is not a Patter project", () => {
    expect(messages(game(bundle(), { link: "../elsewhere.patter" }))).toEqual([
      "warning: the paired Patter project isn't at ../elsewhere.patter, so cards aren't checked against their scenes",
    ]);
    expect(messages(game(bundle(), { noProjectFile: true }))).toEqual([
      "warning: ../story.patter has no .patterproj, so it isn't a Patter project",
    ]);
  });

  it("finds the bundle where Patterpad publishes it, and says so when it hasn't", () => {
    expect(messages(game(undefined))).toEqual([
      "warning: the Patter project hasn't been published (no ../patter-dist/story.patterc), so cards aren't checked against their scenes. Publish it from Patterpad.",
    ]);
    const dir = game(bundle(...clean()), { exportBundle: "build/out.patterc" });
    const { link } = readPatterLink(loadProject(dir));
    expect(link?.bundlePath.endsWith(join("story.patter", "build", "out.patterc"))).toBe(true);
    expect(messages(dir)).toEqual([]);
  });

  it("names a bundle it doesn't recognise rather than guessing at it", () => {
    expect(messages(game({ schema: "patter/bundle@9", scenes: {} }))).toEqual([
      "warning: ../patter-dist/story.patterc is a Patter bundle this version doesn't recognise (patter/bundle@9), so cards aren't checked against their scenes",
    ]);
  });
});

describe("cards against their scenes", () => {
  it("finds nothing wrong with scenes that answer their cards", () => {
    expect(messages(game(bundle(...clean())))).toEqual([]);
  });

  it("matches a scene by internal id first, then by address, as Patter's runtime does", () => {
    // The Hamlet's hand-written scenes: the id IS the card's gameId, the name slugs to something else.
    const byId = scene("market-bustle", "The Market at Noon", [line()]);
    // Patterpad's own: an scn_ id, and a pinned address naming the card.
    const byAddress = scene("scn_x7k2", "Men at the Forge", [option("o1", "pay-them-off"), option("o2", "stand-with-gareth"), option("o3", "walk-away")], "the-moneylenders-men");
    expect(messages(game(bundle(byId, byAddress)))).toEqual([]);
  });

  it("errors on an outcome the card doesn't have, anchored to the card", () => {
    const issues = patterIssues(loadProject(game(bundle(scene("scn_market", "Market Bustle", [option("o1", "haggle")])))));
    expect(issues).toEqual([{
      severity: "error", path: "village/decks/ambients.storyletdeck", where: "c_amb_market", field: "outcomes",
      message: 'its Patter scene names outcome "haggle", which this card doesn\'t have (it has continue)',
    }]);
  });

  it("errors when a branch of a several-outcome card can't say which outcome it reached", () => {
    const men = scene("scn_men", "The Moneylender's Men", [option("o1", "pay-them-off"), option("o2"), option("o3", "walk-away")]);
    expect(messages(game(bundle(men)))).toEqual([
      "error: an option in its Patter scene (o2) names no outcome and fires no gameEvent, so taking it leaves the game guessing between pay-them-off, stand-with-gareth, walk-away",
      'warning: outcome "stand-with-gareth" is named by no option and no gameEvent in its Patter scene, so the scene can never reach it',
    ]);
  });

  it("counts a gameEvent in an option's branch as naming the outcome, and a scene with no choice as saying nothing", () => {
    const labelledByEvent = scene("scn_men", "The Moneylender's Men", [option("o1", "pay-them-off"), option("o2", undefined, [event("stand-with-gareth")]), option("o3", "walk-away")]);
    expect(messages(game(bundle(labelledByEvent)))).toEqual([]);
    const silent = scene("scn_men", "The Moneylender's Men", [line()]);
    expect(messages(game(bundle(silent)))).toEqual([
      "error: its Patter scene never says which of its 3 outcomes (pay-them-off, stand-with-gareth, walk-away) it reached: label the scene's options, or fire a gameEvent",
      'warning: outcome "pay-them-off" is named by no option and no gameEvent in its Patter scene, so the scene can never reach it',
      'warning: outcome "stand-with-gareth" is named by no option and no gameEvent in its Patter scene, so the scene can never reach it',
      'warning: outcome "walk-away" is named by no option and no gameEvent in its Patter scene, so the scene can never reach it',
    ]);
  });

  it("warns about a scene no card plays, and says nothing about a card with no scene", () => {
    // Every other fixture card has no scene here: a box may have no dialogue, so that is not a problem.
    expect(messages(game(bundle(...clean(), scene("scn_stray", "A Stray Scene", [line()]))))).toEqual([
      'warning: Patter scene "A Stray Scene" (a-stray-scene) matches no card, so nothing deals it',
    ]);
  });

  it("runs inside validate, and a republished bundle is read again", () => {
    const dir = game(bundle(scene("scn_market", "Market Bustle", [option("o1", "haggle")])));
    expect(runValidate(loadProject(dir), { checkBundle: false }).ok).toBe(false);
    writeFileSync(join(dir, "..", "patter-dist", "story.patterc"), JSON.stringify(bundle(...clean(), scene("scn_pad", "Padding So The File Size Differs", [line()]))));
    const after = runValidate(loadProject(dir), { checkBundle: false });
    expect(after.issues.filter((i) => i.where === "c_amb_market")).toEqual([]);
  });
});
