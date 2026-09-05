// ---------------------------------------------------------------------------
// The HTTP half: one place that knows about bearers, JSON, query strings and
// the `Idempotency-Key` header, so no verb anywhere else builds a request.
//
// `fetch` is INJECTABLE, for the same reason the Live Link's WebSocket is: a
// test that has to stand up a real listener to check a header is a test nobody
// writes twice. Node 22 and every browser have a global one, so the option is
// empty in a venue and full in a suite.
//
// EVERY MUTATION CARRIES `Idempotency-Key`, minted once and REUSED on retry
// (wire 6.4). That is what makes the degraded-mode queue safe: a play pressed
// during a wifi blip may reach the server twice, and the second arrival is the
// first one's answer rather than a second card played.
// ---------------------------------------------------------------------------

import { IDEMPOTENCY_HEADER, WIRE_PATH } from "@storylet-studio/wire";
import { ClientError, OFFLINE, errorFromBody } from "./errors.js";

/** The slice of `fetch` this client uses. Structural, so a test double is a
 *  function rather than an implementation of the whole standard. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

/** The slice of `RequestInit` this client sends. */
export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Passed straight through from `createClient`, for a companion page served
   *  from somewhere other than the server it talks to. */
  credentials?: "omit" | "same-origin" | "include";
  signal?: unknown;
}

/** The slice of `Response` this client reads. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** How a request is described by everything above this file. */
export interface Call {
  /** `PUT` and `PATCH` are the console's (wire 6.5): a cue list and a binding
   *  are put whole, and a pocket, a location, an installation and a
   *  principal's label are patched. The station and party API uses neither. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Below `/v1`: `/hello`, `/visits/abc/play`, `/console/runs`. Segments must
   *  be encoded by the caller through {@link seg}. */
  path: string;
  /** Query parameters. `undefined` values are dropped, so a caller need not
   *  build the object conditionally. A boolean rides as `true`/`false`, which
   *  is what the console's list filters (`idle`, `claimed`, `open`,
   *  `revoked`) are. */
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** A mutation's key. Present means the header is sent; the same key on a
   *  retry is the whole point of the queue. */
  idempotencyKey?: string;
}

/** Percent-encode one path segment. Ids are opaque ULIDs and gameIds are
 *  author-facing text, so a card called `a/b` must not become two segments. */
export const seg = (value: string): string => encodeURIComponent(value);

export interface TransportOptions {
  /** The server's origin, with or without a trailing slash. */
  base: string;
  fetch?: FetchLike;
  credentials?: "omit" | "same-origin" | "include";
}

/** What a bearer is: a station key, a party token, or nothing at all (the
 *  anonymous `hello` a companion page makes before it holds anything). */
export type Bearer = string | undefined;

export interface Transport {
  readonly base: string;
  /** Send one call as `bearer`. Rejects with {@link ClientError} and nothing
   *  else: a network failure becomes `offline` with status 0. */
  send<T>(bearer: Bearer, call: Call): Promise<T>;
  /** The absolute URL for a path, which the stream needs to hand to an
   *  `EventSource` rather than to `fetch`. */
  url(path: string, query?: Record<string, string | number | boolean | undefined>): string;
}

/** Trim one trailing slash so `https://venue/` and `https://venue` behave the
 *  same, which is the difference between a placard that works and one that
 *  404s on a double slash. */
const trimBase = (base: string): string => base.replace(/\/+$/, "");

export function createTransport(opts: TransportOptions): Transport {
  const base = trimBase(opts.base);
  const doFetch: FetchLike | undefined = opts.fetch
    ?? (globalThis as { fetch?: FetchLike }).fetch?.bind(globalThis);

  const url = (path: string, query?: Record<string, string | number | boolean | undefined>): string => {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return `${base}${WIRE_PATH}${path}${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  return {
    base,
    url,
    async send<T>(bearer: Bearer, call: Call): Promise<T> {
      if (!doFetch) {
        // No fetch anywhere: a host that never passed one and has no global.
        // A refusal a person can act on, not a TypeError three frames deep.
        throw new ClientError(OFFLINE, "this host has no fetch, and none was passed to createClient", 0);
      }
      const headers: Record<string, string> = { Accept: "application/json" };
      if (bearer !== undefined) headers["Authorization"] = `Bearer ${bearer}`;
      if (call.body !== undefined) headers["Content-Type"] = "application/json";
      if (call.idempotencyKey !== undefined) headers[IDEMPOTENCY_HEADER] = call.idempotencyKey;

      const init: FetchInit = { method: call.method, headers };
      if (call.body !== undefined) init.body = JSON.stringify(call.body);
      if (opts.credentials !== undefined) init.credentials = opts.credentials;

      let res: FetchResponse;
      try {
        res = await doFetch(url(call.path, call.query), init);
      } catch (cause) {
        // The blip. Status 0 is the signal the command queue reads: this
        // command may or may not have landed, so it is retried with the SAME
        // key rather than abandoned or duplicated.
        const why = cause instanceof Error ? cause.message : String(cause);
        throw new ClientError(OFFLINE, `could not reach ${base}: ${why}`, 0);
      }

      const text = await res.text().catch(() => "");
      let parsed: unknown = undefined;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }
      if (!res.ok) {
        throw errorFromBody(res.status, parsed, `${call.method} ${call.path} failed with ${res.status}`);
      }
      // A 204 (park, detach) is a legal empty answer; the caller's type says
      // what it expected and an empty object is the honest stand-in.
      return (parsed ?? {}) as T;
    },
  };
}
