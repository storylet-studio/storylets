// The combined proof: a Patter engine and a Storylet Engine in one game, on ONE
// ScopeRegistry, with one save (patterkit design/one-registry-handover.md).
//
// The game owns the registry and registers @world itself, as a property the
// registry stores. Each engine registers its own scopes: the Storylet Engine
// @story and its per-flow bags, Patter @patter and its per-flow and per-scene
// bags. Every expression reads every scope, so a Patter scene gates on
// @story.act, and a storylet gates on a @world value a Patter scene wrote.
//
// One save is `{ registry, patter, storylets }`: the registry's values once, for
// every engine, and each engine's part holding only what is not a property.
//
// This runs against Patter's SOURCE in a sibling ../patter checkout (see
// vitest.config.ts), so it proves this Patter, not the last one published.
import { describe, expect, it } from "vitest";
import { ScopeRegistry, readScopeRegistrySpec } from "@wildwinter/scoperegistry";
import { Engine as PatterEngine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";
import { expandBundle } from "@storylet-studio/conformance";
import { Engine as StoryletEngine } from "../../src/index.js";
import type { Flow as StoryletFlow } from "../../src/index.js";

// --- the Storylet Engine's content ------------------------------------------------

const storyletBundle = (extraStory = false) => expandBundle({
  world: [{ name: "alarm", type: "number", default: 0 }],
  story: [
    { name: "act", type: "number", default: 1 },
    ...(extraStory ? [{ name: "rumours", type: "number" as const, default: 0 }] : []),
  ],
  decks: [{
    id: "k_main",
    cards: [
      { id: "c_heist", redraw: "never", outcomes: [{ id: "o_go", changes: {
        "@story.act": "@story.act + 1",
        "@world.alarm": "@world.alarm + 1",
      } }] },
      // Only once a Patter scene has raised the alarm past ten.
      { id: "c_manhunt", condition: "@world.alarm >= 10", outcomes: [{ id: "o_run" }] },
    ],
  }],
  hands: [{ id: "h_q", rule: { slots: "unbounded" } }],
});

// --- Patter's content, compiled against the Storylet Engine's published scopes ----

const spec = readScopeRegistrySpec({
  scopeRegistrySpec: {
    version: 1,
    scopes: [
      { token: "story", declarations: [{ name: "act", type: "number" }] },
      { token: "world", declarations: [{ name: "alarm", type: "number" }] },
    ],
  },
})!;
const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "visits", type: "number", default: 0, shared: true }],
  cast: [{ name: "GUARD" }],
};
const scene: Scene = {
  id: "gate", type: "scene", name: "Gate", gameId: "gate",
  blocks: [{ id: "b", type: "block", name: "B", children: [{
    id: "shout", type: "snippet", condition: "@story.act >= 2",
    onExit: [
      { kind: "set", target: "@world.alarm", value: "@world.alarm + 10" },
      { kind: "set", target: "@visits", value: "@visits + 1" },
    ],
    beats: [{ id: "L", kind: "line", character: "GUARD" }],
    jump: { to: "END" },
  }] }],
};
const en = (line: string): LocaleFile => ({ schema: "patter/strings@0", scene: "gate", locale: "en", strings: { L: line } });
const patterBundle = (line = "Thief!") => exportBundle({ project, scenes: [scene], locales: [en(line)], foreignScopes: spec });

// --- the game -------------------------------------------------------------------

/** One registry for the game. @world is the game's, stored by the registry; both engines read it. */
function combinedGame(opts: { storyletBundle?: ReturnType<typeof storyletBundle>; patterLine?: string } = {}) {
  const registry = new ScopeRegistry()
    .defineOwned("world", [{ name: "alarm", type: "number", default: 0 }], { owner: "Game" });
  const storylets = new StoryletEngine(opts.storyletBundle ?? storyletBundle(), { registry, seed: 3 });
  const patter = new PatterEngine(patterBundle(opts.patterLine), { registry, seed: 3 });
  return { registry, storylets, patter };
}
type Game = ReturnType<typeof combinedGame>;

const heist = (flow: StoryletFlow): void => {
  const dealt = flow.deal("q");
  const card = dealt.find((c) => c.gameId === "heist")!;
  flow.play(card.gameId, "go", "q");
};

/** Play the first part: a heist moves the story to act two, then the Patter guard shouts. */
function playFirstPart(g: Game): void {
  const guard = g.patter.openFlow("guard", { scene: "gate" });
  expect(guard.advance()).toEqual({ type: "end" });        // act 1: the gate stays quiet
  heist(g.storylets.openFlow("thief"));
  const again = g.patter.openFlow("guard", { scene: "gate" });
  expect(again.advance()).toMatchObject({ type: "line", character: "GUARD" });
  g.patter.openFlow("watch", { scene: "gate" });            // a second Patter flow, mid-scene
}

const saveAll = (g: Game) => JSON.parse(JSON.stringify({
  registry: g.registry.save(),
  patter: g.patter.saveGame(),
  storylets: g.storylets.saveGame(),
}));

