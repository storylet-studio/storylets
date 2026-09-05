// ---------------------------------------------------------------------------
// The monitor stream (wire 6.5 `events`, 6.2 for the transport of it).
//
// The same ticket, the same `EventSource`, the same `last=` resume as a
// station's stream, with one field different in the body: `{ monitor: true }`.
// That one field is the whole of monitor scope, and the server refuses it with
// `wrong_role` for anything but a monitor or a producer principal (wire 6.4),
// which is why this is a REFUSAL rather than a hold: an integrator key will
// never be entitled to it, and a client retrying every second is arguing with
// a server that has decided.
//
// IT DOES NOT OPEN BY ITSELF. A station connection streams from the moment it
// exists because a station with no stream is a dark screen; a producer key is
// as often an integrator firing one command from a show-control cue as it is
// the console with a timeline on it, and opening a stream that key may not
// have is a refusal nobody asked for. So: `monitor.start()`, which the console
// calls when its timeline mounts.
//
// WHAT ARRIVES IS EVERY FLOW. That is the point of the scope, and it is why
// the subscriptions here are per EVENT KIND rather than per visit: a console
// watches the venue, and a monitor stream now spans one, several stories at
// once (wire 4a). The events that belong to one story say which.
// ---------------------------------------------------------------------------

import type {
  FlowRef, InstallationId, IsoTimestamp, WireEvent,
} from "@storylet-studio/wire";
import { safely } from "./errors.js";
import type { ClientError } from "./errors.js";
import type { Timers } from "./queue.js";
import { createStream } from "./stream.js";
import type { ConnectionState, EventSourceCtor, Stream } from "./stream.js";
import type { Bearer, Transport } from "./transport.js";

/** One event's type, narrowed to the arm of the union that carries it. */
export type WireEventOf<K extends WireEvent["type"]> = Extract<WireEvent, { type: K }>;

/**
 * How long a timeline is kept in memory.
 *
 * A run is a day long and a busy venue pushes an event a second, so an
 * unbounded merge is a console that gets slower until somebody reloads it.
 * The JOURNAL is the long record and it is paged from the server
 * (`runs.journal`); this is the tail a screen is showing.
 */
export const MONITOR_TIMELINE_CAP = 500;

/**
 * One line of the merged stream, which is what the console's timeline renders.
 *
 * The raw `event` is kept whole beside the summary, because a timeline that
 * threw the event away would need a second subscription to draw anything the
 * summary did not say, and then the two would disagree about order.
 */
export interface TimelineEntry {
  /** The SSE event id, when the server sent one. */
  id?: string;
  at: IsoTimestamp;
  kind: WireEvent["type"];
  /** Which story, when the event says. `presence` and `installation` are
   *  venue-wide and never do (wire 4a). */
  installation?: InstallationId;
  /** The flow, for the events that carry one: `board`, `trace`, `visit`, `cue`. */
  flow?: FlowRef;
  /** One line, written for a person, from the fields the event actually has.
   *  Never the whole story: it is the row, and `event` is the detail. */
  summary: string;
  event: WireEvent;
}

/** Every typed subscription, plus the raw one and the merged timeline. */
export interface Monitor {
  /** Open the stream. Safe to call twice. Does nothing after `close`. */
  start(): void;
  /** What the stream is doing. `held` here says the TIMELINE is stale, never
   *  that a command is waiting: a producer's commands do not queue. */
  readonly connection: ConnectionState;
  /** The server's refusal of monitor scope, when there is one. Set instead of
   *  a hold, and cleared the moment a stream opens. */
  readonly refusal: ClientError | undefined;
  /** The last event id seen, which is what a resume sends. */
  readonly lastEventId: string | undefined;
  /** The merged stream, oldest first, capped at {@link MONITOR_TIMELINE_CAP}. */
  readonly timeline: TimelineEntry[];
  /** Told on every connection-state change, and once immediately. */
  subscribe(listener: (state: ConnectionState, refusal?: ClientError) => void): () => void;
  /** Every event, raw and in order. */
  on(listener: (event: WireEvent) => void): () => void;
  /** Told with the whole timeline whenever it grows, and once immediately. */
  onTimeline(listener: (entries: TimelineEntry[]) => void): () => void;

  onVisit(listener: (event: WireEventOf<"visit">) => void): () => void;
  onBoard(listener: (event: WireEventOf<"board">) => void): () => void;
  onTrace(listener: (event: WireEventOf<"trace">) => void): () => void;
  onWorld(listener: (event: WireEventOf<"world">) => void): () => void;
  onRun(listener: (event: WireEventOf<"run">) => void): () => void;
  onPresence(listener: (event: WireEventOf<"presence">) => void): () => void;
  onMessage(listener: (event: WireEventOf<"message">) => void): () => void;
  onInstallation(listener: (event: WireEventOf<"installation">) => void): () => void;

  /** Close for good: the stream goes and every listener with it. */
  close(): void;
}

export interface MonitorDeps {
  transport: Transport;
  bearer(): Bearer;
  EventSource?: EventSourceCtor;
  timers?: Timers;
}

/** The line a timeline draws for one event. Deliberately plain: the console
 *  styles it, and the words here are the same words the journal uses. */
