// @vitest-environment jsdom
// Reading a problem (problems.ts): the names the bar speaks it in, the card tab
// a shard field lives on, where a jump lands, and what the topbar chip says.
// All pure, so the bar's behaviour is pinned here without a window.

import { describe, expect, it } from "vitest";
import { cardTabFor, problemChip, problemNames, problemTarget } from "./problems.js";
import type { BoxDto, DeckDto, Problem } from "../../shared/api.js";

const deck: DeckDto = {
  id: "k_1", gameId: "docks", title: "Docks", properties: [],
  cards: [{
    id: "c_1", gameId: "ambush", title: "Ambush at the ford", condition: "", priority: 0, redraw: "never",
    tags: [], copies: "", sharedCopies: "", fields: [],
    outcomes: [{ id: "o_1", gameId: "flee", changes: [], fields: [] }],
  }],
};
const box: BoxDto = {
  id: "b_1", gameId: "harbour", ranking: { specificity: true }, fields: [], outcomeFields: [], properties: [], decks: [deck],
  templates: [{ id: "t_1", gameId: "street-hands", title: "Streets", bindings: [], slots: "3", instances: 1 }],
  tagGroups: [{ id: "g_1", gameId: "zone", values: ["docks", "market"] }],
  hands: [{ id: "h_1", gameId: "docks-street", title: "Docks street", slots: 2, tags: {} }],
};
const other: BoxDto = { ...box, id: "b_2", gameId: "news", title: "News", decks: [], templates: [], tagGroups: [], hands: [] };
const boxes = [box, other];

const problem = (path: string, over: Partial<Problem> = {}): Problem =>
  ({ severity: "error", path, message: "something is wrong", ...over });

describe("the names a problem is spoken in", () => {
  it("names a card by its title, in its deck", () => {
    expect(problemNames(problem("harbour/decks/docks.storyletdeck", { where: "ambush" }), boxes))
      .toEqual({ title: "Ambush at the ford", where: "Docks" });
  });

  it("names an outcome, in its card (the slash form)", () => {
    expect(problemNames(problem("harbour/decks/docks.storyletdeck", { where: "ambush/flee" }), boxes))
      .toEqual({ title: "flee", where: "Ambush at the ford" });
  });

  it("names a deck in its box when no card is named", () => {
    expect(problemNames(problem("harbour/decks/docks.storyletdeck"), boxes)).toEqual({ title: "Docks", where: "harbour" });
  });

  it("names a hand template or a hand from the hands shard", () => {
    expect(problemNames(problem("harbour/hands.storylethands", { where: "street-hands" }), boxes)).toEqual({ where: "harbour", title: "Streets" });
    expect(problemNames(problem("harbour/hands.storylethands", { where: "docks-street" }), boxes)).toEqual({ where: "harbour", title: "Docks street" });
    expect(problemNames(problem("harbour/hands.storylethands", { where: "gone" }), boxes)).toEqual({ where: "harbour", title: "gone" });
  });

  it("names a tag in its group, or a group in its box", () => {
    expect(problemNames(problem("harbour/tags.storylettags", { where: "zone/docks" }), boxes)).toEqual({ title: "docks", where: "zone" });
    expect(problemNames(problem("harbour/tags.storylettags", { where: "zone" }), boxes)).toEqual({ where: "harbour", title: "zone" });
  });

  it("names the box for its own shard and its map, and Project settings for the project file", () => {
    expect(problemNames(problem("news/box.storyletbox"), boxes)).toEqual({ title: "News" });
    expect(problemNames(problem("news/map"), boxes)).toEqual({ title: "News" });
    expect(problemNames(problem("saltmarsh.storyletproj"), boxes)).toEqual({ where: "Project settings" });
    expect(problemNames(problem("elsewhere/readme.txt"), boxes)).toBeUndefined();
  });
});

