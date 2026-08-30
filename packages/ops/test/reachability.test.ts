// Conditions that can never hold: the hand-written contract, before the code.
//
// The fault this exists for (design/reachability.md): the Village's
// `Expose the Conspiracy` wants `@deck.connected && !@deck.torin_offer_seen`,
// and the only writer of `connected` requires `torin_offer_seen`, which nothing
// ever sets back to false. Unsatisfiable, and four existing checks could not
// see it - coverage reports bodies, the honesty net found both refs written,
// dead state found both halves present, and Links has the edges but needs a
// person to join them.
//
// The rule this suite holds the check to, above every individual case: IT MAY
// ONLY REPORT WHAT IT CAN REFUTE. A false "this can never happen" on a card
// that plays fine teaches authors to ignore the panel, and a check that cries
// wolf is worse than no check. So most of these cases are about staying quiet.

import { describe, expect, it } from "vitest";
import type { SourceProject } from "@storylet-studio/compiler";
import type { PropertyDecl } from "@storylet-studio/model";
import { reachabilityIssues } from "../src/reachability.js";

interface CardFix {
  id: string;
  condition?: string;
  outcomes?: { id: string; changes?: Record<string, string> }[];
}

/** The same shape coverage.test.ts uses, which is the one `compileProject`
 *  actually accepts, plus deck-scoped property declarations (this check is
 *  mostly about `@deck` latches). */
const project = (cards: CardFix[], opts: {
  story?: PropertyDecl[];
  deck?: PropertyDecl[];
  world?: PropertyDecl[];
} = {}): SourceProject => ({
  path: "p.storyletproj",
  project: {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    settings: { playAdvancesTurns: 1 },
    world: { properties: opts.world ?? [] },
    story: { properties: opts.story ?? [] },
    templates: {},
    export: { bundle: "dist/p.storyletsc", metadata: "full" },
  },
  boxes: [{
    path: "b",
    box: {
      schema: "storylets/box@0",
      box: { id: "b_1", gameId: "b1", ranking: { specificity: true }, fields: [], properties: [] },
    },
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: {
      schema: "storylets/hands@0",
      templates: [],
      hands: [{ id: "h_all", gameId: "all", rule: { bindings: {}, slots: "unbounded" } }],
    },
    decks: [{
      path: "b/decks/main.storyletdeck",
      shard: {
        schema: "storylets/deck@0",
        deck: { id: "k_1", gameId: "main", properties: opts.deck ?? [] },
        cards: cards.map((c) => ({
          id: c.id, gameId: c.id.replace(/^c_/, ""), priority: 0, redraw: "always" as const,
          ...(c.condition !== undefined ? { condition: c.condition } : {}),
          // gameIds must be legal addresses (no underscores), which is why the
          // ids here carry the prefixes and the gameIds do not.
          outcomes: (c.outcomes ?? [{ id: `o_${c.id}` }]).map((o, j) => ({
            id: o.id, gameId: `go${j}`, changes: o.changes ?? {},
          })),
        })),
      },
    }],
  }],
});

const messages = (source: SourceProject): string[] => reachabilityIssues(source).map((i) => i.message);
const named = (source: SourceProject): string[] => reachabilityIssues(source).map((i) => i.where ?? "?");

const LATCH = { type: "boolean", default: false } as const;

