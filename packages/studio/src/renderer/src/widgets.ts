// ---------------------------------------------------------------------------
// The small pieces the navigator, the pages and the documents all draw: a tag's
// colour dot and pill, a row's metadata, a document's More menu and comment
// bubble, a table's header row.
//
// Each was written twice (or three times) before, once per file that drew it,
// and views.ts and inspector.ts imported each other's to share the rest. They
// live here so both import one leaf instead.
// ---------------------------------------------------------------------------

import { el, iconNode, metaLine, plural } from "@wildwinter/app-shell";
import { openContextMenu } from "@wildwinter/app-shell/context-menu";
import { colourIndex } from "../../shell/colour.js";
import { boxColour } from "./box-tint.js";
import type { BoxDto } from "../../shared/api.js";

/** A tag's colour, as the dot every chip of it leads with. */
export function chipDot(name: string): HTMLElement {
  const dot = el("i");
  dot.style.background = `var(--char-${colourIndex(name)})`;
  return dot;
}

/** A tag (or any name with a colour) as a pill. */
export const chip = (name: string): HTMLElement => el("span", { className: "pill" }, chipDot(name), name);

/** A box as a pill, tinted the way its sites are on the map. */
export function boxChip(b: Pick<BoxDto, "id" | "gameId" | "title">): HTMLElement {
  const c = chip(b.title ?? b.gameId);
  const dot = c.querySelector("i");
  if (dot) dot.style.background = boxColour(b.id);
  return c;
}

/** A row's metadata, drawn: the shell's `metaLine` (a disc between parts,
 *  from CSS) wearing `.listmeta` for the row's size and colour. What used to
 *  be `${count} · ${sub}` typed into one span. */
export function listMeta(parts: (string | undefined)[]): HTMLElement {
  const m = metaLine(parts);
  m.classList.add("listmeta");
  return m;
}

/** A document's More button: its menu opens under it, as it does on every
 *  page that has one. */
export function moreMenu(items: { label: string; danger?: boolean; onClick: () => void }[]): HTMLElement {
  const more = el("button", { className: "btn ghost icon doc-menu", tip: "More" }, iconNode("more"));
  more.addEventListener("click", (e) => {
    const r = more.getBoundingClientRect();
    e.preventDefault();
    openContextMenu(r.left, r.bottom + 4, items);
  });
  return more;
}

/**
 * A comment bubble: how many open threads something has, and the door to them.
 * `on` is the id the thread is filed against, stamped on the bubble so a caller
 * holding only an id can FIND this anchor once the document renders, which is
 * how the feedback walk arrives at a comment it navigated to. `none` is what an
 * empty one offers ("Comment on this"), kept on the bubble for the in-place
 * repaint (inspector.ts `repaintBubbles`).
 */
export function commentBubble(on: string, count: number, open: (anchor: HTMLElement) => void, none = "Comment on this"): HTMLElement {
  const bubble = el("button", {
    className: `btn ghost doc-thread${count > 0 ? " has" : ""}`,
    tip: count > 0 ? `${plural(count, "open comment")}` : none,
  }, iconNode("comment", 12), count > 0 ? String(count) : null);
  bubble.dataset.threadFor = on;
  bubble.dataset.tipNone = none;
  bubble.addEventListener("click", (e) => { e.preventDefault(); open(bubble); });
  return bubble;
}

/** A table's header row, one overline caption a column. */
export const tableHead = (cols: readonly string[]): HTMLElement =>
  el("thead", {}, el("tr", {}, ...cols.map((c) => el("th", { className: "overline", text: c }))));
