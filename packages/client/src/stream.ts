// ---------------------------------------------------------------------------
// The event stream (wire 6.2): a stream ticket, an `EventSource`, replay from
// `Last-Event-ID`, and a reconnect that backs off.
//
// THE TICKET IS NOT OPTIONAL. A browser `EventSource` cannot set a header, so
// the bearer cannot ride on the stream itself; the old server's real SSE
// connections 401'd for months for exactly that reason. So: an authenticated
// `POST /v1/stream-ticket`, then `GET /v1/events?t=<ticket>`, and a fresh
// ticket for every reconnect because the ticket is short-lived by design.
//
// RESUME. An `EventSource` that reconnects BY ITSELF sends `Last-Event-ID` as
// a header, which is the spec's mechanism and costs us nothing. But a ticket
// expires, so a reconnect after any real outage is a NEW `EventSource`, and a
// new one has no history to send. This client therefore carries the same value
// in the query string (`&last=`) on every connection it opens itself, and the
// server is expected to honour either. The frames fixture pins the query form,
// since that is the one the client controls.
//
// `EventSource` is injectable for the same reason `fetch` is, and because
// Node 22's global one is still behind a flag: a Node-side kiosk or a test
// passes its own.
// ---------------------------------------------------------------------------

import type { WireEvent } from "@storylet-studio/wire";
import type { CreateStreamTicketResponse } from "@storylet-studio/wire";
import { ClientError, safely } from "./errors.js";
import type { Bearer, Transport } from "./transport.js";
import type { Timers } from "./queue.js";

/** The query parameter this client resumes with. A fresh `EventSource` has no
 *  `Last-Event-ID` header of its own to send, and the ticket makes every
 *  reconnect a fresh one. */
export const LAST_EVENT_ID_PARAM = "last";

/** What a UI renders. Five states and no sixth: anything else is one of these
 *  wearing a different word.
 *
 *  - `connecting`  no stream yet, and nothing to show from a previous one.
 *  - `live`        connected; what you are looking at is current.
 *  - `replaying`   connected, but re-reading after a resume or a `replay-lost`;
 *                  the board on screen is about to be replaced.
 *  - `disconnected` no stream, and no last board worth holding.
 *  - `held`        DEGRADED MODE: no stream, and the last board is still on
 *                  screen on purpose (spec 17 item 2). Commands queue. */
export type ConnectionState = "connecting" | "live" | "replaying" | "disconnected" | "held";

/** Backoff for reconnecting the stream. Longer tail than the command queue's:
 *  a stream that cannot open is usually a server that is not there, and a
 *  hall of kiosks retrying every half second is a denial of service the venue
 *  performs on itself. */
export const STREAM_BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000] as const;

/** The slice of `EventSource` this client uses. */
export interface EventSourceLike {
  close(): void;
  addEventListener(type: "open" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (ev: { data: unknown; lastEventId?: string }) => void): void;
}
export type EventSourceCtor = new (url: string) => EventSourceLike;

export interface StreamOptions {
  transport: Transport;
  /** Read at every connection rather than captured once: a companion page
   *  that scanned a placard with no credential ADOPTS the token that scan
   *  minted, and the next ticket must be minted as the party it now is. */
  bearer: () => Bearer;
  EventSource?: EventSourceCtor;
  timers?: Timers;
  /** Ask for monitor scope. Refused with `wrong_role` unless the principal is
   *  a monitor or a producer, which a station never is. */
  monitor?: boolean;
  /** Every event, in order, already parsed. Never called with a frame that did
   *  not parse: a malformed frame is dropped, not thrown. */
  onEvent: (event: WireEvent) => void;
  /** The connection state changed. */
  onState: (state: ConnectionState) => void;
  /** The stream just came back after being away, so whatever is held is stale:
   *  re-read the board. Also called for `replay-lost`, which is the same
   *  instruction arriving explicitly. */
  onResync: (reason: "reconnect" | "replay-lost") => void;
  /** The TICKET was refused: this bearer may not have a stream here, and no
   *  amount of backing off will change that. Called with the refusal, and with
   *  `undefined` the moment a stream opens after one, so a front-end that
   *  drew the answer knows when it stops being the answer. */
  onRefused?: (error: ClientError | undefined) => void;
}

