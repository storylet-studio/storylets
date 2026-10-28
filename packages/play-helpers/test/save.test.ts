// Save-file plumbing: the string boundary over the runtime's envelope.
import { describe, expect, it } from "vitest";
import { Engine } from "@storylet-studio/runtime";
import { expandBundle } from "@storylet-studio/conformance";
import { createWorldContainer, deserializeState, saveState, loadState, serializeState } from "../src/index.js";

const bundle = expandBundle({
  story: [{ name: "gold", type: "number", default: 0 }],
  cards: [{ id: "c_a", priority: 1, tags: { zone: ["docks"] },
    outcomes: [{ id: "o_go", changes: { "@story.gold": "7" } }] }],
  hands: [{ id: "h_seat", rule: { bindings: { zone: "docks" } }, slots: 1 }],
});

describe("serialize / load round trip", () => {
  it("restores the serialized state into a fresh engine, every flow rebuilt", () => {
    const engineA = new Engine(bundle, { seed: 0 });
    const a = engineA.openFlow("main");
    a.deal("seat");
    a.play("c_a", "go", "seat");
    const json = serializeState(engineA);

    const engineB = new Engine(bundle, { seed: 0 });
    deserializeState(engineB, json);
    expect(engineB.getFlow("main")!.getProperty("story.gold")).toBe(7);
  });

  it("still loads a file written before save version 3, keyed by internal id", () => {
    const engineA = new Engine(bundle, { seed: 0 });
    const a = engineA.openFlow("main");
    a.deal("seat");
    // The same file as an older runtime wrote it: save@2, the board by hand and card id.
    const file = JSON.parse(serializeState(engineA));
    file.engine.schema = "storylets/save@2";
    file.engine.flows.main.board = { h_seat: ["c_a"] };
    const engineB = new Engine(bundle, { seed: 0 });
    deserializeState(engineB, JSON.stringify(file));
    expect(engineB.getFlow("main")!.board()["seat"]!.map((c) => c.id)).toEqual(["c_a"]);
  });

  it("rejects non-JSON and foreign blobs", () => {
    const engineB = new Engine(bundle, { seed: 0 });
    expect(() => deserializeState(engineB, "not json")).toThrow(/JSON/);
    expect(() => deserializeState(engineB, JSON.stringify({ schema: "patter/save@0" }))).toThrow(/storylets save/);
    // A bare engine envelope is not a save FILE: the file is the host's
    // wrapper (engine + optionally the host's @world container).
    expect(() => deserializeState(engineB, JSON.stringify({ schema: "storylets/save@1" }))).toThrow(/storylets save/);
  });

  it("saveState / loadState are the same pair over a PARSED file", () => {
    // Patterplay's pairing (patter play-helpers save.ts, and its three ports):
    // saveState / loadState work on the object, serializeState /
    // deserializeState on text. The JS reference had neither half of the
    // object pair until 2026-08-29 while Godot and Unreal had both.
    const a = new Engine(bundle, { seed: 0 });
    a.openFlow("main").dealMany();
    a.getFlow("main")!.setProperty("story.gold", 9);
    const file = saveState(a, { season: "spring" });
    const b = new Engine(bundle, { seed: 0 });
    expect(loadState(b, file)).toEqual({ season: "spring" });
    expect(b.getFlow("main")!.getProperty("story.gold")).toBe(9);
    // ...and the text pair goes through the same door.
    const c = new Engine(bundle, { seed: 0 });
    expect(deserializeState(c, JSON.stringify(file))).toEqual({ season: "spring" });
    expect(c.getFlow("main")!.getProperty("story.gold")).toBe(9);
  });

  it("hands the load's report to onReport, and still returns the @world values", () => {
    const a = new Engine(bundle, { seed: 0 });
    a.openFlow("main").dealMany();
    const file = saveState(a, { season: "spring" });
    const b = new Engine(bundle, { seed: 0 });
    let report: ReturnType<Engine["loadGame"]> | undefined;
    expect(loadState(b, file, { onReport: (r) => { report = r; } })).toEqual({ season: "spring" });
    expect(report).toEqual(b.previewLoad(file.engine));
    expect(report?.exact).toBe(true);
    expect(report?.flows).toEqual(["main"]);
    // The text twin passes it through.
    let fromText: typeof report;
    deserializeState(new Engine(bundle, { seed: 0 }), JSON.stringify(file), { onReport: (r) => { fromText = r; } });
    expect(fromText).toEqual(report);
  });

  // A held card is checked on load against the world the game will play in
  // (foundation 7): given the container, the saved world goes in FIRST, so the
  // check reads it, and a refused load leaves the container as it was.
  it("puts the saved @world into a container it is given before the engine loads", () => {
    const worldBundle = expandBundle({
      world: [{ name: "night", type: "boolean", default: false }],
      cards: [{ id: "c_owl", condition: "@world.night" }],
      hands: [{ id: "h_q", rule: {} }],
    });
    const saving = createWorldContainer(worldBundle);
    saving.load({ night: true });
    const a = new Engine(worldBundle, { seed: 0, hostScopes: { world: saving.resolver } });
    expect(a.openFlow("main").deal("q").map((c) => c.gameId)).toEqual(["owl"]);
    const file = saveState(a, { ...saving.values() });

    const loading = createWorldContainer(worldBundle); // night is false here
    const b = new Engine(worldBundle, { seed: 0, hostScopes: { world: loading.resolver } });
    let report: ReturnType<Engine["loadGame"]> | undefined;
    loadState(b, file, { world: loading, onReport: (r) => { report = r; } });
    expect(loading.values()).toEqual({ night: true });
    expect(report?.evicted).toEqual([]);
    expect(b.getFlow("main")!.board()).toMatchObject({ q: [{ gameId: "owl" }] });

    // Without it, the check reads the game's own world, and the owl goes.
    const plain = createWorldContainer(worldBundle);
    const c = new Engine(worldBundle, { seed: 0, hostScopes: { world: plain.resolver } });
    let costly: typeof report;
    loadState(c, file, { onReport: (r) => { costly = r; } });
    expect(costly?.evicted.map((e) => e.card)).toEqual(["owl"]);

    // A refused load puts the container back.
    const kept = createWorldContainer(worldBundle);
    const other = new Engine(expandBundle({ content: { project: "elsewhere" }, world: [{ name: "night", type: "boolean", default: false }],
      cards: [{ id: "c_x" }], hands: [{ id: "h_q", rule: {} }] }), { seed: 0, hostScopes: { world: kept.resolver } });
    expect(() => loadState(other, file, { world: kept })).toThrow();
    expect(kept.values()).toEqual({ night: false });
  });

  it("carries the host's @world container beside the envelope, and hands it back on load", () => {
    const engine = new Engine(bundle, { seed: 0 });
    engine.openFlow("main");
    const json = serializeState(engine, { season: "winter" });

    const fresh = new Engine(bundle, { seed: 0 });
    const world = deserializeState(fresh, json);
    // The HOST applies these to its container; the engine never touches them.
    expect(world).toEqual({ season: "winter" });
  });
});
