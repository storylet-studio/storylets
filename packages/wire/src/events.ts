// ---------------------------------------------------------------------------
// The SSE events (6.4, 6.7). One stream per connected client, `Last-Event-ID`
// replay off a per-run ring buffer, `replay-lost` when the cursor has fallen
// off (6.2).
//
// The trace is the engine's own event NORMALISED to gameIds at the boundary
// (6.3, 4.4). It is mirrored here rather than imported from
// `@storylet-studio/runtime` for two reasons: this package must stay
// dependency-light and types-only, and the runtime's ids are internal ones,
// so importing the union would put the wrong identity on the wire in a way
// that compiles.
// ---------------------------------------------------------------------------

import type { ScalarValue } from "@storylet-studio/model";
import type {
  Actor, BuildIdentity, FlowRef, GameId, InstallationId, IsoTimestamp, PropertyPath, StationId,
  VisitId,
} from "./vocabulary.js";
import type {
  BoardView, InstallationView, MessageView, PresenceView, RunView, StationView, TurnsView, VenueView,
  VisitView,
} from "./views.js";

/** Why a card did or did not make an ask, in availability order (schema 3.1).
 *  The runtime's `TraceVerdict`, verbatim: the words are the contract, and
 *  they are what a Board and a bug report read back. */
export type WireTraceVerdict =
  | "dealt"
  | "capped"
  | "cooldown"
  | "deck-gate"
  | "tags"
  | "condition"
  | "priority"
  | "claimed"
  | "claimed-elsewhere"
  | "taken";

/** One card's line in an ask's verdicts, by gameId. */
export interface WireTraceCard {
  /** The card's gameId. */
  id: GameId;
  verdict: WireTraceVerdict;
  priority?: number;
  specificity?: number;
}

/**
 * The runtime's `TraceEvent`, with every id a gameId.
 *
 * Field for field the same union, so a Board written against the local
 * runtime reads a remote run without a translation layer, and so the
 * server's normalisation has one place to be checked against.
 */
export type WireTraceEvent =
  /** A hand was dealt: the ask, and every card's verdict. */
  | { type: "deal"; hand: GameId; cards: WireTraceCard[] }
  /** A box was peeked: the same ask, without the claims. */
  | { type: "peek"; box: GameId; criteria: Record<GameId, GameId>; cards: WireTraceCard[] }
  /** A card left a hand, and why. */
  | { type: "evict"; hand: GameId; card: GameId; reason: WireTraceVerdict | "hand-condition" | "vanished" }
  /** A card was played, with the box clock it was played on. */
  | { type: "play"; card: GameId; outcome: GameId; turn: number }
  /** One landed outcome change; `path` is the resolved store location, so a
   *  routed `@hand` write shows where it actually went (schema 3.6). */
  | { type: "write"; target: string; path: PropertyPath; value: ScalarValue; prev?: ScalarValue }
  /** An explicit clock advance; `turn` is the box's new value. */
  | { type: "turns"; box: GameId; turn: number }
  /** An expression eval error: never a silent pass, always visible. */
  | { type: "diagnostic"; where: string; message: string };

/** What every event carries. `id` is the SSE event id a client replays from. */
export interface WireEventBase {
  /** Monotonic per run; the value a client sends back as `Last-Event-ID`. */
  id?: string;
  at: IsoTimestamp;
}

/**
 * Everything the server pushes, discriminated on `type`.
 *
 * THE FAN-OUT RULE (6.4), which the old server got subtly wrong once and
 * which the frames fixture pins: **an event tagged with a flow goes to
 * holders of that flow's token, plus monitors.** A station never receives
 * another party's per-flow events. The events that carry `flow` are
 * `board`, `trace`, `visit` and `cue`; the rest are installation-wide and
 * go to everyone connected, except `message`, which goes to its audience
 * (6.7). A monitor-scoped stream receives every event, flow-tagged.
 *
 * A monitor stream now spans a VENUE, which hosts several stories at once
 * (4a), so the events that belong to one installation say which: required on
 * `visit`, where the routing is the point, and optional elsewhere, since a
 * party's own stream is in one story by construction and needs no repeating.
 * `presence` and `installation` are venue-wide, and `presence` reports a
 * location rather than a zone for the same reason.
 */