describe("Patter and the Storylet Engine: one registry, one save", () => {
  it("each engine reads the other's writes through the one registry", () => {
    const g = combinedGame();
    playFirstPart(g);
    const guard = g.patter.getFlow("guard")!;
    expect(guard.advance()).toEqual({ type: "end" });        // onExit: alarm +10, visits +1
    expect(g.registry.get("world", "alarm")).toBe(11);       // 1 from the heist, 10 from the guard
    expect(g.patter.getProperty("@story.act")).toBe(2);      // Patter reads the Storylet Engine's scope
    expect(g.storylets.getProperty("patter.visits")).toBe(1); // and the Storylet Engine reads Patter's
    // The storylet gated on Patter's write is dealt now.
    expect(g.storylets.getFlow("thief")!.deal("q").map((c) => c.gameId)).toContain("manhunt");
  });

  it("saves every property once, in the registry; neither engine's save holds one", () => {
    const g = combinedGame();
    playFirstPart(g);
    g.patter.getFlow("guard")!.advance();
    const save = saveAll(g);
    expect(save.registry.world).toEqual({ alarm: 11 });
    expect(save.registry.story).toEqual({ act: 2 });
    expect(save.registry.patter).toEqual({ visits: 1 });
    expect(save.patter.registry).toBeUndefined();
    expect(save.storylets.registry).toBeUndefined();
    expect(save.storylets.shared).toEqual({ spent: [] });
    // The owner label groups one examiner's rows by engine.
    const owners = new Set(g.registry.listProperties().map((r) => r.owner));
    expect(owners).toEqual(new Set(["Game", "Patter", "Storylet Engine"]));
  });

  for (const order of ["registry first", "engines first"] as const) {
    it(`resumes both engines from the one save, ${order}`, () => {
      const g1 = combinedGame();
      playFirstPart(g1);
      const save = saveAll(g1);

      const g2 = combinedGame();
      if (order === "registry first") g2.registry.load(save.registry);
      g2.patter.loadGame(save.patter);
      g2.storylets.loadGame(save.storylets);
      if (order === "engines first") g2.registry.load(save.registry);

      expect(g2.registry.get("story", "act")).toBe(2);
      expect(g2.registry.get("world", "alarm")).toBe(1);
      // Patter resumes the guard mid-line: the exit writes land on the restored world.
      const guard = g2.patter.getFlow("guard")!;
      expect(guard.advance()).toEqual({ type: "end" });
      expect(g2.registry.get("world", "alarm")).toBe(11);
      // The Storylet Engine's spent heist stayed spent; the manhunt is open.
      const dealt = g2.storylets.getFlow("thief")!.deal("q").map((c) => c.gameId);
      expect(dealt).toContain("manhunt");
      expect(dealt).not.toContain("heist");
      // And a second save of the resumed game carries the same shape.
      expect(Object.keys(saveAll(g2).registry).sort()).toEqual(Object.keys(save.registry).sort());
    });
  }

  it("loads across content drift in both engines, and Patter hot-swaps without disturbing the other", () => {
    const g1 = combinedGame();
    playFirstPart(g1);
    const save = saveAll(g1);

    // A newer build: the Storylet Engine declares a new @story property, Patter rewords a line.
    const g2 = combinedGame({ storyletBundle: storyletBundle(true), patterLine: "Stop, thief!" });
    g2.registry.load(save.registry);
    g2.patter.loadGame(save.patter);
    g2.storylets.loadGame(save.storylets);
    expect(g2.storylets.getProperty("story.rumours")).toBe(0);   // new: its default
    expect(g2.storylets.getProperty("story.act")).toBe(2);       // known: restored

    expect(g2.patter.getFlow("guard")!.advance()).toEqual({ type: "end" }); // visits 0 -> 1, alarm 1 -> 11

    // A live Patter edit mid-game: its bags are handed over on the same registry.
    const swapped = g2.patter.hotSwap(patterBundle("Halt!"));
    expect(swapped.getProperty("@visits")).toBe(1);               // Patter's own value, carried over
    expect(swapped.getProperty("@story.act")).toBe(2);
    expect(swapped.getFlow("watch")!.advance()).toMatchObject({ type: "line", text: "Halt!" });
    expect(swapped.getFlow("watch")!.advance()).toEqual({ type: "end" });
    expect(swapped.getProperty("@visits")).toBe(2);
    expect(g2.registry.get("world", "alarm")).toBe(21);
    expect(g2.storylets.getProperty("story.act")).toBe(2);       // the other engine never noticed
  });

  it("a token clash fails as the game combines its engines, naming who holds it", () => {
    const registry = new ScopeRegistry();
    new StoryletEngine(storyletBundle(), { registry });
    expect(() => new StoryletEngine(storyletBundle(), { registry }))
      .toThrow("scope '@story' is already registered by Storylet Engine");
    new PatterEngine(patterBundle(), { registry });
    expect(() => new PatterEngine(patterBundle(), { registry }))
      .toThrow("scope '@patter' is already registered by Patter");
  });
});
