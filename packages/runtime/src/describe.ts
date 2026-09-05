// ---------------------------------------------------------------------------
// describeBundle - the bundle inspector's runtime half (design/engine-runtimes.md
// section 2, piece 6).
//
// A BUNDLE-level API, deliberately NOT a session method: it answers the
// integrator's question - "I dropped a .storyletsc into my project, what may
// my game code call?" - from the imported asset alone, with no session, no
// state and no game running. That makes the boundary rule (design 4) visible:
// hands are what deal() takes, tag groups + tags are what peek() criteria are
// drawn from, declared properties are what expressions read and a host may
// set. Card lists are deliberately absent: cards are the engine's business,
// counts are the orientation an integrator needs.
//
// Everything is in bundle order, so the description is deterministic and two
// runtimes render the same rows in the same sequence. The property scopes are
// the static twin of session.listProperties(): the same stores, in the same
// order, before anything is instantiated (a hand instance carries its
// template's declarations, exactly as the session's hand bags do).
// ---------------------------------------------------------------------------

import { effectiveGameId, isHoleRef } from "@storylet-studio/model";
import type {
  Box, Bundle, Expression, Hand, PropertyDecl, PropertyType, ScalarValue,
} from "@storylet-studio/model";

/** What bundle this is: the staleness/identity triple plus the schema tag. */
export interface BundleIdentity {
  /** The bundle schema tag ("storylets/bundle@0"). */
  schema: string;
  /** content.project - the project name a save must agree with. */
  project: string;
  /** content.version - the authored bundle version. */
  version: string;
  /** content.hash - hash32 over the canonical source shards (schema 2.8). */
  hash: string;
  /** "full" | "stripped": whether authoring metadata (titles) survived. */
  metadata: string;
}

/** One hole this hand fills from a property rather than with a tag: the hand
 *  MOVES when that property is written (design/engine-server.md 4.6). `group`
 *  is the tag group's gameId, `from` the reference exactly as authored. */
export interface MovableHole {
  group: string;
  from: string;
}

/** One hand: the deal() surface. `gameId` is the name deal() is called with. */
export interface HandSummary {
  gameId: string;
  title?: string;
  /** The owning box's gameId (peek's first argument for the same stock). */
  box: string;
  /** The effective slot cap: the hand's override, else its template's or
   *  rule's, else "unbounded". */
  slots: number | "unbounded";
  /** The hand template's gameId; absent for a standalone (inline-rule) hand. */
  template?: string;
  /**
   * The holes filled from a property, in bundle order. Absent when the hand
   * has none, which is the ordinary case.
   *
   * Reported because it is the one thing about a hand an integrator cannot see
   * from its name: a movable hole means writing that property MOVES the hand,
   * so it is the difference between a fixed kiosk and a performer who walks
   * about. `setProperty` is the whole verb; there is no other.
   */
  movable?: MovableHole[];
}

/** One tag group and its tags, by gameId: the peek() criteria surface (a
 *  criteria entry is `{ [group gameId]: tag gameId }`). */
export interface TagGroupSummary {
  gameId: string;
  tags: string[];
}

/** One box: identity, its ranking policy, its tag groups, and counts. */
export interface BoxSummary {
  gameId: string;
  title?: string;
  /** The only per-box ranking policy (Reboot 2.2). */
  ranking: { specificity: boolean };
  /** Present on a TIMED box (design/engine-server.md 4.8): how long one of
   *  its turns lasts. An integrator reading a bundle needs it to know which
   *  boxes their host must tick, and how often. Absent is the ordinary box. */
  turn?: { seconds: number };
  /** How many cards in this box are DURABLE (design/engine-server.md 4.2):
   *  their `redraw: "never"` spend outlives the run, and a server has to lift
   *  and restore it. A count rather than a list, like every other number here:
   *  an integrator needs to know whether this box has any such cards at all,
   *  and which ones is the authoring tool's question. Absent when there are
   *  none, which is the ordinary bundle. */
  durableCards?: number;
  tagGroups: TagGroupSummary[];
  counts: {
    decks: number;
    cards: number;
    hands: number;
    templates: number;
    tagGroups: number;
  };
}

