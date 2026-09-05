// ---------------------------------------------------------------------------
// The play ladder (design/engine-server.md 4.10): what a project CONTAINS,
// measured against the rung it says it is on.
//
// One function, used twice and written once. The compiler calls it to warn
// about a hand-edited shard that sits above its rung, and Storyletter calls it
// to REFUSE a move down the ladder with the list of what is in the way ("3
// declarations are shared, 1 deck is durable"). Two copies of this rule would
// let the editor and the file disagree in silence, which is the exact thing
// the setting exists to prevent.
//
// WHAT IS NOT MEASURED HERE (ruling of 2026-09-05): a timed box and a hand
// that fills a hole from a property are ordinary engine features that any game
// may want, so they are allowed at every rung and no rung hides them. What is
// left is the two flags: `shared`, which the shared rung brings, and
// `durable`, which belongs to the venue rung a Storylet Server sets.
//
// Pure over the parsed source. Nothing here reaches the bundle: the rung is
// authoring shape, not runtime behaviour, and a solo project plays on the same
// Engine as a venue one.
// ---------------------------------------------------------------------------

import { DEFAULT_PLAY_RUNG, effectiveGameId } from "@storylet-studio/model";
import type { PlayRung, PropertyDecl } from "@storylet-studio/model";
import type { SourceProject } from "./project.js";

/** The rungs, lowest first. A feature is visible at its own rung and above. */
export const PLAY_RUNGS: readonly PlayRung[] = ["solo", "shared", "venue"];

const rungIndex = (rung: PlayRung): number => PLAY_RUNGS.indexOf(rung);

/** The rung a project is on: its setting, else the default. */
export const playRungOf = (settings: { play?: PlayRung } | undefined): PlayRung =>
  settings?.play ?? DEFAULT_PLAY_RUNG;

/** What kind of thing sits above a rung. The studio counts by these; the
 *  compiler words its warning from them. */
export type LadderItemKind =
  | "declaration-shared" | "deck-shared" | "card-shared" | "shared-copies"
  | "declaration-durable" | "deck-durable" | "card-durable";

/** The lowest rung that shows a kind of content. */
const NEEDS: Record<LadderItemKind, Exclude<PlayRung, "solo">> = {
  "declaration-shared": "shared",
  "deck-shared": "shared",
  "card-shared": "shared",
  "shared-copies": "shared",
  "declaration-durable": "venue",
  "deck-durable": "venue",
  "card-durable": "venue",
};

/** How each kind reads when it is counted, singular and plural. */
const COUNT_WORDS: Record<LadderItemKind, [string, string]> = {
  "declaration-shared": ["1 declaration is shared", "declarations are shared"],
  "deck-shared": ["1 deck is shared", "decks are shared"],
  "card-shared": ["1 card is shared", "cards are shared"],
  "shared-copies": ["1 card sets In the world", "cards set In the world"],
  "declaration-durable": ["1 declaration is durable", "declarations are durable"],
  "deck-durable": ["1 deck is durable", "decks are durable"],
  "card-durable": ["1 card is durable", "cards are durable"],
};

/** What to do about it instead of moving the rung, in the words of the surface
 *  that carries the setting. */
const REMEDY: Record<LadderItemKind, string> = {
  "declaration-shared": "remove the flag",
  "deck-shared": "remove the flag",
  "card-shared": "remove the flag",
  "shared-copies": "clear the field",
  "declaration-durable": "remove the flag",
  "deck-durable": "remove the flag",
  "card-durable": "remove the flag",
};

/** One thing a project contains that its rung would hide. */
export interface LadderItem {
  kind: LadderItemKind;
  /** The lowest rung that shows it. */
  needs: Exclude<PlayRung, "solo">;
  /** Project-relative shard path, for anchoring a diagnostic. */
  path: string;
  /** The entity it belongs to, as the compiler names entities. */
  where: string;
  /** The thing itself, in the words a message uses ("@story.gold"). */
  what: string;
}

const declItems = (
  decls: PropertyDecl[] | undefined, scope: string, path: string, where: string,
): LadderItem[] => {
  const out: LadderItem[] = [];
  for (const d of decls ?? []) {
    if (d.shared === true) {
      out.push({ kind: "declaration-shared", needs: "shared", path, where, what: `@${scope}.${d.name} is shared` });
    }
    if (d.durable === true) {
      out.push({ kind: "declaration-durable", needs: "venue", path, where, what: `@${scope}.${d.name} is durable` });
    }
  }
  return out;
};

