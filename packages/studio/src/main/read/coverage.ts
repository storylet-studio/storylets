// ---------------------------------------------------------------------------
// Coverage, read: the last run projected for the canvas overlays, and the
// drivers the conditions suggest, proposed without being written.
// ---------------------------------------------------------------------------

import { proposeCoverage } from "@storylet-studio/ops";
import type { CoverageReport } from "@storylet-studio/ops";
import { driverDtos } from "../project.js";
import type { ProjectSession } from "../project.js";
import type { CoverageDriverDto, CoverageOverlayDto } from "../../shared/api.js";

/**
 * The last run, projected for the canvas overlays.
 *
 * Built in main rather than in the renderer because main is where the report
 * lives, and because the projection is the whole point: two numbers per card
 * and one per hand, instead of a report the overlay would have to mine on
 * every repaint.
 */
export function coverageOverlay(last: CoverageReport, at: string): CoverageOverlayDto {
  const cards: Record<string, { dealt: number; played: number }> = {};
  for (const card of last.cards) cards[card.id] = { dealt: card.dealt, played: card.played };
  const hands: Record<string, number> = {};
  for (const hand of last.hands) hands[hand.id] = hand.deals;
  return {
    at,
    runs: last.runs,
    cards,
    hands,
    // Relative to the busiest hand in THIS project. An absolute scale would
    // make every hand in a small project look cold and every hand in a big one
    // look hot, which says something about the run size rather than the design.
    busiest: last.hands.reduce((most, h) => Math.max(most, h.deals), 0),
  };
}

/** "Propose from story" in the settings dialog: the auto-proposal WITHOUT
 *  writing it, so the author can prune it before the dialog saves. */
export function proposeDrivers(session: ProjectSession): CoverageDriverDto[] {
  const source = session.loaded.source;
  if (!source) return [];
  return driverDtos(proposeCoverage(source).coverage.drivers);
}
