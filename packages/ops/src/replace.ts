// ---------------------------------------------------------------------------
// Project-wide find-and-replace over the TEXT an author writes: the title and
// purpose of every item (project name, box, deck, card, outcome, hand, hand
// template, tag group) and the string-typed field values on cards. Patter's
// replace.ts, ported to shards (its scope there is the source-language prose).
//
// It NEVER touches ids, gameIds (addresses, edited elsewhere), conditions,
// changes or property declarations: a replace is a writing tool, not a
// refactoring one, and a word that happens to appear in an address should not
// move under you because it also appears in a sentence.
//
// Pure: returns the hits (for a preview / confirm) plus the planned shard
// writes, canonical, which the caller commits through the VC layer.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { canonicalStringify } from "@storylet-studio/compiler";
import type { SourceDeck } from "@storylet-studio/compiler";
import { SHARD_EXTENSIONS, effectiveGameId } from "@storylet-studio/model";
import type { Card, DeckShard, Outcome } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";
import type { ResolveKind } from "./resolve.js";
import type { PlannedWrite } from "./write.js";

export interface ReplaceOptions {
  /** The literal text to find (not a regex: special characters match themselves). */
  query: string;
  /** The literal replacement text. */
  replacement: string;
  /** Match case (default off). */
  caseSensitive?: boolean;
  /** Match whole words only (word boundaries around the query; default off). */
  wholeWord?: boolean;
  /** Restrict the replacement to one item (the per-row "Replace this one"),
   *  and with `onlyField` to one of its texts. */
  onlyId?: string;
  onlyField?: string;
}

/** Which text of an item: its title, its purpose, the project's name, or a
 *  card field (`field:<name>`). */
export type ReplaceField = "title" | "purpose" | "name" | `field:${string}`;

/** One replaced string, for the preview / confirm list. */
export interface ReplaceHit {
  /** The item's id (the project's for its name). */
  id: string;
  kind: "project" | ResolveKind;
  field: ReplaceField;
  /** The trail above it, then the item itself: box › deck › card › outcome. */
  location: string[];
  before: string;
  after: string;
}

export interface ReplacePlan {
  hits: ReplaceHit[];
  /** Shard writes the caller commits through the VC layer (one per touched shard). */
  writes: PlannedWrite[];
  /** Distinct items touched. */
  items: number;
}

/** Build the find matcher, or null for an empty query. Global so every occurrence in a string is replaced. */
function matcher(opts: ReplaceOptions): RegExp | null {
  if (!opts.query) return null;
  const esc = opts.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = opts.wholeWord ? `\\b${esc}\\b` : esc;
  return new RegExp(body, opts.caseSensitive ? "g" : "gi");
}

// The canonical serialiser id-sorts the cards (source rule 6), so a replace
// leaves a shard byte-identical to what a save would have produced.

/**
 * Plan a project-wide replacement. Walks every item's texts, substitutes
 * matches, and returns the hits + the canonical shard writes. Nothing is
 * mutated: touched shards are rebuilt from the loaded ones.
 */
