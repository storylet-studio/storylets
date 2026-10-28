// @vitest-environment jsdom
// The keyboard's way round the editor (the hands-on review, 2026-10, foundation
// 8): the navigator is a tree with arrow keys and one tab stop, a deck's table
// is one tab stop whose arrows move the selection, the view switch and Group by
// strips take the arrows like the document tab bar, the right-click menus open
// from the ContextMenu key and Shift+F10, and closing a picker gives the focus
// back to whatever opened it, even when the pick redrew the page.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openContextMenu } from "@wildwinter/app-shell/context-menu";
import { navId, renderDeckCentre, renderNav } from "./views.js";
import type { Focus, ViewActions } from "./views.js";
import { resetDocTabMemory } from "./inspector.js";
import { menuKeyDown } from "./menu-key.js";
import { watchFocusReturn } from "./focus-return.js";
import { canvasKey } from "./canvas-input.js";
import { stepTo } from "./canvas-geometry.js";
import type { BoxDto, CardDto, DeckDto, ProjectDto, ViewMode } from "../../shared/api.js";

const card = (id: string, title: string): CardDto => ({
  id, gameId: id, title, purpose: "", condition: "", priority: 0, redraw: "",
  tags: [], sharedCopies: "", fields: [], outcomes: [],
});
const deck: DeckDto = { id: "k_1", gameId: "docks", title: "Docks", properties: [], cards: [card("c_1", "Ambush"), card("c_2", "Bargain"), card("c_3", "Crossing")] };
const box: BoxDto = {
  id: "b_1", gameId: "box", folder: "box", ranking: { specificity: true }, fields: [], outcomeFields: [], properties: [],
  decks: [deck], templates: [], tagGroups: [], hands: [],
};
const project: ProjectDto = { dir: "/p", name: "Saltmarsh", threads: {}, storyPropertyCount: 0, play: "venue", boxes: [box] };

const stubActions = (over: Partial<ViewActions> = {}): ViewActions => ({
  openThreads: () => 0, showComments: vi.fn(), focus: vi.fn(), toggleNav: vi.fn(), openProjectSettings: vi.fn(), revealProject: vi.fn(), inspectCard: vi.fn(), inspectTemplate: vi.fn(), inspectTagGroup: vi.fn(), inspectHand: vi.fn(), openHand: vi.fn(),
  newCard: vi.fn(), newDeck: vi.fn(), newBox: vi.fn(), newTemplate: vi.fn(), newTagGroup: vi.fn(), newMap: vi.fn(), newHand: vi.fn(), editBox: vi.fn(), saveDeck: vi.fn(), saveBox: vi.fn(), saveDeckLater: vi.fn(), saveBoxLater: vi.fn(),
  duplicateBox: vi.fn(), deleteBox: vi.fn(), moveBox: vi.fn(), moveDeck: vi.fn(), moveHand: vi.fn(),
  duplicateCard: vi.fn(), moveCardToDeck: vi.fn(), deleteCard: vi.fn(), showLinks: vi.fn(), selectCard: vi.fn(), setViewMode: vi.fn(), mountNodeView: vi.fn(), mountBoxSites: vi.fn(), openMap: vi.fn(), useProjectMap: vi.fn(), cardGroup: () => undefined, setCardGroup: vi.fn(), deckCatalogue: () => [], moveCard: vi.fn(),
  duplicateDeck: vi.fn(), deleteDeck: vi.fn(), duplicateTemplate: vi.fn(), deleteTemplate: vi.fn(),
  duplicateHand: vi.fn(), deleteHand: vi.fn(), duplicateTagGroup: vi.fn(), deleteTagGroup: vi.fn(), ...over,
});

const press = (target: Element, key: string, mods: { shiftKey?: boolean } = {}): KeyboardEvent => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(e);
  return e;
};
const active = (): HTMLElement => document.activeElement as HTMLElement;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => { document.body.replaceChildren(); resetDocTabMemory(); });

