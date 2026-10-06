// ---------------------------------------------------------------------------
// Coverage harness tests: seeded determinism, the external-driver behaviour
// contract (mirroring the old system's drivers.test.ts), template instances
// covering their axis (round 2: coverage is keyed to hands and plays),
// gated-outcome awareness, exhaustion, and the auto-proposal. Expectations
// hand-written from the design.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { SourceProject } from "@storylet-studio/compiler";
import type {
  CoverageConfig, Card, Hand, HandTemplate, PropertyDecl, TagGroup,
} from "@storylet-studio/model";
import { proposeCoverage, runCoverage, runCoverageAsync } from "../src/coverage.js";
import { RARE_DEALT_PCT, leastReachedFirst, rarelyDealt, sharePct } from "../src/coverage-order.js";

interface Fix {
  world?: PropertyDecl[];
  story?: PropertyDecl[];
  coverage?: CoverageConfig;
  tagGroups?: TagGroup[];
  templates?: HandTemplate<string>[];
  /** Default: one plain unbounded hand `h_all` so every card is dealable. */
  hands?: Hand<string>[];
  /** A gate on the one deck, when the test needs one. */
  deckCondition?: string;
  /** Makes the one box TIMED (design/engine-server.md 4.8). */
  turn?: { seconds: number };
  cards: Partial<Card<string>>[];
}

const project = (f: Fix): SourceProject => ({
  path: "p.storyletproj",
  project: {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    // A venue project: the play ladder (4.10) hides nothing there, so a timed
    // box in the fixture is not also a warning about the project's rung.
    settings: { playAdvancesTurns: 1, play: "venue" },
    ...(f.coverage !== undefined ? { coverage: f.coverage } : {}),
    world: { properties: f.world ?? [] },
    story: { properties: f.story ?? [] },
    templates: {},
    export: { bundle: "dist/p.storyletsc", metadata: "full" },
  },
  contracts: [],
  boxes: [{
    path: "b",
    box: {
      schema: "storylets/box@0",
      box: {
        id: "b_1", gameId: "b1", ranking: { specificity: true },
        ...(f.turn !== undefined ? { turn: f.turn } : {}),
        fields: [], properties: [],
      },
    },
    tags: { schema: "storylets/tags@0", groups: f.tagGroups ?? [] },
    hands: {
      schema: "storylets/hands@0",
      templates: f.templates ?? [],
      hands: f.hands ?? [{ id: "h_all", gameId: "all", rule: { bindings: {}, slots: "unbounded" } }],
    },
    decks: [{
      path: "b/decks/main.storyletdeck",
      shard: {
        schema: "storylets/deck@0",
        deck: { id: "k_1", gameId: "main", properties: [], ...(f.deckCondition !== undefined ? { condition: f.deckCondition } : {}) },
        cards: f.cards.map((c) => ({
          id: "c_x", gameId: (c.id ?? "c_x").replace(/^c_/, ""), priority: 0,
          redraw: "always" as const, outcomes: [{ id: `o_${c.id ?? "c_x"}`, gameId: "done", changes: {} }],
          ...c,
        })),
      },
    }],
  }],
});

const OPTS = { runs: 25, maxTurns: 30, seed: 0 };

const cardRow = (report: ReturnType<typeof runCoverage>, id: string) =>
  report.cards.find((c) => c.id === id)!;

