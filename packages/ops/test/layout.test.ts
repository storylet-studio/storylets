// ---------------------------------------------------------------------------
// Layout as a verb. Expectations hand-written from what
// design/graphical-views.md section 3 promises an author, not read off the
// implementation:
//
//   - left to right by dependency; unconstrained siblings share a column
//   - unselected cards do not move (they are not in the answer at all)
//   - cycles are NEVER silently broken to force a tree: their members stay
//     together and the loop is reported
//   - the same selection lays out the same way every time
//
// Authoring-side, so it lives here in ops rather than the conformance corpus.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { layoutByDependency } from "../src/layout.js";
import type { LayoutEdge } from "../src/layout.js";

const SIZE = { width: 100, height: 50, gapX: 20, gapY: 10 };
/** Column and row a card landed in, which is what the promises are about. */
const grid = (r: { positions: { id: string; x: number; y: number }[] }): Record<string, [number, number]> =>
  Object.fromEntries(r.positions.map((p) => [p.id, [p.x / 120, p.y / 60] as [number, number]]));

const link = (from: string, to: string, cls = "enable"): LayoutEdge => ({ from, to, cls });

describe("dependency order", () => {
  it("lays a chain out left to right", () => {
    const r = layoutByDependency(["a", "b", "c"], [link("a", "b"), link("b", "c")], SIZE);
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0], c: [2, 0] });
    expect(r.cycles).toEqual([]);
  });

  it("gives unconstrained siblings the same column", () => {
    // b and c both wait on a and on nothing else: they are peers, and peers are
    // a column, not a queue.
    const r = layoutByDependency(["a", "b", "c"], [link("a", "b"), link("a", "c")], SIZE);
    const g = grid(r);
    expect(g["a"]).toEqual([0, 0]);
    expect(g["b"]![0]).toBe(1);
    expect(g["c"]![0]).toBe(1);
    expect(g["b"]![1]).not.toBe(g["c"]![1]);
  });

  it("puts a card one column right of the LAST thing it depends on", () => {
    // A diamond: d waits on b and c, so it cannot sit beside them.
    const r = layoutByDependency(
      ["a", "b", "c", "d"],
      [link("a", "b"), link("a", "c"), link("b", "d"), link("c", "d")],
      SIZE,
    );
    const g = grid(r);
    expect(g["a"]![0]).toBe(0);
    expect(g["b"]![0]).toBe(1);
    expect(g["c"]![0]).toBe(1);
    expect(g["d"]![0]).toBe(2);
  });

  it("respects the LONGEST path, not the shortest", () => {
    // a -> b -> c, and also a -> c. If c were placed by the short link it would
    // sit beside b with an edge pointing backwards into its own column. The
    // diamond above does not catch this: both its paths are the same length.
    const r = layoutByDependency(["a", "b", "c"], [link("a", "b"), link("b", "c"), link("a", "c")], SIZE);
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0], c: [2, 0] });
  });

  it("starts every independent chain at the left", () => {
    const r = layoutByDependency(["a", "b", "x", "y"], [link("a", "b"), link("x", "y")], SIZE);
    const g = grid(r);
    expect(g["a"]![0]).toBe(0);
    expect(g["x"]![0]).toBe(0);
    expect(g["b"]![0]).toBe(1);
    expect(g["y"]![0]).toBe(1);
    // Two chains, two rows: they do not pile on top of each other.
    expect(g["a"]![1]).not.toBe(g["x"]![1]);
  });

  it("places cards with no links at all in rows, in deck order", () => {
    // Nothing to layer by, so nothing pretends to be a flow: rows, reading
    // order (the full grid promise is pinned below).
    const r = layoutByDependency(["a", "b", "c"], [], SIZE);
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0], c: [0, 1] });
  });
});

describe("what does not order anything", () => {
  it("ignores reference edges", () => {
    // "Both read @world.season" is a kinship, not a dependency: layering by it
    // would invent a direction the analyser never claimed.
    const r = layoutByDependency(["a", "b"], [link("a", "b", "reference")], SIZE);
    // With the edge ignored the pair is unlinked, so they sit side by side in
    // the grid: what matters is that neither ended up a COLUMN right of the
    // other on the strength of a shared read.
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0] });
  });

  it("ignores links to cards outside the selection", () => {
    // Unselected cards do not move, and must not drag the selection about either.
    const r = layoutByDependency(["a", "b"], [link("outside", "a"), link("b", "outside")], SIZE);
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0] });
    expect(r.positions.some((p) => p.id === "outside")).toBe(false);
  });

  it("ignores a card that links to itself", () => {
    const r = layoutByDependency(["a", "b"], [link("a", "a"), link("a", "b")], SIZE);
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0] });
    expect(r.cycles).toEqual([]);
  });
});

describe("cycles are reported, never hidden", () => {
  it("keeps a loop's cards together and names them", () => {
    // Three cards that enable each other have no internal order to respect. They
    // share a column, and the author is told - breaking the loop silently to
    // force a tree would be a lie about their content.
    const r = layoutByDependency(
      ["a", "b", "c"],
      [link("a", "b"), link("b", "c"), link("c", "a")],
      SIZE,
    );
    expect(r.cycles).toEqual([["a", "b", "c"]]);
    const g = grid(r);
    expect(g["a"]![0]).toBe(0);
    expect(g["b"]![0]).toBe(0);
    expect(g["c"]![0]).toBe(0);
  });

  it("still orders everything around the loop", () => {
    // start -> (a <-> b) -> end. The loop is one unit, so what feeds it is left
    // of it and what it feeds is right of it.
    const r = layoutByDependency(
      ["start", "a", "b", "end"],
      [link("start", "a"), link("a", "b"), link("b", "a"), link("b", "end")],
      SIZE,
    );
    const g = grid(r);
    expect(g["start"]![0]).toBe(0);
    expect(g["a"]![0]).toBe(1);
    expect(g["b"]![0]).toBe(1);
    expect(g["end"]![0]).toBe(2);
    expect(r.cycles).toEqual([["a", "b"]]);
  });

  it("reports two separate loops separately", () => {
    const r = layoutByDependency(
      ["a", "b", "x", "y"],
      [link("a", "b"), link("b", "a"), link("x", "y"), link("y", "x")],
      SIZE,
    );
    expect(r.cycles).toEqual([["a", "b"], ["x", "y"]]);
  });
});

