// @vitest-environment jsdom
// The timed box in Storyletter (design/engine-server.md 4.8): the box page's
// Turns section, which is where a box becomes timed, and the card editor's
// Redraw field, which is where the consequence is felt. Both are pure DOM,
// so both are checked here rather than left to a launch.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderBoxTabBody, renderCardWorkspace } from "./inspector.js";
import { setPlayRung } from "./play-ladder.js";
import type { InspectorHost } from "./inspector.js";
import type { BoxDto, CardDto, DeckDto } from "../../shared/api.js";

const card: CardDto = {
  id: "c_1", gameId: "patrol", title: "The patrol", condition: "", priority: "1", redraw: "30",
  tags: [], copies: "", sharedCopies: "", fields: [], outcomes: [{ id: "o_1", gameId: "done", changes: [] }],
};
const deck: DeckDto = { id: "k_1", gameId: "main", properties: [], cards: [card] };
const plainBox: BoxDto = {
  id: "b_1", gameId: "street", ranking: { specificity: true },
  fields: [], properties: [], decks: [deck], templates: [], tagGroups: [], hands: [],
};
const timedBox: BoxDto = { ...plainBox, turn: { seconds: 60 } };

const host = (over: Partial<InspectorHost> = {}): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(),
  saveCard: vi.fn(), saveDeck: vi.fn(), saveDeckConfig: vi.fn(),
  deleteCard: vi.fn(), deleteDeck: vi.fn(),
  saveBox: vi.fn(), saveBoxIdentity: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(),
  createTemplate: vi.fn(), deleteTemplate: vi.fn(), createTagGroup: vi.fn(), createMap: vi.fn(),
  deleteTagGroup: vi.fn(), setGroupSpatial: vi.fn(), createHand: vi.fn(), deleteHand: vi.fn(),
  ...over,
} as InspectorHost);

const buttons = (el: HTMLElement): string[] => [...el.querySelectorAll("button")].map((b) => b.textContent ?? "");

// A timed box is NOT a venue feature (ruling of 2026-09-05): a clock is an
// engine feature any game may want, so the section shows at every rung. Solo
// is therefore what these run at, and that choice is load-bearing: it is the
// DOM-level proof that the plainest project still has the section.
beforeEach(() => setPlayRung("solo"));

describe("the box page's Turns section", () => {
  it("an ordinary box: a play is the choice, and the seconds field is shut", () => {
    const centre = document.createElement("div");
    renderBoxTabBody(centre, plainBox, "dealing", host());
    expect(centre.textContent).toContain("A turn is");
    const on = [...centre.querySelectorAll("button.on")].map((b) => b.textContent);
    expect(on).toContain("a play");
    expect(centre.querySelector<HTMLInputElement>("input.insp-short")!.disabled).toBe(true);
    // Nothing about time is said until there is time to say something about.
    expect(centre.textContent).not.toContain("do not advance");
  });

  it("a timed box says the consequence in plain words, in its own unit", () => {
    const centre = document.createElement("div");
    renderBoxTabBody(centre, timedBox, "dealing", host());
    expect([...centre.querySelectorAll("button.on")].map((b) => b.textContent))
      .toContain("every N seconds of play");
    expect(centre.textContent).toContain("Plays in this box do not advance its turns");
    expect(centre.textContent).toContain("a Redraw of 30 means 30 minutes");
    const field = centre.querySelector<HTMLInputElement>("input.insp-short")!;
    expect(field.disabled).toBe(false);
    expect(field.value).toBe("60");
  });

  it("choosing time saves a default unit; choosing a play clears it", () => {
    const saveBox = vi.fn();
    const centre = document.createElement("div");
    renderBoxTabBody(centre, plainBox, "dealing", host({ saveBox }));
    const timeBtn = [...centre.querySelectorAll("button")].find((b) => b.textContent?.startsWith("every N"))!;
    timeBtn.click();
    expect(saveBox).toHaveBeenCalledWith("b_1", { turn: { seconds: 60 } });
    // The section redrew itself, so the choice now reads as made and the
    // other button is the live one.
    const playBtn = [...centre.querySelectorAll("button")].find((b) => b.textContent === "a play")!;
    playBtn.click();
    expect(saveBox).toHaveBeenLastCalledWith("b_1", { turn: null });
  });

  it("a typed unit is saved on change, and refused when it is not a whole second", () => {
    const saveBox = vi.fn();
    const centre = document.createElement("div");
    renderBoxTabBody(centre, timedBox, "dealing", host({ saveBox }));
    const field = centre.querySelector<HTMLInputElement>("input.insp-short")!;
    field.value = "20"; field.dispatchEvent(new Event("change"));
    expect(saveBox).toHaveBeenCalledWith("b_1", { turn: { seconds: 20 } });
    saveBox.mockClear();
    for (const bad of ["0", "-5", "1.5", ""]) {
      field.value = bad; field.dispatchEvent(new Event("change"));
    }
    expect(saveBox).not.toHaveBeenCalled();
  });
});

describe("the card editor's Redraw field in a timed box", () => {
  const openDealing = (box: BoxDto): HTMLElement => {
    const centre = document.createElement("div");
    renderCardWorkspace(centre, box, deck, card, [], host());
    const tab = [...centre.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Dealing"));
    tab?.click();
    return centre;
  };

  it("says what the number comes to, in the box's unit", () => {
    expect(openDealing(timedBox).textContent).toContain("30 turns (30 minutes)");
  });

  it("converts against the box's own seconds, not a fixed minute", () => {
    expect(openDealing({ ...plainBox, turn: { seconds: 20 } }).textContent)
      .toContain("30 turns (10 minutes)");
  });

  it("the help text names the box's setting, and says nothing about a run", () => {
    const text = openDealing(timedBox).textContent ?? "";
    expect(text).toContain("A turn in this box is 1 minute (its Turns setting)");
    expect(text).not.toContain("of the run");
  });

  it("an ordinary box says nothing about time at all", () => {
    const text = openDealing(plainBox).textContent ?? "";
    expect(text).toContain("Whether a played card can be dealt again.");
    expect(text).not.toContain("minutes");
    expect(text).not.toContain("turns (");
  });

  it("the conversion follows the field as it is typed", () => {
    const centre = openDealing(timedBox);
    const fields = [...centre.querySelectorAll<HTMLInputElement>("input.insp-short")];
    const turns = fields.find((f) => f.value === "30")!;
    turns.value = "90";
    turns.dispatchEvent(new Event("input"));
    expect(centre.textContent).toContain("90 turns (1 hour 30 minutes)");
  });
});
