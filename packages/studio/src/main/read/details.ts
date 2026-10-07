// ---------------------------------------------------------------------------
// What the editor's item pages read: a hand template's, a hand's and a tag
// group's detail, and what could come up at a hand. Projections of the loaded
// project and nothing else; they change no shard.
// ---------------------------------------------------------------------------

import { worldDeclarations } from "@storylet-studio/compiler";
import type { SourceBox } from "@storylet-studio/compiler";
import { bindingsOfHand, contractNotes, placeTiers } from "@storylet-studio/ops";
import type { NeverHere, PlaceTiers } from "@storylet-studio/ops";
import { effectiveGameId, groupsOfBox, isHoleRef } from "@storylet-studio/model";
import type { Card, Hand, PropertyDecl, TagGroup } from "@storylet-studio/model";
import { axisBox, axisMap, byDisplay, holeDecls } from "../project.js";
import type { ProjectSession } from "../project.js";
import { asText, declDto } from "../decls.js";
import { blank, groupHome, locateBox, locateBoxSeen } from "../mutate/shards.js";
import type { BindingDto, HandCardRef, HandCardsDto, HandDetail, TagGroupDetail, TemplateDetail } from "../../shared/api.js";

/** One binding row per tag group: fixed tag, hole, or unbound. */
function bindingRows(box: SourceBox, bindings: Record<string, string> | undefined, chooses: string[] | undefined): BindingDto[] {
  return byDisplay(box.tags.groups).map((group) => {
    const gid = effectiveGameId(group);
    const tagId = bindings?.[group.id];
    if (tagId !== undefined) {
      const tag = group.tags.find((x) => x.id === tagId);
      return { group: gid, value: tag ? effectiveGameId(tag) : tagId };
    }
    if ((chooses ?? []).includes(group.id)) return { group: gid, hole: true };
    return { group: gid };
  });
}

/** Every group the box sees and its tags, by address, in display order. */
const groupChoices = (box: SourceBox): { gameId: string; values: string[] }[] =>
  byDisplay(box.tags.groups).map((d) => ({ gameId: effectiveGameId(d), values: byDisplay(d.tags).map((v) => effectiveGameId(v)) }));

export function templateDetail(session: ProjectSession, boxId: string, templateId: string): TemplateDetail | null {
  const box = locateBoxSeen(session, boxId);
  const template = box?.hands.templates.find((t) => t.id === templateId);
  if (!box || !template) return null;
  return {
    id: template.id, gameId: effectiveGameId(template),
    ...(!blank(template.gameId) ? { gameIdPinned: template.gameId } : {}),
    ...(template.title !== undefined ? { title: template.title } : {}),
    ...(template.purpose !== undefined ? { purpose: template.purpose } : {}),
    bindings: bindingRows(box, template.bindings, template.chooses),
    ...(!blank(template.condition) ? { condition: template.condition } : {}),
    slots: String(template.slots ?? "unbounded"),
    properties: (template.properties ?? []).map(declDto),
    groups: groupChoices(box),
    instances: box.hands.hands.filter((h) => h.template === template.id).map((h) => h.title ?? effectiveGameId(h)),
  };
}

