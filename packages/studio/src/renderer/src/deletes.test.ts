// @vitest-environment jsdom
// Deletes guard by evidence (the October 2026 review, section 2): ask when the
// thing holds something, not otherwise, in words that name the object and say
// it can be undone; and the menus promise a question only when one follows.

import { describe, expect, it } from "vitest";
import { boxConfirm, cardsConfirm, deleteLabel, handConfirm, templateConfirm } from "./deletes.js";
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

describe("deleteLabel", () => {
  it("names the object, with an ellipsis only when a question follows", () => {
    expect(deleteLabel("card", true)).toBe("Delete card…");
    expect(deleteLabel("tag group", false)).toBe("Delete tag group");
  });
});

describe("the evidence", () => {
  it("cards: asks only when one has content, and names one card by its title", () => {
    expect(cardsConfirm([card()])).toBeUndefined();
    const one = cardsConfirm([card({ title: "The gate" })])!;
    expect(one.title).toBe('Delete "The gate"?');
    expect(one.body).toMatch(/You can undo this\.$/);
    expect(one.confirmLabel).toBe("Delete card");
    const three = cardsConfirm([card(), card({ id: "c_2", purpose: "Words" }), card({ id: "c_3" })])!;
    expect(three.title).toBe("Delete 3 cards?");
    expect(three.body).toBe("1 of them has content. You can undo this.");
  });

  it("a box: asks when it has decks or hands", () => {
    expect(boxConfirm(box())).toBeUndefined();
    expect(boxConfirm(box({ decks: [deck([card()])] }))!.body).toContain("1 deck, 1 card and 0 hands");
    expect(boxConfirm(box({ hands: [{ id: "h_1", gameId: "the-well", tags: {} }] }))).toBeDefined();
  });

  it("a hand template: asks when hands are of its kind", () => {
    const t = (instances: number): TemplateDto => ({ id: "t_1", gameId: "people", title: "People", bindings: [], slots: "3", instances });
    expect(templateConfirm(t(0))).toBeUndefined();
    expect(templateConfirm(t(2))!.body).toBe("2 hands are of this kind, and lose their template. You can undo this.");
  });

  it("a hand: asks when it has a pin on the map", () => {
    expect(handConfirm({ gameId: "the-well" }, false)).toBeUndefined();
    expect(handConfirm({ gameId: "the-well", title: "The well" }, true)!.title).toBe('Delete "The well"?');
  });
});
