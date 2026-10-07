// ---------------------------------------------------------------------------
// How a field commits, in one place (ruling N, the October 2026 review).
//
// There were four rules: titles committed per keystroke and Esc restored them;
// deck and box titles committed on blur; purpose, outcome text, priority and
// copies committed per keystroke with no Esc; and six fields (card and outcome
// Fields values, redraw turns, hand and template slots, a box's turn seconds,
// tag names) committed only on blur, so Cmd+S, Play and the review walk acted
// on a value just typed, or lost it. Now there is one helper with an explicit
// mode, so the rule cannot drift field by field again:
//
//   - "input": every keystroke is taken and committed. The commit goes through
//     the save queue (save-queue.ts), which writes once the typing settles, so
//     anything that flushes (Cmd+S, Play, the walk, a navigation) sees it.
//   - "blur": every keystroke is taken, and committed on change. Only the deck
//     and box titles use it, because renaming either moves a file.
//
// Esc restores the value the field held when it got focus, in both modes. In
// "input" mode the restored value is committed back, since the typed one was
// already on its way; in "blur" mode nothing was committed, and with the value
// back where it started no change event follows the window's Esc blur.
//
// The segmented control and the option select live here too: the card, hand,
// template and box pages each drew their own copies of both.
// ---------------------------------------------------------------------------

import { el } from "@wildwinter/app-shell";

export type CommitMode = "input" | "blur";

export interface FieldBinding {
  /** When the field commits; see the header. */
  mode: CommitMode;
  /** Take the field's text into the model. Called on every keystroke, and with
   *  the value from focus time when Esc restores it. */
  set: (value: string) => void;
  /** Persist what `set` took. */
  commit: () => void;
  /** Repaint anything derived from the value (an address chip, a preview).
   *  Called after every `set`. */
  after?: () => void;
}

/**
 * Wire an input or textarea to the one rule. Returns the field.
 *
 * The value at focus is what Esc puts back; a field that never had focus has
 * its initial value. Esc does not stop the event: the window's own handler
 * blurs the field afterwards, which is the second half of the gesture.
 */
export function bindField<T extends HTMLInputElement | HTMLTextAreaElement>(field: T, b: FieldBinding): T {
  let atFocus = field.value;
  const take = (value: string): void => { b.set(value); b.after?.(); };
  field.addEventListener("focus", () => { atFocus = field.value; });
  field.addEventListener("input", () => {
    take(field.value);
    if (b.mode === "input") b.commit();
  });
  field.addEventListener("change", () => {
    // A blur that changed nothing commits nothing, whatever the browser decides
    // about firing `change` after a programmatic restore.
    if (b.mode === "blur" && field.value !== atFocus) b.commit();
  });
  field.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape" || field.value === atFocus) return;
    field.value = atFocus;
    take(atFocus);
    if (b.mode === "input") b.commit();
  });
  return field;
}

/** A plain text input, bound. An identifier is not prose, so a mono or name
 *  field gets no spell-check squiggle (parity row 52). */
export function inputField(value: string, className: string, b: FieldBinding): HTMLInputElement {
  const input = el("input", { className });
  input.value = value;
  if (/\binsp-mono\b|\bdoc-name\b/.test(className)) input.spellcheck = false;
  return bindField(input, b);
}

/**
 * The segmented control the document pages share: one `.seg` of `.seg-opt`
 * buttons, the chosen one lit. A click on the choice already made does
 * nothing, so it cannot reset a value typed beside it.
 */
export function segmented(options: { label: string; on: boolean; pick: () => void }[], className = "seg insp-seg"): HTMLElement {
  const seg = el("div", { className });
  for (const o of options) {
    const b = el("button", { className: `seg-opt${o.on ? " on" : ""}`, text: o.label });
    if (!o.on) b.addEventListener("click", () => o.pick());
    seg.append(b);
  }
  return seg;
}

/** One `<option>`, selected when it is the current value. */
export function option(value: string, label: string, current?: string): HTMLOptionElement {
  const o = el("option", { text: label });
  o.value = value;
  if (value === current) o.selected = true;
  return o;
}

/**
 * The option select the document pages share: a "none" choice first (its
 * label says what none means here: "(unset)", "(any)", "(choose)"), then the
 * values, the current one selected. `extra` hangs anything else on the end
 * (an optgroup of property references) before the change is wired.
 */
export function optionSelect(
  values: readonly string[], current: string, onChange: (value: string) => void,
  opts: { none?: string; className?: string; extra?: (sel: HTMLSelectElement) => void } = {},
): HTMLSelectElement {
  const sel = el("select", { className: opts.className ?? "insp-input insp-mono" });
  if (opts.none !== undefined) sel.append(option("", opts.none, current));
  for (const v of values) sel.append(option(v, v, current));
  opts.extra?.(sel);
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}
