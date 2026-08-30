// ---------------------------------------------------------------------------
// The influence graph. Expectations hand-written from the design
// (design/graphical-views.md sections 0 and 1.3), not read off the
// implementation: each case says what a designer should be told and why.
//
// Note on where this lives: the conformance corpus is the cross-RUNTIME parity
// contract, and influence analysis is authoring-side only, like coverage and
// merge. So it is pinned here, in ops, with hand-written expectations - the
// contract-first rule applied to the layer it belongs in.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { SourceProject } from "@storylet-studio/compiler";
import type { Card, PropertyDecl } from "@storylet-studio/model";
import { analyseInfluence, cardNeighbourhood, describeContribution } from "../src/influence.js";
import type { EdgeClass, InfluenceGraph } from "../src/influence.js";

interface Fix {
  world?: PropertyDecl[];
  story?: PropertyDecl[];
  boxProps?: PropertyDecl[];
  deckProps?: PropertyDecl[];
  /** The hand's own properties: @hand names must be declared to resolve. */
  handProps?: PropertyDecl[];
  /** A second deck, to pin container scoping and cross-deck behaviour. */
  deckB?: Partial<Card<string>>[];
  deckBGate?: string;
  gate?: string;
  cards: Partial<Card<string>>[];
}

const card = (c: Partial<Card<string>>): Card<string> => ({
  // The remaining underscores become hyphens: a gameId is an ADDRESS and the
  // format allows only lower case, digits and hyphens, so "c_wants_not" has to
  // derive "wants-not" and not "wants_not". The compiler's gameId check found
  // this fixture minting an illegal one (2026-08-15).
  id: "c_x", gameId: (c.id ?? "c_x").replace(/^c_/, "").replace(/_/g, "-"), priority: 0, redraw: "always",
  outcomes: [], ...c,
});

const project = (f: Fix): SourceProject => ({
  path: "p.storyletproj",
  project: {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    settings: { playAdvancesTurns: 1 },
    world: { properties: f.world ?? [] },
    story: { properties: f.story ?? [] },
    templates: {},
    export: { bundle: "d.storyletsc", metadata: "full" },
  },
  boxes: [{
    path: "b",
    box: {
      schema: "storylets/box@0",
      box: { id: "b_1", gameId: "b1", ranking: { specificity: true }, fields: [], properties: f.boxProps ?? [] },
    },
    tags: { schema: "storylets/tags@0", groups: [] },
    hands: {
      schema: "storylets/hands@0", templates: [],
      hands: [{
        id: "h_all", gameId: "all", rule: { bindings: {}, slots: "unbounded" },
        // @hand is typed now (design/hand-typing.md), so a hand reference has
        // to be declared somewhere before a fixture may use it.
        properties: f.handProps ?? [],
      }],
    },
    decks: [
      {
        path: "b/decks/a.storyletdeck",
        shard: {
          schema: "storylets/deck@0",
          deck: { id: "k_a", gameId: "a", properties: f.deckProps ?? [], ...(f.gate ? { condition: f.gate } : {}) },
          cards: f.cards.map(card),
        },
      },
      ...(f.deckB
        ? [{
            path: "b/decks/b.storyletdeck",
            shard: {
              schema: "storylets/deck@0" as const,
              deck: { id: "k_b", gameId: "bb", properties: f.deckProps ?? [], ...(f.deckBGate ? { condition: f.deckBGate } : {}) },
              cards: f.deckB.map(card),
            },
          }]
        : []),
    ],
  }],
});

/** The class of the edge between two cards, or undefined for no edge. */
const edge = (g: InfluenceGraph, from: string, to: string): EdgeClass | undefined =>
  g.edges.find((e) => e.from === from && e.to === to)?.cls;

const via = (g: InfluenceGraph, from: string, to: string): string[] =>
  g.edges.find((e) => e.from === from && e.to === to)?.via.map((v) => v.property) ?? [];

