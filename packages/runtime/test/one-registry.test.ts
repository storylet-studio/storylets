// One registry per game (patterkit design/one-registry-handover.md).
//
// The engine registers every property bag that declares something in the
// game's ScopeRegistry: the shared @story under `story`, every other bag under
// a key starting `storylets/`. `saveGame()` keeps only what is not a property,
// unless the engine made its own registry (a standalone game), when the
// registry's values ride along. These tests hold the engine to that from the
// GAME's side: what is in the registry, what the game saves, and that loading
// works in either order and from a version 1 envelope.
import { describe, expect, it } from "vitest";
import { ScopeRegistry } from "@wildwinter/scoperegistry";
import { expandBundle } from "@storylet-studio/conformance";
import type { SaveEnvelopeV1 } from "@storylet-studio/model";
import { Engine } from "../src/index.js";
import type { Flow } from "../src/index.js";

const bundle = expandBundle({
  world: [{ name: "alarm", type: "number", default: 0 }],
  story: [
    { name: "gold", type: "number", default: 0 },                   // shared: `story`
    { name: "steps", type: "number", default: 0, shared: false },   // each flow's own
  ],
  decks: [{
    id: "k_main",
    properties: [{ name: "drawn", type: "number", default: 0 }],    // per flow (a deck's default)
    cards: [{ id: "c_heist", redraw: "always", outcomes: [{ id: "o_go", changes: {
      "@story.gold": "@story.gold + 1",
      "@story.steps": "@story.steps + 1",
      "@deck.drawn": "@deck.drawn + 1",
      "@world.alarm": "@world.alarm + 1",
    } }] }],
  }],
  hands: [{ id: "h_q", rule: {} }],
});

const heist = (flow: Flow): void => {
  const dealt = flow.deal("q");
  flow.play(dealt[0]!.gameId, "go", "q");
};

/** A game that owns its registry and registers @world itself, as a property the registry stores. */
const game = () => {
  const registry = new ScopeRegistry()
    .defineOwned("world", [{ name: "alarm", type: "number", default: 0 }], { owner: "Game" });
  return { registry, engine: new Engine(bundle, { registry, seed: 1 }) };
};

