// ---------------------------------------------------------------------------
// `station.json`, beside the page.
//
// A venue provisions a device by copying the built folder onto it and editing
// ONE file. No build step, no environment variables, no rebuild to change the
// server address: a stage manager with a memory stick can move a kiosk from
// the rehearsal server to the show server between houses.
//
// The FIELD TEMPLATE is the interesting entry, and it is a list rather than a
// function on purpose. JSON cannot hold a function, and the point of the first
// customisation route (RESTYLE) is that a venue changes the look and the words
// without touching the code. A venue that needs a real template function has
// already reached the second route (REARRANGE), where it composes the kit
// itself and passes `onlyFields` or its own.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { InstallationId, StationKind, VenueId } from "@storylet-studio/wire";

/** One field the crew view shows, and what to call it. A bare string means
 *  "show it, unlabelled", which is what a stage direction wants. */
export type FieldSpec = string | { field: string; label?: string };

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
  /** The card fields this station shows, in this order. */
  fields?: FieldSpec[];
  /** What the page calls itself: "The table", "The Elder". */
  title?: string;
  /** Words for the connection banner, when a venue's voice differs from the
   *  default. Keyed by the client's connection states. */
  banner?: Record<string, string>;
}

const DEFAULTS: Record<string, Partial<StationConfig>> = {
  fixed: { idleMinutes: 4, title: "Welcome" },
  crew: { fields: [{ field: "prompt" }, { field: "cue", label: "Cue" }], title: "Crew" },
  companion: { title: "Welcome" },
  "sign-in": { title: "Sign in" },
  house: { title: "House" },
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
