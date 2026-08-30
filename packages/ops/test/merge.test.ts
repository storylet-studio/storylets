// ---------------------------------------------------------------------------
// The merge corpus: hand-authored 3-way cases, CI-gated (Reboot 7.4,
// mirroring Patter's testing pattern). Each case pins expected merged output
// and/or expected conflicts / warnings; expectations were written from the
// merge design, not from the implementation. Plus the algebraic property
// tests over every corpus case: merge(b,x,b)=x, merge(b,b,y)=y,
// merge(b,x,x)=x, merge(b,b,b)=b.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { canonicalStringify } from "@storylet-studio/compiler";
import { runMerge, MergeInputError, detectMergeType, MERGE_SPECS } from "../src/merge.js";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  SHARD_EXTENSIONS, PROJECT_SCHEMA, BOX_SCHEMA, TAGS_SCHEMA, HANDS_SCHEMA,
  DECK_SCHEMA, VIEW_SCHEMA, NOTES_SCHEMA,
} from "@storylet-studio/model";
import type { ConflictKind } from "../src/merge.js";

type Obj = Record<string, unknown>;

const eq = (a: unknown, b: unknown): void => {
  expect(canonicalStringify(a)).toBe(canonicalStringify(b));
};

// --- fixture builders (deck shards are the everyday merge unit) --------------

const deck = (cards: Obj[], deckFields: Obj = {}): Obj => ({
  schema: "storylets/deck@0",
  deck: { id: "k_1", gameId: "main", properties: [], ...deckFields },
  cards,
});
const card = (id: string, fields: Obj = {}): Obj => ({
  id, gameId: id.replace(/^c_/, ""), priority: 0, redraw: "always", outcomes: [], ...fields,
});
/** An arrangement sidecar holding one deck's canvas. */
const view = (cards: Obj): Obj => ({
  schema: "storylets/view@0",
  canvases: { k_1: { cards } },
});
/** An arrangement sidecar holding a box's MAP. `sites`, not `pins`: the key was
 *  renamed on 2026-08-10 and the merge spec was not, so this builder is the
 *  thing that would have caught it. */
const boxMap = (sites: Obj): Obj => ({
  schema: "storylets/view@0",
  map: { sites },
});
/** The comment sidecar: what a reviewer sends back. */
const notes = (comments: Obj[]): Obj => ({
  schema: "storylets/notes@0",
  comments,
});
const thread = (id: string, body: string, extra: Obj = {}): Obj => ({
  id, anchor: "c_1",
  messages: [{ author: "Reviewer", ts: "2026-08-29T10:00:00Z", body }],
  ...extra,
});

interface Case {
  name: string;
  base: Obj;
  ours: Obj;
  theirs: Obj;
  /** Expected merged model (canonical equality). */
  expect?: Obj;
  /** Expected conflicts as (kind, id) pairs, order-insensitive. */
  expectConflicts?: [ConflictKind, string][];
  expectWarnings?: number;
}

