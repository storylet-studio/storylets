// ---------------------------------------------------------------------------
// Thin wrappers over @wildwinter/expr-editor for the card editor: a condition
// panel (tree mode) and an effects panel (set-only - storylet changes are
// writes; allowEmit: false). Each mounts inline into a host the caller owns;
// the card editor rebuilds around them.
// ---------------------------------------------------------------------------

import { mountEffectsEditor, mountExpressionEditor, renderConditionPreview, renderEffectsPreview } from "@wildwinter/expr-editor";
import type { EditorEffect, EffectsEditorHandle, ExpressionEditorHandle } from "@wildwinter/expr-editor";
import { storyletsDialect } from "@storylet-studio/dialect";
import type { ConditionProperty } from "../../shared/api.js";
import { catalogueFrom, schemaFrom, SCOPE_ORDER, storyletFunctions } from "./expr-shared.js";

/** A dialect-aware, non-interactive pill strip for a condition (read-only surfaces). */
export function previewCondition(src: string, properties: ConditionProperty[]): HTMLElement {
  return renderConditionPreview(src, {
    schema: schemaFrom(properties),
    dialect: storyletsDialect,
    catalogue: catalogueFrom(properties),
    scopeOrder: SCOPE_ORDER,
  });
}

/**
 * Where a right-clicked property pill can take you. Registered once by the
 * renderer (which owns navigation and knows what document is open) rather than
 * threaded through every mount site: the expression editors are leaves, and
 * six call sites passing the same two callbacks is the shape this avoids.
 */
export interface PropertyNavigator {
  goToDefinition(ref: { scope: string; name: string }): void;
  findUsages(ref: { scope: string; name: string }): void;
}
let propertyNav: PropertyNavigator | undefined;
export function setPropertyNavigator(nav: PropertyNavigator): void { propertyNav = nav; }
const propertyActions = (ref: { scope: string; name: string }): { label: string; run: () => void }[] =>
  propertyNav === undefined ? [] : [
    { label: "Go to definition", run: () => propertyNav!.goToDefinition(ref) },
    { label: "Find usages", run: () => propertyNav!.findUsages(ref) },
  ];

export function mountCondition(host: HTMLElement, opts: {
  src: string;
  properties: ConditionProperty[];
  onChange: (src: string) => void;
}): ExpressionEditorHandle {
  const catalogue = catalogueFrom(opts.properties);
  return mountExpressionEditor(host, {
    value: opts.src,
    schema: schemaFrom(opts.properties),
    dialect: storyletsDialect,
    catalogue,
    scopeOrder: SCOPE_ORDER,
    functions: storyletFunctions(catalogue),
    mode: "tree",
    nullLabel: "always",
    onChange: opts.onChange,
    propertyActions,
  });
}

/** An outcome's changes as a set-only effects list. */
export function mountChanges(host: HTMLElement, opts: {
  changes: { target: string; value: string }[];
  properties: ConditionProperty[];
  onChange: (changes: { target: string; value: string }[]) => void;
}): EffectsEditorHandle {
  const catalogue = catalogueFrom(opts.properties);
  const effects: EditorEffect[] = opts.changes.map((c) => ({ kind: "set", target: c.target, value: c.value }));
  return mountEffectsEditor(host, {
    effects,
    schema: schemaFrom(opts.properties),
    dialect: storyletsDialect,
    catalogue,
    scopeOrder: SCOPE_ORDER,
    functions: storyletFunctions(catalogue),
    allowEmit: false,   // storylet changes are set-only (schema 3.7)
    onChange: (next) => opts.onChange(
      next.flatMap((e) => (e.kind === "set" ? [{ target: e.target, value: e.value }] : [])),
    ),
    propertyActions,
  });
}
