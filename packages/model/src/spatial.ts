// ---------------------------------------------------------------------------
// The spatial template of play: zones with geometry (Reboot 6, and
// design/graphical-views.md section 2).
//
// Geometry is a TEMPLATE'S business, not core schema. The map was the wrong
// first-class citizen in the old system, so here a zone is an ordinary tag whose
// `templates.spatial` bag happens to carry a polygon, and a spatial group is an
// ordinary tag group with the same marker. Core preserves those bags, validates
// only what it knows, and NEVER compiles them: the runtime deals in tag names and
// has no idea the map exists.
//
// This module lives in `model` rather than in `ops` because both sides of the app
// need it and only one side may touch the filesystem: main reads polygons to work
// out which zone a dropped pin landed in, and the renderer reads them to draw. It
// is pure maths and field access, with no io of any kind.
// ---------------------------------------------------------------------------

import type { Tag, TagGroup, ViewPoint } from "./index.js";

/** The template's key in every `templates` bag it appears in. */
export const SPATIAL = "spatial";

/** A zone's outline, in the map's own coordinate space (the same space the view
 *  sidecar's sites use). No units: a map is to its own scale. */
export type Polygon = ViewPoint[];

/**
 * Where something sits in the stack: bigger is nearer the front.
 *
 * SPARSE, and the fallback is what makes it so: an item without one takes its
 * position in the list, which is the order everything already drew in, so a
 * project that has never been restacked looks exactly as it did. Only a moved
 * item gains a number, set midway between its new neighbours - the same scheme
 * cards, decks and hands use for authored order, and merge-clean for the same
 * reason: two authors restacking different things touch different entries.
 *
 * Generic on purpose. Zones need it now; BACKGROUNDS will need the identical
 * thing, in their own band below the zones, and this is the piece they share.
 */
export type Stacked = { id: string; z?: number };

/** A stack move, in the vocabulary every drawing tool uses. */
export type StackMove = "front" | "forward" | "backward" | "back";

/** Back to front: the order to DRAW in, so the frontmost lands on top. */
export function stacked<T extends Stacked>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, z: item.z ?? index }))
    .sort((a, b) => a.z - b.z)
    .map((entry) => entry.item);
}

/**
 * The `z` that puts `id` where the move asks, or undefined when it is already
 * there (so a no-op never writes a file or costs an undo step).
 *
 * Moving one place uses the midpoint between the item it passes and the one
 * beyond, which is why the numbers stay sparse and nothing has to be renumbered.
 */
export function restack<T extends Stacked>(items: T[], id: string, move: StackMove): number | undefined {
  const order = items
    .map((item, index) => ({ id: item.id, z: item.z ?? index }))
    .sort((a, b) => a.z - b.z);
  const at = order.findIndex((entry) => entry.id === id);
  if (at < 0 || order.length < 2) return undefined;
  const front = order.length - 1;

  if (move === "back") return at === 0 ? undefined : order[0]!.z - 1;
  if (move === "front") return at === front ? undefined : order[front]!.z + 1;
  if (move === "backward") {
    if (at === 0) return undefined;
    const passed = order[at - 1]!.z;
    const beyond = at >= 2 ? order[at - 2]!.z : passed - 2;
    return (passed + beyond) / 2;
  }
  if (at === front) return undefined;
  const passed = order[at + 1]!.z;
  const beyond = at + 2 <= front ? order[at + 2]!.z : passed + 2;
  return (passed + beyond) / 2;
}

/**
 * A background image behind a map: a picture of the real space, so a designer
 * (and later an experience runner) can map content onto somewhere physical.
 *
 * NOT a player-facing asset, which is what settles most of its design. The bytes
 * are never touched - no transcoding, no downscaling - because the file on disk
 * is also what a runtime server will one day serve, and legibility at a glance
 * matters more than fidelity.
 *
 * On the GROUP rather than on a zone, because zones cross images: a site plan is
 * one picture with a dozen zones traced over it, and half of them straddle two
 * sheets. Several per group, composing one picture - tiles of a large site, or
 * deliberate overlaps - never alternates, so nothing here is exclusive with
 * anything else.
 */
