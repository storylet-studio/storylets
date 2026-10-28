// @vitest-environment jsdom
// A deck keeps its colour when renamed (Ian's ruling, 2026-10-28): a deck's
// stored slot (DeckDto `colour`, which its first rename stores from the old
// title's hash) wins over its title's hash on a card face's deck chip. A deck
// with none is coloured by its title, as before. Tags stay hashed. The node
// canvas's stripe is node-art.test.ts's (Konva wants no jsdom).

import { describe, expect, it, vi } from "vitest";
import { hashColour } from "@wildwinter/app-shell";
import { renderBoxCentre, type ViewActions } from "./views.js";
import { setDocTab } from "./inspector.js";
import type { BoxDto, DeckDto } from "../../shared/api.js";

// Two names that hash to different slots, so a kept colour is visible.
const OLD = "Docks";
const NEW = ["Harbour", "Waterfront", "Quays", "Wharf"].find((n) => hashColour(n) !== hashColour(OLD))!;

describe("a deck's chip on a card face", () => {
  const deck = (title: string, colour?: number): DeckDto => ({
    id: "k_1", gameId: "docks", title, properties: [], ...(colour !== undefined ? { colour } : {}),
    cards: [{ id: "c_1", gameId: "ambush", title: "Ambush", priority: 0, redraw: "never", tags: [{ group: "zone", values: ["market"] }], sharedCopies: "", fields: [], outcomes: [] }],
  });
  const box = (d: DeckDto): BoxDto => ({
    id: "b_1", gameId: "box", folder: "box", ranking: { specificity: true }, fields: [], outcomeFields: [], properties: [], decks: [d],
    templates: [], tagGroups: [{ id: "d_1", gameId: "zone", values: ["market"] }], hands: [],
  });
  const actions = {
    openThreads: () => 0, focus: vi.fn(), selectCard: vi.fn(), inspectCard: vi.fn(), deckCatalogue: () => [],
    // Grouped by the tag group, so each card names its deck.
    cardGroup: () => "tag:d_1", setCardGroup: vi.fn(), newDeck: vi.fn(), newCard: vi.fn(),
  } as unknown as ViewActions;
  /** The dots on the one card face's chips: the deck's, then its tags'. */
  const dots = (d: DeckDto): string[] => {
    const host = document.createElement("div");
    setDocTab("box:b_1", "contents");
    renderBoxCentre(host, box(d), () => {}, actions);
    return [...host.querySelectorAll<HTMLElement>(".scard .chips .pill i")].map((i) => i.style.background);
  };

  it("keeps the old title's colour once renamed, and the tags stay hashed", () => {
    const [deckDot, tagDot] = dots(deck(NEW, hashColour(OLD)));
    expect(deckDot).toBe(`var(--char-${hashColour(OLD)})`);
    expect(tagDot).toBe(`var(--char-${hashColour("market")})`);
  });

  it("is the title's hash for a deck with none stored", () => {
    expect(dots(deck(OLD))[0]).toBe(`var(--char-${hashColour(OLD)})`);
    expect(dots(deck(NEW))[0]).toBe(`var(--char-${hashColour(NEW)})`);
  });
});
