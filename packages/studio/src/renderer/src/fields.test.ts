// @vitest-environment jsdom
// The one rule for how a field commits (ruling N, fields.ts): as you type in
// "input" mode, on change in "blur" mode, and Esc putting back the value the
// field had when it got focus in both, committing it back only where the typed
// value was already on its way.

import { describe, expect, it, vi } from "vitest";
import { bindField, inputField, optionSelect, segmented } from "./fields.js";

const type = (f: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  f.value = value;
  f.dispatchEvent(new Event("input", { bubbles: true }));
};
const esc = (f: HTMLElement): void => {
  f.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};
const field = (value: string): HTMLInputElement => {
  const f = document.createElement("input");
  f.value = value;
  return f;
};

describe("a field in input mode", () => {
  it("takes and commits every keystroke", () => {
    const set = vi.fn(); const commit = vi.fn();
    const f = bindField(field("Old"), { mode: "input", set, commit });
    type(f, "Ne"); type(f, "New");
    expect(set.mock.calls.map((c) => c[0])).toEqual(["Ne", "New"]);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("Esc puts back the value from focus time, and commits it back", () => {
    const set = vi.fn(); const commit = vi.fn(); const after = vi.fn();
    const f = bindField(field("Old"), { mode: "input", set, commit, after });
    f.dispatchEvent(new Event("focus"));
    type(f, "Typed");
    commit.mockClear();
    esc(f);
    expect(f.value).toBe("Old");
    expect(set).toHaveBeenLastCalledWith("Old");
    expect(after).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("restores to the value at the LATEST focus, not the first", () => {
    const set = vi.fn();
    const f = bindField(field("One"), { mode: "input", set, commit: vi.fn() });
    f.dispatchEvent(new Event("focus"));
    type(f, "Two");
    f.dispatchEvent(new Event("blur"));
    f.dispatchEvent(new Event("focus"));
    type(f, "Three");
    esc(f);
    expect(f.value).toBe("Two");
  });

  it("does nothing on Esc when nothing was typed", () => {
    const set = vi.fn(); const commit = vi.fn();
    const f = bindField(field("Same"), { mode: "input", set, commit });
    f.dispatchEvent(new Event("focus"));
    esc(f);
    expect(set).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("works on a textarea the same way", () => {
    const set = vi.fn(); const commit = vi.fn();
    const ta = document.createElement("textarea");
    ta.value = "A purpose";
    bindField(ta, { mode: "input", set, commit });
    ta.dispatchEvent(new Event("focus"));
    type(ta, "Another");
    esc(ta);
    expect(ta.value).toBe("A purpose");
    expect(commit).toHaveBeenCalledTimes(2);
  });
});

describe("a field in blur mode (a deck or box title, whose rename moves a file)", () => {
  it("takes every keystroke and commits only on change", () => {
    const set = vi.fn(); const commit = vi.fn();
    const f = bindField(field("Arrival"), { mode: "blur", set, commit });
    f.dispatchEvent(new Event("focus"));
    type(f, "Arrivals");
    expect(set).toHaveBeenLastCalledWith("Arrivals");
    expect(commit).not.toHaveBeenCalled();
    f.dispatchEvent(new Event("change"));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("Esc restores without committing, and a change after it commits nothing", () => {
    const set = vi.fn(); const commit = vi.fn();
    const f = bindField(field("Arrival"), { mode: "blur", set, commit });
    f.dispatchEvent(new Event("focus"));
    type(f, "Departures");
    esc(f);
    expect(f.value).toBe("Arrival");
    expect(set).toHaveBeenLastCalledWith("Arrival");
    f.dispatchEvent(new Event("change"));
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("the small controls", () => {
  it("an identifier field has no spell-check; prose keeps it", () => {
    expect(inputField("", "insp-input insp-mono", { mode: "input", set: vi.fn(), commit: vi.fn() }).spellcheck).toBe(false);
    expect(inputField("", "insp-input outcome-title", { mode: "input", set: vi.fn(), commit: vi.fn() }).spellcheck).not.toBe(false);
  });

  it("a segmented control lights its choice, and a click on the lit one does nothing", () => {
    const a = vi.fn(); const b = vi.fn();
    const seg = segmented([{ label: "a play", on: true, pick: a }, { label: "seconds", on: false, pick: b }]);
    const [first, second] = [...seg.querySelectorAll<HTMLButtonElement>(".seg-opt")];
    expect(first!.classList.contains("on")).toBe(true);
    first!.click(); second!.click();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("an option select offers its none choice first, selects the current value, and reports a change", () => {
    const changed = vi.fn();
    const sel = optionSelect(["docks", "market"], "market", changed, { none: "(any)" });
    expect([...sel.options].map((o) => o.textContent)).toEqual(["(any)", "docks", "market"]);
    expect(sel.value).toBe("market");
    sel.value = "docks";
    sel.dispatchEvent(new Event("change"));
    expect(changed).toHaveBeenCalledWith("docks");
  });
});
