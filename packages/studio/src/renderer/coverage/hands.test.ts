// @vitest-environment jsdom
// The Coverage window's per-hand block, rendered headlessly: each hand's count
// is out of the cards that could come up in it, the row names the hand by its
// title with its deals beside it, and a hand nothing can reach says so. It is
// a disclosure, folded away below the card table.

import { describe, expect, it } from "vitest";
import { handsBlock } from "./hands.js";
import type { OpenRow } from "./hands.js";
import type { CoverageReport } from "../../shared/api.js";

type HandRow = CoverageReport["hands"][number];

const report = (hands: HandRow[], runs = 200): CoverageReport => ({
  runs, seed: 0, maxTurns: 100, drivers: [], turns: 0, plays: 0,
  terminations: { exhausted: 0, maxTurns: runs, stuck: 0 },
  cards: [], totals: { cards: 0, dealt: 0, neverDealt: 0, rare: 0, dealtNeverPlayed: 0 }, rareThresholdPct: 5,
  outcomes: [], hands, unwrittenInputs: [], unprovidedHandRefs: [], diagnostics: [], issues: [],
});

const hand = (over: Partial<HandRow>): HandRow => ({
  id: "h_camp", gameId: "miners-camp", title: "Miners Camp", box: "b_1", boxName: "The Village",
  deals: 1240, cardsPossible: ["c_1", "c_2"], cardsDealt: ["c_1", "c_2"], cardsNeverDealt: [], ...over,
});

const openRow: OpenRow = (className, _selection, ...children) => {
  const row = document.createElement("button");
  row.className = className;
  for (const c of children) if (c !== null) row.append(c);
  return row;
};

const text = (node: Element | null): string => node?.textContent ?? "";

describe("the per-hand block", () => {
  it("says what it counts, over how many runs, as the caption of a folded disclosure", () => {
    const block = handsBlock(report([hand({})], 200), openRow);
    expect(block.tagName).toBe("DETAILS");
    expect(block.open).toBe(false);
    expect(block.querySelector("summary")?.classList.contains("caption")).toBe(true);
    expect(text(block.querySelector(".caption"))).toBe("Cards seen in each hand, over 200 runs");
  });

  it("leads with the title, keeps the gameId and the deals quiet, and counts out of the possible", () => {
    const row = handsBlock(report([hand({})]), openRow).querySelector(".qrow")!;
    expect(text(row.querySelector(".qtitle"))).toBe("Miners Camp");
    const sub = [...row.querySelectorAll(".qsub .shell-meta-part")].map(text);
    // Grouped in the reader's locale, so the separator is not pinned here.
    expect(sub[0]).toBe("miners-camp");
    expect(sub[1]).toMatch(/^1\D?240 deals$/);
    expect(text(row.querySelector(".count"))).toBe("2/2");
    expect(row.classList.contains("full")).toBe(true);
  });

  it("an untitled hand reads as its gameId, with the deals alone beneath", () => {
    const row = handsBlock(report([hand({ title: undefined, deals: 1 })]), openRow).querySelector(".qrow")!;
    expect(text(row.querySelector(".qid"))).toBe("miners-camp");
    expect(row.querySelector(".qtitle")).toBeNull();
    expect([...row.querySelectorAll(".qsub .shell-meta-part")].map(text)).toEqual(["1 deal"]);
  });

  it("a gap shows as a short bar, and a card dealt against the static rule cannot push the count past the possible", () => {
    const gap = handsBlock(report([hand({ cardsDealt: ["c_1"], cardsNeverDealt: ["c_2"] })]), openRow).querySelector(".qrow")!;
    expect(text(gap.querySelector(".count"))).toBe("1/2");
    expect(gap.classList.contains("full")).toBe(false);
    expect(gap.querySelector<HTMLElement>(".fill")!.style.width).toBe("50%");
    const odd = handsBlock(report([hand({ cardsDealt: ["c_1", "c_2", "c_elsewhere"] })]), openRow).querySelector(".qrow")!;
    expect(text(odd.querySelector(".count"))).toBe("2/2");
  });

  it("a hand nothing can come up in says so rather than drawing 0/0", () => {
    const row = handsBlock(report([hand({ cardsPossible: [], cardsDealt: [], cardsNeverDealt: [], deals: 0 })]), openRow).querySelector(".qrow")!;
    expect(row.querySelector(".count")).toBeNull();
    expect(row.querySelector(".bar")).toBeNull();
    expect(text(row.querySelector(".qnone"))).toBe("No card's tags let it come up here.");
  });

  it("names the box above its hands only when there is more than one box", () => {
    const one = handsBlock(report([hand({}), hand({ id: "h_inn", gameId: "inn", title: "The Inn" })]), openRow);
    expect(one.querySelectorAll(".qbox")).toHaveLength(0);
    const two = handsBlock(report([
      hand({}),
      hand({ id: "h_codex", gameId: "codex", title: "Codex", box: "b_2", boxName: "Codex" }),
    ]), openRow);
    expect([...two.querySelectorAll(".qbox")].map(text)).toEqual(["The Village", "Codex"]);
  });
});
