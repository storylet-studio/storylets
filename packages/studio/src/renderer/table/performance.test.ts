// The Board performing cards through Patter, on the real Hamlet pair: its storylet project,
// compiled, and the Patter bundle Patterpad published beside it, with the village box performed.
// Both engines on the Board's one registry, as the combined game has them.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { compileProject, loadProjectFiles, parseProjectFiles } from "@storylet-studio/compiler";
import type { Bundle } from "@storylet-studio/model";
import { Table } from "./model.js";
import type { Performance } from "@storylet-studio/with-patter";

const examples = fileURLToPath(new URL("../../../../../examples/", import.meta.url));

function hamlet(): { bundle: Bundle; patter: unknown } {
  const { project } = parseProjectFiles(loadProjectFiles(`${examples}the-hamlet.storylets`));
  const { bundle } = compileProject(project!);
  if (!bundle) throw new Error("the Hamlet did not compile");
  return { bundle, patter: JSON.parse(readFileSync(`${examples}patter-dist/the_hamlet.patterc`, "utf8")) };
}

/** A Table playing the village through Patter, with the card `gameId` held somewhere on the board. */
function boardWith(gameId: string) {
  const { bundle, patter } = hamlet();
  const table = new Table(bundle, 1, undefined, { bundle: patter, boxes: ["village"] });
  const board = table.dealAll();
  const hand = board.find((h) => h.cards.some((c) => c.gameId === gameId));
  const card = hand?.cards.find((c) => c.gameId === gameId);
  return { table, hand: hand?.hand, card };
}

describe("the Board performing a card through Patter", () => {
  it("builds both engines on one registry, and Patter performs only the named boxes", () => {
    const { table } = boardWith("arrive-at-the-gate");
    expect(table.patter).toBeDefined();
    expect(table.registry?.has("patter")).toBe(true);
    expect(table.performer!.performs("village")).toBe(true);
    expect(table.performer!.performs("elsewhere")).toBe(false);
  });

  it("runs the opening card's scene to its end, and a lone outcome is reached by finishing", () => {
    const { table, hand, card } = boardWith("arrive-at-the-gate");
    expect(card).toBeDefined();
    const outcomes = table.outcomes(card!.id, hand!);
    let p: Performance = table.performer!.start(card!, "village", outcomes);
    // Any choice the scene offers, take the first open one until it ends.
    for (let i = 0; i < 10 && !p.ended; i++) p = table.performer!.choose(p, p.options!.find((o) => o.enabled)!.id, outcomes);
    expect(p.transcript.length).toBeGreaterThan(0);
    expect(p.problem).toBeUndefined();
    expect(outcomes.map((o) => o.gameId)).toContain(p.outcome);
    // Playing it moves the world, as a play from the outcome buttons would.
    table.play(card!.id, p.outcome!, hand!);
    expect(table.log.length).toBeGreaterThan(0);
  });

  it("takes the outcome from the option the player picks", () => {
    const { table, hand, card } = boardWith("arrive-at-the-gate");
    table.play(card!.id, table.outcomes(card!.id, hand!)[0]!.gameId, hand!);
    // After the gate the village is dealt; find a card whose scene offers a labelled choice.
    const board = table.dealAll();
    for (const h of board) {
      for (const c of h.cards) {
        const outcomes = table.outcomes(c.id, h.hand);
        if (outcomes.length < 2) continue;
        const p = table.performer!.start(c, "village", outcomes);
        const labelled = p.options?.find((o) => o.enabled && o.outcome !== undefined);
        if (!labelled) continue;
        let after = table.performer!.choose(p, labelled.id, outcomes);
        for (let i = 0; i < 10 && !after.ended; i++) after = table.performer!.choose(after, after.options!.find((o) => o.enabled)!.id, outcomes);
        expect(after.transcript.some((b) => b.kind === "chose" && b.text === labelled.text)).toBe(true);
        expect(after.outcome).toBe(labelled.outcome);
        return;
      }
    }
    throw new Error("no dealt village card offered a labelled choice");
  });

  it("says so, rather than guessing, when the Patter project has no scene of the card's name", () => {
    const { table, hand, card } = boardWith("arrive-at-the-gate");
    const p = table.performer!.start({ id: card!.id, gameId: "no-such-scene" }, "village", table.outcomes(card!.id, hand!));
    expect(p.ended).toBe(true);
    expect(p.problem).toMatch(/no scene named "no-such-scene"/);
  });

  it("keeps one Patter flow per box across cards, carries it through a save, and New run closes it", () => {
    const { table, hand, card } = boardWith("arrive-at-the-gate");
    table.performer!.start(card!, "village", table.outcomes(card!.id, hand!));
    expect(table.patter!.getFlow("village")).toBeDefined();
    const file = table.saveFile();
    expect(file.patter).toBeDefined();
    table.newRun();
    expect(table.patter!.getFlow("village")).toBeUndefined();
    table.loadFile(file);
    expect(table.patter!.getFlow("village")).toBeDefined();
  });
});
