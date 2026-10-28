// Resolving a merge's clashes (step 6, ruling Q21): every shard here is a REAL
// merged shard, made by `runMerge` and written as `planShardMerge` writes it, so
// the paths and the mark are exactly what a pack merge or a pull leaves behind.

import { describe, expect, it } from "vitest";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { unresolvedOf } from "@wildwinter/toolkit/extensions";
import { runMerge } from "../src/merge.js";
import { ResolutionError, applyResolutions, clashesOf, parseClashPath } from "../src/clashes.js";

type Obj = Record<string, unknown>;

const deck = (cards: Obj[], deckFields: Obj = {}): Obj => ({
  schema: "storylets/deck@0",
  deck: { id: "k_1", gameId: "main", properties: [], ...deckFields },
  cards,
});
const card = (id: string, fields: Obj = {}): Obj => ({
  id, gameId: id.replace(/^c_/, ""), priority: 0, redraw: "always", outcomes: [], order: 0, ...fields,
});

/** Merge three sides and answer the merged shard's text, as a pack merge writes it. */
const merged = (base: Obj, ours: Obj, theirs: Obj): string => canonicalStringify(runMerge(base, ours, theirs).merged);
const read = (text: string): Obj => parseSource(text) as Obj;
const cardsOf = (text: string): Obj[] => read(text)["cards"] as Obj[];

describe("parseClashPath", () => {
  it("reads fields, keyed items, map keys and an order", () => {
    expect(parseClashPath("cards[c_1].outcomes[o_2].changes.trust")?.steps).toEqual([
      { kind: "key", name: "cards" }, { kind: "item", key: "c_1" }, { kind: "key", name: "outcomes" },
      { kind: "item", key: "o_2" }, { kind: "key", name: "changes" }, { kind: "key", name: "trust" },
    ]);
    expect(parseClashPath(".k_1.cards")?.steps).toEqual([{ kind: "key", name: "k_1" }, { kind: "key", name: "cards" }]);
    expect(parseClashPath("deck.properties:order")).toEqual({
      steps: [{ kind: "key", name: "deck" }, { kind: "key", name: "properties" }], order: true,
    });
    expect(parseClashPath("")).toBeUndefined();
    expect(parseClashPath("cards[c_1")).toBeUndefined();
  });
});

describe("a card field both sides changed", () => {
  const base = deck([card("c_1", { priority: 1 })]);
  const text = merged(base, deck([card("c_1", { priority: 2 })]), deck([card("c_1", { priority: 3 })]));

  it("is listed from the shard's mark, settable, with both sides", () => {
    expect(clashesOf(read(text))).toEqual([{
      path: "cards[c_1].priority", kind: "both-changed", base: 1, ours: 2, theirs: 3, settable: true,
    }]);
  });

  it("ours keeps our value and clears the mark", () => {
    const out = applyResolutions(text, { "cards[c_1].priority": "ours" });
    expect(cardsOf(out)[0]!["priority"]).toBe(2);
    expect(unresolvedOf(read(out))).toBeUndefined();
  });

  it("theirs sets their value and clears the mark", () => {
    const out = applyResolutions(text, { "cards[c_1].priority": "theirs" });
    expect(cardsOf(out)[0]!["priority"]).toBe(3);
    expect(unresolvedOf(read(out))).toBeUndefined();
  });

  it("resolved keeps a hand edit made since the merge", () => {
    const edited = canonicalStringify({ ...read(text), cards: [card("c_1", { priority: 7 })] });
    const out = applyResolutions(edited, { "cards[c_1].priority": "resolved" });
    expect(cardsOf(out)[0]!["priority"]).toBe(7);
    expect(unresolvedOf(read(out))).toBeUndefined();
  });

  it("answers canonical text", () => {
    const out = applyResolutions(text, { "cards[c_1].priority": "theirs" });
    expect(out).toBe(canonicalStringify(read(out)));
  });
});

describe("several clashes in one shard", () => {
  const base = deck([card("c_1", { priority: 1, title: "A" }), card("c_2", { priority: 1, order: 1 })]);
  const ours = deck([card("c_1", { priority: 2, title: "Ours" }), card("c_2", { priority: 2, order: 1 })]);
  const theirs = deck([card("c_1", { priority: 3, title: "Theirs" }), card("c_2", { priority: 3, order: 1 })]);
  const text = merged(base, ours, theirs);

  it("clears only the entries decided, keeping the rest", () => {
    expect(clashesOf(read(text)).map((c) => c.path).sort()).toEqual([
      "cards[c_1].priority", "cards[c_1].title", "cards[c_2].priority",
    ]);
    const out = applyResolutions(text, { "cards[c_1].title": "theirs", "cards[c_2].priority": "ours" });
    expect(cardsOf(out)[0]!["title"]).toBe("Theirs");
    expect(cardsOf(out)[1]!["priority"]).toBe(2);
    expect(unresolvedOf(read(out))?.map((e) => e.path)).toEqual(["cards[c_1].priority"]);
  });

  it("refuses a path the mark doesn't hold, applying nothing", () => {
    expect(() => applyResolutions(text, { "cards[c_1].title": "theirs", "cards[c_9].title": "ours" }))
      .toThrow(ResolutionError);
  });
});