describe("coverage harness", () => {
  it("is bit-for-bit reproducible from its seed", () => {
    const source = project({
      story: [{ name: "n", type: "number", default: 0 }],
      cards: [
        { id: "c_a", outcomes: [{ id: "o_a", gameId: "bump", changes: { "@story.n": "@story.n + 1" } }] },
        { id: "c_b", condition: "@story.n >= 2" },
      ],
    });
    const one = runCoverage(source, OPTS);
    const two = runCoverage(source, OPTS);
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    expect(one.issues).toEqual([]);
    expect(one.plays).toBeGreaterThan(0);
  });

  it("a timed box: the report carries the unit, and the sweep still ticks it", () => {
    // The harness is the host here, so it ticks a timed box itself: without
    // that a cooldown in one could never expire inside a run, and the report
    // would call a perfectly reachable card never dealt.
    const source = project({
      turn: { seconds: 60 },
      cards: [{ id: "c_a", redraw: 3 }, { id: "c_b" }],
    });
    const report = runCoverage(source, OPTS);
    expect(report.turnSeconds).toBe(60);
    expect(cardRow(report, "c_a").played).toBeGreaterThan(1);   // it comes back
    expect(report.issues).toEqual([]);
  });

  it("no unit on the report when the project has an untimed box", () => {
    expect(runCoverage(project({ cards: [{ id: "c_a" }] }), OPTS).turnSeconds).toBeUndefined();
  });

  it("story-owned state is covered by play, no driver needed", () => {
    const source = project({
      story: [{ name: "brave", type: "boolean", default: false }],
      cards: [
        { id: "c_a", outcomes: [{ id: "o_a", gameId: "embolden", changes: { "@story.brave": "true" } }] },
        { id: "c_b", condition: "@story.brave" },
      ],
    });
    const report = runCoverage(source, OPTS);
    expect(cardRow(report, "c_b").dealt).toBeGreaterThan(0);
    expect(report.unwrittenInputs).toEqual([]);
  });

  it("host-gated content is unreached without a driver, and flagged honestly", () => {
    const source = project({
      world: [{ name: "raining", type: "boolean", default: false }],
      cards: [{ id: "c_wet", condition: "@world.raining" }, { id: "c_dry" }],
    });
    const report = runCoverage(source, OPTS);
    expect(cardRow(report, "c_wet").dealt).toBe(0);
    expect(cardRow(report, "c_wet").unwrittenRefs).toEqual(["@world.raining"]);
    expect(cardRow(report, "c_dry").dealt).toBeGreaterThan(0);
    expect(report.unwrittenInputs).toEqual(["@world.raining"]);
  });

  it("gives every run the same fresh world: more runs really is more sampling", () => {
    // The bug (2026-08-30): the exhaustion test read the SWEEP-WIDE tallies,
    // so once the cumulative sweep had dealt every card and played every
    // one-shot, every later run broke after its first play. The report still
    // said `runs: 5000`; the sampling stopped at about run 83. The author
    // found it as "the same two outcomes are never played however many runs I
    // ask for", which is exactly what it looks like from outside.
    //
    // The property that must hold: a run's ending depends on that RUN.
    const source = project({
      cards: [
        { id: "c_a", redraw: "never" },
        { id: "c_b", redraw: "never" },
      ],
    });
    const ten = runCoverage(source, { ...OPTS, runs: 10 });
    const twenty = runCoverage(source, { ...OPTS, runs: 20 });

    // Each run plays both one-shots and then has nothing left: two plays.
    expect(ten.plays).toBe(20);
    expect(twenty.plays).toBe(40);
    // ...and every run ends the same way, because every run met the same world.
    expect(ten.terminations.exhausted).toBe(10);
    expect(twenty.terminations.exhausted).toBe(20);
    // The tallies scale with the runs. Before the fix these two were EQUAL,
    // which is the shape of the whole bug in one line.
    expect(twenty.cards.find((c) => c.id === "c_a")!.played)
      .toBe(2 * ten.cards.find((c) => c.id === "c_a")!.played);
  });

  it("says when a gate is written ONLY by cards that never came up", () => {
    // The honesty net's blind spot, exactly one step wide, found by the author
    // playing the Village (2026-08-30): "Sell the Legend" never came up in a
    // 200-run sweep and the report said nothing, because its gate reads a flag
    // that something DOES write - just nothing that ever happens. The only
    // writer was itself never dealt, for a reason of its own. Two silent
    // cards, one cause, and no arrow between them.
    const source = project({
      story: [{ name: "quest", type: "flags", default: [], values: ["opened", "closed"] }],
      cards: [
        // Never dealt: nothing writes @world.storm, so the FIRST net owns it.
        { id: "c_root", condition: "@world.storm",
          outcomes: [{ id: "o_open", changes: { "@story.quest": "set_flags(@story.quest, +opened)" } }] },
        // Never dealt for a different reason: its flag is written only by the
        // card above, which never came up. That is the second hop.
        { id: "c_leaf", condition: "check_flags(@story.quest, +opened)" },
        { id: "c_ok" },
      ],
      world: [{ name: "storm", type: "boolean", default: false }],
    });
    const report = runCoverage(source, OPTS);
    expect(cardRow(report, "c_ok").dealt).toBeGreaterThan(0);

    // The first net still owns the dangling read, and does not double-report.
    expect(cardRow(report, "c_root").unwrittenRefs).toEqual(["@world.storm"]);
    expect(cardRow(report, "c_root").refsWrittenOnlyByNeverDealtCards).toBeUndefined();

    // The second hop names the flag AND who was supposed to write it. Flag
    // granularity is the whole point: `@story.quest` as a property would be
    // "written" and the hop would say nothing.
    expect(cardRow(report, "c_leaf").dealt).toBe(0);
    expect(cardRow(report, "c_leaf").unwrittenRefs).toBeUndefined();
    expect(cardRow(report, "c_leaf").refsWrittenOnlyByNeverDealtCards)
      .toEqual([{ ref: "@story.quest:opened", by: ["c_root"] }]);
  });

  it("stays quiet when the writer DOES come up", () => {
    // The other half of the same rule, so the hop cannot be a rubber stamp:
    // once the writer is reachable, its reader has no excuse and gets none.
    const source = project({
      story: [{ name: "quest", type: "flags", default: [], values: ["opened"] }],
      cards: [
        { id: "c_root", outcomes: [{ id: "o_open", changes: { "@story.quest": "set_flags(@story.quest, +opened)" } }] },
        { id: "c_leaf", condition: "check_flags(@story.quest, +opened)" },
      ],
    });
    const report = runCoverage(source, OPTS);
    expect(cardRow(report, "c_root").dealt).toBeGreaterThan(0);
    expect(cardRow(report, "c_leaf").refsWrittenOnlyByNeverDealtCards).toBeUndefined();
  });

  it("echoes the run parameters and the refs it drove, so the report stands alone", () => {
    const source = project({
      world: [{ name: "raining", type: "boolean", default: false }],
      coverage: { drivers: { "@world.raining": { kind: "recurring", cadence: "often", values: [true, false] } } },
      cards: [{ id: "c_wet", condition: "@world.raining" }],
    });
    const report = runCoverage(source, { ...OPTS, maxTurns: 7 });
    expect(report.maxTurns).toBe(7);
    expect(report.drivers).toEqual(["@world.raining"]);
    // Undriven: the note is the absence, which is what the reader needs to see.
    expect(runCoverage(project({ cards: [{ id: "c" }] }), OPTS).drivers).toEqual([]);
  });

  it("a recurring driver unlocks the gate and clears the flag", () => {
    const source = project({
      world: [{ name: "raining", type: "boolean", default: false }],
      coverage: { drivers: { "@world.raining": { kind: "recurring", cadence: "often", values: [true, false] } } },
      cards: [{ id: "c_wet", condition: "@world.raining" }],
    });
    const report = runCoverage(source, OPTS);
    expect(cardRow(report, "c_wet").dealt).toBeGreaterThan(0);
    expect(cardRow(report, "c_wet").unwrittenRefs).toBeUndefined();
    expect(report.unwrittenInputs).toEqual([]);
  });

  it("a driver on a read-only @world property still drives it", () => {
    // `writable: false` is the STORY's promise not to write (Reboot.md 10):
    // the harness IS the host, so a declared driver on such a ref must land.
    // It used to throw out of the sweep, which took the whole coverage run
    // with it - the CLI's `coverage` on any project that drives a clock.
    const source = project({
      world: [{ name: "time_phase", type: "enum", default: "day", values: ["day", "night"], writable: false }],
      coverage: { drivers: { "@world.time_phase": { kind: "recurring", cadence: "often", values: ["day", "night"] } } },
      cards: [{ id: "c_dark", condition: '@world.time_phase == "night"' }],
    });
    const report = runCoverage(source, OPTS);
    expect(report.drivers).toEqual(["@world.time_phase"]);
    expect(cardRow(report, "c_dark").dealt).toBeGreaterThan(0);
    expect(report.issues).toEqual([]);
    expect(report.unwrittenInputs).toEqual([]);
  });

  it("an initial driver varies the world per playthrough", () => {
    const source = project({
      world: [{ name: "class", type: "enum", default: "mage", values: ["mage", "thief"] }],
      coverage: { drivers: { "@world.class": { kind: "initial", values: ["mage", "thief"] } } },
      cards: [
        { id: "c_sneak", condition: '@world.class == "thief"' },
        { id: "c_cast", condition: '@world.class == "mage"' },
      ],
    });
    const report = runCoverage(source, OPTS);
    expect(cardRow(report, "c_sneak").dealt).toBeGreaterThan(0);
    expect(cardRow(report, "c_cast").dealt).toBeGreaterThan(0);
  });

  it("template instances cover their axis, hand by hand", () => {
    const source = project({
      tagGroups: [{ id: "d_zone", gameId: "zone", tags: [
        { id: "v_docks", gameId: "docks" }, { id: "v_market", gameId: "market" },
      ] }],
      templates: [{ id: "t_street", gameId: "street", chooses: ["d_zone"], slots: "unbounded", properties: [] }],
      hands: [
        { id: "h_docks", gameId: "docks-street", template: "t_street", chosen: { d_zone: "v_docks" } },
        { id: "h_market", gameId: "market-street", template: "t_street", chosen: { d_zone: "v_market" } },
      ],
      cards: [
        { id: "c_docks", tags: { d_zone: ["v_docks"] } },
        { id: "c_market", tags: { d_zone: ["v_market"] } },
      ],
    });
    const report = runCoverage(source, OPTS);
    const docks = report.hands.find((h) => h.gameId === "docks-street")!;
    const market = report.hands.find((h) => h.gameId === "market-street")!;
    expect(docks.cardsDealt).toEqual(["c_docks"]);
    expect(market.cardsDealt).toEqual(["c_market"]);
    expect(cardRow(report, "c_docks").dealt).toBeGreaterThan(0);
    expect(cardRow(report, "c_market").dealt).toBeGreaterThan(0);
  });

  it("a chosen tag surfaces as @hand and satisfies conditions", () => {
    const source = project({
      tagGroups: [{ id: "d_npc", gameId: "npc", tags: [{ id: "v_elder", gameId: "elder" }] }],
      templates: [{ id: "t_talk", gameId: "talk", chooses: ["d_npc"], slots: "unbounded", properties: [] }],
      hands: [{ id: "h_elder", gameId: "elder-talk", template: "t_talk", chosen: { d_npc: "v_elder" } }],
      cards: [{ id: "c_elder", condition: '@hand.npc == "elder"' }],
    });
    const report = runCoverage(source, OPTS);
    expect(cardRow(report, "c_elder").dealt).toBeGreaterThan(0);
    expect(report.unwrittenInputs).toEqual([]);
  });

  it("gated outcomes are respected: never played while nothing can open them", () => {
    const source = project({
      world: [{ name: "never", type: "boolean", default: false }],
      cards: [{ id: "c_a", outcomes: [
        { id: "o_ok", gameId: "ok", changes: {} },
        { id: "o_locked", gameId: "locked", condition: "@world.never", changes: {} },
      ] }],
    });
    const report = runCoverage(source, OPTS);
    expect(report.outcomes.find((o) => o.id === "o_ok")!.played).toBeGreaterThan(0);
    expect(report.outcomes.find((o) => o.id === "o_locked")!.played).toBe(0);
    expect(report.unwrittenInputs).toEqual(["@world.never"]);
  });

  it("a fully playable one-shot project exhausts every run", () => {
    const source = project({
      cards: [{ id: "c_once", redraw: "never" }],
    });
    const report = runCoverage(source, OPTS);
    expect(report.terminations).toEqual({ exhausted: OPTS.runs, maxTurns: 0, stuck: 0 });
    expect(cardRow(report, "c_once").played).toBe(OPTS.runs);
  });

  it("a dealt-only card (no outcomes) is never counted as played and cannot block exhaustion", () => {
    // The news/codex pattern: dealt is the card's whole job. The sweep plays
    // it with "" as a host would (ruling K), but there is no outcome to count,
    // and requiring a play of it made every run grind to the turn cap.
    const source = project({
      cards: [
        { id: "c_once", redraw: "never" },
        { id: "c_entry", redraw: "never", outcomes: [] },
      ],
    });
    const report = runCoverage(source, OPTS);
    expect(report.terminations).toEqual({ exhausted: OPTS.runs, maxTurns: 0, stuck: 0 });
    expect(cardRow(report, "c_entry").dealt).toBeGreaterThan(0);
    expect(cardRow(report, "c_entry").played).toBe(0);
  });
});

