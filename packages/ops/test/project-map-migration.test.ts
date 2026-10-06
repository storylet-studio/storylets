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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalStringify, compileProject, parseSource } from "@storylet-studio/compiler";
import { backgroundsOf } from "@storylet-studio/model";
import type { TagGroup } from "@storylet-studio/model";
import type { FormatResult } from "../src/format.js";
import { runFormat } from "../src/format.js";
import { planProjectMapMigration } from "../src/project-map-migration.js";
import { loadProject } from "../src/load.js";
import { runValidate } from "../src/validate.js";

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
      // Named per box: the compiler refuses two decks sharing a gameId.
      deck: { id: `k_${p}`, gameId: `main-${p}`, properties: [] },
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

  it("never moves a picture whose name climbs out of the folder, and says so (CLI review 2026-10, item 8)", () => {
    // A shard field is untrusted input: a pack, a merge or a hand edit can put
    // anything in it, and `join` resolves "../" happily.
    const dir = project([{ folder: "contracts", id: "b_con", p: "con", group: districtCopy("con", { picture: "../../outside.png" }) }]);
    write(join(dir, "outside.png"), "somebody's file");
    const loaded = loadProject(dir);
    const result = planProjectMapMigration(dir, loaded.source!);
    expect(result.moved).toEqual([]);
    expect(result.issues.filter((i) => i.severity === "warning").map((i) => i.message)).toEqual([
      'the map puts "../../outside.png" behind it, which is not a plain file name in contracts/assets/, so it is not moved',
    ]);
    expect(existsSync(join(dir, "outside.png"))).toBe(true);
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

/** Every file under `dir`, path -> bytes, for "nothing was written". */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path); else out.set(path, readFileSync(path, "latin1"));
    }
  };
  walk(dir);
  return out;
}

/** Add an ordinary group to a box's tags shard after `project` wrote it. */
function addGroup(dir: string, folder: string, group: unknown): void {
  const path = join(dir, folder, "tags.storylettags");
  const tags = read(path) as { groups: unknown[] };
  write(path, { ...tags, groups: [...tags.groups, group] });
}

