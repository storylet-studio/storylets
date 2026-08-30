// Save-file plumbing: the string boundary over the runtime's envelope.
import { describe, expect, it } from "vitest";
import { Engine } from "@storylet-studio/runtime";
import { expandBundle } from "@storylet-studio/conformance";
import { deserializeState, saveState, loadState, serializeState } from "../src/index.js";

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
