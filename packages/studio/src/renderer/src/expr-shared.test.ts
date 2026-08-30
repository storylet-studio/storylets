// ---------------------------------------------------------------------------
// What the editor hands to expr-editor. Two functions, both pure, and both
// were missing a quality's ladder until expr-editor 0.11.0 made qualities
// authorable and the gap started to show:
//
//   catalogueFrom -> the picker, the operator step, the stage list
//   schemaFrom    -> the inline validation as you type
//
// A quality without its stages is a property you can pick and then not finish
// a clause on, and one whose gates nothing checks while you write them.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { catalogueFrom, schemaFrom } from "./expr-shared.js";
import type { ConditionProperty } from "../../shared/api.js";

const LADDER = ["quiet", "troubled", "confronted"];
const props: ConditionProperty[] = [
  { scope: "deck", name: "debt", type: "quality", stages: LADDER },
  { scope: "story", name: "weather", type: "enum", enumValues: ["clear", "rain"] },
];

describe("the expr-editor catalogue", () => {
  it("carries a quality's stages, in ladder order", () => {
    const debt = catalogueFrom(props).find((e) => e.name === "debt");
    expect(debt).toMatchObject({ type: "quality", stages: LADDER });
  });

  it("still carries an enum's values", () => {
    expect(catalogueFrom(props).find((e) => e.name === "weather"))
      .toMatchObject({ type: "enum", enumValues: ["clear", "rain"] });
  });
});

describe("the schema the editor validates against as you type", () => {
  it("carries a quality's stages, so a misspelt stage is flagged in the editor", () => {
    const debt = schemaFrom(props).properties.get("deck")?.get("debt");
    expect(debt).toMatchObject({ type: "quality", stages: LADDER });
  });
});
