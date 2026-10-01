// The hand page's tiers (reach.ts `placeTiers`): what could come up at one hand,
// by tags and place alone, split into only here / anywhere in a zone / anywhere.
// Literal boxes rather than a compiled project: the rule reads tags and
// bindings and nothing else, so a fixture that says only that is the clearest.

import { describe, expect, it } from "vitest";
import { handReach, placeTiers, zonesOfHand } from "../src/reach.js";
import type { ReachBox, ReachCard, ReachMap } from "../src/reach.js";
import type { Hand, TagGroup } from "@storylet-studio/model";

const zone: TagGroup = {
  id: "d_zone", gameId: "zone",
  tags: [
    { id: "v_village", gameId: "village", order: 0 },
    { id: "v_forest", gameId: "forest", order: 1 },
    { id: "v_cave", gameId: "cave", order: 2 },
  ],
};
const act: TagGroup = { id: "d_act", gameId: "act", boundBy: "@story.act", tags: [{ id: "v_a1", gameId: "act-1" }, { id: "v_a2", gameId: "act-2" }] };
const npc: TagGroup = { id: "d_npc", gameId: "npc", tags: [{ id: "v_gareth", gameId: "gareth" }, { id: "v_mira", gameId: "mira" }] };
const project: ReachMap = { map: { group: zone } };

const inn: Hand<string> = { id: "h_inn", gameId: "inn", template: "t_place", chosen: { d_zone: "v_village" } };
const forge: Hand<string> = { id: "h_forge", gameId: "forge", template: "t_place", chosen: { d_zone: "v_village" } };
const elder: Hand<string> = { id: "h_elder", gameId: "elder", template: "t_place", chosen: { d_zone: "@story.elder_at" } };
const wanderer: Hand<string> = { id: "h_wanderer", gameId: "wanderer", template: "t_place", chosen: { d_zone: "@story.anywhere" } };
const loose: Hand<string> = { id: "h_loose", gameId: "loose", rule: { slots: 3 } };

const village: ReachBox<string> = {
  usesMap: true,
  tagGroups: [act],
  handTemplates: [{ id: "t_place" }],
  hands: [inn, forge, elder, wanderer, loose],
};

const cards: ReachCard[] = [
  { id: "c_inn", tags: { place: ["h_inn"] } },
  { id: "c_inn_or_forge", tags: { place: ["h_inn", "h_forge"] } },
  { id: "c_forge", tags: { place: ["h_forge"] } },
  { id: "c_square", tags: { d_zone: ["v_village"] } },
  { id: "c_woods", tags: { d_zone: ["v_forest"] } },
  { id: "c_two", tags: { d_zone: ["v_forest", "v_village"] } },
  { id: "c_rumour" },
  { id: "c_act2", tags: { d_act: ["v_a2"] } },
  // Placed here but in another zone: it can never come up, so it is no tier's.
  { id: "c_dead", tags: { place: ["h_inn"], d_zone: ["v_forest"] } },
];

describe("placeTiers", () => {
  it("splits a hand's cards into only here, anywhere in its zone, and anywhere", () => {
    expect(placeTiers(project, village, inn, cards)).toEqual({
      only: ["c_inn", "c_inn_or_forge"],
      zones: [{ zone: "v_village", cards: ["c_square", "c_two"] }],
      // An act is not a tier: it is bound at run time, so it filters nothing here.
      anywhere: ["c_rumour", "c_act2"],
    });
  });

  it("gives a roaming hand a tier for each zone its enum can name, in map order", () => {
    const decls = { story: [{ name: "elder_at", type: "enum" as const, default: "village", values: ["cave", "village"] }] };
    const tiers = placeTiers(project, village, elder, cards, decls);
    expect(tiers.zones).toEqual([
      { zone: "v_village", cards: ["c_square", "c_two"] },
      { zone: "v_cave", cards: [] },
    ]);
    // The forest is somewhere the elder can never be.
    expect(tiers.anywhere).toEqual(["c_rumour", "c_act2"]);
  });

  it("lets a hole filled from a string, or from nothing declared, be any zone", () => {
    const decls = { story: [{ name: "anywhere", type: "string" as const, default: "" }] };
    expect(zonesOfHand(project, village, wanderer, decls)).toEqual(["v_village", "v_forest", "v_cave"]);
    expect(zonesOfHand(project, village, wanderer)).toEqual(["v_village", "v_forest", "v_cave"]);
  });

  it("puts a zone-tagged card under Anywhere at a hand that binds no zone", () => {
    const tiers = placeTiers(project, village, loose, cards);
    expect(tiers.zones).toEqual([]);
    expect(tiers.anywhere).toEqual(["c_square", "c_woods", "c_two", "c_rumour", "c_act2"]);
  });

  it("has no zone tiers in a box off the map, and filters by its own groups", () => {
    const talking: Hand<string> = { id: "h_gareth", gameId: "talking-to-gareth", template: "t_topics", chosen: { d_npc: "v_gareth" } };
    const talk: ReachBox<string> = { tagGroups: [npc], handTemplates: [{ id: "t_topics" }], hands: [talking] };
    const topics: ReachCard[] = [
      { id: "c_shoulder", tags: { d_npc: ["v_gareth"] } },
      { id: "c_roads", tags: { d_npc: ["v_gareth", "v_mira"] } },
      { id: "c_mira", tags: { d_npc: ["v_mira"] } },
      { id: "c_weather" },
    ];
    expect(placeTiers(project, talk, talking, topics)).toEqual({
      only: [], zones: [], anywhere: ["c_shoulder", "c_roads", "c_weather"],
    });
  });

  it("refuses an untagged card where a required group is bound, as the runtime does", () => {
    const strict: TagGroup = { ...npc, required: true };
    const talking: Hand<string> = { id: "h_gareth", gameId: "talking-to-gareth", rule: { slots: 1, bindings: { d_npc: "v_gareth" } } };
    const talk: ReachBox<string> = { tagGroups: [strict], handTemplates: [], hands: [talking] };
    expect(placeTiers(project, talk, talking, [{ id: "c_weather" }, { id: "c_g", tags: { d_npc: ["v_gareth"] } }]).anywhere)
      .toEqual(["c_g"]);
  });
});

describe("handReach", () => {
  it("treats a movable hole as a wildcard unless told what it holds", () => {
    const reach = handReach(project, village);
    expect(reach.admits({ id: "x", tags: { d_zone: ["v_forest"] } }, elder)).toBe(true);
    expect(reach.admits({ id: "x", tags: { d_zone: ["v_forest"] } }, elder, { d_zone: "v_cave" })).toBe(false);
    expect(reach.holeRef(elder, "d_zone")).toBe("@story.elder_at");
    expect([...reach.holes(elder)]).toEqual(["d_zone"]);
  });
});
