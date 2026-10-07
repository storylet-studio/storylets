// ---------------------------------------------------------------------------
// What the project map SAYS: the strip's line about the thing selected, the
// line while a zone is being traced, and the hover tip that stands in for a
// name the zoom has taken away.
//
// Out of map-view.ts so the wording can be pinned without a canvas. Every
// sentence here is one an author reads while deciding whether to drag a pin,
// and the difference between "moves the hand" and "moves nothing" is the
// whole point of most of them.
// ---------------------------------------------------------------------------

import { plural } from "@wildwinter/app-shell";
import { LABEL_FLOOR } from "./map-art.js";
import { FURNITURE_TEXT_FLOOR } from "./furniture-art.js";
import type { MapItem } from "./map-view.js";

/** A box's name as a person reads it. */
export const layerName = (l: { title?: string; gameId: string }): string => l.title ?? l.gameId;

/** "a", "a and b", "a, b and c": a list an author reads, not a join. */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
}

/** What a hand can do about its binding: whether dragging its pin means
 *  anything, and if not because of a template, which one. */
export interface SiteRule { rebinds: boolean; fixedBy?: string | undefined }

/** The pin, as far as the words need it. */
export interface SiteWords {
  title: string;
  zone?: string | undefined;
  strayFrom?: string | undefined;
  alsoInside?: string[] | undefined;
}

/** What a selected pin says about itself: which zone its hand belongs to, and
 *  whether dragging it can change that. */
export function describeSite(
  site: SiteWords, rule: SiteRule | undefined, zoneName: (id: string) => string | undefined,
): string {
  const where = site.zone === undefined ? "no zone yet" : (zoneName(site.zone) ?? "a zone");
  const others = site.alsoInside ?? [];
  const also = others.length === 0 ? "" : ` Also inside ${listNames(others)}, which does not count.`;
  if (site.strayFrom !== undefined) {
    return `"${site.title}" is dealt in ${site.strayFrom}, but its pin stands outside it. Drag it back into ${site.strayFrom}${rule?.rebinds === true ? ", or into another zone to move the hand" : ""}.`;
  }
  if (rule?.rebinds === true) {
    return site.zone === undefined
      ? `${site.title} is in ${where}. Drag it into one to bind it.${also}`
      : `${site.title} is in ${where}. Drag it to another to move the hand.${also}`;
  }
  if (rule?.fixedBy !== undefined) {
    return `${site.title} is in ${where}, fixed by the template "${rule.fixedBy}" for every hand it makes.${also}`;
  }
  return `${site.title} doesn't use the map's zones, so its pin only marks a spot.${also}`;
}

/** Why a dropped pin moved nothing: its template binds every hand it makes. */
export const fixedDropLine = (title: string, fixedBy: string): string =>
  `"${title}" stays in the zone its template "${fixedBy}" gives every hand it makes, so moving its pin moves nothing.`;

/** The strip while something is being traced or placed: how to finish, and
 *  nothing else. `corners` is how many have been laid so far. */
export function tracingHint(label: string, drawing: boolean, corners: number): string {
  if (!drawing) return `Click where ${label} sits`;
  if (corners === 0) return `Click to place the first corner of ${label}`;
  if (corners < 3) return `${label}: ${plural(corners, "corner")} so far`;
  return `Click the first corner of ${label} again, or press Enter, to close it`;
}

/**
 * The editing strip's line about the selection. `what` is the one thing
 * selected, if exactly one is; `picked` the zone corner picked, if any.
 */
export function editHint(
  what: MapItem | undefined, selected: number, picked: number | undefined, site: (s: Extract<MapItem, { kind: "site" }>) => string,
): string {
  if (what === undefined) return selected > 1 ? `${selected} selected` : "Zones are the project's. Hands go to the active layer.";
  if (what.kind === "background") return `${what.title} is a picture behind the map. Drag it, or lock it once it's right.`;
  if (what.kind === "frame") return `${what.title ?? "Frame"} is a frame. Drag its bar to move it, or double-click to rename it.`;
  if (what.kind === "zone") {
    return picked !== undefined
      ? `Corner ${picked + 1} of ${what.title} is picked. Delete removes it.`
      : `${what.title} is a zone. Drag a corner to reshape it, or a mid-point to add one.`;
  }
  return site(what);
}

/**
 * The rollover for one item: the name the zoom has taken away, or what a
 * pin's ring is warning about. Below the label floor the map is shapes and
 * dots with no names, and this is how you ask which is which without zooming
 * back in.
 *
 * `boxName` is the box a pin belongs to, by name; `manyBoxes` whether the map
 * has more than one, since the box is the one thing a pin's label never says.
 */
export function mapHoverTip(
  item: MapItem, scale: number,
  ctx: { zoneName: (id: string) => string | undefined; boxName: (box: string) => string | undefined; manyBoxes: boolean },
): string | undefined {
  // A frame's name goes at a floor of its own (furniture-art.ts).
  if (item.kind === "frame") return scale < FURNITURE_TEXT_FLOOR ? (item.title ?? "Frame") : undefined;
  if (item.kind === "site" && item.strayFrom !== undefined) {
    return `${item.title} is dealt in ${item.strayFrom}, but its pin stands outside it.`;
  }
  if (item.kind === "site" && item.alsoInside !== undefined && item.alsoInside.length > 0) {
    const own = item.zone === undefined ? undefined : ctx.zoneName(item.zone);
    return own === undefined
      ? `${item.title} sits inside ${listNames(item.alsoInside)}. Zones don't nest, so dropping it binds to the frontmost one only.`
      : `${item.title} belongs to ${own}. It also sits inside ${listNames(item.alsoInside)}, which counts for nothing. Zones are tags, so they don't nest, and a hand belongs to the frontmost zone around it.`;
  }
  if (item.kind === "site" && scale >= LABEL_FLOOR) {
    // The box is the one thing the label never says, and the tint only hints
    // at it.
    const box = ctx.boxName(item.box);
    return box !== undefined && ctx.manyBoxes ? `${item.title}, ${box}` : undefined;
  }
  if (scale >= LABEL_FLOOR) return undefined;
  return item.kind === "site" ? `${item.title}, ${ctx.boxName(item.box)!}` : item.title;
}
