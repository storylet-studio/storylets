// The camera's conversions and its zoom about a point (canvas-geometry.ts),
// pinned by what an author sees: the thing under the cursor stays under it as
// the wheel zooms, the zoom stops at its limits without nudging the view, and
// screen and world agree in both directions.

import { describe, expect, it } from "vitest";
import {
  clampScale, onGridLine, screenToWorld, visibleRect, worldRectToScreen, worldToScreen, zoomAbout,
} from "./canvas-geometry.js";

const camera = { x: 100, y: -50, scale: 2 };

describe("screen and world", () => {
  it("convert both ways and agree", () => {
    const world = screenToWorld(camera, { x: 300, y: 150 });
    expect(world).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(camera, world)).toEqual({ x: 300, y: 150 });
  });

  it("puts a world rectangle on screen at the camera's scale", () => {
    expect(worldRectToScreen(camera, { x: 10, y: 20, width: 30, height: 40 }))
      .toEqual({ x: 120, y: -10, width: 60, height: 80 });
  });

  it("says which part of the world a view shows", () => {
    expect(visibleRect(camera, { width: 800, height: 600 })).toEqual({ x: -50, y: 25, width: 400, height: 300 });
  });
});

describe("zooming about a point", () => {
  it("keeps the world point under the cursor where it was on screen", () => {
    const at = { x: 400, y: 300 };
    const before = screenToWorld(camera, at);
    const next = zoomAbout(camera, at, 1.5, 0.1, 3)!;
    expect(next.scale).toBe(3);
    const after = screenToWorld(next, at);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("stops at the limits", () => {
    expect(zoomAbout({ x: 0, y: 0, scale: 2 }, { x: 0, y: 0 }, 4, 0.1, 3)!.scale).toBe(3);
    expect(zoomAbout({ x: 0, y: 0, scale: 0.2 }, { x: 0, y: 0 }, 0.1, 0.1, 3)!.scale).toBe(0.1);
  });

  it("does nothing at all once a limit is reached, so the view does not creep", () => {
    expect(zoomAbout({ x: 5, y: 5, scale: 3 }, { x: 200, y: 200 }, 1.2, 0.1, 3)).toBeUndefined();
  });

  it("clamps a remembered zoom to the limits", () => {
    expect(clampScale(9, 0.1, 3)).toBe(3);
    expect(clampScale(0.01, 0.1, 3)).toBe(0.1);
    expect(clampScale(1.5, 0.1, 3)).toBe(1.5);
  });
});

describe("the grid's major lines", () => {
  it("land on multiples of the step, negative ones too", () => {
    expect(onGridLine(200, 100)).toBe(true);
    expect(onGridLine(-300, 100)).toBe(true);
    expect(onGridLine(0, 100)).toBe(true);
    expect(onGridLine(120, 100)).toBe(false);
  });

  it("forgive the drift of a grid walked by repeated addition", () => {
    let x = 0;
    for (let i = 0; i < 10; i++) x += 0.1;
    expect(onGridLine(x, 1)).toBe(true);
  });
});
