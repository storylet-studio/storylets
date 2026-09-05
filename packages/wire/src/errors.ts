// ---------------------------------------------------------------------------
// One error body for every non-2xx response, and a closed list of codes.
//
// The code is what a client BRANCHES on; the message is what a person reads,
// and it is written by the server for that person ("this key was revoked by
// Priya at 14:02; pair again", 7.5.1). A client that shows the code to a
// performer has misused it.
// ---------------------------------------------------------------------------

/**
 * Every code the server may answer with. Adding one is additive and needs no
 * version bump; a client must treat an unrecognised code as a plain failure
 * and show the message.
 *
 * There is deliberately NO `choose_installation` code. A walk-up at a
 * location with several stories open is not a failure: the server resolved
 * the location and knows exactly what to offer, so it answers 200 with
 * `outcome: "choose"` on {@link AttachAtLocationResponse}. A code as well
 * would be two ways to say one thing on one route, which is the drift this
 * package exists to prevent.
 */
export type WireErrorCode =
  /** No party resolves from that credential, or the party was forgotten (7.4). */
  | "unknown_party"
  /** The credential itself is not known here: a token from another
   *  installation, an unbound wristband. */
  | "unknown_credential"
  /** A pairing code past its ten minutes (7.5.1). */
  | "code_expired"
  /** A pairing code already spent: single use, by design. */
  | "code_used"
  /** The key, credential or principal was revoked. The message names who and
   *  when, because the alternative is a person wondering why a menu emptied. */
  | "revoked"
  /** That card is not on this flow's board: the second station to play the
   *  same card gets this, which is the right answer (5.4). */
  | "not_dealt"
  /** The engine refused: a failing condition, a closed deck gate, an outcome
   *  that is not available at the moment of the ask. */
  | "gated"
  /** Another flow holds the world's copies of a shared card (shared-scarcity
   *  step 6). Reported to the station so it can say so rather than blaming
   *  the network. */
  | "claimed_elsewhere"
  /** No run is live, so there is nothing to deal from (5.4.1). */
  | "no_run"
  /** The run is held. Reads still answer; mutations wait for Resume (10.3). */
  | "run_paused"
  /** A push, an install or a go-live breaks the installation contract (4.11):
   *  a hand bound to a venue location, a box the scheduler ticks, a clock
   *  property. `details` carries the breaks, one per entry. */
  | "contract_break"
  /** A push did not merge cleanly; `details` carries the conflict sidecars
   *  (9.1). */
  | "conflict"
  /** The SSE cursor has fallen off the run's ring buffer. The client must
   *  re-read its board rather than assume it missed nothing (6.2). */
  | "replay_lost"
  /** An author key touched a shape shard. The message is the author's own
   *  phrase: pull as designer to change the shape (9.1). */
  | "forbidden_shard"
  /** The key is valid but its role may not do this (7.5). */
  | "wrong_role"
  /** This `Idempotency-Key` is in flight; the first attempt has not answered
   *  yet. Retry, do not re-mint the key. */
  | "idempotent_replay"
  /** The client acted against a build that is no longer live: a hot swap
   *  happened underneath it (section 9). Re-read and try again. */
  | "stale_build"
  /** A station asked for a hand its party's installation does not bind to
   *  the location it stands at (5.7, 4a). Bindings are provisioning, so this
   *  is a console fix, not a retry. */
  | "not_bound"
  /** The visit is closed, parked past its run, or was never opened. */
  | "unknown_visit"
  /** This installation does not mint parties at a walk-up (`walkUp: false`,
   *  7.2): the party must be signed in at the door. Answered for the chosen
   *  installation, not for the venue: another story on the same walls may
   *  take walk-ups. */
  | "walk_up_closed"
  /** No location by that id at this venue: a code printed for a server that
   *  does not run this venue, or a location removed since it was printed
   *  (4a). Placards are printed once, so this is the refusal a phone showing
   *  a stale sticker gets. */
  | "unknown_location"
  /** No installation by that id here: a credential minted against a story
   *  this venue no longer runs, or a chooser acted on after the list moved. */
  | "unknown_installation"
  /** The installation is not open to parties: the family story closed at six.
   *  Distinct from `no_run`, which is a story that is open with nothing
   *  playing, and from `walk_up_closed`, which is open but not to walk-ups. */
  | "installation_closed"
  /** The same token presented while its party is mid-command at the SAME
   *  station: the guard against a photographed QR used twice at once (7.3). */
  | "duplicate_handshake"
  /** A call sign or an external ref arrived from an anonymous connection. A
   *  station with a key vouches; a phone must hold a token (7.1). */
  | "needs_station_key"
  /** The pinned certificate fingerprint changed (7.5.1). Trust on first use,
   *  refused on change, in plain words. */
  | "fingerprint_changed"
  /** Malformed body, missing field, or a gameId that names nothing. */
  | "bad_request"
  /** No bearer, or one the server cannot read at all. */
  | "unauthorized";

/** The body of every non-2xx response. Nested under `error` so a client can
 *  tell an error body from a success body by shape alone, which the old
 *  system's bare-array responses could not. */
export interface WireError {
  error: {
    /** One of {@link WireErrorCode}, or a code added later. */
    code: string;
    /** Written for the person in front of the screen, not for the log. */
    message: string;
    /** Per-code payload: the contract breaks, the conflict sidecars, the
     *  revoking producer and instant. Never load-bearing for control flow. */
    details?: unknown;
  };
}
