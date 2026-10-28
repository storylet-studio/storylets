// ---------------------------------------------------------------------------
// A table's rows as one tab stop, and the card the keyboard was on kept across
// a redraw (the hands-on review, 2026-10, foundation 8: a table row took no
// focus at all, and selecting a card redrew the page and dropped the focus to
// the top of the window).
//
// A table is ONE tab stop (a roving tabindex): Tab lands on its selected row,
// or its first, and Up, Down, Home and End move from there. Enter opens what a
// double-click opens. The ContextMenu key and Shift+F10 reach the row's own
// right-click menu through menu-key.ts, like any other focused thing.
//
// A deck's table moves the SELECTION with the focus, as its arrows always did
// from the window (commands.ts), and Shift extends it; choosing redraws the
// page, so the row the keyboard went to is aimed at here and focused by the
// redraw (`keepCardFocus`).
// ---------------------------------------------------------------------------

/** How an arrow moved: plainly, or extending the selection with Shift. */
export type RowMove = "replace" | "range";

export interface RowKeys {
  /** Enter: open the row's thing, as a double-click does. */
  open(row: HTMLElement): void;
  /** Arrows on a table whose rows are selected (a deck's cards): select the
   *  row arrived at. Absent: the arrows only move the focus. */
  move?(row: HTMLElement, how: RowMove): void;
}

/** A row the keyboard is going to, as an index among the page's cards, for the
 *  redraw that a move causes to put the focus on (`keepCardFocus`). */
let aim: number | undefined;

/** Make `row` its table's one tab stop. */
function rove(rows: readonly HTMLElement[], row: HTMLElement): void {
  for (const r of rows) r.tabIndex = r === row ? 0 : -1;
}

/**
 * Wire a table's freshly drawn rows. The tab stop starts on the first row
 * marked `sel`, else the first row.
 */
export function wireRowKeys(rows: readonly HTMLElement[], keys: RowKeys): void {
  if (rows.length === 0) return;
  rove(rows, rows.find((r) => r.classList.contains("sel")) ?? rows[0]!);
  rows.forEach((row, at) => {
    row.addEventListener("focus", () => rove(rows, row));
    row.addEventListener("keydown", (e) => {
      // A control inside the row keeps its own keys.
      if (e.target !== row || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        // The window's own Enter opens the deck's cursor, which need not be
        // this row (commands.ts): the row answers for itself.
        e.stopPropagation();
        keys.open(row);
        return;
      }
      const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : undefined;
      if (to === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))]!;
      if (keys.move === undefined) { rove(rows, target); target.focus(); return; }
      aim = rows.indexOf(target);
      keys.move(target, e.shiftKey ? "range" : "replace");
      // No redraw came to spend the aim (nothing changed): focus it here.
      if (aim !== undefined) { aim = undefined; rove(rows, target); target.focus(); }
    });
  });
}

/**
 * Remember which card (a `[data-card]` face or row) under `host` has the focus,
 * and return the function that puts the focus back after `host` is redrawn.
 *
 * A move by the keys goes to the row it aimed at. Otherwise, when the selection
 * moved off the focused card to one other card (the window's arrows on the
 * card grid), the focus follows it; else it stays on the same card. Nothing is
 * done when no card had the focus.
 */
export function keepCardFocus(host: HTMLElement): (selected: ReadonlySet<string>) => void {
  const active = document.activeElement;
  const cards = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>("[data-card]")];
  const was = active instanceof HTMLElement && host.contains(active) && active.dataset["card"] !== undefined
    ? { id: active.dataset["card"], index: cards().indexOf(active) }
    : undefined;
  return (selected) => {
    const want = aim;
    aim = undefined;
    if (was === undefined) return;
    const now = cards();
    let target = want !== undefined ? now[want] : undefined;
    if (target === undefined && !selected.has(was.id) && selected.size === 1) {
      target = now.find((c) => selected.has(c.dataset["card"]!));
    }
    if (target === undefined) {
      target = now[was.index]?.dataset["card"] === was.id ? now[was.index] : now.find((c) => c.dataset["card"] === was.id);
    }
    if (target === undefined) return;
    if (target.matches("tr")) {
      const table = target.closest("table");
      if (table !== null) rove([...table.querySelectorAll<HTMLElement>("tr[data-card]")], target);
    }
    target.focus({ preventScroll: false });
  };
}
