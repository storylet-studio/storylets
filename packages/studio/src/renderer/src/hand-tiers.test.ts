// The words of a hand's Cards tab (hand-tiers.ts): the Anywhere line says
// exactly what its count holds, whatever the hand binds.

import { describe, expect, it } from "vitest";
import { anywhereLine, gateLabel, movingNote, tierCount, tierLabel } from "./hand-tiers.js";
import type { HandCardsDto } from "../../shared/api.js";

const ref = (card: string) => ({ deck: "k", card });
const base: HandCardsDto = { only: [], never: [], tiers: [], anywhere: [], bound: [], gated: {} };

describe("the Cards tab's words", () => {
  it("says the Anywhere count holds cards that name no hand, at a hand that binds nothing", () => {
    expect(anywhereLine({ ...base, anywhere: [ref("a"), ref("b")] })).toBe("and 2 cards that name no hand, which can come up here too. ");
  });

  it("names the groups the hand binds, so a zone-tagged card at an npc hand is not 'no zone'", () => {
    expect(anywhereLine({ ...base, anywhere: [ref("a")], bound: ["npc"] })).toBe("and 1 card that names no hand and has no npc tag, which can come up here too. ");
    expect(anywhereLine({ ...base, anywhere: [ref("a"), ref("b")], bound: ["district", "npc"] })).toContain("that name no hand and have no district or npc tag");
    expect(anywhereLine(base)).toBeUndefined();
  });

  it("never calls anything a place or a site", () => {
    const words = [
      anywhereLine({ ...base, anywhere: [ref("a")] }), anywhereLine({ ...base, anywhere: [ref("a")], bound: ["npc"] }),
      movingNote({ ...base, moving: true }), tierLabel({ group: "npc", tag: "gareth", cards: [] }),
    ].join(" ");
    expect(words).not.toMatch(/\b(place|site)s?\b/i);
  });

  it("words a tier by its group: a region on the map, a who or where off it", () => {
    expect(tierLabel({ group: "district", tag: "docks", zone: true, cards: [] })).toBe("Anywhere in docks");
    expect(tierLabel({ group: "npc", tag: "gareth", cards: [] })).toBe("Wherever npc is gareth");
    expect(tierLabel({ group: "area", tag: "docks", cards: [] })).toBe("Wherever area is docks");
  });

  it("counts every listed card, and badges a gate", () => {
    const c: HandCardsDto = { ...base, only: [ref("a")], never: [{ ...ref("b"), why: "x" }], tiers: [{ group: "npc", tag: "gareth", cards: [ref("c")] }], anywhere: [ref("d")] };
    expect(tierCount(c)).toBe(4);
    expect(gateLabel({ group: "act", tags: ["act-2"] })).toBe("when act: act-2");
    expect(movingNote(base)).toBeUndefined();
    expect(movingNote({ ...base, moving: true })).toMatch(/moves/);
  });
});
