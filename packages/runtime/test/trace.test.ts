// ---------------------------------------------------------------------------
// The deal/play trace (schema 5): per-card ask verdicts with ranking keys,
// evictions, plays, routed writes, and eval-error diagnostics. The verb is
// the event type (a peek is distinguishable from a deal when reading a
// session back). The trace is tooling surface, not corpus surface (it is the
// superset the assertable transcript would be drawn from), so it is pinned
// here rather than in the conformance corpus.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { Engine } from "../src/index.js";
import type { TraceEvent } from "../src/index.js";
import { expandBundle } from "@storylet-studio/conformance";

const bundle = expandBundle({
  story: [
    { name: "open", type: "boolean", default: true },
    { name: "gold", type: "number", default: 0 },
  ],
  cards: [
    { id: "c_hero", priority: 5, condition: "@story.open and @story.gold >= 0",
      tags: { zone: ["docks"] },
      outcomes: [{ id: "o_go", changes: {
        "@story.gold": "@story.gold + 1",
        "@hand.danger": "@hand.danger + 1",
      } }] },
    { id: "c_market", priority: 3, tags: { zone: ["market"] } },
    { id: "c_shut", priority: 2, condition: "@story.open == false" },
    { id: "c_broken", priority: 1, condition: "@hand.nope > 0" },   // not composed: eval error
    { id: "c_low", priority: 0 },
  ],
  hands: [{ id: "h_seat", rule: { bindings: { zone: "docks" } }, slots: 1 }],
});

describe("the deal/play trace", () => {
  it("a peek explains every card: verdicts, ranking keys, capping, diagnostics", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    const events: TraceEvent[] = [];
    session.subscribeTrace((e) => events.push(e));

    session.peek("box", { zone: "docks" }, 1);
    const peek = events.find((e): e is Extract<TraceEvent, { type: "peek" }> => e.type === "peek")!;
    expect(peek.box).toBe("box");
    expect(peek.criteria).toEqual({ zone: "docks" });
    const byId = Object.fromEntries(peek.cards.map((c) => [c.id, c]));
    expect(byId["c_hero"]).toMatchObject({ verdict: "dealt", priority: 5, specificity: 2 });
    expect(byId["c_market"]).toMatchObject({ verdict: "tags" });
    expect(byId["c_shut"]).toMatchObject({ verdict: "condition" });
    expect(byId["c_broken"]).toMatchObject({ verdict: "condition" });   // an eval error is a failed condition...
    expect(byId["c_low"]).toMatchObject({ verdict: "capped" });         // eligible, below the peek cap of 1
    // ...and never a silent one: the diagnostic names the error.
    const diagnostic = events.find((e): e is Extract<TraceEvent, { type: "diagnostic" }> => e.type === "diagnostic")!;
    expect(diagnostic.where).toBe("card broken condition");
    expect(diagnostic.message).toContain("nope");
  });

  it("a play emits the play and its routed writes", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    const events: TraceEvent[] = [];
    session.subscribeTrace((e) => events.push(e));

    session.deal("seat");
    session.play("c_hero", "go", "seat");
    expect(events.find((e) => e.type === "play")).toMatchObject({ card: "c_hero", outcome: "go", turn: 1 });
    const writes = events.filter((e): e is Extract<TraceEvent, { type: "write" }> => e.type === "write");
    expect(writes).toMatchObject([
      { target: "@hand.danger", path: "value.v_docks.danger", value: 1 },   // routed to the zone (schema 3.6)
      { target: "@story.gold", path: "story.gold", value: 1 },
    ]);
  });

  it("dealing traces per-hand deals and evictions", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    const events: TraceEvent[] = [];
    session.subscribeTrace((e) => events.push(e));

    session.dealMany();
    const deal = events.find((e): e is Extract<TraceEvent, { type: "deal" }> => e.type === "deal")!;
    expect(deal.hand).toBe("seat");
    expect(deal.cards.find((c) => c.id === "c_hero")).toMatchObject({ verdict: "dealt" });

    // Flip the world so the seated card's condition lapses; the next deal
    // evicts it with the reason on the trace.
    events.length = 0;
    session.setProperty("story.open", false);
    session.dealMany();
    expect(events.find((e) => e.type === "evict")).toMatchObject({
      hand: "h_seat", card: "c_hero", reason: "condition",
    });
  });

  it("unsubscribing stops the stream", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    const events: TraceEvent[] = [];
    const unsubscribe = session.subscribeTrace((e) => events.push(e));
    unsubscribe();
    session.peek("box");
    expect(events).toEqual([]);
  });
});

