// A box's colour is STORED (main box-colours.ts) and this module only remembers
// it: never worked out from the box's place in the project, so reordering the
// boxes changes nothing (the round-3 ruling).

import { describe, expect, it } from "vitest";
import { boxColour, boxColourIndex, setBoxColours } from "./box-tint.js";
import { colourIndex } from "../../shell/colour.js";

describe("box colours", () => {
  it("uses the colour main stored, whatever order the boxes come in", () => {
    setBoxColours([{ id: "b_a", colour: 6 }, { id: "b_b", colour: 0 }]);
    expect(boxColour("b_a")).toBe("var(--char-6)");
    setBoxColours([{ id: "b_b", colour: 0 }, { id: "b_a", colour: 6 }]);
    expect(boxColourIndex("b_a")).toBe(6);
    expect(boxColourIndex("b_b")).toBe(0);
  });

  it("keeps a known colour when told about a box with none, and says when anything changed", () => {
    expect(setBoxColours([{ id: "b_c", colour: 3 }])).toBe(true);
    expect(setBoxColours([{ id: "b_c" }])).toBe(false);
    expect(setBoxColours([{ id: "b_c", colour: 3 }])).toBe(false);
    expect(boxColourIndex("b_c")).toBe(3);
  });

  it("falls back to the hash for a box that has never had one", () => {
    expect(boxColourIndex("b_unknown")).toBe(colourIndex("b_unknown"));
  });
});
