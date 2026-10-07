// ---------------------------------------------------------------------------
// Which hands the Board shows: the box navigator down the left, and the filter
// bar over the board. The counting behind both (which tag groups there are to
// filter by, what a box holds, which hands a filter keeps) is pure and lives
// at the bottom, where it tests without a window.
// ---------------------------------------------------------------------------

import { el, plural } from "@wildwinter/app-shell";
import { focusKey } from "../tool-window/focus.js";
import { currentMapChoices } from "./board-state.js";
import type { Board, BoardState } from "./board-state.js";
import type { BoxInfo, DealtView, HandView } from "./model.js";
import { loadMap } from "./map-stage.js";

/**
 * The box navigator (design/board-ripple.md section 4): the left column that
 * makes every box VISIBLE AS A THING, whatever the main area shows - the
 * Map-mode finding was an author who never learned the Codex existed. Each row:
 * the box, how many cards its hands hold now, and the last refresh's
 * changed-count. Everything is the all-boxes list.
 */
export function boxNav(b: Board): HTMLElement {
  const s = b.state;
  const table = s.table!;
  return el("nav", { className: "bnav" },
    focusKey(el("button", { className: `bnav-row${s.boxSel === undefined ? " sel" : ""}`, onClick: () => pickBox(b, undefined) },
      el("span", { className: "bnav-name", text: "Everything" })), "box:*"),
    ...table.boxes().map((box) => {
      const changed = changedIn(table.hands(), s.pulsed, box.gameId);
      const held = heldIn(table.hands(), s.board, box.gameId);
      return focusKey(el("button", { className: `bnav-row${s.boxSel === box.gameId ? " sel" : ""}`,
        tip: `${plural(held, "card")} held.${changed > 0 ? ` ${changed} changed by the last action.` : ""}`,
        onClick: () => pickBox(b, box.gameId) },
        el("span", { className: "bnav-name", text: box.title ?? box.gameId }),
        changed > 0 ? el("span", { className: "bbadge", text: String(changed) }) : null,
        el("span", { className: "bnav-n", text: String(held) })), `box:${box.gameId}`);
    }));
}

function pickBox(b: Board, sel: string | undefined): void {
  const s = b.state;
  // Leaving a box is its read-receipt: you were looking at it, so its marks
  // clear - which is the only way a box with nothing to play (the Codex)
  // ever sheds its badge. Arriving deliberately does NOT clear: the marks
  // are the guidance for what you came to see.
  if (s.boxSel !== undefined && s.boxSel !== sel) {
    const leaving = new Set(s.table!.hands().filter((h) => h.box === s.boxSel).map((h) => h.gameId));
    s.pulsed = new Set([...s.pulsed].filter((h) => !leaving.has(h)));
  }
  s.boxSel = sel; s.mapPick = 0; s.selectedHand = undefined; s.open = undefined; s.pending = undefined;
  s.mapData = undefined;
  s.rememberedBox = sel ?? "";
  void b.studio.setBoardBox(s.rememberedBox);   // remembered per project, "" = Everything
  if (currentMapChoices(s).length > 0 && s.view === "map") void loadMap(b);
  b.render();
}

/** The filter bar: "show all hands in the forest". A filter that hides hands
 *  says so: SHOWING district: docks silently vanishing the Codex read as loss,
 *  not as filtering. */
export function filterBar(b: Board): HTMLElement {
  const s = b.state;
  const groups = filterGroups(s.table!.boxes());
  const bar = el("div", { className: "filters" });
  if (groups.length > 0) {
    bar.append(el("span", { className: "caption", text: "Showing" }));
    for (const group of groups) {
      const sel = el("select", { className: "arg" });
      const any = el("option", { text: `${group.gameId}: all` }); any.value = "";
      if ((s.filters[group.gameId] ?? "") === "") any.selected = true;
      sel.append(any);
      for (const v of group.values) {
        const o = el("option", { text: `${group.gameId}: ${v}` }); o.value = v;
        if (s.filters[group.gameId] === v) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener("change", () => { s.filters[group.gameId] = sel.value; b.render(); });
      bar.append(sel);
    }
  }
  const { hidden } = shownHands(s);
  if (activeFilters(s.filters).length > 0 && hidden > 0) {
    bar.append(el("span", { className: "empty", text: `${plural(hidden, "hand")} hidden.` }));
  }
  return bar;
}

/** The hands the board shows, in the selected box and through the filters,
 *  and how many in the box the filters hid. */
export function shownHands(s: BoardState): { shown: HandView[]; hidden: number } {
  const hands = s.table!.hands();
  const shown = hands
    .filter((h) => matchesFilters(h.tags, activeFilters(s.filters)))
    .filter((h) => s.boxSel === undefined || h.box === s.boxSel);
  const inScope = hands.filter((h) => s.boxSel === undefined || h.box === s.boxSel).length;
  return { shown, hidden: inScope - shown.length };
}

// --- the counting, pure --------------------------------------------------------------

/** Union of tag groups across boxes, for the board filter bar. */
export function filterGroups(boxes: readonly BoxInfo[]): { gameId: string; values: string[] }[] {
  const out = new Map<string, Set<string>>();
  for (const box of boxes) {
    for (const g of box.groups) {
      const set = out.get(g.gameId) ?? new Set<string>();
      for (const v of g.values) set.add(v);
      out.set(g.gameId, set);
    }
  }
  return [...out.entries()].map(([gameId, values]) => ({ gameId, values: [...values] }));
}

/** The filters that choose something ("" is any). */
export const activeFilters = (filters: Record<string, string>): [string, string][] =>
  Object.entries(filters).filter(([, v]) => v !== "");

/** Does a hand with these tags pass every chosen filter? */
export const matchesFilters = (tags: Record<string, string>, active: readonly [string, string][]): boolean =>
  active.every(([g, v]) => tags[g] === v);

/** How many cards a box's hands hold now. */
export function heldIn(hands: readonly HandView[], board: readonly { hand: string; cards: DealtView[] }[], boxGameId: string): number {
  const ours = new Set(hands.filter((h) => h.box === boxGameId).map((h) => h.gameId));
  return board.reduce((n, x) => n + (ours.has(x.hand) ? x.cards.length : 0), 0);
}

/** How many of a box's hands the last refresh changed. */
export const changedIn = (hands: readonly HandView[], pulsed: ReadonlySet<string>, boxGameId: string): number =>
  hands.filter((h) => h.box === boxGameId && pulsed.has(h.gameId)).length;
