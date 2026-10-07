// A frame answers the pointer by its BAR only, and a marquee has to agree
// (the October 2026 review, finding 7): sweeping round the cards inside a frame
// used to take the frame too, and the next Delete removed it.

import { describe, expect, it } from "vitest";
import { frameShape, REGION_BAR, FURNITURE_TEXT_FLOOR } from "./furniture-art.js";
import { hitsItem, meetsBox } from "./canvas-geometry.js";
import { TITLE_FLOOR } from "./node-art.js";
import { LABEL_FLOOR } from "./map-art.js";

const frame = frameShape({ id: "r_1", x: 100, y: 100, w: 600, h: 400, title: "Act two" });

describe("a frame's hit area", () => {
  it("is the bar along its top, the full width", () => {
    expect(frame.hitArea).toEqual({ x: 0, y: 0, width: 600, height: REGION_BAR });
  });

  it("is no taller than a frame shorter than the bar", () => {
    expect(frameShape({ id: "r_2", x: 0, y: 0, w: 50, h: 12 }).hitArea?.height).toBe(12);
  });

  it("keeps a marquee round the cards inside it from taking it", () => {
    expect(meetsBox(frame, { x: 200, y: 200, width: 300, height: 200 }, 1)).toBe(false);
    expect(meetsBox(frame, { x: 200, y: 90, width: 300, height: 20 }, 1)).toBe(true);
  });

  it("lets a click in its body through to whatever is there", () => {
    expect(hitsItem(frame, { x: 300, y: 300 }, 1)).toBe(false);
    expect(hitsItem(frame, { x: 300, y: 110 }, 1)).toBe(true);
  });
});

describe("a frame's name", () => {
  it("goes at a higher floor than the other labels, because its bar shrinks under it", () => {
    // At the floor the bar is 22 * 0.6 = 13 pixels, room for a 10-pixel name;
    // at the other labels' floors it would be 7 or 8, under a 12-pixel name.
    expect(FURNITURE_TEXT_FLOOR).toBeGreaterThan(TITLE_FLOOR);
    expect(FURNITURE_TEXT_FLOOR).toBeGreaterThan(LABEL_FLOOR);
    expect(REGION_BAR * FURNITURE_TEXT_FLOOR).toBeGreaterThanOrEqual(13);
  });
});