export interface SpatialBackground {
  /** Stable id, so two authors adding images do not collide. */
  id: string;
  /** The file's name inside the box's `assets/` folder. A NAME, not a path:
   *  assets belong to their box and travel with it. */
  file: string;
  /** Where it sits, in map units. Placement and scale in one rectangle, because
   *  a separate scale factor is a second thing to reason about and there is no
   *  rotation to make it worth having. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0 to 1, default 1. A tracing base wants to sit back. */
  opacity?: number;
  /** Its place in the stack among the OTHER BACKGROUNDS (see `stacked`).
   *  Backgrounds are a band strictly below the zones, structurally, so no value
   *  here can put an image over a zone. */
  z?: number;
  /** Out of the way while working on something else. */
  hidden?: boolean;
  /** Locked, the diagram-tool convention: invisible to the pointer, so clicks
   *  pass through to whatever is above. What a tracing base should be once it is
   *  placed. */
  locked?: boolean;
}

/** What the spatial template keeps on a GROUP: the marker, and the pictures
 *  behind the map. A bag rather than a boolean precisely so this could arrive
 *  without a schema change - the marker and the configuration are one object, so
 *  a group is spatial exactly when it has one. */
export interface SpatialGroup {
  /** Present and true for a spatial group. */
  map: true;
  backgrounds?: SpatialBackground[];
}

/** Is this group a map? */
export function isSpatial(group: TagGroup): boolean {
  return spatialOf(group) !== undefined;
}

/** The group's spatial configuration, or undefined when it is an ordinary group. */
export function spatialOf(group: TagGroup): SpatialGroup | undefined {
  const bag = group.templates?.[SPATIAL];
  if (!isRecord(bag) || bag["map"] !== true) return undefined;
  const backgrounds = backgroundsOf(group);
  return { map: true, ...(backgrounds.length > 0 ? { backgrounds } : {}) };
}

/**
 * The group's backgrounds, in DRAW order (back to front), skipping any entry
 * that is not one.
 *
 * Forgiving in the same way `polygonOf` is, and for the same reason: a
 * hand-edited or badly merged shard must not throw inside a canvas. Anything
 * malformed reads as absent HERE and is reported by validation instead, which is
 * a place an author can see it.
 */
export function backgroundsOf(group: TagGroup): SpatialBackground[] {
  const bag = group.templates?.[SPATIAL];
  if (!isRecord(bag)) return [];
  const list = bag["backgrounds"];
  if (!Array.isArray(list)) return [];
  const out: SpatialBackground[] = [];
  for (const entry of list) {
    const one = asBackground(entry);
    if (one) out.push(one);
  }
  return stacked(out);
}

