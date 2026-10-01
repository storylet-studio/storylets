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

import { PLACE_GROUP, groupsOfBox, isHoleRef } from "@storylet-studio/model";
import type { Hand, HandTemplate, TagGroup } from "@storylet-studio/model";
import { bindingsOfHand, placeAxes, tagsOfHand, zoneGroupOf } from "./place-axis.js";
import type { HoleDecls } from "./place-axis.js";

export type { HoleDecls } from "./place-axis.js";

/** The parts of a box the rule reads. A bundle `Box` is one; the editor builds
 *  one from a source box's tags and hands shards. */
export interface ReachBox<E> {
  tagGroups: TagGroup[];
  usesMap?: true;
  handTemplates: Pick<HandTemplate<E>, "id" | "bindings" | "chooses">[];
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
// What could come up at one hand, in the tiers its Cards tab shows
// (design/surfacing-review-2026-10 README, "Direction: back to basics", plan 1,
// as corrected in round 3):
//
//   only here       the card's place names this hand, and it can be dealt here
//   never here      the card's place names this hand, but a tag it carries
//                   rules this hand out: shown, with the reason, so the page
//                   that should catch the mistake does not hide it
//   anywhere in t   no place, tagged t in a group the hand binds: one tier per
//                   tag of each such group the hand binds or CAN bind (a
//                   moving hand gets a tier for each tag its property can
//                   name), map zones and other groups (an npc) alike
//   anywhere        no place, and no tag in any group the hand binds: a count
//                   on the page, never a list by default
//
// The groups are the hand's own bindings (place-axis.ts `bindingsOfHand`), in
// the box's place-axis order: the zone group first, then the box's groups. A
// card tagged in two of them sits in the first one's tier. A `boundBy` group
// the hand does not bind itself is no tier: the runtime binds it for every hand
// from state, so a card it gates stays in its tier and carries the gate as a
// badge (`gated`). A hand deals only from its own box's decks, which is the
// caller's to honour: it passes that box's cards.

/** Why a card placed at a hand can never come up there. */
export interface NeverHere {
  card: string;
  /** The group whose tag rules it out. */
  group: string;
  /** The tag the hand binds in that group (tag id); absent when the card
   *  lists no tag in a `required` group the hand binds. */
  bound?: string;
}

export interface PlaceTiers {
  /** Card ids whose place names this hand and which can be dealt here. */
  only: string[];
  /** Cards whose place names this hand but which can never be dealt here. */
  never: NeverHere[];
  /** One tier per tag of each group the hand binds or can bind, in place-axis
   *  order then the group's display order; ids throughout. */
  tiers: { group: string; tag: string; cards: string[] }[];
  /** Card ids with no place and no tag in any group the hand binds. */
  anywhere: string[];
  /** The groups the hand binds, by id, in tier order: what "anywhere" means
   *  ("no place and no tag in these"). */
  bound: string[];
  /** For a card gated by a `boundBy` group the hand does not bind: that group
   *  and the card's tags in it, by card id. */
  gated: Record<string, { group: string; tags: string[] }[]>;
}

/**
 * The zones a hand can be in: `tagsOfHand` over the project map's group, for a
 * box on the map. Empty off the map, or for a hand that binds no zone.
 */
export function zonesOfHand<E>(bundle: ReachMap, box: ReachBox<E>, hand: Hand<E>, decls: HoleDecls = {}): string[] {
  const group = zoneGroupOf(bundle, box);
  return group === undefined ? [] : tagsOfHand(box, hand, group, decls);
}

/** Tier one hand's possible cards. `cards` is its own box's, in the order the
 *  page should list them. */
export function placeTiers<E>(
  bundle: ReachMap, box: ReachBox<E>, hand: Hand<E>, cards: readonly ReachCard[], decls: HoleDecls = {},
): PlaceTiers {
  const reach = handReach(bundle, box);
  const groups = groupsOfBox(bundle, box);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const binds = bindingsOfHand(box, hand);
  // The groups this hand binds, in place-axis order, each with the tags it can bind.
  const bound = placeAxes(bundle, box)
    .filter((id) => binds.has(id) && byId.has(id))
    .map((id) => ({ group: byId.get(id)!, tags: tagsOfHand(box, hand, byId.get(id)!, decls) }));
  const tiers = bound.flatMap((b) => b.tags.map((tag) => ({ group: b.group.id, tag, cards: [] as string[] })));
  const tierOf = new Map(tiers.map((t) => [`${t.group}\u0000${t.tag}`, t]));
  // A group bound from state for every hand, and not by this one.
  const gates = groups.filter((g) => g.boundBy !== undefined && !binds.has(g.id));
  const gated: PlaceTiers["gated"] = {};
  const gate = (card: ReachCard): void => {
    const on = gates
      .map((g) => ({ group: g.id, tags: card.tags?.[g.id] ?? [] }))
      .filter((g) => g.tags.length > 0);
    if (on.length > 0) gated[card.id] = on;
  };
  // A moving hand's hole is a wildcard to `admits`; a card it can never reach
  // (tagged only with tags the property cannot name) is not one it can be dealt.
  const holeMisses = (card: ReachCard): string | undefined => bound.find((b) => {
    if (!reach.holes(hand).has(b.group.id)) return false;
    const tags = card.tags?.[b.group.id];
    return tags !== undefined && !tags.some((t) => b.tags.includes(t));
  })?.group.id;

  const only: string[] = [];
  const never: NeverHere[] = [];
  const anywhere: string[] = [];
  for (const card of cards) {
    const home = card.tags?.[PLACE_GROUP] ?? [];
    if (home.length > 0) {
      if (!home.includes(hand.id)) continue;
      if (reach.admits(card, hand) && holeMisses(card) === undefined) { only.push(card.id); gate(card); continue; }
      never.push(neverHere(card, reach.fixed(hand), groups, holeMisses(card)));
      continue;
    }
    // The first bound group the card names decides its tier.
    const first = bound.find((b) => (card.tags?.[b.group.id] ?? []).length > 0);
    if (first === undefined) {
      if (reach.admits(card, hand)) { anywhere.push(card.id); gate(card); }
      continue;
    }
    let placed = false;
    for (const tag of first.tags) {
      if (!(card.tags?.[first.group.id] ?? []).includes(tag)) continue;
      if (!reach.admits(card, hand, { [first.group.id]: tag })) continue;
      tierOf.get(`${first.group.id}\u0000${tag}`)!.cards.push(card.id);
      placed = true;
    }
    if (placed) gate(card);
  }
  return { only, never, tiers, anywhere, bound: bound.map((b) => b.group.id), gated };
}

/** The reason a placed card is ruled out: the first fixed binding its tags
 *  contradict, else a required group it leaves out, else a moving hand's group
 *  it names only tags of that the hand can never bind. */
function neverHere(card: ReachCard, fixed: FixedBinding[], groups: TagGroup[], hole: string | undefined): NeverHere {
  for (const { group, tag } of fixed) {
    if (group === PLACE_GROUP) continue;
    const tags = card.tags?.[group];
    if (tags !== undefined && !tags.includes(tag)) return { card: card.id, group, bound: tag };
  }
  for (const { group } of fixed) {
    if (group === PLACE_GROUP) continue;
    if (card.tags?.[group] === undefined && groups.some((g) => g.id === group && g.required === true)) return { card: card.id, group };
  }
  return { card: card.id, group: hole ?? "" };
}