describe("which card tab holds a shard field", () => {
  it("sends each field to its tab, and leaves the rest alone", () => {
    for (const f of ["condition", "priority", "copies", "sharedCopies", "tags"]) expect(cardTabFor(f)).toBe("dealing");
    expect(cardTabFor("fields")).toBe("fields");
    expect(cardTabFor("changes")).toBe("outcomes");
    expect(cardTabFor("outcomeFields")).toBe("outcomes");
    expect(cardTabFor("title")).toBeUndefined();
    expect(cardTabFor(undefined)).toBeUndefined();
  });
});

describe("where a problem takes the author", () => {
  it("lands inside a card, on the tab its field is on", () => {
    expect(problemTarget(problem("harbour/decks/docks.storyletdeck", { where: "ambush", field: "condition" }), boxes))
      .toEqual({ kind: "card", box: "b_1", deck: "k_1", card: "c_1", tab: "dealing" });
    // An unknown field keeps the remembered tab.
    expect(problemTarget(problem("harbour/decks/docks.storyletdeck", { where: "ambush", field: "title" }), boxes))
      .toEqual({ kind: "card", box: "b_1", deck: "k_1", card: "c_1" });
  });

  it("opens an outcome it names, on the Outcomes tab", () => {
    expect(problemTarget(problem("harbour/decks/docks.storyletdeck", { where: "ambush/flee" }), boxes))
      .toEqual({ kind: "card", box: "b_1", deck: "k_1", card: "c_1", tab: "outcomes", outcome: "o_1" });
  });

  it("falls back to the deck when the card is not found", () => {
    expect(problemTarget(problem("harbour/decks/docks.storyletdeck", { where: "nobody" }), boxes))
      .toEqual({ kind: "deck", box: "b_1", deck: "k_1" });
  });

  it("opens a hand template, a hand, or the box's tab for the hands and tags shards", () => {
    expect(problemTarget(problem("harbour/hands.storylethands", { where: "street-hands" }), boxes)).toEqual({ kind: "template", box: "b_1", template: "t_1" });
    expect(problemTarget(problem("harbour/hands.storylethands", { where: "docks-street" }), boxes)).toEqual({ kind: "hand", box: "b_1", hand: "h_1" });
    expect(problemTarget(problem("harbour/hands.storylethands"), boxes)).toEqual({ kind: "boxTab", box: "b_1", tab: "templates" });
    expect(problemTarget(problem("harbour/tags.storylettags", { where: "zone" }), boxes)).toEqual({ kind: "tagGroup", box: "b_1", group: "g_1" });
    expect(problemTarget(problem("harbour/tags.storylettags", { where: "nope" }), boxes)).toEqual({ kind: "boxTab", box: "b_1", tab: "tags" });
  });

  it("sends a box shard to its Card template, the project file to Settings, anything else to the box", () => {
    expect(problemTarget(problem("news/box.storyletbox"), boxes)).toEqual({ kind: "boxTemplate", box: "b_2" });
    expect(problemTarget(problem("saltmarsh.storyletproj"), boxes)).toEqual({ kind: "settings" });
    expect(problemTarget(problem("news/map"), boxes)).toEqual({ kind: "box", box: "b_2" });
  });

  it("has nowhere to go in a project with no boxes", () => {
    expect(problemTarget(problem("saltmarsh.storyletproj"), [])).toBeUndefined();
  });
});

describe("the topbar's health chip", () => {
  it("is a quiet tick when the project is clean", () => {
    expect(problemChip([])).toEqual({ className: "probstat ok", tip: "No problems" });
  });

  it("counts, in the worst severity's colour, and says a click steps through them", () => {
    const warn = problem("x", { severity: "warning" });
    expect(problemChip([warn])).toEqual({ className: "probstat warn", count: 1, tip: "1 problem. Click to step through them." });
    expect(problemChip([warn, problem("y")])).toEqual({ className: "probstat err", count: 2, tip: "2 problems. Click to step through them." });
  });
});
