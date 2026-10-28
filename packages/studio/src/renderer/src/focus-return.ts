// ---------------------------------------------------------------------------
// The focus goes back to what opened a picker, once the picker closes (the
// hands-on review, 2026-10, foundation 8: closing the Where picker, a deck
// picker, a swatch picker or a context menu dropped the focus to the top of
// the window, and the keyboard had to start again from the first tab stop).
//
// The shell's anchored panel, popover and context menu are removed when they
// close, and the focus inside them goes with them, to <body>. Rather than wrap
// every one of them, this watches for any of them (browse-keys OVERLAYS, plus a
// dialog) coming and going: what had the focus when the first one opened is the
// opener, and when the last one goes with the focus left on nothing, the
// opener gets it back. A pick that redrew the page has thrown the opener away,
// so it is also remembered by what it looks like (its tag, its words, its
// label) and its place among its look-alikes, and the redrawn one is found by
// that. When the focus went somewhere on purpose (a click elsewhere, a new
// title being named), it is left there.
//
// `claim` comes first: a page may want the focus for itself once the picker
// has gone (a box made from the kit gallery asks for its title, which a modal
// gallery still closing would not let it have).
// ---------------------------------------------------------------------------

import { OVERLAYS } from "./browse-keys.js";

/** What the watcher counts as a picker: everything browse-keys keeps keys from, and any dialog. */
const PICKERS = `${OVERLAYS}, dialog, .shell-anchored, .popover, .ctxmenu`;

/** How an element is found again after a redraw: its look, and which of the look-alikes it was. */
export interface Locator { sig: string; index: number }

const signature = (e: Element): string =>
  `${e.tagName}|${(e.textContent ?? "").trim().slice(0, 80)}|${e.getAttribute("aria-label") ?? ""}|${e.getAttribute("data-tab") ?? ""}|${e.getAttribute("data-nav-key") ?? ""}|${e.getAttribute("data-card") ?? ""}`;

/** Remember `e` by its look. */
export function locate(e: Element, doc: Document = document): Locator {
  const sig = signature(e);
  const alike = [...doc.querySelectorAll(e.tagName)].filter((x) => signature(x) === sig);
  return { sig, index: Math.max(0, alike.indexOf(e)) };
}

/** Find a remembered element again: the same place among its look-alikes, or the only one. */
export function relocate(at: Locator, doc: Document = document): HTMLElement | undefined {
  const tag = at.sig.slice(0, at.sig.indexOf("|"));
  const alike = [...doc.querySelectorAll<HTMLElement>(tag)].filter((x) => signature(x) === at.sig);
  return alike[at.index] ?? (alike.length === 1 ? alike[0] : undefined);
}

/** A dialog counts only while it is open: one built ahead and kept would
 *  otherwise hold the watcher shut for ever. */
const isPicker = (n: Node): n is Element =>
  n instanceof Element && n.matches(PICKERS) && !(n instanceof HTMLDialogElement && !n.open);
/** Gone, by removal (its own or an ancestor's, a redraw), or a dialog closed. */
const gone = (n: Element): boolean => !n.isConnected || (n instanceof HTMLDialogElement && !n.open);
const insidePicker = (n: Element | null): boolean => n !== null && n.closest(PICKERS) !== null;

export interface FocusReturnOptions {
  doc?: Document;
  /** Asked first when the focus is free again: true when it took the focus itself. */
  claim?: () => boolean;
}

/** The running watch: call it to stop watching. `opener()` is the opener of
 *  the pickers open now, found again if a redraw replaced it, for the shell's
 *  dialog to give the focus to as it closes (setDialogFocusFallback): the
 *  dialog hands the focus back itself, before this watcher would. */
export interface FocusReturnWatch {
  (): void;
  opener(): HTMLElement | undefined;
}

/**
 * What a dialog should give the focus back to: what has it now, or, when a
 * redraw has replaced that while the dialog was open, the redrawn one, found by
 * its look (the shell dialog's `returnFocus`, app-shell 0.71.0). Call it as the
 * dialog opens; the answer is asked for as it closes.
 */
export function returnToOpener(doc: Document = document): () => HTMLElement | undefined {
  const active = doc.activeElement;
  if (!(active instanceof HTMLElement) || active === doc.body) return () => undefined;
  const at = locate(active, doc);
  return () => (active.isConnected ? active : relocate(at, doc));
}

/**
 * Watch for pickers opening and closing, and give the focus back when one
 * closes. Returns the function that stops watching. Once, at start-up.
 */
export function watchFocusReturn(opts: FocusReturnOptions = {}): FocusReturnWatch {
  const doc = opts.doc ?? document;
  /** The last thing focused outside every picker, for a picker that moves the
   *  focus into itself as it opens (a deck picker focuses its last deck). */
  let lastOutside: Element | null = null;
  let opener: { el: HTMLElement; at: Locator } | undefined;
  const open = new Set<Element>();

  const onFocusIn = (e: FocusEvent): void => {
    const t = e.target instanceof Element ? e.target : null;
    if (t !== null && !insidePicker(t)) lastOutside = t;
  };
  doc.addEventListener("focusin", onFocusIn, true);

  const giveBack = (): void => {
    const active = doc.activeElement;
    if (active !== null && active !== doc.body && active !== doc.documentElement) return;
    if (opts.claim?.() === true) return;
    if (opener === undefined) return;
    const target = opener.el.isConnected ? opener.el : relocate(opener.at, doc);
    target?.focus({ preventScroll: true });
  };

  const observer = new MutationObserver((records) => {
    let closed = false;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!isPicker(n) || open.has(n)) continue;
        if (open.size === 0) {
          const active = doc.activeElement;
          const from = active !== null && active !== doc.body && !insidePicker(active) ? active
            : insidePicker(active) ? lastOutside : null;
          opener = from instanceof HTMLElement && from.isConnected ? { el: from, at: locate(from, doc) } : undefined;
        }
        open.add(n);
      }
    }
    for (const n of [...open]) if (gone(n)) { open.delete(n); closed = true; }
    // Only once the last one is gone, and only for a picker this saw open.
    if (!closed || open.size > 0) return;
    giveBack();
    opener = undefined;
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  const stop = (): void => {
    observer.disconnect();
    doc.removeEventListener("focusin", onFocusIn, true);
  };
  return Object.assign(stop, {
    opener: (): HTMLElement | undefined =>
      opener === undefined ? undefined : opener.el.isConnected ? opener.el : relocate(opener.at, doc),
  });
}
