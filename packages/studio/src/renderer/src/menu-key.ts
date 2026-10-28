// ---------------------------------------------------------------------------
// The right-click menus from the keyboard (the hands-on review, 2026-10,
// foundation 8: every context menu was right-click only).
//
// The ContextMenu key and Shift+F10, the two keys every platform's list views
// answer, open the menu the focused thing's right-click opens, anchored to it.
// Nothing here knows which menus exist: the key sends the focused element the
// same `contextmenu` event a right-click would, placed at the element, and
// whichever listener answers a right-click there answers this too (a nav row,
// a card, a table row). The menu's first item then takes the focus, Up and
// Down move through it, and Escape closes it as before, the focus going back
// to the row it was opened from (focus-return.ts).
//
// The canvases answer the key themselves (canvas-input `canvasKey`), for the
// selected item rather than for the canvas element, so they are left alone.
// ---------------------------------------------------------------------------

import { isEditableTarget } from "@wildwinter/app-shell";

/** Is this the keyboard's way to a context menu? */
export function isMenuKey(e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}

/**
 * Send `target` a right-click at its own place: the left edge, a little in,
 * and its bottom, which is where the menu then opens. True when a listener
 * took it (it marks a menu's right-click handled, as every one here does).
 */
export function openMenuAt(target: Element): boolean {
  const r = target.getBoundingClientRect();
  const evt = new MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, button: 2,
    clientX: Math.round(r.left + Math.min(16, r.width / 2)), clientY: Math.round(r.bottom),
  });
  target.dispatchEvent(evt);
  return evt.defaultPrevented;
}

/** The open menu's items that can be chosen. */
const menuItems = (doc: Document): HTMLElement[] =>
  [...doc.querySelectorAll<HTMLElement>(".ctxmenu [role=menuitem]:not(:disabled)")];

/** Put the focus on an open menu's first item, so the keys can choose from it. */
export function focusOpenMenu(doc: Document = document): void {
  menuItems(doc)[0]?.focus();
}

/** Handle one key press: the menu key on a focused thing, or the arrows inside an open menu. */
export function menuKeyDown(e: KeyboardEvent, doc: Document = document): void {
  if (e.defaultPrevented) return;
  const target = e.target instanceof Element ? e.target : null;
  if (target !== null && target.closest(".ctxmenu") !== null) {
    const items = menuItems(doc);
    const at = items.indexOf(target as HTMLElement);
    const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : undefined;
    if (to === undefined || items.length === 0) return;
    e.preventDefault();
    items[(to + items.length) % items.length]!.focus();
    return;
  }
  if (!isMenuKey(e)) return;
  // A field's menu is the platform's (cut, copy, paste); a canvas answers for
  // its selection itself; with nothing focused there is nothing to anchor to.
  if (target === null || target === doc.body || target === doc.documentElement) return;
  if (isEditableTarget(target) || target.closest(".canvas-host") !== null) return;
  if (!openMenuAt(target)) return;
  e.preventDefault();
  focusOpenMenu(doc);
}

/** Listen on the window. Once, at start-up. */
export function listenMenuKey(win: Window = window): void {
  win.addEventListener("keydown", (e) => menuKeyDown(e, win.document));
}
