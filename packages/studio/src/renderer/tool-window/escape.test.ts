// @vitest-environment jsdom
// Escape read as it was pressed: a layered Escape answers from the state the
// key went down in, whichever listener heard it first (escape.ts).

import { describe, expect, it } from "vitest";
import { escapeSnapshot, pointerHeld } from "./escape.js";

const esc = (target: EventTarget = document.body): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

describe("escapeSnapshot", () => {
  it("reads the state before a listener registered EARLIER has changed it", () => {
    let selected = true;
    // The canvas's listener, registered first: it drops the selection.
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") selected = false; });
    const at = escapeSnapshot(() => selected);
    let answered: boolean | undefined;
    // The window's own layering, registered last, as the shell's would be.
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") answered = at(); });
    esc();
    expect(selected).toBe(false);
    expect(answered).toBe(true);
  });

  it("is undefined until the first Escape, and ignores other keys", () => {
    const at = escapeSnapshot(() => "read");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(at()).toBeUndefined();
    esc();
    expect(at()).toBe("read");
  });
});

describe("pointerHeld", () => {
  it("is true from a press in the host until the button comes up anywhere", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const held = pointerHeld(host);
    expect(held()).toBe(false);
    host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(held()).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(held()).toBe(false);
  });

  it("ignores a press outside the host", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const held = pointerHeld(host);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(held()).toBe(false);
  });
});
