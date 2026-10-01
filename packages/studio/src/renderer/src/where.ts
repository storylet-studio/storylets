// ---------------------------------------------------------------------------
// The Where row's model (design/where-and-selectors.md, Part A).
//
// "Where does this card come up?" answered as a sentence, built from the home
// group plus every PLACE AXIS of the box: a group some hand in the box binds, or
// the project map's zone group in a box on the map. That definition is ops
// place-axis.ts, the only one; main sets `TagGroupDto.placeAxis` from it, and
// this file, Group by and the hand page's tiers all read the same answer. A
// group nothing binds (mood, pacing) stays in the ordinary Tags rows.
//
// The map's zone group reads as a region ("anywhere in docks"); every other
// axis reads as who or what ("npc: gareth"). A topic tagged `npc: gareth` comes
// up only where Gareth is: that is a place answer, and leaving it out had the
// row read "Anywhere" over a card that is anything but. No map is needed for
// it, which is the conversation writer's whole case.
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
  /** Selected tags per place axis that is NOT the map's zone group, in group
   *  order: "npc: gareth". Read as who or what, never as "anywhere in". */
  chosen: { group: string; values: string[] }[];
  /** The zone group's gameId, when the box is on the map (a list, for the
   *  callers that read it as one). */
  spatialGroups: string[];
  /** Every place axis but the home group (the zone group, then the rest), so
   *  the caller can leave them out of Tags: the Where row owns them. */
  placeGroups: string[];
  /** Home selections whose own region contradicts the selected regions: that
   *  place binds a region the card does not list, so the card can never be
   *  dealt there. Empty when regions are empty (no binding, no constraint). */
  deadPlaces: { place: string; boundTo: string; region: boolean }[];
}

type CardTags = { group: string; values: string[] }[];

/** The groups that answer "where", besides the home group: the box's place
 *  axes (TagGroupDto.placeAxis). Also what the deck table's Where column
 *  reads, so the two say the same thing. */
export function placeGroupsOf(box: Pick<BoxDto, "tagGroups">): Set<string> {
  return new Set(box.tagGroups.filter((g) => g.placeAxis === true).map((g) => g.gameId));
}

/** A place axis that is the map's zone group (read as a region), as against
 *  one read as who or what. */
export const isZoneAxis = (g: BoxDto["tagGroups"][number]): boolean => g.placeAxis === true && g.spatial === true;

export function whereModel(box: BoxDto, tags: CardTags): WhereModel {
  const spatial = box.tagGroups.filter(isZoneAxis);
  const spatialIds = spatial.map((g) => g.gameId);
  const chosenGroups = box.tagGroups.filter((g) => g.placeAxis === true && !isZoneAxis(g));
  const homes = tags.find((t) => t.group === PLACE_GROUP)?.values ?? [];
  const places = box.hands
    .filter((h) => homes.includes(h.gameId))
    .map((h) => ({ gameId: h.gameId, title: h.title ?? h.gameId }));
  const picked = (groups: typeof spatial): { group: string; values: string[] }[] => groups
    .map((g) => ({ group: g.gameId, values: tags.find((t) => t.group === g.gameId)?.values ?? [] }))
    .filter((r) => r.values.length > 0);
  const regions = picked(spatial);
  const chosen = picked(chosenGroups);

  // A place plus a region is AND (every bound group must match), so a home
  // whose own binding for a selected group is not among the selected values is
  // a place this card can never reach.
  const deadPlaces: WhereModel["deadPlaces"] = [];
  for (const h of box.hands) {
    if (!homes.includes(h.gameId)) continue;
    for (const r of [...regions, ...chosen]) {
      const bound = h.tags[r.group];
      if (bound !== undefined && !r.values.includes(bound)) {
        deadPlaces.push({ place: h.title ?? h.gameId, boundTo: bound, region: regions.includes(r) });
      }
    }
  }
  return {
    places, regions, chosen, spatialGroups: spatialIds,
    placeGroups: [...spatialIds, ...chosenGroups.map((g) => g.gameId)], deadPlaces,
  };
}

/** Does the card say nothing about where? Then it comes up at every place
 *  in the box that asks. */
export const isAnywhere = (m: WhereModel): boolean =>
  m.places.length === 0 && m.regions.length === 0 && m.chosen.length === 0;

/** The row's reading form. Chips render beside it; this is the quiet text. */
export function whereSentence(m: WhereModel): string {
  if (isAnywhere(m)) return "Anywhere";
  const parts: string[] = [];
  if (m.places.length > 0) parts.push(m.places.map((p) => p.title).join(", "));
  for (const r of m.regions) parts.push(`anywhere in ${r.values.join(" or ")}`);
  for (const c of m.chosen) parts.push(`${c.group}: ${c.values.join(" or ")}`);
  const joined = parts.join("; ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** The contradiction line, or undefined when there is nothing to say. */
export function whereWarning(m: WhereModel): string | undefined {
  if (m.deadPlaces.length === 0) return undefined;
  const first = m.deadPlaces[0]!;
  const suffix = m.deadPlaces.length > 1 ? ` (and ${m.deadPlaces.length - 1} more)` : "";
  return first.region
    ? `${first.place} is in ${first.boundTo}, not the selected region, so this card can never come up there${suffix}.`
    : `${first.place} is for ${first.boundTo}, not the selected tag, so this card can never come up there${suffix}.`;
}
