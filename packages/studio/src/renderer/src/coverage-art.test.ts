// The overlay's readings (design/coverage-overlays.md). Pinned here because the
// three card states and the "absent" case are the whole claim the feature makes,
// and getting "not in the run" confused with "never dealt" would turn missing
// evidence into an accusation.
import { describe, expect, it } from "vitest";
import { ageOf, cardHeat, cardHeatTip, coverageLegend, handHeat, handHeatTip, heatInk } from "./coverage-art.js";
import type { CoverageOverlayDto } from "../../shared/api.js";

const AT = "2026-08-15T12:00:00.000Z";
const NOW = Date.parse("2026-08-15T12:00:00.000Z");

const cover = (over: Partial<CoverageOverlayDto> = {}): CoverageOverlayDto => ({
  at: AT, runs: 20,
  cards: {
    c_hot: { dealt: 9, played: 4 },
    c_seen: { dealt: 7, played: 0 },
    c_cold: { dealt: 0, played: 0 },
  },
  hands: { h_busy: 40, h_some: 10, h_never: 0 },
  busiest: 40,
  ...over,
});

const tokens = { warn: "#c80", muted: "#888", danger: "#c00" } as never;

describe("a card's heat", () => {
  it("is cold when it was never dealt", () => {
    expect(cardHeat("c_cold", cover())).toBe("cold");
  });

  it("is unplayed when it came up and was passed over", () => {
    expect(cardHeat("c_seen", cover())).toBe("unplayed");
  });

  it("says nothing about a card that was dealt and played", () => {
    expect(cardHeat("c_hot", cover())).toBe("warm");
  });

  it("is ABSENT, not cold, for a card added since the run", () => {
    // The difference that matters: no evidence is not evidence of nothing.
    expect(cardHeat("c_new", cover())).toBe("absent");
    expect(cardHeatTip("c_new", cover())).toBe("Not in the last coverage run");
  });

  it("is absent with no run at all", () => {
    expect(cardHeat("c_cold", undefined)).toBe("absent");
    expect(cardHeatTip("c_cold", undefined)).toBeUndefined();
  });

  it("puts the numbers on the hover", () => {
    expect(cardHeatTip("c_hot", cover())).toBe("Dealt 9×, played 4× (20 runs)");
    expect(cardHeatTip("c_seen", cover())).toBe("Dealt 7×, never played (20 runs)");
    expect(cardHeatTip("c_cold", cover())).toBe("Never dealt in 20 runs");
    expect(cardHeatTip("c_cold", cover({ runs: 1 }))).toBe("Never dealt in 1 run");
  });

  it("spends amber on cold and never red", () => {
    // Red in this app means the build is broken. Evidence is not that.
    expect(heatInk("cold", tokens)).toBe("#c80");
    expect(heatInk("unplayed", tokens)).toBe("#888");
    expect(heatInk("warm", tokens)).toBeUndefined();
    expect(heatInk("absent", tokens)).toBeUndefined();
  });
});

describe("a hand's heat", () => {
  it("is measured against the busiest hand in the same run", () => {
    expect(handHeat("h_busy", cover())).toBe(1);
    expect(handHeat("h_some", cover())).toBeCloseTo(0.25);
  });

  it("marks a hand nothing was dealt into as its own state, not the coldest", () => {
    expect(handHeat("h_never", cover())).toBe(-1);
    expect(handHeatTip("h_never", cover())).toBe("Never dealt into in 20 runs");
  });

  it("treats a hand missing from the run as unmeasured", () => {
    expect(handHeat("h_new", cover())).toBe(-1);
    expect(handHeatTip("h_new", cover())).toBe("Not in the last coverage run");
  });

  it("does not divide by a busiest of zero", () => {
    expect(handHeat("h_busy", cover({ hands: { h_busy: 0 }, busiest: 0 }))).toBe(-1);
  });
});

describe("the legend", () => {
  it("says there is no run rather than drawing a project of zeroes", () => {
    expect(coverageLegend(undefined, NOW)).toBe("Coverage overlay: no run yet");
  });

  it("dates its evidence", () => {
    expect(coverageLegend(cover(), NOW)).toBe("Coverage from 20 runs, just now");
    expect(coverageLegend(cover(), NOW + 5 * 60000)).toBe("Coverage from 20 runs, 5 minutes ago");
  });

  it("reads its ages the way a person would say them", () => {
    expect(ageOf(AT, NOW)).toBe("just now");
    expect(ageOf(AT, NOW + 60000)).toBe("a minute ago");
    expect(ageOf(AT, NOW + 42 * 60000)).toBe("42 minutes ago");
    expect(ageOf(AT, NOW + 60 * 60000)).toBe("an hour ago");
    expect(ageOf(AT, NOW + 5 * 3600000)).toBe("5 hours ago");
    expect(ageOf(AT, NOW + 40 * 3600000)).toBe("earlier today");
  });
});