export function runReplace(loaded: LoadedProject, opts: ReplaceOptions): ReplacePlan {
  const plan: ReplacePlan = { hits: [], writes: [], items: 0 };
  const re = matcher(opts);
  const source = loaded.source;
  if (!re || !source) return plan;
  const touched = new Set<string>();

  /** Substitute into one text, recording the hit. Undefined when it is left alone. */
  const sub = (id: string, kind: ReplaceHit["kind"], field: ReplaceField, location: string[], before: string | undefined): string | undefined => {
    if (before === undefined) return undefined;
    if (opts.onlyId !== undefined && id !== opts.onlyId) return undefined;
    if (opts.onlyField !== undefined && field !== opts.onlyField) return undefined;
    re.lastIndex = 0;
    if (!re.test(before)) return undefined;
    const after = before.replace(re, () => opts.replacement); // function form: the replacement is literal ($ safe)
    if (after === before) return undefined;
    plan.hits.push({ id, kind, field, location, before, after });
    touched.add(id);
    return after;
  };

  /** An item with a title and a purpose: both substituted, a copy returned
   *  when either changed. */
  const titled = <T extends { id: string; title?: string; purpose?: string }>(item: T, kind: ReplaceHit["kind"], location: string[]): T | undefined => {
    const title = sub(item.id, kind, "title", location, item.title);
    const purpose = sub(item.id, kind, "purpose", location, item.purpose);
    if (title === undefined && purpose === undefined) return undefined;
    return { ...item, ...(title !== undefined ? { title } : {}), ...(purpose !== undefined ? { purpose } : {}) };
  };

  const label = (item: { id: string; gameId?: string; title?: string }): string => item.title ?? effectiveGameId(item);

  // The project's name.
  const name = sub(source.project.project.id, "project", "name", [], source.project.project.name);
  if (name !== undefined) {
    const next = { ...source.project, project: { ...source.project.project, name } };
    plan.writes.push({ path: join(loaded.dir, source.path), content: canonicalStringify(next) });
  }

  for (const box of source.boxes) {
    const b = box.box.box;
    const trail = [label(b)];
    const nextBox = titled(b, "box", trail);
    if (nextBox) {
      plan.writes.push({ path: join(loaded.dir, box.path, `box${SHARD_EXTENSIONS.box}`), content: canonicalStringify({ ...box.box, box: nextBox }) });
    }

    for (const deck of box.decks) replaceDeck(loaded, deck, trail, titled, sub, label, plan);

    // Hand templates and hands share a shard; tag groups have theirs.
    let handsChanged = false;
    const templates = box.hands.templates.map((t) => { const n = titled(t, "template", trail); if (n) handsChanged = true; return n ?? t; });
    const hands = box.hands.hands.map((h) => { const n = titled(h, "hand", trail); if (n) handsChanged = true; return n ?? h; });
    if (handsChanged) {
      plan.writes.push({ path: join(loaded.dir, box.path, `hands${SHARD_EXTENSIONS.hands}`), content: canonicalStringify({ ...box.hands, templates, hands }) });
    }
    let tagsChanged = false;
    const groups = box.tags.groups.map((g) => {
      const purpose = sub(g.id, "tagGroup", "purpose", trail, g.purpose);
      if (purpose === undefined) return g;
      tagsChanged = true;
      return { ...g, purpose };
    });
    if (tagsChanged) {
      plan.writes.push({ path: join(loaded.dir, box.path, `tags${SHARD_EXTENSIONS.tags}`), content: canonicalStringify({ ...box.tags, groups }) });
    }
  }

  plan.items = touched.size;
  return plan;
}

function replaceDeck(
  loaded: LoadedProject, deck: SourceDeck, trail: string[],
  titled: <T extends { id: string; title?: string; purpose?: string }>(item: T, kind: ReplaceHit["kind"], location: string[]) => T | undefined,
  sub: (id: string, kind: ReplaceHit["kind"], field: ReplaceField, location: string[], before: string | undefined) => string | undefined,
  label: (item: { id: string; gameId?: string; title?: string }) => string,
  plan: ReplacePlan,
): void {
  const d = deck.shard.deck;
  const nextDeck = titled(d, "deck", trail);
  const deckTrail = [...trail, label(d)];
  let changed = nextDeck !== undefined;

  const cards = deck.shard.cards.map((card): Card<string> => {
    const cardTrail = [...deckTrail, label(card)];
    let next: Card<string> = titled(card, "card", deckTrail) ?? card;
    if (next !== card) changed = true;

    // String-typed field values only: a number or a boolean is not text.
    if (card.fields) {
      let fieldsChanged = false;
      const fields = { ...card.fields };
      for (const [fname, value] of Object.entries(card.fields)) {
        if (typeof value !== "string") continue;
        const after = sub(card.id, "card", `field:${fname}`, deckTrail, value);
        if (after !== undefined) { fields[fname] = after; fieldsChanged = true; }
      }
      if (fieldsChanged) { next = { ...next, fields }; changed = true; }
    }

    let outcomesChanged = false;
    const outcomes = card.outcomes.map((o): Outcome<string> => {
      const n = titled(o, "outcome", cardTrail);
      if (n) outcomesChanged = true;
      return n ?? o;
    });
    if (outcomesChanged) { next = { ...next, outcomes }; changed = true; }
    return next;
  });

  if (!changed) return;
  const shard: DeckShard = { ...deck.shard, deck: nextDeck ?? d, cards };
  plan.writes.push({ path: join(loaded.dir, deck.path), content: canonicalStringify(shard) });
}
