// ---------------------------------------------------------------------------
// Group by, on the card views (the surfacing review's plan item 3): a box's
// Contents and a deck's cards, under one heading per deck, per place, or per
// tag of any of the box's tag groups, with "Untagged" last.
//
// Works from tags alone, so it works the same in a box with no map, which is
// the conversation writer's case: a box of topics grouped by `npc` needs
// nothing drawn. A box on the project map has the map's zone group among its
// groups (project.ts `boxWithMap`), so the zones are offered by name like any
// other group.
//
// PLACE, and why a chosen group is never offered twice. The Where row
// (where.ts) counts three things as answering "where": the home group (the
// hands a card names), every map, and every group a hand template chooses. Place
// here takes the first two and leaves the third to its own option. A chosen
// group's values are already headings when grouped by that group by name
// ("gareth", "mira"), and repeating them inside Place would offer the same
// grouping twice under two names. So:
//   - Place is offered when the box has hands and something to place cards at
//     them by: a card that names a hand, or a map. A conversation box, whose
//     only "where" is `npc`, offers `npc` and no Place (mock-up screen 5b).
//   - Under Place, a card whose only answer is a chosen group is not called
//     "Anywhere", which would be false: it goes under one heading per such
//     group, "By npc", which switches the grouping to that group.
//
// Pure over the DTOs, no DOM, as where.ts is; views.ts draws what this decides.
// ---------------------------------------------------------------------------

import { PLACE_GROUP } from "@storylet-studio/model";
import type { BoxDto, CardDto, DeckDto } from "../../shared/api.js";

/** Which page the control is on: a box's Contents leads with Deck, a deck's
 *  cards with None (they are all one deck). */
export type GroupPage = "contents" | "deck";

/** A grouping, as remembered: "deck", "none", "place", or `tag:<group id>`.
 *  A group's internal id rather than its name, so a renamed group keeps the
 *  choice. */
export type GroupKey = string;

export interface GroupOption {
  key: GroupKey;
  label: string;
}

/** A card with the deck it lives in: the box page shows several decks' cards. */
export interface GroupEntry {
  card: CardDto;
  deck: Pick<DeckDto, "id" | "gameId" | "title">;
}

export interface CardGroup {
  /** Unique within one grouping, for "also under". */
  key: string;
  label: string;
  /** A quiet word after the label: the zone a site stands in. */
  sub?: string;
  entries: GroupEntry[];
  /** The remainder heading ("Untagged", "Anywhere"): drawn quieter, and last. */
  rest?: true;
  /** Where the heading goes when clicked, if anywhere. */
  go?: { kind: "deck"; deck: string } | { kind: "hand"; hand: string } | { kind: "group"; key: GroupKey };
}

const valuesIn = (card: CardDto, group: string): string[] =>
  card.tags.find((t) => t.group === group)?.values ?? [];

/** The first option, and what a page shows until somebody chooses. */
export const defaultGroup = (page: GroupPage): GroupKey => (page === "deck" ? "none" : "deck");

/** Does the box have places to group by? Hands, and something that puts cards
 *  at them: a card naming one, or a map (see the head of this file). */
export function hasPlaces(box: BoxDto): boolean {
  if (box.hands.length === 0) return false;
  if (box.tagGroups.some((g) => g.spatial === true)) return true;
  return box.decks.some((d) => d.cards.some((c) => valuesIn(c, PLACE_GROUP).length > 0));
}

/** The options, in the control's order: Deck (or None), Place, then each of the
 *  box's tag groups by its own name, the project map's zone group included. */
export function groupOptions(box: BoxDto, page: GroupPage): GroupOption[] {
  return [
    page === "deck" ? { key: "none", label: "None" } : { key: "deck", label: "Deck" },
    ...(hasPlaces(box) ? [{ key: "place", label: "Place" }] : []),
    ...box.tagGroups.map((g) => ({ key: `tag:${g.id}`, label: g.gameId })),
  ];
}

/** The remembered choice if this page still offers it, else the default. A
 *  group since deleted, or a box that has lost its places, falls back quietly. */
export function resolveGroup(box: BoxDto, page: GroupPage, remembered: GroupKey | undefined): GroupKey {
  const offered = groupOptions(box, page);
  return remembered !== undefined && offered.some((o) => o.key === remembered) ? remembered : defaultGroup(page);
}