describe("the navigator's tree", () => {
  /** A navigator whose toggle redraws it, as the app's does. */
  function navigator(focus?: Focus): { host: HTMLElement; row: (key: string) => HTMLElement; actions: ViewActions } {
    const host = document.body.appendChild(document.createElement("nav"));
    const expanded = new Set<string>();
    const draw = (): void => renderNav(host, project, focus, expanded, actions);
    const actions = stubActions({ toggleNav: (id) => { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); draw(); } });
    draw();
    return { host, actions, row: (key) => host.querySelector<HTMLElement>(`[data-nav-key="${key}"]`)! };
  }

  it("is one tab stop, on the open document's row", () => {
    const { host, row } = navigator({ kind: "story" });
    const stops = [...host.querySelectorAll<HTMLElement>("[role=treeitem]")].filter((r) => r.tabIndex === 0);
    expect(stops).toEqual([row("story")]);
    expect(host.getAttribute("role")).toBe("tree");
  });

  it("steps through the rows with Up and Down", () => {
    const { row } = navigator();
    row("project").focus();
    press(row("project"), "ArrowDown");
    expect(active()).toBe(row("story"));
    press(row("story"), "ArrowDown");
    expect(active()).toBe(row(navId.box("b_1")));
    press(row(navId.box("b_1")), "ArrowUp");
    expect(active()).toBe(row("story"));
    expect(row("story").tabIndex).toBe(0);
    expect(row("project").tabIndex).toBe(-1);
  });

  it("opens with Right and keeps the focus on the redrawn row, then steps in", () => {
    const { row } = navigator();
    const boxKey = navId.box("b_1");
    row(boxKey).focus();
    expect(row(boxKey).getAttribute("aria-expanded")).toBe("false");
    press(row(boxKey), "ArrowRight");
    expect(row(boxKey).getAttribute("aria-expanded")).toBe("true");
    expect(active()).toBe(row(boxKey));
    press(row(boxKey), "ArrowRight");
    expect(active()).toBe(row(navId.collection("b_1", "decks")));
  });

  it("goes out to the parent with Left, and closes an open row", () => {
    const { row } = navigator();
    const boxKey = navId.box("b_1");
    row(boxKey).focus();
    press(row(boxKey), "ArrowRight");
    press(row(boxKey), "ArrowRight");
    press(active(), "ArrowLeft");
    expect(active()).toBe(row(boxKey));
    press(active(), "ArrowLeft");
    expect(row(boxKey).getAttribute("aria-expanded")).toBe("false");
    expect(active()).toBe(row(boxKey));
  });
});

describe("a deck's table", () => {
  /** The deck page in table view, redrawn on every selection as the app does. */
  function table(): { rows: () => HTMLElement[]; actions: ViewActions } {
    const host = document.body.appendChild(document.createElement("main"));
    let selected = new Set<string>();
    const draw = (): void => renderDeckCentre(host, box, deck, [], selected, "table", () => {}, actions);
    const actions = stubActions({
      selectCard: vi.fn((id: string) => { selected = new Set([id]); draw(); }),
      inspectCard: vi.fn(),
    });
    draw();
    return { actions, rows: () => [...host.querySelectorAll<HTMLElement>(".ctable tr[data-card]")] };
  }

  it("is one tab stop, and the arrows move the selection with the focus across the redraw", () => {
    const { rows, actions } = table();
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    rows()[0]!.focus();
    press(rows()[0]!, "ArrowDown");
    expect(actions.selectCard).toHaveBeenLastCalledWith("c_2", "replace");
    expect(active()).toBe(rows()[1]);
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    press(active(), "End");
    expect(active()).toBe(rows()[2]);
    press(active(), "ArrowUp", { shiftKey: true });
    expect(actions.selectCard).toHaveBeenLastCalledWith("c_2", "range");
  });

  it("opens the focused row's card with Enter, and only that card", () => {
    const { rows, actions } = table();
    const windowEnter = vi.fn();
    window.addEventListener("keydown", windowEnter);
    rows()[2]!.focus();
    press(rows()[2]!, "Enter");
    window.removeEventListener("keydown", windowEnter);
    expect(actions.inspectCard).toHaveBeenCalledWith("b_1", "k_1", "c_3");
    expect(windowEnter).not.toHaveBeenCalled();
  });
});

describe("the view switch", () => {
  it("takes the arrows, and the redrawn switch keeps the focus", () => {
    const host = document.body.appendChild(document.createElement("main"));
    let mode: ViewMode = "cards";
    const draw = (): void => renderDeckCentre(host, box, deck, [], new Set(), mode, () => {}, actions);
    const actions = stubActions({ setViewMode: vi.fn((m: ViewMode) => { mode = m; draw(); }) });
    draw();
    const on = (): HTMLElement => host.querySelector<HTMLElement>(".viewtoggle .seg-opt.on")!;
    expect([...host.querySelectorAll<HTMLElement>(".viewtoggle .seg-opt")].map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    on().focus();
    press(on(), "ArrowRight");
    expect(mode).toBe("table");
    expect(active()).toBe(on());
    press(on(), "ArrowLeft");
    press(on(), "ArrowLeft");
    expect(mode).toBe("node");
  });
});

describe("the menu key", () => {
  function row(): HTMLElement {
    const b = document.body.appendChild(document.createElement("button"));
    b.textContent = "Docks";
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, [{ label: "Duplicate", onClick: () => {} }, { label: "Delete deck", onClick: () => {} }]);
    });
    b.focus();
    return b;
  }
  const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".ctxmenu [role=menuitem]")];

  it("opens the focused thing's right-click menu with ContextMenu, its first item focused, the arrows moving through it", () => {
    const b = row();
    const e = new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true });
    b.dispatchEvent(e);
    menuKeyDown(e);
    expect(items().map((i) => i.textContent)).toEqual(["Duplicate", "Delete deck"]);
    expect(active()).toBe(items()[0]);
    const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    active().dispatchEvent(down);
    menuKeyDown(down);
    expect(active()).toBe(items()[1]);
  });

  it("opens it with Shift+F10 too, and not with a plain F10 or from a field", () => {
    const b = row();
    const plain = new KeyboardEvent("keydown", { key: "F10", bubbles: true, cancelable: true });
    b.dispatchEvent(plain);
    menuKeyDown(plain);
    expect(items()).toEqual([]);
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    const inField = new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true });
    field.dispatchEvent(inField);
    menuKeyDown(inField);
    expect(items()).toEqual([]);
    b.focus();
    const shifted = new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true });
    b.dispatchEvent(shifted);
    menuKeyDown(shifted);
    expect(items()).toHaveLength(2);
  });
});

