// What an edge carries out of main. Both link canvases read an edge's reasons now
// (hovering an arrow says why it exists), so the projection from the analyser is
// pinned against the real example project rather than trusted.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { analyseInfluence, cardNeighbourhood } from "@storylet-studio/ops";
import { openProject } from "./project.js";
import { deckEdges, linkReasons } from "./link-graph.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));

describe("linkReasons", () => {
  it("passes the analyser's fields through, leaving out what is not there", () => {
    expect(linkReasons([
      { property: "@story.gold", scope: "story", name: "gold", outcome: "pay" },
      { property: "@story.flags", scope: "story", name: "flags", flag: "met", note: "computed value" },
    ])).toEqual([
      { property: "@story.gold", outcome: "pay" },
      { property: "@story.flags", flag: "met", note: "computed value" },
    ]);
  });
});

describe("deckEdges", () => {
  const opened = openProject(exampleDir);
  if ("error" in opened) throw new Error(opened.error);
  const source = opened.session.loaded.source!;
  const graph = analyseInfluence(source);

  it("gives every edge inside a deck its reasons, as the Links view gives a neighbour", () => {
    let seen = 0;
    for (const deck of source.boxes.flatMap((b) => b.decks)) {
      const ids = new Set(deck.shard.cards.map((c) => c.id));
      const { edges, outside } = deckEdges(graph.edges, ids);
      for (const e of edges) {
        expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
        // Never empty: a derived edge always has a property behind it.
        expect(e.via.length).toBeGreaterThan(0);
        // The same reasons the Links window gets for the same pair and class.
        const n = cardNeighbourhood(source, e.to);
        const match = n.predecessors.find((p) => p.edge.from === e.from && p.edge.cls === e.cls);
        expect(match).toBeDefined();
        expect(e.via).toEqual(linkReasons(match!.edge.via));
        seen++;
      }
      const touching = graph.edges.filter((g) => ids.has(g.from) !== ids.has(g.to)).length;
      expect(outside).toBe(touching);
    }
    // The example has links inside its decks, or this proved nothing.
    expect(seen).toBeGreaterThan(0);
  });
});