/** One entry, or undefined when it is not a usable background. */
function asBackground(entry: unknown): SpatialBackground | undefined {
  if (!isRecord(entry)) return undefined;
  const { id, file, x, y, width, height, opacity, z, hidden, locked } = entry as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return undefined;
  if (typeof file !== "string" || file === "") return undefined;
  const nums = [x, y, width, height];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  // A rectangle with no area cannot be seen, dragged or scaled back up, so it is
  // not a background: validation says so rather than the canvas drawing nothing.
  if ((width as number) <= 0 || (height as number) <= 0) return undefined;
  return {
    id, file,
    x: x as number, y: y as number, width: width as number, height: height as number,
    ...(typeof opacity === "number" && Number.isFinite(opacity) ? { opacity: clamp01(opacity) } : {}),
    ...(typeof z === "number" && Number.isFinite(z) ? { z } : {}),
    ...(hidden === true ? { hidden: true } : {}),
    ...(locked === true ? { locked: true } : {}),
  };
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Where a dropped picture lands: fitted inside 60% of the viewport, in BOTH axes,
 * centred on `at`, in map units.
 *
 * It does NOT define the map's coordinate space and does not arrive at one pixel
 * to one unit (a 2816px site plan would fill the county). The requirement is
 * narrower and more useful: whatever the zoom, a picture arrives at a size
 * comfortable to GRAB.
 *
 * Computed once, at drop, and stored. Never re-derived from the camera, or the
 * picture would move about when somebody zoomed.
 *
 * 60% of the shorter side was the first rule and it was wrong: scale-invariant as
 * intended, but it put a 1.83:1 plan at a third of the width of a wide window,
 * which is fiddly to grab. Fitting both axes measures 55% x 60% of the view for
 * that image, at every zoom.
 */
export function droppedRect(
  natural: { width: number; height: number },
  view: { width: number; height: number },
  scale: number,
  at: ViewPoint,
): Rect {
  const safe = (n: number, fallback: number): number => (Number.isFinite(n) && n > 0 ? n : fallback);
  const naturalW = safe(natural.width, 1);
  const naturalH = safe(natural.height, 1);
  const room = { width: safe(view.width, 800) * 0.6, height: safe(view.height, 600) * 0.6 };
  const fit = Math.min(room.width / naturalW, room.height / naturalH) / safe(scale, 1);
  const width = Math.max(1, Math.round(naturalW * fit));
  const height = Math.max(1, Math.round(naturalH * fit));
  return { x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height };
}

/** Replace the group's backgrounds, returning the new `templates` bag. Keeps the
 *  marker and every other template's bag, as every writer here does. */
export function withBackgrounds(group: TagGroup, backgrounds: SpatialBackground[]): TagGroup["templates"] {
  const had = isRecord(group.templates?.[SPATIAL]) ? { ...(group.templates![SPATIAL] as Record<string, unknown>) } : {};
  had["map"] = true;
  if (backgrounds.length > 0) {
    had["backgrounds"] = backgrounds.map((b) => ({
      ...b,
      // Whole units in, exactly as polygons are: a rect dragged by hand would
      // otherwise write six decimal places of noise into a file two people have
      // to merge.
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.round(b.width), height: Math.round(b.height),
    }));
  } else delete had["backgrounds"];
  return setBag(group.templates, had);
}

/** A zone's outline, or undefined when the tag has never been drawn. Anything
 *  malformed reads as undefined here and is REPORTED by validation instead: a
 *  canvas that threw on a hand-edited shard would be a poor way to find out. */
export function polygonOf(tag: Tag): Polygon | undefined {
  const bag = tag.templates?.[SPATIAL];
  if (!isRecord(bag)) return undefined;
  const points = bag["polygon"];
  if (!Array.isArray(points) || points.length < 3) return undefined;
  const out: Polygon = [];
  for (const p of points) {
    if (!isRecord(p)) return undefined;
    const { x, y } = p as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") return undefined;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    out.push({ x, y });
  }
  return out;
}

/**
 * Mark a group spatial, or clear the marker, returning the new `templates` bag.
 *
 * Every one of these writers PRESERVES keys it does not own, because a shard may
 * carry another template's bag (or a newer version of this app's) and dropping it
 * would be data loss on a file somebody else owns.
 */
export function withSpatialGroup(group: TagGroup, on: boolean): TagGroup["templates"] {
  return setBag(group.templates, on ? { map: true } : undefined);
}

/** A zone's place in the stack, or undefined when it has never been moved. */
export function zOf(tag: Tag): number | undefined {
  const bag = tag.templates?.[SPATIAL];
  if (!isRecord(bag)) return undefined;
  const z = bag["z"];
  return typeof z === "number" && Number.isFinite(z) ? z : undefined;
}

/** Set a zone's place in the stack, returning the new `templates` bag. */
export function withZ(tag: Tag, z: number): Tag["templates"] {
  const had = isRecord(tag.templates?.[SPATIAL]) ? { ...(tag.templates![SPATIAL] as Record<string, unknown>) } : {};
  // Rounded to a sane precision: midpoints halve, and a z of 0.06249999999 in a
  // shard two people have to merge is noise nobody asked for.
  had["z"] = Math.round(z * 1000) / 1000;
  return setBag(tag.templates, had);
}

/** Set or clear a zone's outline, returning the new `templates` bag. */
export function withPolygon(tag: Tag, polygon: Polygon | undefined): Tag["templates"] {
  const had = isRecord(tag.templates?.[SPATIAL]) ? { ...(tag.templates![SPATIAL] as Record<string, unknown>) } : {};
  if (polygon === undefined) delete had["polygon"];
  // Rounded to whole units on the way in, exactly as canvas positions are: a
  // polygon dragged by hand would otherwise write six decimal places of noise
  // into a file two people have to merge.
  else had["polygon"] = polygon.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  return setBag(tag.templates, Object.keys(had).length > 0 ? had : undefined);
}

/** Replace (or remove) the spatial bag inside a `templates` record, keeping every
 *  other template's bag and dropping the record entirely when nothing is left. */
function setBag(
  templates: Record<string, unknown> | undefined, bag: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const next = { ...(templates ?? {}) };
  if (bag === undefined) delete next[SPATIAL];
  else next[SPATIAL] = bag;
  return Object.keys(next).length > 0 ? next : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// --- geometry ----------------------------------------------------------------
// Lifted from the old system's `canvasGeometry` helpers, which the storymap
// canvas proved (../storylets/docs/developer/storymap-canvas.md section 1).

export interface Rect { x: number; y: number; width: number; height: number }

/** The axis-aligned box around a polygon: what a canvas needs to hit-test
 *  cheaply, to place a selection ring, and to frame a fit. */
export function polygonBounds(polygon: Polygon): Rect {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * A polygon's centre of AREA, not the average of its vertices.
 *
 * The two agree only for regular shapes: on an outline with a cluster of vertices
 * along a fiddly coastline, the vertex average is dragged towards the crowded side.
 * Falls back to the vertex average for a degenerate (zero-area) polygon, where
 * there is no better answer.
 *
 * NOT the place to put a label: see `labelPoint`. The centre of area of a concave
 * shape can lie outside the shape, which an L-shaped zone demonstrates in one
 * line of arithmetic.
 */
export function centroid(polygon: Polygon): ViewPoint {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  if (twiceArea === 0) {
    const n = polygon.length;
    return n === 0
      ? { x: 0, y: 0 }
      : { x: polygon.reduce((s, p) => s + p.x, 0) / n, y: polygon.reduce((s, p) => s + p.y, 0) / n };
  }
  const scale = 1 / (3 * twiceArea);
  return { x: x * scale, y: y * scale };
}

/**
 * Where a zone's LABEL goes: a point guaranteed to be inside the zone.
 *
 * The centre of area is the obvious answer and it is wrong for concave outlines.
 * An L-shaped zone puts its centre of area in the notch, so a label placed there
 * sits outside its own zone, next to whatever is drawn in the gap. Since half the
 * zones anyone draws over a floor plan are L-shaped corridors, this needs to be
 * right rather than usually right.
 *
 * So: the centre of area when that is inside, and otherwise the middle of the
 * widest run of the zone along the horizontal line through it. That keeps the
 * label vertically where the eye expects and moves it sideways into the shape,
 * which for an L means "along the arm". Cheap, stable as the polygon is dragged,
 * and no substitute for the proper pole-of-inaccessibility if a zone ever needs
 * one.
 */
export function labelPoint(polygon: Polygon, opts: { bias?: "middle" | "top" } = {}): ViewPoint {
  if (polygon.length < 3) return centroid(polygon);

  // "top" is what a MAP wants, and it is not a nicety. The middle of a zone is
  // where its contents live: sites sit there, so a name in the middle collides with
  // the hands standing in the place it names. Worse, zones nest (a square inside a
  // district, a room inside a wing), and a containing zone's middle is somebody
  // else's zone entirely. A name near the top edge is clear of both, and it is
  // where a reader looks for the name of a frame anyway.
  const box = polygonBounds(polygon);
  if (opts.bias === "top") {
    // Not a fixed fraction down. A shape that comes to a POINT at the top (a
    // headland, a gable, a cave mouth) has almost no width up there, so a fixed
    // line put the name in a sliver and it spilled over both edges. Sample several
    // lines and take the HIGHEST one that is nearly as roomy as the best of them:
    // near the top when the top is wide, lower when the top is a spike.
    const lines: { y: number; run: { x: number; width: number } }[] = [];
    for (let i = 1; i <= 8; i++) {
      const y = box.y + (box.height * i) / 12;
      const run = widestRun(polygon, y);
      if (run && run.width > 0) lines.push({ y, run });
    }
    const widest = Math.max(0, ...lines.map((l) => l.run.width));
    const pick = lines.find((l) => l.run.width >= widest * 0.7);
    if (pick) return { x: pick.run.x, y: pick.y };
  }

  const y = centroid(polygon).y;
  const run = widestRun(polygon, y);
  if (run) return { x: run.x, y };

  // No interior on that line (a shape pinched at the chosen height): fall back to
  // the centre of area, and then to its own widest run if that is outside too.
  const middle = centroid(polygon);
  if (pointInPolygon(middle, polygon)) return middle;
  const rescue = widestRun(polygon, middle.y);
  return rescue ? { x: rescue.x, y: middle.y } : middle;
}

/** The roomiest stretch of the polygon's interior along one horizontal line, or
 *  undefined when the line misses the shape. Consecutive crossings bound the runs
 *  INSIDE the outline, which is the ray-casting argument again. */
function widestRun(polygon: Polygon, y: number): { x: number; width: number } | undefined {
  const crossings: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > y === b.y > y) continue;
    crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  crossings.sort((p, q) => p - q);
  let best: { x: number; width: number } | undefined;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const from = crossings[i]!;
    const to = crossings[i + 1]!;
    if (!best || to - from > best.width) best = { x: (from + to) / 2, width: to - from };
  }
  return best;
}

/**
 * Is this point inside the polygon? The ray-casting test, which handles concave
 * outlines and self-touching ones alike.
 *
 * This is the function that earns the map its keep: dragging a hand's pin from
 * the docks into the market is not a cosmetic act, it rebinds the hand, and this
 * is how the view knows which zone the pin was dropped in.
 */
export function pointInPolygon(point: ViewPoint, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    // Half-open edge test on y, so a point level with a shared vertex is counted
    // once rather than twice or not at all.
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const at = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < at) inside = !inside;
  }
  return inside;
}