describe("the @hand honesty net", () => {
  it("flags an @hand ref nothing writes, drives or varies", () => {
    const source = project({
      tagGroups: [{ id: "d_zone", gameId: "zone", tags: [
        { id: "v_docks", gameId: "docks", properties: [{ name: "vibe", type: "number", default: 0 }] },
      ] }],
      hands: [{ id: "h_docks", gameId: "docks", rule: { bindings: { d_zone: "v_docks" }, slots: "unbounded" } }],
      cards: [{ id: "c_moody", condition: "@hand.vibe >= 3", tags: { d_zone: ["v_docks"] } }],
    });
    const report = runCoverage(source, OPTS);
    expect(cardRow(report, "c_moody").dealt).toBe(0);
    expect(cardRow(report, "c_moody").unwrittenRefs).toEqual(["@hand.vibe"]);
    expect(report.unwrittenInputs).toEqual(["@hand.vibe"]);
  });

  it("an @hand write-back or a chosen-tag name clears the flag", () => {
    const source = project({
      tagGroups: [
        { id: "d_zone", gameId: "zone", tags: [
          { id: "v_docks", gameId: "docks", properties: [{ name: "vibe", type: "number", default: 0 }] },
        ] },
        { id: "d_npc", gameId: "npc", tags: [{ id: "v_elder", gameId: "elder" }] },
      ],
      templates: [{ id: "t_talk", gameId: "talk",
        bindings: { d_zone: "v_docks" }, chooses: ["d_npc"], slots: "unbounded", properties: [] }],
      hands: [{ id: "h_elder", gameId: "elder-talk", template: "t_talk", chosen: { d_npc: "v_elder" } }],
      cards: [
        { id: "c_moody", condition: '@hand.vibe >= 3 and @hand.npc == "elder"', tags: { d_zone: ["v_docks"] } },
        { id: "c_stir", tags: { d_zone: ["v_docks"] },
          outcomes: [{ id: "o_up", gameId: "up", changes: { "@hand.vibe": "@hand.vibe + 1" } }] },
      ],
    });
    const report = runCoverage(source, OPTS);
    // vibe is written back by c_stir's outcome and npc is a chosen-tag name:
    // nothing to flag, and enough runs deal the moody card organically.
    expect(report.unwrittenInputs).toEqual([]);
    expect(cardRow(report, "c_moody").dealt).toBeGreaterThan(0);
    // ...and every name those cards read is composed by their asking hand.
    expect(report.unprovidedHandRefs).toEqual([]);
  });
});

