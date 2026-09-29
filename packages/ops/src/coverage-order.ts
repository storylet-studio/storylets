// ---------------------------------------------------------------------------
// How a coverage report is read: which cards count as rarely dealt, and the
// least-reached-first order the CLI and Storyletter's Coverage window both
// lead with (Patter's rework, patter 72c625f: the rows worth a look first).
//
// On its own, with no imports, because the window loads it too. The renderer
// cannot take this package whole (it is Node code), so it reaches this one
// file through a source alias (`@storylet-studio/ops/coverage-order`), and the
// two front-ends share one copy of the rule rather than two that can drift.
// ---------------------------------------------------------------------------

/** Below this share of runs, a card that WAS dealt is flagged rare. Coverage
 *  used to flag only the never dealt, so a card dealt in half a percent of
 *  runs looked as healthy as one dealt in all of them. */
export const RARE_DEALT_PCT = 5;

/** Which order the card table is in: least reached first (the default: the
 *  rows worth a look lead), or deck order, box by box and deck by deck as
 *  authored. */
export type CoverageOrder = "least" | "deck";

/** Dealt in at least one run, but in fewer than `pct`% of them. Exactly
 *  `pct`% is not rare. Counted in whole runs, so no rounding decides it. */
export function rarelyDealt(dealtRuns: number, runs: number, pct: number = RARE_DEALT_PCT): boolean {
  return dealtRuns > 0 && dealtRuns * 100 < pct * runs;
}

/** `n` out of `total` as a percentage: the Runs dealt column, and the share
 *  of cards dealt in the window's headline. Never rounded to a lie at either
 *  end: a card dealt in one run of 5000 reads
 *  "<0.1%", not "0%" beside the never dealt, and one missed by a single run
 *  reads ">99%", not "100%" beside the always dealt. Under 10% it keeps a
 *  decimal, rounded DOWN, so a rare card never shows the threshold itself
 *  (4.5% reads "4.5%", not a "5%" that the Rare tag beside it contradicts). */
export function sharePct(n: number, total: number): string {
  if (total <= 0 || n <= 0) return "0%";
  if (n >= total) return "100%";
  const pct = (n / total) * 100;
  if (pct < 0.1) return "<0.1%";
  // Tenths counted from the whole numbers, so float noise cannot floor 5.7 to 5.6.
  if (pct < 10) return `${Math.floor((n * 1000) / total) / 10}%`;
  if (pct > 99) return ">99%";
  return `${Math.round(pct)}%`;
}

/**
 * The cards least reached first: never dealt at the top, then by the runs that
 * dealt them, then by times dealt, with deck order kept among equals. Returns
 * a new list; the report's own stays in deck order.
 */
export function leastReachedFirst<T extends { dealtRuns: number; dealt: number }>(cards: readonly T[]): T[] {
  return cards
    .map((card, i) => ({ card, i }))
    .sort((x, y) => x.card.dealtRuns - y.card.dealtRuns || x.card.dealt - y.card.dealt || x.i - y.i)
    .map(({ card }) => card);
}
