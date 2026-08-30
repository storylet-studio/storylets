// The run's log: one ordered stream over every flow, each line naming its own.
// This is the review finding from design/shared-scarcity.md 8.2 - a story
// action in another flow moves your shared state and your flow's log says
// nothing, so reading a run needs the engine's.
import { describe, expect, it } from "vitest";
import { Engine } from "../src/index.js";
import corpus from "../../conformance/corpus.json" with { type: "json" };

const bundleWithSharedStory = () =>
  (corpus.scripted.find((c: any) => c.name.includes("a shared @story property is one value")) as any).bundle;

describe("the engine's log", () => {
  it("is off unless the run asked for a log", () => {
    const engine = new Engine(bundleWithSharedStory(), { seed: 0 });
    engine.openFlow("alice").dealMany();
    expect(engine.log()).toEqual([]);
  });

  it("carries every flow's events in one order, each naming its flow", () => {
    const engine = new Engine(bundleWithSharedStory(), { seed: 0, log: true });
    const alice = engine.openFlow("alice");
    const bob = engine.openFlow("bob");
    alice.dealMany();
    bob.dealMany();

    const flows = engine.log().map((e) => e.flow);
    expect(new Set(flows)).toEqual(new Set(["alice", "bob"]));
    // Alice dealt first, so her entries come first: the stream is the order
    // things happened in, not a per-flow grouping.
    expect(flows.indexOf("alice")).toBeLessThan(flows.indexOf("bob"));
    // Totally ordered by the engine's own sequence, whatever each flow's is.
    const seqs = engine.log().map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("shows a flow what its own log cannot: another flow's action", () => {
    const engine = new Engine(bundleWithSharedStory(), { seed: 0, log: true });
    const alice = engine.openFlow("alice");
    const bob = engine.openFlow("bob");
    const before = alice.log().length;
    bob.dealMany();
    // Alice's own log is untouched by Bob's deal, which is correct: her
    // journal is hers. The engine's log is where the run is legible.
    expect(alice.log().length).toBe(before);
    expect(engine.log().some((e) => e.flow === "bob")).toBe(true);
  });

  it("clears without touching the flows' own logs", () => {
    const engine = new Engine(bundleWithSharedStory(), { seed: 0, log: true });
    const alice = engine.openFlow("alice");
    alice.dealMany();
    expect(engine.log().length).toBeGreaterThan(0);
    engine.clearLog();
    expect(engine.log()).toEqual([]);
    expect(alice.log().length).toBeGreaterThan(0);
  });
});