export type WireEvent =
  /** First frame on every stream: who the server thinks you are, and what
   *  you are looking at. A reconnect that gets a different `run` should
   *  re-read rather than assume its board survived. */
  | (WireEventBase & {
      type: "ready";
      server: { version: string };
      wire: string;
      /** The building, as `hello` gives it (4a). */
      venue: VenueView;
      /** The OPEN stories running in it, mirroring `hello` so a client that
       *  reconnects need not call both. */
      installations: InstallationView[];
      /** The one this stream is scoped to, when the bearer is in a story: a
       *  party token, or a crew handset signed in. Absent on a monitor stream
       *  and on a station key that is in none. */
      installation?: InstallationId;
      run?: RunView;
      build?: BuildIdentity;
      /** Present for a station key. */
      station?: StationView;
      /** Present for a party token or an attached station. */
      visit?: VisitView;
      /** Monitor scope: this stream sees every flow. */
      monitor?: boolean;
    })
  /** The cheap snapshot, after a deal, a play, an eviction or a turn
   *  advance. A client that renders from this never needs a board read. */
  | (WireEventBase & { type: "board"; flow: FlowRef; installation?: InstallationId; visit?: VisitId; board: BoardView; turns?: TurnsView })
  /** The engine's own event, normalised (6.3). Re-emitted on replay, since
   *  traces are derived from applying commands and are not journaled (5.2). */
  | (WireEventBase & { type: "trace"; flow: FlowRef; installation?: InstallationId; event: WireTraceEvent; seq?: number; turn?: number })
  /** A `@world` change, with the actor that made it: a producer, a bridge's
   *  trigger in, a crew station's presence mirror (5.6, 5.7). */
  | (WireEventBase & { type: "world"; installation?: InstallationId; path: PropertyPath; value: ScalarValue; prev?: ScalarValue; actor: Actor })
  /** A visit's life: opened, a station attached or detached, parked, closed. */
  | (WireEventBase & {
      type: "visit";
      flow: FlowRef;
      /** Which story this visit is in. Required, unlike elsewhere: a venue
       *  console watching every story reads the roster from these (4a). */
      installation: InstallationId;
      visit: VisitId;
      phase: "opened" | "attached" | "detached" | "parked" | "closed";
      /** Which station attached or detached. */
      station?: StationId;
    })
  /** The run's life. `build-changed` is a hot swap or a go-live: a client
   *  should re-read, because what it holds may name cards that are gone. */
  | (WireEventBase & { type: "run"; installation?: InstallationId; phase: "started" | "ended" | "paused" | "resumed" | "build-changed"; run: RunView })
  /** What a bridge just sent, for displays that want to mirror it (6.5). The
   *  server never interprets a card's fields; this is the delivery, echoed. */
  | (WireEventBase & {
      type: "cue";
      flow: FlowRef;
      installation?: InstallationId;
      bridge: string;
      /** The verb that fired it. */
      verb: "deal" | "play" | "evict";
      hand?: GameId;
      card?: GameId;
      /** The card's fields, which are the cue vocabulary (5.6). */
      fields?: Record<string, ScalarValue>;
    })
  /** A message for this station, its zone, its kind, or everyone (6.7). */
  | (WireEventBase & { type: "message"; message: MessageView })
  /** A station moved: for the console's map, and for crew screens that show
   *  colleagues. The presence carries the venue LOCATION the device reported
   *  and the zone its installation's map derives from it, if any (4a). */
  | (WireEventBase & { type: "presence"; presence: PresenceView })
  /** A story opened, closed, or became the venue's default (4a). For the
   *  console, and for any device holding a chooser: the list it drew from
   *  `hello` is stale the moment one of these arrives. */
  | (WireEventBase & {
      type: "installation";
      phase: "opened" | "closed" | "default-changed";
      installation: InstallationView;
    })
  /** The cursor has fallen off the ring buffer. Whatever the client holds is
   *  now unreliable: re-read the board, do not carry on. */
  | (WireEventBase & {
      type: "replay-lost";
      /** The oldest id the buffer still holds, when there is one. */
      from?: string;
      message?: string;
    });
