// ---------------------------------------------------------------------------
// Canvas furniture: reading the frames off a sidecar, safely.
//
// Forgiving in exactly the way `backgroundsOf` is, and for the same reason: a
// sidecar is a file a human can edit and a merge can mangle, and a canvas must
// never throw while drawing. Anything malformed reads as ABSENT here, which
// loses one piece of furniture rather than the whole view.
//
// There is no validation pass to complain to, either, and that is deliberate:
// furniture is arrangement, not content, so a broken entry is not a problem with
// somebody's story. It is a scribble that did not survive, and the honest
// response is to draw what is left.
// ---------------------------------------------------------------------------

import { stacked } from "./spatial.js";
import { FURNITURE_COLOURS } from "./index.js";
import type { CanvasFurniture, FurnitureColour, Frame } from "./index.js";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const colourOf = (v: unknown): FurnitureColour | undefined =>
  typeof v === "string" && (FURNITURE_COLOURS as readonly string[]).includes(v)
    ? v as FurnitureColour
    : undefined;

/** The frames on a canvas, in DRAW order (back to front). */
export function framesOf(canvas: CanvasFurniture | undefined): Frame[] {
  const list = canvas?.frames;
  if (!Array.isArray(list)) return [];
  const out: Frame[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = entry["id"];
    const x = num(entry["x"]), y = num(entry["y"]);
    const w = num(entry["w"]), h = num(entry["h"]);
    if (typeof id !== "string" || id === "") continue;
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    // A frame with no extent is not a frame. Zero or negative would draw as
    // nothing and be impossible to grab, so it reads as absent rather than as a
    // trap somebody has to find with a text editor.
    if (w <= 0 || h <= 0) continue;
    const title = entry["title"];
    const colour = colourOf(entry["colour"]);
    const z = num(entry["z"]);
    out.push({
      id, x, y, w, h,
      ...(typeof title === "string" && title !== "" ? { title } : {}),
      ...(colour !== undefined ? { colour } : {}),
      ...(z !== undefined ? { z } : {}),
    });
  }
  return stacked(out);
}

