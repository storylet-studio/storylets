// Durable state as a feature (ruling H, 2026-10-06), and the registry accessor
// (ruling J).
//
// The corpus pins what the durable verbs carry and what a load reports
// (`keepPocket`, `keepMemory`, `newRun`, `openFlowDurable`). These are the host
// API's edges a script cannot reach: the shape of a half as a game stores it,
// the refusals made before anything moves, a memory loaded into an engine that
// is not fresh, and the read-only registry.
import { describe, expect, it } from "vitest";
import { ScopeRegistry } from "@wildwinter/scoperegistry";
import { expandBundle } from "@storylet-studio/conformance";
import { DURABLE_SCHEMA, Engine, StoryletError } from "../src/index.js";
import type { DurableSave } from "../src/index.js";

const bundle = expandBundle({
  story: [
    { name: "souls", type: "number", default: 0, durable: true },
    { name: "oath", type: "enum", default: "iron", values: ["iron", "oak"], shared: false, durable: true },
    { name: "seal", type: "number", default: 0, shared: false, durable: true, writable: false },
    { name: "gold", type: "number", default: 0 },
  ],
  decks: [
    { id: "k_main", cards: [{ id: "c_once", priority: 2, redraw: "never", durable: true }] },
    { id: "k_relics", shared: true, durable: true, cards: [{ id: "c_relic", priority: 1, redraw: "never" }] },
  ],
  hands: [{ id: "h_q", rule: {} }],
});

/** A run that has spent both one-shots and moved every durable value. */
const played = (): Engine => {
  const engine = new Engine(bundle);
  const flow = engine.openFlow("alice");
  flow.setProperty("story.souls", 4);
  flow.setProperty("story.oath", "oak");
  flow.setProperty("story.seal", 9);
  for (const card of flow.deal("q")) flow.play(card.gameId, "", "q");
  return engine;
};