const corpus: Case[] = [
  // --- the everyday cases the format was designed for (Reboot 7.5) -----------
  {
    name: "different fields of one card merge cleanly",
    base: deck([card("c_1", { title: "Old", condition: "@story.a" })]),
    ours: deck([card("c_1", { title: "New", condition: "@story.a" })]),
    theirs: deck([card("c_1", { title: "Old", condition: "@story.b" })]),
    expect: deck([card("c_1", { title: "New", condition: "@story.b" })]),
  },
  {
    name: "concurrent card adds both land, sorted by id (S3: a non-event)",
    base: deck([card("c_m")]),
    ours: deck([card("c_a"), card("c_m")]),      // shards are id-sorted by contract
    theirs: deck([card("c_m"), card("c_z")]),
    expect: deck([card("c_a"), card("c_m"), card("c_z")]),
  },
  {
    name: "same field changed differently is a conflict, provisional OURS",
    base: deck([card("c_1", { priority: 0 })]),
    ours: deck([card("c_1", { priority: 5 })]),
    theirs: deck([card("c_1", { priority: 9 })]),
    expect: deck([card("c_1", { priority: 5 })]),
    expectConflicts: [["both-changed", "c_1"]],
  },
  {
    name: "delete vs edit keeps the edited card and conflicts (never a silent drop)",
    base: deck([card("c_1", { title: "Old" }), card("c_2")]),
    ours: deck([card("c_1", { title: "New" }), card("c_2")]),
    theirs: deck([card("c_2")]),
    expect: deck([card("c_1", { title: "New" }), card("c_2")]),
    expectConflicts: [["delete-vs-edit", "c_1"]],
  },
  {
    name: "edit vs delete (ours deleted) drops the card but still conflicts (never a silent resurrection)",
    base: deck([card("c_1", { title: "Old" }), card("c_2")]),
    ours: deck([card("c_2")]),
    theirs: deck([card("c_1", { title: "New" }), card("c_2")]),
    expect: deck([card("c_2")]),
    expectConflicts: [["delete-vs-edit", "c_1"]],
  },
  {
    name: "delete vs delete is clean",
    base: deck([card("c_1"), card("c_2")]),
    ours: deck([card("c_2")]),
    theirs: deck([card("c_2")]),
    expect: deck([card("c_2")]),
  },
  {
    name: "unchanged vs delete is a clean delete",
    base: deck([card("c_1"), card("c_2")]),
    ours: deck([card("c_1"), card("c_2")]),
    theirs: deck([card("c_2")]),
    expect: deck([card("c_2")]),
  },
  {
    name: "the same id added on both sides with different content conflicts (S8)",
    base: deck([]),
    ours: deck([card("c_1", { title: "Mine" })]),
    theirs: deck([card("c_1", { title: "Yours" })]),
    expect: deck([card("c_1", { title: "Mine" })]),
    expectConflicts: [["added-both", "c_1"]],
  },
  {
    name: "the same id added identically on both sides is clean",
    base: deck([]),
    ours: deck([card("c_1")]),
    theirs: deck([card("c_1")]),
    expect: deck([card("c_1")]),
  },
  // --- nested structure: tags, outcomes, changes -------------------------------
  {
    name: "card tags merge as sets per group: an add and a remove both land",
    base: deck([card("c_1", { tags: { d_zone: ["v_docks"] } })]),
    ours: deck([card("c_1", { tags: { d_zone: ["v_docks", "v_market"] } })]),
    theirs: deck([card("c_1", { tags: { d_zone: [] } })]),
    expect: deck([card("c_1", { tags: { d_zone: ["v_market"] } })]),
  },
  {
    name: "outcomes are id-keyed entities: one edited, one added, clean",
    base: deck([card("c_1", { outcomes: [{ id: "o_1", gameId: "go", changes: { "@story.x": "1" } }] })]),
    ours: deck([card("c_1", { outcomes: [{ id: "o_1", gameId: "go", changes: { "@story.x": "2" } }] })]),
    theirs: deck([card("c_1", { outcomes: [
      { id: "o_1", gameId: "go", changes: { "@story.x": "1" } },
      { id: "o_2", gameId: "stay", changes: {} },
    ] })]),
    expect: deck([card("c_1", { outcomes: [
      { id: "o_1", gameId: "go", changes: { "@story.x": "2" } },
      { id: "o_2", gameId: "stay", changes: {} },
    ] })]),
  },
  {
    // The reason rule 5 grew to cover outcomes. Before it did, both sides
    // appended to the end of the list and every such pair collided.
    name: "concurrent outcome adds both land, sorted by id (rule 5, the open half)",
    base: deck([card("c_1", { outcomes: [{ id: "o_m", gameId: "mid", order: 0, changes: {} }] })]),
    ours: deck([card("c_1", { outcomes: [
      { id: "o_a", gameId: "first", order: 1, changes: {} },
      { id: "o_m", gameId: "mid", order: 0, changes: {} },
    ] })]),
    theirs: deck([card("c_1", { outcomes: [
      { id: "o_m", gameId: "mid", order: 0, changes: {} },
      { id: "o_z", gameId: "last", order: 1, changes: {} },
    ] })]),
    expect: deck([card("c_1", { outcomes: [
      { id: "o_a", gameId: "first", order: 1, changes: {} },
      { id: "o_m", gameId: "mid", order: 0, changes: {} },
      { id: "o_z", gameId: "last", order: 1, changes: {} },
    ] })]),
  },
  {
    name: "changes merge per target: different targets are clean, same target conflicts",
    base: deck([card("c_1", { outcomes: [{ id: "o_1", gameId: "go", changes: { "@story.x": "1", "@story.y": "1" } }] })]),
    ours: deck([card("c_1", { outcomes: [{ id: "o_1", gameId: "go", changes: { "@story.x": "2", "@story.y": "1" } }] })]),
    theirs: deck([card("c_1", { outcomes: [{ id: "o_1", gameId: "go", changes: { "@story.x": "3", "@story.y": "9" } }] })]),
    expect: deck([card("c_1", { outcomes: [{ id: "o_1", gameId: "go", changes: { "@story.x": "2", "@story.y": "9" } }] })]),
    expectConflicts: [["both-changed", "o_1"]],
  },
  {
    name: "a deck-gate edit and a card edit never collide",
    base: deck([card("c_1", { title: "Old" })], { condition: "" }),
    ours: deck([card("c_1", { title: "Old" })], { condition: "@story.open" }),
    theirs: deck([card("c_1", { title: "New" })], { condition: "" }),
    expect: deck([card("c_1", { title: "New" })], { condition: "@story.open" }),
  },
  // --- hands: the rename warning class -----------------------------------------
  {
    name: "a hand gameId rename merges but warns (deal() is called by name)",
    base: {
      schema: "storylets/hands@0",
      templates: [],
      hands: [{ id: "h_1", gameId: "docks-street", rule: { bindings: {}, slots: "unbounded" } }],
    },
    ours: {
      schema: "storylets/hands@0",
      templates: [],
      hands: [{ id: "h_1", gameId: "docks-street", rule: { bindings: {}, slots: "unbounded" }, slots: 5 }],
    },
    theirs: {
      schema: "storylets/hands@0",
      templates: [],
      hands: [{ id: "h_1", gameId: "harbour-street", rule: { bindings: {}, slots: "unbounded" } }],
    },
    expect: {
      schema: "storylets/hands@0",
      templates: [],
      hands: [{ id: "h_1", gameId: "harbour-street", rule: { bindings: {}, slots: "unbounded" }, slots: 5 }],
    },
    expectWarnings: 1,
  },
  {
    name: "hand templates: a hole added and a binding edited on different groups, clean",
    base: {
      schema: "storylets/hands@0",
      templates: [{ id: "t_1", gameId: "street", bindings: { d_mood: "v_calm" }, chooses: ["d_zone"], slots: 3, properties: [] }],
      hands: [],
    },
    ours: {
      schema: "storylets/hands@0",
      templates: [{ id: "t_1", gameId: "street", bindings: { d_mood: "v_calm" }, chooses: ["d_npc", "d_zone"], slots: 3, properties: [] }],
      hands: [],
    },
    theirs: {
      schema: "storylets/hands@0",
      templates: [{ id: "t_1", gameId: "street", bindings: { d_mood: "v_tense" }, chooses: ["d_zone"], slots: 3, properties: [] }],
      hands: [],
    },
    expect: {
      schema: "storylets/hands@0",
      templates: [{ id: "t_1", gameId: "street", bindings: { d_mood: "v_tense" }, chooses: ["d_npc", "d_zone"], slots: 3, properties: [] }],
      hands: [],
    },
  },
  // --- project and box shards ---------------------------------------------------
  {
    name: "project: both add story properties (name-keyed union); same default changed conflicts",
    base: {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.1.0" },
      settings: { playAdvancesTurns: 1 },
      world: { properties: [] },
      story: { properties: [{ name: "gold", type: "number", default: 0 }] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
    },
    ours: {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.1.0" },
      settings: { playAdvancesTurns: 1 },
      world: { properties: [] },
      story: { properties: [
        { name: "gold", type: "number", default: 10 },
        { name: "ours", type: "boolean", default: false },
      ] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
    },
    theirs: {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.1.0" },
      settings: { playAdvancesTurns: 1 },
      world: { properties: [] },
      story: { properties: [
        { name: "gold", type: "number", default: 99 },
        { name: "theirs", type: "boolean", default: true },
      ] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
    },
    expect: {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.1.0" },
      settings: { playAdvancesTurns: 1 },
      world: { properties: [] },
      story: { properties: [
        { name: "gold", type: "number", default: 10 },   // provisional OURS
        { name: "ours", type: "boolean", default: false },
        { name: "theirs", type: "boolean", default: true },
      ] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
    },
    expectConflicts: [["both-changed", "gold"]],
  },
  {
    name: "tags: a tag added and a property added to an existing tag, clean",
    base: {
      schema: "storylets/tags@0",
      groups: [{ id: "d_1", gameId: "zone", tags: [{ id: "v_a", gameId: "a" }] }],
    },
    ours: {
      schema: "storylets/tags@0",
      groups: [{ id: "d_1", gameId: "zone", tags: [
        { id: "v_a", gameId: "a", properties: [{ name: "danger", type: "number", default: 0 }] },
      ] }],
    },
    theirs: {
      schema: "storylets/tags@0",
      groups: [{ id: "d_1", gameId: "zone", tags: [
        { id: "v_a", gameId: "a" },
        { id: "v_b", gameId: "b" },
      ] }],
    },
    expect: {
      schema: "storylets/tags@0",
      groups: [{ id: "d_1", gameId: "zone", tags: [
        { id: "v_a", gameId: "a", properties: [{ name: "danger", type: "number", default: 0 }] },
        { id: "v_b", gameId: "b" },
      ] }],
    },
  },
  {
    name: "box: a field-type change vs an unrelated ranking edit, clean",
    base: {
      schema: "storylets/box@0",
      box: { id: "b_1", gameId: "b", ranking: { specificity: true }, fields: [{ name: "scene", type: "string", default: "" }], properties: [] },
    },
    ours: {
      schema: "storylets/box@0",
      box: { id: "b_1", gameId: "b", ranking: { specificity: false }, fields: [{ name: "scene", type: "string", default: "" }], properties: [] },
    },
    theirs: {
      schema: "storylets/box@0",
      box: { id: "b_1", gameId: "b", ranking: { specificity: true }, fields: [{ name: "scene", type: "string", default: "none" }], properties: [] },
    },
    expect: {
      schema: "storylets/box@0",
      box: { id: "b_1", gameId: "b", ranking: { specificity: false }, fields: [{ name: "scene", type: "string", default: "none" }], properties: [] },
    },
  },
  // --- the arrangement layer (design/graphical-views.md section 1.2) ----------
  // The shard that merges most, because positions churn. The promise made there
  // is exactly what these pin: two designers rearranging different things do not
  // conflict, and the same card moved by both is ONE conflict.
  {
    name: "view: two designers arrange different cards on one canvas, clean",
    base: view({ c_gate: { x: 0, y: 0 }, c_inn: { x: 200, y: 0 } }),
    ours: view({ c_gate: { x: 0, y: 120 }, c_inn: { x: 200, y: 0 } }),
    theirs: view({ c_gate: { x: 0, y: 0 }, c_inn: { x: 400, y: 0 } }),
    expect: view({ c_gate: { x: 0, y: 120 }, c_inn: { x: 400, y: 0 } }),
  },
  {
    name: "view: two designers arrange different DECKS, clean",
    base: { schema: "storylets/view@0", canvases: { k_a: { cards: { c_1: { x: 0, y: 0 } } }, k_b: { cards: { c_2: { x: 0, y: 0 } } } } },
    ours: { schema: "storylets/view@0", canvases: { k_a: { cards: { c_1: { x: 20, y: 0 } } }, k_b: { cards: { c_2: { x: 0, y: 0 } } } } },
    theirs: { schema: "storylets/view@0", canvases: { k_a: { cards: { c_1: { x: 0, y: 0 } } }, k_b: { cards: { c_2: { x: 0, y: 40 } } } } },
    expect: { schema: "storylets/view@0", canvases: { k_a: { cards: { c_1: { x: 20, y: 0 } } }, k_b: { cards: { c_2: { x: 0, y: 40 } } } } },
  },
  {
    name: "view: the same card moved by both is one conflict, not a hybrid position",
    // Taking x from one side and y from the other would place the card where
    // NEITHER designer put it. A point is atomic on purpose.
    base: view({ c_gate: { x: 0, y: 0 } }),
    ours: view({ c_gate: { x: 100, y: 0 } }),
    theirs: view({ c_gate: { x: 0, y: 100 } }),
    // Reported against the CANVAS, which is the outermost keyed entity, with the
    // card named in the conflict's path (canvases.k_1.cards.c_gate) - the same
    // convention the rest of the engine uses.
    expectConflicts: [["both-changed", "k_1"]],
    expect: view({ c_gate: { x: 100, y: 0 } }),
  },
  {
    name: "view: one designer arranges a card the other placed for the first time, clean",
    base: view({}),
    ours: view({ c_gate: { x: 20, y: 20 } }),
    theirs: view({ c_inn: { x: 220, y: 20 } }),
    expect: view({ c_gate: { x: 20, y: 20 }, c_inn: { x: 220, y: 20 } }),
  },
  // --- the map, whose key was renamed and whose merge spec was not -----------
  {
    // Until 2026-08-29 the spec still said `pins`, so `sites` fell through to
    // ATOMIC and the whole map merged as one value: two designers moving
    // DIFFERENT hands conflicted, and resolving to either side silently
    // discarded the other's move. Exactly what ViewShard's own doc promises
    // does not happen.
    name: "two designers move different sites on one map (the pin/site rename)",
    base: boxMap({ h_a: { x: 0, y: 0 }, h_b: { x: 0, y: 0 } }),
    ours: boxMap({ h_a: { x: 10, y: 0 }, h_b: { x: 0, y: 0 } }),
    theirs: boxMap({ h_a: { x: 0, y: 0 }, h_b: { x: 0, y: 20 } }),
    expect: boxMap({ h_a: { x: 10, y: 0 }, h_b: { x: 0, y: 20 } }),
  },
  {
    name: "two designers move the SAME site: a conflict, as a point is atomic",
    base: boxMap({ h_a: { x: 0, y: 0 } }),
    ours: boxMap({ h_a: { x: 10, y: 0 } }),
    theirs: boxMap({ h_a: { x: 0, y: 20 } }),
    expectConflicts: [["both-changed", "h_a"]],
  },

  // --- the comment sidecar, which had no strategy at all ---------------------
  {
    // Before 2026-08-29 this did not merge badly, it THREW: `.storyletnotes` is
    // packed, so a reviewer's return leg took the whole unpack down with it,
    // every shard, not just this one.
    name: "two reviewers add different threads: both survive",
    base: notes([thread("cmt_a", "first")]),
    ours: notes([thread("cmt_a", "first"), thread("cmt_b", "ours")]),
    theirs: notes([thread("cmt_a", "first"), thread("cmt_c", "theirs")]),
    expect: notes([thread("cmt_a", "first"), thread("cmt_b", "ours"), thread("cmt_c", "theirs")]),
  },
  {
    name: "one reviewer resolves a thread the other left alone",
    base: notes([thread("cmt_a", "first")]),
    ours: notes([thread("cmt_a", "first", { resolved: true })]),
    theirs: notes([thread("cmt_a", "first")]),
    expect: notes([thread("cmt_a", "first", { resolved: true })]),
  },
  {
    // The deliberate limitation, pinned so it is a decision rather than a
    // surprise: `CommentMessage` has no id, so a thread's `messages` list is
    // atomic and two concurrent replies ask a human instead of interleaving.
    name: "two reviewers reply to the SAME thread: a conflict, nothing lost",
    base: notes([thread("cmt_a", "first")]),
    ours: notes([{ ...thread("cmt_a", "first"), messages: [
      { author: "A", ts: "2026-08-29T10:00:00Z", body: "first" },
      { author: "A", ts: "2026-08-29T11:00:00Z", body: "ours" }] }]),
    theirs: notes([{ ...thread("cmt_a", "first"), messages: [
      { author: "A", ts: "2026-08-29T10:00:00Z", body: "first" },
      { author: "B", ts: "2026-08-29T11:30:00Z", body: "theirs" }] }]),
    expectConflicts: [["both-changed", "cmt_a"]],
  },

];

describe("merge corpus", () => {
  for (const c of corpus) {
    it(c.name, () => {
      const result = runMerge(c.base, c.ours, c.theirs);
      if (c.expect) eq(result.merged, c.expect);
      const kinds = result.conflicts.map((x): [ConflictKind, string] => [x.kind, x.id]).sort();
      expect(kinds).toEqual([...(c.expectConflicts ?? [])].sort());
      expect(result.warnings.length).toBe(c.expectWarnings ?? 0);
    });
  }
});

describe("merge algebra (over every corpus case)", () => {
  for (const c of corpus) {
    it(`${c.name}: identities hold`, () => {
      eq(runMerge(c.base, c.ours, c.base).merged, c.ours);       // only ours changed
      eq(runMerge(c.base, c.base, c.theirs).merged, c.theirs);   // only theirs changed
      eq(runMerge(c.base, c.ours, c.ours).merged, c.ours);       // same change both sides
      eq(runMerge(c.base, c.base, c.base).merged, c.base);       // no change at all
      expect(runMerge(c.base, c.ours, c.base).conflicts).toEqual([]);
      expect(runMerge(c.base, c.base, c.theirs).conflicts).toEqual([]);
    });
  }
});

describe("merge input errors", () => {
  it("schema version skew is refused (exit-2 material, never a guess)", () => {
    expect(() => runMerge(
      { schema: "storylets/deck@1", deck: {}, cards: [] },
      deck([]),
      deck([]),
    )).toThrow(MergeInputError);
  });

  it("an unknown schema is refused", () => {
    expect(() => runMerge({ schema: "nope" }, { schema: "nope" }, { schema: "nope" })).toThrow(MergeInputError);
  });
});

// ---------------------------------------------------------------------------
// Two guards over pairs of lists that must agree and had nothing holding them.
//
// From the Patter side, 2026-08-29 (`to-storylets/authoring-merge-dropped-
// fields.md`), answering a brief of ours about merge specs drifting from the
// model. Both of our own failures were exactly this shape: `.storyletnotes`
// was packed with no merge strategy, so a reviewer's return leg THREW; and the
// view spec still said `pins` eleven days after the key became `sites`, so it
// fell through to ATOMIC and silently discarded one designer's move.
//
// Their version of the second bug was worse than ours - their merger builds
// its result from a fixed key list, so an unnamed key is DELETED rather than
// merged coarsely - and the difference is exactly that ours are declarative.
// Checked before writing these: an unnamed key survives a Storylets merge,
// nested or top level, so we do not have that failure and need not guard it.
// ---------------------------------------------------------------------------

describe("the merge specs cannot drift from the model", () => {
  it("every extension a pack ships has a merge strategy", () => {
    // Their guard 1, and our `.storyletnotes` hole. `pack` walks
    // Object.values(SHARD_EXTENSIONS), and `unpack --merge` merges every shard
    // the pack carries, so a shard type with no strategy takes the whole
    // return leg down - not just its own file.
    const schemas: Record<keyof typeof SHARD_EXTENSIONS, string> = {
      project: PROJECT_SCHEMA, box: BOX_SCHEMA, tags: TAGS_SCHEMA,
      hands: HANDS_SCHEMA, deck: DECK_SCHEMA, view: VIEW_SCHEMA, notes: NOTES_SCHEMA,
    };
    // Every extension is named here, so a NEW one fails this line first.
    expect(Object.keys(schemas).sort()).toEqual(Object.keys(SHARD_EXTENSIONS).sort());
    for (const [kind, schema] of Object.entries(schemas)) {
      expect(() => detectMergeType({ schema }), `${kind} (${schema}) has no merge type`).not.toThrow();
    }
  });

  it("every key a merge spec names is a field the model actually has", () => {
    // Their guard 2, in the stronger form they said our declarative specs
    // allow: read the model's own interfaces rather than a copy of the field
    // list, so a rename there that is forgotten here fails HERE.
    //
    // Necessary, not sufficient: a spec key that happens to match some other
    // interface's field passes. It still catches the whole class we hit, where
    // the old name survives nowhere but the spec.
    // EVERY model source, not just index.ts: NotesShard lives in comments.ts,
    // and a guard that reads one file reports the others as orphans.
    const modelDir = fileURLToPath(new URL("../../model/src/", import.meta.url));
    const model = readdirSync(modelDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(modelDir, f), "utf8"))
      .join("\n");
    // Declared property names only. A prose mention will not do: ours said
    // "Called `pins` until 2026-08-10" in a comment three lines above the
    // renamed field, so anything looser passes the exact bug it is here for.
    const declared = new Set(
      [...model.matchAll(/^\s{2,}(\w+)\??:/gm)].map((m) => m[1]!));
    expect(declared.size).toBeGreaterThan(50);   // not a vacuous set

    const keys = new Set<string>();
    const walk = (strategy: unknown): void => {
      if (typeof strategy !== "object" || strategy === null) return;
      const s = strategy as { kind?: string; fields?: Record<string, unknown>; of?: unknown };
      if (s.kind === "object" && s.fields) {
        for (const [name, child] of Object.entries(s.fields)) { keys.add(name); walk(child); }
      }
      if (s.of !== undefined) walk(s.of);
    };
    for (const spec of Object.values(MERGE_SPECS)) walk(spec);
    expect(keys.size).toBeGreaterThan(10);       // not a vacuous set

    const orphans = [...keys].filter((k) => !declared.has(k)).sort();
    expect(orphans, "merge spec names fields the model does not have").toEqual([]);
  });
});
