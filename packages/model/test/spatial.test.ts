// The spatial template of play: the marker, the geometry a zone carries, and the
// maths the map is built on. Expectations hand-written from the format's promises
// (design/graphical-views.md section 2, Reboot 6): a spatial group is an ordinary
// tag group with a bag, geometry is source-only, and nothing core owns is lost by
// a template writing to a shard it shares.

import { describe, expect, it } from "vitest";
import {
  centroid, isSpatial, labelPoint, pointInPolygon, polygonBounds, polygonOf, spatialOf,
  withPolygon, withSpatialGroup, zoneAt, zonesAt, restack, stacked, zOf, withZ, backgroundsOf, withBackgrounds, droppedRect,
} from "../src/spatial.js";
import type { Polygon } from "../src/spatial.js";
import type { Tag, TagGroup } from "../src/index.js";

const group = (templates?: Record<string, unknown>): TagGroup =>
  ({ id: "d_zone", gameId: "zone", tags: [], ...(templates ? { templates } : {}) });
const tag = (templates?: Record<string, unknown>): Tag =>
  ({ id: "v_docks", gameId: "docks", ...(templates ? { templates } : {}) });

const SQUARE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe("the spatial marker", () => {
  it("reads an ordinary group as not spatial", () => {
    expect(isSpatial(group())).toBe(false);
    expect(isSpatial(group({ phased: { acts: 3 } }))).toBe(false);
    expect(spatialOf(group())).toBeUndefined();
  });

  it("marks and unmarks a group", () => {
    const on = group(withSpatialGroup(group(), true));
    expect(isSpatial(on)).toBe(true);
    expect(group(withSpatialGroup(on, false)).templates).toBeUndefined();
  });

  it("ignores a bag that is present but not a map", () => {
    // A future version of the template might keep other things under this key; a
    // group is spatial only when it says so.
    expect(isSpatial(group({ spatial: {} }))).toBe(false);
    expect(isSpatial(group({ spatial: { map: false } }))).toBe(false);
  });

  it("keeps another template's bag when marking", () => {
    // The shard is shared. Losing a key we do not own would be data loss.
    const before = group({ phased: { acts: 3 } });
    const after = withSpatialGroup(before, true);
    expect(after).toEqual({ phased: { acts: 3 }, spatial: { map: true } });
    expect(withSpatialGroup(group(after), false)).toEqual({ phased: { acts: 3 } });
  });
});

describe("a zone's outline", () => {
  it("is undefined until it is drawn", () => {
    expect(polygonOf(tag())).toBeUndefined();
    expect(polygonOf(tag({ spatial: {} }))).toBeUndefined();
  });

  it("round-trips through the bag", () => {
    const written = withPolygon(tag(), SQUARE);
    expect(polygonOf(tag(written))).toEqual(SQUARE);
  });

  it("rounds to whole units on the way in", () => {
    // Six decimal places of drag noise in a file two people merge is nobody's
    // friend; canvas positions are rounded for the same reason.
    const written = withPolygon(tag(), [{ x: 0.4, y: 9.6 }, { x: 10.2, y: 0 }, { x: 5, y: 5.5 }]);
    expect(polygonOf(tag(written))).toEqual([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 5, y: 6 }]);
  });

  it("clears back to nothing, taking the empty bag with it", () => {
    const drawn = tag(withPolygon(tag(), SQUARE));
    expect(withPolygon(drawn, undefined)).toBeUndefined();
  });

  it("keeps other templates and other spatial keys when the polygon changes", () => {
    const before = tag({ phased: { act: 2 }, spatial: { polygon: SQUARE, colour: "#ff0000" } });
    const after = withPolygon(before, [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]);
    expect(after).toEqual({
      phased: { act: 2 },
      spatial: { polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], colour: "#ff0000" },
    });
  });

  it("reads a malformed outline as undrawn rather than throwing", () => {
    // These shards are hand-editable, so the canvas has to survive anything. The
    // report belongs to validation, not to a crash halfway through a paint.
    for (const bad of [
      { polygon: "nonsense" },
      { polygon: [] },
      { polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },                       // a line, not a shape
      { polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2 }] },             // missing y
      { polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: "2", y: 3 }] },     // a string
      { polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: Infinity, y: 3 }] },
    ]) {
      expect(polygonOf(tag({ spatial: bad }))).toBeUndefined();
    }
  });
});

