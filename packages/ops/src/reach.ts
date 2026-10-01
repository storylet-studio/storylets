// ---------------------------------------------------------------------------
// What could come up where, by tags and place alone (static).
//
// Which cards a hand could ever be dealt: the runtime's tag matching
// (engine.ts tagsMatch, schema 3.1 step 3) run over the bindings a hand makes
// on every ask. A place-pinned card needs this hand among its places; for every
// group the hand binds, the card lists the bound tag or omits the group (a
// wildcard), unless the group is `required`.
//
// ONE copy of the rule. Coverage reads it for its composed-name net (which
// hands ask a card) and its per-hand report (what a hand's coverage is out
// of); the editor reads it for the hand page's Cards tab (`placeTiers`). Three
// surfaces that disagreed about who can hold what would each be believed.
//
// It errs towards "could". A group bound at run time stays UNBOUND here, which
// is a wildcard: a `boundBy` group, and a chosen or rule binding that is a
// property reference (a movable hole, `isHoleRef`). Conditions are dynamic and
// are not considered at all. So it never calls a card impossible at a hand
// that some run could legitimately deal it to.
//
// Pure over the shapes it names, so it reads a compiled `Box` and a source box
// alike: both store tags as group id -> tag ids, and the editor works on source.
// ---------------------------------------------------------------------------

import { PLACE_GROUP, byDisplayOrder, effectiveGameId, groupsOfBox, isHoleRef, parseHoleRef } from "@storylet-studio/model";
import type { Hand, HandTemplate, PropertyDecl, TagGroup } from "@storylet-studio/model";

/** The parts of a box the rule reads. A bundle `Box` is one; the editor builds
 *  one from a source box's tags and hands shards. */
export interface ReachBox<E> {
  tagGroups: TagGroup[];
  usesMap?: true;
  handTemplates: Pick<HandTemplate<E>, "id" | "bindings">[];
  hands: Hand<E>[];
}

/** A card as the rule sees it: its tags, and nothing else. */
export interface ReachCard {
  id: string;
  tags?: Record<string, string[]>;
}

/** Where the project map's group lives: `Bundle.map`, or the source map shard. */
export interface ReachMap {
  map?: { group: TagGroup };
}

/** One binding a hand makes on every ask. */
export interface FixedBinding {
  group: string;
  tag: string;
  /** Names its group in the @hand bag: chosen and rule bindings do, a
   *  template's own fixed binding does not (the runtime's askNames). */
  named: boolean;
}

export interface HandReach<E> {
  /** The bindings a hand makes whatever the run does, movable holes left out. */
  fixed(hand: Hand<E>): FixedBinding[];
  /** The groups a hand fills from a property at ask time (its movable holes). */
  holes(hand: Hand<E>): Set<string>;
  /** The property reference a movable hole is filled from, by group. */
  holeRef(hand: Hand<E>, group: string): string | undefined;
  /** Could this card ever come up at this hand, by tags and place alone?
   *  `assume` binds groups the run would (a movable hole's value), which is
   *  how a roaming hand is asked about one zone at a time. */
  admits(card: ReachCard, hand: Hand<E>, assume?: Record<string, string>): boolean;
}

/** The static reach of every hand in one box. The groups are the box's own and,
 *  when it is on the project map, the map's zone group: a `required` zone group
 *  refuses an untagged card exactly as a box's own would. */
export function handReach<E>(bundle: ReachMap, box: ReachBox<E>): HandReach<E> {
  const required = new Set(groupsOfBox(bundle, box).filter((g) => g.required === true).map((g) => g.id));
  const templatesById = new Map(box.handTemplates.map((t) => [t.id, t]));
  const cache = new Map<string, { fixed: FixedBinding[]; holes: Map<string, string> }>();
  // As the runtime composes an ask: a template instance takes its template's
  // bindings and its own chosen tags, a standalone hand its rule's bindings.
  const of = (hand: Hand<E>): { fixed: FixedBinding[]; holes: Map<string, string> } => {
    const found = cache.get(hand.id);
    if (found) return found;
    const fixed: FixedBinding[] = [];
    const holes = new Map<string, string>();
    const add = (bindings: Record<string, string> | undefined, named: boolean): void => {
      for (const [group, tag] of Object.entries(bindings ?? {})) {
        if (isHoleRef(tag)) holes.set(group, tag);
        else fixed.push({ group, tag, named });
      }
    };
    if (hand.template !== undefined) {
      add(templatesById.get(hand.template)?.bindings, false);
      add(hand.chosen, true);
    } else {
      add(hand.rule?.bindings, true);
    }
    const reach = { fixed, holes };
    cache.set(hand.id, reach);
    return reach;
  };
  return {
    fixed: (hand) => of(hand).fixed,
    holes: (hand) => new Set(of(hand).holes.keys()),
    holeRef: (hand, group) => of(hand).holes.get(group),
    admits: (card, hand, assume = {}) => {
      const home = card.tags?.[PLACE_GROUP];
      if (home !== undefined && home.length > 0 && !home.includes(hand.id)) return false;
      const { fixed, holes } = of(hand);
      const bound = new Map<string, string>();
      for (const { group, tag } of fixed) {
        // The runtime binds place to the hand itself, whatever else says so,
        // and a hole over the same group may rebind it at ask time.
        if (group === PLACE_GROUP || holes.has(group)) continue;
        bound.set(group, tag);
      }
      for (const [group, tag] of Object.entries(assume)) if (group !== PLACE_GROUP) bound.set(group, tag);
      for (const [group, tag] of bound) {
        const tags = card.tags?.[group];
        if (tags === undefined) { if (required.has(group)) return false; continue; }
        if (!tags.includes(tag)) return false;
      }
      return true;
    },
  };
}

