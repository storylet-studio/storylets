// ---------------------------------------------------------------------------
// The project map migration `storyletengine format` carries
// (design/project-map-contract.md 4.2): per-box copies of a map collapse into
// the root project map, the first box's ids survive, every other box's
// references are rewritten to them, copies that disagree on anything that
// changes play or the drawing are refused one sentence per difference (D6), and
// a second run has nothing to do.
//
// Every project here is written to disk and read back through `loadProject`,
// and every result is applied the way the CLI applies it and then COMPILED, so
// what is checked is the project the author is left with, not the plan.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalStringify, compileProject, parseSource } from "@storylet-studio/compiler";
import type { FormatResult } from "../src/format.js";
import { runFormat } from "../src/format.js";
import { loadProject } from "../src/load.js";

const write = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalStringify(value));
};
const read = (path: string): Record<string, unknown> => parseSource(readFileSync(path, "utf8")) as Record<string, unknown>;

const square = (x: number): { x: number; y: number }[] =>
  [{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 10 }, { x, y: 10 }];

/** One box's copy of the district map, with its own ids (`<p>` prefixes them,
 *  as Port Meridian's copies were prefixed per box). */
const districtCopy = (p: string, opts: { quayAt?: number; extraZone?: boolean; danger?: number; picture?: string } = {}): unknown => ({
  id: `d_${p}_district`, gameId: "district",
  properties: [{ name: "danger", type: "number", default: 0 }],
  tags: [
    { id: `v_${p}_quay`, gameId: "quay", values: { danger: opts.danger ?? 1 }, templates: { spatial: { polygon: square(opts.quayAt ?? 0), z: 1 } } },
    { id: `v_${p}_hill`, gameId: "hill", templates: { spatial: { polygon: square(20) } } },
    ...(opts.extraZone ? [{ id: `v_${p}_mill`, gameId: "mill" }] : []),
  ],
  templates: { spatial: { map: true, ...(opts.picture !== undefined ? { backgrounds: [{ id: `g_${p}`, file: opts.picture, x: 0, y: 0, width: 40, height: 10 }] } : {}) } },
});

interface BoxOpts {
  folder: string;
  id: string;
  group?: unknown;
  /** The prefix the box's copy uses, for its references. */
  p?: string;
  sites?: Record<string, { x: number; y: number }>;
  frames?: unknown[];
  notes?: unknown[];
}

/** A project of boxes, each with a hand on the quay, a card tagged with the
 *  hill, a template choosing the district and an instance of it. */
function project(boxes: BoxOpts[], extra: { contract?: unknown; rootMap?: unknown } = {}): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pm-migrate-")), "p.storylets");
  write(join(dir, "p.storyletproj"), {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    settings: { play: "solo", playAdvancesTurns: 1 },
    world: { properties: [] }, story: { properties: [] }, templates: {},
    export: { bundle: "../dist/p.storyletsc", metadata: "full", map: true },
  });
  if (extra.rootMap !== undefined) write(join(dir, "map.storyletmap"), extra.rootMap);
  if (extra.contract !== undefined) write(join(dir, "contracts", "venue.storyletcontract"), extra.contract);
  for (const b of boxes) {
    const p = b.p ?? b.folder;
    const has = b.group !== undefined;
    write(join(dir, b.folder, "box.storyletbox"), {
      schema: "storylets/box@0",
      box: { id: b.id, gameId: b.folder, fields: [], properties: [], ranking: { specificity: true } },
    });
    write(join(dir, b.folder, "tags.storylettags"), {
      schema: "storylets/tags@0",
      groups: [...(has ? [b.group] : []), { id: `d_${p}_mood`, gameId: `mood-${p}`, tags: [{ id: `v_${p}_calm`, gameId: `calm-${p}` }] }],
    });
    write(join(dir, b.folder, "hands.storylethands"), {
      schema: "storylets/hands@0",
      templates: has ? [{ id: `t_${p}`, gameId: `stand-${p}`, chooses: [`d_${p}_district`], slots: 1, properties: [] }] : [],
      hands: has ? [
        { id: `h_${p}_quay`, gameId: `quay-${p}`, rule: { bindings: { [`d_${p}_district`]: `v_${p}_quay` } } },
        { id: `h_${p}_hill`, gameId: `hill-${p}`, template: `t_${p}`, chosen: { [`d_${p}_district`]: `v_${p}_hill` } },
      ] : [{ id: `h_${p}_any`, gameId: `any-${p}`, rule: {} }],
    });
    write(join(dir, b.folder, "decks", "main.storyletdeck"), {
      schema: "storylets/deck@0",
      deck: { id: `k_${p}`, gameId: "main", properties: [] },
      cards: [{
        id: `c_${p}_hill`, gameId: `on-the-hill-${p}`, outcomes: [],
        ...(has ? { tags: { [`d_${p}_district`]: [`v_${p}_hill`], [`d_${p}_mood`]: [`v_${p}_calm`] }, condition: "@hand.danger >= 0" } : {}),
      }],
    });
    if (b.sites !== undefined || b.frames !== undefined) {
      write(join(dir, b.folder, "map.storyletmap"), {
        schema: "storylets/map@0",
        map: { ...(b.sites !== undefined ? { sites: b.sites } : {}), ...(b.frames !== undefined ? { frames: b.frames } : {}) },
      });
    }
    if (b.notes !== undefined) write(join(dir, b.folder, "notes.storyletnotes"), { schema: "storylets/notes@0", comments: b.notes });
  }
  return dir;
}

