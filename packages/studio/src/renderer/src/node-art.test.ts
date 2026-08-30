// The one part of the node canvas's ink that is testable without a browser: how a
// deck gets laid out. Everything else in node-art paints, and painting is judged
// in the canvas lab (packages/studio/dev).
//
// The rule under test is the promise the arrangement layer makes to an author:
// what you moved stays where you put it, and what you have never touched lays
// out predictably (design/graphical-views.md sections 1.2 and 3).

import { describe, expect, it } from "vitest";
import { gridLayout, NODE_H, NODE_W } from "./node-art.js";

const cards = ["c_1", "c_2", "c_3", "c_4", "c_5"].map((id) => ({ id, title: id, deck: "The Inn" }));

describe("gridLayout", () => {
  it("lays an unarranged deck out in rows, in the deck's own order", () => {
    const nodes = gridLayout(cards, {}, 4);
    expect(nodes.map((n) => n.id)).toEqual(["c_1", "c_2", "c_3", "c_4", "c_5"]);
    // Row one runs left to right; the fifth card starts row two under the first.
    expect(nodes[0]!.y).toBe(nodes[3]!.y);
    expect(nodes[4]!.y).toBeGreaterThan(nodes[0]!.y);
    expect(nodes[4]!.x).toBe(nodes[0]!.x);
    expect(nodes[1]!.x - nodes[0]!.x).toBeGreaterThanOrEqual(NODE_W);
  });

  it("puts an arranged card exactly where the author left it", () => {
    const nodes = gridLayout(cards, { c_3: { x: 617, y: 43 } });
    const third = nodes.find((n) => n.id === "c_3")!;
    expect([third.x, third.y]).toEqual([617, 43]);
  });

  it("mixes the two: placed cards honoured, the rest on the grid", () => {
    // The everyday state of a canvas somebody has half-tidied. An unplaced card
    // must not be shifted around by its neighbours being placed.
    const bare = gridLayout(cards, {});
    const mixed = gridLayout(cards, { c_2: { x: 1000, y: 1000 } });
    expect(mixed.find((n) => n.id === "c_2")).toMatchObject({ x: 1000, y: 1000 });
    for (const id of ["c_1", "c_3", "c_4", "c_5"]) {
      const before = bare.find((n) => n.id === id)!;
      const after = mixed.find((n) => n.id === id)!;
      expect([after.x, after.y]).toEqual([before.x, before.y]);
    }
  });

  it("ignores an entry for a card that is no longer in the deck", () => {
    // Inert, per the sidecar's contract: it must not create a phantom node.
    const nodes = gridLayout(cards, { c_gone: { x: 5, y: 5 } });
    expect(nodes).toHaveLength(cards.length);
    expect(nodes.some((n) => n.id === "c_gone")).toBe(false);
  });

  it("gives every node the face's own size", () => {
    for (const node of gridLayout(cards)) {
      expect([node.width, node.height]).toEqual([NODE_W, NODE_H]);
    }
  });
});
