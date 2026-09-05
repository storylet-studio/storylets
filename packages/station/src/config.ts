// ---------------------------------------------------------------------------
// `station.json`, beside the page.
//
// A venue provisions a device by copying the built folder onto it and editing
// ONE file. No build step, no environment variables, no rebuild to change the
// server address: a stage manager with a memory stick can move a kiosk from
// the rehearsal server to the show server between houses.
//
// The FIELD PLAN is the interesting entry, and it is data rather than a
// function on purpose. JSON cannot hold a function, and the point of the first
// customisation route (RESTYLE) is that a venue changes the look and the words
// without touching the code. A venue that needs a real template function has
// already reached the second route (REARRANGE), where it composes the kit
// itself and passes `planTemplate` or its own.
//
// What the plan may NOT say is whether the author's material shows. The card's
// purpose and the outcomes' purposes are the station KIND's business (5.7),
// decided in `shell.ts` and unreachable from this file: a companion that could
// be talked into showing a purpose by an edit here is one typo away from the
// author's notes on a visitor's phone, which is the defect this shape exists
// to make unrepeatable.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { InstallationId, StationKind, VenueId } from "@storylet-studio/wire";
import type { FieldPlan } from "@storylet-studio/station-kit";

export type { FieldPlan, FieldSpec } from "@storylet-studio/station-kit";

export interface StationConfig {
  /** The server: `http://venue.local:4470`. Absent means the origin this page
   *  was served from, which is what the companion page always wants and what a
   *  kiosk served by the server itself wants too. */
  base?: string;
  /** Which app this is. The build makes one folder per kind and stamps this
   *  in, so a mismatch is a provisioning mistake worth refusing. */
  kind: StationKind | "companion";
  /** The station key this device holds. Absent for a companion page, which
   *  holds a party token instead and never a key. */
  stationKey?: string;
  /** The venue, for the routes that name one. */
  venue?: VenueId;
  /** For a sign-in station: the story it mints parties into. */
  installation?: InstallationId;
  /** Park the visit after this long with nobody touching it. A kiosk in a
   *  foyer wants two or three; a table in a quiet room wants ten. Zero or
   *  absent never parks, which is what a demo wants. */
  idleMinutes?: number;
  /** What this station's cards show: which field is the story, and which
   *  others to draw beside it. */
  fields?: FieldPlan;
  /** What to call each hand on screen, by the hand's gameId: `{ "at-the-door":
   *  "The door" }`. The wire carries no hand titles, so this is where a venue
   *  says one; a hand not named here is headed with its gameId. */
  hands?: Record<string, string>;
  /** What the page calls itself: "The table", "The Elder". */
  title?: string;
  /** Words for the connection banner, when a venue's voice differs from the
   *  default. Keyed by the client's connection states. */
  banner?: Record<string, string>;
}

/** The plan each kind starts with (5.7). A party's screens read the story; a
 *  performer's reads the stage direction and the cue and not the story, which
 *  the party is holding already; the wall reads the story and the cue. */
const DEFAULTS: Record<string, Partial<StationConfig>> = {
  fixed: { idleMinutes: 4, title: "Welcome", fields: { body: "text" } },
  crew: { fields: { body: "", show: [{ field: "prompt" }, { field: "cue", label: "Cue" }] }, title: "Crew" },
  companion: { title: "Welcome", fields: { body: "text" } },
  "sign-in": { title: "Sign in" },
  house: { title: "House", fields: { body: "text", show: [{ field: "cue", label: "Cue" }] } },
};

/** Read `station.json` beside the page. A device with none is not a broken
 *  device: it is an unprovisioned one, and it says so rather than showing a
 *  stack trace to a visitor. */
export async function loadConfig(url = "station.json"): Promise<StationConfig | { error: string }> {
  let text: string;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `no station.json beside this page (${res.status}). This device is not provisioned yet.` };
    text = await res.text();
  } catch {
    return { error: "could not read station.json beside this page. This device is not provisioned yet." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: `station.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const config = parsed as StationConfig;
  if (typeof config.kind !== "string") return { error: "station.json needs a \"kind\"." };
  return { ...DEFAULTS[config.kind], ...config };
}

/** The origin to talk to: what the config says, or wherever this page came
 *  from. A companion page reached by a placard QR is always the latter. */
export const baseOf = (config: StationConfig): string =>
  config.base ?? `${location.protocol}//${location.host}`;
