// ---------------------------------------------------------------------------
// What the map draws: zone shapes and hand sites. The behaviour lives in
// canvas-surface, the geometry in @storylet-studio/model; this is the ink.
//
// Beside node-art rather than inside it: a zone is not a card, and the two share
// the surface and the tokens, not the shapes. What they DO share is the
// vocabulary an author has already learnt on the node canvas - identity colour
// carries which thing a shape belongs to, chrome holds a floor in screen pixels,
// and a label is a title and never a gameId.
//
// Zone colour comes from the shell's `colourIndex` by zone NAME, the same hash
// that gives a deck its stripe, so a zone is the same colour on the map as its tag
// chip is in the inspector.
// ---------------------------------------------------------------------------

import Konva from "konva";
import { imageFor } from "./image-cache.js";
import type { CanvasItem, DrawContext } from "./canvas-surface.js";
import { charColour, type CanvasTokens } from "./canvas-tokens.js";
import { labelPoint, polygonBounds } from "@storylet-studio/model";
import type { Polygon, ViewPoint } from "@storylet-studio/model";

/** A site is a point, so its "size" is chrome rather than content. */
export const PIN_R = 9;
const PIN_LABEL_GAP = 6;
/** Below this a zone's name is mush, so it goes rather than shrinking. */
export const LABEL_FLOOR = 0.35;
/** A zone's fill is a wash: the background (later) and the sites on top have to
 *  read through it. */
const ZONE_FILL_ALPHA = 0.18;
const ZONE_FILL_ALPHA_HOVER = 0.3;

/** A zone as the canvas holds it: an item positioned at its bounding box's
 *  top-left, with the outline relative to that origin. */
export interface ZoneShape extends CanvasItem {
  /** What the author called it. Drawn; never the gameId. */
  title: string;
  /** For the identity colour, so it agrees with the tag chip elsewhere. */
  name: string;
  /** The outline, relative to the item's origin (CanvasItem.outline's contract). */
  outline: ViewPoint[];
}

/** A hand's site: where a standing hand sits on this map. */
export interface SiteShape extends CanvasItem {
  /** The hand's title or gameId. */
  title: string;
  /** For the identity colour. */
  name: string;
  /** The id of the zone the hand sits in, when it sits in one on THIS map. For
   *  logic, never for ink. */
  zone?: string;
  /** That zone's NAME, which is what the site is coloured by, so a site matches
   *  the ground under it and one that has drifted off its zone is visible as
   *  whose colour disagrees with it. Hashing the zone's ID would give a colour
   *  from an opaque string that agrees with nothing (the zone's own colour comes
   *  from its name, as every identity colour in this app does). */
  zoneName?: string;
  /** Nothing is holding this hand's binding: drawn hollow. */
  unbound?: boolean;
  /**
   * The NAMES of the other zones whose outlines this site also falls inside,
   * when there is more than one. Empty or absent means no ambiguity to report.
   *
   * A zone is a tag and the engine has no geometry, so overlapping outlines do
   * not nest: a site belongs to the FRONTMOST zone containing it and to no other,
   * however much the picture suggests otherwise. That is a rule an author cannot
   * see, which is the whole reason it is marked (graphical-views 2).
   */
  alsoInside?: string[];
  /** The coverage overlay's reading: 0..1 against the busiest hand, -1 for a
   *  hand the run never dealt into, undefined when the overlay is off. */
  heat?: number;
  /** Filtered out: still there, still where it is, but not what is being looked
   *  at. The Board sets this when a zone is being shown on its own; the editor
   *  never does, because an editor filtering its own map would be hiding the
   *  thing the author is editing. */
  quiet?: boolean;
}

/**
 * Turn a zone's polygon into a canvas item.
 *
 * The item's box is the polygon's bounding box, which is what the surface needs
 * for marquees and fits; the DRAWN shape is the polygon itself, so Konva hit-tests
 * the real outline and a click on the courtyard inside a C-shaped zone does not
 * select the zone.
 */