describe("reachability: what it refuses", () => {
  it("refutes the Village's shape: A && !B where the only writer of A needs B", () => {
    const issues = reachabilityIssues(project([
      // Sets B.
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      // Sets A, but only after B.
      { id: "c_connect", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@deck.connected": "true" } }] },
      // Wants A and not-B: impossible, because A implies B and nothing unsets B.
      { id: "expose", condition: "@deck.connected && !@deck.seen" },
    ], { deck: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "connected" }] }));

    expect(issues).toHaveLength(1);
    expect(issues[0]!.where).toBe("expose");
    expect(issues[0]!.severity).toBe("warning");
    // The message names the CHAIN, because "this is unreachable" without a
    // reason is a puzzle rather than a diagnosis.
    expect(issues[0]!.message).toContain("@deck.connected");
    expect(issues[0]!.message).toContain("@deck.seen");
    expect(issues[0]!.field).toBe("condition");
  });

  it("refutes it through a chain, not just one hop", () => {
    expect(named(project([
      { id: "c_a", outcomes: [{ id: "o1", changes: { "@deck.a": "true" } }] },
      { id: "c_b", condition: "@deck.a", outcomes: [{ id: "o2", changes: { "@deck.b": "true" } }] },
      { id: "c_c", condition: "@deck.b", outcomes: [{ id: "o3", changes: { "@deck.c": "true" } }] },
      { id: "dead", condition: "@deck.c && !@deck.a" },
    ], { deck: ["a", "b", "c"].map((name) => ({ ...LATCH, name })) }))).toEqual(["dead"]);
  });

  it("refutes the same shape on FLAGS, which is where authors actually write it", () => {
    const issues = reachabilityIssues(project([
      { id: "c_meet", outcomes: [{ id: "o1", changes: { "@story.rel": "set_flags(@story.rel, +met)" } }] },
      { id: "c_trust", condition: "check_flags(@story.rel, +met)",
        outcomes: [{ id: "o2", changes: { "@story.rel": "set_flags(@story.rel, +trusted)" } }] },
      { id: "dead", condition: "check_flags(@story.rel, +trusted) && !check_flags(@story.rel, +met)" },
    ], { story: [{ name: "rel", type: "flags", default: [], values: ["met", "trusted"] }] }));
    expect(issues.map((i) => i.where)).toEqual(["dead"]);
    expect(issues[0]!.message).toContain("+met");
  });

  it("refutes a condition that contradicts itself outright", () => {
    expect(named(project([
      { id: "c_set", outcomes: [{ id: "o1", changes: { "@deck.open": "true" } }] },
      { id: "dead", condition: "@deck.open && !@deck.open" },
    ], { deck: [{ ...LATCH, name: "open" }] }))).toEqual(["dead"]);
  });

  it("refutes only when EVERY branch of an OR is refuted", () => {
    const cards = (second: string): CardFix[] => [
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      { id: "c_conn", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@deck.connected": "true" } }] },
      { id: "maybe", condition: `(@deck.connected && !@deck.seen) || (${second})` },
    ];
    const decls = { deck: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "connected" }] };
    // One live branch rescues the whole condition.
    expect(named(project(cards("@deck.seen"), decls))).toEqual([]);
    // Both dead: refuted.
    expect(named(project(cards("@deck.connected && !@deck.seen"), decls))).toEqual(["maybe"]);
  });
});

