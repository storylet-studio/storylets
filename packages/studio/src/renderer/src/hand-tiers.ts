// ---------------------------------------------------------------------------
// The words of a hand's Cards tab, shared by the hand page (inspector.ts) and
// the project map's hand panel (map-panel.ts): the tiers come from ops
// `placeTiers` through main, and this file says what each one holds. Pure, no
// DOM, so the sentences are tested rather than read off a screenshot.
//
// The Anywhere line has to say EXACTLY what its count holds. It is every card
// that names no hand and has no tag in any group this hand binds: a card tagged
// with a zone the hand does not bind is in it (the zone does not narrow this
// hand), and so is a card tagged with an npc at a hand that binds only zones.
// "No place or zone" was false for both (the antagonist review, round 3, 1.1b).
//
// ONE NOUN (the round-3 ruling): "hand", never "place" or "site". A card's
// "place" tag is the format's name for the hands it names; on screen it is
// "names no hand", and the tiers say where without a noun at all.
// ---------------------------------------------------------------------------

import { plural } from "@wildwinter/app-shell";
import type { HandCardGate, HandCardsDto } from "../../shared/api.js";

/** How many cards the tab lists: the count on its tab. */
export const tierCount = (c: HandCardsDto): number =>
  c.only.length + c.never.length + c.tiers.reduce((n, t) => n + t.cards.length, 0) + c.anywhere.length;

/**
 * A tier's heading. The map's zone group reads as a region, "Anywhere in
 * docks". Any other group the hand binds reads as "Wherever npc is gareth":
 * the tier holds the cards tagged gareth, which come up at THIS hand and at
 * any other hand where the npc is gareth, so "wherever" keeps the "not only
 * here" the zone tier's "anywhere" says, and it reads as a sentence for a who
 * (npc) as well as for a where kept off the map (area). "Anywhere in gareth"
 * made a person a region, and "Any npc: gareth" reads as a filter, not a tier.
 */
export const tierLabel = (t: HandCardsDto["tiers"][number]): string =>
  (t.zone === true ? `Anywhere in ${t.tag}` : `Wherever ${t.group} is ${t.tag}`);

/** The heading of the cards placed here that can never be dealt here. */
export const NEVER_LABEL = "Placed here but can never come up here";

/** What the Anywhere count holds, as the end of "and N cards that ...". */
export function anywhereHolds(c: Pick<HandCardsDto, "bound">, one: boolean): string {
  const name = one ? "names no hand" : "name no hand";
  return c.bound.length === 0 ? name : `${name} and ${one ? "has" : "have"} no ${c.bound.join(" or ")} tag`;
}

/** The Anywhere line's words before its Show button, or undefined when there
 *  are none (the caller says so in its own way). */
export function anywhereLine(c: Pick<HandCardsDto, "anywhere" | "bound">): string | undefined {
  const n = c.anywhere.length;
  return n === 0 ? undefined : `and ${plural(n, "card")} that ${anywhereHolds(c, n === 1)}, which can come up here too. `;
}

/** A moving hand's note: why it has a tier for everywhere it can be. */
export function movingNote(c: Pick<HandCardsDto, "moving" | "tiers">): string | undefined {
  if (c.moving !== true) return undefined;
  return "This hand moves: it takes where it is from a property, so it has a tier for everywhere it can be.";
}

/** A gate's badge: "when act: act-2". The group is bound from state at every
 *  ask, for every hand alike, so it says when the card can come up, not where. */
export const gateLabel = (g: HandCardGate): string => `when ${g.group}: ${g.tags.join(" or ")}`;
