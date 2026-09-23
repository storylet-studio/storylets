// The one part of the node canvas's ink that is testable without a browser: how a
// deck gets laid out. Everything else in node-art paints, and painting is judged
// in the canvas lab (packages/studio/dev).
//
// The rule under test is the promise the arrangement layer makes to an author:
// what you moved stays where you put it, and what you have never touched lays
// out predictably (design/graphical-views.md sections 1.2 and 3).

import { describe, expect, it } from "vitest";
import Konva from "konva";
import {
  edgesAt, edgeStroke, gridLayout, paintEdges, ARROW_LENGTH, EDGE_HOVER_PX, NODE_H, NODE_W, type CardNode,
} from "./node-art.js";
import type { CanvasTokens } from "./canvas-tokens.js";
import type { GraphEdge } from "../../shared/api.js";

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

// The edges' look is a rule with two readers, the painter and the key
// (edge-key.ts). These pin the rule itself, and that the painter draws exactly
// what it says rather than a private copy of it.
const tokens = {
  ok: "green", danger: "red", warn: "amber", muted: "grey",
} as CanvasTokens;

describe("edgeStroke", () => {
  it("gives each class its ink, and marks a reference as the weakest", () => {
    expect(edgeStroke(tokens, "enable")).toEqual({ ink: "green", width: 1.75, opacity: 1 });
    expect(edgeStroke(tokens, "disable")).toEqual({ ink: "red", width: 1.75, opacity: 1 });
    expect(edgeStroke(tokens, "influence")).toEqual({ ink: "amber", width: 1.75, opacity: 1 });
    expect(edgeStroke(tokens, "reference")).toEqual({ ink: "grey", width: 1.75, dash: [6, 4], opacity: 0.8 });
  });

  it("lays evidence over the class ink rather than replacing it", () => {
    // Observed is simply the edge at full weight: a run confirmed it.
    expect(edgeStroke(tokens, "disable", "observed")).toEqual({ ink: "red", width: 1.75, opacity: 1 });
    // Possible but never seen fades, whatever the class.
    expect(edgeStroke(tokens, "enable", "possible")).toMatchObject({ ink: "green", opacity: 0.35 });
    expect(edgeStroke(tokens, "reference", "possible")).toMatchObject({ opacity: 0.35, dash: [6, 4] });
    // Flagged is heavier and dashed: a disagreement wants a second look.
    expect(edgeStroke(tokens, "enable", "flagged")).toEqual({ ink: "green", width: 3, dash: [6, 4], opacity: 1 });
  });
});

/** Two cards side by side and one below, far enough apart to tell lines apart. */
const at = (() => {
  const place = (id: string, x: number, y: number): CardNode =>
    ({ id, title: id, deck: "d", x, y, width: 100, height: 50 });
  const cards = new Map([place("a", 0, 0), place("b", 300, 0), place("c", 0, 300)].map((c) => [c.id, c]));
  return (id: string): CardNode | undefined => cards.get(id);
})();
const edge = (from: string, to: string, cls: GraphEdge["cls"], evidence?: GraphEdge["evidence"]): GraphEdge =>
  ({ from, to, cls, via: [], ...(evidence ? { evidence } : {}) });

describe("paintEdges", () => {
  it("draws every arrow with edgeStroke's stroke, held constant on screen", () => {
    const layer = new Konva.Group();
    const edges = [edge("a", "b", "reference", "possible"), edge("a", "c", "enable", "flagged")];
    paintEdges(layer, 2, tokens, edges, at);
    const arrows = layer.getChildren() as Konva.Arrow[];
    expect(arrows).toHaveLength(2);
    edges.forEach((e, i) => {
      const want = edgeStroke(tokens, e.cls, e.evidence);
      const arrow = arrows[i]!;
      expect(arrow.stroke()).toBe(want.ink);
      expect(arrow.strokeWidth()).toBe(want.width / 2);
      expect(arrow.dash()).toEqual(want.dash!.map((d) => d / 2));
      expect(arrow.opacity()).toBe(want.opacity);
      expect(arrow.pointerLength()).toBe(ARROW_LENGTH / 2);
    });
  });
});

describe("edgesAt", () => {
  // a -> b runs along y = 25 from x = 100 to x = 300.
  const across = edge("a", "b", "enable");
  // a -> c runs along x = 50 from y = 50 to y = 300.
  const down = edge("a", "c", "disable");

  it("finds the edge within the tolerance, and nothing outside it", () => {
    expect(edgesAt([across, down], at, { x: 200, y: 25 + EDGE_HOVER_PX - 1 }, 1)).toEqual([across]);
    expect(edgesAt([across, down], at, { x: 200, y: 25 + EDGE_HOVER_PX + 1 }, 1)).toEqual([]);
  });

  it("prefers the nearest when two are in reach", () => {
    // Zoomed out to 10% the reach is sixty world units, so near the corner both
    // lines are in it and the closer one answers.
    expect(edgesAt([down], at, { x: 90, y: 70 }, 0.1)).toEqual([down]);
    expect(edgesAt([across], at, { x: 90, y: 70 }, 0.1)).toEqual([across]);
    expect(edgesAt([across, down], at, { x: 90, y: 70 }, 0.1)).toEqual([down]);
    expect(edgesAt([across, down], at, { x: 95, y: 60 }, 0.1)).toEqual([across]);
  });

  it("holds the tolerance on screen, so it narrows in world units as the camera zooms in", () => {
    const point = { x: 200, y: 25 + 10 };
    // Ten world units away: out of reach at 100%, in reach at 50%, where the same
    // six screen pixels cover twelve world units.
    expect(edgesAt([across], at, point, 1)).toEqual([]);
    expect(edgesAt([across], at, point, 0.5)).toEqual([across]);
    // And at 400% even three world units is too far.
    expect(edgesAt([across], at, { x: 200, y: 28 }, 4)).toEqual([]);
  });

  it("returns every edge on the same line, so one cannot hide another", () => {
    const shuts = edge("a", "b", "disable");
    const back = edge("b", "a", "enable");
    expect(edgesAt([across, shuts, back, down], at, { x: 200, y: 26 }, 1)).toEqual([across, shuts, back]);
  });

  it("ignores an edge whose card is not on the canvas", () => {
    expect(edgesAt([edge("a", "gone", "enable")], at, { x: 150, y: 25 }, 1)).toEqual([]);
  });
});
