// ---------------------------------------------------------------------------
// The resolve op: look up an item by its gameId, its id, or its title, and
// report where it lives. One answer behind both `storyletengine resolve` and
// Storyletter's `--at`, so the terminal and the editor cannot disagree about
// what a query names. Pure: indexes the loaded project and returns matches.
// ---------------------------------------------------------------------------

import { SHARD_EXTENSIONS, effectiveGameId } from "@storylet-studio/model";
import type { LoadedProject } from "./load.js";

/** Every item kind that has somewhere to open in the editor. An outcome opens
 *  its card with that outcome expanded. */
export type ResolveKind = "box" | "deck" | "card" | "outcome" | "template" | "hand" | "tagGroup";

export interface ResolveEntry {
  id: string;
  kind: ResolveKind;
  /** The effective gameId: pinned, else derived from the title, else the id. */
  gameId: string;
  title?: string;
  /** The named trail of the containers above it: box, then deck, then (for an
   *  outcome) card. Empty for a box. */
  location: string[];
  /** The ids the editor needs to open it. */
  box: string;
  deck?: string;
  card?: string;
  /** The shard it is written in, relative to the project folder. */
  file: string;
}

/**
 * Look up a query against every item in the project. Matching, in priority
 * order: exact gameId -> exact id -> exact title (case-insensitive) ->
 * substring of gameId / id / title (case-insensitive). The first tier with any
 * hits wins, so an exact match never drowns in fuzzy ones. The gameId leads
 * because it is the name game code and the runtime's logs use; the id is what
 * a shard or a merge sidecar names.
 */
export function runResolve(loaded: LoadedProject, query: string): ResolveEntry[] {
  const q = query.trim();
  if (!q) return [];
  const ql = q.toLowerCase();
  const entries = indexProject(loaded);
  const tiers: Array<(e: ResolveEntry) => boolean> = [
    (e) => e.gameId.toLowerCase() === ql,
    (e) => e.id === q,
    (e) => e.title?.toLowerCase() === ql,
    (e) =>
      e.gameId.toLowerCase().includes(ql) ||
      e.id.toLowerCase().includes(ql) ||
      (e.title?.toLowerCase().includes(ql) ?? false),
  ];
  for (const match of tiers) {
    const hits = entries.filter(match);
    if (hits.length > 0) return hits;
  }
  return [];
}

/** Every box, deck, card, outcome, hand template, hand and tag group, in
 *  project order, with its trail and its shard. */
export function indexProject(loaded: LoadedProject): ResolveEntry[] {
  const out: ResolveEntry[] = [];
  const source = loaded.source;
  if (!source) return out;
  const label = (item: { id: string; gameId?: string; title?: string }): string => item.title ?? effectiveGameId(item);
  for (const box of source.boxes) {
    const b = box.box.box;
    const boxFile = `${box.path}/box${SHARD_EXTENSIONS.box}`;
    const trail = [label(b)];
    out.push({ id: b.id, kind: "box", gameId: effectiveGameId(b), ...titleOf(b), location: [], box: b.id, file: boxFile });
    for (const deck of box.decks) {
      const d = deck.shard.deck;
      out.push({ id: d.id, kind: "deck", gameId: effectiveGameId(d), ...titleOf(d), location: trail, box: b.id, deck: d.id, file: deck.path });
      const deckTrail = [...trail, label(d)];
      for (const card of deck.shard.cards) {
        out.push({ id: card.id, kind: "card", gameId: effectiveGameId(card), ...titleOf(card), location: deckTrail, box: b.id, deck: d.id, card: card.id, file: deck.path });
        const cardTrail = [...deckTrail, label(card)];
        for (const outcome of card.outcomes) {
          out.push({ id: outcome.id, kind: "outcome", gameId: effectiveGameId(outcome), ...titleOf(outcome), location: cardTrail, box: b.id, deck: d.id, card: card.id, file: deck.path });
        }
      }
    }
    const handsFile = `${box.path}/hands${SHARD_EXTENSIONS.hands}`;
    for (const t of box.hands.templates) {
      out.push({ id: t.id, kind: "template", gameId: effectiveGameId(t), ...titleOf(t), location: trail, box: b.id, file: handsFile });
    }
    for (const h of box.hands.hands) {
      out.push({ id: h.id, kind: "hand", gameId: effectiveGameId(h), ...titleOf(h), location: trail, box: b.id, file: handsFile });
    }
    const tagsFile = `${box.path}/tags${SHARD_EXTENSIONS.tags}`;
    for (const g of box.tags.groups) {
      out.push({ id: g.id, kind: "tagGroup", gameId: effectiveGameId(g), location: trail, box: b.id, file: tagsFile });
    }
  }
  return out;
}

const titleOf = (item: { title?: string }): { title?: string } => (item.title !== undefined ? { title: item.title } : {});
