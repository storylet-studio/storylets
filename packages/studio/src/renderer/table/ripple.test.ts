// The ripple (design/board-ripple.md): consequences derived FROM THE LOG at
// render time, so history reads retroactively. Expectations hand-written from
// the design doc's attribution rules, not from the implementation:
//   - a play's writes are the contiguous write entries immediately before it
//   - candidates are deal/evict entries after it, up to the next boundary
//   - reads-attribution: the card's condition (or its deck's gate) reads a
//     written path; slot-attribution: dealt into the hand the play vacated
//   - everything else in the refresh is coincidence, not consequence
import { describe, expect, it } from "vitest";
import { astRefs, attributeRipple, diffBoards, journalPlan } from "./model.js";
import type { BoardLogEntry, LogEntry } from "./model.js";

describe("astRefs (the read-set of a compiled condition)", () => {
  it("collects scoped variables from the compact AST, nested and all", () => {
    const ast = ["bin", "&&",
      ["call", "check_flags", [["sv", "story", "wire"], ["flag", "+", "blackout"]]],
      ["bin", ">=", ["sv", "story", "heat"], ["s", "watched"]]];
    expect([...astRefs(ast)].sort()).toEqual(["story.heat", "story.wire"]);
  });

  it("answers empty for a missing condition", () => {
    expect([...astRefs(undefined)]).toEqual([]);
    expect([...astRefs(null)]).toEqual([]);
  });
});

// A little log builder: seq is positional, turn constant - neither matters to
// the rules under test beyond ordering.
// Omit over a union must distribute, or the builder only accepts the keys the
// union members share.
type Sans<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
const L = (entries: Sans<LogEntry, "seq">[]): LogEntry[] =>
  entries.map((e, i) => ({ ...e, seq: i } as LogEntry));

const READS: Record<string, string[]> = {
  c_robbery: ["story.wire"],
  c_patrols: ["story.heat"],
  c_intercept: ["story.jobs"],
  c_filler: [],
};
const readsOf = (card: string): Set<string> => new Set(READS[card] ?? []);

describe("attributeRipple", () => {
  it("attributes dealt and evicted cards whose reads intersect the play's writes", () => {
    const log = L([
      { type: "write", target: "@story.wire", path: "story.wire", value: ["container_robbery"] },
      { type: "write", target: "@story.heat", path: "story.heat", value: "watched" },
      { type: "play", card: "c_handoff", outcome: "it-went-loud", turn: 4 },
      { type: "deal", hand: "strip-screen", cards: [{ id: "c_robbery", verdict: "dealt" }] },
      { type: "deal", hand: "dock-screen", cards: [{ id: "c_patrols", verdict: "dealt" }] },
      { type: "evict", hand: "grid-screen", card: "c_intercept", reason: "condition" },
    ]);
    const items = attributeRipple(log, 2, readsOf, "palace-fixer");
    expect(items).toEqual([
      { kind: "dealt", card: "c_robbery", hand: "strip-screen", why: "reads", seq: 3 },
      { kind: "dealt", card: "c_patrols", hand: "dock-screen", why: "reads", seq: 4 },
      // c_intercept reads story.jobs, which this play did not write
    ]);
  });

  it("attributes a card dealt into the vacated hand to the freed slot", () => {
    const log = L([
      { type: "play", card: "c_hustle", outcome: "moved-on", turn: 5 },
      { type: "deal", hand: "strip-crowds", cards: [{ id: "c_intercept", verdict: "dealt" }] },
    ]);
    // the play wrote nothing, and the interception reads jobs (unwritten here):
    // the freed slot is the only honest attribution
    expect(attributeRipple(log, 0, readsOf, "strip-crowds")).toEqual([
      { kind: "dealt", card: "c_intercept", hand: "strip-crowds", why: "slot", seq: 1 },
    ]);
  });

  it("stops at a meddle: what follows the author's poke is the poke's doing", () => {
    const log: BoardLogEntry[] = [
      { seq: 0, type: "play", card: "c_a", outcome: "o", turn: 1 },
      { seq: 0.5, type: "meddle", label: "wire", value: ["container_robbery"] },
      { seq: 1, type: "deal", hand: "strip-screen", cards: [{ id: "c_robbery", verdict: "dealt" }] },
    ];
    expect(attributeRipple(log, 0, readsOf, "h1")).toEqual([]);
  });

  it("stops at the next boundary and ignores coincidences", () => {
    const log = L([
      { type: "write", target: "@story.wire", path: "story.wire", value: [] },
      { type: "play", card: "c_a", outcome: "o", turn: 1 },
      { type: "deal", hand: "h2", cards: [{ id: "c_filler", verdict: "dealt" }] },   // reads nothing: coincidence
      { type: "turns", box: "news", turn: 2 },                                        // boundary
      { type: "deal", hand: "h3", cards: [{ id: "c_robbery", verdict: "dealt" }] },   // beyond it
    ]);
    expect(attributeRipple(log, 1, readsOf, "h1")).toEqual([]);
  });

  it("evictions attribute only through reads, never through the slot", () => {
    const log = L([
      { type: "play", card: "c_a", outcome: "o", turn: 1 },
      { type: "evict", hand: "h1", card: "c_filler", reason: "claimed" },
    ]);
    expect(attributeRipple(log, 0, readsOf, "h1")).toEqual([]);
  });
});

