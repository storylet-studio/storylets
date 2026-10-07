// ---------------------------------------------------------------------------
// Finding things in the loaded project, and the writes that put a shard back.
//
// Every mutation edits the source shard model in place and then writes the
// shard it changed, whole and canonical. The finding and the writing were
// spelt out at each call site (twelve hands-shard writes, ten deck writes, six
// tags writes); they are written once here, beside the small rules every
// mutation shares: how a gone thing is refused, how a reorder picks its
// number, how a copy's address is deduped.
// ---------------------------------------------------------------------------

import { join } from "node:path";
import { canonicalStringify } from "@storylet-studio/compiler";
import type { SourceBox, SourceDeck } from "@storylet-studio/compiler";
import { projectMapPath } from "@storylet-studio/ops";
import { SHARD_EXTENSIONS, effectiveGameId, freeGameId, gameIdify, isValidGameId } from "@storylet-studio/model";
import type { DeckShard, TagGroup } from "@storylet-studio/model";
import type { FileState } from "../history.js";
import { boxWithMap } from "../project.js";
import type { ProjectSession } from "../project.js";
import { allFinite } from "../trust.js";

// --- finding -------------------------------------------------------------------

export interface Located {
  box: SourceBox;
  deck: SourceDeck;
}

export function locate(session: ProjectSession, deckId: string): Located | undefined {
  for (const box of session.loaded.source!.boxes) {
    const deck = box.decks.find((d) => d.shard.deck.id === deckId);
    if (deck) return { box, deck };
  }
  return undefined;
}

export function locateBox(session: ProjectSession, boxId: string): SourceBox | undefined {
  return session.loaded.source!.boxes.find((b) => b.box.box.id === boxId);
}

/** The box with the project map's zone group beside its own when it is on the
 *  map (project.ts `boxWithMap`), for the pages that READ a box's groups and
 *  write only its hands, decks or box shard. Never for a tags shard write. */
export function locateBoxSeen(session: ProjectSession, boxId: string): SourceBox | undefined {
  const box = locateBox(session, boxId);
  return box === undefined ? undefined : boxWithMap(session.loaded.source, box);
}

/**
 * A tag group the box can see, and the write that records it: a box's own group
 * lives in its tags shard, the PROJECT MAP's zone group in the root map shard
 * (design/project-map-contract.md 1.1). Every page that edits a group in place
 * (its tags, its zones, its pictures) writes through here, so an edit to the
 * project map from any box lands in the one file it belongs to.
 */
export function groupHome(
  session: ProjectSession, box: SourceBox | undefined, groupId: string,
): { group: TagGroup; project: boolean; write: () => FileState } | undefined {
  if (box === undefined) return undefined;
  const own = box.tags.groups.find((g) => g.id === groupId);
  if (own !== undefined) {
    return { group: own, project: false, write: () => tagsWrite(session, box) };
  }
  const map = session.loaded.source!.map;
  if (map === undefined || map.group.id !== groupId || box.box.box.usesMap !== true) return undefined;
  return { group: map.group, project: true, write: () => ({ path: projectMapPath(session.loaded.dir), content: canonicalStringify(map) }) };
}

/**
 * The home of a group the MAP edits: a box's own group as `groupHome` finds it,
 * or, with no box named (`boxId` ""), the project map's zone group. The project
 * map page edits zones and pictures once for the project, so it names no box,
 * and a map no box uses yet can still be drawn.
 */
export function mapGroupHome(
  session: ProjectSession, boxId: string, groupId: string,
): ReturnType<typeof groupHome> {
  if (boxId !== "") return groupHome(session, locateBox(session, boxId), groupId);
  const map = session.loaded.source!.map;
  if (map === undefined || map.group.id !== groupId) return undefined;
  return { group: map.group, project: true, write: () => ({ path: projectMapPath(session.loaded.dir), content: canonicalStringify(map) }) };
}

// --- where the shards live, and writing them back ---------------------------------

