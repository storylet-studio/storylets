// ---------------------------------------------------------------------------
// Who shares a property's value, in words: a zone's (the round-3 ruling), and
// since the sign-off round every other scope's too.
//
// Two questions, and the panel used to answer only the first. ACROSS BOXES: a
// zone property is the project map's, so every box on the map reads one value
// for a zone, always. ACROSS GUESTS: per guest unless the property is marked
// Shared (design/flows.md; tag properties are per playthrough by default). The
// old line, "One value per zone, whichever box's site is dealt here", said the
// first and was read as the second by both the theme park and the immersive
// designers, which is the misreading that turns a personal beat into a crowd
// moment by accident.
//
// So the sentence follows the property's Shared tick-box, and on the Solo rung,
// where there is one guest and no tick-box to follow, it says the box half only.
// A property already marked shared says so at any rung: hiding never swallows
// content in use (play-ladder.ts).
// ---------------------------------------------------------------------------

/** The sentence for one zone property. `solo` is the project's play rung
 *  showing no sharing at all. */
export function zoneShareLine(shared: boolean, solo: boolean): string {
  if (shared) return "One value for every box and every guest.";
  return solo ? "One value for every box." : "One value for every box. Each guest has their own.";
}

/** The scopes a declaration list belongs to, for its whose-state sentence. */
export type ShareScope = "story" | "box" | "deck" | "hand" | "tag" | "zone";

/**
 * The whose-state sentence for one property row, or undefined when there is
 * none to say. The theme park sign-off's shared-key trap: @story is shared by
 * default (the runtime's own default, engine.ts) while box, deck, hand and tag
 * state is a copy per guest, and only the expanded row's tick-box said which.
 * So at the Shared world rung and above every row says it, in zone-share's
 * shape, following its Shared tick-box. On Solo there is one guest and nothing
 * to say, except on a zone, whose box half is true at every rung.
 *
 * A hand or a tag carries a value of its own, as a zone does for every box, so
 * those sentences say "per hand" / "per tag" first.
 */
export function shareLine(scope: ShareScope, shared: boolean, solo: boolean): string | undefined {
  if (scope === "zone") return zoneShareLine(shared, solo);
  if (solo) return undefined;
  const per = scope === "hand" ? "hand" : scope === "tag" ? "tag" : undefined;
  if (per === undefined) return shared ? "One value for every guest." : "Each guest has their own.";
  return shared ? `One value per ${per}, the same for every guest.` : `One value per ${per}. Each guest has their own.`;
}

/** The Solo rung's one pointer, under a zone's properties: there is no Shared
 *  tick-box here, and this is where one comes from. The route is the app's
 *  own: the Play field in Project Settings' General section. */
export const SOLO_SHARE_POINTER = "A value every guest shares needs Play set to Shared world, in Project settings ▸ General.";