describe("journalPlan (the telling, regrouped from the record)", () => {
  // The plan's rippleFor is the real attribution, wired the way the Board
  // wires it (reads-only here: no playedFrom).
  const planOf = (log: BoardLogEntry[], boxCount: number, playedFrom?: string) =>
    journalPlan(log, (i) => attributeRipple(log, i, readsOf, playedFrom), boxCount);

  it("folds a play's writes under it and never tells an attributed deal twice", () => {
    const log = L([
      { type: "write", target: "@story.wire", path: "story.wire", value: ["container_robbery"] },
      { type: "write", target: "@story.heat", path: "story.heat", value: "watched" },
      { type: "play", card: "c_handoff", outcome: "it-went-loud", turn: 4 },
      { type: "deal", hand: "strip-screen", cards: [{ id: "c_robbery", verdict: "dealt" }] },   // attributed: reads wire
      { type: "deal", hand: "h9", cards: [{ id: "c_filler", verdict: "dealt" }] },              // coincidence: stays flat
      { type: "evict", hand: "grid-screen", card: "c_intercept", reason: "condition" },          // unattributed: stays flat
    ]);
    const items = planOf(log, 1);
    expect(items.map((i) => i.kind)).toEqual(["play", "entry", "entry"]);
    const play = items[0]!;
    if (play.kind !== "play") throw new Error("expected a play item");
    expect(play.writes.map((w) => w.path)).toEqual(["story.wire", "story.heat"]);
    expect(play.ripple.map((r) => r.card)).toEqual(["c_robbery"]);
    expect((items[1] as { entry: LogEntry }).entry.type).toBe("deal");
    expect((items[2] as { entry: LogEntry }).entry.type).toBe("evict");
  });

  it("keeps only the coincidences of a mixed deal, and drops one fully told", () => {
    const log = L([
      { type: "write", target: "@story.wire", path: "story.wire", value: [] },
      { type: "write", target: "@story.heat", path: "story.heat", value: "watched" },
      { type: "play", card: "c_a", outcome: "o", turn: 1 },
      { type: "deal", hand: "h2", cards: [
        { id: "c_robbery", verdict: "dealt" },   // attributed (reads wire)
        { id: "c_filler", verdict: "dealt" },    // coincidence
      ] },
      { type: "deal", hand: "h3", cards: [{ id: "c_patrols", verdict: "dealt" }] },   // attributed (reads heat): fully told
    ]);
    const items = planOf(log, 1);
    expect(items.map((i) => i.kind)).toEqual(["play", "entry"]);
    const deal = (items[1] as { entry: Extract<LogEntry, { type: "deal" }> }).entry;
    expect(deal.cards.map((c) => c.id)).toEqual(["c_filler"]);
  });

  it("collapses a full every-box advance to one beat, uniform when the clocks agree", () => {
    const together = L([
      { type: "turns", box: "news", turn: 3 },
      { type: "turns", box: "codex", turn: 3 },
      { type: "turns", box: "contracts", turn: 3 },
    ]);
    expect(planOf(together, 3)).toEqual([
      { kind: "turns", entries: together, uniform: 3 },
    ]);
    const drifted = L([
      { type: "turns", box: "news", turn: 3 },
      { type: "turns", box: "contracts", turn: 5 },
    ]);
    expect(planOf(drifted, 2)).toEqual([
      { kind: "turns", entries: drifted },
    ]);
  });

  it("keeps a partial run - and a single-box project's ticks - as their own rows", () => {
    const lone = L([{ type: "turns", box: "news", turn: 4 }]);
    expect(planOf(lone, 5)).toEqual([{ kind: "entry", entry: lone[0] }]);
    const single = L([{ type: "turns", box: "hamlet", turn: 2 }]);
    expect(planOf(single, 1)).toEqual([{ kind: "entry", entry: single[0] }]);
  });

  it("leaves a write with no play after it as its own row", () => {
    const log = L([
      { type: "write", target: "@story.heat", path: "story.heat", value: "watched" },
      { type: "turns", box: "news", turn: 1 },
    ]);
    expect(planOf(log, 5).map((i) => i.kind)).toEqual(["entry", "entry"]);
  });

  it("passes a meddle through as its own entry", () => {
    const log: BoardLogEntry[] = [
      { seq: 0, type: "play", card: "c_a", outcome: "o", turn: 1 },
      { seq: 0.5, type: "meddle", label: "heat", prev: "unnoticed", value: "hunted" },
    ];
    const items = journalPlan(log, (i) => attributeRipple(log, i, readsOf), 2);
    expect(items.map((i) => i.kind)).toEqual(["play", "entry"]);
    expect((items[1] as { entry: BoardLogEntry }).entry.type).toBe("meddle");
  });
});

describe("diffBoards (what pulses)", () => {
  it("names each hand whose contents changed, either way", () => {
    const before = [
      { hand: "a", cards: [{ id: "c1", gameId: "c1" }] },
      { hand: "b", cards: [{ id: "c2", gameId: "c2" }] },
      { hand: "c", cards: [] },
    ];
    const after = [
      { hand: "a", cards: [{ id: "c1", gameId: "c1" }] },       // unchanged
      { hand: "b", cards: [] },                                  // lost one
      { hand: "c", cards: [{ id: "c3", gameId: "c3" }] },        // gained one
    ];
    expect([...diffBoards(before, after)].sort()).toEqual(["b", "c"]);
  });
});
