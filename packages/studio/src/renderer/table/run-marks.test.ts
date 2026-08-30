// The Board's running-position marker. What it points at is decided by two
// facts about the Board (it deals the whole board at once, and a played card
// leaves its hand), so those are what these site.

import { describe, expect, it } from "vitest";
import { runMarks } from "./run-marks.js";

describe("run marks", () => {
  it("says nothing before the first play", () => {
    const marks = runMarks();
    expect(marks.any()).toBe(false);
    expect(marks.now()).toBeUndefined();
    expect(marks.visitedHand("the-inn")).toBe(false);
  });

  it("puts the live position on the hand the last play came from", () => {
    const marks = runMarks();
    marks.played("the-inn", "c_ambush");
    expect(marks.now()).toBe("the-inn");
    marks.played("the-forge", "c_bellows");
    expect(marks.now()).toBe("the-forge");
  });

  it("keeps a trail of every hand played from, the live one included", () => {
    const marks = runMarks();
    marks.played("the-inn", "c_ambush");
    marks.played("the-forge", "c_bellows");
    expect(marks.visitedHand("the-inn")).toBe(true);      // no longer live, still visited
    expect(marks.visitedHand("the-forge")).toBe(true);
    expect(marks.visitedHand("the-mystic-tree")).toBe(false);
  });

  it("remembers a card so it can be marked WHEN IT COMES BACK", () => {
    // The point of the card trail: a played card leaves its hand, and the useful
    // moment is the one where it reappears and you wonder if you have seen it.
    const marks = runMarks();
    marks.played("the-inn", "c_ambush");
    expect(marks.visitedCard("c_ambush")).toBe(true);
    expect(marks.visitedCard("c_last-orders")).toBe(false);
  });

  it("counts a hand played from twice once", () => {
    const marks = runMarks();
    marks.played("the-inn", "c_ambush");
    marks.played("the-inn", "c_last-orders");
    expect(marks.now()).toBe("the-inn");
    expect(marks.visitedHand("the-inn")).toBe(true);
    expect(marks.visitedCard("c_ambush")).toBe(true);
    expect(marks.visitedCard("c_last-orders")).toBe(true);
  });

  it("clears completely on a reset, live position and both trails", () => {
    // A restart, or restoring a snapshot: a different position, which would
    // otherwise inherit a history that never led to it.
    const marks = runMarks();
    marks.played("the-inn", "c_ambush");
    marks.reset();
    expect(marks.any()).toBe(false);
    expect(marks.now()).toBeUndefined();
    expect(marks.visitedHand("the-inn")).toBe(false);
    expect(marks.visitedCard("c_ambush")).toBe(false);
  });
});
