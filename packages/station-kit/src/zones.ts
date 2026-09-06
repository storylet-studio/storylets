// ---------------------------------------------------------------------------
// The zone strip: where this device says it is.
//
// A LOCATION, never a zone, is what goes on the wire (`POST
// /v1/stations/me/presence`): a device knows one of the venue's locations, and
// a zone is a story's word for the part of its map that covers it. The strip
// is named for what a performer calls it and sends what the wire wants.
//
// Presence is not the same fact as binding (spec 5.7): signing in here always
// moves the pin on the producer's map, and moves the content's own idea of
// where the NPC is only when the station mirrors. The strip says nothing about
// which, because a performer taps where they are standing either way.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { LocationId, LocationView, ZoneId } from "@storylet-studio/wire";
import { cls, el } from "./part.js";
import type { Part } from "./part.js";

/** What the strip needs of a location: the id it sends and the word a
 *  performer reads. Narrower than {@link LocationView} on purpose, so a venue
 *  that names its walls in `station.json` need not invent a position and a
 *  printed code for each; a full `LocationView` is accepted unchanged. */
export type ZoneStripLocation = Pick<LocationView, "location" | "label">;

export interface ZoneStripState {
  locations: ZoneStripLocation[];
  /** Where the device says it is now. Absent is "nowhere in particular", which
   *  is a real answer and has its own button. */
  here?: LocationId;
  /** The zone the SERVER derived from that location, when it derived one
   *  (4a). Shown rather than the location's own label because it is the word
   *  a producer addresses: "everyone in the parlour" reaches this handset
   *  because of this line, and a performer who cannot see it cannot tell
   *  whether it will. Absent when this story's map covers nowhere near here,
   *  which is a real state and reads as one. */
  zone?: ZoneId;
  busy?: boolean;
}

export interface ZoneStripOptions {
  /** `undefined` means the performer cleared it: they are nowhere in
   *  particular, which the wire says with an absent `location`. */
  onPick(location: LocationId | undefined): void;
  /** What the clear button says. Absent hides it, for a venue where a crew
   *  member is always somewhere. */
  clearText?: string;
}

export function zoneStripPart(opts: ZoneStripOptions): Part<ZoneStripState> {
  const root = el("nav", { className: cls("part", "zones"), attrs: { "aria-label": "Where you are" } });
  let disposed = false;

  return {
    el: root,
    update(state) {
      if (disposed) return;
      root.replaceChildren();
      for (const location of state.locations) {
        const here = location.location === state.here;
        const button = el("button", {
          className: `${cls("button")} ${cls("zone")}`,
          type: "button",
          text: location.label,
          attrs: { "data-location": location.location, "aria-pressed": here ? "true" : "false" },
          onClick: () => { if (!here) opts.onPick(location.location); },
        }) as HTMLButtonElement;
        button.disabled = state.busy === true;
        root.append(button);
      }
      if (state.zone !== undefined) {
        root.append(el("span", {
          className: cls("zone-derived"),
          text: state.zone,
          attrs: { "data-zone": state.zone },
        }));
      }
      if (opts.clearText !== undefined) {
        const clear = el("button", {
          className: `${cls("button")} ${cls("zone")}`,
          type: "button",
          text: opts.clearText,
          attrs: { "data-location": "", "aria-pressed": state.here === undefined ? "true" : "false" },
          onClick: () => opts.onPick(undefined),
        }) as HTMLButtonElement;
        clear.disabled = state.busy === true || state.here === undefined;
        root.append(clear);
      }
    },
    dispose() {
      disposed = true;
      root.replaceChildren();
    },
  };
}
