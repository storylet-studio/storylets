// @vitest-environment jsdom
// A document's tab bar (inspector.ts docTabs): picking a tab redraws the page,
// so focus is put back on the new bar's tab, and the arrows move along it (the
// hands-on review, 2026-10, foundation 8: focus fell to the top of the window).

import { describe, expect, it } from "vitest";
import { docTabs, recountDocTabs } from "./inspector.js";

const specs = [{ key: "dealing", label: "Dealing" }, { key: "outcomes", label: "Outcomes", count: 2 }, { key: "fields", label: "Fields", count: 0 }];

function page(): { active: () => string } {
  let active = "dealing";
  const draw = (): void => {
    document.body.replaceChildren(docTabs(specs, active, (key) => { active = key; draw(); }));
  };
  draw();
  return { active: () => active };
}

const tab = (key: string): HTMLElement => document.querySelector<HTMLElement>(`[data-tab="${key}"]`)!;

describe("docTabs", () => {
  it("keeps focus on the picked tab when the page redraws", () => {
    page();
    tab("dealing").focus();
    tab("outcomes").click();
    expect(document.activeElement).toBe(tab("outcomes"));
    expect(tab("outcomes").getAttribute("aria-selected")).toBe("true");
  });

  it("moves along the bar with the arrows, wrapping, and is one tab stop", () => {
    const p = page();
    expect(specs.map((s) => tab(s.key).tabIndex)).toEqual([0, -1, -1]);
    tab("dealing").focus();
    tab("dealing").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(p.active()).toBe("fields");
    expect(document.activeElement).toBe(tab("fields"));
    tab("fields").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(p.active()).toBe("dealing");
  });

  it("brings its counts up to date in place when a save lands on a page being edited", () => {
    let fields = 0;
    const specsNow = () => specs.map((s) => (s.key === "fields" ? { ...s, count: fields } : s));
    const bar = docTabs(specsNow(), "dealing", () => {}, specsNow);
    document.body.replaceChildren(bar);
    expect(tab("fields").classList.contains("zero")).toBe(true);
    fields = 2;
    recountDocTabs();
    expect(tab("fields").querySelector(".doc-tab-n")!.textContent).toBe("2");
    expect(tab("fields").classList.contains("zero")).toBe(false);
    expect(document.body.firstElementChild).toBe(bar);
  });
});