/** One declared property: what expressions read and what a host may set. */
export interface PropertySummary {
  name: string;
  type: PropertyType;
  default: ScalarValue;
  /** Enum / flags options, where declared. */
  values?: string[];
  /** Declared DURABLE (design/engine-server.md 4.2): the value survives a run,
   *  and a server lifts and restores it across one. The engine never reads it;
   *  it is reported because it is the difference between a value an integrator
   *  may reset and one somebody is going to expect back. Absent = run-scoped. */
  durable?: true;
  purpose?: string;
}

/** The scope a declaration block belongs to. `tag` declarations compose into
 *  @hand for any ask that binds the tag (schema 3.6). */
export type PropertyScopeKind = "world" | "story" | "box" | "deck" | "hand" | "tag";

/** One scope's declared properties. `owner` is the owning entity's gameId
 *  (empty for world / story); `box` names its box; `group` names a tag's
 *  group. */
export interface PropertyScopeSummary {
  scope: PropertyScopeKind;
  owner: string;
  box?: string;
  group?: string;
  properties: PropertySummary[];
}

/**
 * One map the bundle was asked to carry (design/graphical-views.md 2).
 *
 * Counts rather than the geometry itself, which is the same judgement the rest
 * of this file makes: an inspector answers "what is in here", and a host that
 * wants the polygons reads `bundle.maps` directly. Reported because a bundle
 * that silently carried a map would fail the promise this API exists for.
 */
export interface MapSummary {
  /** The owning box, by gameId. */
  box: string;
  /** The tag group this is a map of, by gameId. */
  group: string;
  zones: number;
  backgrounds: number;
  /** Placed hands standing on this map (design/engine-server.md 4.3): where the
   *  kiosks are, in a bundle that carries geometry at all. */
  sites: number;
}

/** What a bundle offers a host, read from the asset alone. */
export interface BundleDescription {
  identity: BundleIdentity;
  /** Orientation, not inventory: no card lists (Reboot 2.1). */
  totals: {
    boxes: number;
    decks: number;
    cards: number;
    hands: number;
    templates: number;
    tagGroups: number;
  };
  boxes: BoxSummary[];
  /** Every hand in the bundle, box by box: the deal() surface. */
  hands: HandSummary[];
  /** world, story, then per box: the box, its decks, its hands, its tags.
   *  Scopes that declare nothing are omitted (world and story always show,
   *  so their absence reads as "this bundle declares none"). */
  properties: PropertyScopeSummary[];
  /** Maps carried as inert payload, when the build asked for them. Empty is
   *  the normal state and means the bundle has no geometry in it. */
  maps: MapSummary[];
}

const summarise = (decls: PropertyDecl[]): PropertySummary[] =>
  decls.map((d) => ({
    name: d.name,
    type: d.type,
    default: d.default,
    ...(d.values !== undefined ? { values: d.values } : {}),
    ...(d.durable === true ? { durable: true as const } : {}),
    ...(d.purpose !== undefined ? { purpose: d.purpose } : {}),
  }));

/** How many cards in a box are durable: the card's own flag, else its deck's
 *  (design/engine-server.md 4.2, the same inheritance `shared` has). */
const durableCardCount = (box: Box<Expression>): number =>
  box.decks.reduce((n, deck) =>
    n + deck.cards.filter((card) => (card.durable ?? deck.durable) === true).length, 0);

/** A hand's declared @hand state: a template instance inherits its template's
 *  declarations, a standalone hand declares its own (schema 2.6) - the same
 *  rule the session's hand bags are built on. */
const handDecls = (hand: Hand<Expression>, box: Box<Expression>): PropertyDecl[] => {
  if (hand.template !== undefined) {
    return box.handTemplates.find((t) => t.id === hand.template)?.properties ?? [];
  }
  return hand.properties ?? [];
};

/** The hand's movable holes, in the bundle's own key order: every `chosen` /
 *  rule-binding value that is a property reference rather than a tag (4.6).
 *  A group id the bundle does not carry is skipped rather than reported under
 *  its raw id: the description speaks gameIds throughout. */
const movableHoles = (hand: Hand<Expression>, box: Box<Expression>): MovableHole[] => {
  const filled = hand.template !== undefined ? hand.chosen : hand.rule?.bindings;
  const out: MovableHole[] = [];
  for (const [groupId, value] of Object.entries(filled ?? {})) {
    if (!isHoleRef(value)) continue;
    const group = box.tagGroups.find((g) => g.id === groupId);
    if (group === undefined) continue;
    out.push({ group: effectiveGameId(group), from: value });
  }
  return out;
};

