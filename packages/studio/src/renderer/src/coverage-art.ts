// ---------------------------------------------------------------------------
// The coverage overlay's vocabulary (design/coverage-overlays.md).
//
// One module for BOTH canvases, because the overlay makes one claim in two
// places: this thing did not come up. A card that is never dealt and a hand that
// is never dealt into are the same finding about different halves of the board,
// and two modules would have drifted into two colour schemes for it.
//
// The reading of a number is here; the drawing of it is in node-art and map-art,
// beside the faces they belong to. That split is what makes this file testable
// without a canvas.
// ---------------------------------------------------------------------------

import { plural, relativeTime } from "@wildwinter/app-shell";
import type { CoverageOverlayDto } from "../../shared/api.js";
import type { CanvasTokens } from "./canvas-tokens.js";

/**
 * What the overlay says about one card.
 *
 * Three states, not a scale. The report counts deals and plays, but an author
 * reading a canvas is asking a yes-or-no question ("is anything unreachable?"),
 * and a gradient answers it slowly. The counts are still on the hover, where
 * somebody who wants the number can have it.
 *
 * - `cold`: never dealt. The card cannot come up at all, which is the finding
 *   worth interrupting for.
 * - `unplayed`: dealt, but no outcome of it was ever played. It comes up and
 *   is passed over: weaker evidence, because a run's chooser is not a player.
 * - `warm`: dealt and played. Drawn as nothing at all.
 * - `absent`: not in the run. A card added since, so the overlay says nothing
 *   about it rather than calling it cold, which would be a lie about evidence
 *   that was never gathered.
 */
export type CardHeat = "cold" | "unplayed" | "warm" | "absent";

export function cardHeat(id: string, cover: CoverageOverlayDto | undefined): CardHeat {
  const seen = cover?.cards[id];
  if (!seen) return "absent";
  if (seen.dealt === 0) return "cold";
  if (seen.played === 0) return "unplayed";
  return "warm";
}

/** The hover line for a card, so the numbers behind the colour are reachable
 *  without opening the Coverage window. Undefined when there is nothing to say. */
export function cardHeatTip(id: string, cover: CoverageOverlayDto | undefined): string | undefined {
  const seen = cover?.cards[id];
  if (!cover) return undefined;
  if (!seen) return "Not in the last coverage run";
  const runs = `${plural(cover.runs, "run")}`;
  if (seen.dealt === 0) return `Never dealt in ${runs}`;
  if (seen.played === 0) return `Dealt ${seen.dealt}×, never played (${runs})`;
  return `Dealt ${seen.dealt}×, played ${seen.played}× (${runs})`;
}

/**
 * A hand's heat, 0 to 1, against the BUSIEST hand in the same run.
 *
 * Relative rather than absolute: ten deals is a lot in a five-run sweep and
 * nothing in a thousand-run one, so an absolute scale would be reporting how
 * long the sweep was. -1 marks a hand the run never dealt into, which is a
 * different statement from "the coldest of the warm ones" and is drawn as such.
 */
export function handHeat(id: string, cover: CoverageOverlayDto | undefined): number {
  if (!cover) return -1;
  const deals = cover.hands[id];
  if (deals === undefined || deals === 0) return -1;
  return cover.busiest > 0 ? Math.min(1, deals / cover.busiest) : -1;
}

export function handHeatTip(id: string, cover: CoverageOverlayDto | undefined): string | undefined {
  if (!cover) return undefined;
  const deals = cover.hands[id];
  if (deals === undefined) return "Not in the last coverage run";
  const runs = `${plural(cover.runs, "run")}`;
  return deals === 0 ? `Never dealt into in ${runs}` : `Dealt into ${deals}× in ${runs}`;
}

/**
 * The ink for a state.
 *
 * `warn` for cold and `muted` for unplayed, and deliberately NOT `danger`. A
 * card no run reached is a question for the author, not a broken project: the
 * red in this app means "this will not build", and spending it on evidence
 * would leave nothing louder for the things that actually stop a build.
 */
export function heatInk(heat: CardHeat, tokens: CanvasTokens): string | undefined {
  if (heat === "cold") return tokens.warn;
  if (heat === "unplayed") return tokens.muted;
  return undefined;
}

/** The strip's line: what the overlay is showing and how old it is. The
 *  overlay dates itself because a canvas that looks live while showing a run
 *  from an hour ago is the one way this feature can mislead; the wording is
 *  the shell's `relativeTime`, the same one the Links window uses. */
export function coverageLegend(cover: CoverageOverlayDto | undefined, now: number): string {
  if (!cover) return "No coverage run yet.";
  return `Coverage from ${plural(cover.runs, "run")}, ${relativeTime(cover.at, now)}`;
}