export function zoneShape(zone: { id: string; title: string; name: string; polygon: Polygon }): ZoneShape {
  const box = polygonBounds(zone.polygon);
  return {
    id: zone.id,
    title: zone.title,
    name: zone.name,
    x: box.x, y: box.y, width: box.width, height: box.height,
    outline: zone.polygon.map((p) => ({ x: p.x - box.x, y: p.y - box.y })),
  };
}

export function drawZone(item: ZoneShape, ctx: DrawContext): Konva.Group {
  const { tokens, scale } = ctx;
  const group = new Konva.Group();
  const ink = charColour(tokens, item.name);
  const points: number[] = [];
  for (const p of item.outline) points.push(p.x, p.y);

  group.add(new Konva.Line({
    points, closed: true,
    fill: rgba(ink, ZONE_FILL_ALPHA),
    stroke: ink,
    // A zone's edge is where its boundary IS, so it holds a floor on screen: at a
    // whole-site zoom a hairline outline stops reading as a boundary at all.
    strokeWidth: Math.max(1.5, 2 / scale),
  }));

  // The NAME is not drawn here: see paintZoneLabels.
  return group;
}

/**
 * Every zone's name, drawn in the surface's foreground layer.
 *
 * Two decisions, both found by looking at a map of nested zones:
 *
 * Above ALL the shapes, not inside its own group, because zones nest. A district
 * contains a square; the square is drawn later; so a name inside the district's
 * own group vanished under the square's fill. This is what the foreground layer is
 * for.
 *
 * Near the TOP of its shape, and inside it even when the shape is concave. The
 * middle of a zone is where its sites stand and where a nested zone sits, so a name
 * in the middle collides with the very things the zone contains. `labelPoint`
 * guarantees inside; the top bias keeps it clear (model/spatial.ts).
 */
export function paintZoneLabels(
  layer: Konva.Container, scale: number, tokens: CanvasTokens,
  zones: { id: string }[], at: (id: string) => ZoneShape | undefined,
): void {
  if (scale < LABEL_FLOOR) return;
  for (const zone of zones) {
    const item = at(zone.id);
    if (!item?.outline) continue;
    const point = labelPoint(item.outline, { bias: "top" });
    const text = halo(new Konva.Text({
      text: item.title,
      fontFamily: tokens.fontUi, fontSize: 12 / scale,
      fill: tokens.ink, listening: false, align: "center",
    }), tokens, scale);
    // Clear of the zone's own top edge. The label point is a FRACTION down the
    // shape, which on a small zone lands within half a line of the border and the
    // name straddles it. The text knows its own height and the edge is right here,
    // so the clamp belongs at the drawing, not in the geometry.
    const margin = 3 / scale;
    text.position({
      x: item.x + point.x - text.width() / 2,
      y: Math.max(item.y + point.y - text.height() / 2, item.y + margin),
    });
    layer.add(text);
  }
}

/**
 * Give a label a halo, the way a map does.
 *
 * Every name on this canvas used to sit on flat paper, where ink on paper was
 * contrast enough. A background image takes that away: the first real site plan
 * put "the-forge" across a brown roofline and the word simply disappeared, and it
 * only READ anywhere else by the accident of that patch being pale sky.
 *
 * A halo rather than a plate behind the text, which is the cartographic answer
 * and the right one here: a plate would hide the very picture the label is there
 * to annotate, while an outline in the paper colour lifts the name off ANY ground
 * and costs a couple of pixels around the glyphs. `fillAfterStrokeEnabled` is
 * what makes it a halo rather than an outlined font - the stroke goes down first
 * and the fill covers its inner half.
 *
 * Held to a screen size like every other label here, so it neither fattens as you
 * zoom in nor swallows the word as you zoom out.
 */
function halo(text: Konva.Text, tokens: CanvasTokens, scale: number): Konva.Text {
  text.stroke(tokens.surface);
  text.strokeWidth(3 / scale);
  text.fillAfterStrokeEnabled(true);
  return text;
}