// The composed-name net (design/board-legibility.md, the peek false alarm's
// real class): a card reading @hand.X that some hand which can legitimately
// ask it never composes. Static - the v0 gap the header note had named.
describe("the composed-name net (unprovided @hand refs)", () => {
  const zonePair = {
    tagGroups: [{ id: "d_zone", gameId: "zone", tags: [
      { id: "v_docks", gameId: "docks", properties: [{ name: "vibe", type: "number", default: 0 } as PropertyDecl] },
      { id: "v_strip", gameId: "strip" },
    ] }] as TagGroup[],
    hands: [
      { id: "h_docks", gameId: "docks-h", rule: { bindings: { d_zone: "v_docks" }, slots: "unbounded" } },
      { id: "h_strip", gameId: "strip-h", rule: { bindings: { d_zone: "v_strip" }, slots: "unbounded" } },
    ] as Hand<string>[],
  };

  it("flags a card reading a name some asking hand never composes", () => {
    const source = project({
      ...zonePair,
      // Untagged: a wildcard, so both hands ask it - and strip has no vibe.
      cards: [{ id: "c_moody", condition: "@hand.vibe >= 0" }],
    });
    expect(runCoverage(source, OPTS).unprovidedHandRefs).toEqual([
      { where: "card moody", ref: "@hand.vibe", hands: ["strip-h"] },
    ]);
  });

  it("stays quiet when the card's slice keeps it to hands that compose the name", () => {
    const source = project({
      ...zonePair,
      cards: [{ id: "c_moody", condition: "@hand.vibe >= 0", tags: { d_zone: ["v_docks"] } }],
    });
    expect(runCoverage(source, OPTS).unprovidedHandRefs).toEqual([]);
  });

  it("a deck gate's @hand ref must be composed by every hand in the box", () => {
    const source = project({
      ...zonePair,
      deckCondition: "@hand.vibe >= 0",
      cards: [{ id: "c_plain", tags: { d_zone: ["v_docks"] } }],
    });
    expect(runCoverage(source, OPTS).unprovidedHandRefs).toEqual([
      { where: "deck main gate", ref: "@hand.vibe", hands: ["strip-h"] },
    ]);
  });

  it("a group's name composes only where the group is chosen or rule-bound, as at ask time", () => {
    const source = project({
      tagGroups: [{ id: "d_zone", gameId: "zone", tags: [{ id: "v_docks", gameId: "docks" }] }],
      templates: [{ id: "t_fixed", gameId: "fixed", bindings: { d_zone: "v_docks" }, chooses: [], slots: "unbounded", properties: [] }],
      hands: [
        { id: "h_fixed", gameId: "fixed-h", template: "t_fixed" },
        { id: "h_ruled", gameId: "ruled-h", rule: { bindings: { d_zone: "v_docks" }, slots: "unbounded" } },
      ],
      cards: [{ id: "c_where", condition: '@hand.zone == "docks"' }],
    });
    // The rule-bound hand names the group; the fixed template binding does not
    // (the runtime's askNames come from chosen and rule bindings alone).
    expect(runCoverage(source, OPTS).unprovidedHandRefs).toEqual([
      { where: "card where", ref: "@hand.zone", hands: ["fixed-h"] },
    ]);
  });
});

// What each hand's coverage is out of: the cards that could come up there by
// tags and place (the runtime's tag matching over the hand's fixed bindings),
// not every card in its box. On the Village every place read like "6/86" for
// what was complete coverage (the author, 2026-09-29).
describe("per-hand coverage: what could come up here", () => {
  const hand = (report: ReturnType<typeof runCoverage>, gameId: string) =>
    report.hands.find((h) => h.gameId === gameId)!;
  const zones = {
    tagGroups: [{ id: "d_zone", gameId: "zone", tags: [
      { id: "v_docks", gameId: "docks" }, { id: "v_strip", gameId: "strip" },
    ] }] as TagGroup[],
    hands: [
      { id: "h_docks", gameId: "docks-h", rule: { bindings: { d_zone: "v_docks" }, slots: "unbounded" } },
      { id: "h_strip", gameId: "strip-h", rule: { bindings: { d_zone: "v_strip" }, slots: "unbounded" } },
    ] as Hand<string>[],
  };

  it("a pinned card counts only at its place, a wildcard card at every hand", () => {
    const source = project({
      hands: [
        { id: "h_a", gameId: "a", rule: { bindings: {}, slots: "unbounded" } },
        { id: "h_b", gameId: "b", rule: { bindings: {}, slots: "unbounded" } },
      ],
      cards: [{ id: "c_here", tags: { place: ["h_a"] } }, { id: "c_any" }],
    });
    const report = runCoverage(source, OPTS);
    expect(hand(report, "a").cardsPossible).toEqual(["c_any", "c_here"]);
    expect(hand(report, "b").cardsPossible).toEqual(["c_any"]);
    // Everything that could come up did: no gap at either, though b never
    // held the card pinned to a.
    expect(hand(report, "a").cardsNeverDealt).toEqual([]);
    expect(hand(report, "b").cardsNeverDealt).toEqual([]);
  });

  it("a bound group admits the bound tag and omission; a required group refuses omission", () => {
    const cards = [{ id: "c_docks", tags: { d_zone: ["v_docks"] } }, { id: "c_strip", tags: { d_zone: ["v_strip"] } }, { id: "c_plain" }];
    const open = runCoverage(project({ ...zones, cards }), OPTS);
    expect(hand(open, "docks-h").cardsPossible).toEqual(["c_docks", "c_plain"]);
    expect(hand(open, "strip-h").cardsPossible).toEqual(["c_plain", "c_strip"]);
    const required = runCoverage(project({
      ...zones, tagGroups: [{ ...zones.tagGroups[0]!, required: true }], cards,
    }), OPTS);
    expect(hand(required, "docks-h").cardsPossible).toEqual(["c_docks"]);
    expect(hand(required, "strip-h").cardsPossible).toEqual(["c_strip"]);
  });

  it("a group bound at run time is a wildcard: a movable hole and a boundBy group", () => {
    const source = project({
      story: [{ name: "act", type: "string", default: "one" }],
      tagGroups: [
        ...zones.tagGroups,
        { id: "d_act", gameId: "act", boundBy: "@story.act", tags: [{ id: "v_one", gameId: "one" }, { id: "v_two", gameId: "two" }] },
      ],
      templates: [{ id: "t_walk", gameId: "walk", chooses: ["d_zone"], slots: "unbounded",
        properties: [{ name: "where", type: "string", default: "docks" }] }],
      hands: [{ id: "h_walker", gameId: "walker", template: "t_walk", chosen: { d_zone: "@hand.where" } }],
      cards: [
        { id: "c_docks", tags: { d_zone: ["v_docks"] } },
        { id: "c_strip", tags: { d_zone: ["v_strip"] } },
        { id: "c_later", tags: { d_act: ["v_two"] } },
      ],
    });
    const walker = hand(runCoverage(source, OPTS), "walker");
    // Nothing moves the walker off the docks and nothing advances the act in
    // these runs, but a run could: none of the three is impossible here.
    expect(walker.cardsPossible).toEqual(["c_docks", "c_later", "c_strip"]);
    expect(walker.cardsDealt).toEqual(["c_docks"]);
    expect(walker.cardsNeverDealt).toEqual(["c_later", "c_strip"]);
  });

  it("the gap list is only what could come up here and never did", () => {
    const source = project({
      ...zones,
      world: [{ name: "never", type: "boolean", default: false }],
      cards: [
        { id: "c_docks", tags: { d_zone: ["v_docks"] } },
        { id: "c_locked", condition: "@world.never", tags: { d_zone: ["v_docks"] } },
        { id: "c_strip", tags: { d_zone: ["v_strip"] } },
      ],
    });
    const docks = hand(runCoverage(source, OPTS), "docks-h");
    expect(docks.cardsPossible).toEqual(["c_docks", "c_locked"]);
    expect(docks.cardsDealt).toEqual(["c_docks"]);
    // The strip card could never come up at the docks, so it is not a gap here.
    expect(docks.cardsNeverDealt).toEqual(["c_locked"]);
  });

  it("a hand nothing can reach has an empty possible set, and says which box it is in", () => {
    const source = project({
      ...zones,
      tagGroups: [{ ...zones.tagGroups[0]!, required: true }],
      cards: [{ id: "c_docks", tags: { d_zone: ["v_docks"] } }],
    });
    const strip = hand(runCoverage(source, OPTS), "strip-h");
    expect(strip.cardsPossible).toEqual([]);
    expect(strip.cardsNeverDealt).toEqual([]);
    expect(strip.deals).toBe(0);
    expect(strip.boxName).toBe("b1");
  });

  it("the composed-name net counts a movable hole as naming its group and every tag's properties", () => {
    const source = project({
      tagGroups: [{ id: "d_zone", gameId: "zone", tags: [
        { id: "v_docks", gameId: "docks", properties: [{ name: "vibe", type: "number", default: 0 }] },
        { id: "v_strip", gameId: "strip" },
      ] }],
      templates: [{ id: "t_walk", gameId: "walk", chooses: ["d_zone"], slots: "unbounded",
        properties: [{ name: "where", type: "string", default: "docks" }] }],
      hands: [{ id: "h_walker", gameId: "walker", template: "t_walk", chosen: { d_zone: "@hand.where" } }],
      // Untagged, so the walker asks it wherever the hole points; vibe is
      // composed whenever the hole lands on the docks, so it is not flagged.
      cards: [{ id: "c_moody", condition: '@hand.vibe >= 0 and @hand.zone == "docks"' }],
    });
    expect(runCoverage(source, OPTS).unprovidedHandRefs).toEqual([]);
  });
});

