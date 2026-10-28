// ---------------------------------------------------------------------------
// Whose a browse key is. Delete, Enter and the arrows act on the selected
// cards in the card and table views, the box's Contents and the card editor,
// so they must only do it when the author's keyboard is on the cards: never
// from a focused button elsewhere on the page (Delete on the + New card ghost,
// or on a tab, deleted the selection), and never with a dialog, menu or
// popover on top (the hands-on review, foundation 8).
// ---------------------------------------------------------------------------

/** Everything that can sit on top of the page and take keys for itself. */
export const OVERLAYS = "dialog[open], .shell-anchored, .popover, .ctxmenu, .exed-pop";

/** Whether anything sits on top of the page. */
export function overlayOpen(doc: Document = document): boolean {
  return doc.querySelector(OVERLAYS) !== null;
}

/**
 * Whether a browse key pressed on `target` belongs to the cards: nothing on
 * top, and the focus either on nothing in particular (the page itself) or on
 * a card, a card's face or a table row. Any other control keeps the key for
 * itself, as a button does Enter.
 */
export function keyIsTheCards(target: EventTarget | null, doc: Document = document): boolean {
  if (overlayOpen(doc)) return false;
  if (!(target instanceof Element) || target === doc.body || target === doc.documentElement) return true;
  if (target.matches(".scard:not(.ghost)")) return true;
  // A table row is not focusable, so a key there lands on a cell; a control
  // inside the row is still its own.
  return target.closest(".ctable tr") !== null && target.closest("button, a, input, select, textarea, [contenteditable]") === null;
}
