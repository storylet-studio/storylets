// @vitest-environment jsdom
// The manners of a property-name field, which are the gameId editor's on purpose
// (app-shell id-editor.ts): an illegal name is REFUSED and marked, never quietly
// rewritten, and Tab coerces it in the field where it can be seen and undone.
//
// Patterpad holds the same test against the same rule (settings-case.test.ts). The
// rule itself is @storylet-studio/model's, which is app-shell 0.29.0's default; the
// faults below are what `@wildwinter/expr` does with each name, not house style.

import { describe, expect, it } from "vitest";
import { mountPropertyList } from "./prop-list.js";

const mount = () => {
  const host = document.createElement("div");
  const handle = mountPropertyList(host, [{ name: "gold", type: "number", default: "" }]);
  const field = host.querySelector<HTMLInputElement>("input.set-name");
  if (!field) throw new Error("no name field");
  return { host, handle, field };
};
const type = (input: HTMLInputElement, text: string): void => {
  input.value = text;
  input.dispatchEvent(new Event("input"));
};
const tab = (input: HTMLInputElement): void => {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
};

describe("a property name field refuses rather than rewrites", () => {
  it("keeps what was typed, marks it, and says which fault it is", () => {
    const { handle, field } = mount();

    type(field, "isNight");
    expect(field.value).toBe("isNight");                    // untouched
    expect(field.classList.contains("illegal")).toBe(true);
    expect(field.title).toMatch(/fold/);
    expect(handle.firstInvalid?.()).toBe(field);              // and Save is blocked

    type(field, "is-night");
    expect(field.title).toMatch(/subtraction/);             // the silent one, named

    type(field, "9lives");
    expect(field.title).toMatch(/digit/);

    type(field, "not");
    expect(field.title).toMatch(/keyword/);
  });

  it("coerces on Tab, in the field, and clears the marking", () => {
    const { handle, field } = mount();

    type(field, "Is Night!");
    tab(field);

    expect(field.value).toBe("is_night");
    expect(field.classList.contains("illegal")).toBe(false);
    expect(handle.firstInvalid?.()).toBeNull();
  });

  it("leaves a legal name alone, including a leading underscore", () => {
    const { field } = mount();
    for (const name of ["gold_pieces", "_private", "a1"]) {
      type(field, name);
      expect(field.classList.contains("illegal"), name).toBe(false);
    }
  });
});
