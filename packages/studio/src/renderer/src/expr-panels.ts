// ---------------------------------------------------------------------------
// Thin wrappers over @wildwinter/expr-editor for the card editor: a condition
// panel (tree mode) and an effects panel (set-only - storylet changes are
// writes; allowEmit: false). Each mounts inline into a host the caller owns;
// the card editor rebuilds around them.
// ---------------------------------------------------------------------------

import { mountEffectsEditor, mountExpressionEditor, renderConditionPreview, renderEffectsPreview } from "@wildwinter/expr-editor";
import type { CatalogueEntry, EditorEffect, EffectsEditorHandle, ExpressionEditorHandle, StringArgChoices } from "@wildwinter/expr-editor";
import type { Dialect } from "@wildwinter/expr";
import { storyletsDialect, storyletsDialectWith, EXTERNAL_SCOPES } from "@storylet-studio/dialect";
import type { ConditionProperty, GameScopesDto, HostTokensDto, ProjectDto } from "../../shared/api.js";
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
/**
 * `hosts` are the project's own host scopes besides `@world` (`@player`, ...), sent with every
 * project whether or not the game has a scopes folder: without them a project that declares
 * `@player` and has no folder would not parse `@player.hp` here, while the compiler accepts it.
 * A declared one is checked against the catalogue like `@world`; an opaque one is unchecked.
 */
export function setGameScopes(scopes: GameScopesDto | undefined, hosts?: HostTokensDto): void {
  if (scopes === undefined && hosts === undefined) { shared = { dialect: storyletsDialect, otherEngineScopes: EXTERNAL_SCOPES }; return; }
  // A token the folder or the project declares names its properties, which the catalogue
  // carries, so a name missing from it is worth a mark. The shared vocabulary's tokens nobody
  // declares, and a scope declared opaque, stay unchecked: an ordinary pill. Where the project
  // declares a token, its say wins over the folder's (the compiler's rule).
  const tokens = [...new Set([...(hosts?.tokens ?? []), ...(scopes?.tokens ?? [])])];
  const isOpaque = (t: string): boolean => (hosts?.tokens.includes(t) === true ? hosts.opaque : scopes?.opaque ?? []).includes(t);
  const declared = new Set(tokens.filter((t) => !isOpaque(t)));
  const opaque = tokens.filter(isOpaque);
  shared = {
    dialect: storyletsDialectWith(tokens),
    otherEngineScopes: [...EXTERNAL_SCOPES.filter((t) => !declared.has(t)), ...opaque],
  };
}

/**
 * The project's cards, offered for the card a `count_played("...")` or
 * `turns_since_played("...")` names: picked by title, written as the Game ID
 * (the hands-on review, 2026-10: there was no picker, so the author typed a
 * Game ID from memory). Registered with the project, like the scopes above.
 */
let cardChoices: StringArgChoices = {};
export function setCardChoices(project: ProjectDto | undefined): void {
  const cards = (project?.boxes ?? []).flatMap((b) => b.decks.flatMap((d) => d.cards))
    .map((c) => ({ value: c.gameId, ...(c.title ? { label: c.title } : {}) }));
  const list = { choices: cards, placeholder: "pick a card…" };
  cardChoices = cards.length > 0 ? { count_played: list, turns_since_played: list } : {};
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
    stringArgChoices: cardChoices,
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

/**
 * Making a property from the Changes picker (expr-editor 0.18.0, the hands-on
 * review of 2026-10): typing a name no property has offers `+ New property
 * "<name>"`, and choosing it declares the property and goes straight on to its
 * value. Registered once by the renderer, which owns the write (the problems
 * bar's Declare, through main and its version control, undoable), like the
 * navigator above. Null: it didn't land, and the picker stays as it was.
 */
export type PropertyCreator = (name: string, scope: string) => Promise<CatalogueEntry | null>;
let propertyCreator: PropertyCreator | undefined;
export function setPropertyCreator(create: PropertyCreator | undefined): void { propertyCreator = create; }

/**
 * Where a new property can go: `@story` alone, the story's own memory and the
 * one scope that is Storyletter's in every project (as `@patter` is
 * Patterpad's). `@world` and the game's other host scopes are the game's
 * contract, declared in Project Settings; `@box` and `@deck` are a document's
 * own, declared on its Properties tab.
 */
export const NEW_PROPERTY_SCOPES: readonly string[] = ["story"];

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
    stringArgChoices: cardChoices,
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
    stringArgChoices: cardChoices,
    ...(propertyCreator !== undefined ? { onCreateProperty: propertyCreator, newPropertyScopes: NEW_PROPERTY_SCOPES } : {}),
  });
}
