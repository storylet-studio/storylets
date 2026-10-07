// The canvas's input rules, pinned without a canvas (canvas-input.ts): who owns
// the keyboard, what each key does and in what order it is asked, and which
// cursor wins. Hand-written from what an author sees: Delete in the navigator
// must not delete cards, Cmd+F is Find and never the canvas's, and a held Space
// is the open hand whatever the pointer is over.

import { describe, expect, it } from "vitest";
import { canvasKey, cursorFor, ownsKeys } from "./canvas-input.js";

const key = (k: string, mods: { meta?: boolean; ctrl?: boolean } = {}) =>
  ({ key: k, metaKey: mods.meta === true, ctrlKey: mods.ctrl === true });
const idle = { tool: false, owns: true, marquee: false, selected: 0 };

describe("who owns the keyboard", () => {
  it("is the canvas while it has focus, wherever the pointer is", () => {
    expect(ownsKeys({ focusInside: true, pointerOver: false, nothingFocused: false })).toBe(true);
  });

  it("is the canvas with nothing focused and the pointer over it", () => {
    expect(ownsKeys({ focusInside: false, pointerOver: true, nothingFocused: true })).toBe(true);
  });

  it("is somebody else's while something else has focus, even under the pointer", () => {
    // The navigator holds focus and the pointer rests on the canvas: Delete
    // belongs to the navigator.
    expect(ownsKeys({ focusInside: false, pointerOver: true, nothingFocused: false })).toBe(false);
  });

  it("is nobody's on the canvas's side with nothing focused and the pointer away", () => {
    expect(ownsKeys({ focusInside: false, pointerOver: false, nothingFocused: true })).toBe(false);
  });
});

describe("what a key does", () => {
  it("lets an armed tool take Enter and Escape even when the canvas does not own the keys", () => {
    const armed = { ...idle, tool: true, owns: false };
    expect(canvasKey(key("Enter"), armed)).toBe("commitTool");
    expect(canvasKey(key("Escape"), armed)).toBe("cancelTool");
    expect(canvasKey(key("Delete"), { ...armed, selected: 2 })).toBeUndefined();
  });

  it("takes nothing else while the keys are somebody else's", () => {
    const away = { ...idle, owns: false, selected: 3 };
    for (const k of [key("Delete"), key("a", { meta: true }), key("Home"), key("f"), key(" ")]) {
      expect(canvasKey(k, away)).toBeUndefined();
    }
  });

  it("deletes with Delete or Backspace only when something is selected", () => {
    expect(canvasKey(key("Delete"), { ...idle, selected: 1 })).toBe("delete");
    expect(canvasKey(key("Backspace"), { ...idle, selected: 1 })).toBe("delete");
    expect(canvasKey(key("Delete"), idle)).toBeUndefined();
  });

  it("spends Escape on the marquee first, then the selection, and otherwise leaves it", () => {
    expect(canvasKey(key("Escape"), { ...idle, marquee: true, selected: 2 })).toBe("dropMarquee");
    expect(canvasKey(key("Escape"), { ...idle, selected: 2 })).toBe("clearSelection");
    expect(canvasKey(key("Escape"), idle)).toBeUndefined();
  });

  it("holds Space rather than passing it on as a letter", () => {
    expect(canvasKey(key(" "), idle)).toBe("holdSpace");
  });

  it("reads the command key or Ctrl alike for the zoom and select-all keys", () => {
    expect(canvasKey(key("a", { meta: true }), idle)).toBe("selectAll");
    expect(canvasKey(key("A", { ctrl: true }), idle)).toBe("selectAll");
    expect(canvasKey(key("0", { meta: true }), idle)).toBe("actualSize");
    expect(canvasKey(key("=", { meta: true }), idle)).toBe("zoomIn");
    expect(canvasKey(key("+", { ctrl: true }), idle)).toBe("zoomIn");
    expect(canvasKey(key("-", { meta: true }), idle)).toBe("zoomOut");
  });

  it("frames on plain F and Home, and never on Cmd+F, which is Find", () => {
    expect(canvasKey(key("f"), idle)).toBe("showSelection");
    expect(canvasKey(key("F"), idle)).toBe("showSelection");
    expect(canvasKey(key("Home"), idle)).toBe("fitAll");
    expect(canvasKey(key("f", { meta: true }), idle)).toBeUndefined();
  });

  it("hands any other plain letter to the caller, lowercased", () => {
    expect(canvasKey(key("N"), idle)).toEqual({ letter: "n" });
    expect(canvasKey(key("n", { meta: true }), idle)).toBeUndefined();
    expect(canvasKey(key("ArrowLeft"), idle)).toBeUndefined();
  });
});

describe("which cursor shows", () => {
  const none = { panning: false, spaceHeld: false, draggingItem: false };

  it("is the closed hand while panning, over everything else", () => {
    expect(cursorFor({ ...none, panning: true, spaceHeld: true, over: "move", tool: "crosshair" })).toBe("grabbing");
  });

  it("is the open hand while Space is held, whatever the pointer is over", () => {
    expect(cursorFor({ ...none, spaceHeld: true, over: "move", tool: "crosshair" })).toBe("grab");
  });

  it("is the closed hand while an item is dragged", () => {
    expect(cursorFor({ ...none, draggingItem: true, over: "grab" })).toBe("grabbing");
  });

  it("prefers what the pointer is over to the armed tool's own, and falls back to nothing", () => {
    expect(cursorFor({ ...none, over: "pointer", tool: "crosshair" })).toBe("pointer");
    expect(cursorFor({ ...none, tool: "crosshair" })).toBe("crosshair");
    expect(cursorFor(none)).toBe("");
  });
});
