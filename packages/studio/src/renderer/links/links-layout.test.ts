// The Links canvas's arrangement. Expectations hand-written from what the view
// promises a reader (design/graphical-views.md section 4): the focus in the
// middle, what reaches it on the left, what it reaches on the right, and a focus
// that does not wander as the neighbour counts change.

import { describe, expect, it } from "vitest";
import { linksLayout } from "./links-layout.js";

const SIZE = { width: 100, height: 50, gapX: 100, gapY: 10 };
const at = (l: ReturnType<typeof linksLayout>, id: string): { x: number; y: number } =>
  l.placements.find((p) => p.id === id)!;

describe("one hop, three columns", () => {
  it("puts the focus at the origin, reachers left, reached right", () => {
    const l = linksLayout("focus", ["in1", "in2"], ["out1"], SIZE);
    expect(at(l, "focus")).toEqual({ id: "focus", x: 0, y: 0 });
    expect(at(l, "in1").x).toBeLessThan(0);
    expect(at(l, "in2").x).toBeLessThan(0);
    expect(at(l, "out1").x).toBeGreaterThan(0);
    // One column each side, so both reachers share an x.
    expect(at(l, "in1").x).toBe(at(l, "in2").x);
  });

  it("keeps each column in the order it was given", () => {
    const l = linksLayout("focus", ["a", "b", "c"], [], SIZE);
    expect(at(l, "a").y).toBeLessThan(at(l, "b").y);
    expect(at(l, "b").y).toBeLessThan(at(l, "c").y);
  });

  it("centres a column on the focus rather than hanging it from the top", () => {
    const l = linksLayout("focus", ["a", "b", "c"], [], SIZE);
    // Three cards: the middle one sits level with the focus, the others either side.
    expect(at(l, "b").y).toBe(0);
    expect(at(l, "a").y).toBe(-at(l, "c").y);
  });

  it("leaves the focus exactly where it is however many neighbours there are", () => {
    // Walking the graph re-generates this layout at every step. If the focus
    // shifted with the counts, every step would jolt the view.
    for (const [ins, outs] of [[0, 0], [1, 0], [0, 9], [4, 7]] as [number, number][]) {
      const l = linksLayout(
        "focus",
        Array.from({ length: ins }, (_, i) => `in${i}`),
        Array.from({ length: outs }, (_, i) => `out${i}`),
        SIZE,
      );
      expect(at(l, "focus")).toEqual({ id: "focus", x: 0, y: 0 });
    }
  });

  it("places a lone focus with nothing around it", () => {
    const l = linksLayout("focus", [], [], SIZE);
    expect(l.placements).toEqual([{ id: "focus", x: 0, y: 0 }]);
  });
});

describe("the captions", () => {
  it("names all three columns and counts the neighbours", () => {
    // One verb, both directions: a heading describes the cards in ITS column, so
    // the left one is what affects the focus and the right one what the focus
    // affects. ("Reaches" was tried and was not clear either way round.)
    const l = linksLayout("focus", ["a", "b"], ["c"], SIZE);
    expect(l.captions.map((c) => c.text)).toEqual([
      "Affects this card (2)", "This card", "Affected by this card (1)",
    ]);
  });

  it("says so plainly when a side is empty", () => {
    // The old table said this in a hint; a blank column would just look broken.
    const l = linksLayout("focus", [], [], SIZE);
    expect(l.captions.map((c) => c.text)).toEqual([
      "Nothing affects this card", "This card", "This card affects nothing",
    ]);
  });

  it("sits above the tallest column, so it never overlaps a card", () => {
    const l = linksLayout("focus", ["a", "b", "c", "d"], [], SIZE);
    const highestCard = Math.min(...l.placements.map((p) => p.y));
    for (const caption of l.captions) expect(caption.y).toBeLessThan(highestCard);
  });

  it("reports the room the captions need above the cards", () => {
    // The canvas passes this to the surface as a fit margin. If it drifted from
    // where the captions are actually drawn, a fit would frame them off the top of
    // the pane, which is exactly what it did before the number was reported.
    for (const count of [1, 2, 5]) {
      const l = linksLayout("focus", Array.from({ length: count }, (_, i) => `in${i}`), [], SIZE);
      const highestCard = Math.min(...l.placements.map((p) => p.y));
      const highestCaption = Math.min(...l.captions.map((c) => c.y));
      expect(highestCard - highestCaption).toBe(l.fitMargin.top);
    }
  });

  it("reports side room when a column is empty, so its caption stays on screen", () => {
    // An empty column has no cards, so a fit over cards alone stops short of that
    // side and the caption hangs off the edge of the window, half readable, which
    // is what it did.
    const noneLeft = linksLayout("focus", [], ["out"], SIZE);
    expect(noneLeft.fitMargin.left).toBeGreaterThan(0);
    expect(noneLeft.fitMargin.right).toBe(0);

    const noneRight = linksLayout("focus", ["in"], [], SIZE);
    expect(noneRight.fitMargin.right).toBeGreaterThan(0);
    expect(noneRight.fitMargin.left).toBe(0);

    // Enough room for the WHOLE caption, not just its anchor.
    const bothEmpty = linksLayout("focus", [], [], SIZE);
    const capLeft = Math.min(...bothEmpty.captions.map((c) => c.x));
    const cardLeft = Math.min(...bothEmpty.placements.map((p) => p.x));
    expect(bothEmpty.fitMargin.left).toBe(cardLeft - capLeft);
    expect(bothEmpty.fitMargin.right).toBe(bothEmpty.fitMargin.left);
  });

  it("asks for no side room when both columns have cards", () => {
    const l = linksLayout("focus", ["in"], ["out"], SIZE);
    expect(l.fitMargin.left).toBe(0);
    expect(l.fitMargin.right).toBe(0);
  });

  it("puts each caption over its own column", () => {
    const l = linksLayout("focus", ["a"], ["b"], SIZE);
    expect(l.captions[0]!.x).toBe(at(l, "a").x);
    expect(l.captions[1]!.x).toBe(0);
    expect(l.captions[2]!.x).toBe(at(l, "b").x);
  });
});
