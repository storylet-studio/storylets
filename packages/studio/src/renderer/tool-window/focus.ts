// ---------------------------------------------------------------------------
// Keyboard focus across a re-render.
//
// A window that rebuilds part of itself on every change (the Board does, after
// each play, pick and toggle) takes the focused control out from under the
// keyboard: tab to a hand, press Enter, and the focus is gone, back to the top
// of the page. This notes what was focused before the rebuild and puts the
// focus on its replacement after.
//
// A control is known by its `data-fkey` where it has one (a hand, a card, a
// chip whose label carries a count), and otherwise by its tag and its words,
// counted in document order so the third of three "+1" buttons stays the third.
// ---------------------------------------------------------------------------

/** What identifies a control across a rebuild. */
interface FocusKey {
  sig: string;
  nth: number;
}

/** The controls that can hold focus: only these are compared, so a rebuild of
 *  a long list does not read the words of every element in it. */
const FOCUSABLE = "button, input, select, textarea, summary, a[href], [tabindex]";

const signature = (el: Element): string =>
  el.getAttribute("data-fkey") ?? `${el.tagName}|${(el.textContent ?? "").trim()}|${el.getAttribute("aria-label") ?? ""}`;

/** Set a control's focus key, for a control whose words change as it is used. */
export function focusKey<T extends HTMLElement>(node: T, key: string): T {
  node.dataset["fkey"] = key;
  return node;
}

/** Rebuild `within` with `rebuild`, keeping the keyboard on the same control if
 *  it was in there and is still there afterwards. */
export function keepFocus(within: HTMLElement, rebuild: () => void): void {
  const active = document.activeElement;
  let key: FocusKey | undefined;
  if (active instanceof HTMLElement && active !== within && within.contains(active)) {
    const sig = signature(active);
    const same = [...within.querySelectorAll(FOCUSABLE)].filter((e) => signature(e) === sig);
    key = { sig, nth: Math.max(0, same.indexOf(active)) };
  }
  rebuild();
  if (key === undefined || within.contains(document.activeElement)) return;
  const same = [...within.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => signature(e) === key!.sig);
  (same[key.nth] ?? same[same.length - 1])?.focus({ preventScroll: true });
}
