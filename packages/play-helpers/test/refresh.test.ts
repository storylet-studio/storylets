// ---------------------------------------------------------------------------
// applyLiveBundle: the game-side applier for the editor's pushed bundles. An
// edited Hamlet bundle (a card's condition changed, a card that is on the
// table deleted, a property added) carries the run across: same turns, same
// hands minus the deleted card, the new property at its default, and the
// draw sequence resumes where it was. Failures come back, never thrown.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bundle } from "@storylet-studio/model";
import { Engine } from "@storylet-studio/runtime";
import { applyLiveBundle } from "../src/index.js";

const VILLAGE = // The DEMO copy, which is the tracked artefact: the example's dist/ is
// generated and gitignored, so a runner has no such file - which is exactly
// how CI went red for three days while every local run stayed green.
new URL("../demo/the-hamlet.storyletsc", import.meta.url);
const village = (): Bundle => JSON.parse(readFileSync(VILLAGE, "utf8")) as Bundle;

/** A run a few moves in: the first deal, one play, a turn. */
const midRun = () => {
  const engine = new Engine(village(), { seed: 7, log: true });
  const flow = engine.openFlow("main");
  flow.dealMany();
  flow.play("arrive-at-the-gate", "step-through", "the-inn");
  flow.advanceTurns("village", 2);
  return { engine, flow };
};

/** The village, edited in Storyletter: Wind in the Leaves now needs night
 *  (the Night Settles condition, lifted), Make Yourself Known at the Forge is
 *  deleted while it sits in The Inn, and @story grows a `mood`. */
const edited = (): Bundle => {
  const b = village();
  const box = b.boxes[0]!;
  const card = (gameId: string) => box.decks.flatMap((d) => d.cards).find((c) => c.gameId === gameId)!;
  card("wind-in-the-leaves").condition = card("night-settles").condition;
  const arrival = box.decks.find((d) => d.gameId === "arrival")!;
  arrival.cards = arrival.cards.filter((c) => c.gameId !== "settle-at-the-inn");
  b.story.properties.push({ name: "mood", type: "number", default: 3 });
  b.content = { ...b.content, hash: "edited1" };
  return b;
};

describe("applyLiveBundle", () => {
  it("carries the run into a new engine over the edited bundle", () => {
    const { engine: oldEngine, flow: old } = midRun();
    const before = old.board();
    expect(before["the-inn"]!.map((c) => c.gameId)).toEqual(["settle-at-the-inn"]);
    expect(before["the-mystic-tree"]!.map((c) => c.gameId)).toEqual(["wind-in-the-leaves"]);

    const r = applyLiveBundle(oldEngine, JSON.stringify(edited()), { seed: 7, log: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.engine).not.toBe(oldEngine);
    expect(r.bundle.content.hash).toBe("edited1");

    // loadGame rebuilt every flow: re-take the handle by name.
    const flow = r.engine.getFlow("main")!;
    // Same turns, same state.
    expect(flow.turn("village")).toBe(old.turn("village"));
    expect(flow.getProperty("story.act")).toBe(old.getProperty("story.act"));
    // The new property at its default.
    expect(flow.getProperty("story.mood")).toBe(3);
    expect(() => old.getProperty("story.mood")).toThrow();
    // Same hands, minus the deleted card (load drops it); the recondititioned
    // card stays until its hand is next dealt.
    const after = flow.board();
    expect(after["the-inn"]).toEqual([]);
    expect(after["the-forge"]!.map((c) => c.gameId)).toEqual(before["the-forge"]!.map((c) => c.gameId));
    expect(after["the-mystic-tree"]!.map((c) => c.gameId)).toEqual(["wind-in-the-leaves"]);
    // The played card's cooldown came across: it does not come back.
    const log: unknown[] = [];
    flow.subscribeTrace((e) => log.push(e));
    flow.dealMany();
    expect(flow.board()["the-mystic-tree"]).toEqual([]); // evicted: needs night now
    expect(log).toContainEqual({ type: "evict", hand: "h_tree", card: "c_amb_forest", reason: "condition" });
    expect(Object.values(flow.board()).flat().map((c) => c.gameId)).not.toContain("arrive-at-the-gate");
  });

  it("resumes the draw sequence where the old flow left it (the seed does not matter)", () => {
    const { engine: oldEngine } = midRun();
    const twin = midRun();
    const r = applyLiveBundle(oldEngine, JSON.stringify(village()), { seed: 999 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Same bundle, different seed option: the save carries each flow's PRNG,
    // so the next deals match an engine that was never swapped.
    const flow = r.engine.getFlow("main")!;
    for (let i = 0; i < 4; i++) {
      flow.dealMany();
      twin.flow.dealMany();
      flow.advanceTurns("village");
      twin.flow.advanceTurns("village");
    }
    expect(flow.board()).toEqual(twin.flow.board());
    expect(r.engine.saveGame()).toEqual(twin.engine.saveGame());
  });

  it("returns an error for unparseable JSON, leaving the engine alone", () => {
    const old = midRun();
    const r = applyLiveBundle(old.engine, "{ nope");
    expect(r).toEqual({ ok: false, error: "pushed bundle is not valid JSON" });
    expect(old.flow.turn("village")).toBe(3);
  });

  it("returns an error when the pushed bundle is another project", () => {
    const old = midRun();
    const other = village();
    other.content = { ...other.content, project: "proj_other" };
    const r = applyLiveBundle(old.engine, JSON.stringify(other));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/proj_other/);
  });

  it("returns an error when the runtime rejects the bundle", () => {
    const r = applyLiveBundle(midRun().engine, JSON.stringify({ schema: "storylets/bundle@0" }));
    expect(r.ok).toBe(false);
  });
});
