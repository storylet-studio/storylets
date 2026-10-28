// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Focus that lands (app-shell 0.71.0, the hands-on review of 2026-10):
//
//   - Cmd+1 on an open navigator moves the focus to its current row, its one
//     tab stop, and closes it only when the focus is already inside;
//   - a closing navigator, and a dialog whose opener has gone, give the focus
//     to the centre's working area (the document's title, else the first
//     control below the trail), never to <body>;
//   - a dialog gives the focus back to its opener when a redraw has replaced
//     it, found again by its look.
// ---------------------------------------------------------------------------

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { dialogFrame, el, mountPaneShell, setDialogFocusFallback } from "@wildwinter/app-shell";
import { centreHome, navFocusTarget } from "./pane-focus.js";
import { returnToOpener, watchFocusReturn } from "./focus-return.js";
import type { FocusReturnWatch } from "./focus-return.js";
import { refusalDialog } from "./refusal-dialog.js";

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const button = (text: string, attrs: Record<string, string> = {}): HTMLButtonElement => {
  const b = el("button", { text });
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
};
/** A navigator tree as views.ts draws it: rows with a roving tab stop. */
function tree(current: string): HTMLElement {
  const host = el("div");
  host.append(button("New box"));
  for (const name of ["Project", "Story", "Docks"]) {
    const row = button(name, { role: "treeitem", "aria-level": "1" });
    row.tabIndex = name === current ? 0 : -1;
    host.append(row);
  }
  return host;
}
/** A centre as the card page draws it: the trail, then the document. */
function centre(withTitle: boolean): HTMLElement {
  const host = el("div");
  const crumbs = el("div", { className: "crumbs" }, button("Back to Docks"));
  const editor = el("div", { className: "centre-editor" });
  if (withTitle) editor.append(Object.assign(el("input", { className: "doc-title" }), { value: "Ambush" }));
  editor.append(button("Add outcome"));
  host.append(crumbs, editor);
  return host;
}

// jsdom has <dialog> but not its modal methods: supplied, as the other dialog tests do.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto["showModal"] !== "function") {
    proto["showModal"] = function (this: HTMLDialogElement) { this.open = true; };
  }
  if (typeof proto["close"] !== "function") {
    proto["close"] = function (this: HTMLDialogElement) { this.open = false; };
  }
});

let watches: FocusReturnWatch[] = [];
afterEach(() => {
  for (const w of watches) w();
  watches = [];
  setDialogFocusFallback(null);
  document.body.replaceChildren();
});

describe("where the keyboard lands in a pane", () => {
  it("the navigator's current row, not its first control", () => {
    const nav = document.body.appendChild(tree("Story"));
    expect(navFocusTarget(nav)?.textContent).toBe("Story");
    expect(navFocusTarget(el("div"))).toBeUndefined();
  });

  it("the centre's document title, else the first control below the trail", () => {
    document.body.append(centre(true));
    expect(centreHome(document.body.firstElementChild as HTMLElement)?.className).toBe("doc-title");
    document.body.replaceChildren(centre(false));
    expect(centreHome(document.body.firstElementChild as HTMLElement)?.textContent).toBe("Add outcome");
  });

  it("Cmd+1 moves into an open navigator, onto its row, and closes it only from inside", () => {
    const shell = mountPaneShell(el("div"), {
      nav: { defaultWidth: "224px", label: "navigator" },
      inspector: { defaultWidth: "384px", label: "inspector", offered: false },
      initial: { open: { nav: true, inspector: false } },
      focusTarget: { nav: () => navFocusTarget(shell.nav) },
      focusHome: () => centreHome(shell.centre),
    });
    document.body.append(shell.root);
    shell.nav.append(tree("Docks"));
    shell.centre.append(centre(true));
    const title = shell.centre.querySelector<HTMLInputElement>(".doc-title")!;
    title.focus();

    shell.focusOrToggle("nav");
    expect(shell.isOpen("nav")).toBe(true);
    expect(document.activeElement?.textContent).toBe("Docks");

    shell.focusOrToggle("nav");
    expect(shell.isOpen("nav")).toBe(false);
    expect(document.activeElement).toBe(title);
  });
});

describe("the focus after a dialog", () => {
  it("goes to the centre's working area when the opener has gone (the fallback)", async () => {
    const page = document.body.appendChild(centre(true));
    const opener = page.querySelector<HTMLButtonElement>(".centre-editor button")!;
    opener.focus();
    const frame = dialogFrame({ title: "Something" });
    frame.open();
    page.querySelector(".centre-editor")!.replaceChildren(Object.assign(el("input", { className: "doc-title" }), { value: "Ambush" }));
    setDialogFocusFallback(() => centreHome(page));
    frame.close();
    await settle();
    expect(document.activeElement?.className).toBe("doc-title");
  });

  it("finds the opener again when a redraw replaced it (returnToOpener)", () => {
    const page = document.body.appendChild(el("main"));
    page.append(button("Card view"), button("Use the project map"));
    (page.lastChild as HTMLElement).focus();
    const back = returnToOpener();
    page.replaceChildren(button("Card view"), button("Use the project map"));
    expect(back()).toBe(page.lastChild);
  });

  it("the watcher names the open dialog's opener, redrawn or not, for the fallback", async () => {
    const watch = watchFocusReturn();
    watches.push(watch);
    const page = document.body.appendChild(el("main"));
    page.append(button("Leave the project map"));
    (page.firstChild as HTMLElement).focus();
    const frame = dialogFrame({ title: "Something" });
    frame.open();
    await settle();
    page.replaceChildren(button("Leave the project map"));
    expect(watch.opener()).toBe(page.firstChild);
    frame.close();
  });

  it("a refusal gives the focus back to the control that asked, redrawn while it was up", async () => {
    const page = document.body.appendChild(el("main"));
    page.append(button("Use the project map"));
    (page.firstChild as HTMLElement).focus();
    const answer = refusalDialog({ title: "News can't leave the map", body: "Its hand is in a zone." });
    await settle();
    page.replaceChildren(button("Use the project map"));
    document.querySelector<HTMLButtonElement>("dialog .btn")!.click();
    expect(await answer).toBe(false);
    await settle();
    expect(document.activeElement).toBe(page.firstChild);
  });
});
