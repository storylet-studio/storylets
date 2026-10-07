// @vitest-environment jsdom
// The comment tool, shared by the node canvas and the map (comment-markers.ts
// `createCommentTool`). What is pinned is what an author sees: a click drops a
// marker and opens a composer, a click ON something files the comment against
// it with the marker's place kept as an offset, and "on" a pin means on its dot,
// which keeps its size on screen, rather than on its box (finding 23).

import { describe, expect, it, vi } from "vitest";
import { createCommentTool } from "./comment-markers.js";
import type { CanvasSurface, CanvasTool } from "./canvas-surface.js";
import type { CanvasTokens } from "./canvas-tokens.js";

type Item = { id: string; x: number; y: number; width: number; height: number; discRadius?: number; kind: string };

function rig(scale: number) {
  let tool: CanvasTool | undefined;
  const surface = {
    setMarkers: vi.fn(),
    setTool: vi.fn((t: CanvasTool | undefined) => { tool = t; }),
    scale: () => scale,
    toScreen: (p: { x: number; y: number }) => p,
    centreAt: vi.fn(),
  } as unknown as CanvasSurface<Item>;
  const items: Item[] = [
    { id: "c_inn", kind: "card", x: 0, y: 0, width: 190, height: 76 },
    { id: "h_well", kind: "site", x: 291, y: 91, width: 18, height: 18, discRadius: 9 },
    { id: "r_act", kind: "frame", x: -50, y: -50, width: 600, height: 400 },
  ];
  const startThread = vi.fn();
  const changed = vi.fn();
  const host = document.createElement("div");
  const comments = createCommentTool<Item>({
    surface, host, items: () => items, carries: (i) => i.kind !== "frame",
    markers: () => [{ id: "cmt_1", x: 10, y: 5, item: "c_inn", open: 1, gist: "Why?", author: "Ada" }],
    openThread: vi.fn(), startThread, moveMarker: vi.fn(),
    tokens: () => ({}) as CanvasTokens, changed,
  });
  return { comments, click: (x: number, y: number) => tool!.onClick({ x, y }), startThread, changed, surface, host };
}

describe("dropping a comment", () => {
  it("arms and disarms, telling the strip each time", () => {
    const { comments, changed } = rig(1);
    comments.arm();
    expect(comments.armed()).toBe(true);
    comments.disarm();
    expect(comments.armed()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("files it against a card with its place as an offset from the card", () => {
    const { comments, click, startThread } = rig(1);
    comments.arm();
    click(40, 30);
    expect(startThread.mock.calls[0]![0]).toEqual({ x: 40, y: 30 });
    expect(startThread.mock.calls[0]![1]).toBe("c_inn");
    expect(comments.armed()).toBe(false);
  });

  it("puts it on the canvas when it lands beside a pin's dot, inside its box", () => {
    const { comments, click, startThread } = rig(1);
    comments.arm();
    click(307, 107);                      // the box's corner, off the 9-pixel disc
    expect(startThread.mock.calls[0]![1]).toBeUndefined();
    expect(startThread.mock.calls[0]![0]).toEqual({ x: 307, y: 107 });
  });

  it("files it against the pin when the dot, larger at this zoom, is under it", () => {
    const { comments, click, startThread } = rig(0.5);
    comments.arm();
    click(307, 107);
    expect(startThread.mock.calls[0]![1]).toBe("h_well");
    expect(startThread.mock.calls[0]![0]).toEqual({ x: 16, y: 16 });
  });

  it("never files one against a frame, which only describes the canvas", () => {
    const { comments, click, startThread } = rig(1);
    comments.arm();
    click(400, 300);
    expect(startThread.mock.calls[0]![1]).toBeUndefined();
  });
});

describe("opening a marker from the feedback walk", () => {
  it("centres on the marker's point, its item's origin plus the offset", () => {
    const { comments, surface } = rig(1);
    expect(comments.open("cmt_1")).toBe(true);
    expect(surface.centreAt).toHaveBeenCalledWith({ x: 10, y: 5 });
    expect(comments.open("cmt_unknown")).toBe(false);
  });
});
