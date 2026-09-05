// ---------------------------------------------------------------------------
// Maps in the bundle: the geometry opt-in (design/graphical-views.md 2, "The map
// MAY ship with a bundle, if asked").
//
// This is the ONE exception to the compiler's standing rule that templates bags
// are source-only, and it is deliberately shaped as an exception: a separate
// module, off unless the project asked, producing a self-contained block that
// nothing else in the bundle refers to. The runtime never reads it. Take the
// flag away and the bundle is byte-for-byte what it was.
//
// It flattens rather than copies. A source zone is a tag whose `templates.spatial`
// bag happens to hold a polygon, which is the right shape for an editor and the
// wrong one for a host: a host wants "here are the places and here is what to
// draw", by the same names it passes to `peek`, with no internal ids and no
// authoring state (locked, hidden, stacking) that only meant something while
// somebody was drawing.
// ---------------------------------------------------------------------------

import {
  backgroundsOf, bundleAssetPath, effectiveGameId, isSpatial, polygonOf,
} from "@storylet-studio/model";
import type { BundleBackground, BundleMap } from "@storylet-studio/model";
import type { SourceProject } from "./project.js";

/** One spatial group with something drawn on it: the walk both map builders
 *  do, done once.
 *
 *  The bundle's maps and the playable page's maps flatten the same source in
 *  the same order by the same rules - a spatial group, its zones' polygons, its
 *  visible backgrounds, and the "declared and never drew" skip. They differ
 *  only in where a background's PICTURE comes from: the bundle names a path,
 *  the playable page inlines a data URI. So the walk lives here and the two
 *  callers supply the ending.
 *
 *  export-html's copy had drifted to citing this file for the skip rule in a
 *  comment ("compileMaps' own rule") while re-implementing it, which is the
 *  form this kind of duplication takes just before the two stop agreeing. */
export interface SpatialGroup {
  box: SourceProject["boxes"][number];
  boxGameId: string;
  group: SourceProject["boxes"][number]["tags"]["groups"][number];
  groupGameId: string;
  /** Tags that have a drawn polygon, in group order. A tag without one is not
   *  a place yet: shipping an empty shape would make a host draw nothing at
   *  the origin, which is worse than knowing the zone has no geometry. */
  zones: { tag: string; polygon: { x: number; y: number }[] }[];
  /** The group's backgrounds with the hidden ones dropped, raw. */
  backgrounds: ReturnType<typeof backgroundsOf>;
}

/** Every spatial group worth drawing, in box then group order. A group with
 *  neither zones nor visible backgrounds is a map somebody declared and never
 *  drew, and is not returned. */
export function spatialGroups(source: SourceProject): SpatialGroup[] {
  const out: SpatialGroup[] = [];
  for (const box of source.boxes) {
    const boxGameId = effectiveGameId(box.box.box);
    for (const group of box.tags.groups) {
      if (!isSpatial(group)) continue;
      const zones: SpatialGroup["zones"] = [];
      for (const tag of group.tags) {
        const polygon = polygonOf(tag);   // already refuses anything under 3 points
        if (polygon === undefined) continue;
        zones.push({ tag: effectiveGameId(tag), polygon: polygon.map((p) => ({ x: p.x, y: p.y })) });
      }
      const backgrounds = backgroundsOf(group).filter((b) => b.hidden !== true);
      if (zones.length === 0 && backgrounds.length === 0) continue;
      out.push({ box, boxGameId, group, groupGameId: effectiveGameId(group), zones, backgrounds });
    }
  }
  return out;
}

/**
 * Every map the project has, flattened for the bundle, in box then group order.
 *
 * Returns undefined rather than an empty array when there is nothing to ship, so
 * a project that turns the flag on before drawing anything gets no `maps` key at
 * all instead of an empty one that reads like a broken export.
 */
export function compileMaps(source: SourceProject): BundleMap[] | undefined {
  const maps: BundleMap[] = spatialGroups(source).map((g) => {
    const backgrounds: BundleBackground[] = g.backgrounds.map((b) => ({
      file: bundleAssetPath(g.boxGameId, b.file),
      x: b.x, y: b.y, width: b.width, height: b.height,
      ...(b.opacity !== undefined ? { opacity: b.opacity } : {}),
    }));
    const sites = compileSites(g.box);
    return {
      box: g.boxGameId,
      group: g.groupGameId,
      zones: g.zones,
      ...(backgrounds.length > 0 ? { backgrounds } : {}),
      ...(sites.length > 0 ? { sites } : {}),
    };
  });

  return maps.length > 0 ? maps : undefined;
}

/**
 * Where a box's placed hands stand, as the bundle carries them
 * (design/engine-server.md 4.3).
 *
 * Read from the VIEW SIDECAR, which is the only place a position has ever been
 * kept, and translated to gameIds on the way out like everything else in this
 * block. That the compiler can see the sidecar at all is not new: `SourceBox.view`
 * has always been parsed, so nothing had to be threaded through for this.
 *
 * Per BOX, not per group, because that is where the positions live: a box has one
 * set of sites and draws them on whichever of its maps is open, which is the rule
 * the editor and the playable page already follow. A box with two spatial groups
 * therefore ships the same sites on both, and that is the honest answer rather
 * than an invented split.
 *
 * Sorted by hand gameId so the bytes do not move when somebody reorders a shard.
 */
function compileSites(box: SourceProject["boxes"][number]): NonNullable<BundleMap["sites"]> {
  const placed = box.view?.map?.sites ?? {};
  const sites: NonNullable<BundleMap["sites"]> = [];
  for (const hand of box.hands.hands) {
    const at = placed[hand.id];
    if (at === undefined) continue;
    sites.push({ hand: effectiveGameId(hand), x: at.x, y: at.y });
  }
  return sites.sort((a, b) => (a.hand < b.hand ? -1 : a.hand > b.hand ? 1 : 0));
}
