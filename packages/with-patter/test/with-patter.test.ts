// The with-patter helper against the real Hamlet pair: the Storylet Engine and Patterplay on one
// world, as the Hamlet runs them. Performing, resuming after a save, a card with no outcomes,
// the two gates' reasons, and the build-time pairing check on the published bundles.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Engine as PatterEngine } from "@patterkit/runtime";
import { Engine as StoryletEngine } from "@storylet-studio/runtime";
import { Performer, checkPairing } from "../src/index.js";
import type { CardOutcome } from "../src/index.js";

const examples = fileURLToPath(new URL("../../../examples/", import.meta.url));
const storyletBundle = JSON.parse(readFileSync(`${examples}storylet-dist/the-hamlet.storyletsc`, "utf8"));
const patterBundle = JSON.parse(readFileSync(`${examples}patter-dist/the_hamlet.patterc`, "utf8"));

/** Both engines on one host-owned @world, the Hamlet's arrangement. */
function game() {
  const values: Record<string, unknown> = { time_of_day: "day", knows_road: false };
  const world = { get: (n: string) => values[n] as never, set: (n: string, v: unknown) => { values[n] = v; } };
  const storylets = new StoryletEngine(storyletBundle, { seed: 7, world });
  const patter = new PatterEngine(patterBundle, { seed: 7, world });
  const story = storylets.openFlow("main");
  story.dealMany();
  return { storylets, patter, story, performer: new Performer(patter, new Set(["village"])) };
}
const outcomesOf = (story: ReturnType<typeof game>["story"], card: { id: string }, hand: string): CardOutcome[] =>
  story.outcomes(card.id, hand).map((o) => ({ gameId: o.gameId, available: o.available }));
const dealt = (story: ReturnType<typeof game>["story"], gameId: string) => {
  for (const [hand, cards] of Object.entries(story.board())) {
    const card = cards.find((c) => c.gameId === gameId);
    if (card) return { card, hand };
  }
  throw new Error(`${gameId} is not dealt`);
};

describe("Performer", () => {
  it("plays the gate, and the lone outcome is reached by the scene ending", () => {
    const { story, performer } = game();
    const { card, hand } = dealt(story, "arrive-at-the-gate");
    const p = performer.start(card, "village", outcomesOf(story, card, hand));
    expect(p.ended).toBe(true);
    expect(p.transcript[0]).toMatchObject({ kind: "text", text: expect.stringMatching(/weathered gate/) });
    expect(p.outcome).toBe("step-through");
  });

  it("resumes a scene saved at its choice, with the options read back off the restored flow", () => {
    const first = game();
    const gate = dealt(first.story, "arrive-at-the-gate");
    first.story.play(gate.card.id, "step-through", gate.hand);
    first.story.dealMany();
    const inn = dealt(first.story, "settle-at-the-inn");
    const mid = first.performer.start(inn.card, "village", outcomesOf(first.story, inn.card, inn.hand));
    expect(mid.options?.length).toBe(2);
    // The save a host keeps: both engines, and the Performance (plain JSON) beside them.
    const saved = { storylets: first.storylets.saveGame(), patter: first.patter.saveGame(), performing: JSON.parse(JSON.stringify(mid)) };

    const next = game();
    next.storylets.loadGame(saved.storylets);
    next.patter.loadGame(saved.patter);
    const story = next.storylets.getFlow("main")!;
    const back = next.performer.resume(saved.performing, outcomesOf(story, inn.card, inn.hand));
    expect(back.transcript).toEqual(mid.transcript);
    expect(back.options?.map((o) => o.text)).toEqual(mid.options?.map((o) => o.text));
    const done = next.performer.choose(back, back.options![0]!.id, outcomesOf(story, inn.card, inn.hand));
    expect(done.ended).toBe(true);
    expect(done.outcome).toBe(back.options![0]!.outcome);
  });

  it("plays a card with no outcomes with none", () => {
    const { story, performer } = game();
    const { card, hand } = dealt(story, "arrive-at-the-gate");
    const p = performer.start(card, "village", []);
    expect(p).toMatchObject({ ended: true, outcome: "" });
    void hand;
  });

  it("greys an option whose outcome is shut, and says which engine said no", () => {
    const { story, performer } = game();
    const gate = dealt(story, "arrive-at-the-gate");
    story.play(gate.card.id, "step-through", gate.hand);
    story.dealMany();
    const inn = dealt(story, "settle-at-the-inn");
    const outcomes = outcomesOf(story, inn.card, inn.hand).map((o) => (o.gameId === "ask-about-history" ? { ...o, available: false } : o));
    const p = performer.start(inn.card, "village", outcomes);
    const shut = p.options!.find((o) => o.outcome === "ask-about-history")!;
    expect(shut).toMatchObject({ enabled: false, why: "requirements not met" });
    expect(p.options!.find((o) => o.outcome !== "ask-about-history")!.why).toBeUndefined();
  });
});

