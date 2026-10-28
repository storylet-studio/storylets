// ---------------------------------------------------------------------------
// Field read helpers: a box's card and outcome fields, and any node's Storylet
// extension values, as a host reads them.
//
// The engine hands a card's fields (and an outcome's) to the host exactly as
// the bundle wrote them: sparse, a field the card leaves out simply absent.
// That is deliberate, because "the card sets nothing" and "the card sets the
// default" are different facts a host may care about. Most hosts want the
// filled-in picture, though, and the declared defaults ride in the bundle, so
// these pure helpers do that resolution once rather than in every game.
//
// Patter's gameData helpers (gameDataFields, gameDataValue, effectiveGameData)
// are the same idea, by the same rule (patterkit design/family-parity-2026-10.md
// item 7), and every Storylet Engine runtime carries these four.
//
// Extension values follow the same rule (patterkit design/proposals/
// patter-storylet-extensions.md, "At runtime"): raw on the node, declarations
// with every default resolved in the bundle, and the SAME two helpers fill
// them in, given `extensionDecls`. `extensionsOf` reads the values of a node
// no view carries (a deck, a hand, a tag), by the address a game already uses.
// ---------------------------------------------------------------------------

import type { Bundle, ExtensionFieldDecl, FieldDecl, NodeExtensions, ScalarValue } from "@storylet-studio/model";

type BundleBoxes = Pick<Bundle, "boxes">;

const boxOf = (bundle: BundleBoxes, box: string) =>
  bundle.boxes.find((b) => b.gameId === box) ?? bundle.boxes.find((b) => b.id === box);

const own = (record: object, name: string): boolean => Object.prototype.hasOwnProperty.call(record, name);

/** A box's card template, by its gameId (or id). Empty when the box declares
 *  none or is not in the bundle. */
export function fieldDecls(bundle: BundleBoxes, box: string): FieldDecl[] {
  return boxOf(bundle, box)?.fields ?? [];
}

/** A box's outcome fields, by its gameId (or id). Empty when it declares none. */
export function outcomeFieldDecls(bundle: BundleBoxes, box: string): FieldDecl[] {
  return boxOf(bundle, box)?.outcomeFields ?? [];
}

/** A declaration as the two helpers below read it: a field's, or an extension field's. */
interface Declared<V> { readonly name: string; readonly default?: V }

/** One field's effective value: the card's (or outcome's) own when it sets
 *  one, else the field's declared default; undefined for a name declared
 *  nowhere and set nowhere. */
export function fieldValue<V = ScalarValue>(
  decls: readonly Declared<V>[], values: Readonly<Record<string, V>> | undefined, name: string,
): V | undefined {
  if (values !== undefined && own(values, name)) return values[name];
  // The declaration's own default is the bundle's, shared by every card that
  // leaves the field out: a structured one is handed out as a copy, or a game
  // changing it would change it for all of them (the hands-on review, 2026-10,
  // foundation 6).
  const fallback = decls.find((f) => f.name === name)?.default;
  return fallback !== null && typeof fallback === "object" ? structuredClone(fallback) : fallback;
}

/** Every declared field resolved (the value set, else the default), plus any
 *  key set with no declaration, kept as it is. */
export function effectiveFields<V = ScalarValue>(
  decls: readonly Declared<V>[], values: Readonly<Record<string, V>> | undefined,
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const f of decls) {
    const v = fieldValue(decls, values, f.name);
    if (v !== undefined) out[f.name] = v;
  }
  for (const [k, v] of Object.entries(values ?? {})) if (!own(out, k)) out[k] = v;
  return out;
}

/** One extension's declarations for a node kind (`card`, `outcome`, `box`,
 *  `deck`, `tagGroup`, `tag`, `handTemplate`, `hand`, `project`), every default
 *  resolved. Empty when the bundle has no such extension or it declares nothing
 *  for the kind. */
export function extensionDecls(bundle: Pick<Bundle, "extensions">, extension: string, kind: string): ExtensionFieldDecl[] {
  const ext = bundle.extensions !== undefined && own(bundle.extensions, extension) ? bundle.extensions[extension] : undefined;
  return ext !== undefined && own(ext.fields, kind) ? ext.fields[kind] ?? [] : [];
}

/**
 * A node's extension values, by extension id, raw; `{}` when it has none or the
 * address names nothing. For the nodes no view carries, by the names a game
 * already holds: `project` (no address); `box`, `deck`, `card` and `hand` by
 * gameId; `handTemplate` as "box/template"; `outcome` as "card/outcome";
 * `tagGroup` and `tag` as "box/name", or the bare name for the project map's.
 */
export function extensionsOf(bundle: Pick<Bundle, "boxes" | "map" | "extensions">, kind: string, address = ""): NodeExtensions {
  // A copy, as the engine's views are: the game holds the bundle, but what it
  // is handed here is its own to change.
  const values = (node: { extensions?: NodeExtensions } | undefined): NodeExtensions => structuredClone(node?.extensions ?? {});
  const [first, second] = address.includes("/") ? [address.slice(0, address.indexOf("/")), address.slice(address.indexOf("/") + 1)] : [address, undefined];
  const named = <T extends { id: string; gameId?: string }>(items: readonly T[], name: string): T | undefined =>
    items.find((x) => (x.gameId ?? x.id) === name);
  const cards = () => bundle.boxes.flatMap((b) => b.decks.flatMap((d) => d.cards));
  switch (kind) {
    case "project": {
      const out: NodeExtensions = {};
      for (const [id, ext] of Object.entries(bundle.extensions ?? {})) if (ext.project !== undefined) out[id] = structuredClone(ext.project);
      return out;
    }
    case "box": return values(named(bundle.boxes, address));
    case "deck": return values(named(bundle.boxes.flatMap((b) => b.decks), address));
    case "card": return values(named(cards(), address));
    case "outcome": return second === undefined ? {} : values(named(named(cards(), first)?.outcomes ?? [], second));
    case "hand": return values(named(bundle.boxes.flatMap((b) => b.hands), address));
    case "handTemplate": return second === undefined ? {} : values(named(named(bundle.boxes, first)?.handTemplates ?? [], second));
    case "tagGroup":
      if (second === undefined) return bundle.map !== undefined && (bundle.map.group.gameId ?? bundle.map.group.id) === first ? values(bundle.map.group) : {};
      return values(named(named(bundle.boxes, first)?.tagGroups ?? [], second));
    case "tag":
      if (second === undefined) return values(bundle.map !== undefined ? named(bundle.map.group.tags, first) : undefined);
      return values(named((named(bundle.boxes, first)?.tagGroups ?? []).flatMap((g) => g.tags), second));
    default: return {};
  }
}
