// @vitest-environment jsdom
// "Go to definition" lands on the ROW, not only on the page (reported
// 2026-09-14). The landing itself is app-shell's revealRow; what this app owes
// it is that every declaration row carries its name, which is what this pins,
// plus one landing through the real list to prove the two meet.
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealRow } from "@wildwinter/app-shell";
import { mountPropertyList } from "./prop-list.js";
import type { PropertyDeclDto } from "../../shared/api.js";

const mount = (decls: PropertyDeclDto[]): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  mountPropertyList(host, decls, {});
  return host;
};

const decls = (): PropertyDeclDto[] => [
  { name: "gold", type: "number", default: "0" },
  { name: "mood", type: "enum", default: "calm", values: ["calm", "tense"] },
];

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("a declaration list and the jump", () => {
  it("every row carries its declaration's name", () => {
    const host = mount(decls());
    expect([...host.querySelectorAll<HTMLElement>(".set-row")].map((r) => r.dataset.name)).toEqual(["gold", "mood"]);
  });

  it("revealRow lands on an enum's row and opens its values", () => {
    const host = mount(decls());
    Element.prototype.scrollIntoView = vi.fn();
    expect(revealRow(host, "mood")).toBe(true);
    const row = [...host.querySelectorAll<HTMLElement>(".set-row")].find((r) => r.dataset.name === "mood")!;
    expect(row.classList.contains("landed")).toBe(true);
    expect(row.querySelector(".set-expand")?.getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toContain("Values");
  });
});
