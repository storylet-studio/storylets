// ---------------------------------------------------------------------------
// @storylet-studio/model - the shape source-of-truth.
//
// Transcribes design/storylets-schema.md (bundle, save) and
// design/storylets-source.md (shards). Entity shapes are generic over their
// expression representation E: source shards use plain `src` strings
// (Card<string>), the compiled bundle uses { src, ast } envelopes
// (Card<Expression>). No behaviour lives here.
// ---------------------------------------------------------------------------

import type { Expression, ScalarValue } from "@wildwinter/expr";

export type { Expression, ScalarValue, AstNode } from "@wildwinter/expr";

// --- shared declarations -----------------------------------------------------

export type PropertyType = "boolean" | "number" | "string" | "enum" | "flags" | "quality";

/** A property declaration: @world / @story / @box / @deck / tag / hand
 *  state. A declared property always has a value (`default` is required);
 *  referencing an undeclared property is a publish-time error. */
export interface PropertyDecl {
  name: string;
  type: PropertyType;
  default: ScalarValue;
  values?: string[];
  /**
   * A quality's ordered ladder of stage names (design/quality.md). Order IS
   * the meaning: `>=` compares by position here, and `advance()` steps along
   * it. The one order-semantic list in the format, accepted as such: it is a
   * declaration, and inserting a stage mid-ladder is the design's whole point.
   */
  stages?: string[];
  /**
   * `@world` only. `false` makes the property read-only TO THE STORY: a
   * condition may read it, an outcome that writes it is a compile error. The
   * game still moves it through its resolver; this is the story's statement
   * of intent, not the game's policy. Mirrors Patter's `HostScopeDecl.writable`
   * name for name (Reboot.md 10, ruled 2026-09-03). Ignored on every other
   * scope. Absent = writable.
   */
  writable?: boolean;
  /**
   * The sharing axis (design/flows.md, Patter's flag adopted): is this
   * property's value one world value across all flows, or a copy per flow?
   * It does NOT change reference syntax - sharing is set here, on the
   * declaration, not by a different scope token. Absent = the scope
   * default: `@story` shared; box, deck, hand and tag properties per-flow.
   * On a `@world` declaration the flag is a validation error - `@world` is
   * the game's own state, always engine-level, never per-flow.
   */
  shared?: boolean;
  purpose?: string;
}

/** A card-template field (box-defined). Data for the host; the engine never
 *  interprets fields and they are not addressable from expressions. */
export interface FieldDecl {
  name: string;
  type: PropertyType;
  default: ScalarValue;
  values?: string[];
  purpose?: string;
}

/** Cooldown policy, in turns (schema 3.4). */
export type RedrawPolicy = "always" | "never" | number;

// --- gameId derivation (Patter's effectiveGameId, adopted 2026-07-20) --------
//
// gameId is the renameable host-facing address; it is OPTIONAL in source and
// derived from the entity's title until the author pins one, so a rename of
// the title carries the address with it (no "new-deck" stuck placeholder).
// The compiler fills a concrete gameId into every bundle entity.