describe("reachability: what it refuses to guess about", () => {
  it("says nothing when the latch can be cleared again", () => {
    // `clear_flags` makes the flag non-monotonic, so "A implies B" stops being
    // a fact about the whole run and the check has nothing to prove.
    expect(named(project([
      { id: "c_meet", outcomes: [{ id: "o1", changes: { "@story.rel": "set_flags(@story.rel, +met)" } }] },
      { id: "c_trust", condition: "check_flags(@story.rel, +met)",
        outcomes: [{ id: "o2", changes: { "@story.rel": "set_flags(@story.rel, +trusted)" } }] },
      { id: "c_forget", outcomes: [{ id: "o3", changes: { "@story.rel": "clear_flags(@story.rel, -met)" } }] },
      { id: "c_live", condition: "check_flags(@story.rel, +trusted) && !check_flags(@story.rel, +met)" },
    ], { story: [{ name: "rel", type: "flags", default: [], values: ["met", "trusted"] }] }))).toEqual([]);
  });

  it("says nothing when a boolean is ever written false", () => {
    expect(named(project([
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      { id: "c_conn", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@deck.connected": "true" } }] },
      { id: "c_reset", outcomes: [{ id: "o3", changes: { "@deck.seen": "false" } }] },
      { id: "c_live", condition: "@deck.connected && !@deck.seen" },
    ], { deck: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "connected" }] }))).toEqual([]);
  });

  it("says nothing about a counter, which is not a latch at all", () => {
    expect(named(project([
      { id: "c_count", outcomes: [{ id: "o1", changes: { "@deck.n": "@deck.n + 1" } }] },
      { id: "c_gate", condition: "@deck.n > 2", outcomes: [{ id: "o2", changes: { "@deck.open": "true" } }] },
      { id: "c_live", condition: "@deck.open && !(@deck.n > 2)" },
    ], { deck: [{ name: "n", type: "number", default: 0 }, { ...LATCH, name: "open" }] }))).toEqual([]);
  });

  it("says nothing when the writer does NOT require the negated latch", () => {
    // The ordinary, correct shape: a card that opens once and closes its own
    // door. Nothing here is contradictory, and a warning would be noise.
    expect(named(project([
      { id: "c_open", outcomes: [{ id: "o1", changes: { "@deck.open": "true" } }] },
      { id: "c_once", condition: "@deck.open && !@deck.done",
        outcomes: [{ id: "o2", changes: { "@deck.done": "true" } }] },
    ], { deck: [{ ...LATCH, name: "open" }, { ...LATCH, name: "done" }] }))).toEqual([]);
  });

  it("says nothing when A has a SECOND writer that does not need B", () => {
    // Any one route to A being live is enough. The check must intersect the
    // writers' requirements, not union them - the difference between "must
    // pass through B" and "one way there passes through B".
    expect(named(project([
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      { id: "c_conn", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@deck.connected": "true" } }] },
      { id: "c_shortcut", outcomes: [{ id: "o3", changes: { "@deck.connected": "true" } }] },
      { id: "c_live", condition: "@deck.connected && !@deck.seen" },
    ], { deck: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "connected" }] }))).toEqual([]);
  });

  it("says nothing when nothing writes the latch at all", () => {
    // That is the honesty net's and dead state's story, told better by them:
    // this check would say "unreachable" where they say "nobody wrote it yet",
    // and mid-authoring the second is the true and kinder reading.
    expect(named(project([
      { id: "c_live", condition: "@deck.connected && !@deck.seen" },
    ], { deck: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "connected" }] }))).toEqual([]);
  });

  it("survives a cycle without hanging or inventing a requirement", () => {
    expect(named(project([
      { id: "c_a", condition: "@deck.b", outcomes: [{ id: "o1", changes: { "@deck.a": "true" } }] },
      { id: "c_b", condition: "@deck.a", outcomes: [{ id: "o2", changes: { "@deck.b": "true" } }] },
      { id: "c_live", condition: "@deck.a && !@deck.b" },
    ], { deck: [{ ...LATCH, name: "a" }, { ...LATCH, name: "b" }] }))).toEqual([]);
  });

  it("keeps two decks' private state apart", () => {
    // @deck.seen in one deck is a different property at runtime from
    // @deck.seen in another. Keying by bare name let one deck's wiring vouch
    // for another's - the mistake deadstate.ts records having made.
    const source = project([
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      { id: "c_conn", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@deck.connected": "true" } }] },
    ], { deck: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "connected" }] });
    // A second deck whose own `connected` nothing writes: no refutation there.
    const box = source.boxes[0]!;
    box.decks.push({
      path: "b/decks/e.storyletdeck",
      shard: {
        schema: "storylets/deck@0",
        deck: { id: "k_2", gameId: "k2", properties: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "connected" }] },
        cards: [{ id: "other", gameId: "other", order: 0, priority: 0, redraw: "always",
          condition: "@deck.connected && !@deck.seen", outcomes: [{ id: "oo", gameId: "o0", order: 0 }] }],
      },
    } as never);
    expect(named(source)).toEqual([]);
  });
});