describe("a card one side deleted and the other edited", () => {
  const base = deck([card("c_1", { priority: 1 }), card("c_2", { order: 1 })]);

  it("theirs deleted it: taking theirs removes the card", () => {
    const text = merged(base, deck([card("c_1", { priority: 5 }), card("c_2", { order: 1 })]), deck([card("c_2", { order: 1 })]));
    const [clash] = clashesOf(read(text));
    expect(clash).toMatchObject({ path: "cards[c_1]", kind: "delete-vs-edit", settable: true });
    expect(clash!.theirs).toBeUndefined();
    const out = applyResolutions(text, { "cards[c_1]": "theirs" });
    expect(cardsOf(out).map((c) => c["id"])).toEqual(["c_2"]);
    expect(unresolvedOf(read(out))).toBeUndefined();
  });

  it("we deleted it: taking theirs brings their edit back", () => {
    const text = merged(base, deck([card("c_2", { order: 1 })]), deck([card("c_1", { priority: 9 }), card("c_2", { order: 1 })]));
    expect(cardsOf(text).map((c) => c["id"])).toEqual(["c_2"]);
    const out = applyResolutions(text, { "cards[c_1]": "theirs" });
    expect(cardsOf(out).map((c) => [c["id"], c["priority"]])).toEqual([["c_1", 9], ["c_2", 0]]);
  });
});

describe("an outcome's change both sides set", () => {
  const outcome = (v: number): Obj => ({ id: "o_1", gameId: "win", changes: { "@story.trust": `${v}` } });
  const base = deck([card("c_1", { outcomes: [outcome(1)] })]);
  const text = merged(base, deck([card("c_1", { outcomes: [outcome(2)] })]), deck([card("c_1", { outcomes: [outcome(3)] })]));

  it("walks the keyed outcome and the open map, whose key holds a dot", () => {
    const [clash] = clashesOf(read(text));
    expect(clash).toMatchObject({ path: "cards[c_1].outcomes[o_1].changes.@story.trust", settable: true });
    const out = applyResolutions(text, { [clash!.path]: "theirs" });
    const o = ((cardsOf(out)[0]!["outcomes"] as Obj[])[0]!);
    expect(o["changes"]).toEqual({ "@story.trust": "3" });
  });
});

describe("the order of a declaration list both sides moved", () => {
  const p = (name: string): Obj => ({ name, type: "number" });
  const base = deck([], { properties: [p("a"), p("b"), p("c")] });
  const text = merged(base, deck([], { properties: [p("b"), p("a"), p("c")] }), deck([], { properties: [p("a"), p("c"), p("b")] }));

  it("is settable, and theirs reorders the list", () => {
    const [clash] = clashesOf(read(text));
    expect(clash).toMatchObject({ path: "deck.properties:order", kind: "both-changed", settable: true });
    const out = applyResolutions(text, { "deck.properties:order": "theirs" });
    expect(((read(out)["deck"] as Obj)["properties"] as Obj[]).map((d) => d["name"])).toEqual(["a", "c", "b"]);
  });
});

describe("a project's @story declaration both sides changed", () => {
  const project = (dflt: number): Obj => ({
    schema: "storylets/project@0",
    project: { id: "p_1", title: "P" },
    story: { properties: [{ name: "trust", type: "number", default: dflt }] },
  });
  const text = merged(project(0), project(1), project(2));

  it("takes their default", () => {
    const [clash] = clashesOf(read(text));
    expect(clash).toMatchObject({ path: "story.properties[trust].default", ours: 1, theirs: 2, settable: true });
    const out = applyResolutions(text, { "story.properties[trust].default": "theirs" });
    expect((((read(out)["story"] as Obj)["properties"] as Obj[])[0]!)["default"]).toBe(2);
  });
});

describe("a comment thread's message both sides edited", () => {
  const notes = (body: string, resolved?: boolean): Obj => ({
    schema: "storylets/notes@0",
    comments: [{ id: "t_1", anchor: "c_1", ...(resolved ? { resolved } : {}), messages: [{ author: "Ann", ts: "2026-10-01T10:00:00Z", body }] }],
  });
  const text = merged(notes("Hello"), notes("Hello, ours"), notes("Hello, theirs"));

  it("finds the message by author and time and takes theirs", () => {
    const [clash] = clashesOf(read(text));
    expect(clash).toMatchObject({ path: "comments[t_1].messages[Ann|2026-10-01T10:00:00Z]", settable: true });
    const out = applyResolutions(text, { [clash!.path]: "theirs" });
    const thread = (read(out)["comments"] as Obj[])[0]!;
    expect((thread["messages"] as Obj[])[0]!["body"]).toBe("Hello, theirs");
  });
});

describe("clashes that can't take their side", () => {
  it("a structural clash resolves as ours, never theirs", () => {
    const shard = { ...deck([card("c_1")]), unresolved: [{ path: "cards", kind: "structural", ours: "x", theirs: "y" }] };
    const text = canonicalStringify(shard);
    expect(clashesOf(read(text))[0]!.settable).toBe(false);
    expect(() => applyResolutions(text, { cards: "theirs" })).toThrow(ResolutionError);
    expect(unresolvedOf(read(applyResolutions(text, { cards: "ours" })))).toBeUndefined();
  });

  it("a clash inside a card that has since gone can't be set", () => {
    const base = deck([card("c_1", { priority: 1 })]);
    const text = merged(base, deck([card("c_1", { priority: 2 })]), deck([card("c_1", { priority: 3 })]));
    const gone = canonicalStringify({ ...read(text), cards: [] });
    expect(clashesOf(read(gone))[0]!.settable).toBe(false);
    expect(unresolvedOf(read(applyResolutions(gone, { "cards[c_1].priority": "resolved" })))).toBeUndefined();
  });
});