/** Every card of the box, deck by deck, in display order. */
export function boxEntries(box: BoxDto): GroupEntry[] {
  return box.decks.flatMap((deck) => deck.cards.map((card) => ({ card, deck })));
}

/**
 * The headings and what goes under each. Empty headings are left out, the
 * remainder comes last, and a card in several values sits under each of them.
 * `none` is one group with an empty label: the caller draws no heading.
 */
export function groupEntries(box: BoxDto, entries: GroupEntry[], key: GroupKey): CardGroup[] {
  if (key === "none") return [{ key: "all", label: "", entries }];
  if (key === "deck") {
    return box.decks
      .map((d): CardGroup => ({
        key: `deck:${d.id}`, label: d.title ?? d.gameId, go: { kind: "deck", deck: d.id },
        entries: entries.filter((e) => e.deck.id === d.id),
      }))
      .filter((g) => g.entries.length > 0);
  }
  if (key === "place") return byPlace(box, entries);
  const group = box.tagGroups.find((g) => `tag:${g.id}` === key);
  if (group === undefined) return [{ key: "all", label: "", entries }];
  const out: CardGroup[] = group.values.map((v) => ({
    key: `tag:${v}`, label: v, entries: entries.filter((e) => valuesIn(e.card, group.gameId).includes(v)),
  }));
  out.push({ key: "rest", label: "Untagged", rest: true, entries: entries.filter((e) => valuesIn(e.card, group.gameId).length === 0) });
  return out.filter((g) => g.entries.length > 0);
}

function byPlace(box: BoxDto, entries: GroupEntry[]): CardGroup[] {
  const spatial = box.tagGroups.filter((g) => g.spatial === true);
  const chosen = box.tagGroups.filter((g) => g.chosen === true && g.spatial !== true);
  const homeless = entries.filter((e) => valuesIn(e.card, PLACE_GROUP).length === 0);
  const unzoned = homeless.filter((e) => spatial.every((g) => valuesIn(e.card, g.gameId).length === 0));
  const out: CardGroup[] = [];
  // Each site, in the box's hand order: the cards that name it.
  for (const h of box.hands) {
    const zone = spatial.map((g) => h.tags[g.gameId]).find((v) => v !== undefined);
    out.push({
      key: `hand:${h.id}`, label: h.title ?? h.gameId, ...(zone !== undefined ? { sub: zone } : {}),
      go: { kind: "hand", hand: h.id },
      entries: entries.filter((e) => valuesIn(e.card, PLACE_GROUP).includes(h.gameId)),
    });
  }
  // Then each zone, in its group's order: the cards anywhere in it. A card that
  // names a hand is under the hand; its zone tag narrows that hand, it does not
  // send the card anywhere else.
  for (const g of spatial) {
    for (const v of g.values) {
      out.push({ key: `zone:${g.gameId}:${v}`, label: `Anywhere in ${v}`, entries: homeless.filter((e) => valuesIn(e.card, g.gameId).includes(v)) });
    }
  }
  // A card whose only answer is a chosen group: offered under its own name.
  for (const g of chosen) {
    out.push({ key: `by:${g.gameId}`, label: `By ${g.gameId}`, go: { kind: "group", key: `tag:${g.id}` }, entries: unzoned.filter((e) => valuesIn(e.card, g.gameId).length > 0) });
  }
  out.push({
    key: "rest", label: "Anywhere", rest: true,
    entries: unzoned.filter((e) => chosen.every((g) => valuesIn(e.card, g.gameId).length === 0)),
  });
  return out.filter((g) => g.entries.length > 0);
}

/** For each card under more than one heading, the OTHER headings' labels, by
 *  the heading it is drawn under: the "also under" line. */
export function alsoUnder(groups: CardGroup[]): (cardId: string, under: string) => string[] {
  const homes = new Map<string, CardGroup[]>();
  for (const g of groups) for (const e of g.entries) homes.set(e.card.id, [...(homes.get(e.card.id) ?? []), g]);
  return (cardId, under) => (homes.get(cardId) ?? []).filter((g) => g.key !== under).map((g) => g.label);
}