// The dynamic net: warnings that actually fired during the seeded runs used
// to be swallowed entirely - even one firing in every run of a sweep.
describe("runtime warnings in the report", () => {
  it("collects diagnostics fired during runs, deduplicated, counted by run", () => {
    const source = project({
      tagGroups: [{ id: "d_zone", gameId: "zone", tags: [
        { id: "v_docks", gameId: "docks", properties: [{ name: "vibe", type: "number", default: 0 } as PropertyDecl] },
        { id: "v_strip", gameId: "strip" },
      ] }],
      hands: [
        { id: "h_docks", gameId: "docks-h", rule: { bindings: { d_zone: "v_docks" }, slots: "unbounded" } },
        { id: "h_strip", gameId: "strip-h", rule: { bindings: { d_zone: "v_strip" }, slots: "unbounded" } },
      ],
      cards: [{ id: "c_moody", condition: "@hand.vibe >= 0" }],
    });
    const report = runCoverage(source, OPTS);
    expect(report.diagnostics).toHaveLength(1);
    const d = report.diagnostics[0]!;
    expect(d.where).toBe("card moody condition");
    expect(d.message).toContain("@hand.vibe is not declared");
    expect(d.runs).toBe(OPTS.runs);
  });

  it("reports nothing for a clean project", () => {
    const source = project({ cards: [{ id: "c_plain" }] });
    expect(runCoverage(source, OPTS).diagnostics).toEqual([]);
  });
});

describe("coverage proposal", () => {
  it("proposes boundary literals plus neighbours, declared domains, and skips written refs", () => {
    const source = project({
      world: [
        { name: "score", type: "number", default: 0 },
        { name: "raining", type: "boolean", default: false },
        { name: "owned", type: "number", default: 0 },
      ],
      cards: [
        { id: "c_high", condition: "@world.score >= 50" },
        { id: "c_wet", condition: "@world.raining" },
        { id: "c_own", condition: "@world.owned > 3",
          outcomes: [{ id: "o_w", gameId: "w", changes: { "@world.owned": "@world.owned + 1" } }] },
      ],
    });
    const { coverage, issues } = proposeCoverage(source);
    expect(issues).toEqual([]);
    expect(coverage.drivers).toEqual({
      "@world.raining": { kind: "recurring", cadence: "sometimes", values: [false, true] },
      "@world.score": { kind: "recurring", cadence: "sometimes", values: [49, 50, 51] },
    });
  });
});

describe("the async driver", () => {
  const source = () => project({
    world: [{ name: "raining", type: "boolean", default: false }],
    cards: [{ id: "c_a" }, { id: "c_b", condition: "@world.raining" }],
  });

  it("gives the same report as the synchronous run, run for run", async () => {
    // The two drivers share one body, and this is the test that keeps them
    // honest: the same seed must produce a bit-for-bit identical report.
    const sync = runCoverage(source(), OPTS);
    const async_ = await runCoverageAsync(source(), OPTS);
    expect(async_).toEqual(sync);
  });

  it("reports progress once per completed run, counting up to the total", async () => {
    const seen: [number, number][] = [];
    await runCoverageAsync(source(), { ...OPTS, runs: 5, onRun: async (done, total) => { seen.push([done, total]); } });
    expect(seen).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
  });

  it("stops early when asked, and reports the runs it actually took", async () => {
    let stop = false;
    const report = await runCoverageAsync(source(), {
      ...OPTS, runs: 100,
      shouldStop: () => stop,
      onRun: async (done) => { if (done === 3) stop = true; },
    });
    // Three runs completed, and the report says three - not the 100 asked
    // for. A partial sample that claimed the full count would be a lie about
    // how hard the content was looked at.
    expect(report.runs).toBe(3);
    expect(report.turns).toBeGreaterThan(0);
    expect(report.cards).toHaveLength(2);
  });

  it("a sweep stopped before its first run is empty, not broken", async () => {
    const report = await runCoverageAsync(source(), { ...OPTS, runs: 10, shouldStop: () => true });
    expect(report.runs).toBe(0);
    expect(report.turns).toBe(0);
    expect(report.cards.every((c) => c.dealt === 0)).toBe(true);
  });
});

