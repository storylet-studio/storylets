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

  it("reports a hole filled from a property: the hand that moves", () => {
    // The one thing about a hand its name cannot say. An integrator reading the
    // asset has to know that writing hand.elder.zone MOVES this hand, because
    // setProperty is the whole verb and there is no other sign of it.
    const moving = expandBundle({
      story: [{ name: "where", type: "string", default: "docks" }],
      templates: [{ id: "t_npc", chooses: ["zone"],
        properties: [{ name: "zone", type: "enum", values: ["docks", "market"], default: "docks" }] }],
      hands: [
        { id: "h_elder", template: "t_npc", chosen: { zone: "@hand.zone" } },
        { id: "h_crier", rule: { bindings: { zone: "@story.where" } } },
        { id: "h_stall", template: "t_npc", chosen: { zone: "market" } },
      ],
    });
    const { hands } = describeBundle(moving);
    const by = Object.fromEntries(hands.map((h) => [h.gameId, h]));
    expect(by["elder"]!.movable).toEqual([{ group: "zone", from: "@hand.zone" }]);
    expect(by["crier"]!.movable).toEqual([{ group: "zone", from: "@story.where" }]);
    // A hole filled literally is not movable, off the very same template.
    expect(by["stall"]!.movable).toBeUndefined();
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

  it("reports a timed box's unit, and says nothing about an untimed one", () => {
    // What an integrator reads to know which boxes their host must tick, and
    // how often (design/engine-server.md 4.8).
    expect(describeBundle(bundle).boxes[0]!.turn).toBeUndefined();
    const timed = expandBundle({ turn: { seconds: 60 }, cards: [{ id: "c_a" }] });
    expect(describeBundle(timed).boxes[0]!.turn).toEqual({ seconds: 60 });
  });

  it("counts a box's durable cards, taking the deck's flag where the card is silent", () => {
    // design/engine-server.md 4.2: what a server has to lift over a run
    // boundary. Nothing is said about a box with none, which is the ordinary one.
    expect(describeBundle(bundle).boxes[0]!.durableCards).toBeUndefined();
    // `durable` is inert to the runtime, so the corpus scaffold has no fixture
    // field for it and this stamps it on the expanded bundle instead - which is
    // all the compiler does with it too.
    const durable = expandBundle({
      decks: [
        { id: "k_pocket", cards: [{ id: "c_a", redraw: "never" }, { id: "c_b", redraw: "never" }] },
        { id: "k_plain", cards: [{ id: "c_c", redraw: "never" }] },
      ],
    });
    const deck = (id: string) => durable.boxes[0]!.decks.find((d) => d.id === id)!;
    deck("k_pocket").durable = true;                                    // the pile carries it
    deck("k_pocket").cards.find((c) => c.id === "c_b")!.durable = false;   // one card opts out
    deck("k_plain").cards[0]!.durable = true;                           // and one card opts in
    expect(describeBundle(durable).boxes[0]!.durableCards).toBe(2);
  });

  it("the criteria it advertises are the criteria peek accepts", () => {
    const group = describeBundle(bundle).boxes[0]!.tagGroups[0]!;
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    for (const tag of group.tags) {
      expect(() => session.peek("box", { [group.gameId]: tag })).not.toThrow();
    }
  });
});

describe("describeBundle: the durability axis (4.2)", () => {
  it("marks a durable declaration and says nothing about a run-scoped one", () => {
    const bundle = expandBundle({
      story: [
        { name: "gold", type: "number", default: 0 },
        { name: "visits", type: "number", default: 0 },
      ],
      cards: [{ id: "c_a" }],
    });
    bundle.story.properties.find((p) => p.name === "visits")!.durable = true;
    const d = describeBundle(bundle);
    const story = d.properties.find((p) => p.scope === "story")!.properties;
    expect(story.find((p) => p.name === "gold")!.durable).toBeUndefined();
    expect(story.find((p) => p.name === "visits")!.durable).toBe(true);
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

// The project map (design/project-map-contract.md 3.7). Not in the corpus:
// describeBundle is session-less and each runtime pins it in its own describe
// tests. Built from the conformance PROJECT SCAFFOLD: group "district", zones
// "quay" and "hill", each declaring `danger` (per flow) and `alarm` (shared).
const onMap = expandBundle({
  projectMap: true,
  uses: true,
  cards: [{ id: "c_q", tags: { district: ["quay"] } }],
  templates: [{ id: "t_npc", chooses: ["district"], slots: 1,
    properties: [{ name: "zone", type: "string", default: "quay" }] }],
  hands: [{ id: "h_elder", template: "t_npc", chosen: { district: "@hand.zone" } }],
  otherBox: { cards: [{ id: "c_y" }] },
});

describe("describeBundle and the project map", () => {
  it("reports no map on a bundle without one", () => {
    expect(describeBundle(bundle).map).toBeUndefined();
    expect(describeBundle(bundle).boxes[0]!.usesMap).toBeUndefined();
  });

  it("marks the opted-in box, and keeps its own groups apart from the map's", () => {
    const d = describeBundle(onMap);
    expect(d.boxes.map((b) => [b.gameId, b.usesMap])).toEqual([["box", true], ["other", undefined]]);
    // A box's tagGroups are its OWN: the map's group is reported once, below.
    expect(d.boxes[0]!.tagGroups.map((g) => g.gameId)).toEqual(["zone"]);
    // The scaffold's `zone` in each box, `weather` in the other, and the
    // project group counted ONCE however many boxes use it.
    expect(d.totals.tagGroups).toBe(4);
  });

  it("summarises the map: group, zones, the boxes on it, and no geometry unless carried", () => {
    expect(describeBundle(onMap).map).toEqual({
      group: "district", tags: ["quay", "hill"], boxes: ["box"],
      zones: 0, backgrounds: 0, sites: {},
    });
    const withGeometry = {
      ...onMap,
      map: {
        ...onMap.map!,
        geometry: {
          zones: [{ tag: "quay", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
          backgrounds: [{ file: "assets/plan.png", x: 0, y: 0, width: 4, height: 4 }],
          sites: { box: [{ hand: "elder", x: 1, y: 2 }] },
        },
      },
    };
    expect(describeBundle(withGeometry).map).toEqual({
      group: "district", tags: ["quay", "hill"], boxes: ["box"],
      zones: 1, backgrounds: 1, sites: { box: 1 },
    });
  });

  it("lists each zone's properties once, as a tag scope with a group and no box", () => {
    const zones = describeBundle(onMap).properties.filter((p) => p.group === "district");
    expect(zones.map((p) => [p.scope, p.owner, p.box])).toEqual([["tag", "quay", undefined], ["tag", "hill", undefined]]);
    expect(zones[0]!.properties.map((p) => p.name)).toEqual(["danger", "alarm"]);
  });

  it("reports a movable hole that names the map's group rather than skipping it", () => {
    expect(describeBundle(onMap).hands.find((h) => h.gameId === "elder")!.movable)
      .toEqual([{ group: "district", from: "@hand.zone" }]);
  });
});