// --- The positive latch has to be a latch too --------------------------------
//
// From the Patter side (to-storylets/reachability-positive-latch.md), found
// porting this to Patterpad: step 3 asks `monotonic` of the NEGATED term and
// never of the positive one. The refutation argues "A can only become true
// after B", which is sound only when A becoming true REQUIRES a writer to have
// run. If A can be true with no writer running, it implies nothing about order.
//
// They flagged it as possibly unreachable here. It is not. It is MORE reachable
// here than there, by two separate routes, and both are below.
describe("reachability: the positive term must itself be a latch", () => {
  it("says nothing when the positive term's own default already holds it", () => {
    // `open` is declared true. It is written cleanly once, so it is `latched`
    // and not `broken`, and the old code walked its writer chain and refuted.
    // But it does not need that writer: it is true from the first turn, so it
    // implies nothing about `seen` having happened.
    expect(named(project([
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      { id: "c_open", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@deck.open": "true" } }] },
      // Plays on turn one, before anything: `open` starts true and `seen` starts false.
      { id: "fine", condition: "@deck.open && !@deck.seen" },
    ], {
      deck: [{ ...LATCH, name: "seen" }, { name: "open", type: "boolean", default: true }],
    }))).toEqual([]);
  });

  it("says nothing when the positive term is written in a shape it cannot read", () => {
    // `open` is latched once cleanly and once by a computed write, so it is
    // `broken`: we can no longer say it only moves one way. It keeps its
    // `writers` entry either way, which is what let the chain walk refute on it.
    expect(named(project([
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      { id: "c_open", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@deck.open": "true" } }] },
      // A second, unreadable route to the same ref, needing nothing.
      { id: "c_odd", outcomes: [{ id: "o3", changes: { "@deck.open": "@deck.seen == false" } }] },
      { id: "fine", condition: "@deck.open && !@deck.seen" },
    ], {
      deck: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "open" }],
    }))).toEqual([]);
  });

  it("still refutes the real shape, where the positive term IS a latch", () => {
    // The guard must not buy its silence by going quiet everywhere: the
    // Village's own case has to keep reporting.
    expect(named(project([
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      { id: "c_open", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@deck.open": "true" } }] },
      { id: "dead", condition: "@deck.open && !@deck.seen" },
    ], { deck: [{ ...LATCH, name: "seen" }, { ...LATCH, name: "open" }] }))).toEqual(["dead"]);
  });
});

// --- @world is the host's, in both directions --------------------------------
//
// design/reachability.md step 1 already says this: a ref that is "a `@world` ref
// the host drives" is UNKNOWN and "takes no part in what follows". The code never
// implemented it, so a story-side `@world.x = true` was classified as a latch
// like any other. The Patter side raised it as a THIRD route of the same class
// (to-storylets/reachability-two-routes-confirmed.md) and suggested looking when
// such a thing first appeared. It already had.
//
// The point is not that the story writes it one way. It is that the GAME can
// write it the other way at any moment, and nothing in the project can prove
// otherwise, so no ordering argument built on it is sound.
describe("reachability: @world is the host's, so it anchors nothing", () => {
  const HOST = { type: "boolean", default: false } as const;

  it("says nothing when the positive term is a @world ref", () => {
    expect(named(project([
      { id: "c_see", outcomes: [{ id: "o1", changes: { "@deck.seen": "true" } }] },
      { id: "c_flag", condition: "@deck.seen", outcomes: [{ id: "o2", changes: { "@world.alarm": "true" } }] },
      // The host can raise the alarm itself, before anything is seen.
      { id: "fine", condition: "@world.alarm && !@deck.seen" },
    ], { deck: [{ ...LATCH, name: "seen" }], world: [{ ...HOST, name: "alarm" }] }))).toEqual([]);
  });

  it("says nothing when the NEGATED term is a @world ref", () => {
    // The mirror: "nothing sets it back" is exactly what we cannot claim about a
    // ref the game owns, so it cannot carry the negated half either.
    expect(named(project([
      { id: "c_raise", outcomes: [{ id: "o1", changes: { "@world.alarm": "true" } }] },
      { id: "c_act", condition: "@world.alarm", outcomes: [{ id: "o2", changes: { "@deck.acted": "true" } }] },
      { id: "fine", condition: "@deck.acted && !@world.alarm" },
    ], { deck: [{ ...LATCH, name: "acted" }], world: [{ ...HOST, name: "alarm" }] }))).toEqual([]);
  });
});