const setter = (id: string, target: string, value: string, condition?: string): Partial<Card<string>> => ({
  id, ...(condition ? { condition } : {}),
  outcomes: [{ id: `o_${id}`, gameId: "do", changes: { [target]: value } }],
});

describe("enable and disable: the load-bearing pair", () => {
  it("a boolean set true enables a card that wants it true", () => {
    const g = analyseInfluence(project({
      story: [{ name: "done", type: "boolean", default: false }],
      cards: [setter("c_w", "@story.done", "true"), { id: "c_r", condition: "@story.done" }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("enable");
    expect(via(g, "c_w", "c_r")).toEqual(["@story.done"]);
  });

  it("the same write DISABLES a card that wants it false", () => {
    // `not @story.done` wants false, so setting true shuts the reader.
    const g = analyseInfluence(project({
      story: [{ name: "done", type: "boolean", default: false }],
      cards: [setter("c_w", "@story.done", "true"), { id: "c_r", condition: "not @story.done" }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("disable");
  });

  it("a raise enables a want-more and disables a want-less", () => {
    const g = analyseInfluence(project({
      story: [{ name: "gold", type: "number", default: 0 }],
      cards: [
        setter("c_w", "@story.gold", "@story.gold + 5"),
        { id: "c_rich", condition: "@story.gold >= 10" },
        { id: "c_poor", condition: "@story.gold < 3" },
      ],
    }));
    expect(edge(g, "c_w", "c_rich")).toBe("enable");
    expect(edge(g, "c_w", "c_poor")).toBe("disable");
  });

  it("a fall reverses both", () => {
    const g = analyseInfluence(project({
      story: [{ name: "gold", type: "number", default: 0 }],
      cards: [
        setter("c_w", "@story.gold", "@story.gold - 5"),
        { id: "c_rich", condition: "@story.gold >= 10" },
        { id: "c_poor", condition: "@story.gold < 3" },
      ],
    }));
    expect(edge(g, "c_w", "c_rich")).toBe("disable");
    expect(edge(g, "c_w", "c_poor")).toBe("enable");
  });

  it("a not around a threshold reverses what the card wants", () => {
    // `not (@story.gold >= 10)` wants gold BELOW 10, so a raise shuts it and a
    // fall opens it. Missed by the first version of this suite: `not` was only
    // tested against a bare boolean, and a mutation that ignored polarity for
    // thresholds passed everything.
    const fix = (condition: string) => project({
      story: [{ name: "gold", type: "number", default: 0 }],
      cards: [
        setter("c_up", "@story.gold", "@story.gold + 5"),
        setter("c_down", "@story.gold", "@story.gold - 5"),
        { id: "c_r", condition },
      ],
    });
    const g = analyseInfluence(fix("not (@story.gold >= 10)"));
    expect(edge(g, "c_up", "c_r")).toBe("disable");
    expect(edge(g, "c_down", "c_r")).toBe("enable");
    // And the plain form is the mirror image, which is what makes it a flip.
    const plain = analyseInfluence(fix("@story.gold >= 10"));
    expect(edge(plain, "c_up", "c_r")).toBe("enable");
    expect(edge(plain, "c_down", "c_r")).toBe("disable");
  });

  it("a not around an equality reverses it too", () => {
    const g = analyseInfluence(project({
      world: [{ name: "cls", type: "string", default: "mage" }],
      cards: [setter("c_w", "@world.cls", '"thief"'), { id: "c_r", condition: 'not (@world.cls == "thief")' }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("disable");
  });

  it("reads the threshold from whichever side the property is on", () => {
    // `10 <= @story.gold` wants gold HIGH, exactly as `@story.gold >= 10` does.
    const g = analyseInfluence(project({
      story: [{ name: "gold", type: "number", default: 0 }],
      cards: [setter("c_w", "@story.gold", "@story.gold + 5"), { id: "c_r", condition: "10 <= @story.gold" }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("enable");
  });

  it("a literal set is judged against the threshold it lands on", () => {
    const g = analyseInfluence(project({
      story: [{ name: "gold", type: "number", default: 0 }],
      cards: [
        setter("c_rich", "@story.gold", "50"),
        setter("c_broke", "@story.gold", "1"),
        { id: "c_r", condition: "@story.gold >= 10" },
      ],
    }));
    expect(edge(g, "c_rich", "c_r")).toBe("enable");
    expect(edge(g, "c_broke", "c_r")).toBe("disable");
  });

  it("matches a string equality, and reverses for inequality", () => {
    const g = analyseInfluence(project({
      world: [{ name: "cls", type: "string", default: "mage" }],
      cards: [
        setter("c_w", "@world.cls", '"thief"'),
        { id: "c_eq", condition: '@world.cls == "thief"' },
        { id: "c_neq", condition: '@world.cls != "thief"' },
      ],
    }));
    expect(edge(g, "c_w", "c_eq")).toBe("enable");
    expect(edge(g, "c_w", "c_neq")).toBe("disable");
  });
});

describe("case in property names", () => {
  // The expression parser FOLDS every property reference to lower case, while
  // declarations are keyed verbatim by both the compiler and the runtime (which
  // passes an explicit identity normaliser to StateBag). So a capitalised
  // declaration could never be referenced by anything, and the compiler now says
  // so at the DECLARATION rather than at every use.
  //
  // Which is why this analysis lowercases the names it extracts and must keep
  // doing so: it is compensating for the parser, not inventing a rule. Removing
  // the fold - which looked like the obvious fix - breaks every capitalised
  // reference instead. See the note in `influence.ts`.

  it("refuses a capitalised declaration, and says why", () => {
    const g = analyseInfluence(project({
      story: [{ name: "isNight", type: "boolean", default: true }],
      cards: [{ id: "c_r", condition: "@story.isNight" }],
    }));
    const errs = g.issues.filter((i) => i.severity === "error").map((i) => i.message);
    expect(errs.some((m) => /property name "isNight" cannot be used/.test(m))).toBe(true);
    // And it explains the mechanism rather than just forbidding it.
    expect(errs.some((m) => /would look for "isnight" and find nothing/.test(m))).toBe(true);
    expect(errs.some((m) => /Try "isnight"/.test(m))).toBe(true);
  });

  // The rule widened on 2026-08-18 from case alone to the whole identifier grammar,
  // shared with Patter through app-shell's default (property-names.ts). Case was
  // never the only way to write a name the language cannot reach, and the hyphen is
  // the one that matters: it is not an error anywhere, it is a SUBTRACTION.
  it("refuses every name the expression grammar cannot reach, and names the fault", () => {
    const faults: Array<[string, RegExp]> = [
      ["is-night", /subtraction/],
      ["is night", /only lower case letters, digits and underscores/],
      ["9lives", /cannot start with a digit/],
      ["not", /keyword/],
    ];
    for (const [name, why] of faults) {
      const g = analyseInfluence(project({ story: [{ name, type: "boolean", default: true }], cards: [] }));
      const errs = g.issues.filter((i) => i.severity === "error").map((i) => i.message);
      expect(errs.some((m) => m.includes(`property name "${name}" cannot be used`)), name).toBe(true);
      expect(errs.some((m) => why.test(m)), name).toBe(true);
    }
  });

  it("accepts an underscored name, which is what the coercion offers", () => {
    const g = analyseInfluence(project({
      story: [{ name: "is_night", type: "boolean", default: true }],
      cards: [{ id: "c_r", condition: "@story.is_night" }],
    }));
    expect(g.issues.filter((i) => /cannot be used/.test(i.message))).toEqual([]);
  });

  it("is quiet about an all-lowercase declaration", () => {
    const g = analyseInfluence(project({
      story: [{ name: "isnight", type: "boolean", default: true }],
      cards: [setter("c_w", "@story.isnight", "true"), { id: "c_r", condition: "@story.isnight" }],
    }));
    expect(g.issues.filter((i) => /cannot be used/.test(i.message))).toEqual([]);
    expect(edge(g, "c_w", "c_r")).toBe("enable");
  });

  it("a reference may still be written in any case, since the parser folds it", () => {
    // The fold is the reason the declaration rule exists; it also means an author
    // who types @story.IsNight against a lowercase declaration is fine.
    const g = analyseInfluence(project({
      story: [{ name: "isnight", type: "boolean", default: true }],
      cards: [setter("c_w", "@story.isnight", "true"), { id: "c_r", condition: "@story.IsNight" }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("enable");
  });
});

describe("flags", () => {
  it("matches a flag delta to a flag want, by sign", () => {
    const g = analyseInfluence(project({
      story: [{ name: "visited", type: "flags", default: [], values: ["docks", "market"] }],
      cards: [
        setter("c_w", "@story.visited", "set_flags(@story.visited, +docks)"),
        { id: "c_wants", condition: "check_flags(@story.visited, +docks)" },
        { id: "c_wants_not", condition: "check_flags(@story.visited, -docks)" },
      ],
    }));
    expect(edge(g, "c_w", "c_wants")).toBe("enable");
    expect(edge(g, "c_w", "c_wants_not")).toBe("disable");
  });

  it("a not around a flag check flips the sign it wants", () => {
    const g = analyseInfluence(project({
      story: [{ name: "visited", type: "flags", default: [], values: ["docks", "market"] }],
      cards: [
        setter("c_w", "@story.visited", "set_flags(@story.visited, +docks)"),
        { id: "c_r", condition: "not check_flags(@story.visited, +docks)" },
      ],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("disable");
  });

  it("a different flag in the same property is NOT an edge", () => {
    // The property matches but the axis does not: reporting this would be noise.
    const g = analyseInfluence(project({
      story: [{ name: "visited", type: "flags", default: [], values: ["docks", "market"] }],
      cards: [
        setter("c_w", "@story.visited", "set_flags(@story.visited, +docks)"),
        { id: "c_r", condition: "check_flags(@story.visited, +market)" },
      ],
    }));
    expect(edge(g, "c_w", "c_r")).toBeUndefined();
  });

  it("carries the flag name on the edge, so the UI can say which one", () => {
    const g = analyseInfluence(project({
      story: [{ name: "visited", type: "flags", default: [], values: ["docks", "market"] }],
      cards: [
        setter("c_w", "@story.visited", "set_flags(@story.visited, +docks, -market)"),
        { id: "c_r", condition: "check_flags(@story.visited, +docks)" },
      ],
    }));
    expect(g.edges.find((e) => e.from === "c_w" && e.to === "c_r")!.via[0]!.flag).toBe("docks");
  });
});

describe("influence: the honest shrug", () => {
  it("a nudge against an exact value is influence, not a direction", () => {
    // +1 may or may not land on 7; claiming enable or disable would be a lie.
    const g = analyseInfluence(project({
      story: [{ name: "gold", type: "number", default: 0 }],
      cards: [setter("c_w", "@story.gold", "@story.gold + 1"), { id: "c_r", condition: "@story.gold == 7" }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("influence");
  });

  it("a computed write is influence, and says so in a warning", () => {
    const g = analyseInfluence(project({
      story: [{ name: "gold", type: "number", default: 0 }, { name: "rep", type: "number", default: 0 }],
      cards: [setter("c_w", "@story.gold", "@story.rep * 2"), { id: "c_r", condition: "@story.gold >= 10" }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("influence");
    expect(g.warnings.some((w) => w.kind === "computed-value")).toBe(true);
  });

  it("a read inside arithmetic is influence", () => {
    const g = analyseInfluence(project({
      story: [{ name: "gold", type: "number", default: 0 }, { name: "tax", type: "number", default: 1 }],
      cards: [setter("c_w", "@story.tax", "3"), { id: "c_r", condition: "@story.gold - @story.tax > 2" }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("influence");
  });
});

describe("what counts as a read", () => {
  it("an outcome gate is a read, noted as one", () => {
    const g = analyseInfluence(project({
      story: [{ name: "done", type: "boolean", default: false }],
      cards: [
        setter("c_w", "@story.done", "true"),
        { id: "c_r", outcomes: [{ id: "o_g", gameId: "go", condition: "@story.done", changes: {} }] },
      ],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("enable");
    expect(g.edges.find((e) => e.to === "c_r")!.via[0]!.note).toBe("through an outcome gate");
  });

  it("an expression priority is a read", () => {
    const g = analyseInfluence(project({
      story: [{ name: "gold", type: "number", default: 0 }],
      cards: [setter("c_w", "@story.gold", "5"), { id: "c_r", priority: "@story.gold" }],
    }));
    expect(edge(g, "c_w", "c_r")).toBe("influence");   // a priority wants no particular value
    expect(g.edges.find((e) => e.to === "c_r")!.via[0]!.note).toBe("through the priority");
  });

  it("a deck gate reaches every card in the deck", () => {
    // A shut gate hides the whole deck, so a write that opens it enables all
    // of them - the strongest edge the analyser can offer.
    const g = analyseInfluence(project({
      story: [{ name: "open", type: "boolean", default: false }],
      gate: "@story.open",
      cards: [{ id: "c_one" }, { id: "c_two" }],
      deckB: [setter("c_w", "@story.open", "true")],
    }));
    expect(edge(g, "c_w", "c_one")).toBe("enable");
    expect(edge(g, "c_w", "c_two")).toBe("enable");
    expect(via(g, "c_w", "c_one")).toEqual(["@story.open"]);
    expect(g.edges.find((e) => e.to === "c_one")!.via[0]!.note).toBe("through the deck gate");
  });
});

describe("container scopes", () => {
  it("@deck joins within a deck and NOT across decks", () => {
    // @deck.heat in deck A and @deck.heat in deck B are different properties;
    // an edge between them would be a fiction.
    const g = analyseInfluence(project({
      deckProps: [{ name: "heat", type: "number", default: 0 }],
      cards: [setter("c_w", "@deck.heat", "5"), { id: "c_same", condition: "@deck.heat >= 3" }],
      deckB: [{ id: "c_other", condition: "@deck.heat >= 3" }],
    }));
    expect(edge(g, "c_w", "c_same")).toBe("enable");
    expect(edge(g, "c_w", "c_other")).toBeUndefined();
  });

  it("@box joins across decks in the same box", () => {
    const g = analyseInfluence(project({
      boxProps: [{ name: "alarm", type: "boolean", default: false }],
      cards: [setter("c_w", "@box.alarm", "true")],
      deckB: [{ id: "c_other", condition: "@box.alarm" }],
    }));
    expect(edge(g, "c_w", "c_other")).toBe("enable");
  });

  // Two mechanisms keep @hand out, and both are deliberate: the explicit skip
  // (which is also what makes the warning fire) and the fact that a hand ref
  // resolves to no container, which sameProperty then refuses. A mutation
  // removing either one alone still produces no edges, so this test pins the
  // WARNING as much as the absence.
  it("@hand is not analysed, and says so once rather than guessing", () => {
    const g = analyseInfluence(project({
      story: [{ name: "x", type: "number", default: 0 }],
      handProps: [{ name: "danger", type: "number", default: 0 }],
      cards: [
        { id: "c_w", outcomes: [{ id: "o", gameId: "go", changes: { "@hand.danger": "5" } }] },
        { id: "c_r", condition: "@hand.danger >= 3" },
      ],
    }));
    expect(g.edges).toEqual([]);
    expect(g.warnings.filter((w) => w.kind === "hand-scope-not-analysed")).toHaveLength(1);
  });
});

describe("the graph itself", () => {
  it("aggregates parallel edges into one, carrying every reason", () => {
    const g = analyseInfluence(project({
      story: [{ name: "a", type: "boolean", default: false }, { name: "b", type: "boolean", default: false }],
      cards: [
        { id: "c_w", outcomes: [{ id: "o", gameId: "go", changes: { "@story.a": "true", "@story.b": "true" } }] },
        { id: "c_r", condition: "@story.a and @story.b" },
      ],
    }));
    const enables = g.edges.filter((e) => e.from === "c_w" && e.to === "c_r" && e.cls === "enable");
    expect(enables).toHaveLength(1);
    expect(enables[0]!.via.map((v) => v.property).sort()).toEqual(["@story.a", "@story.b"]);
  });

  it("keeps enable and disable as separate edges between the same pair", () => {
    // One write helps a card, another hinders it: both facts matter.
    const g = analyseInfluence(project({
      story: [{ name: "a", type: "boolean", default: false }, { name: "b", type: "boolean", default: false }],
      cards: [
        { id: "c_w", outcomes: [{ id: "o", gameId: "go", changes: { "@story.a": "true", "@story.b": "true" } }] },
        { id: "c_r", condition: "@story.a and not @story.b" },
      ],
    }));
    expect(edge(g, "c_w", "c_r")).toBeDefined();
    const classes = g.edges.filter((e) => e.from === "c_w" && e.to === "c_r").map((e) => e.cls).sort();
    expect(classes).toEqual(["disable", "enable"]);
  });

  it("never draws a card onto itself", () => {
    const g = analyseInfluence(project({
      story: [{ name: "n", type: "number", default: 0 }],
      cards: [setter("c_self", "@story.n", "@story.n + 1", "@story.n >= 1")],
    }));
    expect(g.edges.filter((e) => e.from === e.to)).toEqual([]);
  });

  it("counts by class and sorts deterministically", () => {
    const g = analyseInfluence(project({
      story: [{ name: "done", type: "boolean", default: false }],
      cards: [
        setter("c_w", "@story.done", "true"),
        { id: "c_a", condition: "@story.done" },
        { id: "c_b", condition: "not @story.done" },
      ],
    }));
    expect(g.countsByClass.enable).toBe(1);
    expect(g.countsByClass.disable).toBe(1);
    expect(JSON.stringify(g)).toBe(JSON.stringify(analyseInfluence(project({
      story: [{ name: "done", type: "boolean", default: false }],
      cards: [
        setter("c_w", "@story.done", "true"),
        { id: "c_a", condition: "@story.done" },
        { id: "c_b", condition: "not @story.done" },
      ],
    }))));
  });

  it("reference edges are off unless asked for", () => {
    const fix: Fix = {
      world: [{ name: "raining", type: "boolean", default: false }],
      cards: [{ id: "c_a", condition: "@world.raining" }, { id: "c_b", condition: "@world.raining" }],
    };
    expect(analyseInfluence(project(fix)).edges).toEqual([]);
    const withRefs = analyseInfluence(project(fix), { includeReference: true });
    expect(withRefs.countsByClass.reference).toBe(1);
    expect(edge(withRefs, "c_a", "c_b")).toBe("reference");
  });

  it("a property somebody writes is not a reference", () => {
    const g = analyseInfluence(project({
      story: [{ name: "done", type: "boolean", default: false }],
      cards: [
        setter("c_w", "@story.done", "true"),
        { id: "c_a", condition: "@story.done" },
        { id: "c_b", condition: "@story.done" },
      ],
    }), { includeReference: true });
    expect(g.countsByClass.reference).toBe(0);
  });
});

describe("scope", () => {
  const twoDecks: Fix = {
    story: [{ name: "done", type: "boolean", default: false }],
    cards: [setter("c_w", "@story.done", "true"), { id: "c_same", condition: "@story.done" }],
    deckB: [{ id: "c_other", condition: "@story.done" }],
  };

  it("a deck scope analyses that deck only", () => {
    const g = analyseInfluence(project(twoDecks), { scope: { kind: "deck", deck: "k_a" } });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["c_same", "c_w"]);
    expect(edge(g, "c_w", "c_same")).toBe("enable");
    expect(edge(g, "c_w", "c_other")).toBeUndefined();
  });

  it("a deck scope takes a gameId as readily as an id", () => {
    const byGameId = analyseInfluence(project(twoDecks), { scope: { kind: "deck", deck: "a" } });
    expect(byGameId.nodes.map((n) => n.id).sort()).toEqual(["c_same", "c_w"]);
  });

  it("a box scope spans its decks", () => {
    const g = analyseInfluence(project(twoDecks), { scope: { kind: "box", box: "b_1" } });
    expect(g.nodes).toHaveLength(3);
    expect(edge(g, "c_w", "c_other")).toBe("enable");
  });

  it("an empty scope warns rather than pretending", () => {
    const g = analyseInfluence(project(twoDecks), { scope: { kind: "deck", deck: "k_nope" } });
    expect(g.nodes).toEqual([]);
    expect(g.warnings.some((w) => w.kind === "no-cards")).toBe(true);
  });

  it("a card scope analyses everything and marks the focus", () => {
    // The relationship view's question crosses decks, so the pivot must not
    // narrow the graph the way a deck scope does.
    const g = analyseInfluence(project(twoDecks), { scope: { kind: "card", card: "c_w" } });
    expect(g.focusCard).toBe("c_w");
    expect(g.nodes).toHaveLength(3);
    expect(edge(g, "c_w", "c_other")).toBe("enable");
  });
});

describe("the neighbourhood (the relationship view's shape)", () => {
  it("splits one card's immediate predecessors from its dependents", () => {
    const n = cardNeighbourhood(project({
      story: [
        { name: "opened", type: "boolean", default: false },
        { name: "closed", type: "boolean", default: false },
      ],
      cards: [
        setter("c_before", "@story.opened", "true"),
        setter("c_mid", "@story.closed", "true", "@story.opened"),
      ],
      deckB: [{ id: "c_after", condition: "@story.closed" }],
    }), "c_mid");

    expect(n.card?.id).toBe("c_mid");
    expect(n.predecessors.map((p) => p.node?.id)).toEqual(["c_before"]);
    expect(n.dependents.map((d) => d.node?.id)).toEqual(["c_after"]);
    expect(n.predecessors[0]!.edge.cls).toBe("enable");
  });

  it("is empty but valid for an unknown card", () => {
    const n = cardNeighbourhood(project({ cards: [{ id: "c_a" }] }), "c_ghost");
    expect(n.card).toBeUndefined();
    expect(n.predecessors).toEqual([]);
    expect(n.dependents).toEqual([]);
  });
});

describe("broken input", () => {
  it("reports compile issues and returns an empty graph rather than throwing", () => {
    const g = analyseInfluence(project({ cards: [{ id: "c_a", condition: "@story.nope >= " }] }));
    expect(g.issues.some((i) => i.severity === "error")).toBe(true);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe("describeContribution: the one phrasing both surfaces use", () => {
  it("names the property, the writing outcome, and any caveat, in that order", () => {
    expect(describeContribution({ property: "@story.gold", scope: "story", name: "gold", outcome: "accepted" }))
      .toBe("@story.gold by accepted");
    expect(describeContribution({
      property: "@story.visited", scope: "story", name: "visited", flag: "docks",
      outcome: "arrive", note: "through the deck gate",
    })).toBe("@story.visited (docks) by arrive through the deck gate");
  });

  it("says only what it knows", () => {
    // A reference edge has no writing outcome, so nothing is invented for it.
    expect(describeContribution({ property: "@world.raining", scope: "world", name: "raining" }))
      .toBe("@world.raining");
  });
});