describe("durable halves", () => {
  it("are plain data: the schema tag, the build, values by address and spends by gameId", () => {
    const engine = played();
    expect(engine.saveDurable()).toEqual({
      schema: DURABLE_SCHEMA,
      content: bundle.content,
      values: { "story.souls": 4 },
      spent: ["relic"],
    });
    const pocket = engine.getFlow("alice")!.saveDurable();
    expect(pocket).toEqual({
      schema: "storylets/durable@1",
      content: bundle.content,
      values: { "story.oath": "oak", "story.seal": 9 },
      spent: ["once"],
    });
    // Keys in byte order, so the same state writes the same text.
    expect(Object.keys(pocket.values)).toEqual(["story.oath", "story.seal"]);
    // A copy: changing it changes nothing in the engine.
    pocket.values["story.oath"] = "iron";
    expect(engine.getFlow("alice")!.getProperty("story.oath")).toBe("oak");
  });

  it("survive JSON, which is how a game keeps them", () => {
    const engine = played();
    const memory = JSON.parse(JSON.stringify(engine.saveDurable())) as DurableSave;
    const pocket = JSON.parse(JSON.stringify(engine.getFlow("alice")!.saveDurable())) as DurableSave;
    const next = new Engine(bundle);
    expect(next.loadDurable(memory).exact).toBe(true);
    let exact: boolean | undefined;
    const flow = next.openFlow("alice", { durable: pocket, onRestoreReport: (r) => { exact = r.exact; } });
    expect(exact).toBe(true);
    // A `writable: false` value goes back: that flag is the story's promise,
    // and putting a player's own state back is the game speaking.
    expect(flow.getProperty("story.seal")).toBe(9);
    expect(next.saveDurable()).toEqual(memory);
    expect(flow.saveDurable()).toEqual(pocket);
  });

  it("refuse an unknown schema and another project's state before anything moves", () => {
    const engine = played();
    const memory = engine.saveDurable();
    const next = new Engine(bundle);
    const before = JSON.stringify(next.saveGame());
    expect(() => next.loadDurable({ ...memory, schema: "storylets/durable@9" as typeof DURABLE_SCHEMA }))
      .toThrow("unsupported durable schema: storylets/durable@9");
    expect(() => next.loadDurable({ ...memory, content: { ...memory.content, project: "other" } }))
      .toThrow(`durable state is for project "other", bundle is "conf"`);
    expect(() => next.loadDurable(undefined as unknown as DurableSave)).toThrow(StoryletError);
    expect(JSON.stringify(next.saveGame())).toBe(before);
  });

  it("refuse a pocket for another project as the flow opens, leaving the open flow as it was", () => {
    const engine = played();
    const pocket = engine.getFlow("alice")!.saveDurable();
    const held = engine.getFlow("alice")!;
    expect(() => engine.openFlow("alice", { durable: { ...pocket, content: { ...pocket.content, project: "other" } } }))
      .toThrow(StoryletError);
    expect(held.isClosed).toBe(false);
    expect(() => engine.openFlow("alice", { durable: pocket, restore: engine.saveFlow("alice") }))
      .toThrow(`openFlow "alice": restore and durable cannot be given together`);
    expect(held.isClosed).toBe(false);
    expect(held.getProperty("story.oath")).toBe("oak");
  });

  it("make the memory exactly the engine's durable half, and touch nothing else", () => {
    const engine = played();
    const memory = engine.saveDurable();
    // An engine that is NOT fresh: a durable value moved, a run-scoped one too.
    const next = new Engine(bundle);
    next.openFlow("bob").setProperty("story.gold", 3);
    next.setProperty("story.souls", 8);
    const report = next.loadDurable({ ...memory, values: {} });
    // The memory carries no `souls`, so it takes its default, as the report says.
    expect(report.defaultedProperties).toEqual([{ path: "story.souls" }]);
    expect(next.getProperty("story.souls")).toBe(0);
    expect(next.getProperty("story.gold")).toBe(3);
    expect(next.getFlow("bob")!.isClosed).toBe(false);
  });

  it("name spends by gameId: an internal id is a card this build does not have", () => {
    const next = new Engine(bundle);
    const memory: DurableSave = { schema: DURABLE_SCHEMA, content: bundle.content, values: { "story.souls": 1 }, spent: ["c_relic"] };
    expect(next.loadDurable(memory).droppedSpent).toEqual(["c_relic"]);
    // And a pocket's spend on the memory's side is not the memory's to carry.
    expect(next.loadDurable({ ...memory, spent: ["once"] }).droppedSpent).toEqual(["once"]);
  });

  it("report a value no declaration can hold, as a hand-edited file might carry, and keep the default", () => {
    const flagged = expandBundle({
      story: [
        { name: "marks", type: "flags", default: [], durable: true },
        { name: "souls", type: "number", default: 0, durable: true },
      ],
      hands: [{ id: "h_q", rule: {} }],
    });
    const next = new Engine(flagged);
    const memory = { schema: DURABLE_SCHEMA, content: flagged.content, values: { "story.marks": [1], "story.souls": null }, spent: [] };
    const report = next.loadDurable(memory as unknown as DurableSave);
    expect(report.retypedProperties).toEqual([{ path: "story.marks" }, { path: "story.souls" }]);
    expect(next.getProperty("story.marks")).toEqual([]);
    expect(next.getProperty("story.souls")).toBe(0);
  });

  it("are refused on a closed flow, as every verb is", () => {
    const engine = played();
    const flow = engine.getFlow("alice")!;
    engine.closeFlow("alice");
    expect(() => flow.saveDurable()).toThrow(`flow "alice" is closed`);
  });
});

describe("the registry accessor (ruling J)", () => {
  it("is the registry the game passed in", () => {
    const registry = new ScopeRegistry();
    const engine = new Engine(bundle, { registry });
    expect(engine.registry).toBe(registry);
  });

  it("is the engine's own when it was given none, the same object for its life", () => {
    const engine = new Engine(bundle);
    const own = engine.registry;
    expect(own).toBeInstanceOf(ScopeRegistry);
    expect(own.has("story")).toBe(true);
    engine.reset();
    engine.loadGame(engine.saveGame());
    expect(engine.registry).toBe(own);
  });

  it("is read-only", () => {
    const engine = new Engine(bundle);
    expect(() => { (engine as { registry: unknown }).registry = new ScopeRegistry(); }).toThrow(TypeError);
  });
});