/** The effective slot cap, resolved the way the session resolves capacity. */
const handSlots = (hand: Hand<Expression>, box: Box<Expression>): number | "unbounded" => {
  if (hand.slots !== undefined) return hand.slots;
  const declared = hand.template !== undefined
    ? box.handTemplates.find((t) => t.id === hand.template)?.slots
    : hand.rule?.slots;
  return declared === undefined ? "unbounded" : declared;
};

/** Describe a compiled bundle: the callable surface of an imported asset, no
 *  session required (design/engine-runtimes.md 2, piece 6). Bundle order
 *  throughout; the same shape every runtime returns. */
export function describeBundle(bundle: Bundle): BundleDescription {
  const boxes: BoxSummary[] = [];
  const hands: HandSummary[] = [];
  const properties: PropertyScopeSummary[] = [
    { scope: "world", owner: "", properties: summarise(bundle.world.properties) },
    { scope: "story", owner: "", properties: summarise(bundle.story.properties) },
  ];
  const totals = { boxes: 0, decks: 0, cards: 0, hands: 0, templates: 0, tagGroups: 0 };

  for (const box of bundle.boxes) {
    const boxGameId = effectiveGameId(box);
    const cards = box.decks.reduce((n, deck) => n + deck.cards.length, 0);
    boxes.push({
      gameId: boxGameId,
      ...(box.title !== undefined ? { title: box.title } : {}),
      ranking: { specificity: box.ranking.specificity },
      ...(box.turn !== undefined ? { turn: { seconds: box.turn.seconds } } : {}),
      ...(durableCardCount(box) > 0 ? { durableCards: durableCardCount(box) } : {}),
      tagGroups: box.tagGroups.map((group) => ({
        gameId: effectiveGameId(group),
        tags: group.tags.map((tag) => effectiveGameId(tag)),
      })),
      counts: {
        decks: box.decks.length,
        cards,
        hands: box.hands.length,
        templates: box.handTemplates.length,
        tagGroups: box.tagGroups.length,
      },
    });
    totals.boxes += 1;
    totals.decks += box.decks.length;
    totals.cards += cards;
    totals.hands += box.hands.length;
    totals.templates += box.handTemplates.length;
    totals.tagGroups += box.tagGroups.length;

    for (const hand of box.hands) {
      const template = hand.template !== undefined
        ? box.handTemplates.find((t) => t.id === hand.template)
        : undefined;
      const movable = movableHoles(hand, box);
      hands.push({
        gameId: effectiveGameId(hand),
        ...(hand.title !== undefined ? { title: hand.title } : {}),
        box: boxGameId,
        slots: handSlots(hand, box),
        ...(template !== undefined ? { template: effectiveGameId(template) } : {}),
        ...(movable.length > 0 ? { movable } : {}),
      });
    }

    // The property scopes, in the session's store order: box, decks, hands,
    // tags. Empty declaration blocks are dropped (nothing to read or set).
    const push = (scope: PropertyScopeKind, owner: string, decls: PropertyDecl[], group?: string): void => {
      if (decls.length === 0) return;
      properties.push({
        scope, owner, box: boxGameId, ...(group !== undefined ? { group } : {}),
        properties: summarise(decls),
      });
    };
    push("box", boxGameId, box.properties);
    for (const deck of box.decks) push("deck", effectiveGameId(deck), deck.properties);
    for (const hand of box.hands) push("hand", effectiveGameId(hand), handDecls(hand, box));
    for (const group of box.tagGroups) {
      for (const tag of group.tags) {
        push("tag", effectiveGameId(tag), tag.properties ?? [], effectiveGameId(group));
      }
    }
  }

  return {
    identity: {
      schema: bundle.schema,
      project: bundle.content.project,
      version: bundle.content.version,
      hash: bundle.content.hash,
      metadata: bundle.metadata,
    },
    totals,
    boxes,
    hands,
    properties,
    maps: (bundle.maps ?? []).map((map) => ({
      box: map.box,
      group: map.group,
      zones: map.zones.length,
      backgrounds: map.backgrounds?.length ?? 0,
      sites: map.sites?.length ?? 0,
    })),
  };
}
