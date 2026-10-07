// @vitest-environment jsdom
// Ruling N on the six fields that used to commit only on blur: card and
// outcome Fields values, redraw turns, hand and template slots, and tag names
// (a box's turn seconds is in timed-box.test.ts). Each now hands its value to
// the save as it is typed, so Cmd+S, Play and the review walk act on it, and
// Esc puts back what it had at focus.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCardWorkspace, renderHandWorkspace, renderTagGroupWorkspace, renderTemplateWorkspace, resetDocTabMemory, setDocTab } from "./inspector.js";
import { setPlayRung } from "./play-ladder.js";
import type { InspectorHost } from "./inspector.js";
import type { BoxDto, CardDto, DeckDto, HandDetail, TagGroupDetail, TemplateDetail } from "../../shared/api.js";

const card: CardDto = {
  id: "c_1", gameId: "rat-job", title: "A rat job", priority: "0", redraw: "3",
  tags: [], copies: "", sharedCopies: "", fields: [],
  outcomes: [{ id: "o_1", gameId: "take-it", title: "Take it", changes: [], fields: [] }],
};
const deck: DeckDto = { id: "k_1", gameId: "main", properties: [], cards: [card] };
const box: BoxDto = {
  id: "b_1", gameId: "street", ranking: { specificity: true },
  fields: [{ name: "line", type: "string", default: "" }],
  outcomeFields: [{ name: "after", type: "string", default: "" }],
  properties: [], decks: [deck], templates: [], tagGroups: [], hands: [],
};

const host = (over: Partial<InspectorHost> = {}): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(),
  saveCard: vi.fn(), saveDeckConfig: vi.fn(), deleteCard: vi.fn(),
  saveBox: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(),
  deleteTemplate: vi.fn(), deleteTagGroup: vi.fn(), deleteHand: vi.fn(), setGroupSpatial: vi.fn(),
  handCards: async () => null, deckCatalogue: async () => [], openCardFromHand: vi.fn(), newCardAtHand: vi.fn(), openHand: vi.fn(),
  ...over,
});

const type = (f: HTMLInputElement, value: string): void => {
  f.value = value;
  f.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => { setPlayRung("solo"); resetDocTabMemory(); });

describe("a card's fields", () => {
  it("a Fields value is saved as it is typed", () => {
    const saveCard = vi.fn();
    const centre = document.createElement("div");
    setDocTab("card:k_1/c_1", "fields");
    renderCardWorkspace(centre, box, deck, card, [], host({ saveCard }));
    const value = centre.querySelector<HTMLInputElement>(".doc-row input")!;
    type(value, "The rats are back");
    expect(saveCard).toHaveBeenCalledTimes(1);
    expect(saveCard.mock.calls[0]![2].fields).toEqual([{ name: "line", value: "The rats are back" }]);
  });

  it("an outcome's Fields value is saved as it is typed", () => {
    const saveCard = vi.fn();
    const centre = document.createElement("div");
    setDocTab("card:k_1/c_1", "outcomes");
    renderCardWorkspace(centre, box, deck, card, [], host({ saveCard }));
    if (!centre.querySelector(".outcome-body")) centre.querySelector<HTMLButtonElement>("button.outcome-row")!.click();
    type(centre.querySelector<HTMLInputElement>(".outcome-body .doc-row input")!, "You pocket the coin");
    expect(saveCard).toHaveBeenCalled();
    expect(saveCard.mock.lastCall![2].outcomes[0].fields).toEqual([{ name: "after", value: "You pocket the coin" }]);
  });

  it("redraw turns are saved as they are typed, and Esc puts them back", () => {
    const saveCard = vi.fn();
    const centre = document.createElement("div");
    setDocTab("card:k_1/c_1", "dealing");
    renderCardWorkspace(centre, box, deck, card, [], host({ saveCard }));
    const turns = [...centre.querySelectorAll<HTMLInputElement>("input.insp-short")].find((i) => i.placeholder === "3")!;
    turns.dispatchEvent(new Event("focus"));
    type(turns, "12");
    expect(saveCard.mock.lastCall![2].redraw).toBe("12");
    turns.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(turns.value).toBe("3");
    expect(saveCard.mock.lastCall![2].redraw).toBe("3");
  });

  it("the purpose restores on Esc too (it used to keep what was typed)", () => {
    const saveCard = vi.fn();
    const centre = document.createElement("div");
    renderCardWorkspace(centre, box, deck, { ...card, purpose: "Rats" }, [], host({ saveCard }));
    const purpose = centre.querySelector<HTMLTextAreaElement>("textarea.doc-purpose")!;
    purpose.dispatchEvent(new Event("focus"));
    purpose.value = "Rats and worse"; purpose.dispatchEvent(new Event("input"));
    purpose.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(purpose.value).toBe("Rats");
    expect(saveCard.mock.lastCall![2].purpose).toBe("Rats");
  });
});

describe("slots", () => {
  const handDetail = (over: Partial<HandDetail> = {}): HandDetail => ({
    id: "h_1", gameId: "the-corner", template: "npcs", chosen: [], movableFrom: [], slots: "",
    properties: [], templates: [{ gameId: "npcs", chooses: [], slots: "4" }], groups: [],
    ...over,
  });

  it("an instance hand's slots are saved as they are typed", () => {
    const saveHand = vi.fn();
    const centre = document.createElement("div");
    setDocTab("hand:h_1", "slots");
    renderHandWorkspace(centre, box, handDetail(), [], host({ saveHand }));
    type(centre.querySelector<HTMLInputElement>("input.insp-short")!, "2");
    expect(saveHand).toHaveBeenCalledWith("b_1", "h_1", expect.objectContaining({ slots: "2" }));
  });

  it("a standalone hand's bounded slots are saved as they are typed", () => {
    const saveHand = vi.fn();
    const centre = document.createElement("div");
    setDocTab("hand:h_1", "slots");
    renderHandWorkspace(centre, box, handDetail({ template: undefined, rule: { bindings: [], slots: "3" } }), [], host({ saveHand }));
    type(centre.querySelector<HTMLInputElement>("input.insp-short")!, "5");
    expect(saveHand.mock.lastCall![2].rule.slots).toBe("5");
  });

  it("a hand template's slots are saved as they are typed", () => {
    const saveTemplate = vi.fn();
    const detail: TemplateDetail = { id: "t_1", gameId: "npcs", bindings: [], slots: "3", properties: [], groups: [], instances: [] };
    const centre = document.createElement("div");
    renderTemplateWorkspace(centre, box, detail, [], host({ saveTemplate }));
    type(centre.querySelector<HTMLInputElement>("input.insp-short")!, "6");
    expect(saveTemplate.mock.lastCall![2].slots).toBe("6");
  });
});

describe("a tag's name", () => {
  it("is saved as it is typed, and its Remove names the tag", () => {
    const saveTagGroup = vi.fn();
    const detail: TagGroupDetail = { id: "g_1", gameId: "mood", properties: [], values: [{ gameId: "calm", properties: [] }] };
    const centre = document.createElement("div");
    renderTagGroupWorkspace(centre, { ...box, tagGroups: [{ id: "g_1", gameId: "mood", values: ["calm"] }] }, detail, host({ saveTagGroup }));
    const name = [...centre.querySelectorAll<HTMLInputElement>("input")].find((i) => i.placeholder === "Tag name")!;
    type(name, "serene");
    expect(saveTagGroup.mock.lastCall![2].values[0].gameId).toBe("serene");
    expect([...centre.querySelectorAll("button")].some((b) => b.textContent === "Remove tag")).toBe(true);
  });
});
