// ---------------------------------------------------------------------------
// The Where row's model. Written before the row was drawn, because the part
// worth pinning is the sentence and the AND rule, not the chips.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { PLACE_GROUP } from "@storylet-studio/model";
import { whereModel, whereSentence, whereWarning } from "./where.js";
import type { BoxDto } from "../../shared/api.js";

const box = {
  id: "b", gameId: "village", ranking: { specificity: true }, fields: [], properties: [], decks: [], templates: [],
  tagGroups: [
    { id: "d_zone", gameId: "zone", values: ["village", "forest"], spatial: true },
    { id: "d_mood", gameId: "mood", values: ["tense", "calm"] },
  ],
  hands: [
    { id: "h_inn", gameId: "the-inn", title: "The Inn", slots: 2, tags: { zone: "village" } },
    { id: "h_forge", gameId: "the-forge", title: "The Forge", slots: 2, tags: { zone: "village" } },
    { id: "h_tree", gameId: "the-tree", title: "The Mystic Tree", slots: 1, tags: { zone: "forest" } },
  ],
} as unknown as BoxDto;

const model = (tags: { group: string; values: string[] }[]) => whereModel(box, tags);

describe("the Where model", () => {
  it("reads Anywhere when nothing is chosen", () => {
    const m = model([]);
    expect(whereSentence(m)).toBe("Anywhere");
    expect(whereWarning(m)).toBeUndefined();
  });

  it("names one place", () => {
    expect(whereSentence(model([{ group: PLACE_GROUP, values: ["the-inn"] }]))).toBe("The Inn");
  });

  it("names several places, which is an OR", () => {
    expect(whereSentence(model([{ group: PLACE_GROUP, values: ["the-inn", "the-forge"] }])))
      .toBe("The Inn, The Forge");
  });

  it("reads a region as anywhere in it", () => {
    expect(whereSentence(model([{ group: "zone", values: ["forest"] }]))).toBe("Anywhere in forest");
  });

  it("reads several regions as an OR", () => {
    expect(whereSentence(model([{ group: "zone", values: ["forest", "village"] }])))
      .toBe("Anywhere in forest or village");
  });

  it("ignores a non-spatial group: mood is not a place", () => {
    const m = model([{ group: "mood", values: ["tense"] }]);
    expect(whereSentence(m)).toBe("Anywhere");
    expect(m.spatialGroups).toEqual(["zone"]);
  });

  it("warns when a place and a region contradict, because the two are ANDed", () => {
    // The Inn binds zone: village, so a card asking for the forest can never
    // be dealt there. This is the combination a multi-select picker misleads
    // about (a reader expects union; the runtime intersects).
    const m = model([{ group: PLACE_GROUP, values: ["the-inn"] }, { group: "zone", values: ["forest"] }]);
    expect(whereSentence(m)).toBe("The Inn · anywhere in forest");
    expect(whereWarning(m)).toBe("The Inn is in village, not the selected region, so this card can never come up there.");
  });

  it("does not warn when the place is IN the selected region", () => {
    const m = model([{ group: PLACE_GROUP, values: ["the-tree"] }, { group: "zone", values: ["forest"] }]);
    expect(whereWarning(m)).toBeUndefined();
  });

  it("counts the rest when several places are dead", () => {
    const m = model([{ group: PLACE_GROUP, values: ["the-inn", "the-forge"] }, { group: "zone", values: ["forest"] }]);
    expect(whereWarning(m)).toBe("The Inn is in village, not the selected region, so this card can never come up there (and 1 more).");
  });

  it("says nothing about places when no region is chosen: no binding, no constraint", () => {
    expect(whereWarning(model([{ group: PLACE_GROUP, values: ["the-inn", "the-tree"] }]))).toBeUndefined();
  });
});
