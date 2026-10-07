// ---------------------------------------------------------------------------
// Keeping the author's place across a re-render of the same document (finding
// 3 of the October 2026 review).
//
// The editor redraws a document whole when something about it arrives (a
// catalogue, a saved comment, a project re-read on focus). A redraw throws the
// old elements away, and with them the scroll offset and the caret: an alt-tab
// used to drop the caret and scroll the navigator to the top. This takes both
// before the redraw and puts them back after it, ONLY when it is the same
// document being redrawn; a different document starts at its own top.
//
// The focused field is found again by its position among the fields under the
// root, and only taken if it is the same kind of field (tag, class and
// placeholder), so a redraw that adds or removes a field above it does not move
// the caret into something else. When the redraw drew the field from data that
// is behind what was typed (an edit still waiting in the save queue), the typed
// value is carried across and announced with an `input` event, so the new
// editor's model takes it and the queue keeps it.
// ---------------------------------------------------------------------------

const FIELDS = "input, textarea, select";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const signature = (f: Element): string =>
  `${f.tagName}|${f.className}|${(f as HTMLInputElement).placeholder ?? ""}|${(f as HTMLInputElement).type ?? ""}`;

/** The text selection, where the field has one (a number input does not). */
function selectionOf(f: Field): { start: number; end: number; dir: "forward" | "backward" | "none" } | undefined {
  if (f instanceof HTMLSelectElement) return undefined;
  try {
    if (f.selectionStart === null || f.selectionEnd === null) return undefined;
    return { start: f.selectionStart, end: f.selectionEnd, dir: f.selectionDirection ?? "none" };
  } catch { return undefined; }
}

export interface KeepOptions {
  /** Carry the field's on-screen value into the redrawn field when the two
   *  differ: true while edits are still waiting to be written. */
  carryValue?: boolean;
}

/**
 * Remember the scroll of `scrollers` and the focused field under `root`, and
 * return the function that puts them back. Call the result after the redraw.
 */
export function keepPlace(scrollers: readonly HTMLElement[], root: HTMLElement | undefined, opts: KeepOptions = {}): () => void {
  const scrolls = scrollers.map((s) => ({ s, top: s.scrollTop, left: s.scrollLeft }));
  const active = document.activeElement;
  let focused: { index: number; sig: string; value: string; sel: ReturnType<typeof selectionOf> } | undefined;
  if (root !== undefined && active instanceof Element && active !== root && root.contains(active) && active.matches(FIELDS)) {
    const fields = [...root.querySelectorAll(FIELDS)];
    const f = active as Field;
    focused = { index: fields.indexOf(active), sig: signature(active), value: f.value, sel: selectionOf(f) };
  }
  return () => {
    for (const { s, top, left } of scrolls) { s.scrollTop = top; s.scrollLeft = left; }
    if (focused === undefined || root === undefined) return;
    // Something else took the focus during the redraw on purpose (a new title).
    const now = document.activeElement;
    if (now instanceof Element && now !== document.body && root.contains(now) && now.matches(FIELDS)) return;
    const again = root.querySelectorAll(FIELDS)[focused.index];
    if (again === undefined || signature(again) !== focused.sig) return;
    const f = again as Field;
    if ((f as HTMLInputElement).disabled) return;
    f.focus({ preventScroll: true });
    if (opts.carryValue === true && f.value !== focused.value && !(f instanceof HTMLSelectElement)) {
      f.value = focused.value;
      f.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const sel = focused.sel;
    if (sel !== undefined && !(f instanceof HTMLSelectElement)) {
      try { f.setSelectionRange(Math.min(sel.start, f.value.length), Math.min(sel.end, f.value.length), sel.dir); } catch { /* not a text field */ }
    }
    // The redraw replaced the scroll content after the offsets were read back;
    // set them again now the focused field is in.
    for (const { s, top, left } of scrolls) { s.scrollTop = top; s.scrollLeft = left; }
  };
}
