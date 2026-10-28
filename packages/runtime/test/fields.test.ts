// The field read helpers (src/fields.ts): the edges the conformance corpus
// does not reach, since the compiler refuses a bundle that would.
import { describe, expect, it } from "vitest";
import type { Bundle, FieldDecl } from "@storylet-studio/model";
import { effectiveFields, fieldDecls, fieldValue, outcomeFieldDecls, compareStages } from "../src/index.js";

const ACT: FieldDecl = { name: "act", type: "quality", default: "arrival", stages: ["arrival", "act-1", "act-2"] };
const CUE: FieldDecl = { name: "cue", type: "text", default: "" };
const bundle = { boxes: [{ id: "b_1", gameId: "village", fields: [ACT, CUE], outcomeFields: [CUE] }] } as unknown as Bundle;

describe("field helpers", () => {
  it("find a box's declarations by gameId or id, and none for a box not in the bundle", () => {
    expect(fieldDecls(bundle, "village")).toEqual([ACT, CUE]);
    expect(fieldDecls(bundle, "b_1")).toEqual([ACT, CUE]);
    expect(outcomeFieldDecls(bundle, "village")).toEqual([CUE]);
    expect(fieldDecls(bundle, "elsewhere")).toEqual([]);
  });

  it("a value set wins, even when it is the default; an unset one is the default", () => {
    expect(fieldValue([ACT], { act: "act-1" }, "act")).toBe("act-1");
    expect(fieldValue([ACT], {}, "act")).toBe("arrival");
    expect(fieldValue([ACT], undefined, "nothing")).toBeUndefined();
  });

  it("keep a key with no declaration as it is, and never read an inherited name", () => {
    expect(effectiveFields([CUE], { stray: 1 })).toEqual({ cue: "", stray: 1 });
    expect(fieldValue([], {}, "constructor")).toBeUndefined();
  });

  it("hand out a structured default as a copy, so changing it changes no other card's (the hands-on review, 2026-10, foundation 6)", () => {
    const TAGS = { name: "tags", type: "flags", default: ["night"], values: ["night", "rain"] } as unknown as FieldDecl;
    const first = effectiveFields([TAGS], {})["tags"] as unknown as string[];
    first.push("rain");
    expect(TAGS.default).toEqual(["night"]);
    expect(fieldValue([TAGS], undefined, "tags")).toEqual(["night"]);
  });

  it("compare a quality field's stage through its declaration", () => {
    const card = effectiveFields([ACT], { act: "act-2" });
    expect(compareStages(ACT, card["act"], "act-1")).toBe(1);
  });
});