/**
 * Everything in `source` that a project on `rung` would not show, in shard
 * order. An empty list means the rung and the content agree.
 *
 * `@world` is never here: it carries neither flag (both are compile errors on
 * it), and the host's own state is not a thing the ladder hides.
 */
export function contentAboveRung(source: SourceProject, rung: PlayRung): LadderItem[] {
  const allowed = rungIndex(rung);
  const found: LadderItem[] = [];
  const projectPath = source.path;

  found.push(...declItems(source.project.story?.properties, "story", projectPath, "story"));

  for (const box of source.boxes) {
    const boxPath = `${box.path}/box`;
    const boxName = effectiveGameId(box.box.box);
    found.push(...declItems(box.box.box.properties, "box", boxPath, boxName));

    const tagsPath = `${box.path}/tags`;
    for (const group of box.tags?.groups ?? []) {
      const groupName = effectiveGameId(group);
      found.push(...declItems(group.properties, "hand", tagsPath, groupName));
      for (const tag of group.tags ?? []) {
        found.push(...declItems(tag.properties, "hand", tagsPath, `${groupName}/${effectiveGameId(tag)}`));
      }
    }

    const handsPath = `${box.path}/hands`;
    for (const template of box.hands?.templates ?? []) {
      found.push(...declItems(template.properties, "hand", handsPath, effectiveGameId(template)));
    }
    for (const hand of box.hands?.hands ?? []) {
      found.push(...declItems(hand.properties, "hand", handsPath, effectiveGameId(hand)));
    }

    for (const deck of box.decks) {
      const deckDecl = deck.shard.deck;
      const deckName = effectiveGameId(deckDecl);
      found.push(...declItems(deckDecl.properties, "deck", deck.path, deckName));
      if (deckDecl.shared === true) {
        found.push({ kind: "deck-shared", needs: "shared", path: deck.path, where: deckName,
          what: `the deck "${deckName}" is shared` });
      }
      if (deckDecl.durable === true) {
        found.push({ kind: "deck-durable", needs: "venue", path: deck.path, where: deckName,
          what: `the deck "${deckName}" is durable` });
      }
      for (const card of deck.shard.cards ?? []) {
        const cardName = effectiveGameId(card);
        if (card.shared === true) {
          found.push({ kind: "card-shared", needs: "shared", path: deck.path, where: cardName,
            what: `the card "${cardName}" is shared` });
        }
        if (card.sharedCopies !== undefined) {
          found.push({ kind: "shared-copies", needs: "shared", path: deck.path, where: cardName,
            what: `the card "${cardName}" sets how many are in the world` });
        }
        if (card.durable === true) {
          found.push({ kind: "card-durable", needs: "venue", path: deck.path, where: cardName,
            what: `the card "${cardName}" is durable` });
        }
      }
    }
  }

  return found.filter((item) => rungIndex(item.needs) > allowed);
}

/** The refusal's list, one phrase per kind, in the ladder's own order: "3
 *  declarations are shared, 1 deck is durable". */
export function summariseLadder(items: readonly LadderItem[]): string[] {
  const counts = new Map<LadderItemKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const out: string[] = [];
  for (const kind of Object.keys(COUNT_WORDS) as LadderItemKind[]) {
    const n = counts.get(kind);
    if (n === undefined) continue;
    const [one, many] = COUNT_WORDS[kind];
    out.push(n === 1 ? one : `${n} ${many}`);
  }
  return out;
}

/**
 * The warning a shard above its rung earns, worded so the answer is in it:
 * which rung the project is on, what is above it, and the way out.
 *
 * MOVING UP IS ONLY AN ANSWER AS FAR AS SHARED. The venue rung is written by a
 * Storylet Server and by nothing else, so telling an author to set Play to
 * venue would name a move Storyletter does not offer. For a durable flag the
 * only way out named here is to take the flag off.
 */
export function ladderWarning(rung: PlayRung, item: LadderItem): string {
  const remedy = REMEDY[item.kind];
  const way = item.needs === "shared"
    ? `Change Play in Project Settings, or ${remedy}`
    : `${remedy[0]!.toUpperCase()}${remedy.slice(1)}`;
  return `this project is set to ${rung} play; ${item.what}. ${way}`;
}

export { NEEDS as LADDER_NEEDS };
