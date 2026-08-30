// The driver list's one piece of real logic: reading a value pool the way an
// author types it. A driver that reads "50" as the string "50" would silently
// fail to satisfy `@world.danger >= 50`, so the coercion is the contract.

import { describe, expect, it } from "vitest";
import { parseValues, valuesText } from "./driver-list.js";

describe("driver value pools", () => {
  it("reads booleans, numbers and text as typed", () => {
    expect(parseValues("true, false")).toEqual([true, false]);
    expect(parseValues("0, 50, -3, 1.5")).toEqual([0, 50, -3, 1.5]);
    expect(parseValues("mage, thief")).toEqual(["mage", "thief"]);
  });

  it("keeps a numeral-looking string that is not a plain numeral as text", () => {
    // "007" is an id, not the number 7; round-tripping it as 7 would drive
    // the wrong value. Only a literal that survives Number -> String is a number.
    expect(parseValues("007, 1e3, 12abc")).toEqual(["007", "1e3", "12abc"]);
  });

  it("drops blanks and trims, so a trailing comma is harmless", () => {
    expect(parseValues(" raining ,, , storm,")).toEqual(["raining", "storm"]);
    expect(parseValues("")).toEqual([]);
    expect(parseValues("   ")).toEqual([]);
  });

  it("round-trips through the display text", () => {
    const values = [true, 50, "mage"];
    expect(parseValues(valuesText(values))).toEqual(values);
  });
});
