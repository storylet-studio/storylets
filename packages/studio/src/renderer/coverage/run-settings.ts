// ---------------------------------------------------------------------------
// The Coverage window's run settings and the line that dates its report, on
// their own so they can be tested: coverage.ts wires a live window at import
// time.
// ---------------------------------------------------------------------------

import { relativeTime } from "@wildwinter/app-shell";
import type { CoverageRan } from "../../shared/api.js";

/**
 * A run setting as typed, or undefined when it is refused: blank, not a whole
 * number, or below `min`. Runs and max turns start at 1, since a sweep of no
 * runs, or of runs that stop before their first turn, reports every card as
 * never dealt. The seed may be 0.
 */
export function runSetting(raw: string, min: number): number | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  const n = Number(text);
  return Number.isInteger(n) && n >= min ? n : undefined;
}

/** When a report was run and the project it was run on: main keeps it beside
 *  the report (`CoverageInfo.ran`), so it survives the window closing. */
export type RanStamp = CoverageRan;

/** The line over a cached report: when it ran, and, once the project has moved
 *  on, that it has. Undefined when the run is not dated. */
export function ranLine(stamp: RanStamp | undefined, stale: boolean, now = Date.now()): string | undefined {
  if (stamp === undefined) return undefined;
  const when = `Ran ${relativeTime(stamp.at, now)}.`;
  return stale ? `${when} The project has changed since.` : when;
}
