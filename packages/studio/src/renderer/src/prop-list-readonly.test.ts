// @vitest-environment jsdom
// The Read-only switch on the @world list: `writable: false` is the story's
// promise not to write a value the game owns (Reboot.md 10). The switch is
// offered on the world list and nowhere else, and it round-trips the flag.
import { describe, expect, it } from "vitest";
import { mountPropertyList } from "./prop-list.js";

const checkbox = (host: HTMLElement): HTMLInputElement | null =>
  [...host.querySelectorAll<HTMLLabelElement>("label")]
    .find((l) => l.textContent?.includes("Read-only"))?.querySelector("input") ?? null;

describe("the Read-only switch", () => {
  it("is offered on the @world list, and sets or deletes writable", () => {
    const host = document.createElement("div"); document.body.append(host);
    const decls = [{ name: "clock", type: "number", default: "0" }] as { name: string; type: string; default: string; writable?: boolean }[];
    let changes = 0;
    mountPropertyList(host, decls, { readOnlySwitch: true, onChange: () => changes++ });
    const ro = checkbox(host);
    expect(ro, "a Read-only checkbox on the world list").not.toBeNull();
    expect(ro!.checked).toBe(false);
    ro!.checked = true; ro!.dispatchEvent(new Event("change"));
    expect(decls[0]!.writable).toBe(false);
    ro!.checked = false; ro!.dispatchEvent(new Event("change"));
    expect("writable" in decls[0]!, "unticking deletes the key rather than writing true").toBe(false);
    expect(changes).toBe(2);
  });

  it("shows the flag's current state, and is absent from every other list", () => {
    const world = document.createElement("div"); document.body.append(world);
    mountPropertyList(world, [{ name: "clock", type: "number", default: "0", writable: false }], { readOnlySwitch: true });
    expect(checkbox(world)!.checked).toBe(true);
    const story = document.createElement("div"); document.body.append(story);
    mountPropertyList(story, [{ name: "turns", type: "number", default: "0" }]);
    expect(checkbox(story)).toBeNull();
  });
});
