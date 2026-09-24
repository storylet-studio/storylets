// ---------------------------------------------------------------------------
// Thin wrappers over @wildwinter/expr-editor for the card editor: a condition
// panel (tree mode) and an effects panel (set-only - storylet changes are
// writes; allowEmit: false). Each mounts inline into a host the caller owns;
// the card editor rebuilds around them.
// ---------------------------------------------------------------------------

import { mountEffectsEditor, mountExpressionEditor, renderConditionPreview, renderEffectsPreview } from "@wildwinter/expr-editor";
import type { EditorEffect, EffectsEditorHandle, ExpressionEditorHandle } from "@wildwinter/expr-editor";
import type { Dialect } from "@wildwinter/expr";
import { storyletsDialect, storyletsDialectWith, EXTERNAL_SCOPES } from "@storylet-studio/dialect";
import type { ConditionProperty, GameScopesDto } from "../../shared/api.js";
import { catalogueFrom, schemaFrom, SCOPE_ORDER, storyletFunctions } from "./expr-shared.js";

/**
 * The game's shared scopes folder, as the open project last reported it (patterkit
 * design/shared-scopes.md). Registered by the renderer on every result, like the property
 * navigator below, rather than threaded through every mount site. Its declared scopes arrive
 * in the catalogue with each card; what the editors need beyond that is the dialect, which
 * must accept every token the folder declares (a game's `@player` as well as `@patter`), and
 * which scopes are still unchecked.
 */
let shared: { dialect: Dialect; otherEngineScopes: readonly string[] } = { dialect: storyletsDialect, otherEngineScopes: EXTERNAL_SCOPES };
export function setGameScopes(scopes: GameScopesDto | undefined): void {
  if (scopes === undefined) { shared = { dialect: storyletsDialect, otherEngineScopes: EXTERNAL_SCOPES }; return; }
  // A token the folder declares names its properties, which the catalogue carries, so a name
  // missing from it is worth a mark. The shared vocabulary's tokens nobody declares, and a
  // scope declared opaque, stay the other engine's to check: an ordinary pill.
  const declared = new Set(scopes.tokens.filter((t) => !scopes.opaque.includes(t)));
  shared = {
    dialect: storyletsDialectWith(scopes.tokens),
    otherEngineScopes: [...EXTERNAL_SCOPES.filter((t) => !declared.has(t)), ...scopes.opaque],
  };
}

/** A dialect-aware, non-interactive pill strip for a condition (read-only surfaces). */
export function previewCondition(src: string, properties: ConditionProperty[]): HTMLElement {
  return renderConditionPreview(src, {
    schema: schemaFrom(properties),
    dialect: shared.dialect,
    catalogue: catalogueFrom(properties),
    scopeOrder: SCOPE_ORDER,
    // Another engine's scope (`@patter.visits`) is that engine's to check: an ordinary pill.
    otherEngineScopes: shared.otherEngineScopes,
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
    dialect: shared.dialect,
    catalogue,
    scopeOrder: SCOPE_ORDER,
    otherEngineScopes: shared.otherEngineScopes,
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
    dialect: shared.dialect,
    catalogue,
    scopeOrder: SCOPE_ORDER,
    otherEngineScopes: shared.otherEngineScopes,
    functions: storyletFunctions(catalogue),
    allowEmit: false,   // storylet changes are set-only (schema 3.7)
    onChange: (next) => opts.onChange(
      next.flatMap((e) => (e.kind === "set" ? [{ target: e.target, value: e.value }] : [])),
    ),
    propertyActions,
  });
}
