// ---------------------------------------------------------------------------
// Undo undoes what you're looking at (Patterpad's rule, patter ee3b612).
//
// Edit > Undo went to the project's history wherever the focus was, so Cmd+Z
// while typing in a field undid the project's last step, and the field, which a
// redraw leaves alone while the author is in it, went on showing what was typed:
// the screen and the file disagreed. A focused text field that holds typing of
// its own takes Undo itself, as a text undo, and its rows commit the result as
// they commit any typing; once that typing is all undone, Undo goes on to the
// project's history. Redo goes to the field only after an undo in that field.
// While a modal dialog is open, Undo is always the dialog's own text.
//
// "Typing of its own" is tracked here, per field, from its value at focus. The
// page's own answer cannot be used alone: its text undo is ONE stack across
// every field on the page, so it says "can undo" in a field that was never typed
// in, and undoing there would take back typing in another field.
// ---------------------------------------------------------------------------

/** Where Edit > Undo or Redo goes: the focused field's own text, or the project's history. */
export type UndoRoute = "field" | "project";

/** What a field can carry text undo for: a text-like input or a text area (the shell's text, multiline and
 *  number rows, the expression editors, the dialogs' fields). Not a select, a checkbox or a button. */
const TEXT_INPUT = new Set(["", "text", "search", "number", "email", "url", "tel", "password"]);
function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  return el instanceof HTMLInputElement && TEXT_INPUT.has(el.getAttribute("type") ?? "") && !el.readOnly && !el.disabled;
}

export interface FieldUndo {
  route(dir: "undo" | "redo"): UndoRoute;
  dispose(): void;
}

/**
 * Watch `doc`'s fields for typing of their own. `can` is the page's text undo ("is there anything to undo /
 * redo"), asked as well: a field whose value differs for some other reason has nothing for it to take back.
 */
export function trackFieldUndo(
  doc: Document,
  can: (cmd: "undo" | "redo") => boolean = (cmd) => doc.queryCommandEnabled(cmd),
): FieldUndo {
  /** Each field's value when it was focused, and whether it has been undone in since it was last typed in. */
  const seen = new WeakMap<Element, { atFocus: string; undone: boolean }>();
  const onFocus = (e: Event): void => {
    const t = e.target as Element | null;
    if (isTextField(t)) seen.set(t, { atFocus: t.value, undone: false });
  };
  const onInput = (e: Event): void => {
    const st = seen.get(e.target as Element);
    if (!st) return;
    const how = (e as InputEvent).inputType;
    if (how === "historyUndo") st.undone = true;
    else if (how !== "historyRedo") st.undone = false;   // fresh typing ends any redo
  };
  doc.addEventListener("focusin", onFocus, true);
  doc.addEventListener("input", onInput, true);
  return {
    route(dir) {
      // A modal dialog owns the keyboard: Undo there is the dialog's text, or
      // nothing, never a project step behind it (Patterpad's rule too).
      if (doc.querySelector("dialog[open]")) return "field";
      const active = doc.activeElement;
      if (!isTextField(active)) return "project";
      const st = seen.get(active);
      if (!st) return "project";
      const own = dir === "undo" ? active.value !== st.atFocus : st.undone;
      return own && can(dir) ? "field" : "project";
    },
    dispose() {
      doc.removeEventListener("focusin", onFocus, true);
      doc.removeEventListener("input", onInput, true);
    },
  };
}
