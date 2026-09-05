// ---------------------------------------------------------------------------
// buildCorpus - compile the authored fixtures into the portable corpus.json.
//
// Expressions compile src -> { src, ast } with the storylets dialect; bundle
// fixtures expand against the shared scaffold (design/conformance.md 5): one
// box `b_x`, deck `k_main`, tag group `d_zone` with tags `v_docks` (danger
// property) and `v_market`. Fixtures speak group/tag gameIds; the compiled
// bundle stores ids (place tags name hand ids directly). A fixture's
// `otherBox` adds a second box `b_y` whose own group `d_zone_y` reuses the
// gameId "zone": group names are box-scoped, so the same name in two boxes
// is ordinary authoring. Expectations pass through UNTOUCHED - they are the
// hand-written contract.
// ---------------------------------------------------------------------------

import { compile } from "@wildwinter/expr";
import type { Expression } from "@wildwinter/expr";
import { storyletsDialect } from "@storylet-studio/dialect";
import { PLACE_GROUP } from "@storylet-studio/model";
import type {
  Bundle, Box, Card, Deck, Hand, HandTemplate, Outcome, TagGroup,
} from "@storylet-studio/model";
import type {
  BundleFixture, CardFixture, Corpus, DeckFixture, Fixtures,
  HandFixture, OutcomeFixture, PeekCase, ScriptedCase, TemplateFixture,
} from "./types.js";

export const CORPUS_VERSION = 5;

const compileSrc = (src: string): Expression => compile(src, storyletsDialect);
const maybe = (src: string | undefined): Expression | undefined =>
  src === undefined ? undefined : compileSrc(src);

/** Fixture gameId rule: the id minus its type prefix (c_ambush -> "ambush"). */
const gameId = (id: string): string => id.replace(/^[a-z]+_/, "");

