// listProperties: the examiner surface (parity member across every
// runtime). Path-addressed rows over the declared surface, bundle order.
import { describe, expect, it } from "vitest";
import { Engine } from "../src/index.js";
import { expandBundle } from "@storylet-studio/conformance";

const bundle = expandBundle({
  world: [{ name: "season", type: "string", default: "spring" }],
  story: [{ name: "gold", type: "number", default: 0 }],
  cards: [{ id: "c_a", priority: 1, tags: { zone: ["docks"] },
    outcomes: [{ id: "o_go", changes: { "@story.gold": "1" } }] }],
  hands: [{ id: "h_seat", rule: { bindings: { zone: "docks" } }, slots: 1 }],
});

describe("session.listBoxes", () => {
  it("enumerates boxes with identity and live clocks", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    const before = session.listBoxes();
    expect(before.length).toBeGreaterThan(0);
    expect(before[0]).toMatchObject({ turn: 0 });
    expect(typeof before[0]!.id).toBe("string");
    expect(typeof before[0]!.gameId).toBe("string");
    session.advanceTurns(before[0]!.gameId, 2);
    expect(session.listBoxes()[0]!.turn).toBe(2);
  });
});

describe("session.listProperties", () => {
  it("lists declared properties path-addressed, world then story then stores", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    const rows = session.listProperties();
    const paths = rows.map((r) => r.path);
    expect(paths[0]).toBe("world.season");
    expect(paths[1]).toBe("story.gold");
    // The fixture's docks tag declares danger (a value-store row).
    expect(paths.some((p) => /^value\..+\.danger$/.test(p))).toBe(true);
  });

  it("rows carry type, live value, and default; getProperty agrees", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    session.deal("seat");
    session.play("c_a", "go", "seat");
    const gold = session.listProperties().find((r) => r.path === "story.gold")!;
    expect(gold.type).toBe("number");
    expect(gold.default).toBe(0);
    expect(gold.value).toBe(1);
    expect(session.getProperty("story.gold")).toBe(1);
  });
});

// A tag's gameId is unique only within its group, and a group's only within
// its box, so two boxes may each name a tag "docks" and the short address
// names two stores. What the engine PRINTS is box-qualified for exactly those
// (design/engine-server.md 4.4's follow-up), and unchanged for everything
// else, which is what makes this invisible to a project whose tag names happen
// to be unique.
describe("listProperties and a tag gameId two boxes share", () => {
  const shared = expandBundle({
    cards: [{ id: "c_a", tags: { zone: ["docks"] } }],
    hands: [{ id: "h_seat", rule: {} }],
    otherBox: { cards: [{ id: "c_y" }] },
  });

  it("prints the qualified owner segment for the repeated gameId", () => {
    const session = new Engine(shared, { seed: 0 }).openFlow("main");
    const paths = session.listProperties().map((r) => r.path);
    expect(paths).toContain("value.box/docks.danger");
    expect(paths).toContain("value.other/docks.danger");
    expect(paths).not.toContain("value.docks.danger");
  });

  it("takes both qualified addresses, and refuses the short one by name", () => {
    const session = new Engine(shared, { seed: 0 }).openFlow("main");
    session.setProperty("value.box/docks.danger", 1);
    session.setProperty("value.other/docks.danger", 5);
    expect(session.getProperty("value.box/docks.danger")).toBe(1);
    expect(session.getProperty("value.other/docks.danger")).toBe(5);
    expect(() => session.getProperty("value.docks.danger"))
      .toThrow(/names a tag in 2 boxes.*"value\.box\/docks\.danger" or "value\.other\/docks\.danger"/);
  });

  it("leaves a gameId only one box uses exactly as it was", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    const paths = session.listProperties().map((r) => r.path);
    expect(paths).toContain("value.docks.danger");
    session.setProperty("value.docks.danger", 2);
    // Accepted whether or not it is needed: a tool that always writes the
    // qualified form is not made wrong by an author deleting the second box.
    expect(session.getProperty("value.box/docks.danger")).toBe(2);
  });
});