describe("the pre-flight refuses a move that would break the compile (round-3 review, 1.2a)", () => {
  const refused = (dir: string): string[] => {
    const before = snapshot(dir);
    const result = runFormat(loadProject(dir));
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.moved).toEqual([]);
    apply(result);
    expect(snapshot(dir)).toEqual(before);
    return errors(result);
  };

  it("E4: a tag in another box, on the map or not, with a zone's name", () => {
    // The antagonist's vC: legal before (two boxes, box-qualified addresses),
    // and an error the moment "quay" becomes a zone of the project.
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "codex", id: "b_codex", p: "codex" },
    ]);
    addGroup(dir, "codex", { id: "d_codex_area", gameId: "area", tags: [{ id: "v_codex_quay", gameId: "quay" }] });
    expect(compileProject(loadProject(dir).source!).issues.filter((i) => i.message.includes("zone of the project map"))).toEqual([]);
    expect(refused(dir)).toEqual([
      'box "codex" has a tag "quay" in its group "area", and "quay" is a zone of the map, whose name will mean one thing across the project;'
        + ' rename the tag in "codex", then run format again',
    ]);
  });

  it("E4 in a box that held a copy: its other group's tag", () => {
    const dir = project([{ folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") }]);
    addGroup(dir, "contracts", { id: "d_con_area", gameId: "area", tags: [{ id: "v_con_hill2", gameId: "hill" }] });
    expect(refused(dir)).toEqual([
      'box "contracts" has a tag "hill" in its group "area", and "hill" is a zone of the map, whose name will mean one thing across the project;'
        + ' rename the tag in "contracts", then run format again',
    ]);
  });

  it("E3: a group in another box with the map's name", () => {
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "codex", id: "b_codex", p: "codex" },
    ]);
    addGroup(dir, "codex", { id: "d_codex_district", gameId: "district", tags: [{ id: "v_codex_old", gameId: "old-town" }] });
    expect(refused(dir)).toEqual([
      'box "codex" has a tag group "district", the name the project map takes, and a group name will mean one thing across the project;'
        + ' rename the group in "codex", then run format again',
    ]);
  });

  it("a box joining the map for its placed hands, declaring a map property as another type", () => {
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "items", id: "b_items", p: "items", sites: { h_items_any: { x: 3, y: 3 } } },
    ]);
    addGroup(dir, "items", {
      id: "d_items_kind", gameId: "kind",
      properties: [{ name: "danger", type: "string", default: "" }],
      tags: [{ id: "v_items_blade", gameId: "blade" }],
    });
    expect(refused(dir)).toEqual([
      'box "items" joins the project map because it has hands placed on it, and it declares @hand.danger as string on the group "kind" where the map declares it as number;'
        + ' rename the property in "items", or make the two agree, then run format again',
    ]);
  });

  it("a box joining the map declaring a map property with other stages: the compiler's whole-declaration rule, not the type alone", () => {
    const haunted = districtCopy("con") as { properties: unknown[] };
    haunted.properties.push({ name: "haunting", type: "quality", stages: ["quiet", "restless", "screaming"], default: "quiet" });
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: haunted },
      { folder: "items", id: "b_items", p: "items", sites: { h_items_any: { x: 3, y: 3 } } },
    ]);
    addGroup(dir, "items", {
      id: "d_items_area", gameId: "area",
      tags: [{ id: "v_items_docks", gameId: "docks", properties: [{ name: "haunting", type: "quality", stages: ["calm", "eerie"], default: "calm" }] }],
    });
    expect(refused(dir)).toEqual([
      'box "items" joins the project map because it has hands placed on it, and it declares @hand.haunting as quality with stages calm, eerie on "area/docks"'
        + ' where the map declares it as quality with stages quiet, restless, screaming;'
        + ' rename the property in "items", or make the two agree, then run format again',
    ]);
  });

  it("refuses every clash at once, and alongside a differing copy", () => {
    const dir = project([
      { folder: "contracts", id: "b_con", p: "con", group: districtCopy("con") },
      { folder: "news", id: "b_news", p: "news", group: districtCopy("news", { danger: 2 }) },
      { folder: "codex", id: "b_codex", p: "codex" },
    ]);
    addGroup(dir, "codex", { id: "d_codex_area", gameId: "area", tags: [{ id: "v_codex_quay", gameId: "quay" }, { id: "v_codex_hill", gameId: "hill" }] });
    expect(refused(dir)).toHaveLength(3);
  });
});

