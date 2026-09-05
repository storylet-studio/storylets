// @vitest-environment jsdom
// The hole picker's "from a property" group (design/engine-server.md 4.6): the
// half of a hand's tag picker that makes the hand move. It is a general engine
// feature, not a venue one (ruling of 2026-09-05), so the check that matters
// is that the PLAINEST project has it: a solo author fills a hole from a
// property without changing any setting first.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHandWorkspace } from "./inspector.js";
import type { InspectorHost } from "./inspector.js";
import { setPlayRung } from "./play-ladder.js";
import type { BoxDto, HandDetail } from "../../shared/api.js";

const box: BoxDto = {
  id: "b_1", gameId: "street", ranking: { specificity: true },
  fields: [], properties: [], decks: [], templates: [], tagGroups: [], hands: [],
};

const detail = (over: Partial<HandDetail> = {}): HandDetail => ({
  id: "h_1", gameId: "the-corner",
  template: "npcs",
  chosen: [{ group: "zone", value: "", values: ["docks", "market"] }],
  movableFrom: ["@hand.zone", "@story.where"],
  slots: "",
  properties: [],
  templates: [{ gameId: "npcs", chooses: ["zone"], slots: "unbounded" }],
  groups: [{ gameId: "zone", values: ["docks", "market"] }],
  ...over,
});

const host = (): InspectorHost => ({
  openThreads: () => 0, showComments: vi.fn(),
  saveCard: vi.fn(), saveDeck: vi.fn(), saveDeckConfig: vi.fn(),
  deleteCard: vi.fn(), deleteDeck: vi.fn(),
  saveBox: vi.fn(), saveBoxIdentity: vi.fn(), saveTemplate: vi.fn(), saveTagGroup: vi.fn(), saveHand: vi.fn(),
  createTemplate: vi.fn(), deleteTemplate: vi.fn(), createTagGroup: vi.fn(), createMap: vi.fn(),
  deleteTagGroup: vi.fn(), setGroupSpatial: vi.fn(), createHand: vi.fn(), deleteHand: vi.fn(),
} as InspectorHost);

const draw = (d: HandDetail): HTMLElement => {
  const centre = document.createElement("div");
  renderHandWorkspace(centre, box, d, [], host());
  return centre;
};

const groups = (centre: HTMLElement): string[] =>
  [...centre.querySelectorAll("optgroup")].map((g) => g.label);

afterEach(() => setPlayRung("solo"));

describe("filling a hole from a property", () => {
  it("a solo project offers it: no rung governs a hand that moves", () => {
    setPlayRung("solo");
    const centre = draw(detail());
    expect(groups(centre)).toContain("from a property");
    const options = [...centre.querySelectorAll<HTMLOptionElement>("optgroup option")].map((o) => o.value);
    expect(options).toEqual(["@hand.zone", "@story.where"]);
  });

  it("every rung offers it", () => {
    for (const rung of ["solo", "shared", "venue"] as const) {
      setPlayRung(rung);
      expect(groups(draw(detail())), rung).toContain("from a property");
    }
  });

  it("nothing to fill from means no group, at any rung", () => {
    // An empty group would teach a reader to expect a choice that is not there.
    setPlayRung("venue");
    expect(groups(draw(detail({ movableFrom: [] })))).toEqual([]);
  });

  it("a reference already in the shard shows even when nothing declares it", () => {
    setPlayRung("solo");
    const centre = draw(detail({
      chosen: [{ group: "zone", value: "@hand.gone", values: ["docks"] }],
      movableFrom: [],
    }));
    const picked = centre.querySelector<HTMLOptionElement>("optgroup option[selected], optgroup option")!;
    expect(groups(centre)).toContain("from a property");
    expect(picked.value).toBe("@hand.gone");
    expect(picked.textContent).toContain("not declared");
  });
});