describe("observed edges", () => {
  // c_gate opens only once c_key's outcome has raised the flag, so a run that
  // plays c_key must see c_gate become eligible: the edge the Links window
  // draws statically, here as evidence (design/graphical-views.md 4).
  const openable = (): SourceProject => project({
    story: [{ name: "open", type: "boolean", default: false }],
    cards: [
      { id: "c_key", outcomes: [{ id: "o_key", gameId: "turn", changes: { "@story.open": "true" } }] },
      { id: "c_gate", condition: "@story.open" },
    ],
  });

  it("is not measured unless asked for, so the ordinary sweep pays nothing", () => {
    expect(runCoverage(openable(), OPTS).observedEdges).toBeUndefined();
  });

  it("sees the play that opened the gate, and attributes it to the outcome", () => {
    const report = runCoverage(openable(), { ...OPTS, observeEdges: true });
    const edge = report.observedEdges!.find((e) => e.from === "c_key" && e.to === "c_gate");
    expect(edge).toBeDefined();
    expect(edge!.outcome).toBe("o_key");
    expect(edge!.runs).toBeGreaterThan(0);
    expect(edge!.runs).toBeLessThanOrEqual(OPTS.runs);
    // Counted per run for the headline ("seen in N of 200 runs"), so a run that
    // saw it a dozen times still contributes one.
    expect(edge!.count).toBeGreaterThanOrEqual(edge!.runs);
  });

  it("does not report a card as opening itself when its claim releases", () => {
    const report = runCoverage(openable(), { ...OPTS, observeEdges: true });
    expect(report.observedEdges!.filter((e) => e.from === e.to)).toEqual([]);
  });

  it("reports nothing when no play opens anything, which is an answer too", () => {
    const flat = project({ cards: [{ id: "c_a" }, { id: "c_b" }] });
    const report = runCoverage(flat, { ...OPTS, observeEdges: true });
    expect(report.observedEdges).toEqual([]);
  });

  it("stays reproducible from its seed with observation on", () => {
    const a = runCoverage(openable(), { ...OPTS, observeEdges: true });
    const b = runCoverage(openable(), { ...OPTS, observeEdges: true });
    expect(a.observedEdges).toEqual(b.observedEdges);
  });
});

// The sweep runs the Storylet Engine on its own, and the engine refuses content that names
// another engine's scope as a flow opens. That is one error on the report, never a crash.
describe("coverage: content that names another engine's scope", () => {
  it("is refused once, as an error naming the scope, with no runs", () => {
    const report = runCoverage(project({ cards: [{ id: "c_a", condition: "@patter.visits >= 1" }] }), OPTS);
    expect(report.runs).toBe(0);
    expect(report.issues.filter((i) => i.severity === "error").map((i) => i.message))
      .toEqual(["this content names @patter, which no engine on this registry registered: give every engine the game's one registry"]);
  });
});

// ---------------------------------------------------------------------------
// Coverage leads with what it reached LEAST (patter 72c625f, ruled for
// Storylets 2026-09-29). It used to flag only the never dealt, so a card dealt
// in half a percent of runs looked as healthy as one dealt in all of them. Now
// each card says how many RUNS dealt and played it, a dealt-but-rare card is
// flagged, the report counts the three kinds worth a look, and both the CLI
// and the window lead with the least reached.
// ---------------------------------------------------------------------------

describe("runs dealt and played, rare cards, and the totals", () => {
  it("counts runs, not occurrences: a card in every run is dealt many times but in each run once", () => {
    // The never-dealt card keeps every run from exhausting, so each goes on to
    // the turn cap and deals c_a again and again.
    const report = runCoverage(project({
      world: [{ name: "never", type: "boolean", default: false }],
      cards: [{ id: "c_a" }, { id: "c_gated", condition: "@world.never" }],
    }), OPTS);
    const a = cardRow(report, "c_a");
    expect(a.dealt).toBeGreaterThan(OPTS.runs);
    expect(a.played).toBeGreaterThan(OPTS.runs);
    expect(a.dealtRuns).toBe(OPTS.runs);
    expect(a.playedRuns).toBe(OPTS.runs);
    expect(a.rare).toBe(false);
  });

  it("a never-dealt card has no runs at all, and is never called rare", () => {
    const report = runCoverage(project({
      world: [{ name: "never", type: "boolean", default: false }],
      cards: [{ id: "c_a" }, { id: "c_gated", condition: "@world.never" }],
    }), OPTS);
    const gated = cardRow(report, "c_gated");
    expect([gated.dealtRuns, gated.playedRuns, gated.rare]).toEqual([0, 0, false]);
    expect(report.totals).toMatchObject({ cards: 2, dealt: 1, neverDealt: 1, rare: 0 });
  });

  it("the rare threshold at its edges: exactly 5% of runs is not rare, one run fewer is", () => {
    expect(RARE_DEALT_PCT).toBe(5);
    expect(rarelyDealt(5, 100)).toBe(false);
    expect(rarelyDealt(4, 100)).toBe(true);
    expect(rarelyDealt(10, 200)).toBe(false);
    expect(rarelyDealt(9, 200)).toBe(true);
    expect(rarelyDealt(1, 20)).toBe(false);
    expect(rarelyDealt(1, 21)).toBe(true);
    // Never dealt is its own, louder flag; and a sweep with no runs has none.
    expect(rarelyDealt(0, 100)).toBe(false);
    expect(rarelyDealt(0, 0)).toBe(false);
  });

  it("flags a card dealt in fewer than 5% of runs, and counts it", () => {
    // One value in forty: the card comes up in about 2.5% of runs.
    const report = runCoverage(project({
      world: [{ name: "lucky", type: "boolean", default: false }],
      coverage: { drivers: { "@world.lucky": { kind: "initial", values: [true, ...Array<boolean>(39).fill(false)] } } },
      cards: [{ id: "c_a" }, { id: "c_lucky", condition: "@world.lucky" }],
    }), { runs: 400, maxTurns: 10, seed: 0 });
    expect(report.rareThresholdPct).toBe(RARE_DEALT_PCT);
    const lucky = cardRow(report, "c_lucky");
    expect(lucky.dealtRuns).toBeGreaterThan(0);
    expect(lucky.dealtRuns * 100).toBeLessThan(RARE_DEALT_PCT * report.runs);
    expect(lucky.rare).toBe(true);
    expect(cardRow(report, "c_a").rare).toBe(false);
    expect(report.totals.rare).toBe(1);
    for (const c of report.cards) expect(c.rare).toBe(rarelyDealt(c.dealtRuns, report.runs));
  });

  it("counts dealt but never played, leaving out a card with no outcomes (dealt is its whole job)", () => {
    const report = runCoverage(project({
      world: [{ name: "never", type: "boolean", default: false }],
      cards: [
        { id: "c_a" },
        { id: "c_shut", outcomes: [{ id: "o_shut", gameId: "shut", condition: "@world.never", changes: {} }] },
        { id: "c_news", outcomes: [] },
      ],
    }), OPTS);
    const shut = cardRow(report, "c_shut");
    expect(shut.dealtRuns).toBe(OPTS.runs);
    expect(shut.playedRuns).toBe(0);
    const news = cardRow(report, "c_news");
    expect(news.dealtRuns).toBe(OPTS.runs);
    expect(news.playedRuns).toBe(0);
    expect(report.totals).toEqual({ cards: 3, dealt: 3, neverDealt: 0, rare: 0, dealtNeverPlayed: 1 });
  });

  it("names each card's deck and box as a reader knows them", () => {
    const report = runCoverage(project({ cards: [{ id: "c_a" }] }), OPTS);
    expect(cardRow(report, "c_a")).toMatchObject({ deck: "k_1", deckName: "main", box: "b_1", boxName: "b1" });
  });

  it("an empty report still carries its totals and threshold", () => {
    const report = runCoverage(project({ cards: [{ id: "c_a" }] }), { ...OPTS, runs: 0 });
    expect(report.runs).toBe(0);
    expect(report.rareThresholdPct).toBe(RARE_DEALT_PCT);
    expect(report.totals).toEqual({ cards: 1, dealt: 0, neverDealt: 1, rare: 0, dealtNeverPlayed: 0 });
  });
});

