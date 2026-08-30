// ---------------------------------------------------------------------------
// Shared spaces: boxes that carry the SAME spatial group are one place seen
// by several systems (Port Meridian's districts: contracts, encounters,
// items and news each copy the identical geometry), and the play surfaces
// should draw that place ONCE with every box's hands on it, rather than
// repeat the picture per box (design/playable-maps.md, the author's ruling).
//
// Detection is deliberately strict - same group gameId, same zone tag
// gameIds, identical polygons - so nothing merges by accident. Zone ORDER is
// forgiven (sorted before comparing): reordering tags is housekeeping, not a
// different place. Backgrounds are not part of the identity; the first
// member's pictures stand for the space.
// ---------------------------------------------------------------------------

import { effectiveGameId, isSpatial, polygonOf } from "@storylet-studio/model";
import type { SourceProject } from "@storylet-studio/compiler";

export interface SharedSpace {
  /** The group gameId every member shares. */
  group: string;
  /** Member box gameIds, in project order; the first is the canonical geometry. */
  boxes: string[];
}

/** Every group of two-or-more boxes whose spatial groups are the same place. */
export function sharedSpaces(source: SourceProject): SharedSpace[] {
  const byKey = new Map<string, SharedSpace>();
  const order: string[] = [];
  for (const box of source.boxes) {
    for (const group of box.tags.groups.filter(isSpatial)) {
      const zones = group.tags
        .map((tag) => ({ tag: effectiveGameId(tag), polygon: polygonOf(tag) }))
        .filter((z) => z.polygon !== undefined)
        .sort((a, b) => a.tag.localeCompare(b.tag));
      if (zones.length === 0) continue;
      const key = `${effectiveGameId(group)}|${JSON.stringify(zones.map((z) => [z.tag, z.polygon!.map((p) => [p.x, p.y])]))}`;
      const found = byKey.get(key);
      if (found) { found.boxes.push(effectiveGameId(box.box.box)); continue; }
      byKey.set(key, { group: effectiveGameId(group), boxes: [effectiveGameId(box.box.box)] });
      order.push(key);
    }
  }
  return order.map((key) => byKey.get(key)!).filter((space) => space.boxes.length > 1);
}
