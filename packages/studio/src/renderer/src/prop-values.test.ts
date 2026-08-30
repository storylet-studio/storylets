// @vitest-environment jsdom
// The same fault Patterpad reported as patterkit/patter#44, checked on this side: a caption wrapping
// a values editor forwarded clicks to the first chip's remove button, so clicking a value anywhere
// but its own ✕ deleted the FIRST value in the list. Never reported here, and just as present.
//
// The rule now lives in the shell's `labelled` (0.32.0); this holds THIS app's editor to it, since
// that is where a user meets it.

import { describe, expect, it } from "vitest";
import { mountPropertyList } from "./prop-list.js";

describe("declared list values (patterkit/patter#44)", () => {
  it("clicking a value's text removes nothing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const decls = [{ name: "mood", type: "enum", default: "", values: ["calm", "tense", "furious"] }];
    const handle = mountPropertyList(host, decls);

    const chip = host.querySelector(".shell-tag");
    expect(chip, "the values editor should be showing chips").not.toBeNull();
    chip!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(decls[0]!.values).toEqual(["calm", "tense", "furious"]);
    expect(handle.firstInvalid?.() ?? null).toBeNull();
    host.remove();
  });

  it("clicking a value's ✕ still removes that value", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const decls = [{ name: "mood", type: "enum", default: "", values: ["calm", "tense", "furious"] }];
    mountPropertyList(host, decls);

    const chips = [...host.querySelectorAll<HTMLElement>(".shell-tag")];
    chips[1]!.querySelector<HTMLElement>(".shell-tag-x")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(decls[0]!.values).toEqual(["calm", "furious"]);
    host.remove();
  });
});
