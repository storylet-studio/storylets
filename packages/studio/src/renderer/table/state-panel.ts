// ---------------------------------------------------------------------------
// The rail's State tab: the raw story state, pokeable. This was "Behind the
// curtain", a collapsed fold at the bottom of one view behind a coy name - and
// the antagonist review found it was the single most valuable designer surface
// in the window, invisible in Map view and nearly invisible in List
// (design/board-legibility.md piece 2). Now a rail tab, in both views. The
// stock peek that sat under it gave way to the Why not? tab (2026-10-02): an
// author testing asks why a HAND did not get a card, which a box-wide look
// without a hand could only half answer.
// ---------------------------------------------------------------------------

import { el } from "@wildwinter/app-shell";
import { coerceStateInput } from "./model.js";
import type { ScalarValue } from "@storylet-studio/model";
import type { Board } from "./board-state.js";
import { refreshBoard, succeeded } from "./session.js";

export function statePanel(b: Board): HTMLElement {
  const s = b.state;
  const details = el("div", { className: "statepanel" });
  /** Poking the state simulates the game writing; a bad poke is ignored. */
  const poke = (path: string, value: ScalarValue, label: string): void => {
    try { s.table!.meddle(path, value, label); succeeded(s); refreshBoard(s); b.render(); }
    catch { /* ignore a bad poke */ }
  };

  details.append(el("span", { className: "caption", text: "Story state" }));
  const stateEl = el("div", { className: "statestrip" });
  for (const r of s.table!.stateRows()) {
    const wrap = el("span", { className: "sr" }, el("span", { className: "srlabel", text: r.label }));
    if (r.stages !== undefined) {
      // A quality renders as its LADDER with the current rung marked
      // (design/quality.md section 4). Clicking a rung pokes the stage
      // directly: a free-text input here would invite the exact stage typos
      // the compiler exists to refuse, and jumping an arc to "resolved" to
      // look at the late cards is the whole reason a tester wants this row.
      const ladder = el("span", { className: "seg srladder" });
      for (const stage of r.stages) {
        ladder.append(el("button", {
          className: `seg-opt srrung${r.value === stage ? " on" : ""}`, text: stage,
          tip: r.value === stage ? "The current stage" : `Jump to "${stage}"`,
          onClick: () => poke(r.path, stage, r.label),
        }));
      }
      wrap.append(ladder);
    } else if (r.editable) {
      const input = el("input", { className: "srval" });
      input.value = String(r.value);
      input.addEventListener("change", () => poke(r.path, coerceStateInput(input.value), r.label));
      wrap.append(input);
    } else {
      wrap.append(el("span", { className: "srval ro", text: JSON.stringify(r.value) }));
    }
    stateEl.append(wrap);
  }
  details.append(stateEl);

  return details;
}
