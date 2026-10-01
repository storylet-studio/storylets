// The upgrade prompt shows the planner's own lines, in the app's words where the
// CLI's are not true here (map-upgrade-dialog.ts `inAppWords`).

import { describe, expect, it } from "vitest";
import { inAppWords } from "./map-upgrade-dialog.js";

describe("the upgrade report, in the app's words", () => {
  it("says a picture is copied, because the app copies it and the CLI moves it", () => {
    expect(inAppWords("picture moved to assets/harbour.png")).toBe("picture copied to assets/harbour.png");
  });

  it("says to upgrade again rather than to run format", () => {
    expect(inAppWords("the copies disagree; make them agree, then run format again")).toBe("the copies disagree; make them agree, then upgrade the project again");
  });

  it("leaves every other line as the planner wrote it", () => {
    expect(inAppWords("2 frame(s) moved to the project map")).toBe("2 frame(s) moved to the project map");
  });
});
