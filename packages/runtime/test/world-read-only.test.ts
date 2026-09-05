// Read-only @world with a HOST resolver bound (Reboot.md 10).
//
// The corpus pins the self-backed path, both halves of it: the outcome is
// refused, and the HOST's setState on the same property lands. It lands because
// the promise is the STORY's, so it is kept in applyWrite and nowhere else: the
// stand-in bag keeps the declaration as written, and the host's own surface
// passes the shared kernel's `{ host: true }` (scoperegistry 0.6.0), which
// `writable: false` was never a rule for. Before that flag existed the bag
// refused every caller alike, which left the host unable to move a value the
// game owns and took `coverage` down on any project driving a read-only clock.
//
// A game that binds its own resolver takes the engine's writes straight, and no
// bag sees them - so the engine keeps the promise itself, here, and this is the
// only test that reaches that line. Probed: disabling the engine's check leaves
// the corpus green and fails this.
//
// The examiner half has no corpus op to carry it (no script op reads a row), so
// it is asserted here and in each port's smoke check instead.
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

describe("the examiner over a read-only @world", () => {
  const rowFor = (engine: Engine, path: string) => engine.listProperties().find((r) => r.path === path);

  it("reports the declaration, self-backed, and keeps reporting it after a host write", () => {
    const engine = new Engine(theCase().bundle, { seed: 0 });
    expect(rowFor(engine, "world.clock")).toMatchObject({ value: 0, writable: false });
    expect(rowFor(engine, "world.mood")).toMatchObject({ writable: true });
    engine.setProperty("world.clock", 5);                  // the game's own surface
    expect(rowFor(engine, "world.clock")).toMatchObject({ value: 5, writable: false });
  });

  it("reports it with a resolver bound too, and a flow's rows agree with the engine's", () => {
    const values = new Map<string, unknown>([["clock", 0], ["mood", 0]]);
    const engine = new Engine(theCase().bundle, { seed: 0, world: {
      get: (n) => values.get(n) as never, set: (n, v) => { values.set(n, v); },
    } });
    const flow = engine.openFlow("main");
    expect(rowFor(engine, "world.clock")).toMatchObject({ writable: false });
    expect(flow.listProperties().find((r) => r.path === "world.clock")).toMatchObject({ writable: false });
  });

  it("reports every @world row read-only when the host bound no write at all", () => {
    const engine = new Engine(theCase().bundle, { seed: 0, world: { get: () => 0 as never } });
    expect(rowFor(engine, "world.mood")).toMatchObject({ writable: false });
    expect(() => engine.setProperty("world.mood", 1)).toThrow(/the host bound no write/);
  });
});
