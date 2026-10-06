// The one definition of a place axis (place-axis.ts): a group any hand in the
// box binds, by any of the four routes, or the project map's zone group in a box
// on the map. The Where row, Group by and the hand page's tiers all read it.

import { describe, expect, it } from "vitest";
import { bindingsOfHand, handBindings, movesIn, placeAxes, tagsOfHand } from "../src/place-axis.js";
import type { PlaceAxisBox, PlaceAxisMap } from "../src/place-axis.js";
import type { TagGroup } from "@storylet-studio/model";

const zone: TagGroup = { id: "d_zone", gameId: "zone", tags: [{ id: "v_village", gameId: "village" }, { id: "v_cave", gameId: "cave" }] };
const npc: TagGroup = { id: "d_npc", gameId: "npc", tags: [{ id: "v_gareth", gameId: "gareth" }] };
const kind: TagGroup = { id: "d_kind", gameId: "kind", tags: [{ id: "v_topic", gameId: "topic" }] };
const area: TagGroup = { id: "d_area", gameId: "area", tags: [{ id: "v_docks", gameId: "docks" }] };
const mood: TagGroup = { id: "d_mood", gameId: "mood", tags: [{ id: "v_grim", gameId: "grim" }] };
const act: TagGroup = { id: "d_act", gameId: "act", boundBy: "@story.act", tags: [{ id: "v_a1", gameId: "act-1" }] };
const project: PlaceAxisMap = { map: { group: zone } };

const box = (over: Partial<PlaceAxisBox<string>>): PlaceAxisBox<string> =>
  ({ tagGroups: [npc, kind, area, mood, act], handTemplates: [], hands: [], ...over });

describe("placeAxes", () => {
  it("counts a template's chooses, even before it has a hand", () => {
    expect(placeAxes(project, box({ handTemplates: [{ id: "t", chooses: ["d_npc"] }] }))).toEqual(["d_npc"]);
  });

  it("counts a template's fixed bindings", () => {
    expect(placeAxes(project, box({ handTemplates: [{ id: "t", bindings: { d_kind: "v_topic" } }] }))).toEqual(["d_kind"]);
  });

  it("counts a standalone hand's rule bindings (the editor's default hand)", () => {
    const hands = [{ id: "h", rule: { slots: 1, bindings: { d_area: "v_docks" } } }];
    expect(placeAxes(project, box({ hands }))).toEqual(["d_area"]);
  });

  it("counts a hole filled from a property", () => {
    const hands = [{ id: "h", rule: { slots: 1, bindings: { d_npc: "@story.with" } } }];
    expect(placeAxes(project, box({ hands }))).toEqual(["d_npc"]);
    expect(movesIn(box({ hands }), hands[0]!, "d_npc")).toBe(true);
  });

  it("puts the zone group first in a box on the map, bound or not", () => {
    const hands = [{ id: "h", rule: { slots: 1, bindings: { d_npc: "v_gareth" } } }];
    expect(placeAxes(project, box({ usesMap: true, hands }))).toEqual(["d_zone", "d_npc"]);
    // Off the map the same group is nothing of the box's.
    expect(placeAxes(project, box({ hands }))).not.toContain("d_zone");
  });

  it("leaves out a group nothing binds, and an act bound only from state", () => {
    const hands = [{ id: "h", rule: { slots: 1 } }];
    expect(placeAxes(project, box({ hands }))).toEqual([]);
    expect(placeAxes(project, box({ hands }))).not.toContain("d_mood");
    expect(placeAxes(project, box({ hands }))).not.toContain("d_act");
  });

  it("follows the box's display order for its own groups", () => {
    const hands = [{ id: "h", rule: { slots: 1, bindings: { d_area: "v_docks", d_npc: "v_gareth" } } }];
    expect(placeAxes(project, box({ hands }))).toEqual(["d_npc", "d_area"]);
  });
});

describe("bindingsOfHand and tagsOfHand", () => {
  it("lays an instance's chosen over its template's bindings", () => {
    const b = box({ handTemplates: [{ id: "t", bindings: { d_kind: "v_topic" }, chooses: ["d_npc"] }] });
    const hand = { id: "h", template: "t", chosen: { d_npc: "v_gareth" } };
    expect(Object.fromEntries(bindingsOfHand(b, hand))).toEqual({ d_kind: "v_topic", d_npc: "v_gareth" });
    expect(tagsOfHand(b, hand, npc)).toEqual(["v_gareth"]);
    expect(tagsOfHand(b, hand, area)).toEqual([]);
  });

  it("derives every binding once, naming its group only where the runtime's ask does", () => {
    // handBindings is what both this file and reach.ts read: the template's own
    // binding does not name its group in @hand, a chosen or rule binding does.
    const b = box({ handTemplates: [{ id: "t", bindings: { d_kind: "v_topic", place: "h" }, chooses: ["d_npc"] }] });
    expect(handBindings(b, { id: "h", template: "t", chosen: { d_npc: "@story.with" } })).toEqual([
      { group: "d_kind", tag: "v_topic", named: false },
      { group: "place", tag: "h", named: false },
      { group: "d_npc", tag: "@story.with", named: true },
    ]);
    expect(handBindings(b, { id: "r", rule: { slots: 1, bindings: { d_area: "v_docks" } } })).toEqual([
      { group: "d_area", tag: "v_docks", named: true },
    ]);
  });

  it("reads a moving hand's enum for the tags it can be in", () => {
    const hand = { id: "h", rule: { slots: 1, bindings: { d_zone: "@story.at" } } };
    const decls = { story: [{ name: "at", type: "enum" as const, default: "cave", values: ["cave"] }] };
    expect(tagsOfHand(box({}), hand, zone, decls)).toEqual(["v_cave"]);
    expect(tagsOfHand(box({}), hand, zone)).toEqual(["v_village", "v_cave"]);
  });
});
