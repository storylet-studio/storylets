// ---------------------------------------------------------------------------
// Deletes report, with Undo (the October 2026 review: Undo replaces "Are you
// sure?").
//
// A delete goes at once and says what went, in a toast whose Undo takes it
// back: every delete is one step of the project history, so a question first
// was only ever the dialog admitting it wasn't needed. The report names the
// object, and says on a second line what else went with it, which is the
// evidence the old questions led with: a box's decks, cards and hands, a
// deck's cards, a hand's pin on the map, the hands a template's kind leaves.
//
// The menus say "Delete deck", with no ellipsis, since no question follows
// (the house style: an ellipsis promises one).
//
// A tag group is the exception that stays: main refuses to delete a group that
// cards still carry, saying how many, and an unused one goes as anything else.
// ---------------------------------------------------------------------------

import { plural } from "@wildwinter/app-shell";
import type { BoxDto, CardDto, DeckDto, TemplateDto } from "../../shared/api.js";

const named = (thing: { title?: string; gameId: string }): string => `“${thing.title ?? thing.gameId}”`;

/** A menu or button label for a delete: the object, and an ellipsis only when
 *  a question will follow (none does now; the house style keeps the rule). */
export const deleteLabel = (noun: string, asks = false): string => `Delete ${noun}${asks ? "…" : ""}`;

/** What deleting these cards says: one by its title, several by their count. */
export function cardsReport(cards: readonly CardDto[]): string {
  return cards.length === 1 ? `Deleted ${named(cards[0]!)}.` : `Deleted ${plural(cards.length, "card")}.`;
}

/** A deck takes its cards with it. */
export function deckReport(deck: DeckDto): string {
  const n = deck.cards.length;
  return `Deleted ${named(deck)}.${n > 0 ? `\n${n === 1 ? "Its card" : `Its ${n} cards`} went with it.` : ""}`;
}

/** A box takes its decks, their cards and its hands with it. */
export function boxReport(box: BoxDto): string {
  const cards = box.decks.reduce((n, d) => n + d.cards.length, 0);
  const held = [
    box.decks.length > 0 ? plural(box.decks.length, "deck") : "",
    cards > 0 ? plural(cards, "card") : "",
    box.hands.length > 0 ? plural(box.hands.length, "hand") : "",
  ].filter(Boolean);
  const list = held.length < 3 ? held.join(" and ") : `${held[0]}, ${held[1]}, and ${held[2]}`;
  return `Deleted ${named(box)}.${list ? `\nIts ${list} went with it.` : ""}`;
}

/** A hand template leaves the hands of its kind without one. */
export function templateReport(template: TemplateDto): string {
  const n = template.instances;
  return `Deleted ${named(template)}.${n > 0 ? `\n${plural(n, "hand")} of its kind ${n === 1 ? "has" : "have"} no template now.` : ""}`;
}

/** A hand takes its pin on the map with it, when it has one. */
export function handReport(hand: { title?: string; gameId: string }, pinned: boolean): string {
  return `Deleted ${named(hand)}.${pinned ? "\nIts pin on the map went with it." : ""}`;
}

/** Leaving the project map takes the box's hands' places on it. */
export function leftMapReport(box: { title?: string; gameId: string }, cleared: number): string {
  return `Took ${named(box)} off the project map.\n${cleared === 1 ? "Its hand's place" : `Its ${cleared} hands' places`} on the map went with it.`;
}
