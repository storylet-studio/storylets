// ---------------------------------------------------------------------------
// Who shares a zone property's value, in words (the round-3 ruling).
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
