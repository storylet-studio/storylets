// The play ladder's visibility rules (design/engine-server.md 4.10), stated as
// the table in the design does: one case per rung, listing everything that
// rung shows. A rule that moves has to move here first, which is the whole
// reason the predicate is one module and not six conditions.
import { describe, expect, it } from "vitest";
import { PLAY_RUNGS, playRung, setPlayRung, shows, shownAt } from "./play-ladder.js";

describe("the play ladder", () => {
  it("solo hides the sharing controls, and only those", () => {
    // The timed box and the movable hole are general engine features, not
    // venue ones (ruling of 2026-09-05), so the plainest project has both.
    expect(shownAt("solo")).toEqual(["timedBox", "propertyHole"]);
  });

  it("shared adds sharing and nothing else", () => {
    expect(shownAt("shared")).toEqual(["sharing", "timedBox", "propertyHole"]);
  });

  it("venue, which only a server sets, adds durability and the run boundary", () => {
    expect(shownAt("venue")).toEqual(["sharing", "durable", "timedBox", "propertyHole", "runGestures"]);
  });

  it("nothing an author can choose shows durability or the run boundary", () => {
    for (const rung of ["solo", "shared"] as const) {
      expect(shows("durable", rung)).toBe(false);
      expect(shows("runGestures", rung)).toBe(false);
    }
  });

  it("each rung shows everything the one below it shows", () => {
    for (let i = 1; i < PLAY_RUNGS.length; i++) {
      const below = shownAt(PLAY_RUNGS[i - 1]!);
      expect(shownAt(PLAY_RUNGS[i]!)).toEqual(expect.arrayContaining(below));
    }
  });

  it("defaults to solo, and a project with no setting is a solo project", () => {
    setPlayRung(undefined);
    expect(playRung()).toBe("solo");
    expect(shows("sharing")).toBe(false);
    expect(shows("timedBox")).toBe(true);
    expect(shows("propertyHole")).toBe(true);
  });

  it("answers for the window's own rung once it is seeded", () => {
    setPlayRung("shared");
    expect(shows("sharing")).toBe(true);
    expect(shows("durable")).toBe(false);
    setPlayRung("venue");
    expect(shows("durable")).toBe(true);
    expect(shows("runGestures")).toBe(true);
    setPlayRung("solo");   // leave it where the other tests expect it
  });
});
