// ---------------------------------------------------------------------------
// Dead state: properties and flags written but never read, or read but never
// written. Static, so it runs in every validate rather than waiting for a
// coverage sweep.
//
// The motivating bug is the ported Village's: nothing writes @deck.well_vision,
// and that one dangling read silently killed five cards and ten outcomes across
// four decks (examples/the-village.storylets/README.md tells the chain). A
// coverage run finds the five dead cards; only a static check can point at the
// one missing write they all descend from.
//
// Expectations hand-written before the check existed.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { runValidate } from "../src/validate.js";
import type { LoadedProject } from "../src/load.js";
import type { SourceProject } from "@storylet-studio/compiler";

interface Card { id: string; gameId?: string; condition?: string; priority?: number; redraw?: string;
  outcomes: { id: string; gameId?: string; changes: Record<string, string> }[] }

const project = (opts: {
  story?: { name: string; type: string; default: unknown; values?: string[]; stages?: string[] }[];
  deckProps?: { name: string; type: string; default: unknown; values?: string[] }[];
  cards: Card[];
  /** A second deck, for the cases where two decks share a property name. */
  deck2?: { props?: { name: string; type: string; default: unknown }[]; cards: Card[] };
  /** Opt in to the write-side warnings (off by default: content is often
   *  written ahead of what will read it). */
  warnUnreadWrites?: boolean;
}): SourceProject => ({
  path: "p.storyletproj",
  project: {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    settings: { playAdvancesTurns: 1 },
    world: { properties: [] },
    story: { properties: opts.story ?? [] },
    templates: {},
    export: { bundle: "d.storyletsc", metadata: "full" },
    ...(opts.warnUnreadWrites ? { validation: { warnUnreadWrites: true } } : {}),
  },
  boxes: [{
    path: "b",
    box: { schema: "storylets/box@0", box: { id: "b_1", gameId: "b1", ranking: { specificity: true }, fields: [], properties: [] } },
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: { schema: "storylets/hands@0", templates: [], hands: [{ id: "h_1", gameId: "h1", rule: { bindings: {}, slots: "unbounded" } }] },
    decks: [{
      path: "b/decks/main.storyletdeck",
      shard: {
        schema: "storylets/deck@0",
        deck: { id: "k_1", gameId: "main", properties: opts.deckProps ?? [] },
        cards: opts.cards.map((c) => ({ priority: 0, redraw: "always", ...c })),
      },
    }, ...(opts.deck2 ? [{
      path: "b/decks/other.storyletdeck",
      shard: {
        schema: "storylets/deck@0",
        deck: { id: "k_2", gameId: "other", properties: opts.deck2.props ?? [] },
        cards: opts.deck2.cards.map((c) => ({ priority: 0, redraw: "always", ...c })),
      },
    }] : [])],
  }],
} as unknown as SourceProject);

const check = (p: SourceProject) => runValidate(
  { dir: "/p", files: [], sidecars: [], issues: [], source: p } as unknown as LoadedProject,
  { checkBundle: false },
).issues.filter((i) => /nothing (writes|reads|sets|checks|advances)|never moves/.test(i.message));

const card = (id: string, extra: Partial<Card>): Card =>
  ({ id, outcomes: [{ id: `o_${id.slice(2)}`, changes: {} }], ...extra });

