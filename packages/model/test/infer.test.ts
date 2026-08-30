// ---------------------------------------------------------------------------
// The declare quick fix's type guess. Worth its own tests because the old
// behaviour (always a number) was wrong for the commonest case by a wide
// margin, and because a WRONG confident guess is worse than no guess: it puts
// a type on a declaration the author then has to notice and undo.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { inferDeclFromWrite } from "../src/infer.js";

describe("inferring a declaration from what an outcome writes", () => {
  it("reads a latch as a boolean, which is the commonest pattern by far", () => {
    // 63 of the ported Village's 66 @deck properties are exactly this.
    expect(inferDeclFromWrite("true")).toEqual({ type: "boolean", default: false });
    expect(inferDeclFromWrite(" false ")).toEqual({ type: "boolean", default: false });
  });

  it("reads a number, including a negative", () => {
    expect(inferDeclFromWrite("3")).toEqual({ type: "number", default: 0 });
    expect(inferDeclFromWrite("-2")).toEqual({ type: "number", default: 0 });
    expect(inferDeclFromWrite("0.5")).toEqual({ type: "number", default: 0 });
  });

  it("reads arithmetic as a number: a counter is written by adding to itself", () => {
    expect(inferDeclFromWrite("@deck.heat + 1")).toEqual({ type: "number", default: 0 });
    expect(inferDeclFromWrite("@story.gold - 5")).toEqual({ type: "number", default: 0 });
  });

  it("reads a quoted literal as a string, defaulting to empty rather than to this value", () => {
    // The value is what ONE outcome sets; the default is what the story starts
    // with, and those are rarely the same thing.
    expect(inferDeclFromWrite('"act-2"')).toEqual({ type: "string", default: "" });
  });

  it("reads flag arithmetic as a flag set", () => {
    expect(inferDeclFromWrite("set_flags(@story.rel_innkeeper, +met)")).toEqual({ type: "flags", default: [] });
    expect(inferDeclFromWrite("clear_flags(@story.lore, -rumour)")).toEqual({ type: "flags", default: [] });
  });

  it("says nothing when it cannot tell, rather than inventing a type", () => {
    // A bare copy from another property: its type is that one's, which this
    // function cannot see. Better to leave the author with the old default than
    // to assert something that reads as decided.
    expect(inferDeclFromWrite("@story.act")).toBeUndefined();
    expect(inferDeclFromWrite("some_function(1)")).toBeUndefined();
    expect(inferDeclFromWrite("")).toBeUndefined();
  });
});
