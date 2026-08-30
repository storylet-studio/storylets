// ---------------------------------------------------------------------------
// freeGameId / freeTitle: the "first name nobody is using yet" rules.
//
// These were TWO hand-written copies until 2026-08-18, one in the editor and one
// in the CLI's kit scaffolder (audit-2026-08's "ten hand-rolled gameId loops").
// They are here now because a gameId is API - deal() and the play log speak it -
// and two copies of an addressing rule drift, so the same act would mint
// different addresses depending on which program ran it. The point of the move
// is that there is one rule; the point of this test is to say what that rule is,
// so a future tidy cannot quietly change it under both callers at once.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { freeGameId, freeTitle } from "../src/index.js";

describe("freeGameId", () => {
  it("returns the base untouched when it is free", () => {
    expect(freeGameId("the-inn", new Set())).toBe("the-inn");
    expect(freeGameId("the-inn", new Set(["tavern"]))).toBe("the-inn");
  });

  it("suffixes from 2, hyphen-separated, at the first gap", () => {
    expect(freeGameId("the-inn", new Set(["the-inn"]))).toBe("the-inn-2");
    expect(freeGameId("the-inn", new Set(["the-inn", "the-inn-2"]))).toBe("the-inn-3");
  });

  it("takes the first free number, not the next after the highest", () => {
    // A hole left by a delete is filled before a new number is minted, which is
    // what the counting loop does and what a "highest + 1" shortcut would not.
    expect(freeGameId("area", new Set(["area", "area-3"]))).toBe("area-2");
  });
});

describe("freeTitle", () => {
  it("dedupes on the DERIVED gameId, not the title", () => {
    // Two titles that slug to one address are the collision that matters: "New
    // box" is taken by anything whose gameId is already `new-box`, whatever its
    // title reads as.
    expect(freeTitle("New box", new Set(["new-box"]))).toBe("New box 2");
    expect(freeTitle("New box", new Set())).toBe("New box");
  });

  it("suffixes with a SPACE, because it is a title a human reads", () => {
    expect(freeTitle("New box", new Set(["new-box", "new-box-2"]))).toBe("New box 3");
  });
});
