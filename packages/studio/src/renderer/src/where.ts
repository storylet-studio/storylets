// ---------------------------------------------------------------------------
// The Where row's model (design/where-and-selectors.md, Part A).
//
// "Where does this card come up?" answered as a sentence, built from the home
// group plus every SPATIAL tag group. Spatial-means-place is the rule that
// scales: a group that draws on a map is a place axis; one that does not
// (mood, pacing) stays in the ordinary Tags rows.
//
// Pure functions over the DTOs, no DOM, so the sentence and the conflict rule
// are testable the way the ranking hints are not. The chips and the popover
// live in inspector.ts and render what this file decides.
// ---------------------------------------------------------------------------

import type { BoxDto } from "../../shared/api.js";
import { PLACE_GROUP } from "@storylet-studio/model";

export interface WhereModel {
  /** Selected places, in the box's hand order. */
  places: { gameId: string; title: string }[];
  /** Selected region tags per spatial group, in group order. */
  regions: { group: string; values: string[] }[];
  /** The spatial group gameIds, so the caller can exclude them from Tags. */
  spatialGroups: string[];
  /** Home selections whose own region contradicts the selected regions: that
   *  place binds a region the card does not list, so the card can never be
   *  dealt there. Empty when regions are empty (no binding, no constraint). */
  deadPlaces: { place: string; boundTo: string }[];
}

type CardTags = { group: string; values: string[] }[];

export function whereModel(box: BoxDto, tags: CardTags): WhereModel {
  const spatial = box.tagGroups.filter((g) => g.spatial === true);
  const spatialIds = spatial.map((g) => g.gameId);
  const homes = tags.find((t) => t.group === PLACE_GROUP)?.values ?? [];
  const places = box.hands
    .filter((h) => homes.includes(h.gameId))
    .map((h) => ({ gameId: h.gameId, title: h.title ?? h.gameId }));
  const regions = spatial
    .map((g) => ({ group: g.gameId, values: tags.find((t) => t.group === g.gameId)?.values ?? [] }))
    .filter((r) => r.values.length > 0);

  // A place plus a region is AND (every bound group must match), so a home
  // whose own binding for a selected group is not among the selected values is
  // a place this card can never reach.
  const deadPlaces: WhereModel["deadPlaces"] = [];
  for (const h of box.hands) {
    if (!homes.includes(h.gameId)) continue;
    for (const r of regions) {
      const bound = h.tags[r.group];
      if (bound !== undefined && !r.values.includes(bound)) {
        deadPlaces.push({ place: h.title ?? h.gameId, boundTo: bound });
      }
    }
  }
  return { places, regions, spatialGroups: spatialIds, deadPlaces };
}

/** The row's reading form. Chips render beside it; this is the quiet text. */
export function whereSentence(m: WhereModel): string {
  if (m.places.length === 0 && m.regions.length === 0) return "Anywhere";
  const parts: string[] = [];
  if (m.places.length > 0) parts.push(m.places.map((p) => p.title).join(", "));
  for (const r of m.regions) parts.push(`anywhere in ${r.values.join(" or ")}`);
  const joined = parts.join(" · ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** The contradiction line, or undefined when there is nothing to say. */
export function whereWarning(m: WhereModel): string | undefined {
  if (m.deadPlaces.length === 0) return undefined;
  const first = m.deadPlaces[0]!;
  const suffix = m.deadPlaces.length > 1 ? ` (and ${m.deadPlaces.length - 1} more)` : "";
  return `${first.place} is in ${first.boundTo}, not the selected region, so this card can never come up there${suffix}.`;
}
