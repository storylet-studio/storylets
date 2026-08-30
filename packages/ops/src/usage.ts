// ---------------------------------------------------------------------------
// Property usage: "where is @x used?". Every place a property is READ (a
// card's When or priority, a deck's gate, a hand's or hand template's When, an
// outcome's When, a change's value) or WRITTEN (an outcome's change), each hit
// naming the item and, for a write, the outcome that makes it. The Find
// window's Property tab; the CLI could grow it.
//
// Built on the influence analysis rather than a second scan: `propertyRefs`
// and `writesOfCard` (influence.ts) decide what a read and a write are, so the
// Links window and this tab cannot disagree about what counts. Reads come from
// the COMPILED bundle, because that is where a bare `@act` has been resolved to
// its scope (`@story.act`); the source text alone cannot say which scope a bare
// name lands in.
// ---------------------------------------------------------------------------

import { compileProject } from "@storylet-studio/compiler";
import type { Box, Bundle, Card, Expression } from "@storylet-studio/model";
import { byDisplayOrder } from "@storylet-studio/model";
import { effectiveGameId } from "@storylet-studio/model";
import type { AstNode } from "@storylet-studio/model";
import { propertyRefs, writesOfCard } from "./influence.js";
import type { InfluenceScopeName } from "./influence.js";
import type { LoadedProject } from "./load.js";
import { indexProject } from "./resolve.js";
import type { ResolveEntry } from "./resolve.js";

export interface PropertyUsage {
  /** Canonical `@scope.name`. */
  property: string;
  use: "read" | "write";
  /** Which part of the item: "When", "priority", "deck gate", "outcome When",
   *  "outcome change". */
  where: string;
  /** The expression as written: the condition source, or `target ← value`
   *  for a change (the editor's own change-line format). */
  text: string;
  /** The item it happens in. For an outcome's When or change this is the
   *  OUTCOME entry (kind "outcome", so it carries its card), which is what
   *  "with the outcome that writes" means when the row is picked. */
  item: ResolveEntry;
}

const SCOPES = new Set<string>(["world", "story", "box", "deck", "hand"]);

interface Query {
  scope?: InfluenceScopeName;
  /** A box or deck named between scope and name (`@box.village.heat`): an id
   *  or gameId to narrow a container scope to. */
  container?: string;
  name: string;
}

/** `@gold`, `gold`, `@story.act`, `world.time_of_day`, `@box.village.heat`.
 *  A bare name matches that name in any scope; a scoped one only its scope.
 *  Null when the text is not a property reference at all. */
export function parsePropertyQuery(query: string): Query | null {
  const m = /^@?([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_-]*){0,2})$/i.exec(query.trim());
  if (!m) return null;
  const parts = m[1]!.toLowerCase().split(".");
  if (parts.length === 1) return { name: parts[0]! };
  if (!SCOPES.has(parts[0]!)) return null;
  const scope = parts[0] as InfluenceScopeName;
  if (parts.length === 2) return { scope, name: parts[1]! };
  return { scope, container: parts[1]!, name: parts[2]! };
}

/**
 * Every use of the property `query` names, in project order: each deck's gate,
 * then its cards (When, priority, each outcome's When then its changes), then
 * the box's hand templates and hands. Empty for a query that is not a ref, or
 * a project that does not compile.
 */
export function runPropertyUsage(loaded: LoadedProject, query: string): PropertyUsage[] {
  return runPropertyUsageMany(loaded, [query])[0] ?? [];
}

/**
 * The same, for several properties at once, compiling the project ONCE.
 *
 * The Story page asks for a use count beside every declared `@story` property,
 * and asking one at a time meant one full `compileProject` per property: forty
 * declarations on a large project was forty compiles, awaited in series, with
 * the main process blocked throughout. The compile and the entry index are the
 * whole fixed cost here and neither depends on the query.
 *
 * Results are positional: `[i]` answers `queries[i]`.
 */
export function runPropertyUsageMany(loaded: LoadedProject, queries: string[]): PropertyUsage[][] {
  if (!loaded.source) return queries.map(() => []);
  const { bundle } = compileProject(loaded.source);
  if (!bundle) return queries.map(() => []);
  const entries = new Map(indexProject(loaded).map((e) => [e.id, e]));
  return queries.map((query) => usagesOf(bundle, entries, query));
}