export function handDetail(session: ProjectSession, boxId: string, handId: string): HandDetail | null {
  const box = locateBoxSeen(session, boxId);
  const hand = box?.hands.hands.find((h) => h.id === handId);
  if (!box || !hand) return null;
  const groups = groupChoices(box);
  const templates = byDisplay(box.hands.templates).map((t) => ({
    gameId: effectiveGameId(t),
    chooses: (t.chooses ?? []).map((gid) => {
      const g = box.tags.groups.find((d) => d.id === gid);
      return g ? effectiveGameId(g) : gid;
    }),
    slots: String(t.slots ?? "unbounded"),
  }));
  const template = hand.template !== undefined
    ? box.hands.templates.find((t) => t.id === hand.template)
    : undefined;
  // One chosen row per hole of the template, carrying any stored tag - or the
  // property reference the hole is filled from, which passes through as it was
  // authored (it names no tag, so there is nothing to resolve here).
  const chosen = (template?.chooses ?? []).map((groupId) => {
    const group = box.tags.groups.find((d) => d.id === groupId);
    const tagId = hand.chosen?.[groupId];
    const tag = group?.tags.find((x) => x.id === tagId);
    return {
      group: group ? effectiveGameId(group) : groupId,
      value: tagId !== undefined && isHoleRef(tagId) ? tagId : (tag ? effectiveGameId(tag) : ""),
      values: byDisplay(group?.tags ?? []).map((v) => effectiveGameId(v)),
    };
  });
  // What "from a property" may offer: this hand's own @hand state (its
  // template's, when it instances one - the same pair the engine composes
  // from), plus the declared @story and @world properties. String and enum
  // only: the value has to be able to NAME a tag.
  const handDecls = template !== undefined ? template.properties ?? [] : hand.properties ?? [];
  const project = session.loaded.source!.project;
  const canName = (d: PropertyDecl): boolean => d.type === "string" || d.type === "enum";
  const movableFrom = [
    ...handDecls.filter(canName).map((d) => `@hand.${d.name}`),
    ...(project.story?.properties ?? []).filter(canName).map((d) => `@story.${d.name}`),
    ...worldDeclarations(session.loaded.source!).filter(canName).map((d) => `@world.${d.name}`),
  ];
  // What a venue depends on about this hand (design/engine-server.md 4.11).
  // Derived here beside `movableFrom`, and for the same reason: it exists only
  // for the editor, and a second reading of the shard in the renderer is how the
  // line and the refusal come to disagree.
  const venue = contractNotes(session.loaded.source!).get(`hand:${effectiveGameId(hand)}`);
  return {
    id: hand.id,
    gameId: effectiveGameId(hand),
    ...(venue !== undefined ? { contract: venue.map((n) => n.line) } : {}),
    ...(!blank(hand.gameId) ? { gameIdPinned: hand.gameId } : {}),
    ...(hand.title !== undefined ? { title: hand.title } : {}),
    ...(hand.purpose !== undefined ? { purpose: hand.purpose } : {}),
    ...(template !== undefined ? { template: effectiveGameId(template) } : {}),
    chosen,
    ...(hand.rule !== undefined ? {
      rule: {
        bindings: bindingRows(box, hand.rule.bindings, undefined),
        ...(!blank(hand.rule.condition) ? { condition: hand.rule.condition } : {}),
        slots: String(hand.rule.slots ?? "unbounded"),
      },
    } : {}),
    slots: hand.slots === undefined ? "" : String(hand.slots),
    properties: (hand.properties ?? []).map(declDto),
    movableFrom,
    templates,
    groups,
  };
}

/**
 * What could come up at a hand, for its Cards tab: ops `placeTiers` over the
 * box's own decks, in the order the deck pages list them.
 *
 * Asked fresh every time the tab draws rather than carried on `HandDetail`,
 * because the answer moves with edits made elsewhere (a card's place, the
 * hand's own zone on its Dealing tab) and the detail is fetched once per visit.
 */
