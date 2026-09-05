// ---------------------------------------------------------------------------
// One error type, carrying the wire's own code.
//
// Every non-2xx answer from the server has the same body (`WireError`), and the
// CODE is what a front-end branches on while the MESSAGE is what it shows. So
// there is exactly one error class here and it carries both, plus the HTTP
// status for the rare case a client wants it (a proxy that answered instead of
// the server, say, where there is no wire body at all).
//
// The rule the whole client is written to: **nothing thrown here ever reaches
// a host's event handler.** A `subscribe` listener that throws is caught and
// dropped; a stream frame that will not parse is ignored; a background retry
// that fails goes into the connection state rather than into an unhandled
// rejection. Errors surface only from the promise a caller is already holding.
// (The Live Link's rule, one product up: play-helpers/src/live-link.ts.)
// ---------------------------------------------------------------------------

import type { WireError, WireErrorCode } from "@storylet-studio/wire";

/** An unrecognised code is a plain failure with a readable message, per the
 *  wire's own instruction, so this is deliberately widened past the union. */
export type ClientErrorCode = WireErrorCode | (string & {});

/**
 * What every rejected call from this client rejects with.
 *
 * `status` is 0 when the request never reached a server at all (a wifi blip, a
 * DNS failure, an aborted fetch), and the code is then `offline`, which is not
 * a wire code: the server never said it. That distinction is what the command
 * queue keys off, since a refusal is final and a blip is not.
 */
export class ClientError extends Error {
  /** The wire's code, or `offline` when there was no answer to read one from. */
  readonly code: ClientErrorCode;
  /** The HTTP status, or 0 when the request did not complete. */
  readonly status: number;
  /** The per-code payload the wire allows: contract breaks, conflict sidecars,
   *  the revoking producer. Never load-bearing for control flow. */
  readonly details?: unknown;

  constructor(code: ClientErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ClientError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }

  /** True when the request never got an answer, so retrying it with the same
   *  `Idempotency-Key` is the right move rather than a second command. */
  get offline(): boolean {
    return this.status === 0;
  }

  /**
   * True when the server HEARD the question and said no: `unknown_credential`,
   * `revoked`, `not_bound`, `installation_closed`, `wrong_role`.
   *
   * A refusal is an ANSWER, and the difference matters on a screen. Degraded
   * mode promises that what is held will catch up by itself when the signal
   * returns (spec 17 item 2); over a refusal that promise is false, and the
   * banner talks over the one sentence the server wrote for the person
   * standing there. So nothing in this client enters degraded mode on one.
   *
   * A 5xx is deliberately NOT a refusal: a server restarting behind a proxy is
   * a connection failing while wearing a status code, and holding through it
   * is exactly right.
   */
  get refusal(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** The code used when there was no response to read a code from. */
export const OFFLINE = "offline";

/** Read a wire error body, falling back to something a person can read when the
 *  body is not a wire error at all (a proxy's HTML 502, an empty 500). */
export function errorFromBody(status: number, body: unknown, fallback: string): ClientError {
  const wire = body as Partial<WireError> | null | undefined;
  const err = wire && typeof wire === "object" ? wire.error : undefined;
  if (err && typeof err.code === "string" && typeof err.message === "string") {
    return new ClientError(err.code, err.message, status, err.details);
  }
  return new ClientError("bad_request", fallback, status);
}

/** Call a host's listener without ever letting it back into the client. */
export function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* never into the host: a broken renderer must not stop the stream */
  }
}