// The retained session log: the introspection seam a game engine keeps open
// (the old runtime's enableLog, round-2 shape). Entries are the trace events
// sequence-stamped and turn-stamped; the log is session-lifetime only and
// never rides a save (playLog stays the durable history).
describe("the session log", () => {
  it("is off by default: no retention, no trace work", () => {
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    session.deal("seat");
    session.play("c_hero", "go", "seat");
    expect(session.log()).toEqual([]);
  });

  it("retains deals, writes (with prev), plays and turn advances, seq-ordered and turn-stamped", () => {
    const session = new Engine(bundle, { seed: 0, log: true }).openFlow("main");
    session.deal("seat");
    session.play("c_hero", "go", "seat");
    session.advanceTurns("box", 2);

    // The deal's ask trips c_broken's eval error first: the log keeps the
    // diagnostic too (never a silent pass).
    const log = session.log();
    expect(log.map((e) => e.type)).toEqual(["diagnostic", "deal", "write", "write", "play", "turns"]);
    expect(log.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(log[1]).toMatchObject({ type: "deal", hand: "seat", turn: 0 });
    // A play and its writes share one turn stamp: one action, one moment.
    expect(log.find((e) => e.type === "write" && e.target === "@story.gold"))
      .toMatchObject({ path: "story.gold", prev: 0, value: 1, turn: 1 });
    expect(log[4]).toMatchObject({ type: "play", card: "c_hero", turn: 1 });
    expect(log[5]).toMatchObject({ type: "turns", box: "box", turn: 3 });
  });

  it("fires each event after the state it reports has landed (a handler sees the effect)", () => {
    // The Live Link's board snapshot reads the session from inside the trace
    // handler, so this ordering is part of what the shared fixture pins.
    const session = new Engine(bundle, { seed: 0 }).openFlow("main");
    const seen: { type: string; seat: string[]; turn: number }[] = [];
    session.subscribeTrace((e) => seen.push({ type: e.type, seat: session.board()["seat"]!.map((c) => c.id), turn: session.turn("box") }));

    session.deal("seat");
    expect(seen.at(-1)).toEqual({ type: "deal", seat: ["c_hero"], turn: 0 });
    session.play("c_hero", "go", "seat");
    expect(seen.at(-1)).toEqual({ type: "play", seat: [], turn: 1 });
    session.advanceTurns("box", 2);
    expect(seen.at(-1)).toEqual({ type: "turns", seat: [], turn: 3 });
    // An eviction: c_hero is back on the table (redraw always), its condition
    // now fails, and the evict event sees it gone.
    session.deal("seat");
    expect(seen.at(-1)).toEqual({ type: "deal", seat: ["c_hero"], turn: 3 });
    session.setProperty("story.open", false);
    session.deal("seat");
    expect(seen.filter((s) => s.type === "evict")).toEqual([{ type: "evict", seat: [], turn: 3 }]);
  });

  it("caps retention, dropping the oldest first", () => {
    const session = new Engine(bundle, { seed: 0, log: { cap: 2 } }).openFlow("main");
    session.deal("seat");
    session.play("c_hero", "go", "seat");
    session.advanceTurns("box", 2);
    expect(session.log().map((e) => [e.type, e.seq])).toEqual([["play", 4], ["turns", 5]]);
  });

  it("clearLog empties the log; seq keeps counting across the clear", () => {
    const session = new Engine(bundle, { seed: 0, log: true }).openFlow("main");
    session.deal("seat");
    session.clearLog();
    expect(session.log()).toEqual([]);
    session.advanceTurns("box", 1);
    expect(session.log()).toMatchObject([{ type: "turns", seq: 2 }]);
  });
});