describe("geometry", () => {
  it("boxes a polygon", () => {
    expect(polygonBounds([{ x: -5, y: 2 }, { x: 10, y: 2 }, { x: 3, y: 20 }]))
      .toEqual({ x: -5, y: 2, width: 15, height: 18 });
  });

  it("puts a label at the centre of AREA, not the average of the vertices", () => {
    // A square with extra vertices crowded along one edge: the vertex average is
    // dragged towards the crowd, the area centroid is not.
    const crowded = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 0 },
      { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const c = centroid(crowded);
    expect(c.x).toBeCloseTo(5, 6);
    expect(c.y).toBeCloseTo(5, 6);
    const average = crowded.reduce((s, p) => s + p.y, 0) / crowded.length;
    expect(average).toBeLessThan(4);   // the answer we did NOT use
  });

  it("puts a label INSIDE an L, where the centre of area is not", () => {
    // The centre of area of an L falls in the notch. Half the zones anyone draws
    // over a floor plan are L-shaped corridors, so a label there would sit outside
    // its own zone next to whatever is drawn in the gap.
    const ell = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPolygon(centroid(ell), ell)).toBe(false);
    expect(pointInPolygon(labelPoint(ell), ell)).toBe(true);
  });

  it("leaves a label at the centre of area when that is inside", () => {
    // No cleverness where none is needed: a convex zone's label does not move.
    expect(labelPoint(SQUARE)).toEqual(centroid(SQUARE));
  });

  it("puts an L's label in the roomiest part of its line", () => {
    // Along the arm, not squeezed against an edge.
    const ell = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 10 }, { x: 0, y: 10 },
    ];
    const at = labelPoint(ell);
    expect(at.y).toBeCloseTo(centroid(ell).y, 6);   // the eye's expectation is kept
    expect(at.x).toBeGreaterThan(0);
    expect(at.x).toBeLessThan(3);
  });

  it("puts a map's label near the top, clear of what the zone contains", () => {
    // The middle of a zone holds its pins, and a containing zone's middle is
    // another zone entirely, so a map asks for the top.
    const at = labelPoint(SQUARE, { bias: "top" });
    expect(pointInPolygon(at, SQUARE)).toBe(true);
    expect(at.y).toBeLessThan(centroid(SQUARE).y);
    expect(at.x).toBeCloseTo(5, 6);
  });

  it("keeps a top-biased label inside a concave shape", () => {
    // The C: at most heights the widest interior run is the left arm, and the
    // label must not drift into the courtyard the C wraps around.
    const cShape = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 4, y: 3 },
      { x: 4, y: 7 }, { x: 10, y: 7 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPolygon(labelPoint(cShape, { bias: "top" }), cShape)).toBe(true);
    const ell = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPolygon(labelPoint(ell, { bias: "top" }), ell)).toBe(true);
  });

  it("drops a label below a POINTED top rather than into the spike", () => {
    // A headland, a gable, a cave mouth: almost no width at the top, so a fixed
    // fraction down the box puts the name in a sliver and it spills over both
    // edges. The label goes where there is room for it.
    const peak = [
      { x: 50, y: 0 }, { x: 100, y: 80 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 80 },
    ];
    const at = labelPoint(peak, { bias: "top" });
    expect(pointInPolygon(at, peak)).toBe(true);
    // Below the spike, and still in the upper half rather than sunk to the middle.
    expect(at.y).toBeGreaterThan(20);
    expect(at.y).toBeLessThan(70);
  });

  it("still hugs the top when the top is wide", () => {
    const at = labelPoint(SQUARE, { bias: "top" });
    expect(at.y).toBeLessThan(2);
    expect(at.x).toBeCloseTo(5, 6);
  });

  it("survives a degenerate polygon asked for a label", () => {
    expect(labelPoint([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
  });

  it("survives a degenerate polygon", () => {
    const line = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    expect(centroid(line)).toEqual({ x: 5, y: 0 });
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });

  it("tests inside and outside, concave shapes included", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: -1, y: -1 }, SQUARE)).toBe(false);
    // A C shape: the point sits in the bounding box but in the bite, not the shape.
    const cShape = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 4, y: 3 },
      { x: 4, y: 7 }, { x: 10, y: 7 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 7, y: 5 }, cShape)).toBe(false);
    expect(pointInPolygon({ x: 2, y: 5 }, cShape)).toBe(true);
  });

  it("gives a point on a shared border to exactly one of two touching zones", () => {
    // The property the map actually rests on: zones drawn edge to edge (rooms off a
    // corridor) must not both claim a pin dropped on the line, nor both refuse it.
    // The half-open edge rule is what provides it; which side is the inclusive one
    // is arbitrary, so this pins the convention rather than leaving it to drift.
    const lower = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const upper = [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    for (const x of [0.5, 5, 9.5]) {
      const claims = [lower, upper].filter((z) => pointInPolygon({ x, y: 10 }, z));
      expect(claims).toHaveLength(1);
      expect(claims[0]).toBe(upper);   // the border belongs to the zone below it
    }
  });

  it("counts a point level with a vertex once", () => {
    // The classic ray-casting trap: a ray through a shared vertex counted twice
    // reports a point inside as outside.
    const diamond = [{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }];
    expect(pointInPolygon({ x: 5, y: 5 }, diamond)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 0 }, diamond)).toBe(false);
  });
});

