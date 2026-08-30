// The observed-edge overlay's one piece of logic: which of the three states an
// edge is in (design/graphical-views.md 4). Extracted and tested because the
// interesting case is the one nobody would think to click on - a run exists,
// and this edge was never seen - and because "no run at all" must leave every
// edge exactly as it was before any of this.
import { describe, expect, it } from "vitest";
import { edgeEvidence } from "./links-evidence.js";

const seen = { runs: 30, count: 41 };

describe("edgeEvidence", () => {
  it("is absent with no coverage run, so the view draws as it always did", () => {
    expect(edgeEvidence({ via: [] }, undefined)).toBeUndefined();
    expect(edgeEvidence({ via: [], observed: seen }, undefined)).toBeUndefined();
  });

  it("marks an edge a run actually saw", () => {
    expect(edgeEvidence({ via: [], observed: seen }, { runs: 60, at: "" })).toBe("observed");
  });

  it("fades a statically derived edge no run ever saw", () => {
    expect(edgeEvidence({ via: [] }, { runs: 60, at: "" })).toBe("possible");
  });

  it("flags an edge seen but never derived, whatever else it looks like", () => {
    // The disagreement is the point, so it outranks having been observed.
    expect(edgeEvidence({ via: [], observed: seen, flagged: true }, { runs: 60, at: "" })).toBe("flagged");
    expect(edgeEvidence({ via: [], flagged: true }, undefined)).toBe("flagged");
  });
});
