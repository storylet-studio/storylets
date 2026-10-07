// @vitest-environment jsdom
// Whether a remembered place can still be restored (navigation.ts): the back
// and forward stacks skip a place whose document has gone since, rather than
// restoring it into a blank page.

import { describe, expect, it } from "vitest";
import { placeUsable } from "./navigation.js";
import type { BoxDto, ProjectDto } from "../../shared/api.js";

const box: BoxDto = {
  id: "b_1", gameId: "harbour", ranking: { specificity: true }, fields: [], outcomeFields: [], properties: [],
  decks: [{ id: "k_1", gameId: "docks", properties: [], cards: [{
    id: "c_1", gameId: "ambush", condition: "", priority: 0, redraw: "never", tags: [], copies: "", sharedCopies: "", fields: [], outcomes: [],
  }] }],
  templates: [{ id: "t_1", gameId: "street-hands", bindings: [], slots: "3", instances: 0 }],
  tagGroups: [{ id: "g_1", gameId: "zone", values: [] }],
  hands: [{ id: "h_1", gameId: "docks-street", slots: 2, tags: {} }],
};
const project: ProjectDto = { dir: "/p", name: "Saltmarsh", threads: {}, storyPropertyCount: 0, play: "solo", boxes: [box] };

describe("a remembered place", () => {
  it("is usable while its document is still there", () => {
    expect(placeUsable(project, { focus: { kind: "deck", box: "b_1", deck: "k_1" }, inspected: { kind: "card", box: "b_1", deck: "k_1", card: "c_1" } })).toBe(true);
    expect(placeUsable(project, { focus: { kind: "box", box: "b_1" }, inspected: { kind: "template", box: "b_1", template: "t_1" } })).toBe(true);
    expect(placeUsable(project, { focus: { kind: "hands", box: "b_1" }, inspected: { kind: "hand", box: "b_1", hand: "h_1" } })).toBe(true);
    expect(placeUsable(project, { focus: { kind: "box", box: "b_1" }, inspected: { kind: "tagGroup", box: "b_1", group: "g_1" } })).toBe(true);
    expect(placeUsable(project, { focus: { kind: "decks", box: "b_1" } })).toBe(true);
  });

  it("is skipped once its document, deck or box has gone", () => {
    expect(placeUsable(project, { focus: { kind: "deck", box: "b_1", deck: "k_1" }, inspected: { kind: "card", box: "b_1", deck: "k_1", card: "c_9" } })).toBe(false);
    expect(placeUsable(project, { focus: { kind: "deck", box: "b_1", deck: "k_9" } })).toBe(false);
    expect(placeUsable(project, { focus: { kind: "hands", box: "b_1" }, inspected: { kind: "hand", box: "b_1", hand: "h_9" } })).toBe(false);
    expect(placeUsable(project, { focus: { kind: "box", box: "b_9" } })).toBe(false);
  });

  it("is always usable for the project and Story, and for the map while there is one", () => {
    expect(placeUsable(project, { focus: { kind: "project" } })).toBe(true);
    expect(placeUsable(project, { focus: { kind: "story" } })).toBe(true);
    expect(placeUsable(project, { focus: { kind: "map" } })).toBe(false);
    expect(placeUsable({ ...project, map: { groupId: "g_1", gameId: "zone", zones: 0 } }, { focus: { kind: "map" } })).toBe(true);
    expect(placeUsable(undefined, { focus: { kind: "project" } })).toBe(false);
  });
});
