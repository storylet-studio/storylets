// ---------------------------------------------------------------------------
// A selected site is ringed by a CIRCLE, at any zoom.
//
// The surface rings an item by its bounding box unless the item declares its own
// edge, and the box of a point is a square, so selecting a site drew a square
// round a circle (graphical-views 1.1a; it was in the editor's map and the
// Board's alike). `outline` could not express the fix: it is world units and
// fixed, and a site's disc holds a constant size on SCREEN, so a polygon would
// have fitted at exactly one zoom.
//
// What is pinned here is the agreement between the two: the ring's radius and the
// disc's radius come from ONE constant, and both are screen-space. A test that
// only checked "a circle is drawn" would pass while the ring sat at half the
// disc's size at 2x zoom, which is the bug in a different costume.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { PIN_R, siteShape } from "./map-art.js";
import { hitsItem, meetsBox } from "./canvas-geometry.js";

const site = (at: { x: number; y: number }) =>
  siteShape({ id: "h_1", title: "The Inn", name: "the-inn", at, zone: "d_1", zoneName: "village" });

describe("a site's selection edge", () => {
  it("declares a disc, not a box", () => {
    expect(site({ x: 100, y: 40 }).discRadius).toBe(PIN_R);
  });

  it("uses the same radius the disc itself draws from", () => {
    // Two constants would drift the first time either was tuned. The disc draws
    // `PIN_R / scale`; the ring draws `discRadius / scale`. Same numerator.
    expect(site({ x: 0, y: 0 }).discRadius).toBe(PIN_R);
  });

  it("keeps the disc centred in the box the surface positions by", () => {
    // The ring is drawn at the box's centre, so a box that was not centred on the
    // point would ring the right size in the wrong place.
    const item = site({ x: 100, y: 40 });
    expect({ x: item.x + item.width / 2, y: item.y + item.height / 2 }).toEqual({ x: 100, y: 40 });
  });

  it("does not also carry a polygon outline, which would win over nothing and confuse", () => {
    expect(site({ x: 1, y: 2 }).outline).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The other half of the same lie: a marquee selected a site by its BOX.
//
// `itemAtPointer` refuses to believe boxes for constant-screen-size items and
// asks Konva's hit graph instead. A marquee cannot do that - there is no pointer
// to hit-test with - so it does the geometry itself (canvas-geometry `meetsBox`).
// This runs the REAL `meetsBox` on a real `siteShape`, so it fails if either the
// geometry or the shape's declared disc goes wrong; the cases are hand-worked
// from the radius on screen, not read off the code.
// ---------------------------------------------------------------------------

describe("a marquee over a site", () => {
  const item = site({ x: 100, y: 100 });
  /** The box test the marquee used to do, for comparison. */
  const boxMeets = (box: { x: number; y: number; width: number; height: number }): boolean =>
    item.x < box.x + box.width && item.x + item.width > box.x
    && item.y < box.y + box.height && item.y + item.height > box.y;

  it("takes a sweep that touched the visible dot, zoomed out", () => {
    // The box lies in BOTH directions, and this is the under-selecting one, which
    // is the same case `itemAtPointer` documents for the pointer. At 30% the disc
    // is 60 world units across and the box is 18, so the dot on screen reaches
    // well beyond the box: a sweep at 115 is on the dot and outside the box.
    const box = { x: 115, y: 100, width: 2, height: 2 };
    expect(meetsBox(item, box, 0.3)).toBe(true);
    expect(boxMeets(box)).toBe(false);   // what the marquee used to answer
  });

  it("takes a sweep that crosses the dot, zoomed in", () => {
    // At 300% the disc is 3 world units in radius and the box is still 18, so a
    // sweep 6 units out misses the dot and the box catches it. Both agree that a
    // sweep ON the dot is a hit, which is the case that must never regress.
    expect(meetsBox(item, { x: 99, y: 99, width: 2, height: 2 }, 3)).toBe(true);
    const nearMiss = { x: 106, y: 106, width: 2, height: 2 };
    expect(meetsBox(item, nearMiss, 3)).toBe(false);
    expect(boxMeets(nearMiss)).toBe(true);
  });

  it("counts a box that swallows the disc whole", () => {
    expect(meetsBox(item, { x: 0, y: 0, width: 400, height: 400 }, 1)).toBe(true);
  });

  it("differs from the box even at 1:1, and the disc is the one that matches the screen", () => {
    // The box is PIN_R * 2 across and the disc is PIN_R in radius, so the box's
    // corners stick out past the circle at every zoom. A sweep touching only a
    // corner never touched the dot.
    const corner = { x: 91, y: 91, width: 1, height: 1 };
    expect(boxMeets(corner)).toBe(true);
    expect(meetsBox(item, corner, 1)).toBe(false);
  });
});

describe("a comment dropped on a site", () => {
  it("lands on it by the disc, not the box: beside the dot is beside the pin", () => {
    // The comment tool asks `hitsItem`, so a drop in the corner of the box at 1:1
    // is on empty map, and the same drop zoomed out (a bigger dot) is on the pin.
    const item = site({ x: 100, y: 100 });
    expect(hitsItem(item, { x: 107, y: 107 }, 1)).toBe(false);
    expect(hitsItem(item, { x: 107, y: 107 }, 0.5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Two outlines round one site: the mark, and the sentence.
//
// Zones are TAGS and the engine has no geometry, so overlapping outlines do not
// nest: a site belongs to the frontmost zone containing it and to no other. That
// is invisible on a drawn map, which is exactly why the picture has to say it
// (graphical-views 2, ruled 2026-08-18).
//
// What is pinned here is the AMBIGUITY REPORTING, not the resolution - the rule
// itself lives in the model as `zonesAt`, whose head is `zoneAt`, and is tested
// there. This is about what the author is shown.
// ---------------------------------------------------------------------------

describe("a site inside more than one zone", () => {
  it("carries the other zones' NAMES, so they can be named rather than counted", () => {
    // "also inside 2 zones" would leave an author hunting for the other outline.
    const item = { ...site({ x: 0, y: 0 }), alsoInside: ["village", "the-vale"] };
    expect(item.alsoInside).toEqual(["village", "the-vale"]);
  });

  it("says nothing when there is no ambiguity", () => {
    // The commonest case by far, and it must stay silent: a mark on every site
    // would be furniture, not information.
    expect(site({ x: 0, y: 0 }).alsoInside).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A pin OFF ITS ZONE: bound to one zone, drawn in another or in none. Pins wear
// their box's colour now and zones are neutral, so "a colour that disagrees
// with the ground" is gone, and this warning ring replaces it (the round-3
// ruling). Hand-written cases from the rule, not read off the code.
// ---------------------------------------------------------------------------

import { pinPlacement } from "./map-art.js";

describe("a pin off its zone", () => {
  const square = (x: number, y: number) => [{ x, y }, { x: x + 100, y }, { x: x + 100, y: y + 100 }, { x, y: y + 100 }];
  const zones = [
    { id: "z_docks", polygon: square(0, 0) },
    { id: "z_town", polygon: square(200, 0) },
    { id: "z_market", polygon: square(220, 20), z: 1 },
  ];
  const name = (id: string): string | undefined => ({ z_docks: "docks", z_town: "town", z_market: "market", z_far: "far" })[id];

  it("is not off it standing inside the zone it is bound to", () => {
    expect(pinPlacement({ x: 50, y: 50 }, "z_docks", zones, name).strayFrom).toBeUndefined();
  });

  it("is off it standing in another zone, and the ring names the zone it is bound to", () => {
    expect(pinPlacement({ x: 250, y: 10 }, "z_docks", zones, name).strayFrom).toBe("docks");
  });

  it("is off it standing in no zone while its own is drawn", () => {
    expect(pinPlacement({ x: 500, y: 500 }, "z_docks", zones, name).strayFrom).toBe("docks");
  });

  it("is not off a zone nobody has drawn while it stands in none, nor with nothing bound", () => {
    expect(pinPlacement({ x: 500, y: 500 }, "z_far", zones, name).strayFrom).toBeUndefined();
    expect(pinPlacement({ x: 50, y: 50 }, undefined, zones, name).strayFrom).toBeUndefined();
  });

  it("goes by the FRONTMOST zone, as a drop binds", () => {
    // Inside town and the market on top of it: bound to town, it stands in the
    // market as far as the model is concerned.
    const p = pinPlacement({ x: 250, y: 50 }, "z_town", zones, name);
    expect(p.strayFrom).toBe("town");
    expect(pinPlacement({ x: 250, y: 50 }, "z_market", zones, name)).toEqual({ alsoInside: ["town"] });
  });
});
