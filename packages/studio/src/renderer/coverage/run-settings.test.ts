// The Coverage window's run settings and the line that dates its report: a
// blank or zero runs field is refused rather than reporting every card never
// dealt, and a cached report says when it ran and whether the project moved.

import { describe, expect, it } from "vitest";
import { ranLine, runSetting } from "./run-settings.js";

describe("runSetting", () => {
  it("takes a whole number at or above its floor", () => {
    expect(runSetting("200", 1)).toBe(200);
    expect(runSetting(" 7 ", 1)).toBe(7);
    expect(runSetting("0", 0)).toBe(0);   // the seed may be 0
  });

  it("refuses a blank field, zero runs, a negative, a fraction and words", () => {
    expect(runSetting("", 1)).toBeUndefined();
    expect(runSetting("   ", 1)).toBeUndefined();
    expect(runSetting("0", 1)).toBeUndefined();
    expect(runSetting("-3", 0)).toBeUndefined();
    expect(runSetting("2.5", 1)).toBeUndefined();
    expect(runSetting("lots", 1)).toBeUndefined();
  });
});

describe("ranLine", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const stamp = { at: "2026-10-06T11:55:00Z", hash: "abc" };

  it("dates the report", () => {
    expect(ranLine(stamp, false, now)).toBe("Ran 5 minutes ago.");
  });

  it("says when the project has changed since", () => {
    expect(ranLine(stamp, true, now)).toBe("Ran 5 minutes ago. The project has changed since.");
  });

  it("says nothing for an undated report", () => {
    expect(ranLine(undefined, true, now)).toBeUndefined();
  });
});
