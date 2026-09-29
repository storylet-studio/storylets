// @vitest-environment jsdom
// The Coverage window's summary and card table, rendered headlessly: headed
// columns that explain themselves, least reached first by default with a
// switch to deck order, a quiet "Rare" tag, the honesty net's reason on a
// never-dealt row, its own tint for a card dealt and never played, and "no
// outcomes" rather than a 0 for a card whose whole job is to be dealt.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cardsBlock, summaryBlock } from "./cards.js";
import type { CardTableOptions } from "./cards.js";
import type { CoverageReport } from "../../shared/api.js";

type CardRow = CoverageReport["cards"][number];

afterEach(() => { document.body.replaceChildren(); });

const card = (id: string, dealtRuns: number, dealt: number, played: number, over: Partial<CardRow> = {}): CardRow => ({
  id, gameId: id, title: `Title ${id}`, deck: "k_1", deckName: "Main", box: "b_1", boxName: "The Village",
  dealt, played, dealtRuns, playedRuns: played > 0 ? Math.min(dealtRuns, played) : 0,
  rare: dealtRuns > 0 && dealtRuns * 100 < 5 * 200, ...over,
});

// Deck order: always (every run), common (half), unplayed (dealt, never
// played), rare (4 runs of 200), gated (never dealt, a reason known),
// news (no outcomes, dealt in every run).
const cards: CardRow[] = [
  card("always", 200, 900, 400),
  card("common", 100, 300, 120),
  card("unplayed", 150, 500, 0),
  card("rare", 4, 6, 2),
  card("gated", 0, 0, 0, { unwrittenRefs: ["@world.market_day"] }),
  card("news", 200, 800, 0),
];
const outcomeOf = (c: string) => ({ id: `o_${c}`, gameId: "go", card: c, played: 0 });

const report = (over: Partial<CoverageReport> = {}): CoverageReport => ({
  runs: 200, seed: 0, maxTurns: 100, drivers: [], turns: 0, plays: 0,
  terminations: { exhausted: 0, maxTurns: 200, stuck: 0 },
  cards,
  totals: { cards: 6, dealt: 5, neverDealt: 1, rare: 1, dealtNeverPlayed: 1 }, rareThresholdPct: 5,
  // Every card has an outcome but the news.
  outcomes: ["always", "common", "unplayed", "rare", "gated"].map(outcomeOf),
  hands: [], unwrittenInputs: ["@world.market_day"], unprovidedHandRefs: [], diagnostics: [], issues: [],
  ...over,
});

const mount = (over: Partial<CardTableOptions> = {}, r = report()): HTMLElement => {
  const host = cardsBlock(r, { order: "least", onOrderChange: () => {}, onOpen: () => {}, onFindUsage: () => {}, ...over });
  document.body.append(host);
  return host;
};
const text = (node: Element | null | undefined): string => node?.textContent ?? "";
const rowIds = (host: Element): string[] =>
  [...host.querySelectorAll(".ctable tbody tr .ccard > span:first-child")].map((s) => text(s).replace("Title ", ""));
const rowOf = (host: Element, id: string): Element =>
  [...host.querySelectorAll(".ctable tbody tr")].find((tr) => text(tr.querySelector(".ccard > span")) === `Title ${id}`)!;

describe("the coverage summary", () => {
  it("leads with cards dealt out of all, as a share, then the three counts worth a look", () => {
    const sum = summaryBlock(report(), false);
    expect(text(sum.querySelector(".big"))).toBe("5/6");
    expect([...sum.querySelectorAll(".sublabel .shell-meta-part")].map(text)).toEqual(["83% of cards dealt", "200 runs", "seed 0"]);
    const stats = [...sum.querySelectorAll(".cstat")];
    expect(stats.map((s) => text(s.querySelector(".cstat-l")))).toEqual(["Never dealt", "Rarely dealt", "Dealt, never played"]);
    expect(stats.map((s) => text(s.querySelector(".cstat-n")))).toEqual(["1", "1", "1"]);
    expect(stats[1]!.getAttribute("data-tip")).toBe("Dealt, but in fewer than 5% of runs");
    expect(stats[2]!.getAttribute("data-tip")).toMatch(/Cards with no outcomes are not counted/);
    expect(sum.querySelector(".partial")).toBeNull();
  });

  it("colours a count only when it is not zero, and says when the sweep was stopped early", () => {
    const sum = summaryBlock(report({ totals: { cards: 6, dealt: 6, neverDealt: 0, rare: 0, dealtNeverPlayed: 0 } }), true);
    expect(sum.querySelectorAll(".cstat.bad, .cstat.warn")).toHaveLength(0);
    expect(text(sum.querySelector(".partial"))).toBe("stopped early");
  });
});

