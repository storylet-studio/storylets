// The Links window's explanation of one link. Expectations hand-written from what
// a reader has to be able to tell without looking anywhere else: which two cards,
// which way round, and which part of the reason is the property.

import { describe, expect, it } from "vitest";
import { explainEdges, explainLink } from "./links-explain.js";

const VIA = [{ property: "@story.world_events", flag: "tree_bloomed", outcome: "touch-the-bark" }];

describe("the lead", () => {
  it("names both cards and which way the link runs", () => {
    const into = explainLink("The Tree Blooms", "The Glowing Tree", "into", "enable", VIA);
    expect(into.lead).toBe("The Glowing Tree opens The Tree Blooms");

    const out = explainLink("The Tree Blooms", "The Moneylender's Men", "out of", "enable", VIA);
    expect(out.lead).toBe("The Tree Blooms opens The Moneylender's Men");
  });

  it("gives each class its own verb", () => {
    const verbs = (["enable", "disable", "influence"] as const).map(
      (cls) => explainLink("A", "B", "out of", cls, VIA).lead,
    );
    expect(verbs).toEqual(["A opens B", "A shuts B", "A changes what is true for B"]);
    expect(new Set(verbs).size).toBe(3);
  });

  it("writes a reference with the focus first whichever side it was found on", () => {
    // Neither card writes a referenced property, so there is no direction to keep
    // and a direction-shaped sentence would invent one.
    const a = explainLink("Focus", "Other", "into", "reference", [{ property: "@story.gold" }]);
    const b = explainLink("Focus", "Other", "out of", "reference", [{ property: "@story.gold" }]);
    expect(a.lead).toBe("Focus shares state with Other");
    expect(b.lead).toBe(a.lead);
  });
});

describe("the rows", () => {
  it("keeps the property apart from the words about it", () => {
    const rows = explainLink("A", "B", "into", "enable", VIA).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.property).toBe("@story.world_events");
    expect(rows[0]!.detail).toBe("the flag tree_bloomed, written by the outcome touch-the-bark");
  });

  it("names the outcome even with no flag", () => {
    const rows = explainLink("A", "B", "into", "enable", [{ property: "@story.gold", outcome: "accepted" }]).rows;
    expect(rows[0]!.detail).toBe("written by the outcome accepted");
  });

  it("says something for a property nobody writes", () => {
    // A bare property name with no verb anywhere reads as a fragment.
    const rows = explainLink("A", "B", "into", "reference", [{ property: "@story.gold" }]).rows;
    expect(rows[0]!.detail).toBe("read on both sides");
  });

  it("carries a per-reason caveat separately from the phrasing", () => {
    const rows = explainLink("A", "B", "into", "enable", [
      { property: "@box.tension", outcome: "flee", note: "through the deck gate" },
    ]).rows;
    expect(rows[0]!.note).toBe("through the deck gate");
    expect(rows[0]!.detail).not.toContain("deck gate");
  });

  it("gives every contributing property its own row", () => {
    const rows = explainLink("A", "B", "into", "influence", [
      { property: "@story.gold", outcome: "pay" },
      { property: "@story.mood", outcome: "pay" },
      { property: "@world.season" },
    ]).rows;
    expect(rows.map((r) => r.property)).toEqual(["@story.gold", "@story.mood", "@world.season"]);
  });
});

describe("a hovered arrow", () => {
  const names: Record<string, string> = { c_tree: "The Glowing Tree", c_bloom: "The Tree Blooms" };
  const nameOf = (id: string): string => names[id] ?? id;

  it("says what selecting its card in the Links window says, a line each", () => {
    const tip = explainEdges([{ from: "c_tree", to: "c_bloom", cls: "enable", via: [
      ...VIA, { property: "@box.tension", note: "through the deck gate" },
    ] }], nameOf);
    const same = explainLink("The Glowing Tree", "The Tree Blooms", "out of", "enable", VIA);
    expect(tip.split("\n")).toEqual([
      same.lead,
      `@story.world_events ${same.rows[0]!.detail}`,
      "@box.tension read on both sides (through the deck gate)",
    ]);
    expect(tip.split("\n")[0]).toBe("The Glowing Tree opens The Tree Blooms");
  });

  it("explains every edge on the line, in turn", () => {
    const tip = explainEdges([
      { from: "c_tree", to: "c_bloom", cls: "enable", via: [{ property: "@story.gold", outcome: "pay" }] },
      { from: "c_tree", to: "c_bloom", cls: "disable", via: [{ property: "@story.gold", outcome: "steal" }] },
    ], nameOf);
    expect(tip.split("\n")).toEqual([
      "The Glowing Tree opens The Tree Blooms",
      "@story.gold written by the outcome pay",
      "The Glowing Tree shuts The Tree Blooms",
      "@story.gold written by the outcome steal",
    ]);
  });

  it("says a flagged edge was seen but not predicted, having no reason to give", () => {
    const tip = explainEdges([{ from: "c_tree", to: "c_bloom", cls: "enable", via: [], evidence: "flagged" }], nameOf);
    expect(tip).toBe("A coverage run saw The Glowing Tree lead to The Tree Blooms, but the analysis did not predict it.");
  });
});
