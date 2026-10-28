// ---------------------------------------------------------------------------
// The tree pattern's keys, for the navigator (the hands-on review, 2026-10,
// foundation 8: the sidebar tree had no arrow keys, and every row was a tab
// stop of its own).
//
// The tree is ONE tab stop (a roving tabindex): Tab lands on the row that was
// last current, and the arrows move from there. Up and Down step through the
// visible rows; Right opens a closed row, or steps into an open one; Left
// closes an open row, or steps out to its parent; Home and End go to the
// first and last rows. Enter and Space are the row's own, since every row is
// a button: they open what a click opens.
//
// The rows say what they are in the DOM (role="treeitem", aria-level, and
// aria-expanded on a row that has children), so this reads the tree as drawn
// and keeps nothing of its own across a redraw.
// ---------------------------------------------------------------------------

const ROW = "[role=treeitem]";

/** The tree's rows, top to bottom. */
export function treeRows(host: ParentNode): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(ROW)];
}

const levelOf = (row: HTMLElement): number => Number(row.getAttribute("aria-level") ?? "1");

/** Make `row` the tree's one tab stop, and optionally focus it. */
export function rove(host: ParentNode, row: HTMLElement | undefined, focus = false): void {
  if (row === undefined) return;
  for (const r of treeRows(host)) r.tabIndex = r === row ? 0 : -1;
  if (focus) row.focus();
}

/**
 * Where a key goes from `row`, or what it does: a row to move to, "toggle"
 * (open or close this row), or undefined when the key is not the tree's.
 */
export function treeKey(rows: readonly HTMLElement[], row: HTMLElement, key: string): HTMLElement | "toggle" | undefined {
  const at = rows.indexOf(row);
  if (at < 0) return undefined;
  const expanded = row.getAttribute("aria-expanded");
  switch (key) {
    case "ArrowDown": return rows[at + 1] ?? row;
    case "ArrowUp": return rows[at - 1] ?? row;
    case "Home": return rows[0];
    case "End": return rows[rows.length - 1];
    case "ArrowRight": {
      if (expanded === "false") return "toggle";
      if (expanded === "true") {
        const next = rows[at + 1];
        return next !== undefined && levelOf(next) > levelOf(row) ? next : row;
      }
      return row;
    }
    case "ArrowLeft": {
      if (expanded === "true") return "toggle";
      const level = levelOf(row);
      for (let i = at - 1; i >= 0; i--) if (levelOf(rows[i]!) < level) return rows[i];
      return row;
    }
    default: return undefined;
  }
}

const wired = new WeakSet<HTMLElement>();

/**
 * Give `host` the tree's keys. Once per host, however often its rows are
 * redrawn: the handler reads the rows as they are when the key comes.
 * `toggle` opens or closes a row; the caller redraws, and puts the focus back
 * on the same row, found again by its `data-nav-key`.
 */
export function wireTreeKeys(host: HTMLElement, toggle: (row: HTMLElement) => void): void {
  if (wired.has(host)) return;
  wired.add(host);
  host.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>(ROW) : null;
    if (row === null || !host.contains(row)) return;
    const to = treeKey(treeRows(host), row, e.key);
    if (to === undefined) return;
    e.preventDefault();
    if (to !== "toggle") { rove(host, to, true); return; }
    const key = row.dataset["navKey"];
    const was = row.getAttribute("aria-expanded");
    toggle(row);
    // A row can refuse to close: the navigator keeps the open document's path
    // open whatever its chevrons say. Left then goes on to the parent, as it
    // would from a row with nothing to close.
    const now = key === undefined ? row : treeRows(host).find((r) => r.dataset["navKey"] === key);
    if (now === undefined || now.getAttribute("aria-expanded") !== was) return;
    if (e.key === "ArrowLeft") {
      const rows = treeRows(host);
      const at = rows.indexOf(now);
      for (let i = at - 1; i >= 0; i--) if (levelOf(rows[i]!) < levelOf(now)) { rove(host, rows[i], true); return; }
    }
  });
}
