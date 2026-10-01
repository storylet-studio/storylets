// ---------------------------------------------------------------------------
// What counts as a PLACE AXIS: the one definition (the surfacing review, round 3,
// "one definition of a place axis").
//
// A tag group is a place axis for a box when a card's tag in it decides WHICH
// HANDS the card can come up at. That is so when any hand in the box binds the
// group (a template's fixed `bindings`, a template's `chooses`, which every
// instance fills, a standalone hand's `rule.bindings`, or a hole filled from a
// property at ask time), or when the group is the project map's zone group and
// the box is on the map.
//
// Everything that asks "is this group about where?" reads this file, and nothing
// else decides it:
//   - the card's Where row (studio renderer where.ts, through TagGroupDto.placeAxis)
//   - Group by on the card views (studio renderer card-groups.ts, the same flag)
//   - the hand page's tiers (reach.ts `placeTiers`, one tier per tag of each
//     group the hand itself binds)
// Three copies of this rule disagreed before it was one (a standalone hand's
// rule binding counted on none of them, a template's `chooses` on two), and a
// surface that disagreed with the others was believed by whoever was reading it.
//
// What is NOT a place axis: a group nothing binds (mood, pacing), and a group
// bound only by its own `boundBy` (an act, driven by state): the runtime binds
// that one for every hand alike, so it says when, never where. The place page
// shows it as a badge on the card, not as a tier.
//
// Pure over the shapes it names, so it reads a compiled `Box` and a source box
// alike, as reach.ts does.
// ---------------------------------------------------------------------------

import { PLACE_GROUP, byDisplayOrder, effectiveGameId, isHoleRef, parseHoleRef } from "@storylet-studio/model";
import type { Hand, HandTemplate, PropertyDecl, TagGroup } from "@storylet-studio/model";

/** The parts of a box the rule reads. */
export interface PlaceAxisBox<E> {
  tagGroups: TagGroup[];
  usesMap?: true;
  handTemplates: Pick<HandTemplate<E>, "id" | "bindings" | "chooses">[];
  hands: Hand<E>[];
}

/** Where the project map's group lives: `Bundle.map`, or the source map shard. */
export interface PlaceAxisMap {
  map?: { group: TagGroup };
}

/** The project map's zone group, when this box is on the map. */
export function zoneGroupOf<E>(bundle: PlaceAxisMap, box: Pick<PlaceAxisBox<E>, "usesMap">): TagGroup | undefined {
  return box.usesMap === true ? bundle.map?.group : undefined;
}

/** The groups one hand binds, fixed or filled from a property, by group id. A
 *  template instance binds its template's bindings and its own chosen tags; a
 *  standalone hand its rule's bindings. The value is a tag id or a hole
 *  reference ("@story.elder_at"). */
export function bindingsOfHand<E>(box: Pick<PlaceAxisBox<E>, "handTemplates">, hand: Hand<E>): Map<string, string> {
  const out = new Map<string, string>();
  const add = (bindings: Record<string, string> | undefined): void => {
    for (const [group, tag] of Object.entries(bindings ?? {})) if (group !== PLACE_GROUP) out.set(group, tag);
  };
  if (hand.template !== undefined) {
    add(box.handTemplates.find((t) => t.id === hand.template)?.bindings);
    add(hand.chosen);
  } else {
    add(hand.rule?.bindings);
  }
  return out;
}

/**
 * The box's place axes, by group id: the zone group first when the box is on
 * the map, then the box's own groups in display order. See the head of this file.
 */
export function placeAxes<E>(bundle: PlaceAxisMap, box: PlaceAxisBox<E>): string[] {
  const bound = new Set<string>();
  for (const t of box.handTemplates) {
    for (const g of Object.keys(t.bindings ?? {})) bound.add(g);
    for (const g of t.chooses ?? []) bound.add(g);
  }
  for (const h of box.hands) {
    for (const g of Object.keys(h.chosen ?? {})) bound.add(g);
    for (const g of Object.keys(h.rule?.bindings ?? {})) bound.add(g);
  }
  bound.delete(PLACE_GROUP);
  const zone = zoneGroupOf(bundle, box);
  const out: string[] = [];
  if (zone !== undefined) out.push(zone.id);
  for (const g of byDisplayOrder(box.tagGroups)) if (bound.has(g.id) && !out.includes(g.id)) out.push(g.id);
  return out;
}

/** Is this group a place axis for this box? */
export function isPlaceAxis<E>(bundle: PlaceAxisMap, box: PlaceAxisBox<E>, groupId: string): boolean {
  return placeAxes(bundle, box).includes(groupId);
}

/** The declarations a movable hole may be filled from, by scope: what decides
 *  which tags a moving hand can bind. */
export interface HoleDecls {
  hand?: PropertyDecl[];
  story?: PropertyDecl[];
  world?: PropertyDecl[];
}

/**
 * The tags of one group a hand can bind, as tag ids in the group's display
 * order: the one it binds, or, for a hole filled from a property, every tag
 * that property can name. Empty when the hand does not bind the group.
 *
 * An enum names its tags outright (by gameId). A string can hold anything, so
 * it could be any tag; so could a reference nothing declares, which the
 * compiler names as an error and which must not hide the cards meanwhile.
 * Erring towards "could", as reach.ts `admits` does.
 */
export function tagsOfHand<E>(box: Pick<PlaceAxisBox<E>, "handTemplates">, hand: Hand<E>, group: TagGroup, decls: HoleDecls = {}): string[] {
  const bound = bindingsOfHand(box, hand).get(group.id);
  if (bound === undefined) return [];
  if (!isHoleRef(bound)) return group.tags.some((t) => t.id === bound) ? [bound] : [];
  const ordered = byDisplayOrder(group.tags);
  const parsed = parseHoleRef(bound);
  const decl = parsed === undefined ? undefined : (decls[parsed.scope] ?? []).find((d) => d.name === parsed.name);
  if (decl?.type !== "enum" || decl.values === undefined) return ordered.map((t) => t.id);
  const named = new Set(decl.values);
  return ordered.filter((t) => named.has(effectiveGameId(t))).map((t) => t.id);
}

/** Does this hand take a group's tag from a property (a moving hand)? */
export function movesIn<E>(box: Pick<PlaceAxisBox<E>, "handTemplates">, hand: Hand<E>, groupId: string): boolean {
  const bound = bindingsOfHand(box, hand).get(groupId);
  return bound !== undefined && isHoleRef(bound);
}
