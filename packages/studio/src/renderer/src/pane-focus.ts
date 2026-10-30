// ---------------------------------------------------------------------------
// Where the keyboard lands when it moves between the panes (app-shell 0.71.0,
// the hands-on review of 2026-10). Cmd+1 on an open navigator moves the focus
// into it rather than closing it, and the shell asks the host what to focus:
// the navigator's current row, and, when the place the focus came from has
// gone, the centre's own working area rather than the trail above it. The same
// working area is where focus goes after a dialog when nothing nearer can take
// it (setDialogFocusFallback).
// ---------------------------------------------------------------------------

import { canTakeFocus, firstFocusable } from "@wildwinter/app-shell";

/** The navigator's one tab stop: the tree's roving row (app-shell's tree keys), else
 *  the row that's current. Undefined leaves the shell's default. */
export function navFocusTarget(nav: ParentNode): HTMLElement | undefined {
  const row = nav.querySelector<HTMLElement>('[role=treeitem][tabindex="0"]')
    ?? nav.querySelector<HTMLElement>('[role=treeitem][aria-current="page"]');
  return row !== null && canTakeFocus(row) ? row : undefined;
}

/** The centre's working area: the open document's title when there is one,
 *  else the first control below the hierarchy trail, else the first control
 *  at all (a page with no trail). */
export function centreHome(centre: HTMLElement): HTMLElement | undefined {
  const title = centre.querySelector<HTMLElement>(".doc-title");
  if (title !== null && canTakeFocus(title)) return title;
  for (const child of centre.children) {
    if (!(child instanceof HTMLElement) || child.classList.contains("crumbs")) continue;
    const first = canTakeFocus(child) && child.tabIndex >= 0 ? child : firstFocusable(child);
    if (first !== null) return first;
  }
  return firstFocusable(centre) ?? undefined;
}
