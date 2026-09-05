// ---------------------------------------------------------------------------
// The play ladder, editor side (design/engine-server.md 4.10).
//
// ONE predicate, asked by every surface. The rules are a list of features and
// the rung each first appears on, in one place, because they are spread over
// six surfaces in three windows and a rule written six times is six rules.
//
// ABSENCE, NOT GREYING. A hidden control is not drawn at all: the density rule
// (studio-editing-structure, teaching text waits until approached) argues for
// it, and a greyed control says "this app does that, not yet here" when the
// answer is "not in this kind of project". Where to change it is said once, on
// the Play field in Project Settings, rather than on every control it governs.
//
// HIDING NEVER SWALLOWS CONTENT IN USE. Where a project already carries the
// thing a rung would hide, the surface draws it anyway and says so at its own
// call site; this predicate answers about the rung alone. The compiler's
// ladder warning is what reports the mismatch.
//
// The rung is not in the bundle and never will be: it is the editor's shape,
// not the engine's. Each window seeds it once from main and asks here after.
// ---------------------------------------------------------------------------

import { DEFAULT_PLAY_RUNG } from "@storylet-studio/model";
import type { PlayRung } from "@storylet-studio/model";

/** The rungs, lowest first: each shows everything the one below it shows. */
export const PLAY_RUNGS: readonly PlayRung[] = ["solo", "shared", "venue"];

/** What Storyletter calls each rung, and the one sentence that says what it
 *  brings. Read on the Play field, and nowhere else: the point of the ladder
 *  is that the features it governs are silent about it.
 *
 *  `venue` is not a rung an author picks. It is set by the Storylet Server a
 *  project came from, and the label and blurb here exist for the one case that
 *  needs them: a project that already carries it, whose field must say what it
 *  is rather than lie about it. */
export const RUNG_LABEL: Record<PlayRung, string> = {
  solo: "Solo",
  shared: "Shared world",
  venue: "Venue (set by a Storylet Server)",
};

export const RUNG_BLURB: Record<PlayRung, string> = {
  solo: "One player, one playthrough. Nothing about sharing appears.",
  shared: "Several players over one world: cards, decks and state can be shared between playthroughs.",
  venue: "The server this project came from set this rung. You can move down from it; it is not one you can set here.",
};

/**
 * The features the ladder governs, named for what an author sees rather than
 * for the flag underneath, since that is what the visibility rule is about.
 *
 *   sharing      the Shared checkbox on declarations and decks, the Shared
 *                three-state on a card, and "In the world" (sharedCopies)
 *   durable      the Durable controls in the same three places (4.2)
 *   timedBox     the box page's Turns section (4.8)
 *   propertyHole "from a property" in a hole picker (4.6)
 *   runGestures  the Board's New run and Forget everyone (4.2)
 *
 * The last two are on the ground floor and are listed here anyway, so that one
 * table is the whole answer to "what does this rung show" rather than most of
 * it, and so a surface that wants to move never has to be found first.
 */
export type LadderFeature = "sharing" | "durable" | "timedBox" | "propertyHole" | "runGestures";

/**
 * The lowest rung each feature appears on.
 *
 * TWO AXES, not one (ruling of 2026-09-05). Solo and Shared are about
 * SIMPLIFYING the editor, and are the author's to choose. Venue belongs to the
 * licensed Storylet Server: what sits there is what the server itself runs,
 * which is durable state and the run boundary that lifts and restores it.
 *
 * A timed box and a hand that moves are neither. They are engine features any
 * game may want, so they show everywhere, solo included; they sat at venue
 * only because the first cut of the ladder had one axis to hang them on.
 */
const NEEDS: Record<LadderFeature, PlayRung> = {
  sharing: "shared",
  durable: "venue",
  timedBox: "solo",
  propertyHole: "solo",
  runGestures: "venue",
};

/** The window's current rung. Module state rather than a parameter threaded
 *  through forty call sites: it is one value per open project, every surface
 *  needs it, and no surface may disagree about it. */
let current: PlayRung = DEFAULT_PLAY_RUNG;

/** Seed the rung from main: on open, and on every project change. */
export function setPlayRung(rung: PlayRung | undefined): void {
  current = rung ?? DEFAULT_PLAY_RUNG;
}

export function playRung(): PlayRung {
  return current;
}

/** Does this project show `feature`? Pass `at` to ask about another rung,
 *  which is what the settings dialog's preview does. */
export function shows(feature: LadderFeature, at: PlayRung = current): boolean {
  return PLAY_RUNGS.indexOf(at) >= PLAY_RUNGS.indexOf(NEEDS[feature]);
}

/** Everything a rung shows, in feature order: the list the test reads. */
export function shownAt(rung: PlayRung): LadderFeature[] {
  return (Object.keys(NEEDS) as LadderFeature[]).filter((f) => shows(f, rung));
}