/** Slugify a human label into a filename- / address-safe gameId. */
export function gameIdify(text: string): string {
  return text.toLowerCase().replace(/['’]/g, "")
    .replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

export function isValidGameId(gameId: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(gameId);
}

// --- property names (adopted 2026-08-18, with Patter, from one rule) ---------
//
// Design and argument: `@wildwinter/app-shell` src/property-names.ts. Not house
// style: the rule is what `@wildwinter/expr` can parse. Its lexer takes an
// identifier as /[a-zA-Z_][a-zA-Z0-9_]*/ and folds it to lower case, so
// `@story.isNight` reaches a property called `isnight`, `@story.9lives` and
// `@story.not` are parse errors, and `@story.is-night` is not an error at all: it
// compiles to `@story.is` MINUS the string "night". That last one is why the rule
// is enforced rather than trusted - it is the only violation that silently means
// something else.
//
// Here rather than behind an import of the UI kit because the compiler, the CLI
// and the embedded runtime resolve state by these. `property-name-parity.test.ts`
// holds them to the shell's, and `property-name-grammar.test.ts` holds them to the
// parser they came from.

/** The words `@wildwinter/expr` lexes as keywords, so no property may be called one. */
// A legal property NAME is a fact about the expression language, not about this
// model: `not` is reserved because the tokeniser reads it as an operator. Both
// families kept their own copy of the rule AND of the keyword list, a list
// neither owned. @wildwinter/expr derives the list from its own tokeniser, so a
// keyword added there cannot leave a stale copy here.
//
// Re-exported so nothing that imports them has to move.
export {
  propertyNameify, isValidPropertyName, isCaseOnlyPropertyName, RESERVED_PROPERTY_NAMES,
} from "@wildwinter/expr";
/** The effective address: a pinned gameId, else derived from the title, else
 *  the immutable id (so there is always something addressable). */
export function effectiveGameId(entity: { gameId?: string; title?: string; id: string }): string {
  const pinned = entity.gameId?.trim();
  if (pinned) return pinned;
  const fromTitle = entity.title ? gameIdify(entity.title) : "";
  return fromTitle || entity.id;
}

/**
 * The first free gameId of the form `base`, `base-2`, `base-3`, ... not already
 * in `taken`.
 *
 * A gameId is API - `deal()` and the play log speak it - so a name minted for a
 * new or duplicated entity must not collide with an existing one. This lived in
 * two copies, one in the editor and one in the CLI's kit scaffolder, character
 * for character the same; two copies of an addressing rule can drift, and a
 * drift here means the same act produces different addresses depending on which
 * program did it. It is here, beside `gameIdify`, because both programs need it
 * and no UI touches it.
 */
export function freeGameId(base: string, taken: ReadonlySet<string>): string {
  let gameId = base;
  for (let n = 2; taken.has(gameId); n++) gameId = `${base}-${n}`;
  return gameId;
}

/**
 * The first free TITLE of the form `base`, `base 2`, `base 3`, ... whose
 * derived gameId is not already in `taken`.
 *
 * The sibling of `freeGameId` for the "New box", "New deck" case, where the
 * author is given a title and the address follows from it. The dedupe is on the
 * DERIVED gameId rather than the title, because two titles that slug to one
 * address are the collision that matters.
 */
/**
 * An id-sorted collection in the order a person should SEE it.
 *
 * Storage is sorted by immutable id (source rule 5) so that two authors adding
 * one item each never touch the same line. That makes array position useless as
 * display order, so the order the author arranged rides in a sparse `order`
 * field, with position as the fallback and id to break a tie.
 *
 * One definition, because this rule has to give the same answer in four places
 * that a reader compares side by side: the compiler (what the bundle carries),
 * the editor (what the card document lists), the exports, and Find. When they
 * disagree, the editor shows one order and the game plays another.
 */
export function byDisplayOrder<T extends { id?: string; order?: number }>(items: readonly T[]): T[] {
  return items
    .map((x, i) => ({ x, key: x.order ?? i, i }))
    .sort((a, b) => a.key - b.key || ((a.x.id ?? "") < (b.x.id ?? "") ? -1 : (a.x.id ?? "") > (b.x.id ?? "") ? 1 : a.i - b.i))
    .map((e) => e.x);
}

export function freeTitle(base: string, taken: ReadonlySet<string>): string {
  let title = base;
  for (let n = 2; taken.has(gameIdify(title)); n++) title = `${base} ${n}`;
  return title;
}

// --- entities (generic over expression representation E) ---------------------

export interface Outcome<E> {
  id: string;
  gameId?: string;
  title?: string;
  purpose?: string;
  /** Authored display order (sparse; one without it falls back to its id
   *  position). Unlike `Card.order` this one IS compiled into the bundle:
   *  which option is offered first is authorial, and a host reading a dealt
   *  card's outcomes is building the player's menu. */
  order?: number;
  /** Gating; availability is always evaluated against current state. */
  condition?: E;
  /** Target ("@scope.name") -> expression; all right-hand sides evaluate
   *  against pre-play state (schema 3.7). */
  changes: Record<string, E>;
}

export interface Card<E> {
  id: string;
  gameId?: string;
  title?: string;
  purpose?: string;
  /** Authored display order within the deck (sparse; a card without one falls
   *  back to its id position). Merges as a per-card value, so id-sorted storage
   *  stays merge-clean (Reboot 7.4); dropped from the compiled bundle. */
  order?: number;
  condition?: E;
  /** Default 0; an expression must evaluate to a number. */
  priority: number | E;
  redraw: RedrawPolicy;
  /** Tags: tag group id -> tag ids. An absent group is a wildcard (matches
   *  any binding of it), except the reserved home group, whose default
   *  inverts (schema 2.4). Editors and fixtures speak gameIds; stored
   *  references are ids. */
  tags?: Record<string, string[]>;
  /** How many hands may hold this card at once (schema 3.5): integer >= 1,
   *  default 1. One copy is the exclusivity rule; copies: N is the
   *  deliberate opt-out for interchangeable filler. Always counted WITHIN a
   *  flow, whether or not the card is shared. */
  copies?: number;
  /** Scarcity across flows (design/shared-scarcity.md). Absent takes the
   *  deck's flag; set here it overrides the deck, so a single unique card can
   *  stay in the content it belongs to. A shared card's claims count every
   *  flow's board, and a shared `redraw: "never"` is spent for everyone the
   *  first time anyone plays it.
   *
   *  A finite `redraw` stays PER FLOW even when shared: a cooldown is an
   *  absolute turn of the card's box clock and clocks are per flow, so
   *  "3 turns of whose clock?" has no answer. A world-wide timer is a @world
   *  question, not an engine one (shared-scarcity 9.3.3). */
  shared?: boolean;
  /** The world cap: how many hands ACROSS EVERY FLOW may hold this at once.
   *  Read only when the card is shared, and defaults to `copies`, so the
   *  common case writes one number and "five in the world, one to a customer"
   *  is `copies: 1, sharedCopies: 5`. */
  sharedCopies?: number;
  /** Card-template data: field name -> value, validated at publish. */
  fields?: Record<string, ScalarValue>;
  outcomes: Outcome<E>[];
}

export interface Deck<E> {
  id: string;
  gameId?: string;
  title?: string;
  purpose?: string;
  /** The deck gate, evaluated once per draw in the draw's environment. */
  condition?: E;
  /** This pile is scarce across flows (design/shared-scarcity.md): every card
   *  in it is shared unless the card says otherwise. The container is where
   *  Patter puts its own shared-memory flag, and the deck is our container. */
  shared?: boolean;
  properties: PropertyDecl[];
  cards: Card<E>[];
}

export interface Tag {
  id: string;
  gameId?: string;
  /**
   * This tag's own starting values for properties its GROUP declares
   * (design/hand-typing.md). The group says what the property IS; a tag says
   * only where it starts, so "every zone has a haunting level" is written once
   * and "the cave starts at 2" is written where it belongs.
   *
   * A name here that the group does not declare is an error: it would be a
   * value for nothing.
   */
  values?: Record<string, ScalarValue>;
  /** Authored display order (sparse; one without it falls back to its id
   *  position). Merges as a per-item value, so id-sorted storage stays
   *  merge-clean (Reboot 7.4). */
  order?: number;
  properties?: PropertyDecl[];
  /** Template-of-play extras (e.g. spatial geometry). Source only: preserved
   *  in shards, never compiled into the bundle. */
  templates?: Record<string, unknown>;
}

/** A named axis for cross-cutting cards (schema 2.4, renamed from
 *  Dimension). Tags are declared, not freeform. */
export interface TagGroup {
  id: string;
  gameId?: string;
  purpose?: string;
  /**
   * A property reference (`"@story.act"`) whose value names a tag in this group
   * by gameId. The engine reads it at every ask and binds the group, exactly as
   * if the asking hand had chosen that tag; a hand's own binding wins.
   *
   * For an axis driven by STATE rather than by place: acts, chapters, a
   * difficulty band. Without it, only a hand can bind a group, so such an axis
   * had nowhere to gate and every card needed its own condition.
   *
   * A reference rather than an expression on purpose (design/where-and-
   * selectors.md Part B): a computed binding belongs in a property the outcomes
   * maintain, and an expression here would make this type generic for no gain.
   */
  boundBy?: string;
  /**
   * What omitting this group means for a card. Default false: omission is a
   * wildcard, so the card matches whatever the group is bound to. True inverts
   * it, so a card that names no tag here is unavailable wherever the group IS
   * bound (and unaffected where it is not).
   *
   * `place` is the built-in instance of this pair: bound to the asking hand,
   * and inverted per card rather than per group.
   */
  required?: boolean;
  /** Authored display order (sparse; one without it falls back to its id
   *  position). Merges as a per-item value, so id-sorted storage stays
   *  merge-clean (Reboot 7.4). */
  order?: number;
  /**
   * Properties EVERY tag in this group has (design/hand-typing.md). The
   * declaration lives here and each tag carries only its own starting value in
   * `Tag.values`, which is the separation the format was missing: a tag's own
   * `properties` entry has to restate the type on every tag purely in order to
   * say the value, and a tag added later silently arrives without it.
   *
   * Compiled by FLATTENING onto each tag, so the bundle keeps its per-tag
   * shape and no runtime, port or bundle schema changes: source is where the
   * author works and where merges happen, the bundle is a compiled artefact
   * that can afford to be explicit.
   *
   * A tag may still declare its own `properties` for a group whose tags
   * genuinely differ. Declaring the same NAME both ways is an error.
   */
  properties?: PropertyDecl[];
  tags: Tag[];
  /** Template-of-play extras for the GROUP, the same bag its tags carry: this is
   *  where a group is marked spatial and where that template keeps its own
   *  group-level configuration. Source only, preserved but never compiled.
   *
   *  A bag rather than a `spatial: true` flag because the marker and the
   *  configuration are one thing (see model/spatial.ts), and because core is not
   *  meant to grow a field per template of play. */
  templates?: Record<string, unknown>;
}

/** The reserved tag group (schema 2.4): present in every box without
 *  declaration, its tags the box's hand ids. Every hand implicitly binds it to
 *  itself; a card that names a place is available only at that place.
 *
 *  Called `place` rather than `home` since 2026-08-21: one word for one thing
 *  across the format, the editor and the exports. "Where" is the QUESTION a
 *  card answers (at a place, or anywhere in a region); "place" is the direct
 *  half of that answer. `home` was a metaphor an author had to learn, and it
 *  leaked into hand-edited shards and the docs. */
export const PLACE_GROUP = "place";

/** A declared kind of hand (schema 2.6): live-inherited, author-side only,
 *  never called from game code. One condition governs every instance. */
export interface HandTemplate<E> {
  id: string;
  gameId?: string;
  title?: string;
  purpose?: string;
  /** Authored display order (sparse; one without it falls back to its id
   *  position). Merges as a per-item value, so id-sorted storage stays
   *  merge-clean (Reboot 7.4). */
  order?: number;

  /** Fixed tag bindings: tag group id -> tag id. */
  bindings?: Record<string, string>;
  /** The holes: tag group ids each instance fills (one tag each). */
  chooses?: string[];
  /** Shared availability condition, ANDed in (schema 3.1); evaluated per
   *  instance against that instance's composed @hand. */
  condition?: E;
  /** Default slot cap. */
  slots: number | "unbounded";
  /** Declared @hand state every instance carries. */
  properties: PropertyDecl[];
}

/** A standalone hand's inline rule (schema 2.6): owned by the hand. */
export interface HandRule<E> {
  bindings?: Record<string, string>;
  condition?: E;
  slots: number | "unbounded";
}

/** A hand (schema 2.6): a template instance (template + chosen) or a
 *  standalone hand (rule). Exactly one of template / rule. Fully concrete:
 *  deal is name-only. */
export interface Hand<E> {
  id: string;
  /** The name deal() is called with; a rename is a breaking change
   *  (Reboot 7.4). */
  gameId?: string;
  title?: string;
  purpose?: string;
  /** Hand template id (not gameId). */
  template?: string;
  /** Template instances: tag group id -> tag id, one per `chooses` hole. */
  chosen?: Record<string, string>;
  /** Standalone hands: the inline rule. */
  rule?: HandRule<E>;
  /** Override; defaults to the template's / rule's slots. The ONLY template
   *  field an instance may override (schema 2.6). */
  slots?: number;
  /** Standalone hands' own @hand state (template instances inherit the
   *  template's declarations). */
  properties?: PropertyDecl[];
  /** Authored display order within the box (sparse; authoring-only, never
   *  compiled into the bundle - the compiler's explicit field list drops it). */
  order?: number;
  /** Template-of-play extras (e.g. a spatial pin). Source only. */
  templates?: Record<string, unknown>;
}

export interface Box<E> {
  id: string;
  gameId?: string;
  title?: string;
  purpose?: string;
  /** The only per-box ranking policy (Reboot 2.2). */
  ranking: { specificity: boolean };
  /** The card template: what every card in this box carries. */
  fields: FieldDecl[];
  properties: PropertyDecl[];
  tagGroups: TagGroup[];
  decks: Deck<E>[];
  handTemplates: HandTemplate<E>[];
  hands: Hand<E>[];
}

// --- the compiled bundle (.storyletsc) ---------------------------------------

export const BUNDLE_SCHEMA = "storylets/bundle@0";

/** Binds bundles to shards (staleness gate) and saves to bundles. */
export interface BundleContent {
  project: string;
  version: string;
  /** hash32 over the canonical source shards (schema 2.8). */
  hash: string;
}

export interface BundleSettings {
  playAdvancesTurns: number;
}

/**
 * A map that a bundle was asked to carry: one spatial tag group's geometry,
 * flattened for a host to draw (design/graphical-views.md 2, "The map MAY ship").
 *
 * INERT PAYLOAD. Nothing in the engine reads this and nothing ever will: the
 * runtime deals in tag names. It is here so a host that wants an in-game map does
 * not have to invent its own export, and it is absent unless the project asked
 * for it (`export.map`), so a build that does not want a map carries no bytes.
 *
 * GAME IDS throughout, never internal ids. Internal ids are authoring identity
 * and mean nothing outside the project; a host matches these against the same
 * names it passes to `peek`. There is nothing here to strip either, which is why
 * `metadata: "stripped"` needs no special case: no titles, no purposes.
 *
 * Sites are deliberately NOT here. A site is where an author parked a hand while
 * working, held in the view sidecar precisely because it is not content, and a
 * host that wants to place a hand already has its zone from the compiled binding.
 */
export interface BundleMap {
  /** The owning box, by gameId (tag groups are box-scoped). */
  box: string;
  /** The tag group this is a map of, by gameId. */
  group: string;
  /** One entry per zone that has been drawn; a tag with no polygon is not a
   *  place yet and is left out rather than shipped as an empty shape. */
  zones: { tag: string; polygon: ViewPoint[] }[];
  /** Background pictures, back to front, as bundle-relative paths. Hidden ones
   *  do not ship: what an author put away is not something to spring on a host. */
  backgrounds?: BundleBackground[];
}

/** One shipped picture. `locked` and `hidden` are authoring state and do not
 *  travel; the draw order is the array order. */
export interface BundleBackground {
  /** Where the file sits relative to the bundle ("assets/<box>/<file>"). */
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
}

export interface Bundle {
  schema: typeof BUNDLE_SCHEMA;
  content: BundleContent;
  metadata: "full" | "stripped";
  settings: BundleSettings;
  world: {
    properties: PropertyDecl[];
    /** ScopeRegistrySpec (@wildwinter/scoperegistry): the owned/foreign
     *  split. Absent = engine-owned @world (standalone play). */
    registry?: unknown;
  };
  story: {
    properties: PropertyDecl[];
  };
  boxes: Box<Expression>[];
  /** Maps, when the project asked for them. Absent is the normal state. */
  maps?: BundleMap[];
}

// --- the save envelope --------------------------------------------------------

export const SAVE_SCHEMA = "storylets/save@1";

export interface PlayRecord {
  /** Card and outcome by gameId (feeds the play-history functions). */
  card: string;
  outcome: string;
  turn: number;
}

/** A property bag: name -> value. */
export type PropertyBag = Record<string, ScalarValue>;

/** The per-scope property partitions one side of the sharing flag holds:
 *  a save carries one of these for the shared values and one per flow
 *  (design/flows.md). NO world key, in either: @world is the game's own
 *  state, resolved through the world resolver and saved by whoever owns
 *  it - "host saves its container once, each engine saves its own
 *  envelope" (engine-runtimes.md 3.1). */
export interface PropsPartition {
  story: PropertyBag;
  box: Record<string, PropertyBag>;
  deck: Record<string, PropertyBag>;
  hand: Record<string, PropertyBag>;
  /** Tag state, keyed by tag id. */
  value: Record<string, PropertyBag>;
}

/** One flow's snapshot inside the envelope (schema 4). */
export interface FlowSave {
  /** The per-flow property partitions. */
  props: PropsPartition;
  /** Per-box turn counters, keyed by box id (schema 3.4) - per flow: there
   *  is deliberately no global turn. */
  turns: Record<string, number>;
  /** mulberry32 state, uint32 (schema 3.3), per flow. */
  prng: number;
  /** Absolute next-eligible turn (of the card's box's clock) per card id;
   *  MAX_SAFE_INTEGER = never (deliberately not Infinity, which
   *  JSON-serialises to null). */
  cooldowns: Record<string, number>;
  /** Hand contents (card ids, in dealt order), keyed by hand id. The claims
   *  ledger is derived from this (schema 3.5). */
  board: Record<string, string[]>;
  playLog: PlayRecord[];
}

/** The whole engine, one envelope: the shared partitions once, then every
 *  live flow keyed by its id - Patter's shape (one shared blob + N flow
 *  blobs; multi-flow and save/load are the same feature). */
/** The engine's half of a save: what every flow shares. Properties, and the
 *  cards a shared `redraw: "never"` has taken out of the world for good
 *  (design/shared-scarcity.md). Claims are NOT here: they are derived from the
 *  live boards, and each flow's board rides its own blob. */
export interface SharedSave {
  props: PropsPartition;
  /** Card ids, sorted, so a save is byte-stable for a diff. */
  spent: string[];
}

export interface SaveEnvelope {
  schema: typeof SAVE_SCHEMA;
  content: BundleContent;
  shared: SharedSave;
  flows: Record<string, FlowSave>;
}

/** The .storyletsave FILE: the HOST's file, not the engine's - the engine's
 *  envelope plus, when the host keeps one, its @world container. This is
 *  "host saves its container once, each engine saves its own envelope"
 *  folded into one file for the single-host case; the ENGINE never reads or
 *  writes `world` (loadGame takes the envelope alone). */
export const SAVEFILE_SCHEMA = "storylets/savefile@1";

export interface SaveFile {
  schema: typeof SAVEFILE_SCHEMA;
  engine: SaveEnvelope;
  /** The host's @world values, saved and restored by the host. */
  world?: PropertyBag;
}

// --- source shards (design/storylets-source.md) --------------------------------

/** The project folder: a macOS package, a plain folder elsewhere. */
export const PROJECT_FOLDER_EXTENSION = ".storylets";
/** The compiled bundle (strict JSON; generated, never hand-edited). */
export const BUNDLE_EXTENSION = ".storyletsc";

/**
 * Where a shipped background sits, relative to the bundle file.
 *
 * One function so the compiler (which writes the name into the bundle) and the
 * export op (which writes the bytes) cannot drift apart: a path agreed in two
 * places is a path that eventually disagrees. Per BOX, because two boxes may
 * each have their own `plan.png` and a build must not silently keep one of them.
 */
export const bundleAssetPath = (boxGameId: string, file: string): string =>
  `assets/${boxGameId}/${file}`;
/** Per-type shard extensions, JSON5 inside (source doc section 2). */
export const SHARD_EXTENSIONS = {
  project: ".storyletproj",
  box: ".storyletbox",
  tags: ".storylettags",
  hands: ".storylethands",
  deck: ".storyletdeck",
  /** The arrangement layer: where things SIT, never what they are. Its own shard
   *  because positions churn (an afternoon of tidying a canvas touches every
   *  card) and content does not, so a designer arranging and a writer editing
   *  never collide on one file (design/graphical-views.md section 1.2). */
  view: ".storyletview",
  /** Threaded comments: content-ADJACENT, so neither in a content shard (a
   *  writer's deck edit must not conflict with a reviewer's comment) nor in the
   *  arrangement sidecar (this is not where anything sits). One per box,
   *  id-keyed (design/annotation.md). Documentation NOTES used to share this
   *  file and were retired: `purpose` already says why a thing exists, and
   *  Patterpad's typed routing has no destination here. */
  notes: ".storyletnotes",
} as const;

export const PROJECT_SCHEMA = "storylets/project@0";
export const BOX_SCHEMA = "storylets/box@0";
export const TAGS_SCHEMA = "storylets/tags@0";
export const HANDS_SCHEMA = "storylets/hands@0";
export const DECK_SCHEMA = "storylets/deck@0";
export const VIEW_SCHEMA = "storylets/view@0";
/** The comment sidecar's schema. Still called "notes" on disk: the file already
 *  held both, and renaming it would break every project for no gain. */
export const NOTES_SCHEMA = "storylets/notes@0";

/** A point in a canvas's own coordinates. */
export interface ViewPoint {
  x: number;
  y: number;
}

/**
 * Canvas furniture: what an author draws AROUND the content to make sense of it
 * (design/graphical-views.md 3, "Frames and sites").
 *
 * Both canvases carry the same thing, which is why they share a type: a node
 * canvas and a map are different views of different material, but "put a box
 * round this lot and call it act two" is the same thought on either.
 *
 * It lives in the view sidecar because it is ARRANGEMENT. Nothing here is
 * content: no runtime reads it, no bundle carries it, and deleting the sidecar
 * loses only the drawing. Threaded comments are the
 * other thing entirely - they attach to entities and they travel - but a canvas
 * DRAWS their markers, while owning none of them.
 */
export interface CanvasFurniture {
  /** Titled areas behind the content, back to front (see `stacked`).
   *
   *  There was a second kind, a `stickies` list, retired on 2026-08-10
   *  (design/annotation.md): a dropped comment marker does the same job in a
   *  fraction of the space, and an annotation that takes as much room as the
   *  thing it is about is a bad trade on a canvas. */
  frames?: Frame[];
}

/**
 * A titled area behind a group of things: Unreal's comment box.
 *
 * Deliberately dumb about what is inside it. It has no membership list and
 * computes none: a frame is a thing an author DREW, and the cards under it are
 * whatever happens to be under it now. That is what keeps it honest when content
 * moves, and it is the same reasoning that keeps a zone's sites out of the map's
 * sidecar.
 */
export interface Frame extends ViewPoint {
  id: string;
  w: number;
  h: number;
  /** Shown in the frame's bar, and the handle it is dragged by. */
  title?: string;
  /** One of the furniture palette's names (see `FURNITURE_COLOURS`); the theme
   *  decides what that looks like, so a frame does not carry a hex value that
   *  would fight the palette on the day somebody switches theme. */
  colour?: string;
  /** Place in the frame band (sparse, `stacked`). Frames can nest. */
  z?: number;
}

/** The furniture palette: names, not colours. The theme maps them, so the same
 *  shard reads correctly on linen and on baize. */
export const FURNITURE_COLOURS = ["paper", "amber", "sage", "sky", "rose", "slate"] as const;
export type FurnitureColour = typeof FURNITURE_COLOURS[number];

/** One deck's node canvas: where its cards sit, and the furniture around them.
 *  Sparse throughout. A card with no entry lays out by default, and an entry for
 *  a card that no longer exists is inert, so there is no referential integrity to
 *  maintain against content that moves underneath. */
export interface DeckCanvas extends CanvasFurniture {
  /** Keyed by CARD id. */
  cards?: Record<string, ViewPoint>;
}

/** The box's map: where its hands sit in space, and the furniture around them. */
export interface BoxMap extends CanvasFurniture {
  /** Keyed by HAND id. WHERE a site is, and nothing else.
   *
   *  Which zone it is IN is not recorded here, and deliberately (2026-08-06,
   *  with the rebinding drag): a hand that binds a zone already says so in its
   *  own shard, as `chosen` or as a rule binding, and that is the truth the
   *  runtime deals from. A copy here could only ever go on to disagree with it,
   *  and a site whose recorded zone contradicts the hand it stands for would be
   *  the most misleading thing on the map.
   *
   *  Called `pins` until 2026-08-10 (design/annotation.md). No compatibility
   *  branch: the only projects that exist are the examples in this repo, and they
   *  were edited. */
  sites?: Record<string, ViewPoint>;
}

/** The arrangement layer for one box: where things SIT, never what they are.
 *
 *  Its own shard on purpose (design/graphical-views.md section 1.2). Positions
 *  churn, content does not: an afternoon of tidying a canvas touches every card,
 *  and if that lived in the deck shard then a designer arranging and a writer
 *  editing card text would collide on one file all day, while a content review
 *  would be full of coordinates. Keyed by id throughout so the existing merge
 *  engine handles two designers rearranging different things without a conflict.
 *
 *  Source-only. It never reaches the compiled bundle, exactly as `order` does
 *  not: the compiler reads the fields it names and this is not among them. */
export interface ViewShard {
  schema: typeof VIEW_SCHEMA;
  /** Keyed by DECK id: one node canvas each. */
  canvases?: Record<string, DeckCanvas>;
  map?: BoxMap;
}

/** A coverage input driver: during a coverage run the harness feeds a
 *  host-seam property (`@world.x`) values from `values`, so content gated on
 *  external state gets exercised (Patter's coverageDrivers, carried whole). */
export interface CoverageDriver {
  /** "initial": set once as each playthrough starts. "recurring": re-rolled
   *  per turn at the cadence, so one run passes through several states. */
  kind: "initial" | "recurring";
  /** For recurring drivers: how often to re-roll per turn (default "sometimes"). */
  cadence?: "rarely" | "sometimes" | "often";
  /** The pool the harness picks from (uniform). Empty = inert. */
  values: ScalarValue[];
}

/** Authoring-side coverage configuration (never compiled into the bundle). */
export interface CoverageConfig {
  /** Property drivers, keyed by ref ("@world.danger"). */
  drivers?: Record<string, CoverageDriver>;

}

export interface ProjectShard {
  schema: typeof PROJECT_SCHEMA;
  project: {
    id: string;
    name: string;
    version: string;
  };
  settings: BundleSettings;
  /** Coverage drivers + argument domains (authoring/testing config; stays
   *  out of the compiled bundle). */
  coverage?: CoverageConfig;
  /** Validation switches (authoring config; never compiled). Off is written
   *  as ABSENT, like `export.map`: a shard says what an author chose. */
  validation?: {
    /** Also warn when state is WRITTEN but nothing reads it. Off by default:
     *  cards are routinely written ahead of the content that will read them,
     *  so mid-development this warning is mostly noise. The read side (a gate
     *  on state nothing writes) always warns, because that kills cards now. */
    warnUnreadWrites?: boolean;
  };
  world: {
    properties: PropertyDecl[];
    registry?: unknown;
  };
  story: {
    properties: PropertyDecl[];
  };
  /** Templates of play: configuration bags keyed by template name. Core
   *  validates only what it knows. */
  templates: Record<string, unknown>;
  export: {
    bundle: string;
    metadata: "full" | "stripped";
    /**
     * Does a `.storyletpack` carry the boxes' binary assets (background images)?
     *
     * Default false, and a project-level DEFAULT rather than a rule: a pack is a
     * delivery, so the caller can override it per pack (2026-08-07). Some
     * projects would benefit from sending their pictures in certain
     * circumstances and others never would, which is why neither "always" nor
     * "never" is the answer.
     *
     * Nothing to do with the compiled bundle, which has its own switch: `map`.
     */
    packAssets?: boolean;
    /**
     * Does the compiled bundle carry the maps (zone shapes and background
     * pictures)?
     *
     * Default false, and the default matters: geometry is authoring data, the
     * runtime deals in tag names, and a shipping build should carry nothing it
     * does not use. But a host that wants an in-game map should not have to
     * invent its own export, and it is most useful early - a prototype with a
     * real map beats a prototype with a list of zone names.
     *
     * It sits beside `metadata` on purpose: that is already the switch for
     * "authoring data that may or may not ship", and this is its sibling rather
     * than a new concept. With it on, `export` also writes the background files
     * next to the bundle, and `describeBundle` says what is in there.
     */
    map?: boolean;
  };
}

export interface BoxShard {
  schema: typeof BOX_SCHEMA;
  box: {
    id: string;
    gameId?: string;
    title?: string;
    purpose?: string;
    /** Authored display order among boxes (sparse; absent falls back to the
     *  folder-name position). Authoring-only, like a card's (never compiled
     *  into the bundle); merges as a per-field value. */
    order?: number;
    ranking: { specificity: boolean };
    fields: FieldDecl[];
    properties: PropertyDecl[];
  };
}

/** The box's tag groups: how its cards are filed. */
export interface TagsShard {
  schema: typeof TAGS_SCHEMA;
  groups: TagGroup[];
}

/** The box's hand templates + hands (the writer/programmer contract). */
export interface HandsShard {
  schema: typeof HANDS_SCHEMA;
  templates: HandTemplate<string>[];
  hands: Hand<string>[];
}

export interface DeckShard {
  schema: typeof DECK_SCHEMA;
  deck: {
    id: string;
    gameId?: string;
    title?: string;
    purpose?: string;
    condition?: string;
    /** Scarce across flows: see Deck.shared. */
    shared?: boolean;
    /** Authored display order within the box (sparse; see BoxShard). */
    order?: number;
    properties: PropertyDecl[];
  };
  cards: Card<string>[];
}

// --- templates of play --------------------------------------------------------
// The spatial template's types, field access and geometry. Re-exported here so the
// package has one entry point, and kept in its own module because core schema and
// a template of play are different things (Reboot 6).
export * from "./spatial.js";

// How a hand reaches a tag group, and whether that binding is the hand's own to
// change. Core schema rather than a template of play, but the map is what needed
// it said out loud.
export * from "./hands.js";

// Frames: what an author draws around the content. Arrangement,
// so it lives in the sidecar and reads forgivingly (furniture.ts says why).
export * from "./furniture.js";

// Threaded comments: the conversation about a thing, in its own sidecar.
export * from "./comments.js";

// Guessing a property's type from what an outcome writes: the quick fix's input.
export * from "./infer.js";
