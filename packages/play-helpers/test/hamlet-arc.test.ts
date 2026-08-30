// ---------------------------------------------------------------------------
// Gareth's Debt, played end to end. The Hamlet's spine arc runs on a quality
// (debt: quiet > troubled > confronted) with a `helped` fact beside it, and
// this test walks both endings through the real runtime: each beat gates on
// exactly one stage, advance() moves the ladder one rung per play, the fact
// alone decides whether the epilogue exists, and the ladder saturates at the
// top. If an edit to the example breaks the arc, this is what says so.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bundle } from "@storylet-studio/model";
import { Engine } from "@storylet-studio/runtime";

const HAMLET = // The DEMO copy, which is the tracked artefact: the example's dist/ is
// generated and gitignored, so a runner has no such file - which is exactly
// how CI went red for three days while every local run stayed green.
new URL("../demo/the-hamlet.storyletsc", import.meta.url);
const hamlet = (): Bundle => JSON.parse(readFileSync(HAMLET, "utf8")) as Bundle;

/** A session standing where the arc begins: past arrival, blacksmith met
 *  and warm, reputation enough to afford the debt. */
const atTheForge = () => {
  const engine = new Engine(hamlet(), { seed: 11 });
  const s = engine.openFlow("main");
  atTheForge.lastEngine = engine;
  s.setProperty("story.act", "settling_in");
  s.setProperty("story.rel_blacksmith", ["met", "warm"]);
  s.setProperty("story.reputation", 2);
  return s;
};
atTheForge.lastEngine = undefined as unknown as Engine;

const gids = (cards: { gameId: string }[]) => cards.map((c) => c.gameId);

const playArc = (chosenOutcome: string) => {
  const s = atTheForge();
  const debt = () => s.getProperty("deck.k_gareth.debt");

  // quiet: only the opener is on offer; the men cannot arrive early.
  let forge = gids(s.deal("the-forge"));
  expect(forge).toContain("gareth-looks-troubled");
  expect(forge).not.toContain("the-moneylenders-men");
  expect(debt()).toBe("quiet");
  s.play("gareth-looks-troubled", "ask-what-is-wrong", "the-forge");
  expect(debt()).toBe("troubled");

  // troubled: the opener is done, the confrontation is due.
  forge = gids(s.deal("the-forge"));
  expect(forge).not.toContain("gareth-looks-troubled");
  expect(forge).toContain("the-moneylenders-men");
  s.play("the-moneylenders-men", chosenOutcome, "the-forge");
  expect(debt()).toBe("confronted");

  // confronted: the ladder is at its top, the confrontation never repeats.
  forge = gids(s.deal("the-forge"));
  expect(forge).not.toContain("the-moneylenders-men");
  return { s, forge };
};

describe("Gareth's Debt plays end to end on its quality", () => {
  it("paying the debt sets the helped fact and earns the gratitude", () => {
    const { s, forge } = playArc("pay-them-off");
    expect(s.getProperty("deck.k_gareth.helped")).toBe(true);
    expect(forge).toContain("gareths-gratitude");
  });

  it("walking away leaves no fact, so the gratitude never comes", () => {
    const { s, forge } = playArc("walk-away");
    expect(s.getProperty("deck.k_gareth.helped")).toBe(false);
    expect(forge).not.toContain("gareths-gratitude");
  });

  it("the save carries the stage by name", () => {
    playArc("pay-them-off");
    const restored = new Engine(hamlet(), { seed: 3 });
    restored.loadGame(atTheForge.lastEngine.saveGame());
    expect(restored.getFlow("main")!.getProperty("deck.k_gareth.debt")).toBe("confronted");
  });
});
