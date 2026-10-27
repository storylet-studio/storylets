// @vitest-environment jsdom
// Deletes report, with Undo (the October 2026 review: Undo replaces "Are you
// sure?"): the report names the object and says what went with it, and the
// menus carry no ellipsis, since no question follows.

import { describe, expect, it } from "vitest";
import { boxReport, cardsReport, deckReport, deleteLabel, handReport, leftMapReport, templateReport } from "./deletes.js";
import type { BoxDto, CardDto, DeckDto, TemplateDto } from "../../shared/api.js";

const card = (over: Partial<CardDto> = {}): CardDto => ({
  id: "c_1", gameId: "new-card", title: "New card", priority: "0", redraw: "always",
  tags: [], copies: "", sharedCopies: "", fields: [],
  outcomes: [{ id: "o_1", gameId: "continue", title: "Continue", changes: [], fields: [] }],
  ...over,
});
const deck = (cards: CardDto[]): DeckDto => ({ id: "k_1", gameId: "arrival", title: "Arrival", properties: [], cards });
const box = (over: Partial<BoxDto> = {}): BoxDto => ({
  id: "b_1", gameId: "village", folder: "village", title: "The village", ranking: { specificity: true },
  fields: [], outcomeFields: [], properties: [], decks: [], templates: [], tagGroups: [], hands: [],
  ...over,
});
const hand = { id: "h_1", gameId: "the-well", tags: {} };

describe("deleteLabel", () => {
  it("names the object, with no ellipsis, since a delete no longer asks", () => {
    expect(deleteLabel("card")).toBe("Delete card");
    expect(deleteLabel("tag group")).toBe("Delete tag group");
  });

  it("keeps the house rule for a delete that would ask", () => {
    expect(deleteLabel("card", true)).toBe("Delete card…");
  });
});

describe("the reports", () => {
  it("cards: one by its title, several by their count", () => {
    expect(cardsReport([card({ title: "The gate" })])).toBe("Deleted “The gate”.");
    expect(cardsReport([card({ title: undefined })])).toBe("Deleted “new-card”.");
    expect(cardsReport([card(), card({ id: "c_2" }), card({ id: "c_3" })])).toBe("Deleted 3 cards.");
  });

  it("a deck: says its cards went with it", () => {
    expect(deckReport(deck([]))).toBe("Deleted “Arrival”.");
    expect(deckReport(deck([card()]))).toBe("Deleted “Arrival”.\nIts card went with it.");
    expect(deckReport(deck([card(), card({ id: "c_2" })]))).toBe("Deleted “Arrival”.\nIts 2 cards went with it.");
  });

  it("a box: says what it held, with the Oxford comma", () => {
    expect(boxReport(box())).toBe("Deleted “The village”.");
    expect(boxReport(box({ decks: [deck([card()])] }))).toBe("Deleted “The village”.\nIts 1 deck and 1 card went with it.");
    expect(boxReport(box({ decks: [deck([card(), card({ id: "c_2" })])], hands: [hand] })))
      .toBe("Deleted “The village”.\nIts 1 deck, 2 cards, and 1 hand went with it.");
    expect(boxReport(box({ hands: [hand] }))).toBe("Deleted “The village”.\nIts 1 hand went with it.");
  });

  it("a hand template: says which hands have none now", () => {
    const t = (instances: number): TemplateDto => ({ id: "t_1", gameId: "people", title: "People", bindings: [], slots: "3", instances });
    expect(templateReport(t(0))).toBe("Deleted “People”.");
    expect(templateReport(t(1))).toBe("Deleted “People”.\n1 hand of its kind has no template now.");
    expect(templateReport(t(2))).toBe("Deleted “People”.\n2 hands of its kind have no template now.");
  });

  it("a hand: says its pin went, when it had one", () => {
    expect(handReport({ gameId: "the-well" }, false)).toBe("Deleted “the-well”.");
    expect(handReport({ gameId: "the-well", title: "The well" }, true)).toBe("Deleted “The well”.\nIts pin on the map went with it.");
  });

  it("leaving the map: says how many places went", () => {
    expect(leftMapReport({ gameId: "codex", title: "Codex" }, 1)).toBe("Took “Codex” off the project map.\nIts hand's place on the map went with it.");
    expect(leftMapReport({ gameId: "codex" }, 3)).toBe("Took “codex” off the project map.\nIts 3 hands' places on the map went with it.");
  });

  it("asks nothing and says nothing of undo: the toast's button is the undo", () => {
    for (const text of [cardsReport([card()]), deckReport(deck([card()])), boxReport(box({ hands: [hand] }))]) {
      expect(text).not.toMatch(/\?|undo/i);
    }
  });
});
