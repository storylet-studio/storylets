// ---------------------------------------------------------------------------
// Degraded mode's engine room (spec 17 item 2, and the rule every reference
// front-end must meet).
//
// A play pressed during a wifi blip is not lost and is not doubled. The call
// is minted with an `Idempotency-Key` ONCE; if the request never reaches the
// server, it goes to the head of a queue and the caller's promise stays
// pending. The queue drains IN ORDER, one at a time, with the same keys, as
// soon as anything succeeds again. The server's own idempotency then makes a
// double arrival harmless, which is why the key is minted before the first
// attempt and never re-minted.
//
// Two properties this is written for, both of which have a test:
//   - ORDER. A deal then a play must arrive in that order or the play is
//     `not_dealt`. So the queue is strictly serial: one in flight, ever.
//   - ONE SEND per command per success. A retry that succeeds resolves and
//     leaves; nothing is replayed afterwards.
//
// A refusal (any answer with a status) is NOT a blip: it rejects immediately
// and the queue moves on. Only status 0, which means "no answer at all",
// queues. Retrying a `gated` play forever would be a client arguing with a
// server that has already decided.
// ---------------------------------------------------------------------------

import { ClientError } from "./errors.js";
import type { Call, Bearer, Transport } from "./transport.js";

/** Backoff between drain attempts, in milliseconds. Short at first because a
 *  venue blip is usually a second, then settling so a server that is genuinely
 *  down is not hammered by fifty handsets. */
export const QUEUE_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15_000] as const;

/** How many commands may wait. A performer pressing a dead screen is the case:
 *  beyond this the oldest is refused so the queue cannot grow without bound,
 *  and the refusal is honest rather than silent. */
export const QUEUE_CAP = 64;

interface Waiting {
  bearer: Bearer;
  call: Call;
  resolve: (value: unknown) => void;
  reject: (reason: ClientError) => void;
}

/** Timers, injectable so a test does not wait four seconds to prove a backoff. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CommandQueue {
  /** Send a mutation, queueing it if the network is not there. Reads never go
   *  through here: a board that cannot be fetched is a board the caller
   *  already holds. */
  send<T>(bearer: Bearer, call: Call): Promise<T>;
  /** Try the queue now. Called when the stream comes back, because that is the
   *  first evidence the network returned. */
  drain(): void;
  /** How many commands are waiting, which a UI may show. */
  readonly depth: number;
  /** Stop: every waiting command is refused, so nothing is left pending on a
   *  page that has navigated away. */
  close(): void;
}

export interface QueueOptions {
  transport: Transport;
  timers?: Timers;
  /** Told whenever the queue starts holding or stops holding, so the
   *  connection state can say so without polling. */
  onHeld?: (held: boolean, reason?: string) => void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createQueue(opts: QueueOptions): CommandQueue {
  const timers = opts.timers ?? realTimers;
  const waiting: Waiting[] = [];
  let inFlight = false;
  let attempt = 0;
  let timer: unknown = null;
  let closed = false;
  let held = false;

  const setHeld = (next: boolean, reason?: string): void => {
    if (held === next) return;
    held = next;
    opts.onHeld?.(next, reason);
  };

  const schedule = (): void => {
    if (closed || timer !== null || waiting.length === 0) return;
    // As with the stream: the current attempt decides the wait, then the
    // counter moves, so the first retry is the half-second one.
    const ms = QUEUE_BACKOFF_MS[Math.min(attempt, QUEUE_BACKOFF_MS.length - 1)] ?? 15_000;
    attempt++;
    timer = timers.setTimeout(() => {
      timer = null;
      void pump();
    }, ms);
  };

  const pump = async (): Promise<void> => {
    if (closed || inFlight) return;
    const head = waiting[0];
    if (head === undefined) {
      setHeld(false);
      return;
    }
    inFlight = true;
    try {
      const value = await opts.transport.send<unknown>(head.bearer, head.call);
      waiting.shift();
      attempt = 0;
      head.resolve(value);
      inFlight = false;
      if (waiting.length === 0) setHeld(false);
      void pump();
    } catch (err) {
      inFlight = false;
      const error = err instanceof ClientError
        ? err
        : new ClientError("bad_request", String(err), 0);
      if (error.offline) {
        // Still nothing there. Keep the command, keep its key, back off.
        setHeld(true, error.message);
        schedule();
        return;
      }
      // The server answered, so this command is decided. Refuse it and carry
      // on: one gated play must not block the queue behind it.
      //
      // AND THE HOLD COMES OFF. An answer is proof the network is there, so
      // whatever is still queued is a command in flight rather than a screen
      // being held, and the refusal's own words are not a reason to hold
      // anything: they belong to the caller's promise, which is where the
      // front-end is already reading them (spec 17 item 2).
      waiting.shift();
      attempt = 0;
      head.reject(error);
      setHeld(false);
      void pump();
    }
  };

  return {
    get depth(): number {
      return waiting.length;
    },
    send<T>(bearer: Bearer, call: Call): Promise<T> {
      if (closed) {
        return Promise.reject(new ClientError("unknown_visit", "this client is closed", 0));
      }
      return new Promise<T>((resolve, reject) => {
        if (waiting.length >= QUEUE_CAP) {
          const oldest = waiting.shift();
          oldest?.reject(new ClientError(
            "bad_request",
            "the offline queue is full; this command was dropped rather than held for ever",
            0,
          ));
        }
        waiting.push({
          bearer,
          call,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        void pump();
      });
    },
    drain(): void {
      if (closed) return;
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      attempt = 0;
      void pump();
    },
    close(): void {
      closed = true;
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      const left = waiting.splice(0, waiting.length);
      for (const w of left) {
        w.reject(new ClientError("bad_request", "the client closed with this command still held", 0));
      }
      setHeld(false);
    },
  };
}

/** The default `Idempotency-Key` minter: time plus randomness, which is enough
 *  for a key whose only job is to be unique per command per device. Injectable
 *  through `createClient` so the wire fixture can be a stable snapshot rather
 *  than a diff of random strings. */
export function defaultKeys(): () => string {
  let n = 0;
  return () => `${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