describe("one registry per game: the Storylet Engine", () => {
  it("registers every bag that declares something, under the engine's keys and owner label", () => {
    const { registry, engine } = game();
    heist(engine.openFlow("f"));
    expect(registry.save()).toEqual({
      world: { alarm: 1 },
      story: { gold: 1 },
      "storylets/flow/f/story": { steps: 1 },
      "storylets/flow/f/deck/k_main": { drawn: 1 },
      "storylets/flow/f/value/v_docks": { danger: 0 }, // the scaffold's tag declares one
    });
    const rows = registry.listProperties().filter((r) => r.owner === "Storylet Engine");
    expect(rows.map((r) => [r.scope, r.path, r.value])).toEqual([
      ["story", "story.gold", 1],
      ["storylets/flow/f/story", "story.steps", 1],
      ["storylets/flow/f/deck/k_main", "deck.main.drawn", 1],
      ["storylets/flow/f/value/v_docks", "value.docks.danger", 0],
    ]);
  });

  it("leaves the values out of saveGame when the game passed the registry", () => {
    const { engine } = game();
    heist(engine.openFlow("f"));
    const save = engine.saveGame();
    expect(save.registry).toBeUndefined();
    expect(save.shared).toEqual({ spent: [] });
    expect(save.flows.f!.props).toBeUndefined();
  });

  it("does not self-back @world in the game's registry: that token is the game's", () => {
    const registry = new ScopeRegistry();
    new Engine(bundle, { registry });
    expect(registry.has("story")).toBe(true);
    expect(registry.has("world")).toBe(false);
  });

  it("a standalone engine self-backs @world as a stored property, and a save round-trips exactly", () => {
    const engine = new Engine(bundle, { seed: 1 });
    heist(engine.openFlow("f"));
    const save = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(save.registry).toEqual({
      story: { gold: 1 }, world: { alarm: 1 },
      "storylets/flow/f/story": { steps: 1 },
      "storylets/flow/f/deck/k_main": { drawn: 1 },
      "storylets/flow/f/value/v_docks": { danger: 0 },
    });
    const restored = new Engine(bundle, { seed: 1 });
    const report = restored.loadGame(save);
    expect(report.exact).toBe(true);
    expect(restored.getProperty("world.alarm")).toBe(1);
    expect(restored.getFlow("f")!.getProperty("deck.main.drawn")).toBe(1);
    expect(JSON.parse(JSON.stringify(restored.saveGame()))).toEqual(save);
  });

  describe("one save for the game, loaded in either order", () => {
    const session1 = () => {
      const g = game();
      heist(g.engine.openFlow("f"));
      g.engine.openFlow("g");
      return JSON.parse(JSON.stringify({ registry: g.registry.save(), storylets: g.engine.saveGame() }));
    };
    const check = (g: ReturnType<typeof game>) => {
      expect(g.engine.getProperty("story.gold")).toBe(1);
      expect(g.engine.getProperty("world.alarm")).toBe(1);
      expect(g.engine.getFlow("f")!.getProperty("story.steps")).toBe(1);
      expect(g.engine.getFlow("f")!.getProperty("deck.main.drawn")).toBe(1);
      expect(g.engine.getFlow("g")!.getProperty("story.steps")).toBe(0);
      heist(g.engine.getFlow("g")!);
      expect(g.registry.get("story", "gold")).toBe(2);
    };

    it("registry first, then the engine", () => {
      const save = session1();
      const g = game();
      g.registry.load(save.registry);
      g.engine.loadGame(save.storylets);
      check(g);
    });

    it("the engine first, then the registry", () => {
      const save = session1();
      const g = game();
      g.engine.loadGame(save.storylets);
      g.registry.load(save.registry);
      check(g);
    });

    it("into a game already playing: flows the save lacks leave nothing behind", () => {
      const save = session1();
      const g = game();
      const live = g.engine.openFlow("f");
      heist(live); heist(live);                // live values the save's must replace
      heist(g.engine.openFlow("stray"));       // not in the save: its bags must not survive
      g.registry.load(save.registry);
      g.engine.loadGame(save.storylets);
      check(g);
      expect(Object.keys(g.registry.save()).filter((k) => k.includes("stray"))).toEqual([]);
    });
  });

  describe("a version 1 envelope, from before the registry held the properties", () => {
    const v1 = (engine: Engine): SaveEnvelopeV1 => ({
      schema: "storylets/save@1",
      content: engine.saveGame().content,
      shared: { props: { story: { gold: 4 }, box: {}, deck: {}, hand: {}, value: {} }, spent: [] },
      flows: { f: {
        props: { story: { steps: 2 }, box: {}, deck: { k_main: { drawn: 3 } }, hand: {}, value: { v_docks: { danger: 1 } } },
        turns: { b_x: 0 }, prng: 1, cooldowns: {}, board: { h_q: [] }, playLog: [],
      } },
    });

    it("still loads, its values moving into the registry", () => {
      const engine = new Engine(bundle, { seed: 1 });
      expect(engine.loadGame(v1(engine)).exact).toBe(true);
      expect(engine.getProperty("story.gold")).toBe(4);
      expect(engine.getFlow("f")!.getProperty("deck.main.drawn")).toBe(3);
      expect(engine.saveGame().registry).toEqual({
        story: { gold: 4 }, world: { alarm: 0 },
        "storylets/flow/f/story": { steps: 2 },
        "storylets/flow/f/deck/k_main": { drawn: 3 },
        "storylets/flow/f/value/v_docks": { danger: 1 },
      });
    });

    it("loads into the game's registry beside values the game already loaded", () => {
      const registry = new ScopeRegistry();
      registry.load({ "another-engine/flow/x/scene/s": { mood: 2 } });
      const engine = new Engine(bundle, { registry, seed: 1 });
      engine.loadGame(v1(engine));
      expect(registry.save()).toEqual({
        story: { gold: 4 },
        "storylets/flow/f/story": { steps: 2 },
        "storylets/flow/f/deck/k_main": { drawn: 3 },
        "storylets/flow/f/value/v_docks": { danger: 1 },
        "another-engine/flow/x/scene/s": { mood: 2 },
      });
    });

    it("still reports drift in the values it moves", () => {
      const engine = new Engine(bundle, { seed: 1 });
      const old = v1(engine);
      old.shared.props.story = { gold: "lots", retired: 1 };
      const report = engine.loadGame(old);
      expect(report.retypedProperties).toEqual([{ path: "story.gold" }]);
      expect(report.droppedProperties).toEqual([{ path: "story.retired" }]);
      expect(engine.getProperty("story.gold")).toBe(0); // a misfit keeps the default
    });
  });

  it("saveFlow parks a flow whole, properties included, and a resume puts them back", () => {
    const { registry, engine } = game();
    heist(engine.openFlow("f"));
    const parked = engine.saveFlow("f");
    expect(parked.props?.deck).toEqual({ k_main: { drawn: 1 } });
    engine.closeFlow("f");
    expect(Object.keys(registry.save()).some((k) => k.startsWith("storylets/flow/f/"))).toBe(false);
    const back = engine.openFlow("f", { restore: parked });
    expect(back.getProperty("deck.main.drawn")).toBe(1);
  });

  it("a fresh flow never claims values a load left for its name", () => {
    const { registry, engine } = game();
    registry.load({ "storylets/flow/f/deck/k_main": { drawn: 9 } });
    expect(engine.openFlow("f").getProperty("deck.main.drawn")).toBe(0);
  });

  it("reset drops this engine's waiting values and no other engine's", () => {
    const { registry, engine } = game();
    registry.load({ ...registry.save(), "storylets/flow/z/story": { steps: 5 }, "other/deck/inn": { drawn: 1 } });
    engine.reset();
    expect(registry.save()["storylets/flow/z/story"]).toBeUndefined();
    expect(registry.save()["other/deck/inn"]).toEqual({ drawn: 1 });
  });

  it("refuses a token another engine holds, naming it, and leaves the registry as it was", () => {
    const registry = new ScopeRegistry();
    new Engine(bundle, { registry });
    expect(() => new Engine(bundle, { registry })).toThrow("scope '@story' is already registered by Storylet Engine");

    const withWorld = new ScopeRegistry().defineOwned("world", [], { owner: "Game" });
    expect(() => new Engine(bundle, { registry: withWorld, world: { get: () => 0 } }))
      .toThrow("scope '@world' is already registered by Game");
    expect(withWorld.has("story")).toBe(false);
  });

  it("reads and writes another engine's game-wide scope by path", () => {
    const registry = new ScopeRegistry().defineOwned("patter", [{ name: "gold", type: "number", default: 3 }], { owner: "Patter" });
    const engine = new Engine(bundle, { registry });
    expect(engine.getProperty("patter.gold")).toBe(3);
    engine.openFlow("f").setProperty("patter.gold", 5);
    expect(registry.get("patter", "gold")).toBe(5);
  });
});
