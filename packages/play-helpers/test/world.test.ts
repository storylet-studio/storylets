// ---------------------------------------------------------------------------
// The host's @world container. `writable: false` on a world declaration is the
// STORY's promise not to write it (Reboot.md 10) - it says nothing about the
// GAME, whose state this container IS. So the container writes: the bag, the
// resolver, and therefore setProperty through an engine bound to it. The
// promise is kept in the engine's outcome path, which is the only place the
// story does the writing.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { Engine } from "@storylet-studio/runtime";
import { expandBundle } from "@storylet-studio/conformance";
import { createWorldContainer } from "../src/index.js";

const bundle = expandBundle({
  world: [
    { name: "time_phase", type: "enum", default: "day", values: ["day", "night"], writable: false },
    { name: "mood", type: "number", default: 0 },
  ],
  cards: [
    { id: "c_tick", outcomes: [{ id: "o_tick", changes: { "@world.time_phase": '"night"' } }] },
    { id: "c_cheer", outcomes: [{ id: "o_cheer", changes: { "@world.mood": "@world.mood + 1" } }] },
  ],
  hands: [{ id: "h_q", rule: {} }],
});

describe("createWorldContainer", () => {
  it("the bag takes a HOST write to a read-only declaration, and refuses a plain one", () => {
    const world = createWorldContainer(bundle);
    expect(world.bag.get("time_phase")).toBe("day");
    // The bag IS the kernel's, so it asks the kernel's question: the flag says
    // the game is speaking, and the game may move its own value.
    world.bag.set("time_phase", "night", { host: true });
    expect(world.bag.get("time_phase")).toBe("night");
    expect(world.values()["time_phase"]).toBe("night");
    expect(() => world.bag.set("time_phase", "day")).toThrow(/is read-only/);
  });

  it("the examiner still reads the declaration: a host write does not make it writable", () => {
    const world = createWorldContainer(bundle);
    world.resolver.set!("time_phase", "night");
    const rows = world.bag.rows();
    expect(rows.find((r) => r.name === "time_phase")).toMatchObject({ value: "night", writable: false });
    expect(rows.find((r) => r.name === "mood")).toMatchObject({ writable: true });
  });

  it("the resolver writes it too, so a host-bound engine reads the same rule as a self-backed one", () => {
    // The resolver is the engine's doorway and only the host arrives there: an
    // outcome was refused a step earlier, against the engine's read-only table.
    const world = createWorldContainer(bundle);
    world.resolver.set!("time_phase", "night");
    expect(world.resolver.get("time_phase")).toBe("night");

    const engine = new Engine(bundle, { seed: 0, world: world.resolver });
    const flow = engine.openFlow("main");
    flow.setProperty("world.time_phase", "day");           // the host's own path
    expect(world.bag.get("time_phase")).toBe("day");
    engine.setProperty("world.time_phase", "night");       // and the engine-level one
    expect(world.bag.get("time_phase")).toBe("night");
  });

  it("an outcome is still refused: the engine asks before it reaches the resolver", () => {
    const world = createWorldContainer(bundle);
    const flow = new Engine(bundle, { seed: 0, world: world.resolver }).openFlow("main");
    flow.dealMany();
    expect(() => flow.play("c_tick", "tick", "q")).toThrow(/read-only \(writable: false\)/);
    expect(world.bag.get("time_phase")).toBe("day");       // refused, so no side effect
    flow.play("c_cheer", "cheer", "q");                    // an absent flag is writable
    expect(world.bag.get("mood")).toBe(1);
  });

  it("load lays saved values over the defaults, read-only ones included", () => {
    const world = createWorldContainer(bundle);
    world.load({ time_phase: "night", mood: 3 });
    expect(world.values()).toEqual({ time_phase: "night", mood: 3 });
  });
});