/** A site: a disc at the hand's point, with its name beside it. The disc holds a
 *  constant size on screen, because it is a marker rather than a place. */
export function drawSite(item: SiteShape, ctx: DrawContext): Konva.Group {
  const { tokens, scale } = ctx;
  const group = new Konva.Group();
  // Quiet, never hidden. A filtered map that dropped its sites would change
  // SHAPE as you filtered it, and a map you cannot recognise is not a map.
  if (item.quiet === true) group.opacity(0.35);
  const ink = item.zoneName !== undefined ? charColour(tokens, item.zoneName) : tokens.muted;
  const r = PIN_R / scale;

  // The coverage HALO, outside the disc. The disc keeps its zone colour, because
  // that is the site's identity and losing it would cost more than the reading
  // gains: a map whose colours mean deal counts is no longer a map of the place.
  // A ring around it can be read alongside, the way a highlight is.
  if (item.heat !== undefined) {
    const cold = item.heat < 0;
    group.add(new Konva.Circle({
      x: item.width / 2, y: item.height / 2,
      radius: r + (cold ? 4 : 4 + 7 * item.heat) / scale,
      // Never dealt into is a DASHED ring, not simply the faintest one: the
      // difference between "coldest" and "never" is the finding, and a
      // continuous scale cannot say it.
      stroke: cold ? tokens.warn : tokens.accent,
      strokeWidth: 2 / scale,
      opacity: cold ? 1 : 0.3 + 0.6 * item.heat,
      dash: cold ? [3 / scale, 3 / scale] : undefined,
    }));
  }

  // AMBIGUOUS CONTAINMENT: this site sits inside more than one outline, and only
  // the frontmost owns it. A small warn-toned ring OUTSIDE the disc, so it reads
  // as an annotation on the site rather than as part of its identity - the disc
  // keeps its zone colour, which is what the site IS. Not danger: nothing is
  // broken, the rule resolved it, and the author may well have meant it.
  if (item.alsoInside !== undefined && item.alsoInside.length > 0) {
    group.add(new Konva.Circle({
      x: item.width / 2, y: item.height / 2, radius: r + 3 / scale,
      stroke: tokens.warn, strokeWidth: 1.5 / scale,
      dash: [2 / scale, 2 / scale],
    }));
  }

  group.add(new Konva.Circle({
    x: item.width / 2, y: item.height / 2, radius: r,
    // Hollow when nothing binds it: an unbound hand is a real state, and a site
    // that looked bound would be a lie about the content.
    fill: item.unbound ? tokens.surface : ink,
    stroke: item.unbound ? tokens.muted : tokens.surface,
    strokeWidth: 2 / scale,
    dash: item.unbound ? [3 / scale, 3 / scale] : undefined,
  }));

  if (scale >= LABEL_FLOOR) {
    const text = halo(new Konva.Text({
      text: item.title,
      fontFamily: tokens.fontUi, fontSize: 11 / scale,
      fill: tokens.ink, listening: false,
    }), tokens, scale);
    text.position({
      x: item.width / 2 + r + PIN_LABEL_GAP / scale,
      y: item.height / 2 - text.height() / 2,
    });
    group.add(text);
  }
  return group;
}

/**
 * A background image behind the map: an orientation aid, so a designer can put
 * the content somewhere physical (design/graphical-views.md section 2).
 *
 * An ITEM rather than backdrop painting, because it has to be selectable and
 * draggable when it is unlocked - and `locked` is what makes that safe: a locked
 * background is invisible to the pointer, so a tracing base under everything
 * never answers for a click meant for a zone.
 */
export interface BackgroundShape extends CanvasItem {
  /** For a menu and a tooltip to name it. */
  title: string;
  /** Where the renderer loads it from. */
  url: string;
  opacity?: number;
  /** The file is not where the shard says: a placeholder is drawn instead. */
  missing?: boolean;
}

