// The Board's play face, the part that decides what a player can press.
//
// A card's outcomes become one button each, a gated-shut one kept but locked.
// A card with NO outcomes at all (a masthead, a notice, a codex entry) is
// played with none, named as "" in every runtime, so it gets ONE plain Done
// button instead of an empty row. A card whose outcomes all exist but are
// gated shut is not that card: it keeps its locked buttons, because the
// question it poses is "why can I not do that", not "there is nothing to do".
//
// Kept apart, with nothing of the window in it (no state, no preload),
// so the rule can be tested on its own.

import { el } from "@wildwinter/app-shell";

export interface PlayChoice { gameId: string; title?: string; available: boolean }

/** The row of buttons under an open card. `choose` takes a named outcome (the
 *  two-step commit follows); `done` plays a card with no outcomes at once,
 *  since there is no outcome title or purpose to confirm. */
export function playChoices(outcomes: readonly PlayChoice[], choose: (gameId: string) => void, done: () => void): HTMLElement {
  const row = el("div", { className: "pp-actions" });
  if (outcomes.length === 0) {
    row.append(el("button", { className: "btn pp-done", text: "Done", onClick: done }));
    return row;
  }
  for (const o of outcomes) {
    const b = el("button", { className: o.available ? "btn" : "btn disabled", text: `${o.title ?? o.gameId}${o.available ? "" : " (locked)"}` });
    // The themed rollover, as every other tip in the window: a native `title`
    // drew the system's own box beside the family's.
    if (!o.available) b.dataset["tip"] = "Unavailable. This outcome's condition isn't met in the current state.";
    else b.addEventListener("click", () => choose(o.gameId));
    row.append(b);
  }
  return row;
}