describe("which zone a pin landed in", () => {
  const zones = [
    { id: "v_district", polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] },
    { id: "v_square", polygon: [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 5, y: 10 }] },
  ];

  it("names the zone under the point", () => {
    expect(zoneAt({ x: 1, y: 1 }, zones)).toBe("v_district");
  });

  it("gives an overlap to the zone drawn on top", () => {
    // A square inside a district is a normal thing to draw, so "which one" needs an
    // answer: the one the author can see, which is the last drawn.
    expect(zoneAt({ x: 7, y: 7 }, zones)).toBe("v_square");
  });

  it("reports open space as no zone", () => {
    // Which is a legitimate place to leave a pin: the hand is simply unbound.
    expect(zoneAt({ x: 50, y: 50 }, zones)).toBeUndefined();
  });

  it("lists EVERY containing zone, frontmost first", () => {
    // What the editor needs to say "you are inside two outlines and only one of
    // them counts". Zones are tags and the engine has no geometry, so overlapping
    // outlines do not nest, and a picture that implies they do has to be annotated.
    expect(zonesAt({ x: 7, y: 7 }, zones)).toEqual(["v_square", "v_district"]);
    expect(zonesAt({ x: 1, y: 1 }, zones)).toEqual(["v_district"]);
    expect(zonesAt({ x: 50, y: 50 }, zones)).toEqual([]);
  });

  it("keeps zoneAt as the head of zonesAt, so the two cannot disagree", () => {
    // The binding rule and the ambiguity warning must be one rule: a mark that
    // claimed an overlap the binding did not see would be worse than no mark.
    for (const at of [{ x: 7, y: 7 }, { x: 1, y: 1 }, { x: 50, y: 50 }]) {
      expect(zoneAt(at, zones)).toBe(zonesAt(at, zones)[0]);
    }
  });

  it("follows the STACK rather than the array when a zone is restacked", () => {
    // Frontmost means front in the stack, so raising the district above the square
    // moves the binding with it - and the site the author sees on top is the owner.
    const raised = [zones[0]!, { ...zones[1]!, z: -1 }];
    expect(zonesAt({ x: 7, y: 7 }, raised)).toEqual(["v_district", "v_square"]);
    expect(zoneAt({ x: 7, y: 7 }, raised)).toBe("v_district");
  });
});

