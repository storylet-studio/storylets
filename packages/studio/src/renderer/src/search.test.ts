// The Cmd+K matcher: the index covers every navigable target; matching is
// subsequence with label-hit ranking.

import { describe, expect, it } from "vitest";
import { searchIndex, searchMatch } from "./search.js";
import type { ProjectDto } from "../../shared/api.js";

const project: ProjectDto = {
  dir: "/p", name: "Saltmarsh", threads: {}, storyPropertyCount: 0, play: "solo",
  boxes: [{
    id: "b_1", gameId: "encounters", ranking: { specificity: true }, fields: [], properties: [],
    decks: [{
      id: "k_docks", gameId: "docks", title: "Docks", gate: "@world.raining", properties: [],
      cards: [
        { id: "c_1", gameId: "ambush-at-the-ford", title: "Ambush at the ford", condition: "@world.danger >= 2", priority: 2, redraw: "5", tags: [], copies: "", sharedCopies: "", fields: [], outcomes: [] },
        {
          id: "c_2", gameId: "rat-job", title: "A rat job", priority: 1, redraw: "always", tags: [], copies: "", sharedCopies: "", fields: [],
          outcomes: [{ id: "o_1", gameId: "accepted", changes: ["@story.reputation ← @story.reputation + 1"] }],
        },
      ],
    }],
    templates: [{ id: "t_1", gameId: "street-hands", bindings: ["zone = ?"], slots: "3", instances: 1 }],
    tagGroups: [{ id: "d_1", gameId: "zone", values: ["docks", "market"] }],
    hands: [{ id: "h_1", gameId: "docks-street", template: "street-hands", slots: 2, tags: {} }],
  }],
};

describe("Cmd+K search", () => {
  const index = searchIndex(project);

  it("indexes decks, cards, templates, hands and tag groups as items", () => {
    expect(index.map((h) => h.kind).sort()).toEqual(["card", "card", "deck", "hand", "tagGroup", "template"]);
  });

  it("finds a card by a fuzzy subsequence of its title", () => {
    const hits = searchMatch(index, "ambush");
    expect(hits[0]!.label).toBe("Ambush at the ford");
    expect(hits[0]!.selection).toEqual({ kind: "card", box: "b_1", deck: "k_docks", card: "c_1" });
  });

  it("finds a hand template by gameId", () => {
    const hits = searchMatch(index, "street");
    expect(hits.some((h) => h.kind === "template" && h.label === "street-hands")).toBe(true);
  });

  it("a hand's sublabel names its template (or standalone)", () => {
    const hand = index.find((h) => h.kind === "hand")!;
    expect(hand.sublabel).toContain("street-hands");
  });

  it("ranks a label hit above an only-sublabel hit", () => {
    // "docks" is a deck label and also appears in the ambush card's sublabel.
    const hits = searchMatch(index, "docks");
    expect(hits[0]!.kind).toBe("deck");
  });

  it("empty query lists everything (capped)", () => {
    expect(searchMatch(index, "")).toHaveLength(index.length);
  });
});

describe("property-usage search (a query beginning with @)", () => {
  const index = searchIndex(project);

  it("finds the card whose condition reads the ref", () => {
    const hits = searchMatch(index, "@world.danger");
    expect(hits.map((h) => h.label)).toEqual(["Ambush at the ford"]);
  });

  it("finds a deck by its gate, and a card by what its outcome writes", () => {
    expect(searchMatch(index, "@world.raining").map((h) => h.label)).toEqual(["Docks"]);
    expect(searchMatch(index, "@story.reputation").map((h) => h.label)).toEqual(["A rat job"]);
  });

  it("matches literally, not fuzzily: a ref is an address, not a half-remembered name", () => {
    // Subsequence matching would let "@wd" reach "@world.danger"; it must not.
    expect(searchMatch(index, "@wd")).toEqual([]);
    expect(searchMatch(index, "@world.nothing")).toEqual([]);
  });

  it("does not fall back to name matching, so a clean ref query returns only usages", () => {
    // No item is NAMED "@world.danger", and nothing else reads it.
    expect(searchMatch(index, "@world.danger")).toHaveLength(1);
  });
});