/**
 * Which zone a point falls in, given the zones of a spatial group in draw order.
 *
 * Zones may overlap (a room inside a wing, a market square inside a district), so
 * "which one" needs an answer rather than a shrug: the FRONTMOST match wins,
 * because that is the one drawn on top and therefore the one the author sees at
 * that point. Front is the stack (see `stacked`), which for a project nobody has
 * restacked is the order the zones are listed in, exactly as before. Returns
 * undefined for a point in open space.
 */
export function zoneAt(point: ViewPoint, zones: (Stacked & { polygon: Polygon })[]): string | undefined {
  return zonesAt(point, zones)[0];
}

/**
 * EVERY zone a point falls in, frontmost first.
 *
 * `zoneAt` is this list's head, so the two cannot disagree about which zone wins.
 * The tail is what an author needs telling about: zones are allowed to overlap,
 * so a site can sit inside two outlines while belonging to exactly one of them,
 * and a picture that shows containment the model does not have is a picture that
 * misleads. The editor uses the length of this to say so.
 */
export function zonesAt(point: ViewPoint, zones: (Stacked & { polygon: Polygon })[]): string[] {
  const order = stacked(zones);
  const hits: string[] = [];
  // Back-to-front in the stack, collected front-first: the frontmost match is the
  // one drawn on top, and therefore the one the author sees at that point.
  for (let i = order.length - 1; i >= 0; i--) {
    const zone = order[i]!;
    if (pointInPolygon(point, zone.polygon)) hits.push(zone.id);
  }
  return hits;
}