/** A stand-in Patter engine replaying one scripted scene per flow: `steps` before the choice,
 *  `after` once an option is taken. Enough to pin the rules without a compiled project. */
function scripted(steps: unknown[], options: unknown[] = [], after: unknown[] = []) {
  let queue = [...steps, ...(options.length ? [{ type: "choice", options }] : []), { type: "end" }];
  const flow = {
    goto: () => true,
    advance: () => queue.shift() ?? { type: "end" },
    choose: () => { queue = [...after, { type: "end" }]; },
    getChoices: () => options,
  };
  const engine = { getFlow: () => flow, openFlow: () => flow, closeFlow: () => undefined, sceneAddress: () => undefined };
  return new Performer(engine as never, new Set(["box"]));
}
const card = { id: "c", gameId: "c" };
const open = (...ids: string[]): CardOutcome[] => ids.map((gameId) => ({ gameId, available: true }));

describe("the Performer's rules", () => {
  it("resolves by last word wins: a gameEvent, then the option's label, then the only outcome", () => {
    const labelled = [{ id: "o1", eligible: true, prompt: { text: "Pay" }, gameData: { outcome: "pay-them-off" } }];
    // 1. an event after the choice beats the label the option carried
    const overruled = scripted([], labelled, [{ type: "gameEvent", id: "e", gameData: { outcome: "walk-away" } }]);
    let p = overruled.start(card, "box", open("pay-them-off", "walk-away"));
    p = overruled.choose(p, "o1", open("pay-them-off", "walk-away"));
    expect(p.outcome).toBe("walk-away");
    // 2. the label, when the scene fired no event
    const plain = scripted([], labelled);
    expect(plain.choose(plain.start(card, "box", open("pay-them-off", "walk-away")), "o1", open("pay-them-off", "walk-away")).outcome).toBe("pay-them-off");
    // 3. the only outcome, when the scene said nothing at all
    expect(scripted([{ type: "text", id: "t", text: "..." }]).start(card, "box", open("continue")).outcome).toBe("continue");
  });

  it("says so, rather than guessing, when nothing answers and the card has several", () => {
    const p = scripted([{ type: "text", id: "t", text: "..." }]).start(card, "box", open("a", "b"));
    expect(p).toMatchObject({ ended: true, problem: "The scene ended without saying which outcome it reached." });
    expect(p.outcome).toBeUndefined();
  });

  it("greys an option either engine refuses, and says which", () => {
    const options = [
      { id: "o1", eligible: true, prompt: { text: "Pay them off" }, gameData: { outcome: "pay-them-off" } },
      { id: "o2", eligible: true, prompt: { text: "Walk away" }, gameData: { outcome: "walk-away" } },
      { id: "o3", eligible: false, prompt: { text: "Never spoken" } },
      { id: "o4", eligible: true, prompt: { text: "Unlabelled" } },
    ];
    const p = scripted([], options).start(card, "box", [{ gameId: "pay-them-off", available: false }, { gameId: "walk-away", available: true }]);
    expect(p.options!.map((o) => [o.id, o.enabled, o.why])).toEqual([
      ["o1", false, "requirements not met"],
      ["o2", true, undefined],
      ["o3", false, "not available here"],
      ["o4", true, undefined],
    ]);
  });
});

describe("checkPairing", () => {
  it("finds the Hamlet's published pair in line, for the box it performs", () => {
    expect(checkPairing(storyletBundle, patterBundle, ["village"])).toEqual([]);
  });

  it("names a card with no scene, a scene with no card, and an outcome a card doesn't declare", () => {
    const scenes = { ...patterBundle.scenes };
    const inn = scenes["settle-at-the-inn"];
    delete scenes["settle-at-the-inn"];
    scenes["a-stray"] = { ...inn, id: "a-stray", name: "A Stray", gameId: "a-stray" };
    const found = checkPairing(storyletBundle, { ...patterBundle, scenes }, ["village"]);
    expect(found).toContain('card "settle-at-the-inn" has no scene of that name');
    expect(found).toContain('scene "a-stray" belongs to no card, so nothing can ever play it');
    // Without the boxes, a card is not required to have a scene, and a stray scene is not reported.
    expect(checkPairing(storyletBundle, { ...patterBundle, scenes })).toEqual([]);
  });
});