describe("dead state", () => {
  it("warns about a property read that nothing writes: the well_vision bug", () => {
    const issues = check(project({
      deckProps: [{ name: "well_vision", type: "boolean", default: false }],
      cards: [card("c_a", { condition: "@deck.well_vision" })],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message).toContain("@deck.well_vision");
    expect(issues[0]!.message).toContain("nothing writes it");
  });

  it("warns about a @deck property written that nothing reads", () => {
    const issues = check(project({
      warnUnreadWrites: true,
      deckProps: [{ name: "noted", type: "boolean", default: false }],
      cards: [card("c_a", { outcomes: [{ id: "o_a", changes: { "@deck.noted": "true" } }] })],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("nothing reads it");
  });

  it("says NOTHING about an unread write by default: content is written ahead of its readers", () => {
    const issues = check(project({
      deckProps: [{ name: "noted", type: "boolean", default: false }],
      cards: [card("c_a", { outcomes: [{ id: "o_a", changes: { "@deck.noted": "true" } }] })],
    }));
    expect(issues).toEqual([]);
  });

  it("the read side stays loud whatever the setting: an unwritten read kills cards NOW", () => {
    const issues = check(project({
      deckProps: [{ name: "well_vision", type: "boolean", default: false }],
      cards: [card("c_a", { condition: "@deck.well_vision" })],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("nothing writes it");
  });

  it("a warning points at the shard and card that carry it, so a click can land there", () => {
    // The report that found this: clicking a dead-state warning opened project
    // settings, because every issue carried the project shard's path. The jump
    // wants the deck shard and the card's gameId.
    const read = check(project({
      deckProps: [{ name: "well_vision", type: "boolean", default: false }],
      cards: [card("c_a", { gameId: "gate-card", condition: "@deck.well_vision" })],
    }));
    expect(read[0]!.path).toBe("b/decks/main.storyletdeck");
    expect(read[0]!.where).toBe("gate-card");

    const write = check(project({
      warnUnreadWrites: true,
      deckProps: [{ name: "noted", type: "boolean", default: false }],
      cards: [card("c_a", { gameId: "write-card", outcomes: [{ id: "o_a", gameId: "go", changes: { "@deck.noted": "true" } }] })],
    }));
    expect(write[0]!.path).toBe("b/decks/main.storyletdeck");
    expect(write[0]!.where).toBe("write-card");
  });

  it("leaves a write-only @story property alone, for the same host-may-read reason", () => {
    const issues = check(project({
      story: [{ name: "ending", type: "string", default: "" }],
      cards: [card("c_a", { outcomes: [{ id: "o_a", changes: { "@story.ending": "\"grim\"" } }] })],
    }));
    expect(issues).toEqual([]);
  });

  it("says nothing when the pair is complete", () => {
    const issues = check(project({
      deckProps: [{ name: "noted", type: "boolean", default: false }],
      cards: [
        card("c_a", { outcomes: [{ id: "o_a", changes: { "@deck.noted": "true" } }] }),
        card("c_b", { condition: "@deck.noted" }),
      ],
    }));
    expect(issues).toEqual([]);
  });

  it("works at FLAG level, not property level: one checked-but-never-set flag warns", () => {
    // The flags idiom is the project's own (the Hamlet's per-deck `progress`),
    // so property-level read/write is not enough: the property is both read and
    // written while one of its flags dangles. Checked-but-never-set warns in
    // EVERY story scope, because only an outcome could ever set it.
    const issues = check(project({
      story: [{ name: "lore", type: "flags", default: [], values: ["heard", "spread"] }],
      cards: [
        card("c_a", { outcomes: [{ id: "o_a", changes: { "@story.lore": "set_flags(@lore, +heard)" } }] }),
        card("c_b", { condition: "check_flags(@story.lore, +heard, +spread)" }),
      ],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("+spread");
    expect(issues[0]!.message).toContain("nothing sets it");
  });

  it("warns about a @deck flag set that nothing ever checks", () => {
    const issues = check(project({
      warnUnreadWrites: true,
      deckProps: [{ name: "progress", type: "flags", default: [], values: ["heard"] }],
      cards: [
        card("c_a", { outcomes: [{ id: "o_a", changes: { "@deck.progress": "set_flags(@deck.progress, +heard)" } }] }),
        card("c_b", { condition: "check_flags(@deck.progress, -missing_nothing)" }),
      ],
    }));
    const set = issues.filter((i) => i.message.includes("+heard"));
    expect(set).toHaveLength(1);
    expect(set[0]!.message).toContain("nothing checks it");
  });

  it("leaves a write-only @story flag alone: the host may be the reader", () => {
    // A relationship ending (+angry, +grateful) is often recorded for the GAME
    // to read (a reputation display, a save summary), so "set but never
    // checked" cannot tell content from interface on @story. @deck is private
    // to the story, which is why the previous test warns and this one does not.
    const issues = check(project({
      story: [{ name: "rel_smith", type: "flags", default: [], values: ["angry"] }],
      cards: [
        card("c_a", { outcomes: [{ id: "o_a", changes: { "@story.rel_smith": "set_flags(@rel_smith, +angry)" } }] }),
        card("c_b", { condition: "check_flags(@story.rel_smith, -nothing_here)" }),
      ],
    }));
    expect(issues.filter((i) => i.message.includes("+angry"))).toEqual([]);
  });

  it("warns about a stage that is gated on but can never be reached", () => {
    // The quality analogue of the well_vision bug: a gate on a later stage,
    // and no outcome ever advances or sets the quality, so the gate stays
    // shut forever. Static, because coverage would only find the bodies.
    const issues = check(project({
      story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "resolved"] }],
      cards: [card("c_late", { condition: '@story.debt >= "confronted"' })],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("@story.debt");
    expect(issues[0]!.message).toContain("never moves");
  });

  it("says nothing when an advance exists: one advancer makes the ladder walkable", () => {
    const issues = check(project({
      story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "resolved"] }],
      cards: [
        card("c_go", { outcomes: [{ id: "o_on", changes: { "@story.debt": "advance(@story.debt)" } }] }),
        card("c_late", { condition: '@story.debt >= "confronted"' }),
      ],
    }));
    expect(issues).toEqual([]);
  });

  it("an explicit set counts as movement too", () => {
    const issues = check(project({
      story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "resolved"] }],
      cards: [
        card("c_jump", { outcomes: [{ id: "o_j", changes: { "@story.debt": "\"resolved\"" } }] }),
        card("c_late", { condition: '@story.debt >= "confronted"' }),
      ],
    }));
    expect(issues).toEqual([]);
  });

  it("leaves @world alone: the host writes it, so a dangling read is the honesty net's job", () => {
    const issues = check(project({
      cards: [card("c_a", { condition: "@world.time_of_day == \"night\"" })],
    }));
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Deck scope is PER DECK. @deck.progress in one deck and @deck.progress in
// another are two different properties at runtime (each deck has its own
// store), so one deck's read must never vouch for another deck's write. Found
// in the wild: the Village's Gareth's Debt read a `helped` that Mira's Secret
// also wrote, and the write side went unreported until Gareth stopped reading.
// ---------------------------------------------------------------------------

describe("same property name in two decks", () => {
  const bothDead = () => check(project({
    warnUnreadWrites: true,
    deckProps: [{ name: "helped", type: "boolean", default: false }],
    cards: [card("c_1", { condition: "@deck.helped" })],                       // reads, never writes
    deck2: {
      props: [{ name: "helped", type: "boolean", default: false }],
      cards: [card("c_2", { outcomes: [{ id: "o_2", changes: { "@deck.helped": "true" } }] })],  // writes, never reads
    },
  }));

  it("reports both halves: one deck's read does not vouch for another's write", () => {
    const msgs = bothDead().map((i) => i.message);
    expect(msgs.some((m) => m.includes("nothing writes it"))).toBe(true);
    expect(msgs.some((m) => m.includes("nothing reads it"))).toBe(true);
  });

  it("names the deck, because the property name alone is ambiguous", () => {
    const msgs = bothDead().map((i) => i.message);
    expect(msgs.some((m) => m.includes("main"))).toBe(true);
    expect(msgs.some((m) => m.includes("other"))).toBe(true);
  });

  it("stays quiet when each deck wires its own copy properly", () => {
    const issues = check(project({
      deckProps: [{ name: "seen", type: "boolean", default: false }],
      cards: [
        card("c_1", { outcomes: [{ id: "o_1", changes: { "@deck.seen": "true" } }] }),
        card("c_1b", { condition: "@deck.seen" }),
      ],
      deck2: {
        props: [{ name: "seen", type: "boolean", default: false }],
        cards: [
          card("c_2", { outcomes: [{ id: "o_2", changes: { "@deck.seen": "true" } }] }),
          card("c_2b", { condition: "@deck.seen" }),
        ],
      },
    }));
    expect(issues).toEqual([]);
  });
});
