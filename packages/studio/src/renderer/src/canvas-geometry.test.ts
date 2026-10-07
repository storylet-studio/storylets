// The canvas's arithmetic, pinned without a canvas (canvas-geometry.ts). The
// expectations are hand-written from what an author sees: a marquee takes what
// it visibly touches, a frame answers only by its bar, a fit frames without
// magnifying, a drop lands on the grid, and an eased camera arrives exactly
// where it was sent.

import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX, allInView, boxBetween, centredCamera, contentBounds, crossesFloor, cubicBezier, frameCamera,
  hitsItem, isAdditive, isContextPress, itemAt, meetsBox, parseCubicBezier, parseDuration, pastDragThreshold,
  pointInRect, snapDelta, tweenCamera, viewCentre, type FrameOptions,
} from "./canvas-geometry.js";

const card = { x: 100, y: 100, width: 190, height: 76 };
/** A pin at (100, 100): an 18-unit box, a 9-pixel disc. */
const pin = { x: 91, y: 91, width: 18, height: 18, discRadius: 9 };
/** A frame round some cards, answering only by its 22-unit bar. */
const frame = { x: 0, y: 0, width: 600, height: 400, hitArea: { x: 0, y: 0, width: 600, height: 22 } };

describe("what a marquee meets", () => {
  it("takes a plain item it overlaps, and not one it only touches the edge of", () => {
    expect(meetsBox(card, { x: 280, y: 150, width: 50, height: 10 }, 1)).toBe(true);
    expect(meetsBox(card, { x: 290, y: 150, width: 50, height: 10 }, 1)).toBe(false);
  });

  it("takes a FRAME only when it meets the bar", () => {
    // Round the cards in the middle of the frame: the body, which does not answer.
    expect(meetsBox(frame, { x: 100, y: 100, width: 300, height: 200 }, 1)).toBe(false);
    // Across the bar.
    expect(meetsBox(frame, { x: 100, y: 10, width: 50, height: 50 }, 1)).toBe(true);
  });

  it("takes a pin by its disc on screen, not its box, at any zoom", () => {
    // Zoomed out to 30%, the disc is 30 world units in radius and the box 9: a
    // sweep 15 units out touches the dot and misses the box.
    expect(meetsBox(pin, { x: 115, y: 100, width: 2, height: 2 }, 0.3)).toBe(true);
    // Zoomed in to 300%, the disc is 3 units: 6 units out misses the dot.
    expect(meetsBox(pin, { x: 106, y: 106, width: 2, height: 2 }, 3)).toBe(false);
    // A box that swallows the dot whole takes it.
    expect(meetsBox(pin, { x: 0, y: 0, width: 400, height: 400 }, 1)).toBe(true);
  });
});

describe("what a point hits", () => {
  it("hits a pin by its disc, so a comment dropped beside the dot is not on it", () => {
    expect(hitsItem(pin, { x: 105, y: 105 }, 1)).toBe(true);
    // Inside the box's corner, outside the disc.
    expect(hitsItem(pin, { x: 108, y: 108 }, 1)).toBe(false);
    // Zoomed out, the dot is bigger in world units than its box.
    expect(hitsItem(pin, { x: 120, y: 100 }, 0.3)).toBe(true);
  });

  it("hits a frame only on its bar", () => {
    expect(hitsItem(frame, { x: 300, y: 10 }, 1)).toBe(true);
    expect(hitsItem(frame, { x: 300, y: 200 }, 1)).toBe(false);
  });

  it("finds the TOPMOST item of those asked about", () => {
    const under = { id: "under", ...card };
    const over = { id: "over", ...card, x: 150 };
    expect(itemAt([under, over], { x: 200, y: 120 }, 1)?.id).toBe("over");
    expect(itemAt([under, over], { x: 200, y: 120 }, 1, (i) => i.id === "under")?.id).toBe("under");
    expect(itemAt([under, over], { x: 900, y: 900 }, 1)).toBeUndefined();
  });

  it("counts a point on the edge of a box as in it", () => {
    expect(pointInRect({ x: 100, y: 176 }, card)).toBe(true);
  });
});

describe("drags, sweeps and pans share one threshold", () => {
  it("is a click under it and a drag at it, on the larger axis, as Konva's own drag is", () => {
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: DRAG_THRESHOLD_PX - 1, y: DRAG_THRESHOLD_PX - 1 })).toBe(false);
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: 0, y: DRAG_THRESHOLD_PX })).toBe(true);
  });

  it("spans two corners whichever way round they came", () => {
    expect(boxBetween({ x: 10, y: 50 }, { x: 0, y: 20 })).toEqual({ x: 0, y: 20, width: 10, height: 30 });
  });
});

