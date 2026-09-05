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

  it("a dealt-only card (no outcomes) is never asked to be played and cannot block exhaustion", () => {
    // The news/codex pattern: dealt is the card's whole job - the game's UI
    // reads the hand, nothing plays. Requiring a play of it made every run
    // grind to the turn cap.
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
