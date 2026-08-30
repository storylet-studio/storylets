// ---------------------------------------------------------------------------
// A lightweight right-click context menu: a floating list of actions at the
// cursor, dismissed on outside-click or Escape, clamped to the viewport.
// Mirrors Patterpad's `.nav-ctx` model (a DOM popover, not a native menu).
//
// EXTRACTION CANDIDATE (shared shell mechanism). Patterpad has the same shape
// inline as `sceneContextMenu`; both should reconcile into the shell package's
// mechanism layer (alongside the anchored panel + toast) in a later slice.
// ---------------------------------------------------------------------------

// Its own look travels with it, so a tool window gets a menu that is visible
// rather than one that is merely present (context-menu.css).
import "./context-menu.css";
import { el } from "./dom.js";

export interface ContextItem {
  label: string;
  danger?: boolean;
  /** Shown greyed and unclickable. For an action that belongs on this menu but
   *  cannot apply right now (Move up on the first row), so the menu keeps the
   *  same shape and the same item stays in the same place every time. Patterpad
   *  passes the same flag to `iconBtn` for its up/down list controls. */
  disabled?: boolean;
  onClick: () => void;
}

/** Dismiss-on-outside-click / Escape wiring shared by the menu and the popover.
 *  `onDismiss` fires for the outside-click / Escape routes too, so a caller can
 *  flush on every way out. */
function floating(node: HTMLElement, onDismiss?: () => void): { dismiss: () => void } {
  const dismiss = (): void => {
    node.remove();
    window.removeEventListener("pointerdown", onAway, true);
    window.removeEventListener("keydown", onKey, true);
  };
  const away = (): void => { dismiss(); onDismiss?.(); };
  const onAway = (e: PointerEvent): void => { if (!node.contains(e.target as Node)) away(); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") away(); };
  window.addEventListener("pointerdown", onAway, true);
  window.addEventListener("keydown", onKey, true);
  return { dismiss };
}

/** Clamp a floating node into the viewport, preferring below `anchor`. */
function place(node: HTMLElement, anchor: DOMRect): void {
  node.style.left = `${anchor.left}px`;
  node.style.top = `${anchor.bottom + 4}px`;
  const r = node.getBoundingClientRect();
  if (r.right > window.innerWidth) node.style.left = `${Math.max(6, window.innerWidth - r.width - 6)}px`;
  if (r.bottom > window.innerHeight) node.style.top = `${Math.max(6, anchor.top - r.height - 4)}px`;
}

/** Open a small panel anchored to an element; `build` gets a close callback.
 *  `onClose` runs however it closes (Escape, outside click, or `close`) - the
 *  place to flush an edit the panel was collecting. */
export function openPopover(anchor: HTMLElement, build: (close: () => void) => HTMLElement, onClose?: () => void): void {
  document.querySelector(".ctxmenu")?.remove();
  document.querySelector(".popover")?.remove();
  const pop = el("div", { className: "popover" });
  let closed = false;
  const finish = (): void => { if (closed) return; closed = true; onClose?.(); };
  const { dismiss } = floating(pop, finish);
  const close = (): void => { if (closed) return; dismiss(); finish(); };
  pop.append(build(close));
  document.body.append(pop);
  place(pop, anchor.getBoundingClientRect());
}

/** Open a context menu at (x, y). Only one is ever open. */
export function openContextMenu(x: number, y: number, items: ContextItem[]): void {
  document.querySelector(".ctxmenu")?.remove();
  const menu = el("div", { className: "ctxmenu" });

  const dismiss = (): void => {
    menu.remove();
    window.removeEventListener("pointerdown", onAway, true);
    window.removeEventListener("keydown", onKey, true);
  };
  const onAway = (e: PointerEvent): void => { if (!menu.contains(e.target as Node)) dismiss(); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") dismiss(); };

  for (const item of items) {
    const button = el("button", {
      className: `ctxmenu-item${item.danger ? " danger" : ""}`, text: item.label,
      onClick: () => { if (item.disabled === true) return; dismiss(); item.onClick(); },
    }) as HTMLButtonElement;
    if (item.disabled === true) button.disabled = true;
    menu.append(button);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.append(menu);
  // Keep it on-screen.
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(6, window.innerWidth - r.width - 6)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(6, window.innerHeight - r.height - 6)}px`;

  window.addEventListener("pointerdown", onAway, true);
  window.addEventListener("keydown", onKey, true);
}
