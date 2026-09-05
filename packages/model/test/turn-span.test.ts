// ---------------------------------------------------------------------------
// turnSpan: a TIMED box's turns said as time (design/engine-server.md 4.8).
//
// One rule, because the conversion is quoted in four places that a designer
// reads within a minute of each other - the card editor's Redraw field, the
// box page's Turns section, the Board's advance buttons and the coverage
// report's turn budget - and two of them disagreeing about what 30 turns at a
// minute each comes to would be worse than not saying at all.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { turnSpan } from "../src/index.js";

describe("turnSpan", () => {
  it("stays in seconds under a minute", () => {
    expect(turnSpan(2, 20)).toBe("40s");
    expect(turnSpan(2, 20, true)).toBe("40 seconds");
    expect(turnSpan(1, 1, true)).toBe("1 second");
  });

  it("reads minutes when it can, at whatever the box's unit is", () => {
    expect(turnSpan(30, 60)).toBe("30 min");
    expect(turnSpan(30, 60, true)).toBe("30 minutes");
    // The same 30 turns in a 20-second box is a third of the time, which is
    // exactly the arithmetic the card editor is doing for the designer.
    expect(turnSpan(30, 20, true)).toBe("10 minutes");
    expect(turnSpan(1, 60, true)).toBe("1 minute");
  });

  it("gives a fraction of a minute one decimal rather than a false whole", () => {
    expect(turnSpan(5, 20)).toBe("1.7 min");
  });

  it("goes to hours, and drops a zero remainder", () => {
    expect(turnSpan(60, 60)).toBe("1 hr");
    expect(turnSpan(100, 60)).toBe("1 hr 40 min");
    expect(turnSpan(100, 60, true)).toBe("1 hour 40 minutes");
    expect(turnSpan(120, 60, true)).toBe("2 hours");
  });

  it("says nothing silly about zero", () => {
    expect(turnSpan(0, 60)).toBe("0s");
  });
});