const byId = <T extends { id: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Display order, matching the compiler: `order`, else source position, id to
 *  break a tie. Applied to the fixture before it is expanded, because the
 *  bundled outcome does not carry `order`; the array's order IS the answer. */
const byDisplayOrder = <T extends { id: string; order?: number }>(items: T[]): T[] =>
  items
    .map((x, i) => ({ x, key: x.order ?? i }))
    .sort((a, b) => a.key - b.key || (a.x.id < b.x.id ? -1 : a.x.id > b.x.id ? 1 : 0))
    .map((e) => e.x);

/** Maps in a bundle sort by key (the compiler's canonical form). */
const sortRecord = <V>(record: Record<string, V>): Record<string, V> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

// The scaffold tag group of box `b_x` (design/conformance.md 5).
const scaffoldGroups: TagGroup[] = [
  {
    id: "d_zone", gameId: "zone",
    tags: [
      { id: "v_docks", gameId: "docks", properties: [{ name: "danger", type: "number", default: 0 }] },
      { id: "v_market", gameId: "market" },
    ],
  },
];

// The second box `b_y`'s groups. `d_zone_y` carries the SAME gameId "zone"
// as `b_x`'s `d_zone`: group gameIds are unique within a box, and boxes
// namespace them, so this is ordinary authoring rather than a clash.
// `d_weather_y` has no counterpart in `b_x`, which is what lets a case pin
// that box scoping is a real scope and not a bundle-wide fallback.
const otherGroups: TagGroup[] = [
  {
    id: "d_weather_y", gameId: "weather",
    tags: [
      { id: "v_rain_y", gameId: "rain" },
      { id: "v_sun_y", gameId: "sun" },
    ],
  },
  {
    id: "d_zone_y", gameId: "zone",
    tags: [
      { id: "v_docks_y", gameId: "docks", properties: [{ name: "danger", type: "number", default: 0 }] },
      { id: "v_market_y", gameId: "market" },
    ],
  },
];

const OTHER_BOX_ID = "b_y";
const OTHER_BOX_GAME_ID = "other";

/** Group/tag name resolution is per box: the same gameId means a different
 *  group depending on which box's fixture is being expanded. */
interface Scaffold {
  groups: TagGroup[];
  groupId: (name: string) => string;
  tagId: (group: string, name: string) => string;
  resolveBindings: (b: Record<string, string> | undefined) => Record<string, string> | undefined;
}

const scaffoldFor = (label: string, groups: TagGroup[]): Scaffold => {
  const groupId = (name: string): string => {
    const group = groups.find((d) => d.gameId === name);
    if (!group) throw new Error(`fixture references unknown tag group "${name}" in ${label}`);
    return group.id;
  };
  const tagId = (group: string, name: string): string => {
    const g = groups.find((d) => d.id === group);
    const tag = g?.tags.find((v) => v.gameId === name);
    if (!tag) throw new Error(`fixture references unknown tag "${name}" in ${label}`);
    return tag.id;
  };
  /** Bindings: group gameId -> tag gameId, resolved to ids (home passes hand
   *  ids through). A value beginning with "@" is a PROPERTY REFERENCE, not a
   *  tag name (4.6, the hand that moves): it names nothing in the bundle at
   *  build time, so it passes through exactly as authored and the runtime
   *  resolves it at ask time. */
  const resolveBindings = (
    bindings: Record<string, string> | undefined,
  ): Record<string, string> | undefined =>
    bindings === undefined ? undefined : Object.fromEntries(
      Object.entries(bindings).map(([group, tag]) => {
        if (group === PLACE_GROUP) return [PLACE_GROUP, tag];
        const gid = groupId(group);
        return [gid, tag.startsWith("@") ? tag : tagId(gid, tag)];
      }),
    );
  return { groups, groupId, tagId, resolveBindings };
};

const boxScaffold = scaffoldFor('box "box"', scaffoldGroups);
const otherScaffold = scaffoldFor(`box "${OTHER_BOX_GAME_ID}"`, otherGroups);

const expandOutcome = (f: OutcomeFixture): Outcome<Expression> => ({
  id: f.id,
  gameId: gameId(f.id),
  condition: maybe(f.condition),
  changes: sortRecord(Object.fromEntries(
    Object.entries(f.changes ?? {}).map(([target, src]) => [target, compileSrc(src)]),
  )),
});

const expandCard = (f: CardFixture, strip: boolean, s: Scaffold): Card<Expression> => ({
  id: f.id,
  gameId: gameId(f.id),
  ...(f.title !== undefined && !strip ? { title: f.title } : {}),
  condition: maybe(f.condition),
  priority: typeof f.priority === "string" ? compileSrc(f.priority) : (f.priority ?? 0),
  redraw: f.redraw ?? "always",
  tags: f.tags === undefined ? undefined : Object.fromEntries(
    Object.entries(f.tags).map(([group, tags]) => {
      if (group === PLACE_GROUP) return [PLACE_GROUP, tags];
      const id = s.groupId(group);
      return [id, tags.map((v) => s.tagId(id, v))];
    }),
  ),
  ...(f.copies !== undefined ? { copies: f.copies } : {}),
  ...(f.shared !== undefined ? { shared: f.shared } : {}),
  ...(f.sharedCopies !== undefined ? { sharedCopies: f.sharedCopies } : {}),
  fields: f.fields,
  outcomes: byDisplayOrder(f.outcomes ?? []).map(expandOutcome),
});

const expandDeck = (f: DeckFixture, strip: boolean, s: Scaffold): Deck<Expression> => ({
  id: f.id,
  gameId: gameId(f.id),
  condition: maybe(f.condition),
  ...(f.shared !== undefined ? { shared: f.shared } : {}),
  properties: f.properties ?? [],
  cards: byId(f.cards.map((c) => expandCard(c, strip, s))),
});

const expandTemplate = (f: TemplateFixture, s: Scaffold): HandTemplate<Expression> => ({
  id: f.id,
  gameId: gameId(f.id),
  ...(f.bindings !== undefined ? { bindings: s.resolveBindings(f.bindings)! } : {}),
  ...(f.chooses !== undefined ? { chooses: f.chooses.map(s.groupId) } : {}),
  ...(f.condition !== undefined ? { condition: compileSrc(f.condition) } : {}),
  slots: f.slots ?? "unbounded",
  properties: f.properties ?? [],
});

const expandHand = (f: HandFixture, s: Scaffold): Hand<Expression> => ({
  id: f.id,
  gameId: gameId(f.id),
  ...(f.template !== undefined ? { template: f.template } : {}),
  ...(f.chosen !== undefined ? { chosen: s.resolveBindings(f.chosen)! } : {}),
  ...(f.rule !== undefined ? {
    rule: {
      ...(f.rule.bindings !== undefined ? { bindings: s.resolveBindings(f.rule.bindings)! } : {}),
      ...(f.rule.condition !== undefined ? { condition: compileSrc(f.rule.condition) } : {}),
      slots: f.rule.slots ?? "unbounded",
    },
  } : {}),
  ...(f.slots !== undefined ? { slots: f.slots } : {}),
  ...(f.properties !== undefined ? { properties: f.properties } : {}),
});

export function expandBundle(f: BundleFixture): Bundle {
  const strip = f.metadata === "stripped";
  const decks: DeckFixture[] = f.decks ?? [{ id: "k_main", cards: f.cards ?? [] }];
  // A case may declare extra groups beside the scaffold's `d_zone` (the
  // state-bound and required cases need one); they join the scaffold so the
  // fixture's own bindings and card tags resolve against both.
  const extra: TagGroup[] = (f.groups ?? []).map((g) => ({
    id: g.id,
    gameId: g.gameId ?? gameId(g.id),
    tags: g.tags.map((t) => ({
      id: t.id, gameId: t.gameId ?? gameId(t.id),
      ...(t.properties !== undefined ? { properties: t.properties } : {}),
    })),
    ...(g.boundBy !== undefined ? { boundBy: g.boundBy } : {}),
    ...(g.required === true ? { required: true } : {}),
  }));
  const allGroups = [...scaffoldGroups, ...extra];
  const scaffold = extra.length > 0 ? scaffoldFor('box "box"', allGroups) : boxScaffold;
  const box: Box<Expression> = {
    id: "b_x",
    gameId: "box",
    ranking: f.ranking ?? { specificity: true },
    ...(f.turn !== undefined ? { turn: f.turn } : {}),
    fields: [],
    properties: f.boxProperties ?? [],
    tagGroups: byId(allGroups),
    decks: byId(decks.map((d) => expandDeck(d, strip, scaffold))),
    handTemplates: byId((f.templates ?? []).map((t) => expandTemplate(t, scaffold))),
    hands: byId((f.hands ?? []).map((h) => expandHand(h, scaffold))),
  };
  const boxes: Box<Expression>[] = [box];
  if (f.otherBox) {
    const o = f.otherBox;
    const otherDecks: DeckFixture[] = o.decks ?? [{ id: "k_ymain", cards: o.cards ?? [] }];
    boxes.push({
      id: OTHER_BOX_ID,
      gameId: OTHER_BOX_GAME_ID,
      ranking: o.ranking ?? { specificity: true },
      ...(o.turn !== undefined ? { turn: o.turn } : {}),
      fields: [],
      properties: o.properties ?? [],
      tagGroups: byId(otherGroups),
      decks: byId(otherDecks.map((d) => expandDeck(d, strip, otherScaffold))),
      handTemplates: byId((o.templates ?? []).map((t) => expandTemplate(t, otherScaffold))),
      hands: byId((o.hands ?? []).map((h) => expandHand(h, otherScaffold))),
    });
  }
  return {
    schema: "storylets/bundle@0",
    content: {
      project: f.content?.project ?? "conf",
      version: f.content?.version ?? "0.0.0",
      hash: f.content?.hash ?? "",
    },
    metadata: strip ? "stripped" : "full",
    settings: { playAdvancesTurns: f.settings?.playAdvancesTurns ?? 1 },
    world: { properties: f.world ?? [] },
    story: { properties: f.story ?? [] },
    boxes: byId(boxes),
  };
}

export function buildCorpus(fixtures: Fixtures): Corpus {
  return {
    version: CORPUS_VERSION,
    expressions: fixtures.expressions.map((f) => ({
      name: f.name,
      src: f.src,
      ast: compileSrc(f.src).ast,
      scopes: f.scopes,
      ...(f.seed !== undefined ? { seed: f.seed } : {}),
      ...(f.expectError ? { expectError: true as const } : { expected: f.expected }),
    })),
    specificity: fixtures.specificity.map((f) => ({
      name: f.name,
      src: f.src,
      ast: compileSrc(f.src).ast,
      scopes: f.scopes,
      expected: f.expected,
    })),
    peek: fixtures.peek.map((f): PeekCase => ({
      name: f.name,
      bundle: expandBundle(f),
      ...(f.seed !== undefined ? { seed: f.seed } : {}),
      ...(f.setup !== undefined ? { setup: f.setup } : {}),
      box: f.box ?? "box",
      ...(f.criteria !== undefined ? { criteria: f.criteria } : {}),
      ...(f.n !== undefined ? { n: f.n } : {}),
      expect: f.expect,
    })),
    scripted: fixtures.scripted.map((f): ScriptedCase => ({
      name: f.name,
      bundle: expandBundle(f),
      ...(f.bundleB !== undefined ? { bundleB: expandBundle(f.bundleB) } : {}),
      ...(f.seed !== undefined ? { seed: f.seed } : {}),
      script: f.script,
    })),
  };
}
