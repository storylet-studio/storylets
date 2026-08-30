// The renderer's path helpers. Small, but the Windows half was wrong in six
// places at once, so it is pinned rather than trusted.
import { describe, expect, it } from "vitest";
import { baseName } from "./paths.js";

describe("baseName", () => {
  it("takes the last segment of a POSIX path", () => {
    expect(baseName("/Users/ian/Projects/the-hamlet.storylets")).toBe("the-hamlet.storylets");
  });

  it("takes the last segment of a WINDOWS path", () => {
    // The bug: `split("/")` finds no separator here, so the whole path came
    // back and the recents list and every export toast read as a full path.
    expect(baseName("C:\\Users\\ian\\Projects\\the-hamlet.storylets")).toBe("the-hamlet.storylets");
  });

  it("handles a mixed path, which Electron dialogs do return", () => {
    expect(baseName("C:\\Users\\ian/Projects\\dist/bundle.storyletsc")).toBe("bundle.storyletsc");
  });

  it("gives back a bare name unchanged", () => {
    expect(baseName("the-hamlet.storylets")).toBe("the-hamlet.storylets");
  });

  it("falls back to the whole string rather than an empty one", () => {
    // A trailing separator would otherwise yield "", and a toast saying
    // "Exported " is worse than one saying too much.
    expect(baseName("/Users/ian/")).toBe("/Users/ian/");
    expect(baseName("")).toBe("");
  });
});