function summarise(event: WireEvent): string {
  switch (event.type) {
    case "ready":
      return `stream ready at ${event.venue.name}`;
    case "board":
      return `board changed for ${event.flow}`;
    case "trace":
      return `${event.event.type} in ${event.flow}`;
    case "world": {
      const who = event.actor.label ?? event.actor.id ?? event.actor.kind;
      return `${event.path} set to ${String(event.value)} by ${who}`;
    }
    case "visit":
      return `visit ${event.visit} ${event.phase}${event.station !== undefined ? ` (${event.station})` : ""}`;
    case "run":
      return `run ${event.run.run} ${event.phase}`;
    case "cue":
      return `${event.bridge} fired on ${event.verb}${event.card !== undefined ? ` of ${event.card}` : ""}`;
    case "message":
      return `${event.message.priority}: ${event.message.body}`;
    case "presence":
      return `${event.presence.station} at ${event.presence.location ?? "nowhere in particular"}`;
    case "installation":
      return `${event.installation.name} ${event.phase}`;
    case "replay-lost":
      return event.message ?? "the replay buffer has moved on; re-read";
    default:
      // An event kind added since this client was built. The wire's own rule
      // is that a receiver ignores what it does not know, so it is listed
      // rather than dropped, and the raw event is there to read.
      return (event as { type: string }).type;
  }
}

/** The fields a timeline row shows beside the summary, when the event has
 *  them. Read structurally, because only some arms of the union carry each. */
const tagOf = (event: WireEvent): { installation?: InstallationId; flow?: FlowRef } => {
  const e = event as { installation?: unknown; flow?: unknown };
  return {
    ...(typeof e.installation === "string" ? { installation: e.installation } : {}),
    ...(typeof e.flow === "string" ? { flow: e.flow } : {}),
  };
};

export function createMonitor(deps: MonitorDeps): Monitor {
  let state: ConnectionState = "disconnected";
  let refusal: ClientError | undefined;
  let closed = false;
  let entries: TimelineEntry[] = [];

  const stateListeners = new Set<(s: ConnectionState, r?: ClientError) => void>();
  const rawListeners = new Set<(e: WireEvent) => void>();
  const timelineListeners = new Set<(entries: TimelineEntry[]) => void>();
  /** One set per event kind, so a listener for `world` is never called with a
   *  `board` and no subscription has to switch on `type` again. */
  const byKind = new Map<WireEvent["type"], Set<(e: never) => void>>();

  const announce = (): void => {
    for (const l of stateListeners) safely(() => l(state, refusal));
  };

  const deliver = (event: WireEvent): void => {
    const entry: TimelineEntry = {
      ...(event.id !== undefined ? { id: event.id } : {}),
      at: event.at,
      kind: event.type,
      ...tagOf(event),
      summary: summarise(event),
      event,
    };
    entries = [...entries, entry];
    if (entries.length > MONITOR_TIMELINE_CAP) entries = entries.slice(entries.length - MONITOR_TIMELINE_CAP);
    for (const l of byKind.get(event.type) ?? []) safely(() => (l as (e: WireEvent) => void)(event));
    for (const l of rawListeners) safely(() => l(event));
    for (const l of timelineListeners) safely(() => l(entries));
  };

  const stream: Stream = createStream({
    transport: deps.transport,
    bearer: deps.bearer,
    ...(deps.EventSource !== undefined ? { EventSource: deps.EventSource } : {}),
    ...(deps.timers !== undefined ? { timers: deps.timers } : {}),
    monitor: true,
    onEvent: deliver,
    onRefused: (error) => { refusal = error; },
    onState: (next) => {
      state = next;
      announce();
    },
    // Nothing to re-read: a monitor holds no board of its own, and the
    // timeline's gap is the `replay-lost` line the console is about to draw.
    onResync: () => { /* the entry itself is the notice */ },
  });

  const kind = <K extends WireEvent["type"]>(k: K) =>
    (listener: (event: WireEventOf<K>) => void): (() => void) => {
      const set = byKind.get(k) ?? new Set();
      byKind.set(k, set);
      set.add(listener as (e: never) => void);
      return () => { set.delete(listener as (e: never) => void); };
    };

  return {
    start(): void {
      if (closed) return;
      // `connecting` before the ticket, so a console that mounted its banner
      // does not read "disconnected" for the length of one round trip.
      if (state === "disconnected") {
        state = "connecting";
        announce();
      }
      stream.start();
    },
    get connection(): ConnectionState { return state; },
    get refusal(): ClientError | undefined { return refusal; },
    get lastEventId(): string | undefined { return stream.lastEventId; },
    get timeline(): TimelineEntry[] { return entries; },
    subscribe(listener) {
      stateListeners.add(listener);
      safely(() => listener(state, refusal));
      return () => { stateListeners.delete(listener); };
    },
    on(listener) {
      rawListeners.add(listener);
      return () => { rawListeners.delete(listener); };
    },
    onTimeline(listener) {
      timelineListeners.add(listener);
      safely(() => listener(entries));
      return () => { timelineListeners.delete(listener); };
    },
    onVisit: kind("visit"),
    onBoard: kind("board"),
    onTrace: kind("trace"),
    onWorld: kind("world"),
    onRun: kind("run"),
    onPresence: kind("presence"),
    onMessage: kind("message"),
    onInstallation: kind("installation"),
    close(): void {
      if (closed) return;
      closed = true;
      stream.close();
      stateListeners.clear();
      rawListeners.clear();
      timelineListeners.clear();
      byKind.clear();
    },
  };
}
