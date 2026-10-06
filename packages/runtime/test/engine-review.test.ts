// ---------------------------------------------------------------------------
// The engine review of 2026-10-06 (design/engine-review-2026-10.md in the
// workshop): the host-API half, which the corpus cannot reach. The behaviour
// rulings (A to G) are corpus cases; these are the trace handler rule (F), the
// prototype hole in @hand and @deck, the typed error, a play that puts back
// what it wrote when a later write is refused as it lands, and hotSwap's
// project message.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { ScopeRegistry } from "@wildwinter/scoperegistry";
import { expandBundle } from "@storylet-studio/conformance";
import { Engine, StoryletError } from "../src/index.js";
import type { TraceEvent } from "../src/index.js";

const bundle = expandBundle({
  story: [{ name: "gold", type: "number", default: 0 }],
  cards: [{ id: "c_a", redraw: "always", outcomes: [{ id: "o_go", changes: { "@story.gold": "@story.gold + 1" } }] }],
  hands: [{ id: "h_q", rule: {} }],
});

describe("trace handlers (ruling F)", () => {
  it("a handler subscribed twice hears each event once, and one unsubscribe removes it", () => {
    const flow = new Engine(bundle).openFlow("main");
    const heard: string[] = [];
    const handler = (e: TraceEvent): void => { heard.push(e.type); };
    flow.subscribeTrace(handler);
    const off = flow.subscribeTrace(handler);
    flow.advanceTurns("box");
    expect(heard).toEqual(["turns"]);
    off();
    flow.advanceTurns("box");
    expect(heard).toEqual(["turns"]);
  });

  it("a subscribe or unsubscribe during an event takes effect from the next one", () => {
    const flow = new Engine(bundle).openFlow("main");
    const heard: string[] = [];
    const late = (): void => { heard.push("late"); };
    let offSecond: () => void = () => {};
    flow.subscribeTrace(() => {
      heard.push("first");
      flow.subscribeTrace(late);   // added mid-delivery: not called for this event
      offSecond();                 // removed mid-delivery: still called for this one
    });
    offSecond = flow.subscribeTrace(() => { heard.push("second"); });
    flow.advanceTurns("box");
    expect(heard).toEqual(["first", "second"]);
    heard.length = 0;
    flow.advanceTurns("box");
    expect(heard).toEqual(["first", "late"]);
  });

  it("the engine's tap keeps the same rule", () => {
    const engine = new Engine(bundle);
    const flow = engine.openFlow("main");
    const heard: string[] = [];
    const late = (): void => { heard.push("late"); };
    const handler = (): void => { heard.push("tap"); engine.subscribeTrace(late); };
    engine.subscribeTrace(handler);
    engine.subscribeTrace(handler);
    flow.advanceTurns("box");
    expect(heard).toEqual(["tap"]);
    heard.length = 0;
    flow.advanceTurns("box");
    expect(heard).toEqual(["tap", "late"]);
  });
});

describe("@hand and @deck read no built-in object property", () => {
  // The expression parser refuses `constructor` as a property name, but a
  // bundle carries COMPILED expressions and a runtime evaluates the AST it is
  // given, so the name is reachable there. Compiled under a stand-in name and
  // renamed in the AST, which is how a hand-built or foreign bundle would
  // carry it.
  const probe = JSON.parse(JSON.stringify(expandBundle({
    decks: [{ id: "k_main", condition: "@hand.zzctor", cards: [{ id: "c_gated" }] },
      { id: "k_open", cards: [
        { id: "c_hand", condition: "@hand.zzctor" },
        { id: "c_deck", condition: "@deck.zzctor" },
        { id: "c_story", condition: "@story.zzctor" },
        { id: "c_proto", condition: "@hand.zzproto" },
        { id: "c_plain" },
      ] }],
    hands: [{ id: "h_q", rule: {} }],
  }))
    .replaceAll("zzctor", "constructor").replaceAll("zzproto", "__proto__")) as typeof bundle;

  it("@hand.constructor and the like are missing, not Object's functions", () => {
    const flow = new Engine(probe).openFlow("main");
    const verdicts: Record<string, string> = {};
    flow.subscribeTrace((e) => {
      if (e.type === "deal") for (const c of e.cards) verdicts[c.id] = c.verdict;
    });
    expect(flow.deal("q").map((c) => c.id)).toEqual(["c_plain"]);
    expect(verdicts).toMatchObject({
      gated: "deck-gate", hand: "condition", deck: "condition", story: "condition", proto: "condition",
    });
  });

  it("a hole filled from @hand.constructor names nothing", () => {
    const holed = expandBundle({
      templates: [{ id: "t_npc", chooses: ["zone"], properties: [{ name: "zone", type: "string", default: "docks" }] }],
      // A hole reference is not parsed as an expression, so this one is direct.
      hands: [{ id: "h_npc", template: "t_npc", chosen: { zone: "@hand.constructor" } }],
      cards: [{ id: "c_any" }],
    });
    const flow = new Engine(holed).openFlow("main");
    const said: string[] = [];
    flow.subscribeTrace((e) => { if (e.type === "diagnostic") said.push(e.message); });
    flow.deal("npc");
    expect(said.some((m) => m.includes("names a property that is not declared"))).toBe(true);
  });
});

describe("StoryletError", () => {
  it("is what the engine's own refusals throw, with the message they always had", () => {
    const flow = new Engine(bundle).openFlow("main");
    let caught: unknown;
    try {
      flow.turn("nowhere");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StoryletError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("StoryletError");
    expect((caught as Error).message).toBe('unknown box "nowhere"');
    expect(() => new Engine({ ...bundle, schema: "nope" } as never)).toThrow(StoryletError);
  });
});

describe("a play is all-or-nothing (ruling B), past the checks", () => {
  it("a write refused as it lands puts back what the earlier writes replaced", () => {
    // Another engine's read-only property: the registry refuses it only when
    // the write lands, after the play's @box write has.
    const registry = new ScopeRegistry().defineOwned("patter",
      [{ name: "seen", type: "number", default: 0, writable: false }], { owner: "Patter" });
    const withPatter = expandBundle({
      boxProperties: [{ name: "heat", type: "number", default: 0 }],
      cards: [{ id: "c_a", outcomes: [{ id: "o_go", changes: { "@box.heat": "@box.heat + 1", "@patter.seen": "1" } }] }],
      hands: [{ id: "h_q", rule: {} }],
    });
    const flow = new Engine(withPatter, { registry }).openFlow("main");
    const writes: TraceEvent[] = [];
    flow.subscribeTrace((e) => { if (e.type === "write" || e.type === "play") writes.push(e); });
    flow.deal("q");
    expect(() => flow.play("c_a", "go", "q")).toThrow(/read-only/);
    expect(flow.getProperty("box.box.heat")).toBe(0);
    expect(flow.turn("box")).toBe(0);
    expect(flow.board()["q"]!.map((c) => c.id)).toEqual(["c_a"]);
    expect(writes).toEqual([]);
  });
});

describe("hotSwap", () => {
  it("names the bundle when it is for another project", () => {
    const engine = new Engine(bundle);
    const other = { ...bundle, content: { ...bundle.content, project: "elsewhere" } };
    expect(() => engine.hotSwap(other)).toThrow('hotSwap: the bundle is for project "elsewhere", this engine runs "conf"');
  });
});
