// @vitest-environment jsdom
// Keeping the author's place across a redraw of the same document (finding 3
// of the October 2026 review): the scroll, the focused field, its caret, and
// a value typed ahead of what the redraw was drawn from.

import { afterEach, describe, expect, it, vi } from "vitest";
import { keepPlace } from "./keep-place.js";

let root: HTMLElement;
afterEach(() => root?.remove());

/** A document with two fields, the way a page draws one. */
function draw(title: string, purpose: string): void {
  const t = document.createElement("input");
  t.className = "insp-input doc-title"; t.placeholder = "Card title"; t.value = title;
  const p = document.createElement("textarea");
  p.className = "insp-input doc-purpose"; p.value = purpose;
  root.replaceChildren(t, p);
}

describe("keepPlace", () => {
  it("puts the scroll offsets back", () => {
    root = document.createElement("section");
    document.body.append(root);
    root.scrollTop = 140;
    const restore = keepPlace([root], root);
    root.scrollTop = 0;   // what a redraw does to it
    restore();
    expect(root.scrollTop).toBe(140);
  });

  it("puts the focus back in the same field of the redrawn document, caret and all", () => {
    root = document.createElement("section");
    document.body.append(root);
    draw("The well", "Where it starts");
    const ta = root.querySelector("textarea")!;
    ta.focus();
    ta.setSelectionRange(3, 5);
    const restore = keepPlace([root], root);
    draw("The well", "Where it starts");
    expect(document.activeElement).toBe(document.body);
    restore();
    const again = root.querySelector("textarea")!;
    expect(document.activeElement).toBe(again);
    expect([again.selectionStart, again.selectionEnd]).toEqual([3, 5]);
  });

  it("does not move the focus into a different kind of field", () => {
    root = document.createElement("section");
    document.body.append(root);
    draw("The well", "Where it starts");
    root.querySelector("textarea")!.focus();
    const restore = keepPlace([root], root);
    // The redraw drew something else in that position.
    const other = document.createElement("select");
    root.replaceChildren(root.querySelector("input")!.cloneNode() as HTMLElement, other);
    restore();
    expect(document.activeElement).not.toBe(other);
  });

  it("carries a value typed ahead of the data the redraw used, and announces it", () => {
    root = document.createElement("section");
    document.body.append(root);
    draw("The well at dusk", "");
    root.querySelector("input")!.focus();
    const restore = keepPlace([root], root, { carryValue: true });
    draw("The well", "");   // drawn from data that has not caught up
    const heard = vi.fn();
    root.querySelector("input")!.addEventListener("input", heard);
    restore();
    expect(root.querySelector("input")!.value).toBe("The well at dusk");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("leaves the redrawn value alone when nothing is waiting to be written", () => {
    root = document.createElement("section");
    document.body.append(root);
    draw("Old", "");
    root.querySelector("input")!.focus();
    const restore = keepPlace([root], root, { carryValue: false });
    draw("New from disk", "");
    restore();
    expect(root.querySelector("input")!.value).toBe("New from disk");
  });

  it("leaves a focus the redraw chose on purpose (a new title) where it is", () => {
    root = document.createElement("section");
    document.body.append(root);
    draw("Old", "Purpose");
    root.querySelector("textarea")!.focus();
    const restore = keepPlace([root], root);
    draw("New card", "");
    root.querySelector("input")!.focus();
    restore();
    expect(document.activeElement).toBe(root.querySelector("input"));
  });
});