export const boxFile = (session: ProjectSession, box: SourceBox): string =>
  join(session.loaded.dir, box.path, `box${SHARD_EXTENSIONS.box}`);
export const handsFile = (session: ProjectSession, box: SourceBox): string =>
  join(session.loaded.dir, box.path, `hands${SHARD_EXTENSIONS.hands}`);
export const tagsFile = (session: ProjectSession, box: SourceBox): string =>
  join(session.loaded.dir, box.path, `tags${SHARD_EXTENSIONS.tags}`);

// Cards are stored id-sorted (Reboot 7.4: id-sorted storage keeps the merge
// order-free) and display order rides in each card's `order` field. The sort
// is the canonical serialiser's (compiler `canonicalStringify`, source rule 6),
// so the editor, the CLI and the merge cannot disagree about it.
export const deckContent = (deck: SourceDeck): string => canonicalStringify(deck.shard satisfies DeckShard);

/** A deck's own file, with this content (null deletes it). */
export const deckFileState = (session: ProjectSession, deck: SourceDeck, content: string | null): FileState =>
  ({ path: join(session.loaded.dir, deck.path), content });

/** The deck shard as it now stands in memory. */
export const deckWrite = (session: ProjectSession, deck: SourceDeck): FileState =>
  deckFileState(session, deck, deckContent(deck));
/** The box's hands shard (its hands and templates) as it now stands. */
export const handsWrite = (session: ProjectSession, box: SourceBox): FileState =>
  ({ path: handsFile(session, box), content: canonicalStringify(box.hands) });
/** The box's own tags shard as it now stands. Never the project map's group:
 *  that is `groupHome`'s to write. */
export const tagsWrite = (session: ProjectSession, box: SourceBox): FileState =>
  ({ path: tagsFile(session, box), content: canonicalStringify(box.tags) });
/** The box shard itself as it now stands. */
export const boxWrite = (session: ProjectSession, box: SourceBox): FileState =>
  ({ path: boxFile(session, box), content: canonicalStringify(box.box) });
/** The project shard as it now stands. */
export const projectWrite = (session: ProjectSession): FileState => {
  const source = session.loaded.source!;
  return { path: join(session.loaded.dir, source.path), content: canonicalStringify(source.project) };
};

/**
 * Where a deck's shard lives: its box's `decks/`, named by its effective gameId.
 *
 * The gameId is CHECKED here and not merely reported by validate, because this
 * is the boundary where a bad one stops being a confusing name and becomes a
 * write. `join` resolves "..", so a shard hand-edited to carry
 * `gameId: "../../../tmp/evil"` would have this write outside the project
 * entirely - and it reaches here without passing through the editor's coercion,
 * because renaming a deck's TITLE leaves the pinned gameId untouched and hands
 * it straight to the path.
 *
 * The editor cannot produce one (every save runs `gameIdify`), so this is a
 * corrupted or hostile shard, and the answer is a refusal. Returned rather than
 * thrown: a throw crossed IPC as a bare rejection the renderer never shows.
 */
export const deckPath = (session: ProjectSession, box: SourceBox, gameId: string): { path: string } | { error: string } => {
  if (!isValidGameId(gameId)) {
    return { error: `refusing to write a deck named "${gameId}": that is not a legal address` };
  }
  return { path: join(session.loaded.dir, box.path, "decks", `${gameId}${SHARD_EXTENSIONS.deck}`) };
};

// --- the rules every mutation shares ---------------------------------------------

/** A thing named by an id the project no longer has: said without the id
 *  (house style rule 34), since there is nothing left to name it by. The
 *  likeliest way here is a save still in the air when its item was deleted. */
export const gone = (what: string): { error: string } => ({ error: `that ${what} isn't in the project any more` });

/** Every number a renderer sends that ends up in a shard has to be one: a NaN
 *  written as a position is a map nobody can open (review 2026-10, item 27). */
export const refusedNumber = { error: "refused a position or size that isn't a number" } as const;
export const finitePoints = (points: readonly { x: number; y: number }[]): boolean =>
  points.every((p) => allFinite(p.x, p.y));

