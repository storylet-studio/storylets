// ---------------------------------------------------------------------------
// The Coverage window's per-hand block, on its own so it can be rendered
// headlessly: coverage.ts wires a live window at import time.
//
// Each hand's coverage is out of the cards that could come up in it (by tags
// and place, the report's `cardsPossible`), not out of its whole box. Measured
// against the box, every place in the Village read like "6/86", a near-empty
// bar over what was complete coverage, because most of the 86 are pinned to
// other places (the author, 2026-09-29). A short bar now means a real gap.
//
// Folded away by default, below the card table: the cards answer the first
// question ("does my content come up?"), and this is the second.
// ---------------------------------------------------------------------------

import { el } from "../src/dom.js";
import { formatCount, iconNode, metaLine, plural } from "@wildwinter/app-shell";
import type { CoverageReport, SearchSelection } from "../../shared/api.js";

type HandRow = CoverageReport["hands"][number];

/** The window's row maker: a row that opens what it names in the editor. */
export type OpenRow = (className: string, selection: SearchSelection, ...children: (HTMLElement | string | null)[]) => HTMLElement;

/** The block: a disclosure, closed, whose caption says what is counted and
 *  over how many runs, then one row per hand, grouped under its box's name
 *  when the project has more than one box. Rows lead with the hand's title, as
 *  the navigator's Hands list does, so they read as hands rather than as bare
 *  ids. The window decides whether it opens unfolded. */
export function handsBlock(r: CoverageReport, openRow: OpenRow): HTMLDetailsElement {
  const block = el("details", { className: "block hands" },
    // The vocabulary's chevron, rotated open by the stylesheet (the Board's
    // "Not for this hand" fold uses it too).
    el("summary", { className: "caption" }, iconNode("collapsed", 12), `Cards seen in each hand, over ${plural(r.runs, "run")}`));
  const boxes = new Set(r.hands.map((h) => h.box));
  let lastBox: string | undefined;
  for (const h of r.hands) {
    if (boxes.size > 1 && h.box !== lastBox) block.append(el("span", { className: "qbox", text: h.boxName }));
    lastBox = h.box;
    block.append(handRow(h, openRow));
  }
  return block;
}

function handRow(h: HandRow, openRow: OpenRow): HTMLElement {
  const possible = h.cardsPossible.length;
  // Seen out of the possible, counted from the gap list, so a card a run dealt
  // here against the static rule (two derivations disagreeing) cannot read 7/6.
  const seen = possible - h.cardsNeverDealt.length;
  const full = possible > 0 && h.cardsNeverDealt.length === 0;
  const deals = `${formatCount(h.deals)} ${h.deals === 1 ? "deal" : "deals"}`;
  // A titled hand reads as a title with its gameId quiet beside the deals; a
  // bare gameId reads as a name (the navigator's rule).
  const name = el("span", { className: "qname" },
    el("span", { className: h.title !== undefined ? "qtitle" : "qid", text: h.title ?? h.gameId }),
    el("span", { className: "qsub" }, metaLine([h.title !== undefined ? h.gameId : null, deals])));
  const row = openRow(`qrow${full ? " full" : ""}`, { kind: "hand", box: h.box, hand: h.id },
    name,
    ...(possible === 0
      // Nothing is tagged or placed to come up here: say so, rather than draw
      // an empty bar that reads as a gap.
      ? [el("span", { className: "qnone hint", text: "no card's tags let it come up here" })]
      : [
          el("span", { className: "bar" }, el("i", { className: "fill" })),
          el("span", { className: "count", text: `${seen}/${possible}` }),
        ]));
  const fill = row.querySelector<HTMLElement>(".fill");
  if (fill) fill.style.width = `${(seen / possible) * 100}%`;
  return row;
}
