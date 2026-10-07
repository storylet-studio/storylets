// @vitest-environment jsdom
// Keyboard focus across a re-render (focus.ts): the control that had it keeps
// it, matched by its focus key, or by its words and its place among twins.

import { describe, expect, it } from "vitest";
import { focusKey, keepFocus } from "./focus.js";

function button(text: string, key?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  return key !== undefined ? focusKey(b, key) : b;
}

describe("keepFocus", () => {
  it("puts the focus back on the rebuilt control with the same key, even when its words changed", () => {
    const within = document.createElement("div");
    document.body.replaceChildren(within);
    within.append(button("warning 1", "jflt:diagnostic"), button("played"));
    within.querySelector<HTMLButtonElement>("button")!.focus();
    keepFocus(within, () => within.replaceChildren(button("played"), button("warning 2", "jflt:diagnostic")));
    expect(document.activeElement?.textContent).toBe("warning 2");
  });

  it("tells twins apart by their place", () => {
    const within = document.createElement("div");
    document.body.replaceChildren(within);
    const three = (): HTMLButtonElement[] => [button("+1"), button("+1"), button("+1")];
    within.append(...three());
    within.querySelectorAll<HTMLButtonElement>("button")[2]!.focus();
    keepFocus(within, () => within.replaceChildren(...three()));
    expect(document.activeElement).toBe(within.querySelectorAll("button")[2]);
  });

  it("leaves the focus alone when it was outside", () => {
    const within = document.createElement("div");
    const outside = button("Close");
    document.body.replaceChildren(outside, within);
    within.append(button("Next turn"));
    outside.focus();
    keepFocus(within, () => within.replaceChildren(button("Next turn")));
    expect(document.activeElement).toBe(outside);
  });

  it("gives up quietly when the control is gone", () => {
    const within = document.createElement("div");
    document.body.replaceChildren(within);
    within.append(button("Back"));
    within.querySelector<HTMLButtonElement>("button")!.focus();
    keepFocus(within, () => within.replaceChildren(button("Continue")));
    expect(document.activeElement).toBe(document.body);
  });
});