describe("framing", () => {
  const opts: FrameOptions = {
    padding: 48, margin: { top: 0, right: 0, bottom: 0, left: 0 }, minScale: 0.1, maxScale: 3,
    magnify: false, keepZoomIfItFits: false,
  };
  const view = { width: 1000, height: 600 };

  it("measures the box round everything, or nothing", () => {
    expect(contentBounds([card, { x: 0, y: 0, width: 10, height: 10 }])).toEqual({ x: 0, y: 0, width: 290, height: 176 });
    expect(contentBounds([])).toBeUndefined();
  });

  it("centres what it frames", () => {
    const cam = frameCamera({ x: 0, y: 0, width: 2000, height: 1000 }, view, 1, opts)!;
    expect(viewCentre(cam, view).x).toBeCloseTo(1000);
    expect(viewCentre(cam, view).y).toBeCloseTo(500);
    // Shrunk to fit the room inside the padding.
    expect(cam.scale).toBeCloseTo(Math.min((1000 - 96) / 2000, (600 - 96) / 1000));
  });

  it("never magnifies a small subject past 1:1 unless asked", () => {
    expect(frameCamera(card, view, 0.5, opts)!.scale).toBe(1);
    expect(frameCamera(card, view, 0.5, { ...opts, magnify: true })!.scale).toBeGreaterThan(1);
  });

  it("keeps the author's zoom when the subject fits at it", () => {
    expect(frameCamera(card, view, 0.4, { ...opts, keepZoomIfItFits: true })!.scale).toBe(0.4);
  });

  it("leaves the caller's margin round the items", () => {
    const tight = frameCamera({ x: 0, y: 0, width: 800, height: 400 }, view, 1, opts)!;
    const roomy = frameCamera({ x: 0, y: 0, width: 800, height: 400 }, view, 1,
      { ...opts, margin: { top: 200, right: 0, bottom: 0, left: 0 } })!;
    expect(roomy.scale).toBeLessThan(tight.scale);
  });

  it("knows what is fully on screen", () => {
    const cam = { x: 0, y: 0, scale: 1 };
    expect(allInView([card], cam, view)).toBe(true);
    expect(allInView([{ ...card, x: 900 }], cam, view)).toBe(false);
  });
});

describe("the drop's snap", () => {
  it("snaps the dragged item and moves the rest by the same delta", () => {
    expect(snapDelta({ x: 40, y: 40 }, { x: 27, y: -8 }, 20)).toEqual({ x: 20, y: 0 });
  });

  it("leaves a canvas with no grid exactly where it was dropped", () => {
    expect(snapDelta({ x: 40, y: 40 }, { x: 27, y: -8 }, 0)).toEqual({ x: 27, y: -8 });
  });
});

describe("zoom floors", () => {
  it("counts a floor crossed in either direction, and not one stayed above or below", () => {
    expect(crossesFloor([0.34, 0.6], 0.5, 0.7)).toBe(true);
    expect(crossesFloor([0.34, 0.6], 0.7, 0.3)).toBe(true);
    expect(crossesFloor([0.34, 0.6], 0.7, 0.9)).toBe(false);
    expect(crossesFloor([0.34, 0.6], 0.4, 0.5)).toBe(false);
    expect(crossesFloor([], 0.1, 3)).toBe(false);
  });
});

describe("easing the camera", () => {
  it("reads the shell's curve and duration tokens", () => {
    const ease = parseCubicBezier("cubic-bezier(0.2, 0, 0, 1)")!;
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    // ease-out heavy: well past halfway at the halfway mark.
    expect(ease(0.5)).toBeGreaterThan(0.75);
    expect(parseCubicBezier("ease")).toBeUndefined();
    expect(parseDuration("260ms", 0)).toBe(260);
    expect(parseDuration(" 0.2s", 0)).toBe(200);
    expect(parseDuration("", 260)).toBe(260);
  });

  it("only ever moves forward along the curve", () => {
    const ease = cubicBezier(0.2, 0, 0, 1);
    let last = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const v = ease(t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it("starts where it was and arrives exactly where it was sent", () => {
    const view = { width: 800, height: 600 };
    const a = { x: 10, y: 20, scale: 0.5 };
    const b = centredCamera({ x: 900, y: 300 }, 2, view);
    expect(tweenCamera(a, b, 0, view)).toEqual(a);
    expect(tweenCamera(a, b, 1, view)).toEqual(b);
  });

  it("zooms by a steady ratio and carries the view's centre in a straight line", () => {
    const view = { width: 800, height: 600 };
    const a = centredCamera({ x: 0, y: 0 }, 0.5, view);
    const b = centredCamera({ x: 400, y: 200 }, 2, view);
    const mid = tweenCamera(a, b, 0.5, view);
    expect(mid.scale).toBeCloseTo(1);                 // halfway between 0.5 and 2 by ratio
    const centre = viewCentre(mid, view);
    expect(centre.x).toBeCloseTo(200);
    expect(centre.y).toBeCloseTo(100);
  });
});

describe("modifiers", () => {
  const press = (over: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; button: number }>) =>
    ({ shiftKey: false, metaKey: false, ctrlKey: false, button: 0, ...over });

  it("adds to the selection with Shift or the platform's command key, for a click and a sweep alike", () => {
    expect(isAdditive(press({ shiftKey: true }), true)).toBe(true);
    expect(isAdditive(press({ metaKey: true }), true)).toBe(true);
    expect(isAdditive(press({ ctrlKey: true }), true)).toBe(false);   // the menu's, on a Mac
    expect(isAdditive(press({ ctrlKey: true }), false)).toBe(true);
    expect(isAdditive(press({ metaKey: true }), false)).toBe(false);
  });

  it("opens the menu on a right-click, and on a Ctrl-click on macOS only", () => {
    expect(isContextPress(press({ button: 2 }), false)).toBe(true);
    expect(isContextPress(press({ ctrlKey: true }), true)).toBe(true);
    expect(isContextPress(press({ ctrlKey: true }), false)).toBe(false);
    expect(isContextPress(press({}), true)).toBe(false);
  });
});
