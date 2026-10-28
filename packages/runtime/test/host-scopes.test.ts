// Host scopes like Patter's (ruled 2026-10-28): what the corpus can't say.
//
// The corpus pins self-backing a second scope, binding one through
// `hostScopes`, the wrong-case report, an opaque scope and a scope-level
// `writable: false` in all four runtimes. A retired option key is JS's alone
// (the typed ports have no field to pass it in), and the examiner rows,
// describeBundle and the game's-registry rule have no script op, so they are
// asserted here.
import { describe, expect, it, vi } from "vitest";
import { ScopeRegistry } from "@wildwinter/scoperegistry";
import { expandBundle } from "@storylet-studio/conformance";
import { BUNDLE_SCHEMA, BUNDLE_SCHEMA_V1 } from "@storylet-studio/model";
import { Engine, describeBundle } from "../src/index.js";
import type { EngineOptions, PlayError } from "../src/index.js";

const bundle = expandBundle({
  scopeRegistry: { version: 1, scopes: [
    { token: "world", declarations: [{ name: "alarm", type: "number", default: 0 }] },
    { token: "player", declarations: [{ name: "hp", type: "number", default: 10 }, { name: "name", type: "string", default: "", writable: false }] },
    { token: "fx" },
  ] },
  cards: [{ id: "c_any" }],
  hands: [{ id: "h_q", rule: {} }],
});

const reports = (opts: EngineOptions): PlayError[] => {
  const out: PlayError[] = [];
  new Engine(bundle, { ...opts, onError: (e) => { out.push(e); } });
  return out;
};

describe("the engine option \"world\" has gone", () => {
  it("is reported as set-up, in Patter's words, and binds nothing", () => {
    const resolver = { get: () => 99 };
    const errors: PlayError[] = [];
    const engine = new Engine(bundle, { world: resolver, onError: (e: PlayError) => { errors.push(e); } } as unknown as EngineOptions);
    expect(errors).toEqual([{ flow: "", kind: "setup", node: "world",
      message: 'the engine option "world" has gone: bind the scope as hostScopes: { world }' }]);
    expect(engine.getProperty("world.alarm")).toBe(0);   // self-backed, not the resolver's 99
  });

  it("reports any other key it doesn't take", () => {
    expect(reports({ sede: 3 } as unknown as EngineOptions)).toEqual([
      { flow: "", kind: "setup", node: "sede", message: '"sede" isn\'t an engine option, so it\'s ignored' },
    ]);
  });

  it("says it on the console with no onError, and in the run log when logging", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const engine = new Engine(bundle, { log: true, hostScopes: { Player: { get: () => 1 } } });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^Storylet Engine: hostScopes binds "Player", which this bundle doesn't declare: it declares "player"/));
      expect(engine.log().some((e) => e.type === "diagnostic" && e.where === "setup")).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("host scopes on the engine's surface", () => {
  it("lists every declared scope's rows, in bundle order, before @story; an opaque one lists none", () => {
    const flow = new Engine(bundle).openFlow("main");
    const paths = flow.listProperties().map((r) => r.path);
    expect(paths.slice(0, 3)).toEqual(["world.alarm", "player.hp", "player.name"]);
    expect(paths.some((p) => p.startsWith("fx."))).toBe(false);
    expect(flow.listProperties().find((r) => r.path === "player.name")).toMatchObject({ writable: false });
  });

  it("a bound scope with no set is read-only to everyone", () => {
    const engine = new Engine(bundle, { hostScopes: { player: { get: (n) => (n === "hp" ? 4 : "Ana") } } });
    expect(engine.getProperty("player.hp")).toBe(4);
    expect(engine.listProperties().find((r) => r.path === "player.hp")).toMatchObject({ value: 4, writable: false });
    expect(() => engine.setProperty("player.hp", 5)).toThrow("@player is read-only here: the host bound no write");
  });

  it("reseeds a self-backed scope on reset, and never touches a bound one", () => {
    const store = new Map<string, unknown>([["alarm", 7]]);
    const engine = new Engine(bundle, { hostScopes: { world: { get: (n) => store.get(n) as never, set: (n, v) => { store.set(n, v); } } } });
    engine.setProperty("player.hp", 2);
    engine.reset();
    expect(engine.getProperty("player.hp")).toBe(10);
    expect(engine.getProperty("world.alarm")).toBe(7);
  });

  it("given the game's registry, registers only what it binds; the rest are the game's", () => {
    const registry = new ScopeRegistry();
    new Engine(bundle, { registry, hostScopes: { world: { get: () => 0 } } });
    expect(registry.has("world")).toBe(true);
    expect(registry.has("player")).toBe(false);
    expect(registry.has("fx")).toBe(false);
  });

  it("describeBundle lists the host scopes before @story, @world as itself and the others by token", () => {
    expect(describeBundle(bundle).properties.slice(0, 4).map((p) => [p.scope, p.owner, p.opaque ?? false])).toEqual([
      ["world", "", false], ["host", "player", false], ["host", "fx", true], ["story", "", false],
    ]);
  });
});

describe("bundles before host scopes", () => {
  it("reads an older bundle's world block as the host scope world, and binds it through hostScopes", () => {
    const legacy = expandBundle({ world: [{ name: "alarm", type: "number", default: 2 }], cards: [{ id: "c_any" }], hands: [{ id: "h_q", rule: {} }] });
    expect(legacy.schema).not.toBe(BUNDLE_SCHEMA);
    expect(legacy.world?.properties).toHaveLength(1);
    expect(new Engine(legacy).getProperty("world.alarm")).toBe(2);
    const errors: PlayError[] = [];
    const engine = new Engine({ ...legacy, schema: BUNDLE_SCHEMA_V1 }, { hostScopes: { world: { get: () => 5 } }, onError: (e) => { errors.push(e); } });
    expect(errors).toEqual([]);
    expect(engine.getProperty("world.alarm")).toBe(5);
  });

  it("the compiler's schema is @2, and a bundle @2 needs no world block", () => {
    expect(bundle.schema).toBe(BUNDLE_SCHEMA);
    expect(bundle.world).toBeUndefined();
  });
});
