// ---------------------------------------------------------------------------
// Shared builders for the visual expression editors (condition + effects):
// turn the card's ConditionProperty[] into the expr-editor's catalogue and
// ExpressionSchema, and expose the storylets dialect's function templates.
// (Patterpad's expr-shared.ts shape, storylets content.)
// ---------------------------------------------------------------------------

import { callNode, flagDelta, numLit, scopedVar, strLit } from "@wildwinter/expr-editor";
import type { CatalogueEntry, FunctionTemplateSpec } from "@wildwinter/expr-editor";
import type { ExpressionSchema, PropertyMeta } from "@wildwinter/expr";
import type { ConditionProperty } from "../../shared/api.js";

/** Scope display order in the property picker: your own state first. */
export const SCOPE_ORDER = ["story", "world", "box", "deck", "hand"];

export const catalogueFrom = (props: ConditionProperty[]): CatalogueEntry[] =>
  props.map((p) => ({
    scope: p.scope, name: p.name, type: p.type,
    ...(p.enumValues !== undefined ? { enumValues: p.enumValues } : {}),
    // expr-editor 0.11.0 reads `stages` for the stage list, the ordering
    // operators and the advance() seed. Dropping it here left a quality
    // pickable and unfinishable.
    ...(p.stages !== undefined ? { stages: p.stages } : {}),
    ...(p.purpose !== undefined ? { purpose: p.purpose } : {}),
  }));

export function schemaFrom(props: ConditionProperty[]): ExpressionSchema {
  const m = new Map<string, Map<string, PropertyMeta>>();
  for (const p of props) {
    let scope = m.get(p.scope);
    if (!scope) { scope = new Map(); m.set(p.scope, scope); }
    scope.set(p.name.toLowerCase(), {
      type: p.type,
      ...(p.enumValues !== undefined ? { enumValues: p.enumValues } : {}),
      // Without the ladder, validation as you type cannot tell a real stage
      // from a typo, and refuses `>=` on a quality outright.
      ...(p.stages !== undefined ? { stages: p.stages } : {}),
    });
  }
  return { properties: m };
}

/** The storylets condition/effect functions as insertable templates. */
export function storyletFunctions(cat: CatalogueEntry[]): FunctionTemplateSpec[] {
  const flags = cat.find((p) => p.type === "flags");
  // check_flags and random run the editor's built-in guided wizards (the
  // original studio's insert UX); build() is the fallback when a host has no
  // wizards. The disabled branch stays a plain, non-pickable stub.
  const checkFlags: FunctionTemplateSpec = flags
    ? { name: "check_flags", label: "Check flags", hint: "test one or more flags on a flags property", wizard: "check_flags",
        build: () => callNode("check_flags", [scopedVar(flags.scope, flags.name), flagDelta("+", "")]) }
    : { name: "check_flags", label: "Check flags", hint: "requires a flags property", disabled: true,
        build: () => callNode("check_flags", [strLit(""), flagDelta("+", "")]) };
  return [
    checkFlags,
    { name: "random", label: "Random chance", hint: "e.g. random(1, 6) == 1", wizard: "random",
      build: () => callNode("random", [numLit(1), numLit(6)]) },
    { name: "count_played", label: "Times a card played", hint: "count_played(\"card-name\")",
      build: () => callNode("count_played", [strLit("")]) },
    { name: "turns_since_played", label: "Turns since a card played", hint: "9999 when never",
      build: () => callNode("turns_since_played", [strLit("")]) },
  ];
}
