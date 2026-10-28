// @vitest-environment jsdom
// A new @story property from an outcome's Changes asks the kind of value it
// holds, as Patterpad's does (ruled 2026-10-28): Number the default and
// focused, Text, or True or false; backing out writes nothing. The chosen
// type goes to the problems bar's Declare, and the catalogue entry answered
// carries it.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { askPropertyType, newPropertyCreator, NEW_PROPERTY_TYPES } from "./new-property.js";
import type { NewPropertyHost } from "./new-property.js";
import type { OpenResult } from "../../shared/api.js";

beforeAll(() => {
  // jsdom has the element but not the modal half of <dialog>.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});
afterEach(() => { document.body.replaceChildren(); });

const button = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>("dialog.new-prop-dialog button")].find((b) => b.textContent === label)!;

describe("the new-property question", () => {
  it("asks the kind of value, Number the default, and answers what was chosen", async () => {
    const asked = askPropertyType("gold");
    const dialog = document.querySelector<HTMLDialogElement>("dialog.new-prop-dialog")!;
    expect(dialog.textContent).toContain("New property");
    expect(dialog.textContent).toContain("What kind of value does @gold hold?");
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Cancel", "Text", "True or false", "Number"]);
    expect(document.activeElement?.textContent).toBe("Number");
    dialog.querySelector<HTMLButtonElement>('button[data-type="boolean"]')!.click();
    expect(await asked).toBe("boolean");
  });

  it("answers null when the author backs out", async () => {
    const cancelled = askPropertyType("gold");
    button("Cancel").click();
    expect(await cancelled).toBeNull();
  });

  it("offers the three plain kinds and nothing that needs its values written out", () => {
    expect(NEW_PROPERTY_TYPES.map((t) => t.type)).toEqual(["string", "boolean", "number"]);
  });
});

describe("the Changes picker's creator", () => {
  const fresh = { dir: "/p" } as unknown as OpenResult;
  const host = (over: Partial<NewPropertyHost> = {}): NewPropertyHost => ({
    declare: vi.fn(async () => fresh), reread: vi.fn(), apply: vi.fn(), adopt: vi.fn(), ...over,
  });

  it("declares the property as the type chosen, and answers an entry of that type", async () => {
    const h = host({ ask: async () => "string" });
    const entry = await newPropertyCreator(h)("mood", "story");
    expect(h.declare).toHaveBeenCalledWith("story", "mood", { type: "string" });
    expect(h.apply).toHaveBeenCalledWith(fresh);
    expect(entry).toEqual({ scope: "story", name: "mood", type: "string" });
    expect(h.adopt).toHaveBeenCalledWith(entry);
  });

  it("writes nothing and answers null when the question is cancelled", async () => {
    const h = host({ ask: async () => null });
    expect(await newPropertyCreator(h)("mood", "story")).toBeNull();
    expect(h.declare).not.toHaveBeenCalled();
    expect(h.adopt).not.toHaveBeenCalled();
  });

  it("asks through the dialog when no stand-in is given, defaulting to Number", async () => {
    const h = host();
    const made = newPropertyCreator(h)("gold", "story");
    await Promise.resolve();
    button("Number").click();
    expect(await made).toEqual({ scope: "story", name: "gold", type: "number" });
    expect(h.declare).toHaveBeenCalledWith("story", "gold", { type: "number" });
  });

  it("throws a refusal for the picker to say, and adopts nothing", async () => {
    const h = host({ ask: async () => "boolean", declare: vi.fn(async () => ({ error: "\"met\" is already declared" })) });
    await expect(newPropertyCreator(h)("met", "story")).rejects.toThrow("already declared");
    expect(h.adopt).not.toHaveBeenCalled();
    expect(h.apply).not.toHaveBeenCalled();
  });
});
