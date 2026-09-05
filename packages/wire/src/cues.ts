// ---------------------------------------------------------------------------
// The cue list (10.3) and the three clocks (10.1, 10.2).
//
// A cue list is ordered entries, each with a time or none, each doing one
// thing. Buttons on the console (GO, Hold, Resume, and any entry a producer
// wants to fire by hand) are cues WITHOUT a time, which is why `manual` is a
// fourth arm of the schedule union rather than a separate concept: a late
// start and a hold are then the cue list being driven by a person, not a
// special case in content.
// ---------------------------------------------------------------------------

import type { GameId, IsoTimestamp, PropertyPath } from "./vocabulary.js";
import type { MessageAudience } from "./views.js";

/** The three world clocks, by the property path each answers to. They are
 *  DERIVED by the server's `@world` resolver at read time from journaled
 *  facts, never ticked and never written: a day of ticking would be 86,400
 *  commands of noise (10.2). `time_phase` is the one exception, and only when
 *  a cue says so. */
export const CLOCK_WALL: PropertyPath = "world.time_wall";
/** Seconds since GO. */
export const CLOCK_SHOW: PropertyPath = "world.time_show";
/** The named phase the show is in, set by a cue. */
export const CLOCK_PHASE: PropertyPath = "world.time_phase";

/** All three, in one place, for a client that offers them as a pick list. */
export const CLOCK_PATHS = [CLOCK_WALL, CLOCK_SHOW, CLOCK_PHASE] as const;

/** A reading of the three clocks at one instant. The names are the property
 *  names, without the `world.` prefix, so a template that prints a clock and
 *  a condition that reads one use the same word. */
export interface Clocks {
  /** Wall time now, as the server sees it. */
  time_wall: IsoTimestamp;
  /** Seconds since GO. Negative before it, when the run has started but the
   *  show has not. */
  time_show: number;
  /** The current phase, or the empty string before the first phase cue. */
  time_phase: string;
}

/** When a cue fires. */
export type CueSchedule =
  /** At a wall time: `19:30`, or a full ISO instant for a multi-day run. */
  | { at: "wall"; time: string }
  /** At show time T+: seconds after GO. */
  | { at: "show"; seconds: number }
  /** Every N seconds, from GO until the run ends or the entry is disabled. */
  | { at: "every"; seconds: number }
  /** No time: a button on the console, fired by a person. */
  | { at: "manual" };

/** What a cue does. One entry does one thing; a sequence is several entries
 *  at the same time. */
export type CueAction =
  /** Set `world.time_phase`. The only thing the scheduler writes (10.2). */
  | { do: "set-phase"; phase: string }
  /** Deal the house's hands (5.5). Absent `hands` deals every house hand. */
  | { do: "deal-house"; hands?: GameId[] }
  /** Play a house card, as the producer would by hand. */
  | { do: "play-house"; card: GameId; outcome: GameId; hand: GameId }
  /** `advanceTurns` on a box for every open flow: the nudge for a box that is
   *  NOT timed. A timed box ticks itself from its declaration (4.8). */
  | { do: "advance-turns"; box: GameId; turns: number }
  /** Send a message (6.7). */
  | { do: "message"; body: string; priority: "note" | "cue" | "urgent"; audience: MessageAudience; ackRequired?: boolean }
  /** Fire a cue through a bridge (5.6). The payload is the adapter's. */
  | { do: "bridge-fire"; bridge: string; payload?: unknown };

/** One entry on a run's cue list. */
export type CueEntry = {
  /** Stable across edits, so a fired-by-hand button keeps its identity. */
  id: string;
  /** What the console's button says. */
  label?: string;
  /** Off without being deleted: the rehearsal case. Absent means on. */
  enabled?: boolean;
  action: CueAction;
} & CueSchedule;
