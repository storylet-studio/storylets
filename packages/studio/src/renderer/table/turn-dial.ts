// ---------------------------------------------------------------------------
// The Board's clocks: the turn dial at the head of the board, with Next turn,
// a box's own +1, and a timed box's steps. The read-only dial Live mode shows
// is live-mode.ts's.
// ---------------------------------------------------------------------------

import { el, plural } from "@wildwinter/app-shell";
import { turnSpan } from "@storylet-studio/model";
import type { Board } from "./board-state.js";
import { advance, nextTurn } from "./session.js";

/** The clocks, forward (design/board-legibility.md piece 4). Per-box clocks
 *  are the real semantics; the old surface half-hid them behind one big number
 *  with a superscript and an undiscoverable click, and paid both costs. A
 *  single-box project keeps the single number, which is then the whole truth. */
export function turnDial(b: Board): HTMLElement {
  const clocks = b.state.table!.clocks();
  if (clocks.length === 1) {
    const one = clocks[0]!;
    return el("div", { className: "dial" },
      el("span", { className: "caption", text: one.seconds !== undefined ? `Turn (${turnSpan(1, one.seconds)} each)` : "Turn" }),
      el("span", { className: "dialnum", text: String(one.turn) }),
      el("button", { className: "btn primary", text: "Next turn", tip: "Advance the clock and refresh the hands", onClick: () => nextTurn(b) }),
      ...timeSteps(b, one));
  }
  return el("div", { className: "dial clocksdial" },
    el("div", { className: "clockshead" },
      el("span", { className: "caption", text: "Clocks", tip: "Every box keeps its own clock. A play advances only its own box." }),
      el("button", { className: "btn primary", text: "Next turn", tip: "Advance every box's clock and refresh the hands", onClick: () => nextTurn(b) })),
    el("div", { className: "clocks" },
      ...clocks.map((c) => el("span", { className: "clockrow" },
        el("span", { className: "clockbox", text: c.box }),
        el("span", { className: "clockval", text: String(c.turn) }),
        c.seconds !== undefined
          ? el("span", { className: "clockunit", text: `${turnSpan(1, c.seconds)} a turn` })
          : el("button", { className: "btn mini", text: "+1", tip: `Advance only ${c.box} (clocks run forward only)`,
              onClick: () => advance(b, (t) => t.session.advanceTurns(c.box, 1)) }),
        ...timeSteps(b, c)))));
}

/** A timed box's advance buttons, scaled to its own unit (4.8): the step
 *  nearest a minute and ten of them, so half an hour is one click and a bit
 *  rather than thirty presses of Next turn. Each is an ordinary advanceTurns
 *  of the right count - the Board is the host here, and a timed box has no
 *  clock of its own. Nothing at all for an untimed box, which keeps the
 *  surface it has always had. */
function timeSteps(b: Board, clock: { box: string; seconds?: number }): HTMLElement[] {
  if (clock.seconds === undefined) return [];
  const step = Math.max(1, Math.round(60 / clock.seconds));
  return [step, step * 10].map((n) => el("button", {
    className: "btn mini", text: `+${turnSpan(n, clock.seconds!)}`,
    tip: `Advance ${clock.box} by ${plural(n, "turn")} (clocks run forward only)`,
    onClick: () => advance(b, (t) => t.session.advanceTurns(clock.box, n)),
  }));
}
