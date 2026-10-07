// Group by on the card views (card-groups.ts): which options a box offers, and
// what goes under each heading. Pure, so the rules are pinned here rather than
// read off a screenshot.

import { describe, expect, it } from "vitest";
import { alsoUnder, boxEntries, groupEntries, groupOptions, hasPlaces, resolveGroup } from "./card-groups.js";
import type { BoxDto, CardDto } from "../../shared/api.js";

const card = (id: string, tags: CardDto["tags"] = []): CardDto => ({
  id, gameId: id, priority: 0, redraw: "always", tags, copies: "", sharedCopies: "", fields: [], outcomes: [],
});

/** A village: two decks, a map, two sites, a thread group. */
const village: BoxDto = {
  id: "b_v", gameId: "village", folder: "village", ranking: { specificity: true }, fields: [], outcomeFields: [], properties: [], templates: [],
  usesMap: true,
  decks: [
    { id: "k_a", gameId: "ambients", title: "Ambients", properties: [], cards: [
      card("inn-only", [{ group: "place", values: ["inn"] }]),
      card("two-places", [{ group: "place", values: ["inn", "well"] }, { group: "thread", values: ["market"] }]),
      card("in-square", [{ group: "district", values: ["square"] }, { group: "thread", values: ["market", "treasure"] }]),
      card("loose"),
    ] },
    { id: "k_b", gameId: "arrival", properties: [], cards: [card("arrive", [{ group: "thread", values: ["treasure"] }])] },
    { id: "k_c", gameId: "empty", properties: [], cards: [] },
  ],
  tagGroups: [
    { id: "g_t", gameId: "thread", values: ["treasure", "market"] },
    { id: "g_map", gameId: "district", values: ["square", "edge"], spatial: true, placeAxis: true },
  ],
  hands: [
    { id: "h_w", gameId: "well", title: "The Wishing Well", tags: { district: "square" } },
    { id: "h_i", gameId: "inn", title: "The Inn", tags: { district: "square" } },
  ],
};

/** A conversation box: hands chosen by npc, no map, no card naming a hand. */
const talk: BoxDto = {
  id: "b_t", gameId: "conversations", folder: "conversations", ranking: { specificity: true }, fields: [], outcomeFields: [], properties: [],
  templates: [{ id: "t_1", gameId: "talk", bindings: ["npc = ?"], slots: "3", instances: 2 }],
  decks: [{ id: "k_t", gameId: "topics", properties: [], cards: [
    card("rumour", [{ group: "npc", values: ["gareth", "mira"] }]),
    card("shoulder", [{ group: "npc", values: ["gareth"] }]),
    card("weather"),
  ] }],
  tagGroups: [{ id: "g_npc", gameId: "npc", values: ["gareth", "mira"], placeAxis: true }],
  hands: [
    { id: "h_g", gameId: "talk-gareth", template: "talk", tags: { npc: "gareth" } },
    { id: "h_m", gameId: "talk-mira", template: "talk", tags: { npc: "mira" } },
  ],
};

const labels = (box: BoxDto, key: string): [string, string[]][] =>
  groupEntries(box, boxEntries(box), key).map((g) => [g.label, g.entries.map((e) => e.card.id)]);

describe("the options", () => {
  it("leads with Deck on a box and on a deck alike, then Hand, then every group by name", () => {
    expect(groupOptions(village, "contents").map((o) => o.label)).toEqual(["Deck", "Hand", "thread", "district"]);
    expect(groupOptions(village, "deck").map((o) => o.label)).toEqual(["Deck", "Hand", "thread", "district"]);
    // The deck page's first option keeps its stored key, so a remembered choice carries over.
    expect(groupOptions(village, "deck")[0]!.key).toBe("none");
  });

  it("offers a chosen group by its own name and no Hand when that is the only where", () => {
    // Mock-up screen 5b: Deck | npc. Hand would only repeat npc under another name.
    expect(hasPlaces(talk)).toBe(false);
    expect(groupOptions(talk, "contents").map((o) => o.label)).toEqual(["Deck", "npc"]);
  });

  it("falls back to the default when the remembered choice is no longer offered", () => {
    expect(resolveGroup(talk, "contents", "place")).toBe("deck");
    expect(resolveGroup(talk, "deck", "tag:g_gone")).toBe("none");
    expect(resolveGroup(talk, "deck", "tag:g_npc")).toBe("tag:g_npc");
    expect(resolveGroup(talk, "contents", undefined)).toBe("deck");
  });
});

