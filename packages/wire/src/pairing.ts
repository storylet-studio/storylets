// ---------------------------------------------------------------------------
// Pairing, not accounts (7.5, 7.5.1).
//
// One issue flow for every principal, party stations included: the console
// shows a short single-use code, the other end sends it once, the key is
// minted to that device and never displayed again. The server stores no
// password and no email of its own for anyone.
// ---------------------------------------------------------------------------

import type { InstallationView, PrincipalView } from "./views.js";

/** `POST /v1/pair`. Any role, single use. Unauthenticated by definition: the
 *  code IS the authorisation, which is why it is eight characters that cannot
 *  be misread, expires in ten minutes, and is spent on success. */
export interface PairRequest {
  /** The code the producer read out, showed, or sent as a link. */
  code: string;
  /** What is pairing, for the console's principal list: "Storyletter 0.3.0",
   *  "Sam's MacBook". */
  device: { app: string; host: string };
  /** Storyletter's own identity, which rides along for comment authorship and
   *  as a cross-check the console shows when it disagrees with the label
   *  ("key paired as Sam, pushed by S. Okafor"), NEVER as authorisation. */
  identity?: { name: string; email?: string };
}

/** The pairing response. The key is minted here and never shown again: a
 *  device that loses it pairs afresh against a new code. */
export interface PairResponse {
  /** The principal's key. Storyletter puts it in `safeStorage`, keyed by
   *  server address, never in a project and never in a shard. */
  key: string;
  principal: PrincipalView;
  installation: InstallationView;
  server: {
    /** The server's own version. */
    version: string;
    /** The protocol: always `storyletengine/wire@1` for this package. */
    wire: string;
  };
  /** The self-signed certificate's fingerprint, pinned on first use and
   *  refused on change with a plain message, which is what SSH does and is
   *  enough on a venue LAN (7.5.1). */
  fingerprint: string;
}
