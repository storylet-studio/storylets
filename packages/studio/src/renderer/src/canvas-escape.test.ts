// Escape on a canvas, most local first, and marked handled whenever it does
// anything: the editor reads an UNHANDLED Escape as "go up a level", so the
// canvas has to say when it used the key (canvas-surface `escapeTakes`).

import { describe, expect, it } from "vitest";
import { escapeTakes } from "./canvas-surface.js";

describe("what Escape takes on a canvas", () => {
  it("abandons an armed tool before anything else", () => {
    expect(escapeTakes({ tool: true, marquee: true, selected: 3 })).toBe("tool");
  });

  it("drops a marquee being swept before the selection", () => {
    expect(escapeTakes({ tool: false, marquee: true, selected: 3 })).toBe("marquee");
  });

  it("clears a selection", () => {
    expect(escapeTakes({ tool: false, marquee: false, selected: 1 })).toBe("selection");
  });

  it("leaves the key alone with nothing to undo, so the editor can go up a level", () => {
    expect(escapeTakes({ tool: false, marquee: false, selected: 0 })).toBeUndefined();
  });
});
