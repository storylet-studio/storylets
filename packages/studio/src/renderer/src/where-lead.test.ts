// @vitest-environment jsdom
// The card's Where sentence, which leads its Dealing tab in any box with a
// place axis (inspector.ts `whereLead`). A group that is not the map's zones
// reads as the hand page's tier does: "wherever npc is gareth or mira", not
// "npc: gareth or npc: mira", which was a list of labels, not English.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCardWorkspace } from "./inspector.js";
import { setPlayRung } from "./play-ladder.js";
import type { InspectorHost } from "./inspector.js";
import type { BoxDto, CardDto, DeckDto } from "../../shared/api.js";

const card = (tags: CardDto["tags"]): CardDto => ({
  id: "c_1", gameId: "rumour", title: "A rumour", condition: "", priority: "", redraw: "",
  tags, copies: "", sharedCopies: "", fields: [], outcomes: [],
});
const box = (c: CardDto): BoxDto => {
  const deck: DeckDto = { id: "k_1", gameId: "topics", title: "Topics", properties: [], cards: [c] };
  return {
    id: "b_1", gameId: "talk", ranking: { specificity: true },
    fields: [], outcomeFields: [], properties: [], decks: [deck], templates: [],
    tagGroups: [
      { id: "g_npc", gameId: "npc", values: ["gareth", "mira"], placeAxis: true },
      { id: "g_mood", gameId: "mood", values: ["calm"], placeAxis: true },
    ],
    hands: [{ id: "h_g", gameId: "talking-to-gareth", title: "Talking to Gareth", tags: { npc: "gareth" } }],
  };
};

const host = (): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(),
  saveCard: vi.fn(), saveDeck: vi.fn(), saveDeckConfig: vi.fn(),
  deleteCard: vi.fn(), deleteDeck: vi.fn(),
  saveBox: vi.fn(), saveBoxIdentity: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(),
  createTemplate: vi.fn(), deleteTemplate: vi.fn(), createTagGroup: vi.fn(), createMap: vi.fn(),
  deleteTagGroup: vi.fn(), setGroupSpatial: vi.fn(), createHand: vi.fn(), deleteHand: vi.fn(),
  handCards: async () => null, deckCatalogue: async () => [], openCardFromHand: vi.fn(), newCardAtHand: vi.fn(), openHand: vi.fn(),
} as InspectorHost);

const sentence = (c: CardDto): string => {
  const b = box(c);
  const centre = document.createElement("div");
  renderCardWorkspace(centre, b, b.decks[0]!, c, [], host());
  // The words are spaced by the sentence's own layout (a flex gap), so read
  // them as the eye does: each word or chip, one space between.
  const words = (e: Element): string[] =>
    e.classList.contains("chip") || e.children.length === 0 ? [e.textContent ?? ""] : [...e.children].flatMap(words);
  return words(centre.querySelector(".where-sentence")!).join(" ").replace(/ ,/g, ",").replace(/\s+/g, " ").trim();
};

beforeEach(() => setPlayRung("solo"));

describe("the Where sentence for a group that is not the map's zones", () => {
  it("reads as English: wherever npc is gareth or mira", () => {
    expect(sentence(card([{ group: "npc", values: ["gareth", "mira"] }]))).toBe("Comes up wherever npc is gareth or mira, always.");
  });

  it("gives each group its own clause, joined by and", () => {
    expect(sentence(card([{ group: "npc", values: ["gareth"] }, { group: "mood", values: ["calm"] }])))
      .toBe("Comes up wherever npc is gareth and wherever mood is calm, always.");
  });

  it("keeps a hand as 'at' it", () => {
    expect(sentence(card([{ group: "place", values: ["talking-to-gareth"] }]))).toBe("Comes up at Talking to Gareth, always.");
  });
});
