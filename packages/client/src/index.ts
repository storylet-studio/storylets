// ---------------------------------------------------------------------------
// @storylet-studio/client - the Storylet Server's headless client.
//
// LAYER 2 of the four (design/engine-server.md section 12). The wire is the
// types; this is the behaviour every front-end needs and none of them should
// write twice: the transport, the two bearers, the visit as an observable
// state machine, the event stream with replay and reconnect, degraded mode,
// and an idempotent command queue. No DOM, no framework, no opinion about
// pixels. Browser and Node 22.
//
// The rule this exists for: **the thinner the UI we expect to survive, the
// thicker the layer beneath it must be.** A venue's agency rebuilds a kiosk
// from nothing and keeps all of the above, which is the test the layering has
// to pass.
//
//   import { createClient } from "@storylet-studio/client";
//
//   const client = createClient({ base: "http://venue.local:4470" });
//   const station = client.connectStation(key);
//   const { visit } = await station.handshake({ credential: "token", token });
//   visit.subscribe((s) => render(s.board, s.held));
//   await visit.deal();
// ---------------------------------------------------------------------------

import type { HelloResponse } from "@storylet-studio/wire";
import { createPartyConnection, createStationConnection } from "./connection.js";
import type { PartyConnection, StationConnection } from "./connection.js";
import { defaultKeys } from "./queue.js";
import type { Timers } from "./queue.js";
import type { EventSourceCtor } from "./stream.js";
import { createTransport } from "./transport.js";
import type { FetchLike } from "./transport.js";

export { ClientError, OFFLINE } from "./errors.js";
export type { ClientErrorCode } from "./errors.js";
export { QUEUE_BACKOFF_MS, QUEUE_CAP } from "./queue.js";
export type { CommandQueue, Timers } from "./queue.js";
export { LAST_EVENT_ID_PARAM, STREAM_BACKOFF_MS } from "./stream.js";
export type { ConnectionState, EventSourceCtor, EventSourceLike } from "./stream.js";
export { seg } from "./transport.js";
export type { Call, FetchInit, FetchLike, FetchResponse, Transport } from "./transport.js";
export type { Visit, VisitState } from "./visit.js";
export type {
  Attached, Connection, MessageDesk, PartyConnection, StationConnection,
} from "./connection.js";

export interface ClientOptions {
  /** The server's origin: `http://venue.local:4470`, or the origin a companion
   *  page was served from. A trailing slash is tolerated. */
  base: string;
  /** A `fetch` to use instead of the global one. Node 22 and every browser
   *  have one; a test passes a double, and so does a host that wants its own
   *  timeouts or proxy. */
  fetch?: FetchLike;
  /** An `EventSource` to use instead of the global one. Node's is still behind
   *  a flag, so a Node-side kiosk passes one; so does every test. */
  EventSource?: EventSourceCtor;
  /** Passed to `fetch` for a companion page served from somewhere other than
   *  the server it talks to. */
  credentials?: "omit" | "same-origin" | "include";
  /** Timers, for a test that will not wait out a backoff. */
  timers?: Timers;
  /** Mint an `Idempotency-Key`. One per command, REUSED on every retry of that
   *  command, which is what makes the offline queue safe. Injectable so the
   *  frames fixture is a stable snapshot rather than a diff of random
   *  strings. */
  newIdempotencyKey?: () => string;
}

/** A connection to one server: the venue's, or the cloud's. */
export interface Client {
  /** The origin, normalised. */
  readonly base: string;
  /** What the server is, before this client holds anything at all: the venue,
   *  the open stories, the protocol version. The first call any front-end
   *  makes, and the one that says whether the key still works. */
  hello(): Promise<HelloResponse>;
  /** Act as a station: hardware the venue owns, holding a key. It VOUCHES, so
   *  it may mint parties, resolve a call sign, issue credentials and report
   *  presence (spec 7.1). */
  connectStation(key: string): StationConnection;
  /** Act as a party: a phone holding its own token. It HOLDS, so it may scan a
   *  placard, pick a story and claim its own pocket, and nothing else.
   *
   *  The token is OPTIONAL, because the walk-up is the case this exists for: a
   *  phone that has never been here holds nothing, scans a placard anonymously
   *  and adopts the token that scan mints (spec 7.1). An empty string is the
   *  same as none, so a page reading an empty `localStorage` need not think
   *  about it. */
  connectParty(token?: string): PartyConnection;
}

export function createClient(opts: ClientOptions): Client {
  const transport = createTransport({
    base: opts.base,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.credentials !== undefined ? { credentials: opts.credentials } : {}),
  });
  const key = opts.newIdempotencyKey ?? defaultKeys();
  const shared = {
    transport,
    key,
    ...(opts.EventSource !== undefined ? { EventSource: opts.EventSource } : {}),
    ...(opts.timers !== undefined ? { timers: opts.timers } : {}),
  };

  return {
    base: transport.base,
    hello() {
      // Anonymous on purpose: what the caller is comes from the bearer, and
      // before a handshake there is not one. A companion page's very first
      // request, and a placard scan's, are both this.
      return transport.send<HelloResponse>(undefined, { method: "POST", path: "/hello", body: {} });
    },
    connectStation(stationKey: string): StationConnection {
      return createStationConnection({ ...shared, bearer: stationKey });
    },
    connectParty(token?: string): PartyConnection {
      // `""` is not a credential: sending `Authorization: Bearer ` would make
      // an anonymous phone look like a party holding an empty token, which is
      // a lie to the server and a lie in the frames fixture.
      return createPartyConnection({ ...shared, bearer: token === "" ? undefined : token });
    },
  };
}