describe("W3 sends the author to format, so format moves the frames (round-3 review, 1.2b)", () => {
  const frame = (id: string): unknown => ({ id, x: 0, y: 0, w: 10, h: 10, title: id });
  const w3 = (dir: string): string[] => compileProject(loadProject(dir).source!).issues
    .filter((i) => i.field === "frames").map((i) => i.message);

  it("moves stray frames up to a project map already there, and touches nothing else", () => {
    const root = { schema: "storylets/projectmap@0", group: { ...(districtCopy("root") as object), templates: { spatial: { map: true } } }, frames: [frame("f_root")] };
    const dir = project([{ folder: "news", id: "b_news", p: "news", sites: { h_news_any: { x: 1, y: 1 } }, frames: [frame("f_late")] }], { rootMap: root });
    // On the map already (the project was migrated; a collaborator then drew a frame the old way).
    const boxPath = join(dir, "news", "box.storyletbox");
    const box = read(boxPath) as { box: Record<string, unknown> };
    write(boxPath, { ...box, box: { ...box.box, usesMap: true } });
    expect(w3(dir)).toHaveLength(1);

    const result = runFormat(loadProject(dir));
    expect(errors(result)).toEqual([]);
    expect(result.migrated).toEqual(["1 frame(s) moved to the project map"]);
    apply(result);
    expect((read(join(dir, "map.storyletmap")) as { frames: { id: string }[] }).frames.map((f) => f.id)).toEqual(["f_root", "f_late"]);
    expect(read(join(dir, "news", "map.storyletmap"))).toEqual({ schema: "storylets/map@0", map: { sites: { h_news_any: { x: 1, y: 1 } } } });
    expect(w3(dir)).toEqual([]);
    const again = runFormat(loadProject(dir));
    expect([again.changed, again.removed, again.moved, again.migrated]).toEqual([[], [], [], []]);
  });

  it("does not opt a box in while it moves only frames", () => {
    const root = { schema: "storylets/projectmap@0", group: districtCopy("root") };
    const dir = project([
      { folder: "news", id: "b_news", p: "news", frames: [frame("f_late")] },
      { folder: "codex", id: "b_codex", p: "codex", sites: { h_codex_any: { x: 1, y: 1 } } },
    ], { rootMap: root });
    apply(runFormat(loadProject(dir)));
    expect((read(join(dir, "codex", "box.storyletbox")) as { box: { usesMap?: true } }).box.usesMap).toBeUndefined();
    expect(existsSync(join(dir, "news", "map.storyletmap"))).toBe(false);
  });

  it("with no project map to move them to, W3 says so rather than naming a command that cannot", () => {
    const dir = project([{ folder: "news", id: "b_news", p: "news", frames: [frame("f_late")] }]);
    expect(w3(dir)).toEqual([
      "the map's frames belong to the project map now, and this project has none, so these are ignored; draw the project map, then run `storyletengine format` to move them",
    ]);
  });
});

