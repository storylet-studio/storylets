// The Board's play face, the part that decides what a player can press.
//
// A card's outcomes become one button each, a gated-shut one kept but locked.
// A card with NO outcomes at all (a masthead, a notice, a codex entry) is
// played with none, named as "" in every runtime, so it gets ONE plain Done
// button instead of an empty row. A card whose outcomes all exist but are
// gated shut is not that card: it keeps its locked buttons, because the
// question it poses is "why can I not do that", not "there is nothing to do".
//
// Kept apart from table.ts, which is a whole window with a preload behind it,
// so the rule can be tested on its own.

import { el } from "../src/dom.js";

export interface PlayChoice { gameId: string; title?: string; available: boolean }

/** The row of buttons under an open card. `choose` takes a named outcome (the
 *  two-step commit follows); `done` plays a card with no outcomes at once,
 *  since there is no outcome title or purpose to confirm. */
export function playChoices(outcomes: readonly PlayChoice[], choose: (gameId: string) => void, done: () => void): HTMLElement {
  const row = el("div", { className: "pp-actions" });
  if (outcomes.length === 0) {
    row.append(el("button", { className: "pp-done", text: "Done", onClick: done }));
    return row;
  }
  for (const o of outcomes) {
    const b = el("button", { className: o.available ? "" : "disabled", text: `${o.title ?? o.gameId}${o.available ? "" : " (locked)"}` });
    if (!o.available) b.title = "Unavailable: this outcome's condition is not met in the current state";
    else b.addEventListener("click", () => choose(o.gameId));
    row.append(b);
  }
  return row;
}

/** What follows a played card's name in the journal: the arrow and the
 *  outcome, or nothing for a card played with none (""). */
export function playedTail(outcome: string, arrow: string): string {
  return outcome === "" ? "" : ` ${arrow} ${outcome}`;
}
