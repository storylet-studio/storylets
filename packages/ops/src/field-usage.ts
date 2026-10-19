// ---------------------------------------------------------------------------
// Field usage: "which cards have mood = tense?". Every node a field is declared
// for, with the value that holds there: the card template's fields on cards,
// the outcome fields on outcomes, and each extension's simple fields on the
// nodes it declares them for. The Find window's Field tab.
//
// What a query means is the family's, not ours: `@wildwinter/toolkit`'s
// `parseFieldQuery` and `fieldValueMatches`, which Patterpad's Field tab asks
// too, so `mood = tense` reads the same in both apps (patterkit
// design/family-parity-2026-10.md item 16).
//
// Read from the COMPILED bundle, as Property usage is: it carries every
// declaration with its default resolved, and each node's extension values with
// the editor-only ones already gone. A node that sets nothing holds the default,
// so `mood = calm` finds the cards that leave a calm mood alone, and says so.
// ---------------------------------------------------------------------------

import { compileProject } from "@storylet-studio/compiler";
import type { Bundle, FieldDecl, NodeExtensions } from "@storylet-studio/model";
import { byDisplayOrder } from "@storylet-studio/model";
import { fieldNameMatches, fieldValueMatches, fieldValueText, parseFieldQuery } from "@wildwinter/toolkit";
import type { FieldQuery } from "@wildwinter/toolkit";
import type { LoadedProject } from "./load.js";
import { indexProject } from "./resolve.js";
import type { ResolveEntry } from "./resolve.js";

export interface FieldUsage {
  /** The field as a query names it: `mood`, or `extension.field`. */
  field: string;
  /** Its declared type, from the family's list. */
  type: string;
  /** The value that holds on the node, raw. */
  value: unknown;
  /** The value as a row shows it (flags joined with commas). */
  text: string;
  /** The node sets nothing, so this is the declaration's default. */
  isDefault: boolean;
  /** Where the field is declared: "card field", "outcome field", or the
   *  extension's id for an extension's field. */
  where: string;
  item: ResolveEntry;
}

/** A field the project declares, for the Field tab's empty state. */
export interface DeclaredField {
  field: string;
  type: string;
  where: string;
}

/** The types a row can show as one value. An extension's record, map, list and
 *  reference fields are structure, not a value to compare, and are left out. */
const SIMPLE = new Set(["text", "multiline", "string", "number", "boolean", "enum", "flags", "quality"]);

/** A declaration as both kinds reach this file. */
interface Decl { name: string; type: string; default?: unknown }

/** One node and the fields declared for it, in project order. */
interface Visit {
  id: string;
  /** The node kind as an extension names it (`handTemplate`, not `template`). */
  kind: string;
  /** The template fields declared for it and the values it sets: a card's or
   *  an outcome's. */
  template?: { decls: readonly FieldDecl[]; values?: Record<string, unknown>; where: string };
  extensions?: NodeExtensions;
}

function* visits(bundle: Bundle): Generator<Visit> {
  for (const box of bundle.boxes) {
    yield { id: box.id, kind: "box", extensions: box.extensions };
    for (const g of box.tagGroups) yield { id: g.id, kind: "tagGroup", extensions: g.extensions };
    for (const deck of box.decks) {
      yield { id: deck.id, kind: "deck", extensions: deck.extensions };
      for (const card of deck.cards) {
        yield { id: card.id, kind: "card", extensions: card.extensions, template: { decls: box.fields, values: card.fields, where: "card field" } };
        for (const outcome of byDisplayOrder(card.outcomes)) {
          yield { id: outcome.id, kind: "outcome", extensions: outcome.extensions, template: { decls: box.outcomeFields ?? [], values: outcome.fields, where: "outcome field" } };
        }
      }
    }
    for (const t of box.handTemplates) yield { id: t.id, kind: "handTemplate", extensions: t.extensions };
    for (const h of box.hands) yield { id: h.id, kind: "hand", extensions: h.extensions };
  }
  const group = bundle.map?.group;
  if (group !== undefined) yield { id: group.id, kind: "tagGroup", extensions: group.extensions };
}

/** Every simple field declared for one node, with what it holds there. */
function* fieldsOf(bundle: Bundle, v: Visit): Generator<Omit<FieldUsage, "item" | "text">> {
  const one = (field: string, d: Decl, values: Record<string, unknown> | undefined, where: string) => {
    const set = values !== undefined && Object.prototype.hasOwnProperty.call(values, d.name);
    return { field, type: d.type, value: set ? values![d.name] : d.default, isDefault: !set, where };
  };
  if (v.template) for (const d of v.template.decls) yield one(d.name, d, v.template.values, v.template.where);
  for (const [ext, compiled] of Object.entries(bundle.extensions ?? {})) {
    for (const d of compiled.fields[v.kind] ?? []) {
      if (SIMPLE.has(d.type)) yield one(`${ext}.${d.name}`, d, v.extensions?.[ext], ext);
    }
  }
}

/**
 * Every node holding a field the query names, in project order (box, its tag
 * groups, each deck then its cards with their outcomes, the hand templates and
 * hands; the map's group last), filtered by the query's value. Empty for a
 * query that is not a field, or a project that does not compile.
 */
export function runFieldUsage(loaded: LoadedProject, query: string): FieldUsage[] {
  const q = parseFieldQuery(query);
  if (!q || !loaded.source) return [];
  const { bundle } = compileProject(loaded.source);
  return bundle ? usagesOf(bundle, new Map(indexProject(loaded).map((e) => [e.id, e])), q) : [];
}

function usagesOf(bundle: Bundle, entries: Map<string, ResolveEntry>, q: FieldQuery): FieldUsage[] {
  const out: FieldUsage[] = [];
  for (const v of visits(bundle)) {
    const item = entries.get(v.id);
    if (!item) continue;
    for (const f of fieldsOf(bundle, v)) {
      if (!fieldNameMatches(f.field, q) || !fieldValueMatches(f.type, f.value, q)) continue;
      out.push({ ...f, text: fieldValueText(f.type, f.value), item });
    }
  }
  return out;
}

/** Every simple field the project declares, once each: the card template's,
 *  the outcome fields', then each extension's, in that order. */
export function declaredFields(loaded: LoadedProject): DeclaredField[] {
  if (!loaded.source) return [];
  const { bundle } = compileProject(loaded.source);
  if (!bundle) return [];
  const seen = new Map<string, DeclaredField>();
  const add = (field: string, type: string, where: string) => { if (!seen.has(field)) seen.set(field, { field, type, where }); };
  for (const box of bundle.boxes) for (const d of box.fields) add(d.name, d.type, "card field");
  for (const box of bundle.boxes) for (const d of box.outcomeFields ?? []) add(d.name, d.type, "outcome field");
  for (const [ext, compiled] of Object.entries(bundle.extensions ?? {})) {
    for (const decls of Object.values(compiled.fields)) for (const d of decls) if (SIMPLE.has(d.type)) add(`${ext}.${d.name}`, d.type, ext);
  }
  return [...seen.values()];
}