export function handCards(session: ProjectSession, boxId: string, handId: string): HandCardsDto | null {
  const source = session.loaded.source!;
  const box = locateBox(session, boxId);
  const hand = box?.hands.hands.find((h) => h.id === handId);
  if (!box || !hand) return null;
  const { cards, deckOf } = boxCards(box);
  const tiers = tiersAt(session, box, hand, cards);
  const ref = (card: string): HandCardRef => ({ deck: deckOf.get(card)!, card });
  const groups = groupsOfBox(axisMap(source), { tagGroups: box.tags.groups, ...(box.box.box.usesMap === true ? { usesMap: true as const } : {}) });
  const groupOf = (id: string): TagGroup | undefined => groups.find((g) => g.id === id);
  const groupName = (id: string): string => { const g = groupOf(id); return g ? effectiveGameId(g) : id; };
  const tagName = (group: string, id: string): string => {
    const tag = groupOf(group)?.tags.find((t) => t.id === id);
    return tag ? effectiveGameId(tag) : id;
  };
  const zoneId = source.map !== undefined && box.box.box.usesMap === true ? source.map.group.id : undefined;
  const handName = hand.title ?? effectiveGameId(hand);
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  // Why a card placed here can never be dealt here, in the Where row's terms.
  const why = (n: NeverHere): string => {
    const card = cardsById.get(n.card);
    const group = groupName(n.group);
    if (n.bound === undefined && n.group === "") return `${handName} can never be where this card is filed.`;
    if (n.bound === undefined) {
      const tags = card?.tags?.[n.group];
      return tags === undefined || tags.length === 0
        ? `${group} is required, and this card has no ${group} tag.`
        : `${handName} can never be in ${tags.map((t) => tagName(n.group, t)).join(" or ")}.`;
    }
    const tags = (card?.tags?.[n.group] ?? []).map((t) => tagName(n.group, t));
    return n.group === zoneId
      ? `${handName} is in ${tagName(n.group, n.bound)}, but this card is filed to ${tags.join(" or ")}.`
      : `${handName} is for ${group}: ${tagName(n.group, n.bound)}, but this card is tagged ${group}: ${tags.join(" or ")}.`;
  };
  return {
    only: tiers.only.map(ref),
    never: tiers.never.map((n) => ({ ...ref(n.card), why: why(n) })),
    tiers: tiers.tiers.map((t) => ({
      group: groupName(t.group), tag: tagName(t.group, t.tag), ...(t.group === zoneId ? { zone: true as const } : {}), cards: t.cards.map(ref),
    })),
    anywhere: tiers.anywhere.map(ref),
    bound: tiers.bound.map(groupName),
    gated: Object.fromEntries(Object.entries(tiers.gated).map(([card, gates]) => [card,
      gates.map((g) => ({ group: groupName(g.group), tags: g.tags.map((t) => tagName(g.group, t)) }))])),
    ...([...bindingsOfHand(axisBox(box), hand).values()].some(isHoleRef) ? { moving: true as const } : {}),
  };
}

/** A box's cards in the order its deck pages list them, and the deck each is in. */
export function boxCards(box: SourceBox): { cards: Card<string>[]; deckOf: Map<string, string> } {
  const deckOf = new Map<string, string>();
  const cards = byDisplay(box.decks.map((d, i) => ({ d, order: d.shard.deck.order ?? i })))
    .flatMap(({ d }) => byDisplay(d.shard.cards.map((c, i) => ({ c, order: c.order ?? i })))
      .map(({ c }) => { deckOf.set(c.id, d.shard.deck.id); return c; }));
  return { cards, deckOf };
}

/** ops `placeTiers` for one hand of a box, with its holes read as the compiler
 *  reads them: the one place the editor asks what could come up at a hand. */
export function tiersAt(session: ProjectSession, box: SourceBox, hand: Hand<string>, cards: Card<string>[]): PlaceTiers {
  const source = session.loaded.source!;
  return placeTiers(axisMap(source), axisBox(box), hand, cards, holeDecls(source, box, hand));
}

export function tagGroupDetail(session: ProjectSession, boxId: string, groupId: string): TagGroupDetail | null {
  const box = locateBox(session, boxId);
  const home = groupHome(session, box, groupId);
  const group = home?.group;
  if (!box || !group) return null;
  return {
    id: group.id, gameId: effectiveGameId(group),
    ...(group.purpose !== undefined ? { purpose: group.purpose } : {}),
    ...(home?.project === true ? { projectMap: true as const } : {}),
    properties: (group.properties ?? []).map(declDto),
    values: byDisplay(group.tags).map((v) => ({
      id: v.id, gameId: effectiveGameId(v),
      properties: (v.properties ?? []).map(declDto),
      ...(v.values !== undefined
        ? { values: Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, asText(x)])) }
        : {}),
    })),
  };
}