export interface Stream {
  /** Open it. Safe to call twice; the second is a no-op. */
  start(): void;
  /** Try again NOW: the bearer changed, so a ticket that could not be minted
   *  a moment ago can be minted this moment, and waiting out a backoff that
   *  has already been disproved is a visitor watching a blank phone. */
  restart(): void;
  /** The last event id seen, which is what a resume sends. */
  readonly lastEventId: string | undefined;
  /** Close for good. Every later callback is a no-op. */
  close(): void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createStream(opts: StreamOptions): Stream {
  const timers = opts.timers ?? realTimers;
  const Ctor: EventSourceCtor | undefined = opts.EventSource
    ?? (globalThis as { EventSource?: EventSourceCtor }).EventSource;

  let source: EventSourceLike | null = null;
  let closed = false;
  let started = false;
  let attempt = 0;
  let timer: unknown = null;
  let lastId: string | undefined;
  /** True once a stream has been open at least once, which is what turns a
   *  later drop into a RESYNC rather than a first connection. */
  let everOpen = false;
  let state: ConnectionState = "connecting";
  /** Set when the ticket was REFUSED. The stream is then over rather than
   *  away, and only `restart` (which is the client becoming somebody else)
   *  starts it again. */
  let stopped = false;

  const setState = (next: ConnectionState): void => {
    if (state === next || closed) return;
    state = next;
    safely(() => opts.onState(next));
  };

  const dropped = (): void => {
    if (closed) return;
    source?.close();
    source = null;
    // Degraded mode is the client's, and this is where it starts: something
    // has been on screen, so hold it and say so rather than blanking.
    setState(everOpen ? "held" : "disconnected");
    schedule();
  };

  /**
   * The ticket was refused, which is an ANSWER and not an outage.
   *
   * So: no hold, because nothing here will catch up by itself, and no ladder,
   * because a client retrying a `revoked` credential every second is arguing
   * with a server that has decided (the command queue's own rule, one file
   * along). The state says there is no stream; the refusal says why, and a
   * front-end shows THAT rather than a banner about the network. This is the
   * phone at the door on 2026-09-05, whose dead day pass was reported to its
   * owner as "No connection" (spec 17 item 2).
   */
  const refused = (error: ClientError): void => {
    if (closed) return;
    stopped = true;
    source?.close();
    source = null;
    safely(() => opts.onRefused?.(error));
    setState("disconnected");
  };

  const schedule = (): void => {
    if (closed || stopped || timer !== null) return;
    // The CURRENT attempt decides the wait, and only then does the counter
    // move: the first retry is the short one, which is the whole point of a
    // ladder that starts at a second.
    const ms = STREAM_BACKOFF_MS[Math.min(attempt, STREAM_BACKOFF_MS.length - 1)] ?? 30_000;
    attempt++;
    timer = timers.setTimeout(() => {
      timer = null;
      void connect();
    }, ms);
  };

  const connect = async (): Promise<void> => {
    if (closed || source !== null) return;
    if (!Ctor) {
      // No EventSource anywhere. Not fatal: everything else works, the client
      // is simply blind to pushes, and a front-end polls or does not.
      setState(everOpen ? "held" : "disconnected");
      return;
    }
    if (!everOpen) setState("connecting");
    let ticket: string;
    try {
      const res = await opts.transport.send<CreateStreamTicketResponse>(opts.bearer(), {
        method: "POST",
        path: "/stream-ticket",
        body: opts.monitor === true ? { monitor: true } : {},
      });
      ticket = res.ticket;
    } catch (err) {
      // Two different failures wearing one shape. A REFUSAL is the server
      // saying this bearer gets no stream; anything else (no answer at all, a
      // 5xx, a proxy's HTML) is the server being away, which is the hold and
      // the backoff.
      if (err instanceof ClientError && err.refusal) refused(err);
      else dropped();
      return;
    }
    if (closed) return;

    const url = opts.transport.url("/events", {
      t: ticket,
      ...(lastId !== undefined ? { [LAST_EVENT_ID_PARAM]: lastId } : {}),
    });
    let es: EventSourceLike;
    try {
      es = new Ctor(url);
    } catch {
      dropped();
      return;
    }
    source = es;

    es.addEventListener("open", () => {
      if (closed || source !== es) return;
      attempt = 0;
      // Whatever was refused is no longer the answer: this bearer has a stream.
      safely(() => opts.onRefused?.(undefined));
      const resuming = everOpen;
      everOpen = true;
      if (resuming) {
        // Back after an outage. Whatever is held may have missed anything, so
        // the front-end is told to re-read before it is told it is live again.
        setState("replaying");
        safely(() => opts.onResync("reconnect"));
      }
      setState("live");
    });
    es.addEventListener("error", () => {
      if (closed || source !== es) return;
      dropped();
    });
    es.addEventListener("message", (ev) => {
      if (closed || source !== es) return;
      if (typeof ev.data !== "string") return;
      let event: WireEvent;
      try {
        event = JSON.parse(ev.data) as WireEvent;
      } catch {
        return; // a half-written frame is not the host's problem
      }
      if (typeof (event as { type?: unknown }).type !== "string") return;
      const id = event.id ?? ev.lastEventId;
      if (typeof id === "string" && id.length > 0) lastId = id;
      if (event.type === "replay-lost") {
        setState("replaying");
        safely(() => opts.onResync("replay-lost"));
        safely(() => opts.onEvent(event));
        setState("live");
        return;
      }
      safely(() => opts.onEvent(event));
    });
  };

  return {
    get lastEventId(): string | undefined {
      return lastId;
    },
    start(): void {
      if (started || closed) return;
      started = true;
      void connect();
    },
    restart(): void {
      if (closed) return;
      started = true;
      // A refusal was refused for the bearer this stream HAD, and a restart is
      // the client saying it is somebody else now.
      stopped = false;
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      attempt = 0;
      try {
        source?.close();
      } catch {
        /* already gone */
      }
      source = null;
      void connect();
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      try {
        source?.close();
      } catch {
        /* already gone */
      }
      source = null;
    },
  };
}
