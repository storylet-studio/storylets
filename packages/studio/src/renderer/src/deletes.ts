// ---------------------------------------------------------------------------
// Deletes guard by evidence (the October 2026 review, section 2).
//
// A delete asks first when the thing holds something, and not otherwise: a
// hand template with hands of its kind, a hand with a pin on the map, a box with decks or hands, a card
// with anything an author wrote. An empty one goes straight away, since there
// is nothing to lose and undo is one key. The question names the object and
// what it holds, and ends with the house sentence about undo.
//
// The menus read the same evidence, so "Delete deck…" carries its ellipsis
// exactly when a question follows (the house style: an ellipsis promises one).
//
// A deck and a tag group are the exceptions: main refuses to delete a deck that
// still has cards, or a group that cards still carry, so there is nothing to ask
// about. The refusal is what the author sees, and an empty one goes at once.
// ---------------------------------------------------------------------------

import { plural } from "@wildwinter/app-shell";
import type { ConfirmOptions } from "@wildwinter/app-shell";
import type { BoxDto, CardDto, DeckDto, TemplateDto } from "../../shared/api.js";

/**
 * Has an author actually put anything in this card?
 *
 * A freshly made card is a placeholder: the title the app chose, one empty
 * "Continue" outcome, nothing else. Deleting one of those needs no ceremony.
 * Anything beyond that is work, and work gets a confirmation (Patter's pattern:
 * guard the destructive act, but only when there is something to lose).
 */
export function cardHasContent(card: CardDto): boolean {
  const placeholderTitle = card.title === undefined || /^New card( \d+)?$/.test(card.title);
  const wrote = card.purpose !== undefined && card.purpose.trim() !== "";
  const gated = card.condition !== undefined && card.condition.trim() !== "";
  const tagged = card.tags.some((g) => g.values.length > 0);
  const filled = card.fields.some((f) => f.value.trim() !== "");
  // One outcome with no changes and the default title is what a new card ships
  // with; anything more is authored.
  const authoredOutcomes = card.outcomes.length > 1
    || card.outcomes.some((o) => o.changes.length > 0 || o.gate !== undefined || (o.purpose ?? "") !== ""
      // A filled outcome field is writing too: the after-line a venue reads is
      // often the only thing an author put on the outcome.
      || o.fields.some((f) => f.value.trim() !== ""));
  return !placeholderTitle || wrote || gated || tagged || filled || authoredOutcomes;
}

const UNDO = "You can undo this.";
const named = (thing: { title?: string; gameId: string }): string => thing.title ?? thing.gameId;

/** A menu or button label for a delete: the object, and an ellipsis when a
 *  question will follow. */
export const deleteLabel = (noun: string, asks: boolean): string => `Delete ${noun}${asks ? "…" : ""}`;

/** The question for deleting these cards, or undefined when none has content. */
export function cardsConfirm(cards: readonly CardDto[]): ConfirmOptions | undefined {
  const worth = cards.filter(cardHasContent);
  if (worth.length === 0) return undefined;
  if (cards.length === 1) {
    return { title: `Delete "${named(cards[0]!)}"?`, body: `This card has content. ${UNDO}`, confirmLabel: "Delete card" };
  }
  return {
    title: `Delete ${plural(cards.length, "card")}?`,
    body: `${worth.length} of them ${worth.length === 1 ? "has" : "have"} content. ${UNDO}`,
    confirmLabel: "Delete cards",
  };
}


/** A box holds its decks and hands. */
export function boxConfirm(box: BoxDto): ConfirmOptions | undefined {
  if (box.decks.length === 0 && box.hands.length === 0) return undefined;
  const cards = box.decks.reduce((n, d) => n + d.cards.length, 0);
  return {
    title: `Delete "${named(box)}"?`,
    body: `The box and everything in it (${plural(box.decks.length, "deck")}, ${plural(cards, "card")} and ${plural(box.hands.length, "hand")}) are removed. ${UNDO}`,
    confirmLabel: "Delete box",
  };
}

/** A hand template holds the hands of its kind. */
export function templateConfirm(template: TemplateDto): ConfirmOptions | undefined {
  if (template.instances === 0) return undefined;
  return {
    title: `Delete "${named(template)}"?`,
    body: `${plural(template.instances, "hand")} ${template.instances === 1 ? "is" : "are"} of this kind, and ${template.instances === 1 ? "loses its" : "lose their"} template. ${UNDO}`,
    confirmLabel: "Delete hand template",
  };
}

/** A hand holds its pin on the map, when it has one. */
export function handConfirm(hand: { title?: string; gameId: string }, pinned: boolean): ConfirmOptions | undefined {
  if (!pinned) return undefined;
  return {
    title: `Delete "${named(hand)}"?`,
    body: `The hand and its pin on the map are removed. ${UNDO}`,
    confirmLabel: "Delete hand",
  };
}