describe("the headings", () => {
  it("by deck: deck order, empty decks left out", () => {
    expect(labels(village, "deck")).toEqual([
      ["Ambients", ["inn-only", "two-places", "in-square", "loose"]],
      ["arrival", ["arrive"]],
    ]);
  });

  it("by a tag group: the group's order, a card under each value, Untagged last", () => {
    expect(labels(village, "tag:g_t")).toEqual([
      ["treasure", ["in-square", "arrive"]],
      ["market", ["two-places", "in-square"]],
      ["Untagged", ["inn-only", "loose"]],
    ]);
  });

  it("by place: sites in hand order, then anywhere in each zone, then anywhere", () => {
    expect(labels(village, "place")).toEqual([
      ["The Wishing Well", ["two-places"]],
      ["The Inn", ["inn-only", "two-places"]],
      ["Anywhere in square", ["in-square"]],
      ["Anywhere", ["loose", "arrive"]],
    ]);
    const site = groupEntries(village, boxEntries(village), "place")[0]!;
    expect(site.sub).toBe("square");
    expect(site.go).toEqual({ kind: "hand", hand: "h_w" });
  });

  it("by npc: also under the other value, Untagged last", () => {
    const groups = groupEntries(talk, boxEntries(talk), "tag:g_npc");
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.card.id)])).toEqual([
      ["gareth", ["rumour", "shoulder"]],
      ["mira", ["rumour"]],
      ["Untagged", ["weather"]],
    ]);
    const also = alsoUnder(groups);
    expect(also("rumour", groups[0]!.key)).toEqual(["mira"]);
    expect(also("rumour", groups[1]!.key)).toEqual(["gareth"]);
    expect(also("shoulder", groups[0]!.key)).toEqual([]);
  });

  it("under Place, a card answered only by a chosen group is not called Anywhere", () => {
    // A box with both: a site some card names, and npc chosen by a template.
    const mixed: BoxDto = {
      ...talk,
      decks: [{ ...talk.decks[0]!, cards: [...talk.decks[0]!.cards, card("at-gareth", [{ group: "place", values: ["talk-gareth"] }])] }],
    };
    expect(hasPlaces(mixed)).toBe(true);
    const groups = groupEntries(mixed, boxEntries(mixed), "place");
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.card.id)])).toEqual([
      ["talk-gareth", ["at-gareth"]],
      ["By npc", ["rumour", "shoulder"]],
      ["Anywhere", ["weather"]],
    ]);
    expect(groups[1]!.go).toEqual({ kind: "group", key: "tag:g_npc" });
  });

  it("none is one heading-less group", () => {
    expect(groupEntries(talk, boxEntries(talk), "none")).toEqual([
      { key: "all", label: "", entries: boxEntries(talk) },
    ]);
  });
});

describe("grouping by a place axis by name", () => {
  it("files a card placed at a hand under the hand's zone when it names none itself", () => {
    // The theme park review, round 3: a contract standing at a site in a
    // district was "Untagged" under Group by district.
    expect(labels(village, "tag:g_map")).toEqual([
      ["square", ["inn-only", "two-places", "in-square"]],
      ["Untagged", ["loose", "arrive"]],
    ]);
  });

  it("files a moving hand's card under every zone it can be in", () => {
    const moving: BoxDto = {
      ...village,
      hands: [...village.hands, { id: "h_c", gameId: "courier", tags: {}, moving: { district: ["square", "edge"] } }],
      decks: [{ id: "k_m", gameId: "m", properties: [], cards: [card("courier-card", [{ group: "place", values: ["courier"] }])] }],
    };
    expect(labels(moving, "tag:g_map")).toEqual([["square", ["courier-card"]], ["edge", ["courier-card"]]]);
  });
});
