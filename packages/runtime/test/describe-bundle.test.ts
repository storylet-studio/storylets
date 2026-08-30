// describeBundle: the bundle inspector's runtime half (design 2, piece 6) -
// a BUNDLE-level API, no session involved. What an integrator may call, read
// from the asset alone: identity, the deal() surface (hands), the peek()
// criteria surface (tag groups + tags), the declared property scopes, and
// counts for orientation. Bundle order throughout.
import { describe, expect, it } from "vitest";
import { Engine, describeBundle } from "../src/index.js";
import { expandBundle } from "@storylet-studio/conformance";

// The conformance scaffold: box "box", deck "main", tag group "zone" with
// tags "docks" (declaring danger) and "market".
const bundle = expandBundle({
  world: [{ name: "season", type: "string", default: "spring" }],
  story: [{ name: "gold", type: "number", default: 0 }],
  boxProperties: [{ name: "heat", type: "number", default: 2 }],
  decks: [{
    id: "k_main",
    properties: [{ name: "shuffles", type: "number", default: 0 }],
    cards: [
      { id: "c_a", priority: 1, tags: { zone: ["docks"] },
        outcomes: [{ id: "o_go", changes: { "@story.gold": "1" } }] },
      { id: "c_b", priority: 0, outcomes: [{ id: "o_wait" }] },
    ],
  }],
  templates: [{ id: "t_berth", chooses: ["zone"], slots: 2,
    properties: [{ name: "owner", type: "string", default: "nobody" }] }],
  hands: [
    { id: "h_seat", rule: { bindings: { zone: "docks" } }, slots: 1,
      properties: [{ name: "label", type: "string", default: "" }] },
    { id: "h_berth", template: "t_berth", chosen: { zone: "market" } },
  ],
});

describe("describeBundle identity + totals", () => {
  it("reads the schema, project, version, hash and metadata off the asset", () => {
    const d = describeBundle(bundle);
    expect(d.identity.schema).toBe("storylets/bundle@0");
    expect(d.identity.project).toBe("conf");
    expect(d.identity.version).toBe("0.0.0");
    expect(d.identity.hash).toBe("");
    expect(d.identity.metadata).toBe("full");
  });

  it("counts for orientation, never card lists", () => {
    const d = describeBundle(bundle);
    expect(d.totals).toEqual({
      boxes: 1, decks: 1, cards: 2, hands: 2, templates: 1, tagGroups: 1,
    });
    expect(JSON.stringify(d)).not.toContain("c_a");
  });

  it("needs no session: the same description before and after play", () => {
    const before = describeBundle(bundle);
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    session.deal("seat");
    session.advanceTurns("box", 3);
    expect(describeBundle(bundle)).toEqual(before);
  });
});

describe("describeBundle: the deal() surface", () => {
  it("lists hands with box, slots and template, in bundle order", () => {
    const { hands } = describeBundle(bundle);
    expect(hands.map((h) => h.gameId)).toEqual(["berth", "seat"]);   // id-sorted
    expect(hands[0]).toEqual({ gameId: "berth", box: "box", slots: 2, template: "berth" });
    expect(hands[1]).toEqual({ gameId: "seat", box: "box", slots: 1 });
  });

  it("an unbounded hand reads as unbounded, not a number", () => {
    const open = expandBundle({ hands: [{ id: "h_open", rule: {} }] });
    expect(describeBundle(open).hands[0]!.slots).toBe("unbounded");
  });
});

describe("describeBundle: the peek() criteria surface", () => {
  it("lists each box's tag groups with their tag gameIds, plus ranking", () => {
    const { boxes } = describeBundle(bundle);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.gameId).toBe("box");
    expect(boxes[0]!.ranking).toEqual({ specificity: true });
    expect(boxes[0]!.tagGroups).toEqual([{ gameId: "zone", tags: ["docks", "market"] }]);
    expect(boxes[0]!.counts).toEqual({ decks: 1, cards: 2, hands: 2, templates: 1, tagGroups: 1 });
  });

  it("the criteria it advertises are the criteria peek accepts", () => {
    const group = describeBundle(bundle).boxes[0]!.tagGroups[0]!;
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    for (const tag of group.tags) {
      expect(() => session.peek("box", { [group.gameId]: tag })).not.toThrow();
    }
  });
});

describe("describeBundle: the declared property scopes", () => {
  it("world and story always show; box/deck/hand/tag show where declared", () => {
    const { properties } = describeBundle(bundle);
    expect(properties.map((p) => [p.scope, p.owner])).toEqual([
      ["world", ""],
      ["story", ""],
      ["box", "box"],
      ["deck", "main"],
      ["hand", "berth"],
      ["hand", "seat"],
      ["tag", "docks"],
    ]);
    // market declares nothing, so it carries no scope row.
    expect(properties.some((p) => p.owner === "market")).toBe(false);
  });

  it("carries the type and default of every declaration", () => {
    const { properties } = describeBundle(bundle);
    const world = properties.find((p) => p.scope === "world")!;
    expect(world.properties).toEqual([{ name: "season", type: "string", default: "spring" }]);
    const tag = properties.find((p) => p.scope === "tag")!;
    expect(tag.group).toBe("zone");
    expect(tag.properties).toEqual([{ name: "danger", type: "number", default: 0 }]);
  });

  it("a template instance advertises its template's @hand declarations", () => {
    const berth = describeBundle(bundle).properties.find((p) => p.owner === "berth")!;
    expect(berth.properties.map((p) => p.name)).toEqual(["owner"]);
  });

  it("is the static twin of session.listProperties (same names, same order)", () => {
    const declared = describeBundle(bundle).properties.flatMap((p) => p.properties.map((d) => d.name));
    const live = new Engine(bundle, { seed: 0 }).openFlow("main").listProperties().map((r) => r.name);
    expect(declared).toEqual(live);
  });
});

// Maps are inert payload: the engine never reads them, which is exactly why the
// inspector has to say they are there. A bundle that silently carried a map
// would fail the one promise this API makes ("what is in here").
describe("describeBundle and a shipped map", () => {
  it("reports nothing when the build carried none", () => {
    expect(describeBundle(bundle).maps).toEqual([]);
  });

  it("names the box and group, and counts what is in each", () => {
    const withMap = {
      ...bundle,
      maps: [{
        box: "box", group: "zone",
        zones: [
          { tag: "docks", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
          { tag: "market", polygon: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }] },
        ],
        backgrounds: [{ file: "assets/box/plan.png", x: 0, y: 0, width: 4, height: 4 }],
      }],
    };
    expect(describeBundle(withMap).maps).toEqual([
      { box: "box", group: "zone", zones: 2, backgrounds: 1 },
    ]);
  });

  it("counts a map with no pictures as a map with no pictures", () => {
    const withMap = {
      ...bundle,
      maps: [{ box: "box", group: "zone", zones: [{ tag: "docks", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] }],
    };
    expect(describeBundle(withMap).maps[0]).toEqual({ box: "box", group: "zone", zones: 1, backgrounds: 0 });
  });
});
