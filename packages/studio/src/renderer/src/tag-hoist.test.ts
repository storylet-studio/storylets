// ---------------------------------------------------------------------------
// The hoist nudge (design/hand-typing.md step 8): when every tag in a group
// declares the same property, the group form is asking to be used. The nudge
// finds those names; the hoist moves one, turning differing defaults into
// per-tag starting values so nothing about the project's behaviour changes.
// Expectations written before the implementation.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { hoistableProperties, hoistProperty } from "./tag-hoist.js";
import type { TagGroupEdit } from "../../shared/api.js";

const edit = (): Required<Pick<TagGroupEdit, "properties" | "values">> => ({
  properties: [],
  values: [
    { gameId: "wood", properties: [
      { name: "peril", type: "number", default: "0" },
      { name: "only_here", type: "boolean", default: "false" },
    ] },
    { gameId: "moor", properties: [{ name: "peril", type: "number", default: "2" }] },
    { gameId: "fen", properties: [{ name: "peril", type: "number", default: "0" }] },
  ],
});

describe("what can be hoisted", () => {
  it("names a property every tag declares identically apart from its default", () => {
    expect(hoistableProperties(edit())).toEqual(["peril"]);
  });

  it("does not name one that is missing from any tag, or whose types disagree", () => {
    const e = edit();
    e.values[1]!.properties = [{ name: "peril", type: "string", default: "" }];
    expect(hoistableProperties(e)).toEqual([]);
  });

  it("does not name one the group already declares", () => {
    const e = edit();
    e.properties.push({ name: "peril", type: "number", default: "0" });
    expect(hoistableProperties(e)).toEqual([]);
  });

  it("a quality must agree on its whole ladder, not just its type", () => {
    const e = edit();
    for (const v of e.values) v.properties = [{ name: "arc", type: "quality", default: "a", stages: ["a", "b"] }];
    e.values[2]!.properties = [{ name: "arc", type: "quality", default: "a", stages: ["a", "c"] }];
    expect(hoistableProperties(e)).toEqual([]);
    e.values[2]!.properties = [{ name: "arc", type: "quality", default: "b", stages: ["a", "b"] }];
    expect(hoistableProperties(e)).toEqual(["arc"]);
  });

  it("an empty group has nothing to hoist", () => {
    expect(hoistableProperties({ properties: [], values: [] })).toEqual([]);
  });
});

describe("the hoist itself", () => {
  it("moves the declaration up, keeps the majority default, and records the outliers as starting values", () => {
    const e = edit();
    hoistProperty(e, "peril");
    // the group holds the one declaration, at the commonest default (0, twice)
    expect(e.properties).toEqual([{ name: "peril", type: "number", default: "0" }]);
    // no tag declares it any more; the outlier keeps its start as a value
    expect(e.values.map((v) => v.properties.map((p) => p.name))).toEqual([["only_here"], [], []]);
    expect(e.values[1]!.values).toEqual({ peril: "2" });
    // the majority tags carry no redundant value
    expect(e.values[0]!.values ?? {}).toEqual({});
    expect(e.values[2]!.values ?? {}).toEqual({});
  });

  it("leaves the edit alone for a name that is not hoistable", () => {
    const e = edit();
    const before = JSON.stringify(e);
    hoistProperty(e, "only_here");
    expect(JSON.stringify(e)).toBe(before);
  });
});
