// @vitest-environment jsdom
// Outcome fields in Storyletter (design/outcome-fields-brief.md): the box's
// Card template tab, which is where they are DECLARED, and the open outcome's
// Fields block, which is where they are filled. Both are pure DOM, so both are
// checked here rather than left to a launch - the same arrangement the timed
// box's two surfaces have.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderBoxTabBody, renderCardWorkspace } from "./inspector.js";
import { setPlayRung } from "./play-ladder.js";
import { resetDocTabMemory } from "./doc-tab-memory.js";
import type { InspectorHost } from "./inspector.js";
import type { BoxDto, CardDto, DeckDto, FieldDeclDto } from "../../shared/api.js";

const outcome = { id: "o_1", gameId: "take-it", title: "Take it", changes: [], fields: [] };
const card: CardDto = {
  id: "c_1", gameId: "rat-job", title: "A rat job", priority: "0", redraw: "always",
  tags: [], copies: "", sharedCopies: "", fields: [], outcomes: [outcome],
};
const deck: DeckDto = { id: "k_1", gameId: "main", properties: [], cards: [card] };
const plainBox: BoxDto = {
  id: "b_1", gameId: "street", ranking: { specificity: true },
  fields: [], outcomeFields: [], properties: [], decks: [deck], templates: [], tagGroups: [], hands: [],
};
const declaring = (outcomeFields: FieldDeclDto[]): BoxDto => ({ ...plainBox, outcomeFields });

const host = (over: Partial<InspectorHost> = {}): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(),
  saveCard: vi.fn(), saveDeck: vi.fn(), saveDeckConfig: vi.fn(),
  deleteCard: vi.fn(), deleteDeck: vi.fn(),
  saveBox: vi.fn(), saveBoxIdentity: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(),
  createTemplate: vi.fn(), deleteTemplate: vi.fn(), createTagGroup: vi.fn(), createMap: vi.fn(),
  deleteTagGroup: vi.fn(), setGroupSpatial: vi.fn(), createHand: vi.fn(), deleteHand: vi.fn(),
  ...over,
} as InspectorHost);

beforeEach(() => {
  setPlayRung("solo");
  resetDocTabMemory();
  // jsdom has no layout, so it has no scrollIntoView; the declaration list
  // focuses the row it just added through one.
  Element.prototype.scrollIntoView = (): void => {};
});

describe("the box's Card template tab", () => {
  it("shows both halves of the template, each under its own label", () => {
    const centre = document.createElement("div");
    renderBoxTabBody(centre, declaring([{ name: "after", type: "string", default: "" }]), "template", host());
    const labels = [...centre.querySelectorAll(".insp-label")].map((s) => s.textContent);
    expect(labels).toEqual(["Card fields", "Outcome fields"]);
    expect(centre.textContent).toContain("the fields every outcome can carry");
  });

  it("offers a + Field for each list, and the outcome one saves outcomeFields", () => {
    const saveBox = vi.fn();
    const centre = document.createElement("div");
    renderBoxTabBody(centre, declaring([{ name: "after", type: "string", default: "" }]), "template", host({ saveBox }));
    const adds = [...centre.querySelectorAll("button")].filter((b) => b.textContent === "+ Field");
    expect(adds).toHaveLength(2);
    adds[1]!.click();
    expect(saveBox).toHaveBeenCalledTimes(1);
    const [id, edit] = saveBox.mock.calls[0]!;
    expect(id).toBe("b_1");
    // The card half is untouched by an edit to the outcome half: a box edit
    // says only what it changes.
    expect(edit).not.toHaveProperty("fields");
    expect(edit.outcomeFields.map((f: FieldDeclDto) => f.name)).toContain("after");
    expect(edit.outcomeFields).toHaveLength(2);
  });
});

describe("an open outcome's Fields block", () => {
  const openOutcome = (box: BoxDto, h = host()): HTMLElement => {
    const centre = document.createElement("div");
    renderCardWorkspace(centre, box, deck, card, [], h);
    [...centre.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Outcomes"))!.click();
    // Which outcome is open is module state that outlives one test, and the
    // row TOGGLES: open it only when it is not already open.
    if (!centre.querySelector(".outcome-body")) centre.querySelector<HTMLButtonElement>("button.outcome-row")!.click();
    return centre;
  };

  it("draws a row per declared field, with the type as the placeholder", () => {
    const centre = openOutcome(declaring([
      { name: "after", type: "string", default: "" },
      { name: "cue", type: "enum", default: "silence", values: ["silence", "bell"] },
    ]));
    expect(centre.textContent).toContain("Fields");
    expect([...centre.querySelectorAll(".doc-row-label")].map((s) => s.textContent)).toEqual(["after", "cue"]);
    // Rule 7: a declared type is a contract, so an enum offers its values.
    expect(centre.querySelector<HTMLInputElement>(".outcome-body input.insp-mono")!.placeholder).toBe("<string>");
    expect([...centre.querySelectorAll<HTMLSelectElement>(".outcome-body select option")].map((o) => o.value))
      .toEqual(["", "silence", "bell"]);
  });

  it("says nothing at all when the box declares none", () => {
    // No empty-state prose inside an outcome: an outcome is an item in a card,
    // and teaching box configuration in the middle of somebody's writing is
    // what the box's own tab is for.
    // Scoped to the outcome: the CARD's own Fields tab is in the bar above it,
    // and it stays there whatever the box declares about outcomes.
    const body = openOutcome(plainBox).querySelector(".outcome-body")!;
    expect(body).not.toBeNull();
    expect(body.querySelectorAll(".doc-row-label")).toHaveLength(0);
    expect(body.textContent).not.toContain("Fields");
  });

  it("a typed value is saved against the outcome", () => {
    const saveCard = vi.fn();
    const centre = openOutcome(declaring([{ name: "after", type: "string", default: "" }]), host({ saveCard }));
    const input = centre.querySelector<HTMLInputElement>(".outcome-body input.insp-mono")!;
    input.value = "The rat keeper nods.";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
    expect(saveCard).toHaveBeenCalled();
    const [, , edit] = saveCard.mock.calls.at(-1)!;
    expect(edit.outcomes[0].fields).toEqual([{ name: "after", value: "The rat keeper nods." }]);
  });
});
