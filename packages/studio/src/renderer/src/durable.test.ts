// @vitest-environment jsdom
// Durable on a card and on a deck (design/engine-server.md 4.2), and what the
// play ladder (4.10) draws at each rung. Both pages are pure DOM, so the
// visibility rule and the three-state are checked here rather than left to a
// launch.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderCardWorkspace, renderDeckTabBody } from "./inspector.js";
import type { InspectorHost } from "./inspector.js";
import { setPlayRung } from "./play-ladder.js";
import type { BoxDto, CardDto, DeckDto } from "../../shared/api.js";

const oneShot: CardDto = {
  id: "c_1", gameId: "the-well", title: "The well", condition: "", priority: "0", redraw: "never",
  tags: [], copies: "", sharedCopies: "", fields: [], outcomes: [{ id: "o_1", gameId: "done", changes: [] }],
};
const deck: DeckDto = { id: "k_1", gameId: "main", properties: [], cards: [oneShot] };
const box: BoxDto = {
  id: "b_1", gameId: "street", ranking: { specificity: true },
  fields: [], properties: [], decks: [deck], templates: [], tagGroups: [], hands: [],
};

const host = (over: Partial<InspectorHost> = {}): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(),
  saveCard: vi.fn(), saveDeck: vi.fn(), saveDeckConfig: vi.fn(),
  deleteCard: vi.fn(), deleteDeck: vi.fn(),
  saveBox: vi.fn(), saveBoxIdentity: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(),
  createTemplate: vi.fn(), deleteTemplate: vi.fn(), createTagGroup: vi.fn(), createMap: vi.fn(),
  deleteTagGroup: vi.fn(), setGroupSpatial: vi.fn(), createHand: vi.fn(), deleteHand: vi.fn(),
  ...over,
} as InspectorHost);

/** The card's Dealing tab, where both axes live. */
const dealing = (card: CardDto, pile: DeckDto = deck, h = host()): HTMLElement => {
  const centre = document.createElement("div");
  renderCardWorkspace(centre, { ...box, decks: [pile] }, pile, card, [], h);
  [...centre.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Dealing"))?.click();
  return centre;
};

afterEach(() => setPlayRung("solo"));

describe("the card page, rung by rung", () => {
  it("a solo project says nothing about sharing or durability", () => {
    setPlayRung("solo");
    const text = dealing(oneShot).textContent ?? "";
    expect(text).not.toContain("Shared across playthroughs");
    expect(text).not.toContain("Durable");
    // Absent, not greyed: there is no control to read past at all.
    expect(text).toContain("Redraw");
  });

  it("a shared world shows Shared and not Durable", () => {
    setPlayRung("shared");
    const text = dealing(oneShot).textContent ?? "";
    expect(text).toContain("Shared across playthroughs");
    expect(text).not.toContain("Durable");
  });

  it("a venue shows both, and Durable only where there is a spend to carry", () => {
    setPlayRung("venue");
    expect(dealing(oneShot).textContent).toContain("Durable");
    // Any other redraw means nothing past the run, and the compiler says so,
    // so the page does not offer a setting that would earn a warning.
    expect(dealing({ ...oneShot, redraw: "5" }).textContent).not.toContain("Durable");
    expect(dealing({ ...oneShot, redraw: "always" }).textContent).not.toContain("Durable");
  });

  it("the three-state names what the deck says, and inherit clears the override", () => {
    setPlayRung("venue");
    const saveCard = vi.fn();
    const durablePile: DeckDto = { ...deck, durable: true };
    const centre = dealing(oneShot, durablePile, host({ saveCard }));
    const labels = [...centre.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("deck (durable)");
    expect(labels).toContain("durable");
    expect(labels).toContain("not durable");

    const pick = (text: string): void => {
      [...centre.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
    };
    pick("not durable");
    expect(saveCard).toHaveBeenLastCalledWith("k_1", "c_1", expect.objectContaining({ durable: false }));
    pick("deck (durable)");
    expect(saveCard).toHaveBeenLastCalledWith("k_1", "c_1", expect.objectContaining({ durable: null }));
  });
});

describe("a flag already in the shard, below the rung that offers it", () => {
  // Venue is the Storylet Server's to set, so the compiler's only way out of a
  // durable flag in a solo or shared project is "remove the flag". Hiding the
  // control would leave an author holding a warning and no way to act on it.
  it("a durable card keeps its control at solo and at shared", () => {
    for (const rung of ["solo", "shared"] as const) {
      setPlayRung(rung);
      expect(dealing({ ...oneShot, durable: true }).textContent, rung).toContain("Durable");
    }
  });

  it("a durable deck keeps its switch at solo", () => {
    setPlayRung("solo");
    const centre = document.createElement("div");
    renderDeckTabBody(centre, box, { ...deck, durable: true }, "dealing", [], host());
    expect(centre.textContent).toContain("Durable");
    // And only that one: sharing is still hidden, since moving up a rung IS a
    // move Storyletter offers for a shared flag.
    expect(centre.textContent).not.toContain("Shared across playthroughs");
  });
});

describe("the deck page, rung by rung", () => {
  const dealingTab = (pile: DeckDto, h = host()): HTMLElement => {
    const centre = document.createElement("div");
    renderDeckTabBody(centre, box, pile, "dealing", [], h);
    return centre;
  };

  it("solo shows neither switch; shared shows one; venue shows both", () => {
    setPlayRung("solo");
    expect(dealingTab(deck).querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    setPlayRung("shared");
    expect(dealingTab(deck).textContent).toContain("Shared across playthroughs");
    expect(dealingTab(deck).textContent).not.toContain("Durable");
    setPlayRung("venue");
    expect(dealingTab(deck).textContent).toContain("Durable");
  });

  it("the Durable switch saves the deck's flag", () => {
    setPlayRung("venue");
    const saveDeckConfig = vi.fn();
    const centre = dealingTab(deck, host({ saveDeckConfig }));
    const boxes = [...centre.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    boxes[1]!.checked = true;
    boxes[1]!.dispatchEvent(new Event("change"));
    expect(saveDeckConfig).toHaveBeenCalledWith("k_1", { durable: true });
  });
});
