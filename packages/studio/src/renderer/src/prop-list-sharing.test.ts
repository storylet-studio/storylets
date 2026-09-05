// @vitest-environment jsdom
// The two axes on a declaration: Shared (design/flows.md) and Durable
// (design/engine-server.md 4.2). Both are governed by the play ladder, both
// write the flag only where it says something the scope's own default does
// not, and neither is offered on @world, where each is a compile error.
import { afterEach, describe, expect, it } from "vitest";
import { mountPropertyList } from "./prop-list.js";
import { setPlayRung } from "./play-ladder.js";
import type { PropertyDeclDto } from "../../shared/api.js";

const box = (host: HTMLElement, label: string): HTMLInputElement | null =>
  [...host.querySelectorAll<HTMLLabelElement>("label")]
    .find((l) => l.textContent?.includes(label))?.querySelector("input") ?? null;

const mount = (decls: PropertyDeclDto[], opts = {}): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  mountPropertyList(host, decls, opts);
  return host;
};

afterEach(() => setPlayRung("solo"));

describe("Shared and Durable on a declaration", () => {
  it("a solo project shows neither, and a shared one shows only Shared", () => {
    setPlayRung("solo");
    const solo = mount([{ name: "gold", type: "number", default: "0" }]);
    expect(box(solo, "Shared")).toBeNull();
    expect(box(solo, "Durable")).toBeNull();

    setPlayRung("shared");
    const world = mount([{ name: "gold", type: "number", default: "0" }]);
    expect(box(world, "Shared")).not.toBeNull();
    expect(box(world, "Durable")).toBeNull();
  });

  it("writes the flag only where it differs from the scope's own default", () => {
    setPlayRung("venue");
    // A box / deck / hand / tag list: per-flow unless it says otherwise.
    const decls: PropertyDeclDto[] = [{ name: "heat", type: "number", default: "0" }];
    const host = mount(decls);
    const shared = box(host, "Shared")!;
    expect(shared.checked).toBe(false);
    shared.checked = true; shared.dispatchEvent(new Event("change"));
    expect(decls[0]!.shared).toBe(true);
    shared.checked = false; shared.dispatchEvent(new Event("change"));
    expect("shared" in decls[0]!, "back to the default deletes the key").toBe(false);

    // The @story list is shared by default, so the flag runs the other way.
    const story: PropertyDeclDto[] = [{ name: "gold", type: "number", default: "0" }];
    const storyHost = mount(story, { sharedByDefault: true });
    const storyShared = box(storyHost, "Shared")!;
    expect(storyShared.checked, "@story is shared unless it says otherwise").toBe(true);
    storyShared.checked = false; storyShared.dispatchEvent(new Event("change"));
    expect(story[0]!.shared).toBe(false);
  });

  it("Durable is never a scope default: ticking writes it, unticking deletes it", () => {
    setPlayRung("venue");
    const decls: PropertyDeclDto[] = [{ name: "visits", type: "number", default: "0" }];
    const host = mount(decls);
    const durable = box(host, "Durable")!;
    expect(durable.checked).toBe(false);
    durable.checked = true; durable.dispatchEvent(new Event("change"));
    expect(decls[0]!.durable).toBe(true);
    durable.checked = false; durable.dispatchEvent(new Event("change"));
    expect("durable" in decls[0]!).toBe(false);
  });

  it("a declaration already durable keeps its switch below the rung that offers it", () => {
    // Venue is the Storylet Server's to set, so "remove the flag" is the only
    // way out the compiler can name, and it needs a control to be removed with.
    setPlayRung("solo");
    const host = mount([{ name: "visits", type: "number", default: "0", durable: true }]);
    expect(box(host, "Durable")).not.toBeNull();
    expect(box(host, "Shared"), "sharing still hides: moving up a rung is offered").toBeNull();
  });

  it("neither is offered where the list says they do not apply (@world, card fields)", () => {
    setPlayRung("venue");
    const host = mount([{ name: "clock", type: "number", default: "0" }],
      { readOnlySwitch: true, sharingSwitches: false });
    expect(box(host, "Shared")).toBeNull();
    expect(box(host, "Durable")).toBeNull();
    expect(box(host, "Read-only"), "the world list keeps its own switch").not.toBeNull();
  });
});
