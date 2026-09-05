// ---------------------------------------------------------------------------
// The connection banner: degraded mode, said out loud (spec 17 item 2).
//
// The rule every reference front-end must meet is that it keeps its last board
// and shows a DEFINED hold state, and a defined state is one a visitor can act
// on. So the words here are the ones the spec itself uses for each surface:
// a crew handset keeps its prompt list, a placard page says come back to this
// spot in a moment.
//
// Silent when live. A banner that is always on screen is a banner nobody
// reads, and the point of this one is to be believed the moment it appears.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { ConnectionState } from "@storylet-studio/client";
import { cls, el } from "./part.js";
import type { Part } from "./part.js";

export interface ConnectionBannerState {
  connection: ConnectionState;
  held?: boolean;
  /** The client's own reason, written for a person. Shown only when this part
   *  has nothing better of its own to say. */
  reason?: string;
  /** Commands waiting to go out, which is worth showing on a crew handset:
   *  a performer who pressed three things wants to know all three are held. */
  queued?: number;
}

export interface ConnectionBannerOptions {
  /** What each state says. A venue overrides the ones it cares about; the
   *  defaults are the spec's own words for the placard case. */
  words?: Partial<Record<ConnectionState, string>>;
}

const DEFAULTS: Record<ConnectionState, string> = {
  connecting: "Finding the venue...",
  live: "",
  replaying: "Catching up...",
  disconnected: "No connection. Come back to this spot in a moment.",
  held: "Holding what you had. This will catch up when the signal returns.",
};

export function connectionBannerPart(opts: ConnectionBannerOptions = {}): Part<ConnectionBannerState> {
  const root = el("div", { className: cls("part", "banner"), attrs: { role: "status", "aria-live": "polite" } });
  const words = el("span", { className: cls("banner-words") });
  const queued = el("span", { className: cls("banner-queued") });
  root.append(words, queued);
  let disposed = false;
  let last: ConnectionState | undefined;

  return {
    el: root,
    update(state) {
      if (disposed) return;
      if (last !== undefined) root.classList.remove(cls(`banner-${last}`));
      last = state.connection;
      root.classList.add(cls(`banner-${state.connection}`));
      const text = opts.words?.[state.connection] ?? DEFAULTS[state.connection];
      words.textContent = text === "" ? (state.reason ?? "") : text;
      // `live` with something still queued is worth a word: the screen is
      // current, but what was pressed has not landed yet.
      const n = state.queued ?? 0;
      queued.textContent = n > 0 ? (n === 1 ? "1 waiting to send" : `${n} waiting to send`) : "";
      root.hidden = state.connection === "live" && n === 0 && state.held !== true;
    },
    dispose() {
      disposed = true;
      root.replaceChildren();
    },
  };
}