describe("the stack", () => {
  // Sparse and generic: zones need it now, backgrounds will need the same.
  const ids = (items: { id: string; z?: number }[]): string[] => stacked(items).map((i) => i.id);

  it("falls back to list order, so a project nobody has restacked is unchanged", () => {
    expect(ids([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual(["a", "b", "c"]);
  });

  it("puts a moved item where its number says, whatever the list says", () => {
    expect(ids([{ id: "a" }, { id: "b" }, { id: "c", z: -5 }])).toEqual(["c", "a", "b"]);
  });

  it("brings to front and sends to back past everything", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(ids([...items.filter((i) => i.id !== "a"), { id: "a", z: restack(items, "a", "front")! }]))
      .toEqual(["b", "c", "a"]);
    expect(ids([...items.filter((i) => i.id !== "c"), { id: "c", z: restack(items, "c", "back")! }]))
      .toEqual(["c", "a", "b"]);
  });

  it("moves one place at a time, and only one", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const moved = items.map((i) => (i.id === "a" ? { id: "a", z: restack(items, "a", "forward")! } : i));
    expect(ids(moved)).toEqual(["b", "a", "c", "d"]);
    const back = items.map((i) => (i.id === "d" ? { id: "d", z: restack(items, "d", "backward")! } : i));
    expect(ids(back)).toEqual(["a", "b", "d", "c"]);
  });

  it("says nothing to do rather than writing a no-op", () => {
    // A no-op that returned a number would be a file write and an undo step for
    // a menu item that did nothing.
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(restack(items, "a", "back")).toBeUndefined();
    expect(restack(items, "a", "backward")).toBeUndefined();
    expect(restack(items, "c", "front")).toBeUndefined();
    expect(restack(items, "c", "forward")).toBeUndefined();
    expect(restack(items, "nobody", "front")).toBeUndefined();
    expect(restack([{ id: "only" }], "only", "front")).toBeUndefined();
  });

  it("keeps its numbers sparse, so nothing has to be renumbered", () => {
    // Twenty moves of the same item must not drive the others' values anywhere.
    let items: { id: string; z?: number }[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    for (let i = 0; i < 20; i++) {
      const z = restack(items, "a", i % 2 === 0 ? "forward" : "backward");
      if (z !== undefined) items = items.map((it) => (it.id === "a" ? { id: "a", z } : it));
    }
    expect(items.filter((i) => i.id !== "a").every((i) => i.z === undefined)).toBe(true);
  });
});

describe("a zone's place in the stack, on its tag", () => {
  it("reads nothing for a zone that has never been moved", () => {
    expect(zOf({ id: "v_1" })).toBeUndefined();
  });

  it("round-trips, and keeps the other spatial keys", () => {
    const tag: Tag = { id: "v_1", templates: { spatial: { polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] } } };
    tag.templates = withZ(tag, 3.5);
    expect(zOf(tag)).toBe(3.5);
    expect(polygonOf(tag)).toHaveLength(3);
  });

  it("rounds, so a halved midpoint is not eleven decimal places in a merge", () => {
    const tag: Tag = { id: "v_1" };
    tag.templates = withZ(tag, 1 / 3);
    expect(zOf(tag)).toBe(0.333);
  });
});

describe("which zone owns a point", () => {
  const square = (x: number, y: number, w: number): Polygon =>
    [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];

  it("answers with the FRONTMOST zone the point is in", () => {
    // A room inside a wing: the room is in front, so the room owns it.
    const zones = [
      { id: "wing", polygon: square(0, 0, 100) },
      { id: "room", polygon: square(10, 10, 30) },
    ];
    expect(zoneAt({ x: 20, y: 20 }, zones)).toBe("room");
    expect(zoneAt({ x: 80, y: 80 }, zones)).toBe("wing");
  });

  it("follows the stack rather than the list, once somebody has restacked", () => {
    // Send the room to the back and the wing owns the overlap instead.
    const zones = [
      { id: "wing", polygon: square(0, 0, 100) },
      { id: "room", polygon: square(10, 10, 30), z: -1 },
    ];
    expect(zoneAt({ x: 20, y: 20 }, zones)).toBe("wing");
  });
});

describe("backgrounds behind a map", () => {
  const rect = { x: 0, y: 0, width: 800, height: 600 };
  const mapped = (backgrounds: unknown): TagGroup =>
    ({ id: "d_zone", gameId: "zone", tags: [], templates: { spatial: { map: true, backgrounds } } });

  it("reads nothing for a map with no pictures", () => {
    expect(backgroundsOf(group({ spatial: { map: true } }))).toEqual([]);
    expect(spatialOf(group({ spatial: { map: true } }))).toEqual({ map: true });
  });

  it("reads a picture, and reports it with the group's configuration", () => {
    const g = mapped([{ id: "g_1", file: "site.png", ...rect, opacity: 0.4 }]);
    expect(backgroundsOf(g)).toEqual([{ id: "g_1", file: "site.png", ...rect, opacity: 0.4 }]);
    expect(spatialOf(g)?.backgrounds).toHaveLength(1);
  });

  it("hands them back in DRAW order, so a view paints the list as it comes", () => {
    // Tiles and overlaps, never alternates: order is what an overlap needs.
    const g = mapped([
      { id: "g_top", file: "a.png", ...rect, z: 5 },
      { id: "g_bottom", file: "b.png", ...rect, z: -5 },
    ]);
    expect(backgroundsOf(g).map((b) => b.id)).toEqual(["g_bottom", "g_top"]);
  });

  it("refuses an entry that cannot be drawn, rather than throwing inside a canvas", () => {
    // Each of these is a hand edit or a bad merge away, and validation is where
    // an author hears about it.
    const g = mapped([
      { id: "g_ok", file: "good.png", ...rect },
      { file: "no-id.png", ...rect },
      { id: "g_nofile", ...rect },
      { id: "g_nan", file: "x.png", x: 0, y: 0, width: Number.NaN, height: 10 },
      { id: "g_flat", file: "x.png", x: 0, y: 0, width: 0, height: 10 },
      { id: "g_negative", file: "x.png", x: 0, y: 0, width: -5, height: 10 },
      "not even an object",
    ]);
    expect(backgroundsOf(g).map((b) => b.id)).toEqual(["g_ok"]);
  });

  it("clamps opacity rather than trusting it", () => {
    const g = mapped([
      { id: "g_1", file: "a.png", ...rect, opacity: 4 },
      { id: "g_2", file: "b.png", ...rect, opacity: -1 },
    ]);
    expect(backgroundsOf(g).map((b) => b.opacity)).toEqual([1, 0]);
  });

  it("writes whole units, and keeps the marker and the zones' own bag", () => {
    const g = group({ spatial: { map: true }, other: { kept: true } });
    g.templates = withBackgrounds(g, [{ id: "g_1", file: "a.png", x: 0.4, y: 1.6, width: 799.5, height: 600.2 }]);
    expect(backgroundsOf(g)[0]).toMatchObject({ x: 0, y: 2, width: 800, height: 600 });
    expect(isSpatial(g)).toBe(true);
    expect(g.templates?.["other"]).toEqual({ kept: true });
  });

  it("drops the key entirely when the last picture goes", () => {
    const g = mapped([{ id: "g_1", file: "a.png", ...rect }]);
    g.templates = withBackgrounds(g, []);
    expect((g.templates?.["spatial"] as Record<string, unknown>)["backgrounds"]).toBeUndefined();
    expect(isSpatial(g)).toBe(true);   // still a map, just an empty one
  });
});

describe("where a dropped picture lands", () => {
  const plan = { width: 2816, height: 1536 };     // a real site plan
  const view = { width: 800, height: 400 };

  it("fits inside 60% of the viewport, both axes", () => {
    const r = droppedRect(plan, view, 1, { x: 0, y: 0 });
    expect(r.width / view.width).toBeCloseTo(0.55, 2);
    expect(r.height / view.height).toBeCloseTo(0.6, 2);
  });

  it("arrives the same size ON SCREEN whatever the zoom", () => {
    // The whole requirement: comfortable to grab, at any zoom. So its world size
    // scales inversely and its screen size does not move.
    const sizes = [1, 0.5, 0.25, 2].map((scale) => {
      const r = droppedRect(plan, view, scale, { x: 0, y: 0 });
      return `${Math.round(r.width * scale)}x${Math.round(r.height * scale)}`;
    });
    expect(new Set(sizes).size).toBe(1);
  });

  it("centres on where it was dropped", () => {
    const r = droppedRect(plan, view, 1, { x: 500, y: 300 });
    expect(r.x + r.width / 2).toBeCloseTo(500, 0);
    expect(r.y + r.height / 2).toBeCloseTo(300, 0);
  });

  it("keeps the aspect ratio, portrait or landscape", () => {
    for (const natural of [{ width: 2816, height: 1536 }, { width: 900, height: 1600 }, { width: 500, height: 500 }]) {
      const r = droppedRect(natural, view, 1, { x: 0, y: 0 });
      expect(r.width / r.height).toBeCloseTo(natural.width / natural.height, 1);
    }
  });

  it("survives nonsense rather than returning a rectangle nobody can grab", () => {
    // A zero-sized image or a zero-sized viewport is a bad header or a pane that
    // has not been laid out yet; neither should produce a 0x0 background that
    // cannot be seen or clicked.
    for (const [natural, v, scale] of [
      [{ width: 0, height: 0 }, view, 1],
      [plan, { width: 0, height: 0 }, 1],
      [plan, view, 0],
      [{ width: Number.NaN, height: 10 }, view, 1],
    ] as const) {
      const r = droppedRect(natural, v, scale, { x: 0, y: 0 });
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });
});
