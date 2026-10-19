// @vitest-environment jsdom
// Undo undoes what you're looking at (Patterpad's rule, patter ee3b612): Cmd+Z while typing in a field undid
// the project's last step and left the typed text on screen, so the screen and the file disagreed. A focused
// text field with typing of its own since it was focused takes Undo itself; Redo goes to it only after an undo
// there; everything else is the project's history.

import { afterEach, describe, expect, it } from "vitest";
import { trackFieldUndo } from "./field-undo.js";

afterEach(() => { document.body.replaceChildren(); });

/** A tracker whose answer to "can the page undo / redo" is ours to set (jsdom has no editing commands). */
function setup(can = { undo: true, redo: true }) {
  const tracker = trackFieldUndo(document, (cmd) => can[cmd]);
  const field = (tag: "input" | "textarea", value = "salt", type?: string): HTMLInputElement | HTMLTextAreaElement => {
    const f = document.createElement(tag);
    if (type && f instanceof HTMLInputElement) f.type = type;
    f.value = value;
    document.body.append(f);
    return f;
  };
  /** Typing as the browser reports it: the value changes, then an input event says how. */
  const type = (f: HTMLInputElement | HTMLTextAreaElement, value: string, inputType = "insertText"): void => {
    f.value = value;
    f.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
  };
  return { tracker, field, type, can };
}

describe("where Undo goes in the editor", () => {
  it("is the project's with nothing focused, or a field that has not been typed in", () => {
    const { tracker, field } = setup();
    expect(tracker.route("undo")).toBe("project");
    const f = field("input");
    f.focus();
    expect(tracker.route("undo")).toBe("project");
  });

  it("is the field's while it holds typing of its own: text, multiline and number alike", () => {
    const { tracker, field, type } = setup();
    for (const f of [field("input"), field("textarea"), field("input", "4", "number")]) {
      f.focus();
      type(f, `${f.value}x`);
      expect(tracker.route("undo")).toBe("field");
    }
  });

  it("goes back to the project once the field's own typing is all undone", () => {
    const { tracker, field, type } = setup();
    const f = field("input");
    f.focus();
    type(f, "salty");
    type(f, "salt", "historyUndo");   // the native undo took it back to what it held at focus
    expect(tracker.route("undo")).toBe("project");
  });

  it("is never the field's for typing in ANOTHER field: the page's text undo is one stack", () => {
    const { tracker, field, type } = setup();
    const a = field("input"), b = field("input");
    a.focus();
    type(a, "salty");
    b.focus();
    expect(tracker.route("undo")).toBe("project");
  });

  it("starts afresh at each focus: typing from an earlier visit is the project's to undo", () => {
    const { tracker, field, type } = setup();
    const f = field("input");
    f.focus();
    type(f, "salty");
    f.blur();
    f.focus();
    expect(tracker.route("undo")).toBe("project");
  });

  it("is the project's when the page has nothing to undo, whatever the field says", () => {
    const { tracker, field, type, can } = setup();
    const f = field("input");
    f.focus();
    type(f, "salty");
    can.undo = false;
    expect(tracker.route("undo")).toBe("project");
  });

  it("is never a select or a checkbox's: they have no typing", () => {
    const { tracker } = setup();
    const s = document.createElement("select");
    const c = document.createElement("input"); c.type = "checkbox";
    document.body.append(s, c);
    for (const f of [s, c]) { f.focus(); expect(tracker.route("undo")).toBe("project"); }
  });
});

describe("with a dialog open", () => {
  it("never reaches the project behind it, typed in or not", () => {
    const { tracker } = setup();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    expect(tracker.route("undo")).toBe("field");
    expect(tracker.route("redo")).toBe("field");
  });
});

describe("where Redo goes in the editor", () => {
  it("is the field's only after an undo in that field, until it is typed in again", () => {
    const { tracker, field, type } = setup();
    const f = field("input");
    f.focus();
    type(f, "salty");
    expect(tracker.route("redo")).toBe("project");
    type(f, "salt", "historyUndo");
    expect(tracker.route("redo")).toBe("field");
    type(f, "salty", "historyRedo");
    expect(tracker.route("undo")).toBe("field");
    type(f, "saltier");
    expect(tracker.route("redo")).toBe("project");
  });
});
