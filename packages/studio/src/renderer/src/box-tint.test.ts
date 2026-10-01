// A box's colour is assigned by its place in the project, not hashed from its
// name (box-tint.ts): Port Meridian's Contracts and News hashed alike, and two
// layers in one colour read as one layer.

import { describe, expect, it } from "vitest";
import { boxColour, boxColourIndex, setBoxOrder } from "./box-tint.js";
import { colourIndex, PALETTE_SIZE } from "../../shell/colour.js";

describe("box colours", () => {
  it("gives each of the first boxes a slot of its own, spread round the wheel", () => {
    const boxes = Array.from({ length: PALETTE_SIZE }, (_, i) => ({ id: `b_${i}` }));
    setBoxOrder(boxes);
    expect(new Set(boxes.map((b) => boxColourIndex(b.id))).size).toBe(PALETTE_SIZE);
    expect(boxColour("b_0")).toBe("var(--char-0)");
    expect(boxColour("b_1")).toBe("var(--char-6)");   // the far side, not the next hue
  });

  it("falls back to the hash beyond the palette, and for a box it has not been told about", () => {
    setBoxOrder(Array.from({ length: PALETTE_SIZE + 1 }, (_, i) => ({ id: `b_${i}` })));
    expect(boxColourIndex(`b_${PALETTE_SIZE}`)).toBe(colourIndex(`b_${PALETTE_SIZE}`));
    expect(boxColourIndex("b_unknown")).toBe(colourIndex("b_unknown"));
  });
});