// The property the pre-flight exists for: whatever `format` accepts compiles.
// Every shipped example and test fixture, as it is AND as it was before the
// project map (its map pushed back down into every box on it, the first box's
// copy keeping the map's ids and every other box a copy of its own, references
// and all), goes through format and then validate with no errors.
describe("format, then validate, compiles clean for every example and fixture", () => {
  const roots = [
    fileURLToPath(new URL("../../../examples", import.meta.url)),
    fileURLToPath(new URL("./fixtures", import.meta.url)),
  ];
  const projects = roots.flatMap((root) => readdirSync(root)
    .filter((name) => name.endsWith(".storylets") && statSync(join(root, name)).isDirectory())
    .map((name) => join(root, name)));

  const copyOf = (from: string): string => {
    const dir = join(mkdtempSync(join(tmpdir(), "pm-property-")), "p.storylets");
    cpSync(from, dir, { recursive: true });
    return dir;
  };
  const clean = (dir: string): void => {
    const result = runFormat(loadProject(dir));
    expect(errors(result)).toEqual([]);
    apply(result);
    const issues = runValidate(loadProject(dir), { checkBundle: false }).issues;
    expect(issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`)).toEqual([]);
    expect(issues.filter((i) => i.field === "frames")).toEqual([]);
  };

  /** The project as it was before the project map, from the project as it is. */
  const unmigrate = (dir: string): boolean => {
    const map = existsSync(join(dir, "map.storyletmap")) ? read(join(dir, "map.storyletmap")) as { group: TagGroup; frames?: unknown[] } : undefined;
    if (map === undefined) return false;
    const onMap = readdirSync(dir).filter((f) => existsSync(join(dir, f, "box.storyletbox"))).sort()
      .filter((f) => (read(join(dir, f, "box.storyletbox")) as { box: { usesMap?: boolean } }).box.usesMap === true);
    if (onMap.length === 0) return false;
    onMap.forEach((folder, n) => {
      // The first box keeps the map's ids; every other one a copy of its own.
      const ids = new Map<string, string>();
      const copy = structuredClone(map.group);
      if (n > 0) {
        ids.set(copy.id, `${copy.id}_${n}`); copy.id = `${copy.id}_${n}`;
        for (const tag of copy.tags) { ids.set(tag.id, `${tag.id}_${n}`); tag.id = `${tag.id}_${n}`; }
      }
      const re = (s: string): string => ids.get(s) ?? s;
      const reRecord = (r: Record<string, string> | undefined): Record<string, string> | undefined =>
        r === undefined ? undefined : Object.fromEntries(Object.entries(r).map(([k, v]) => [re(k), re(v)]));
      const tagsPath = join(dir, folder, "tags.storylettags");
      const tags = read(tagsPath) as { groups: unknown[] };
      write(tagsPath, { ...tags, groups: [copy, ...tags.groups] });
      const boxPath = join(dir, folder, "box.storyletbox");
      const box = read(boxPath) as { box: Record<string, unknown> };
      delete box.box["usesMap"];
      write(boxPath, box);
      const handsPath = join(dir, folder, "hands.storylethands");
      if (existsSync(handsPath)) {
        const hands = read(handsPath) as { templates?: { bindings?: Record<string, string>; chooses?: string[] }[]; hands?: { chosen?: Record<string, string>; rule?: { bindings?: Record<string, string> } }[] };
        for (const t of hands.templates ?? []) {
          if (t.bindings) t.bindings = reRecord(t.bindings)!;
          if (t.chooses) t.chooses = t.chooses.map(re);
        }
        for (const h of hands.hands ?? []) {
          if (h.chosen) h.chosen = reRecord(h.chosen)!;
          if (h.rule?.bindings) h.rule.bindings = reRecord(h.rule.bindings)!;
        }
        write(handsPath, hands);
      }
      const decks = join(dir, folder, "decks");
      for (const file of existsSync(decks) ? readdirSync(decks) : []) {
        const deck = read(join(decks, file)) as { cards: { tags?: Record<string, string[]> }[] };
        for (const card of deck.cards) {
          if (card.tags) card.tags = Object.fromEntries(Object.entries(card.tags).map(([g, ts]) => [re(g), ts.map(re)]));
        }
        write(join(decks, file), deck);
      }
      if (n === 0) {
        // The frames and the pictures were the first box's.
        if (map.frames !== undefined) {
          const mapPath = join(dir, folder, "map.storyletmap");
          const own = existsSync(mapPath) ? read(mapPath) as { map: Record<string, unknown> } : { schema: "storylets/map@0", map: {} };
          write(mapPath, { ...own, map: { ...own.map, frames: map.frames } });
        }
        for (const bg of backgroundsOf(map.group)) {
          const from = join(dir, "assets", bg.file);
          if (!existsSync(from)) continue;
          mkdirSync(join(dir, folder, "assets"), { recursive: true });
          renameSync(from, join(dir, folder, "assets", bg.file));
        }
      }
    });
    rmSync(join(dir, "map.storyletmap"));
    return true;
  };

  it("finds them (a rename must break this, not silently empty it)", () => {
    expect(projects.map((p) => p.split("/").pop())).toEqual(expect.arrayContaining(["the-village.storylets", "port-meridian.storylets", "the-hamlet.storylets"]));
  });

  const named = projects.map((path) => [path.split("/").pop()!, path] as const);

  it.each(named)("%s as it is", (_name, path) => { clean(copyOf(path)); });

  it.each(named)("%s as it was before the project map", (_name, path) => {
    const dir = copyOf(path);
    const group = existsSync(join(dir, "map.storyletmap")) ? (read(join(dir, "map.storyletmap")) as { group: unknown }).group : undefined;
    if (!unmigrate(dir)) return;
    expect(compileProject(loadProject(dir).source!).issues.some((i) => i.message.includes("a map belongs to the project now"))).toBe(true);
    clean(dir);
    expect((read(join(dir, "map.storyletmap")) as { group: unknown }).group).toEqual(group);
  });
});