function usagesOf(
  bundle: Bundle,
  entries: Map<string, ResolveEntry>,
  query: string,
): PropertyUsage[] {
  const q = parsePropertyQuery(query);
  if (!q) return [];
  const out: PropertyUsage[] = [];

  const matches = (scope: InfluenceScopeName, name: string, box: Box<Expression>, deckId?: string): boolean => {
    if (name !== q.name) return false;
    if (q.scope !== undefined && scope !== q.scope) return false;
    if (q.container === undefined) return true;
    // A container names the box for @box, the deck for @deck; the singletons
    // and @hand have no container to narrow by, so the query simply misses.
    if (scope === "box") return box.id === q.container || effectiveGameId(box) === q.container;
    if (scope === "deck") {
      const deck = box.decks.find((d) => d.id === deckId);
      return deck !== undefined && (deck.id === q.container || effectiveGameId(deck) === q.container);
    }
    return false;
  };

  const reads = (expr: Expression | undefined, item: ResolveEntry | undefined, where: string, box: Box<Expression>, deckId?: string): void => {
    if (!expr || !item) return;
    for (const ref of propertyRefs(expr.ast as AstNode)) {
      if (matches(ref.scope, ref.name, box, deckId)) {
        out.push({ property: `@${ref.scope}.${ref.name}`, use: "read", where, text: expr.src, item });
      }
    }
  };

  for (const box of bundle.boxes) {
    for (const deck of box.decks) {
      reads(deck.condition, entries.get(deck.id), "deck gate", box, deck.id);
      for (const card of deck.cards) usesOfCard(card, box, deck.id, entries, matches, reads, out);
    }
    for (const t of box.handTemplates) reads(t.condition, entries.get(t.id), "When", box);
    for (const h of box.hands) reads(h.rule?.condition, entries.get(h.id), "When", box);
  }
  return out;
}

function usesOfCard(
  card: Card<Expression>, box: Box<Expression>, deckId: string,
  entries: Map<string, ResolveEntry>,
  matches: (scope: InfluenceScopeName, name: string, box: Box<Expression>, deckId?: string) => boolean,
  reads: (expr: Expression | undefined, item: ResolveEntry | undefined, where: string, box: Box<Expression>, deckId?: string) => void,
  out: PropertyUsage[],
): void {
  const cardEntry = entries.get(card.id);
  reads(card.condition, cardEntry, "When", box, deckId);
  if (typeof card.priority !== "number") reads(card.priority, cardEntry, "priority", box, deckId);

  // The writes, by the outcome that makes them. writesOfCard names the outcome
  // by gameId (the influence graph's currency); the row needs the entry.
  const writes = writesOfCard(card, () => {});
  for (const outcome of byDisplayOrder(card.outcomes)) {
    const entry = entries.get(outcome.id);
    if (!entry) continue;
    reads(outcome.condition, entry, "outcome When", box, deckId);
    const gameId = effectiveGameId(outcome);
    for (const [target, expr] of Object.entries(outcome.changes)) {
      const text = `${target} ← ${expr.src}`;
      const written = writes.filter((w) => w.outcome === gameId && `@${w.scope}.${w.name}` === canonicalTarget(target));
      const seen = new Set<string>();
      for (const w of written) {
        const key = `@${w.scope}.${w.name}`;
        if (seen.has(key) || !matches(w.scope, w.name, box, deckId)) continue;
        seen.add(key);
        out.push({ property: key, use: "write", where: "outcome change", text, item: entry });
      }
      // The value may read OTHER properties (`@reputation + 1` reads what it
      // writes, which is the write already listed; `@gold - @price` reads price).
      for (const ref of propertyRefs(expr.ast as AstNode)) {
        const key = `@${ref.scope}.${ref.name}`;
        if (seen.has(key) || !matches(ref.scope, ref.name, box, deckId)) continue;
        out.push({ property: key, use: "read", where: "outcome change", text, item: entry });
      }
    }
  }
}

/** A change target as the analysis names it: `@scope.name`, lower-cased the
 *  way influence.ts folds it (see the note on case there). */
function canonicalTarget(target: string): string {
  const bare = target.startsWith("@") ? target.slice(1) : target;
  return `@${bare.toLowerCase()}`;
}