describe("weaker edges order what they can, and never weld a loop", () => {
  // The classes rank enable > disable > influence: an enable is the analyser's
  // strongest claim about play order, a disable is still a definite direction
  // (playing A stops B being offered), an influence is only "A touches what B
  // reads". Layering follows the strongest claims and takes each weaker edge
  // only where it does not contradict them - so a deck dense with back-edges
  // lays out by its enable skeleton instead of collapsing into one column.
  it("a disable back-edge does not weld the pair it answers", () => {
    // a enables b; playing b stops a. The old reading called that a cycle and
    // stacked both in one column; the story reads a-then-b.
    const r = layoutByDependency(["a", "b"], [link("a", "b"), link("b", "a", "disable")], SIZE);
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0] });
    expect(r.cycles).toEqual([]);
  });

  it("orders by a disable when nothing stronger disagrees", () => {
    const r = layoutByDependency(["a", "b"], [link("a", "b", "disable")], SIZE);
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0] });
  });

  it("drops the influence that contradicts a disable", () => {
    const r = layoutByDependency(["a", "b"], [link("a", "b", "influence"), link("b", "a", "disable")], SIZE);
    expect(grid(r)).toEqual({ b: [0, 0], a: [1, 0] });
  });

  it("an influence chain still reads left to right", () => {
    const r = layoutByDependency(["a", "b", "c"],
      [link("a", "b", "influence"), link("b", "c", "influence")], SIZE);
    expect(grid(r)).toEqual({ a: [0, 0], b: [1, 0], c: [2, 0] });
  });

  it("mutual influence keeps the deck's own direction", () => {
    // Each writes what the other reads: a real both-ways relationship, so the
    // tie is broken the way every other tie is - by the deck's order - rather
    // than by stacking the pair.
    const one = grid(layoutByDependency(["a", "b"], [link("a", "b", "influence"), link("b", "a", "influence")], SIZE));
    const other = grid(layoutByDependency(["b", "a"], [link("a", "b", "influence"), link("b", "a", "influence")], SIZE));
    expect(one).toEqual({ a: [0, 0], b: [1, 0] });
    expect(other).toEqual({ b: [0, 0], a: [1, 0] });
  });

  it("an enable loop still collapses and is still reported", () => {
    // The rule that shaped the algorithm is untouched where it is TRUE: cards
    // that enable each other in a loop have no internal order to respect.
    const r = layoutByDependency(["a", "b", "s"],
      [link("s", "a"), link("a", "b"), link("b", "a")], SIZE);
    const g = grid(r);
    expect(g["a"]![0]).toBe(1);
    expect(g["b"]![0]).toBe(1);
    expect(r.cycles).toEqual([["a", "b"]]);
  });
});

describe("cards the graph says nothing about wrap into a grid", () => {
  it("an unlinked deck is a grid, not a column", () => {
    // Nine cards, no links: there is no dependency story to draw, so the shape
    // is the reading shape - rows - not a column taller than any screen.
    const r = layoutByDependency(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i"], [], SIZE);
    expect(grid(r)).toEqual({
      a: [0, 0], b: [1, 0], c: [2, 0],
      d: [0, 1], e: [1, 1], f: [2, 1],
      g: [0, 2], h: [1, 2], i: [2, 2],
    });
  });

  it("the unlinked rest sits below the flow", () => {
    // A two-card story plus three cards the graph says nothing about: the flow
    // reads left to right, and the rest fills rows underneath it in deck order.
    const r = layoutByDependency(["a", "b", "c", "d", "e"], [link("a", "b")], SIZE);
    expect(grid(r)).toEqual({
      a: [0, 0], b: [1, 0],
      c: [0, 1], d: [1, 1],
      e: [0, 2],
    });
  });
});

describe("the arrangement is the author's, and stable", () => {
  it("lays the same selection out the same way twice", () => {
    const ids = ["a", "b", "c", "d"];
    const edges = [link("a", "c"), link("b", "c"), link("c", "d")];
    expect(grid(layoutByDependency(ids, edges, SIZE))).toEqual(grid(layoutByDependency(ids, edges, SIZE)));
  });

  it("breaks ties by the deck's own order", () => {
    // Nothing in the graph separates b and c, so the deck decides, and reversing
    // the deck reverses them.
    const edges = [link("a", "b"), link("a", "c")];
    const one = grid(layoutByDependency(["a", "b", "c"], edges, SIZE));
    const other = grid(layoutByDependency(["a", "c", "b"], edges, SIZE));
    expect(one["b"]![1]).toBe(0);
    expect(other["c"]![1]).toBe(0);
  });

  it("starts where it is told", () => {
    const r = layoutByDependency(["a", "b"], [link("a", "b")], { ...SIZE, origin: { x: 200, y: 60 } });
    expect(r.positions).toEqual([
      { id: "a", x: 200, y: 60 },
      { id: "b", x: 320, y: 60 },
    ]);
  });
});