export function backgroundShape(
  background: {
    id: string; file: string; url: string;
    x: number; y: number; width: number; height: number;
    opacity?: number; locked?: boolean; missing?: boolean;
  },
): BackgroundShape {
  return {
    id: background.id,
    title: background.file,
    url: background.url,
    x: background.x, y: background.y, width: background.width, height: background.height,
    ...(background.opacity !== undefined ? { opacity: background.opacity } : {}),
    ...(background.locked === true ? { locked: true } : {}),
    ...(background.missing === true ? { missing: true } : {}),
  };
}

/**
 * Draw one background, or a placeholder for one that is not here.
 *
 * The image is asked for synchronously and may not exist yet (image-cache.ts):
 * a draw happens inside a repaint and cannot wait, so the first paint of a new
 * picture is the placeholder and the arrival triggers another.
 *
 * A MISSING file draws the same placeholder rather than nothing. Nothing would
 * leave an author looking at empty canvas wondering where their plan went; a
 * marked rectangle where it should be says "here, and absent", with validation
 * naming the file.
 */
export function drawBackground(item: BackgroundShape, ctx: DrawContext): Konva.Group {
  const { tokens, scale } = ctx;
  const group = new Konva.Group();
  const image = item.missing === true ? undefined : imageFor(item.url);

  if (image) {
    group.add(new Konva.Image({
      image, x: 0, y: 0, width: item.width, height: item.height,
      opacity: item.opacity ?? 1,
      // A tracing base is scaled, panned over and zoomed through constantly, and
      // smoothing every frame of that is where the time would go.
      imageSmoothingEnabled: true,
    }));
    return group;
  }

  group.add(new Konva.Rect({
    x: 0, y: 0, width: item.width, height: item.height,
    fill: rgba(tokens.muted, 0.06),
    stroke: tokens.lineSoft,
    strokeWidth: Math.max(1, 1 / scale),
    dash: [6 / scale, 5 / scale],
  }));
  // Named, because "which picture is missing" is the only useful thing a
  // placeholder can say. Held to a screen size like every other label here.
  if (scale >= LABEL_FLOOR) {
    const text = new Konva.Text({
      text: item.missing === true ? `${item.title} (not found)` : item.title,
      fontFamily: tokens.fontUi, fontSize: 12 / scale,
      fill: tokens.muted, listening: false,
    });
    text.position({ x: 8 / scale, y: 8 / scale });
    group.add(text);
  }
  return group;
}

/** The site's item box: a point has no extent, so it gets a square the size of its
 *  disc, centred on the point, which is what the surface drags and marquees. */
export function siteShape(
  site: { id: string; title: string; name: string; at: ViewPoint; zone?: string; zoneName?: string },
): SiteShape {
  const size = PIN_R * 2;
  return {
    id: site.id,
    title: site.title,
    name: site.name,
    x: site.at.x - PIN_R, y: site.at.y - PIN_R, width: size, height: size,
    // Selecting a disc used to draw a SQUARE round it, because the surface rings
    // an item by its bounding box unless the item says otherwise, and the box of
    // a point is a square. `outline` could not fix it: the disc holds a constant
    // size on SCREEN and an outline is world units, so a polygon would fit at one
    // zoom only. The same constant the disc draws from, so the two cannot drift.
    discRadius: PIN_R,
    ...(site.zone !== undefined
      ? { zone: site.zone, ...(site.zoneName !== undefined ? { zoneName: site.zoneName } : {}) }
      : { unbound: true }),
  };
}

/** Back from an item box to the point it marks. */
export const sitePoint = (item: CanvasItem): ViewPoint =>
  ({ x: item.x + item.width / 2, y: item.y + item.height / 2 });

/** A token colour at partial alpha. Tokens are hex or rgb(); Konva takes rgba. */
export function rgba(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(colour.trim());
  if (rgb) {
    const parts = rgb[1]!.split(",").map((p) => p.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return colour;
}


