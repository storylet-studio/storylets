// A condition the engine cannot evaluate counts as false, and the game hears of
// it through onError whether or not anything is tracing (the hands-on review,
// 2026-10, foundation 5). The corpus pins the report with a runner that also
// traces; this is the half it cannot reach: tracing off, and the default.
import { afterEach, describe, expect, it, vi } from "vitest";
import { expandBundle } from "@storylet-studio/conformance";
import { Engine } from "../src/index.js";
import type { PlayError } from "../src/index.js";

const bundle = expandBundle({
  story: [{ name: "gold", type: "number", default: 3 }, { name: "zero", type: "number", default: 0 }],
  cards: [
    { id: "c_broken", priority: 2, condition: "@story.gold / @story.zero > 1" },
    { id: "c_fine", priority: 1 },
  ],
  hands: [{ id: "h_q", rule: {} }],
});

afterEach(() => vi.restoreAllMocks());

describe("onError", () => {
  it("hears a condition that failed to evaluate, with nothing tracing", () => {
    const heard: PlayError[] = [];
    const flow = new Engine(bundle, { onError: (e) => heard.push(e) }).openFlow("main");
    expect(flow.deal("q").map((c) => c.gameId)).toEqual(["fine"]);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ flow: "main", kind: "condition", node: "card broken" });
    expect(heard[0]!.message).toMatch(/division by zero/);
  });

  it("warns on the console when the game gives no handler", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new Engine(bundle).openFlow("main").deal("q");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/the condition on card broken in flow 'main' failed, counted as false: .*division by zero/));
  });
});
