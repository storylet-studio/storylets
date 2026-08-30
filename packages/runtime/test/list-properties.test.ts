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
