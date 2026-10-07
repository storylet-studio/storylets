// @vitest-environment jsdom
// The strip helpers both canvases share (canvas-controls.ts): the armed strip
// for the comment and frame tools, and a strip verb in the add voice. What is
// pinned is what an author sees and what Cancel puts down.

import { describe, expect, it, vi } from "vitest";
import { sharedToolStrip, stripAddButton } from "./canvas-controls.js";

const text = (nodes: HTMLElement[]): string => nodes.map((n) => n.textContent ?? "").join("|");

describe("the shared tools' armed strip", () => {
  it("is nothing while neither tool is armed", () => {
    expect(sharedToolStrip({ armed: () => false, disarm: vi.fn() }, { hint: () => undefined, cancel: vi.fn() })).toBeUndefined();
    expect(sharedToolStrip(undefined, undefined)).toBeUndefined();
  });

  it("says where the comment goes, and Cancel puts the comment tool down", () => {
    const comments = { armed: () => true, disarm: vi.fn() };
    const furniture = { hint: () => "Click one corner of the frame", cancel: vi.fn() };
    const strip = sharedToolStrip(comments, furniture)!;
    expect(text(strip)).toBe("Click where the comment goes||Cancel");
    (strip[2] as HTMLButtonElement).click();
    expect(comments.disarm).toHaveBeenCalledOnce();
    expect(furniture.cancel).not.toHaveBeenCalled();
  });

  it("carries the frame tool's own hint, and Cancel cancels the frame", () => {
    const furniture = { hint: () => "Click the opposite corner of the frame", cancel: vi.fn() };
    const strip = sharedToolStrip({ armed: () => false, disarm: vi.fn() }, furniture)!;
    expect(text(strip)).toBe("Click the opposite corner of the frame||Cancel");
    (strip[2] as HTMLButtonElement).click();
    expect(furniture.cancel).toHaveBeenCalledOnce();
  });
});

describe("a strip verb that adds", () => {
  it("is a strip button with the plus, the word, then what it carries", () => {
    const onClick = vi.fn();
    const extra = document.createElement("i");
    const b = stripAddButton("Hand", "A new hand", onClick, extra, "Town");
    expect(b.className).toBe("stripbtn");
    expect(b.getAttribute("data-tip")).toBe("A new hand");
    expect(b.firstElementChild?.getAttribute("data-icon")).toBe("add");
    expect(b.textContent).toBe("HandTown");
    expect(b.contains(extra)).toBe(true);
    b.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
