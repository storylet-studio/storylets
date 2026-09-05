// ---------------------------------------------------------------------------
// The show clock (spec 10.1, 10.2): the three clocks, as a performer reads
// them.
//
// The clocks are DERIVED, never ticked: the server computes them at read time
// from journaled facts, because a day of ticking would be 86,400 commands of
// noise. So this part is handed a reading and counts forward from it locally
// until the next one arrives, which is the only place in the family where a
// screen is allowed to be ahead of the server, and it is allowed because being
// a second out about the wall clock harms nobody and a frozen clock reads as a
// dead screen.
//
// A HOLD stops it, because a Hold holds everything about the show and the
// redeals, `time_wall` excepted (the ruling, 10.1). That is why `paused` is a
// field here rather than something the app hides the part for.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { Clocks } from "@storylet-studio/wire";
import { cls, el } from "./part.js";
import type { Part } from "./part.js";

export interface ShowClockState {
  clocks?: Clocks;
  /** The run is held. `time_show` stops; the wall clock does not. */
  paused?: boolean;
}

export interface ShowClockOptions {
  /** Count forward between readings. Off for a display that is only ever
   *  driven by events. Default on. */
  tick?: boolean;
  /** Injectable so a test does not wait a second, and so a kiosk with its own
   *  frame loop can drive it. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/** `-00:30`, `02:14`, `1:02:14`. Negative before GO, which is a real state: the
 *  run has started and the show has not. */
export const showTime = (seconds: number): string => {
  const sign = seconds < 0 ? "-" : "";
  const s = Math.abs(Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`;
};

const wallTime = (iso: string): string => {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
};

export function showClockPart(opts: ShowClockOptions = {}): Part<ShowClockState> {
  const root = el("div", { className: cls("part", "clock") });
  const show = el("span", { className: cls("clock-show"), text: "--:--" });
  const phase = el("span", { className: cls("clock-phase") });
  const wall = el("span", { className: cls("clock-wall") });
  root.append(show, phase, wall);

  let disposed = false;
  let clocks: Clocks | undefined;
  let paused = false;
  /** Seconds added locally since the last reading. */
  let drift = 0;

  const draw = (): void => {
    if (clocks === undefined) {
      show.textContent = "--:--";
      phase.textContent = "";
      wall.textContent = "";
      return;
    }
    show.textContent = showTime(clocks.time_show + drift);
    phase.textContent = clocks.time_phase;
    wall.textContent = wallTime(clocks.time_wall);
  };

  const start = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const stop = opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const handle = opts.tick === false ? undefined : start(() => {
    if (disposed || paused || clocks === undefined) return;
    drift++;
    draw();
  }, 1000);

  return {
    el: root,
    update(state) {
      if (disposed) return;
      clocks = state.clocks;
      paused = state.paused === true;
      // A fresh reading is the truth: whatever this part counted on its own
      // since the last one is thrown away rather than added to.
      drift = 0;
      root.classList.toggle(`${cls("clock-paused")}`, paused);
      draw();
    },
    dispose() {
      disposed = true;
      if (handle !== undefined) stop(handle);
      root.replaceChildren();
    },
  };
}
