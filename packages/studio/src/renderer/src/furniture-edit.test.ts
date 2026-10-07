// @vitest-environment jsdom
// Frames, as gestures (furniture-edit.ts). Two promises from the October 2026
// review: a frame that may not be changed (a map being read, an arrangement
// this key may not write) is not renamed or removed from the canvas, and a name
// half typed when the view goes is kept rather than lost.

import { describe, expect, it, vi } from "vitest";
import { createFurniture } from "./furniture-edit.js";
import type { CanvasItem, CanvasSurface } from "./canvas-surface.js";
import type { CanvasFurnitureDto } from "../../shared/api.js";

function rig(readOnly: boolean) {
  const model: CanvasFurnitureDto = { frames: [{ id: "r_1", x: 0, y: 0, w: 300, h: 200, title: "Act one" }] };
  const save = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const surface = {
    setTool: vi.fn(),
    screenRect: () => ({ x: 10, y: 10, width: 300, height: 200 }),
  } as unknown as CanvasSurface<CanvasItem>;
  const furniture = createFurniture({
    surface: () => surface, container: () => container, get: () => model, save, repaint: vi.fn(),
    readOnly: () => readOnly,
  });
  return { furniture, save, container };
}

describe("a frame that may not be changed", () => {
  it("is still the frame's to double-click, but opens no name editor", () => {
    const { furniture, container } = rig(true);
    expect(furniture.activate("r_1")).toBe(true);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("is not removed by a delete", () => {
    const { furniture, save } = rig(true);
    expect(furniture.absorbDelete(["r_1", "c_card"])).toEqual(["c_card"]);
    furniture.remove(["r_1"]);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("a frame being renamed", () => {
  it("keeps the name typed when the view goes", () => {
    const { furniture, container, save } = rig(false);
    furniture.activate("r_1");
    const box = container.querySelector("textarea")!;
    box.value = "Act two";
    furniture.destroy();
    expect(container.querySelector("textarea")).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].frames[0].title).toBe("Act two");
    expect(save.mock.calls[0]![1]).toBe("Rename a frame");
  });

  it("is removed, when asked, as one step, leaving the cards to the view", () => {
    const { furniture, save } = rig(false);
    furniture.remove(["r_1", "c_not_mine"]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].frames).toEqual([]);
  });
});
