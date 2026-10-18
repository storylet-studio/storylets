// A field value between the DTO's text and the shell's field row (field-value.ts).
import { describe, expect, it } from "vitest";
import { parseSource } from "@storylet-studio/compiler";
import { fieldValueFromText, fieldValueToText } from "./field-value.js";

describe("field values across the row", () => {
  it("reads the DTO's text as a typed value", () => {
    expect(fieldValueFromText("text", "")).toBeUndefined();
    expect(fieldValueFromText("number", "3.5")).toBe(3.5);
    expect(fieldValueFromText("number", "lots")).toBe("lots");
    expect(fieldValueFromText("boolean", "false")).toBe(false);
    expect(fieldValueFromText("flags", '["a","b"]')).toEqual(["a", "b"]);
    expect(fieldValueFromText("flags", "a, b")).toEqual(["a", "b"]);
  });

  it("writes text that main reads back as the same value", () => {
    for (const v of ["plain", "true", "12", '"quoted"', "[not a list", "act-1", "two\nlines", 3, false, ["x", "y"]] as const) {
      const text = fieldValueToText(v as never);
      let back: unknown;
      try { back = parseSource(text); } catch { back = text; }
      expect(back).toEqual(v);
    }
    expect(fieldValueToText(undefined)).toBe("");
  });
});