// The CLI review of 2026-10-06 (design/cli-review-2026-10.md): item 6, rulings
// K and L, the honesty net's read set (11) and the composed-name net's gaps.
describe("a play the engine refuses", () => {
  // The trigger: an outcome writing @hand.vibe, played from a hand that never
  // composes vibe. The engine refuses the play (ruling B: all or nothing), and
  // the sweep used to throw, losing the whole report.
  const refusing = (): SourceProject => project({
    tagGroups: [{ id: "d_zone", gameId: "zone", tags: [
      { id: "v_docks", gameId: "docks", properties: [{ name: "vibe", type: "number", default: 0 }] },
      { id: "v_strip", gameId: "strip" },
    ] }],
    hands: [
      { id: "h_docks", gameId: "docks-h", rule: { bindings: { d_zone: "v_docks" }, slots: "unbounded" } },
      { id: "h_strip", gameId: "strip-h", rule: { bindings: { d_zone: "v_strip" }, slots: "unbounded" } },
    ],
    cards: [{ id: "c_stir", outcomes: [{ id: "o_up", gameId: "up", changes: { "@hand.vibe": "1" } }] }],
  });

  it("an uncomposed @hand write is a diagnostic, and the sweep carries on", () => {
    const report = runCoverage(refusing(), OPTS);
    expect(report.runs).toBe(OPTS.runs);
    const refused = report.diagnostics.find((d) => d.where === "card stir play");
    expect(refused).toBeDefined();
    expect(refused!.message).toContain("@hand.vibe is not composed");
    // Where vibe IS composed, the same card plays.
    expect(cardRow(report, "c_stir").played).toBeGreaterThan(0);
  });

  it("a refused play still counts its turn, as a turn with nothing playable does", () => {
    // Only the hand that never composes vibe: every play is refused, so every
    // run goes to the turn cap with nothing played.
    const source = refusing();
    source.boxes[0]!.hands.hands = source.boxes[0]!.hands.hands.filter((h) => h.id === "h_strip");
    const report = runCoverage(source, OPTS);
    expect(report.terminations).toEqual({ exhausted: 0, maxTurns: OPTS.runs, stuck: 0 });
    expect(report.turns).toBe(OPTS.runs * OPTS.maxTurns);
    expect(report.plays).toBe(0);
    expect(report.diagnostics.find((d) => d.where === "card stir play")!.runs).toBe(OPTS.runs);
  });

  it("the composed-name net names the write too, before any run", () => {
    expect(runCoverage(refusing(), OPTS).unprovidedHandRefs).toEqual([
      { where: "card stir", ref: "@hand.vibe", hands: ["strip-h"] },
    ]);
  });
});

describe("a dealt card with no outcomes (ruling K)", () => {
  // A one-slot hand whose top card is dealt-only and never redrawn. A host
  // plays such a card with "" (a masthead, a notice), which frees the slot;
  // the sweep held it for the whole run, so the card behind it read as never
  // dealt.
  const starving = (): SourceProject => project({
    hands: [{ id: "h_one", gameId: "one", rule: { bindings: {}, slots: 1 } }],
    cards: [
      { id: "c_masthead", priority: 10, redraw: "never", outcomes: [] },
      { id: "c_story" },
    ],
  });

  it("is played with \"\", as a host does, so the card behind it comes up", () => {
    const report = runCoverage(starving(), OPTS);
    expect(cardRow(report, "c_masthead").dealtRuns).toBe(OPTS.runs);
    expect(cardRow(report, "c_story").dealtRuns).toBe(OPTS.runs);
  });

  it("still never counts as played, nor as dealt and never played", () => {
    const report = runCoverage(starving(), OPTS);
    expect(cardRow(report, "c_masthead").played).toBe(0);
    expect(cardRow(report, "c_masthead").playedRuns).toBe(0);
    expect(report.totals.dealtNeverPlayed).toBe(0);
  });
});

describe("the honesty net's read set", () => {
  it("is the card's condition, its deck's gate and an expression priority", () => {
    const report = runCoverage(project({
      story: [
        { name: "ready", type: "boolean", default: false },
        { name: "keen", type: "number", default: 0 },
      ],
      deckCondition: "@story.ready",
      cards: [{ id: "c_a", priority: "@story.keen" as never }],
    }), OPTS);
    expect(cardRow(report, "c_a").dealt).toBe(0);
    expect(cardRow(report, "c_a").unwrittenRefs).toEqual(["@story.keen", "@story.ready"]);
  });

  it("leaves out an outcome's gate, which cannot stop the card being dealt", () => {
    const report = runCoverage(project({
      story: [
        { name: "x", type: "boolean", default: false },
        { name: "y", type: "boolean", default: false },
      ],
      cards: [{ id: "c_a", condition: "@story.x",
        outcomes: [{ id: "o_a", gameId: "go", condition: "@story.y", changes: {} }] }],
    }), OPTS);
    expect(cardRow(report, "c_a").unwrittenRefs).toEqual(["@story.x"]);
    // Still an unwritten input of the project: the outcome can never be played.
    expect(report.unwrittenInputs).toEqual(["@story.x", "@story.y"]);
  });
});

describe("the composed-name net: a hand's own condition", () => {
  const zone = [{ id: "d_zone", gameId: "zone", tags: [
    { id: "v_docks", gameId: "docks", properties: [{ name: "vibe", type: "number", default: 0 } as PropertyDecl] },
    { id: "v_strip", gameId: "strip" },
  ] }] as TagGroup[];

  it("names a standalone hand whose rule condition reads a name it never composes", () => {
    const source = project({
      tagGroups: zone,
      hands: [
        { id: "h_docks", gameId: "docks-h", rule: { bindings: { d_zone: "v_docks" }, condition: "@hand.vibe >= 0", slots: "unbounded" } },
        { id: "h_strip", gameId: "strip-h", rule: { bindings: { d_zone: "v_strip" }, condition: "@hand.vibe >= 0", slots: "unbounded" } },
      ],
      cards: [{ id: "c_plain" }],
    });
    expect(runCoverage(source, OPTS).unprovidedHandRefs).toEqual([
      { where: "hand strip-h condition", ref: "@hand.vibe", hands: ["strip-h"] },
    ]);
  });

  it("names the instances of a template whose condition reads a name they never compose", () => {
    const source = project({
      tagGroups: zone,
      templates: [{ id: "t_street", gameId: "street", chooses: ["d_zone"], condition: "@hand.vibe >= 0",
        slots: "unbounded", properties: [] }],
      hands: [
        { id: "h_docks", gameId: "docks-street", template: "t_street", chosen: { d_zone: "v_docks" } },
        { id: "h_strip", gameId: "strip-street", template: "t_street", chosen: { d_zone: "v_strip" } },
      ],
      cards: [{ id: "c_plain" }],
    });
    expect(runCoverage(source, OPTS).unprovidedHandRefs).toEqual([
      { where: "hand template street condition", ref: "@hand.vibe", hands: ["strip-street"] },
    ]);
  });
});