describe("closing a picker", () => {
  const stops: (() => void)[] = [];
  afterEach(() => { while (stops.length > 0) stops.pop()!(); });

  function opener(text: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    return b;
  }

  it("gives the focus back to the control that opened it", async () => {
    stops.push(watchFocusReturn());
    const anchor = document.body.appendChild(opener("Change where"));
    anchor.focus();
    const panel = document.body.appendChild(Object.assign(document.createElement("div"), { className: "shell-anchored" }));
    const choice = panel.appendChild(opener("Docks"));
    choice.focus();
    await settle();
    panel.remove();
    await settle();
    expect(active()).toBe(anchor);
  });

  it("finds the opener again when the pick redrew the page", async () => {
    stops.push(watchFocusReturn());
    const page = document.body.appendChild(document.createElement("main"));
    page.append(opener("Card view"), opener("Change where"));
    (page.lastChild as HTMLElement).focus();
    const pop = document.body.appendChild(Object.assign(document.createElement("div"), { className: "popover" }));
    await settle();
    // The pick redraws the page: the opener is thrown away and drawn again.
    page.replaceChildren(opener("Card view"), opener("Change where"));
    pop.remove();
    await settle();
    expect(active()).toBe(page.lastChild);
  });

  it("leaves the focus where it went on purpose, and lets a waiting title claim it first", async () => {
    const title = document.body.appendChild(document.createElement("input"));
    let waiting = true;
    stops.push(watchFocusReturn({ claim: () => { if (!waiting) return false; waiting = false; title.focus(); return true; } }));
    const anchor = document.body.appendChild(opener("New box"));
    anchor.focus();
    const menu = document.body.appendChild(Object.assign(document.createElement("div"), { className: "ctxmenu" }));
    menu.appendChild(opener("Blank")).focus();
    await settle();
    menu.remove();
    await settle();
    expect(active()).toBe(title);
    // A second picker, closed by a click on something else: that keeps it.
    anchor.focus();
    const again = document.body.appendChild(Object.assign(document.createElement("div"), { className: "ctxmenu" }));
    await settle();
    const elsewhere = document.body.appendChild(opener("Elsewhere"));
    elsewhere.focus();
    again.remove();
    await settle();
    expect(active()).toBe(elsewhere);
  });
});

describe("a canvas's keys", () => {
  const idle = { tool: false, owns: true, marquee: false, selected: 1 };
  const key = (k: string, shiftKey = false) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey });

  it("steps with the arrows, opens with Enter and offers the menu with ContextMenu or Shift+F10", () => {
    expect(canvasKey(key("ArrowLeft"), idle)).toEqual({ step: "left" });
    expect(canvasKey(key("ArrowDown"), { ...idle, selected: 0 })).toEqual({ step: "down" });
    expect(canvasKey(key("Enter"), idle)).toBe("activate");
    expect(canvasKey(key("Enter"), { ...idle, selected: 2 })).toBeUndefined();
    expect(canvasKey(key("ContextMenu"), idle)).toBe("menu");
    expect(canvasKey(key("F10", true), idle)).toBe("menu");
  });

  it("leaves them to a focused control in the canvas's strip, and to whoever has the keys", () => {
    expect(canvasKey(key("Enter"), { ...idle, browse: false })).toBeUndefined();
    expect(canvasKey(key("ArrowLeft"), { ...idle, browse: false })).toBeUndefined();
    expect(canvasKey(key("ArrowLeft"), { ...idle, owns: false })).toBeUndefined();
  });

  it("steps to the nearest item that way, straight ahead first, and starts at the top left", () => {
    const at = (id: string, x: number, y: number) => ({ id, x, y, width: 100, height: 60 });
    const items = [at("a", 0, 0), at("b", 200, 0), at("c", 200, 300), at("d", 0, 100)];
    expect(stepTo(undefined, items, "right")).toBe("a");
    expect(stepTo(items[0], items, "right")).toBe("b");
    expect(stepTo(items[0], items, "down")).toBe("d");
    expect(stepTo(items[1], items, "down")).toBe("c");
    expect(stepTo(items[1], items, "right")).toBeUndefined();
  });
});
