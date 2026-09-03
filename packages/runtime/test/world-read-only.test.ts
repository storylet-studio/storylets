// Read-only @world with a HOST resolver bound (Reboot.md 10).
//
// The corpus pins the self-backed path: with no resolver bound, @world is the
// engine's stand-in bag, which is the shared kernel, and the kernel keeps a
// declaration's `writable` for every caller. That is Patter's path too. But a
// game that binds its own resolver takes the engine's writes straight, and
// nothing in the kernel sees them - so the engine keeps the promise itself,
// here, and this is the only test that reaches that line. Probed: disabling
// the engine's check leaves the corpus green and fails this.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/index.js";
import corpus from "../../conformance/corpus.json" with { type: "json" };

const theCase = () => (corpus.scripted as any[]).find((c) => c.name.startsWith("an outcome may not write a read-only @world"))!;

describe("read-only @world with a host resolver bound", () => {
  it("refuses the story's write before it reaches the host, and says why", () => {
    const sets: [string, unknown][] = [];
    const values = new Map<string, unknown>([["clock", 0], ["mood", 0]]);
    const engine = new Engine(theCase().bundle, { seed: 0, world: {
      get: (n) => values.get(n) as never,
      set: (n, v) => { sets.push([n, v]); values.set(n, v); },
    } });
    const flow = engine.openFlow("main");
    flow.deal("h_q");
    expect(() => flow.play("c_tick", "tick", "h_q")).toThrow(/'@world\.clock' is read-only/);
    expect(sets).toEqual([]);                       // the resolver never heard about it
    expect(values.get("clock")).toBe(0);
  });

  it("still lets the story write a property with no flag, through the same resolver", () => {
    const sets: [string, unknown][] = [];
    const values = new Map<string, unknown>([["clock", 0], ["mood", 0]]);
    const engine = new Engine(theCase().bundle, { seed: 0, world: {
      get: (n) => values.get(n) as never, set: (n, v) => { sets.push([n, v]); values.set(n, v); },
    } });
    const flow = engine.openFlow("main");
    flow.deal("h_q");
    flow.play("c_cheer", "cheer", "h_q");
    expect(sets).toEqual([["mood", 1]]);
  });

  it("does not bind the host: the game's own setProperty moves a read-only value", () => {
    const values = new Map<string, unknown>([["clock", 0], ["mood", 0]]);
    const engine = new Engine(theCase().bundle, { seed: 0, world: {
      get: (n) => values.get(n) as never, set: (n, v) => { values.set(n, v); },
    } });
    engine.setProperty("world.clock", 5);
    expect(values.get("clock")).toBe(5);
  });
});