/** Apply a format the way the CLI does: pictures, writes, deletions. */
function apply(result: FormatResult): void {
  for (const move of result.moved) {
    mkdirSync(dirname(move.to), { recursive: true });
    renameSync(move.from, move.to);
  }
  for (const w of result.changed) {
    mkdirSync(dirname(w.path), { recursive: true });
    writeFileSync(w.path, w.content);
  }
  for (const path of result.removed) rmSync(path);
}

const errors = (result: FormatResult): string[] => result.issues.filter((i) => i.severity === "error").map((i) => i.message);

describe("copies of one map collapse into the project map", () => {
  const boxes = (): BoxOpts[] => [
    { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con"), sites: { h_con_quay: { x: 1, y: 2 } } },
    { folder: "news", id: "b_news", p: "news", group: districtCopy("news"), sites: { h_news_hill: { x: 25, y: 5 } } },
    { folder: "codex", id: "b_codex", p: "codex" },
  ];

  it("keeps the first box's group whole, ids and all, at the root", () => {
    const dir = project(boxes());
    // As the canonical writer left it, which stamps authored order.
    const before = (read(join(dir, "contracts", "tags.storylettags")) as { groups: unknown[] }).groups[0];
    const result = runFormat(loadProject(dir));
    expect(errors(result)).toEqual([]);
    apply(result);
    const map = read(join(dir, "map.storyletmap")) as { schema: string; group: unknown };
    expect(map.schema).toBe("storylets/projectmap@0");
    expect(map.group).toEqual(before);
    for (const folder of ["contracts", "news"]) {
      const tags = read(join(dir, folder, "tags.storylettags")) as { groups: { gameId: string }[] };
      expect(tags.groups.map((g) => g.gameId)).toEqual([`mood-${folder === "contracts" ? "con" : "news"}`]);
    }
  });

  it("rewrites every other box's references to the survivor's ids, and leaves the box's own groups alone", () => {
    const dir = project(boxes());
    apply(runFormat(loadProject(dir)));
    const hands = read(join(dir, "news", "hands.storylethands")) as { templates: unknown[]; hands: { id: string }[] };
    expect(hands.templates).toMatchObject([{ chooses: ["d_con_district"] }]);
    const hand = (id: string): unknown => hands.hands.find((h) => h.id === id);
    expect(hand("h_news_quay")).toMatchObject({ rule: { bindings: { d_con_district: "v_con_quay" } } });
    expect(hand("h_news_hill")).toMatchObject({ chosen: { d_con_district: "v_con_hill" } });
    const deck = read(join(dir, "news", "decks", "main.storyletdeck")) as { cards: { tags: unknown }[] };
    expect(deck.cards[0]!.tags).toEqual({ d_con_district: ["v_con_hill"], d_news_mood: ["v_news_calm"] });
    // The survivor's own box names its own ids already, and is not touched.
    expect(runFormat(loadProject(dir)).changed.map((w) => w.path)).not.toContain(join(dir, "contracts", "hands.storylethands"));
    expect(readFileSync(join(dir, "contracts", "hands.storylethands"), "utf8")).toContain("v_con_quay");
  });

  it("opts in every box that held a copy, and no other", () => {
    const dir = project(boxes());
    apply(runFormat(loadProject(dir)));
    const uses = (folder: string): unknown => (read(join(dir, folder, "box.storyletbox")) as { box: { usesMap?: true } }).box.usesMap;
    expect(uses("contracts")).toBe(true);
    expect(uses("news")).toBe(true);
    expect(uses("codex")).toBeUndefined();
  });

  it("leaves a project that compiles, with one value bag per zone and every box's sites", () => {
    const dir = project(boxes());
    apply(runFormat(loadProject(dir)));
    const loaded = loadProject(dir);
    const { bundle, issues } = compileProject(loaded.source!);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(bundle!.map!.group.id).toBe("d_con_district");
    expect(bundle!.map!.geometry!.sites).toEqual({
      contracts: [{ hand: "quay-con", x: 1, y: 2 }],
      news: [{ hand: "hill-news", x: 25, y: 5 }],
    });
    expect(bundle!.boxes.flatMap((b) => b.tagGroups.map((g) => g.gameId)).sort()).toEqual(["mood-codex", "mood-con", "mood-news"]);
  });

  it("is quiet the second time", () => {
    const dir = project(boxes());
    apply(runFormat(loadProject(dir)));
    const again = runFormat(loadProject(dir));
    expect(again.issues).toEqual([]);
    expect(again.changed).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(again.moved).toEqual([]);
    expect(again.migrated).toEqual([]);
  });

  it("says what it did, a line each", () => {
    const dir = project(boxes());
    expect(runFormat(loadProject(dir)).migrated).toEqual([
      'the map of "contracts" is the project map ("district", 2 zones); the copies in "news" are folded into it',
      'box "contracts" is on the project map',
      'box "news" is on the project map',
      'box "news" now names the project map\'s zones by its ids',
    ]);
  });
});

describe("copies that disagree are refused, one sentence per difference (D6)", () => {
  const refuse = (news: unknown): string[] => {
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "news", id: "b_news", p: "news", group: news },
    ]);
    const result = runFormat(loadProject(dir));
    // Nothing at all is planned: a refusal is not a partial migration.
    expect(result.changed).toEqual([]);
    expect(result.moved).toEqual([]);
    return errors(result);
  };
  const kept = '"contracts" (the first box, whose map is kept)';

  it("a zone drawn differently", () => {
    expect(refuse(districtCopy("news", { quayAt: 5 }))).toEqual([
      `"news" draws "quay" differently from ${kept}; make them agree, or delete the zone from one, then run format again`,
    ]);
  });

  it("a zone one copy has and the other does not", () => {
    expect(refuse(districtCopy("news", { extraZone: true }))).toEqual([
      `"news" has the zone "mill", which ${kept} does not; make them agree, or delete the zone from one, then run format again`,
    ]);
  });

  it("a different starting value, and every difference at once", () => {
    expect(refuse(districtCopy("news", { danger: 3, quayAt: 5 }))).toEqual([
      `"news" draws "quay" differently from ${kept}; make them agree, or delete the zone from one, then run format again`,
      `"news" starts "quay" at different values from ${kept}; make them agree, or delete the zone from one, then run format again`,
    ]);
  });

  it("different declarations, a state binding, a required flag", () => {
    const base = districtCopy("news") as Record<string, unknown>;
    expect(refuse({ ...base, properties: [], boundBy: "@story.where", required: true })).toEqual([
      `"news" declares the map's properties differently from ${kept}; make them agree, then run format again`,
      `"news" binds the map to state differently from ${kept}; make them agree, then run format again`,
      `"news" makes the map required where ${kept} does not, or the other way round; make them agree, then run format again`,
    ]);
  });

  it("takes the first box's cosmetics without a word: purpose, order, stacking", () => {
    const base = districtCopy("news") as { tags: { templates: { spatial: { z?: number } } }[] } & Record<string, unknown>;
    base["purpose"] = "Somewhere else entirely.";
    base["order"] = 7;
    base.tags[0]!.templates.spatial.z = 9;
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "news", id: "b_news", p: "news", group: base },
    ]);
    expect(runFormat(loadProject(dir)).issues).toEqual([]);
  });

  it("two maps are two maps, and a project has one", () => {
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "news", id: "b_news", p: "news", group: { ...(districtCopy("news") as object), gameId: "ward" } },
    ]);
    expect(errors(runFormat(loadProject(dir)))).toEqual([
      'this project has 2 maps ("district", "ward"), and a project has one map now; keep one, make the others ordinary tag groups, then run format again',
    ]);
  });
});