describe("the observed-edge probe (ruling L)", () => {
  it("observes a card pinned to a hand, by peeking with that hand's place bound", () => {
    const source = project({
      story: [{ name: "open", type: "boolean", default: false }],
      hands: [{ id: "h_docks", gameId: "docks", rule: { bindings: {}, slots: "unbounded" } }],
      cards: [
        { id: "c_key", outcomes: [{ id: "o_key", gameId: "turn", changes: { "@story.open": "true" } }] },
        { id: "c_gate", condition: "@story.open", tags: { place: ["h_docks"] } },
      ],
    });
    const report = runCoverage(source, { ...OPTS, observeEdges: true });
    expect(report.observedEdges!.some((e) => e.from === "c_key" && e.to === "c_gate")).toBe(true);
  });

  it("peeks with the hand's fixed bindings, so a card the hand could never hold is not observed", () => {
    const source = project({
      story: [{ name: "open", type: "boolean", default: false }],
      tagGroups: [{ id: "d_zone", gameId: "zone", tags: [{ id: "v_docks", gameId: "docks" }, { id: "v_strip", gameId: "strip" }] }],
      hands: [{ id: "h_docks", gameId: "docks-h", rule: { bindings: { d_zone: "v_docks" }, slots: "unbounded" } }],
      cards: [
        { id: "c_key", outcomes: [{ id: "o_key", gameId: "turn", changes: { "@story.open": "true" } }] },
        { id: "c_here", condition: "@story.open", tags: { d_zone: ["v_docks"] } },
        { id: "c_elsewhere", condition: "@story.open", tags: { d_zone: ["v_strip"] } },
      ],
    });
    const targets = new Set(runCoverage(source, { ...OPTS, observeEdges: true }).observedEdges!.map((e) => e.to));
    expect(targets.has("c_here")).toBe(true);
    expect(targets.has("c_elsewhere")).toBe(false);
  });

  // A peek composes no hand properties, so a card reading one faults inside
  // the probe: a diagnostic the deal itself never raised.
  const moody = (): SourceProject => project({
    story: [{ name: "open", type: "boolean", default: false }],
    hands: [{ id: "h_all", gameId: "all", rule: { bindings: {}, slots: "unbounded" },
      properties: [{ name: "mood", type: "number", default: 0 }] }],
    cards: [
      { id: "c_key", outcomes: [{ id: "o_key", gameId: "turn", changes: { "@story.open": "true" } }] },
      { id: "c_moody", condition: "@story.open and @hand.mood >= 0" },
    ],
  });

  it("keeps its own peeks' diagnostics out of the report", () => {
    const off = runCoverage(moody(), OPTS);
    const on = runCoverage(moody(), { ...OPTS, observeEdges: true });
    expect(off.diagnostics).toEqual([]);
    expect(on.diagnostics).toEqual([]);
  });

  it("draws nothing: every tally is the same with the probe on and off (ruling A)", () => {
    for (const source of [moody(), project({
      tagGroups: [{ id: "d_zone", gameId: "zone", tags: [{ id: "v_docks", gameId: "docks" }, { id: "v_strip", gameId: "strip" }] }],
      hands: [
        { id: "h_docks", gameId: "docks-h", rule: { bindings: { d_zone: "v_docks" }, slots: 2 } },
        { id: "h_strip", gameId: "strip-h", rule: { bindings: { d_zone: "v_strip" }, slots: 1 } },
      ],
      cards: [
        { id: "c_a" }, { id: "c_b", tags: { d_zone: ["v_docks"] } }, { id: "c_c", tags: { d_zone: ["v_strip"] } },
        { id: "c_d", redraw: 3 }, { id: "c_e", tags: { place: ["h_strip"] } },
      ],
    })]) {
      const off = runCoverage(source, OPTS);
      const { observedEdges, ...on } = runCoverage(source, { ...OPTS, observeEdges: true });
      expect(observedEdges).toBeDefined();
      expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    }
  });
});

describe("leastReachedFirst", () => {
  const row = (id: string, dealtRuns: number, dealt: number) => ({ id, dealtRuns, dealt });

  it("puts the never dealt first, then by runs dealt, then by times dealt", () => {
    const ordered = leastReachedFirst([row("all", 200, 900), row("some", 50, 60), row("none", 0, 0), row("rare", 3, 3)]);
    expect(ordered.map((c) => c.id)).toEqual(["none", "rare", "some", "all"]);
  });

  it("breaks a tie on runs by times dealt, then keeps deck order", () => {
    const ordered = leastReachedFirst([row("a", 10, 9), row("b", 10, 3), row("c", 10, 3), row("d", 2, 50), row("e", 0, 0), row("f", 0, 0)]);
    expect(ordered.map((c) => c.id)).toEqual(["e", "f", "d", "b", "c", "a"]);
  });

  it("does not reorder the report's own list, which stays in deck order", () => {
    const report = runCoverage(project({
      world: [{ name: "never", type: "boolean", default: false }],
      cards: [{ id: "c_a" }, { id: "c_gated", condition: "@world.never" }],
    }), OPTS);
    expect(leastReachedFirst(report.cards).map((c) => c.id)).toEqual(["c_gated", "c_a"]);
    expect(report.cards.map((c) => c.id)).toEqual(["c_a", "c_gated"]);
  });
});

describe("sharePct: the Runs dealt figure", () => {
  it("never rounds a dealt card to 0% or a missed one to 100%", () => {
    expect(sharePct(0, 200)).toBe("0%");
    expect(sharePct(1, 5000)).toBe("<0.1%");
    expect(sharePct(1, 200)).toBe("0.5%");
    expect(sharePct(199, 200)).toBe(">99%");
    expect(sharePct(200, 200)).toBe("100%");
    expect(sharePct(0, 0)).toBe("0%");
  });

  it("keeps a tenth under 10%, rounded down, so a rare card never shows the threshold", () => {
    expect(sharePct(9, 200)).toBe("4.5%");
    expect(sharePct(99, 2000)).toBe("4.9%");
    expect(sharePct(57, 1000)).toBe("5.7%");
    expect(sharePct(10, 200)).toBe("5%");
    expect(sharePct(101, 200)).toBe("51%");
  });
});
