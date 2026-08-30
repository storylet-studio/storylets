// Editing a zone's shape: the pure half. Expectations hand-written from what the
// gestures promise an author (design/graphical-views.md section 2): a shape closes
// when you click where you started, a corner can be moved, added or taken away, and
// a zone can never be reduced to something that is not a shape.

import { describe, expect, it } from "vitest";
import { closesShape, withVertexAfter, withVertexAt, withoutVertex } from "./map-edit.js";

const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

describe("closing a traced shape", () => {
  it("closes on a click at the first corner", () => {
    expect(closesShape(SQUARE, { x: 2, y: 2 }, 1)).toBe(true);
  });

  it("does not close on a click anywhere else", () => {
    expect(closesShape(SQUARE, { x: 50, y: 50 }, 1)).toBe(false);
  });

  it("needs three corners before it can close at all", () => {
    // Two points are a line. Closing there would write a zone nobody can see.
    expect(closesShape([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 0, y: 0 }, 1)).toBe(false);
    expect(closesShape([], { x: 0, y: 0 }, 1)).toBe(false);
  });

  it("measures the reach in SCREEN pixels, not world units", () => {
    // Zoomed out, a world-space threshold is impossible to hit: 40 world units from
    // the corner is 4 pixels away at 10%, which is the same gesture as a click on it.
    expect(closesShape(SQUARE, { x: 40, y: 0 }, 1)).toBe(false);
    expect(closesShape(SQUARE, { x: 40, y: 0 }, 0.1)).toBe(true);
  });
});

describe("restacking", () => {
  it("moves one corner and leaves the rest alone", () => {
    expect(withVertexAt(SQUARE, 1, { x: 140, y: -20 })).toEqual([
      { x: 0, y: 0 }, { x: 140, y: -20 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ]);
  });

  it("inserts a corner INTO the edge it was taken from", () => {
    // The mid-edge handle's whole job: a rectangle becomes an L without a mode of
    // its own, so the new corner has to land between its two neighbours rather than
    // at the end of the list.
    const next = withVertexAfter(SQUARE, 1, { x: 100, y: 50 });
    expect(next).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ]);
  });

  it("inserts into the closing edge as well", () => {
    // The edge from the last corner back to the first is an edge like any other.
    expect(withVertexAfter(SQUARE, 3, { x: 0, y: 50 })).toHaveLength(5);
    expect(withVertexAfter(SQUARE, 3, { x: 0, y: 50 })[4]).toEqual({ x: 0, y: 50 });
  });

  it("removes a corner", () => {
    expect(withoutVertex(SQUARE, 2)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }]);
  });

  it("refuses to remove a triangle's corner", () => {
    // Two points are not a shape, and an author who lost a zone to one click would
    // have to draw it again from nothing.
    expect(withoutVertex([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], 0)).toBeUndefined();
  });

  it("never mutates the polygon it was given", () => {
    // The live shape during a drag is derived from the persisted one over and over;
    // mutation there would corrupt the zone by the third frame.
    const before = JSON.stringify(SQUARE);
    withVertexAt(SQUARE, 0, { x: 9, y: 9 });
    withVertexAfter(SQUARE, 0, { x: 9, y: 9 });
    withoutVertex(SQUARE, 0);
    expect(JSON.stringify(SQUARE)).toBe(before);
  });
});
