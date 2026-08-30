// Why the property-name rule is what it is, probed against the real parser rather
// than against a copy of the rule.
//
// Every clause in `isValidPropertyName` exists because `@wildwinter/expr` does
// something with the name the author did not ask for. Patter holds the same test
// against the same rule; if expr's grammar changes, both notice.
import { describe, expect, it } from "vitest";
import { compile } from "@wildwinter/expr";
import { storyletsDialect } from "@storylet-studio/dialect";
import { RESERVED_PROPERTY_NAMES, isValidPropertyName } from "../src/index.js";

const ast = (src: string): unknown => JSON.parse(JSON.stringify(compile(src, storyletsDialect).ast));
const parses = (src: string): boolean => { try { compile(src, storyletsDialect); return true; } catch { return false; } };

describe("the grammar the rule is derived from", () => {
  it("folds case, so a capitalised declaration is unreachable", () => {
    expect(ast("@story.isNight")).toEqual(["sv", "story", "isnight"]);
    expect(isValidPropertyName("isNight")).toBe(false);
  });

  it("reads a hyphen as SUBTRACTION, which is why one is refused", () => {
    // The whole reason this rule is enforced rather than trusted: every other
    // violation is loud, and this one quietly compiles to something else.
    expect(ast("@story.is-night")).toEqual(["bin", "-", ["sv", "story", "is"], ["s", "night"]]);
    expect(isValidPropertyName("is-night")).toBe(false);
  });

  it("refuses a space, a leading digit, and every reserved word", () => {
    expect(parses("@story.is night")).toBe(false);
    expect(parses("@story.9lives")).toBe(false);
    for (const word of RESERVED_PROPERTY_NAMES) {
      expect(parses(`@story.${word}`), `@story.${word}`).toBe(false);
      expect(isValidPropertyName(word), word).toBe(false);
    }
  });

  it("accepts what the rule accepts", () => {
    for (const name of ["gold", "is_night", "_x", "a1", "x_9"]) {
      expect(isValidPropertyName(name), name).toBe(true);
      expect(ast(`@story.${name}`), name).toEqual(["sv", "story", name]);
    }
  });
});