// --- the hand page's tiers -------------------------------------------------------
//
// What could come up at one hand, in the three tiers its Cards tab shows
// (design/surfacing-review-2026-10 README, "Direction: back to basics", plan 1):
//
//   only here       the card's place names this hand
//   anywhere in z   no place, tagged with zone z, one tier per zone the hand
//                   binds (a roaming hand binds one of several, so it gets a
//                   tier for each zone it CAN be in)
//   anywhere        no place and no zone the tiers above took: a count on the
//                   page, never a list by default
//
// A zone is a tag of the PROJECT MAP's group, and only in a box on the map.
// Every other group (an act, an npc) is not a tier: it filters through
// `admits` and nothing more, so a conversation hand bound to Gareth lists the
// cards Gareth can hold and none of Mira's. A hand deals only from its own
// box's decks, which is the caller's to honour: it passes that box's cards.

export interface PlaceTiers {
  /** Card ids whose place names this hand. */
  only: string[];
  /** One entry per zone the hand binds, in the map group's display order;
   *  `zone` is the tag's id. */
  zones: { zone: string; cards: string[] }[];
  /** Card ids with no place that no zone tier took. */
  anywhere: string[];
}

/** The declarations a movable hole may be filled from, by scope: what decides
 *  which zones a roaming hand can be in. */
export interface HoleDecls {
  hand?: PropertyDecl[];
  story?: PropertyDecl[];
  world?: PropertyDecl[];
}

/**
 * The zones a hand can be in: the one it binds, or, for a hole filled from a
 * property, the zones that property can name.
 *
 * An enum names its zones outright (by tag gameId). A string can hold
 * anything, so it could be any zone; so could a reference nothing declares,
 * which the compiler names as an error and which must not hide the cards
 * meanwhile. Erring towards "could", as `admits` does.
 */
export function zonesOfHand<E>(bundle: ReachMap, box: ReachBox<E>, hand: Hand<E>, decls: HoleDecls = {}, reach = handReach(bundle, box)): string[] {
  const group = box.usesMap === true ? bundle.map?.group : undefined;
  if (group === undefined) return [];
  const fixed = reach.fixed(hand).find((b) => b.group === group.id);
  const ref = reach.holeRef(hand, group.id);
  if (ref === undefined) return fixed !== undefined && group.tags.some((t) => t.id === fixed.tag) ? [fixed.tag] : [];
  const ordered = byDisplayOrder(group.tags);
  const parsed = parseHoleRef(ref);
  const decl = parsed === undefined ? undefined : (decls[parsed.scope] ?? []).find((d) => d.name === parsed.name);
  if (decl?.type !== "enum" || decl.values === undefined) return ordered.map((t) => t.id);
  const named = new Set(decl.values);
  return ordered.filter((t) => named.has(effectiveGameId(t))).map((t) => t.id);
}

/** Tier one hand's possible cards. `cards` is its own box's, in the order the
 *  page should list them. */
export function placeTiers<E>(
  bundle: ReachMap, box: ReachBox<E>, hand: Hand<E>, cards: readonly ReachCard[], decls: HoleDecls = {},
): PlaceTiers {
  const reach = handReach(bundle, box);
  const group = box.usesMap === true ? bundle.map?.group : undefined;
  const zones = zonesOfHand(bundle, box, hand, decls, reach);
  // Does the hand bind the zone group at all, fixed or moving? If it does, a
  // zone-tagged card reaches it only through a zone tier; if it does not, the
  // card's zone is a wildcard here and the card is simply "anywhere".
  const bindsZone = group !== undefined
    && (reach.holeRef(hand, group.id) !== undefined || reach.fixed(hand).some((b) => b.group === group.id));
  const only: string[] = [];
  const byZone = new Map(zones.map((z) => [z, [] as string[]]));
  const anywhere: string[] = [];
  for (const card of cards) {
    const home = card.tags?.[PLACE_GROUP] ?? [];
    if (home.length > 0) {
      if (home.includes(hand.id) && reach.admits(card, hand)) only.push(card.id);
      continue;
    }
    const tagged = group !== undefined ? card.tags?.[group.id] ?? [] : [];
    if (bindsZone && tagged.length > 0) {
      for (const z of zones) {
        if (tagged.includes(z) && reach.admits(card, hand, { [group!.id]: z })) byZone.get(z)!.push(card.id);
      }
      continue;
    }
    if (reach.admits(card, hand)) anywhere.push(card.id);
  }
  return { only, zones: zones.map((zone) => ({ zone, cards: byZone.get(zone)! })), anywhere };
}