describe("what moves with the map", () => {
  it("moves the survivor's pictures to the project's assets, and names the ones a copy loses", () => {
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con", { picture: "plan.png" }) },
      { folder: "news", id: "b_news", p: "news", group: districtCopy("news", { picture: "other.png" }) },
    ]);
    write(join(dir, "contracts", "assets", "plan.png"), "png bytes");
    const result = runFormat(loadProject(dir));
    expect(result.moved).toEqual([{ from: join(dir, "contracts", "assets", "plan.png"), to: join(dir, "assets", "plan.png") }]);
    expect(result.issues.filter((i) => i.severity === "warning").map((i) => i.message)).toEqual([
      '"news" puts "other.png" behind its map and "contracts" (the first box, whose map is kept) does not; the project map keeps the first box\'s pictures, and these stay in news/assets/',
    ]);
    apply(result);
    expect(existsSync(join(dir, "assets", "plan.png"))).toBe(true);
    const { bundle } = compileProject(loadProject(dir).source!);
    expect(bundle!.map!.geometry!.backgrounds).toEqual([{ file: "assets/plan.png", x: 0, y: 0, width: 40, height: 10 }]);
  });

  it("moves every box's frames to the project map and leaves the box map shards with sites, or gone", () => {
    const frame = (id: string): unknown => ({ id, x: 0, y: 0, w: 10, h: 10, title: id });
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con"), sites: { h_con_quay: { x: 1, y: 2 } }, frames: [frame("f_a")] },
      { folder: "news", id: "b_news", p: "news", group: districtCopy("news"), frames: [frame("f_b")] },
    ]);
    const result = runFormat(loadProject(dir));
    expect(result.removed).toEqual([join(dir, "news", "map.storyletmap")]);
    apply(result);
    expect((read(join(dir, "map.storyletmap")) as { frames: { id: string }[] }).frames.map((f) => f.id)).toEqual(["f_a", "f_b"]);
    expect(read(join(dir, "contracts", "map.storyletmap"))).toEqual({ schema: "storylets/map@0", map: { sites: { h_con_quay: { x: 1, y: 2 } } } });
    expect(existsSync(join(dir, "news", "map.storyletmap"))).toBe(false);
  });

  it("opts in a box that placed a site and held no copy", () => {
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "items", id: "b_items", p: "items", sites: { h_items_any: { x: 3, y: 3 } } },
    ]);
    apply(runFormat(loadProject(dir)));
    expect((read(join(dir, "items", "box.storyletbox")) as { box: { usesMap?: true } }).box.usesMap).toBe(true);
  });

  it("moves comments on the map and its zones to the project's notes, and keeps a site's in its box", () => {
    const msg = [{ author: "A", ts: "2026-10-01T00:00:00Z", body: "hm" }];
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      {
        folder: "news", id: "b_news", p: "news", group: districtCopy("news"),
        notes: [
          { id: "n_map", anchor: "map:b_news", mark: { canvas: "map:b_news", x: 1, y: 1 }, messages: msg },
          { id: "n_zone", anchor: "v_news_quay", messages: msg },
          { id: "n_site", anchor: "h_news_quay", mark: { canvas: "map:b_news", x: 2, y: 2 }, messages: msg },
        ],
      },
    ]);
    apply(runFormat(loadProject(dir)));
    expect(read(join(dir, "notes.storyletnotes"))).toEqual({
      schema: "storylets/notes@0",
      comments: [
        { id: "n_map", anchor: "map", mark: { canvas: "map", x: 1, y: 1 }, messages: msg },
        { id: "n_zone", anchor: "v_con_quay", messages: msg },
      ],
    });
    expect(read(join(dir, "news", "notes.storyletnotes"))).toEqual({
      schema: "storylets/notes@0",
      comments: [{ id: "n_site", anchor: "h_news_quay", mark: { canvas: "map", x: 2, y: 2 }, messages: msg }],
    });
  });

  it("rewrites a contract's box-qualified zone address to the short form, and says so", () => {
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "news", id: "b_news", p: "news", group: districtCopy("news") },
    ], {
      contract: {
        schema: "storylets/contract@0", installation: "the-park",
        properties: ["value.news/quay.danger", { path: "value.contracts/hill.danger", type: "number" }, "story.visits"],
      },
    });
    const result = runFormat(loadProject(dir));
    expect(result.migrated).toContain('contracts/venue.storyletcontract: "value.news/quay.danger" is now "value.quay.danger"');
    apply(result);
    expect((read(join(dir, "contracts", "venue.storyletcontract")) as { properties: unknown[] }).properties).toEqual([
      "value.quay.danger", { path: "value.hill.danger", type: "number" }, "story.visits",
    ]);
  });

  it("folds a copy left in a box into a project map that is already there", () => {
    const root = { schema: "storylets/projectmap@0", group: districtCopy("root") };
    const dir = project([{ folder: "news", id: "b_news", p: "news", group: districtCopy("news") }], { rootMap: root });
    const before = read(join(dir, "map.storyletmap"));
    const result = runFormat(loadProject(dir));
    expect(errors(result)).toEqual([]);
    apply(result);
    expect(read(join(dir, "map.storyletmap"))).toEqual(before);
    const hands = read(join(dir, "news", "hands.storylethands")) as { hands: { id: string }[] };
    expect(hands.hands.find((h) => h.id === "h_news_quay")).toMatchObject({ rule: { bindings: { d_root_district: "v_root_quay" } } });
  });
});
