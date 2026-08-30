// @vitest-environment jsdom
// A coverage-driver ref points AT a declared @world property, so it takes a different rule from the
// declaration list beside it: case is fine, because expressions fold every reference, but a name
// nothing declares is refused. Declare-then-reference.
//
// Patterpad holds the same test over its own driver rows. The cost of getting this wrong is quiet,
// which is why it blocks: a driver aimed at a property that does not exist feeds a value nobody
// reads, and the cards gated on it are reported as never dealt.

import { describe, expect, it } from "vitest";
import { mountDriverList } from "./driver-list.js";

const mount = (declared: string[] = ["danger", "phase"]) => {
  const host = document.createElement("div");
  const known = [...declared];
  const handle = mountDriverList(host, [{ ref: "@world.danger", kind: "recurring", values: [1, 2] }], {
    knownWorldProperties: () => known,
  });
  const field = host.querySelector<HTMLInputElement>("input.set-name")!;
  return { host, handle, field, rename: (from: string, to: string) => { known[known.indexOf(from)] = to; } };
};
const type = (input: HTMLInputElement, text: string): void => {
  input.value = text;
  input.dispatchEvent(new Event("input"));
};

describe("a coverage-driver ref", () => {
  it("accepts a declared name in any case", () => {
    const { field } = mount();
    type(field, "phase");
    expect(field.classList.contains("illegal")).toBe(false);
    type(field, "PHASE");
    expect(field.classList.contains("illegal")).toBe(false);
  });

  it("refuses a name nothing declares, and blocks Save", () => {
    const { handle, field } = mount();
    type(field, "dangr");
    expect(field.classList.contains("illegal")).toBe(true);
    expect(field.title).toContain('Did you mean "danger"');
    expect(handle.firstInvalid?.()).toBe(field);
  });

  it("refuses a name no declaration could ever have", () => {
    const { field } = mount();
    type(field, "is-night");
    expect(field.title).toMatch(/subtraction/);
  });

  it("says so plainly when nothing is declared yet", () => {
    const { field } = mount([]);
    type(field, "danger");
    expect(field.title).toContain("No @world properties are declared yet");
  });

  it("offers the declared names as a datalist", () => {
    const { host, field } = mount();
    const list = host.querySelector(`datalist#${field.getAttribute("list")}`);
    expect([...list!.querySelectorAll("option")].map((o) => o.value)).toEqual(["danger", "phase"]);
  });
});