describe("the card table", () => {
  it("heads its columns, the numbers each explaining themselves", () => {
    const host = mount();
    const heads = [...host.querySelectorAll(".ctable thead th")];
    expect(heads.map(text)).toEqual(["Card", "Deck", "Runs dealt", "Times dealt", "Times played"]);
    expect(heads[2]!.getAttribute("data-tip")).toBe("The share of runs that dealt this card at least once");
    expect(heads[3]!.getAttribute("data-tip")).toMatch(/can be more than the number of runs/);
    expect(heads[4]!.getAttribute("data-tip")).toMatch(/an outcome of it was played across all runs/);
    expect(text(host.querySelector(".caption"))).toBe("How often each card came up, over 200 runs");
  });

  it("opens least reached first: never dealt, then by runs dealt, then by times dealt", () => {
    const host = mount();
    // news and always tie on runs (200); news was dealt fewer times, so it leads them.
    expect(rowIds(host)).toEqual(["gated", "rare", "common", "unplayed", "news", "always"]);
    expect(text(host.querySelector(".seg-opt.on"))).toBe("Least reached first");
  });

  it("switches to deck order, re-drawing in place, and says so", () => {
    const onOrderChange = vi.fn();
    const host = mount({ onOrderChange });
    const deck = [...host.querySelectorAll<HTMLButtonElement>(".seg-opt")].find((b) => text(b) === "Deck order")!;
    deck.click();
    expect(rowIds(host)).toEqual(["always", "common", "unplayed", "rare", "gated", "news"]);
    expect(text(host.querySelector(".seg-opt.on"))).toBe("Deck order");
    expect(onOrderChange).toHaveBeenCalledWith("deck");
    // Clicking the one already on changes nothing and says nothing.
    deck.click();
    expect(onOrderChange).toHaveBeenCalledTimes(1);
  });

  it("opens in the order it is given", () => {
    expect(rowIds(mount({ order: "deck" }))).toEqual(["always", "common", "unplayed", "rare", "gated", "news"]);
  });

  it("tags a rarely dealt card, softly, and shows its share without rounding up to the threshold", () => {
    const row = rowOf(mount(), "rare");
    expect(row.classList.contains("rare")).toBe(true);
    expect(text(row.querySelector(".rtag"))).toBe("Rare");
    expect(row.querySelector(".rtag")!.getAttribute("data-tip")).toMatch(/^Dealt in fewer than 5% of runs\./);
    expect(text(row.querySelector(".creach"))).toBe("2%");
    expect(rowOf(mount(), "common").querySelector(".rtag")).toBeNull();
  });

  it("a never-dealt row carries the honesty net's reason, and its gate opens Find, not the card", () => {
    const onOpen = vi.fn();
    const onFindUsage = vi.fn();
    const row = rowOf(mount({ onOpen, onFindUsage }), "gated");
    expect(row.classList.contains("never")).toBe(true);
    expect(text(row.querySelector(".cwhy"))).toBe("gated on @world.market_day, which nothing writes or drives");
    row.querySelector<HTMLButtonElement>(".reflink")!.click();
    expect(onFindUsage).toHaveBeenCalledWith("@world.market_day");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("names the other never-dealt cards a gate waits on (the second hop)", () => {
    const hop = card("hop", 0, 0, 0, { refsWrittenOnlyByNeverDealtCards: [{ ref: "@story.flag", by: ["gated"] }] });
    const host = mount({}, report({ cards: [...cards, hop] }));
    expect(text(rowOf(host, "hop").querySelector(".cwhy"))).toBe("@story.flag is only written by Title gated, which never came up either");
  });

  it("tints a card dealt and never played apart from the never dealt, and says why", () => {
    const row = rowOf(mount(), "unplayed");
    expect(row.classList.contains("unplayed")).toBe(true);
    expect(row.classList.contains("never")).toBe(false);
    expect(text(row.querySelector(".cwhy"))).toBe("Dealt, but no outcome of it was ever played");
  });

  it("a card with no outcomes shows its played column as not applicable, and is not called unplayed", () => {
    const row = rowOf(mount(), "news");
    const cells = [...row.querySelectorAll("td")];
    expect(text(cells[4])).toBe("no outcomes");
    expect(row.classList.contains("unplayed")).toBe(false);
    expect(text(cells[2])).toBe("100%");
  });

  it("each row opens its card", () => {
    const onOpen = vi.fn();
    (rowOf(mount({ onOpen }), "common") as HTMLElement).click();
    expect(onOpen).toHaveBeenCalledWith({ kind: "card", box: "b_1", deck: "k_1", card: "common" });
  });

  it("names the box under the deck only when there is more than one box", () => {
    expect(mount().querySelector(".cbox")).toBeNull();
    const two = mount({}, report({ cards: [...cards, card("codex", 200, 10, 10, { box: "b_2", boxName: "Codex", deck: "k_9", deckName: "Entries" })] }));
    expect(text(rowOf(two, "codex").querySelector(".cbox"))).toBe("Codex");
  });
});