export const blank = (src: string | undefined): boolean => src === undefined || src.trim() === "";

/**
 * The identity block every page saves: a gameId slugged (blank leaves the
 * address derived from the title), a title and a purpose kept as typed, and
 * each of the three DELETED rather than stored when emptied. Only the fields
 * the edit names are touched.
 */
export function applyIdentity(
  target: { gameId?: string; title?: string; purpose?: string },
  edit: { gameId?: string; title?: string; purpose?: string },
): void {
  if (edit.gameId !== undefined) { const g = gameIdify(edit.gameId); if (g) target.gameId = g; else delete target.gameId; }
  if (edit.title !== undefined) { if (edit.title.trim()) target.title = edit.title; else delete target.title; }
  if (edit.purpose !== undefined) { if (edit.purpose.trim()) target.purpose = edit.purpose; else delete target.purpose; }
}

/** A slot count as typed: a whole number, else unbounded. */
export const coerceSlots = (raw: string): number | "unbounded" =>
  raw === "unbounded" ? "unbounded" : (Number.isInteger(Number(raw)) && raw.trim() ? Number(raw) : "unbounded");

/**
 * Pin the current array order into each item's `order`.
 *
 * For DUPLICATION specifically. The serialiser stamps a missing `order` from
 * position, but only when it has to sort; a cloned list whose fresh ids happen
 * to land in id order is left alone, and then displays in the order of ids it
 * only just drew rather than the order it was copied from. Stamping before the
 * ids change makes the copy look like the original whatever it draws.
 */
export const stampOrder = (items: { order?: number }[]): void => {
  items.forEach((x, i) => { x.order = i; });
};

/** The reorder rule shared by every mover (cards pioneered it): storage
 *  order is untouched; only the moved item gains a sparse `order` set
 *  between its new display neighbours. `what` names the moved thing when it
 *  is not there. */
export function midpointOrder(
  items: { id: string; order?: number }[], movedId: string, targetId: string, before: boolean, what = "item",
): number | { error: string } {
  const withOrder = items.map((c, i) => ({ c, o: c.order ?? i }));
  if (!withOrder.some((x) => x.c.id === movedId)) return gone(what);
  const others = withOrder.filter((x) => x.c.id !== movedId).sort((a, b) => a.o - b.o);
  const ti = others.findIndex((x) => x.c.id === targetId);
  if (ti < 0) return { error: "drop target not found" };
  const targetO = others[ti]!.o;
  return before
    ? ((ti > 0 ? others[ti - 1]!.o : targetO - 2) + targetO) / 2
    : (targetO + (ti < others.length - 1 ? others[ti + 1]!.o : targetO + 2)) / 2;
}

/** A copy's address: the original's, marked, and free in `taken`. */
export function dedupedGameId(base: string, taken: Set<string>): string {
  return freeGameId(`${base}-copy`, taken);
}

/**
 * Every card gameId in the PROJECT, which is the scope they have to be unique in.
 *
 * Card gameIds are project-wide addresses: the play-history functions key on them
 * (compile.ts, "global uniqueness"). Both creating and duplicating a card used to
 * dedupe against the cards in ONE DECK, so a second "New card" in a second deck
 * produced a duplicate gameId and a validation error. Easy to miss until making
 * cards became easy - the canvas's "New card here" hit it immediately.
 */
export function allCardGameIds(session: ProjectSession): Set<string> {
  const taken = new Set<string>();
  for (const box of session.loaded.source!.boxes) {
    for (const deck of box.decks) {
      for (const card of deck.shard.cards) taken.add(effectiveGameId(card));
    }
  }
  return taken;
}

/** Deck gameIds are project-wide too: a deck's address (`deck.<gameId>.x`)
 *  names no box, so the compiler refuses two decks sharing one. */
export function allDeckGameIds(session: ProjectSession): Set<string> {
  return new Set(session.loaded.source!.boxes.flatMap((b) => b.decks.map((d) => effectiveGameId(d.shard.deck))));
}
