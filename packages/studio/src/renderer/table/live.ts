// ---------------------------------------------------------------------------
// The Board's Live mode (design/live-link.md): a session the Board did not
// create, rebuilt from the game's frames. `board` snapshots say what each hand
// holds and where every clock is; `trace` events are the story, and they are
// the runtime's own TraceEvents, so the journal and the Why not? tab read
// them with the code they already have. Pure over the frames, so it tests
// headlessly; live-mode.ts and the rail render what this holds.
// ---------------------------------------------------------------------------

import { LIVE_LOG_CAP } from "../../shared/api.js";
import type { LogEntry, TraceEvent, TraceVerdict } from "@storylet-studio/runtime";
import type { LiveLinkFrame } from "../../shared/api.js";
import { whyNotOf } from "./model.js";
import type { WhyNot } from "./model.js";

export interface LiveRunDeps {
  /** The box a hand belongs to (both gameIds), for stamping a deal with its
   *  clock; undefined for a hand the Board's bundle does not know. */
  handBox: (handGameId: string) => string | undefined;
  /** A card's display label from its id, for the why-panel. */
  label: (cardId: string) => { gameId: string; title?: string };
}

/** What one frame changed that the window may want to act on: the cards the
 *  game put up or played, in the order they were named (Follow in the editor
 *  opens the first). */
export interface LiveApplied {
  dealt: string[];
  played?: string;
}

export interface LiveRun {
  /** Hand gameId -> card gameIds in dealt order, as the game last reported. */
  readonly hands: Readonly<Record<string, string[]>>;
  /** Box gameId -> clock, as the game last reported. */
  readonly turns: Readonly<Record<string, number>>;
  /** The journal, oldest first: every trace event the game sent, stamped with
   *  a sequence and the turn its box was on. */
  readonly log: readonly LogEntry[];
  /** For each hand the game has dealt, its LATEST deal read back as "why not?":
   *  the Board's Why not? tab, for the game's deals. */
  readonly whyNot: Readonly<Record<string, WhyNot>>;
  /** The project the game named in its hello, if it did. */
  readonly project: string | undefined;
  /** The flow this view is following. One playhead, pointed at one
   *  participant, switched by `follow` - Patterpad's shape, and the reason it
   *  is not a multi-view: a Board showing four runs at once shows none of
   *  them. Null before the game names a flow. */
  readonly following: string | null;
  /** Point the view at another participant, seeding it from the last board
   *  that flow sent so it is not blank until they move. Frames from other
   *  flows are ignored while it is followed. */
  follow(flowId: string, board?: { hands: Record<string, string[]>; turns: Record<string, number> }): void;
  apply(frame: LiveLinkFrame): LiveApplied;
  reset(): void;
}



export function createLiveRun(deps: LiveRunDeps): LiveRun {
  let hands: Record<string, string[]> = {};
  let turns: Record<string, number> = {};
  let log: LogEntry[] = [];
  /** Each hand's latest deal as the game traced it, read into a WhyNot only
   *  when asked: the board frame that brings the hand's contents arrives after
   *  the deal's trace, so reading at trace time would read the old hand. */
  let lastDeals: Record<string, { cards: readonly { id: string; verdict: TraceVerdict }[]; turn: number | undefined }> = {};
  let project: string | undefined;
  let following: string | null = null;
  let seq = 0;
  /** The turn the last play stamped: the runtime stamps a play's writes with
   *  the play's own turn, so the journal reads the same way here. */
  let playTurn: number | undefined;

  const reset = (): void => {
    following = null;
    hands = {}; turns = {}; log = []; lastDeals = {}; playTurn = undefined;
  };

  const turnFor = (event: TraceEvent): number | undefined => {
    switch (event.type) {
      case "deal": case "evict": { const box = deps.handBox(event.hand); return box === undefined ? undefined : turns[box]; }
      case "peek": return turns[event.box];
      case "play": return event.turn;
      case "write": return playTurn;
      case "turns": return event.turn;
      case "diagnostic": return undefined;
    }
  };

  const record = (event: TraceEvent): void => {
    const turn = turnFor(event);
    log.push({ ...event, seq: seq++, ...(turn !== undefined ? { turn } : {}) });
    if (log.length > LIVE_LOG_CAP) log.splice(0, log.length - LIVE_LOG_CAP);
  };

  return {
    get hands() { return hands; },
    get turns() { return turns; },
    get log() { return log; },
    get whyNot() {
      const out: Record<string, WhyNot> = {};
      for (const [hand, d] of Object.entries(lastDeals)) {
        // The game's own report of the hand; the deal's own cards stand in
        // until a board frame has arrived.
        const here = hands[hand] ?? d.cards.filter((c) => c.verdict === "dealt").map((c) => c.id);
        out[hand] = whyNotOf(d.cards, deps.label, here, d.turn);
      }
      return out;
    },
    get project() { return project; },
    get following() { return following; },
    follow(flowId, board) {
      if (flowId === following) return;
      const wasProject = project;
      reset();
      project = wasProject;
      following = flowId;
      // Seed from the last board that flow sent, so switching participant
      // shows their table at once rather than an empty one until they move.
      if (board) { hands = { ...board.hands }; turns = { ...board.turns }; }
    },
    reset,
    apply(frame: LiveLinkFrame): LiveApplied {
      const out: LiveApplied = { dealt: [] };
      // Everything but the handshake belongs to one participant, and this view
      // follows one. A frame from anyone else is somebody else's story.
      if (frame.t !== "hello") {
        if (following === null) following = frame.flow;
        else if (frame.flow !== following) return out;
      }
      switch (frame.t) {
        case "hello":
          reset();
          project = frame.project;
          break;
        case "board":
          hands = { ...frame.hands };
          turns = { ...frame.turns };
          break;
        case "trace": {
          const event = frame.event;
          if (event.type === "play") playTurn = event.turn;
          record(event);
          if (event.type === "deal") {
            out.dealt = event.cards.filter((c) => c.verdict === "dealt").map((c) => c.id);
            // The latest deal for this hand is the one that explains what is
            // on the table now; an earlier deal's reasons are history.
            lastDeals = { ...lastDeals, [event.hand]: { cards: event.cards, turn: turnFor(event) } };
          } else if (event.type === "play") {
            out.played = event.card;
          }
          break;
        }
      }
      return out;
    },
  };
}
