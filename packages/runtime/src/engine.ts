// ---------------------------------------------------------------------------
// The reference runtime: an Engine is the world + flow manager, and ALL play
// happens on a Flow handle (design/flows.md; the shape is Patter's, adopted
// deliberately so a host driving both engines holds two objects with the
// same grammar). The dealing semantics of design/storylets-schema.md
// section 3 run per flow, implemented exactly and held to the conformance
// corpus.
//
// The flow model, in one place:
//   - an Engine owns the bundle, every lookup built from it, the SHARED
//     property partitions and the @world resolver; a Flow owns its own
//     PRNG, per-box clocks, cooldowns, board, claims, play history and the
//     per-flow property partitions. Flows meet only through shared state.
//   - sharing is a per-property `shared` flag on the declaration (never a
//     scope token): @story defaults shared; box, deck, hand and tag
//     properties default per-flow. Every name is shared XOR per-flow, so a
//     read is a union of two bags and a write routes by name.
//   - @world is the game's own state: always engine-level, resolved through
//     the host's resolver (EngineOptions.world) or a self-backed bag, and
//     NEVER in saveGame() - the host saves its container, each engine saves
//     its own envelope (engine-runtimes.md 3.1).
//   - there is no default flow and no ambient current flow: openFlow(id) is
//     the only way in, an existing id is REPLACED (the old flow closes),
//     and a closed flow's handle is INERT - every verb throws (Patter's
//     stale-handle rule).
//   - engine.getProperty serves world.* and shared refs only; a ref that
//     resolves per-flow throws, naming the fix (Patter's teaching rule).
//
// Key dealing contracts, unchanged from round 2 (all per flow now):
//   - two verbs: deal(hand) claims, peek(box, criteria) just looks; you can
//     never play a card you only peeked (3.1, look/use rule)
//   - availability order: deck gate -> cooldown -> tags -> hand condition ->
//     card condition -> claims (3.1)
//   - claims are physical WITHIN a flow: a card sits in at most `copies`
//     hands of that flow's board at once, at most once in any one hand; the
//     ledger is derived from the board contents (3.5)
//   - a SHARED card (its deck's flag, or its own overriding it) is scarce
//     across flows too: at most `sharedCopies` hands anywhere, counted over
//     every live flow's board, and a shared `redraw: "never"` is spent for
//     everyone the first time anyone plays it. A finite redraw deliberately
//     stays per flow - a cooldown is an absolute turn of a per-flow clock, so
//     there is nothing shared to compare it against (design/shared-scarcity.md)
//   - the reserved home group inverts the wildcard: a homed card is
//     available only to an ask binding its home (2.4)
//   - ranking: priority desc -> specificity desc (box toggle) -> seeded
//     shuffle of each maximal tie run (3.2)
//   - one PRNG per flow: expression random(), tie shuffles and the batch
//     deal's hand-order shuffle all advance it; state lives in the save (3.3)
//   - each box has its own turn counter PER FLOW; cooldowns are absolute
//     next-eligible turns of the card's box's clock, set at play time from
//     the post-advance turn; "never" is MAX_SAFE_INTEGER, not Infinity (3.4)
//   - @hand composes bound-tag props -> hand props -> chosen tags/criteria
//     (by group name), later shadowing earlier; writes route back to their
//     source; criteria names cannot be written (3.6)
//   - outcome availability is never snapshotted: outcomes() and play()
//     evaluate gates against current state (3.1, 3.7)
//   - a trace event fires after the state it reports has landed, so a
//     handler reading the flow inside it sees the effect (the Live Link's
//     board snapshot depends on this; the shared fixture pins it)
// ---------------------------------------------------------------------------

import { deserialiseAst, evaluate } from "@wildwinter/expr";
import type { EvalContext, ExprNode, ScalarValue, ScopeResolver } from "@wildwinter/expr";
import { matchedSpecificity } from "@wildwinter/expr-specificity";
import { storyletsDialect, NEVER_PLAYED } from "@storylet-studio/dialect";

/** The play-history indexes' key for one (group, tag) pair.
 *
 *  A UNIT SEPARATOR (U+001F) joins them: ids are letters, digits and
 *  underscores, so a control character cannot occur in one and two different
 *  pairs can never collide into one key the way a "." or ":" join could. NUL
 *  would say the same thing and was the first choice, but GDScript will not
 *  carry one in a string - it substitutes U+FFFD and warns on every parse - and
 *  the four runtimes keep the same spelling. */
const tagKey = (groupId: string, tagId: string): string => `${groupId}\u001f${tagId}`;

import type { StoryletsHost } from "@storylet-studio/dialect";
import { PLACE_GROUP, effectiveGameId } from "@storylet-studio/model";
import type {
  Box, Bundle, Card, Deck, Expression, FlowSave, Hand, HandTemplate,
  PlayRecord, PropertyBag, PropertyDecl, PropsPartition, SaveEnvelope, Tag, TagGroup,
} from "@storylet-studio/model";
import { PropertyBag as StateBag } from "@wildwinter/scoperegistry";
import type { PropertyRow } from "@wildwinter/scoperegistry";
import { makePrng, shuffleInPlace } from "./prng.js";
import type { Prng } from "./prng.js";

export interface EngineOptions {
  /** Default seed for each flow's PRNG; override per flow in openFlow
   *  (cross-runtime determinism, schema 3.3). Default 0. */
  seed?: number;
  /** Retain each flow's event log for introspection - the game-engine seam
   *  (schema 5): every trace event, sequence-stamped and turn-stamped where
   *  the event has a box context. `true` keeps the default 1000 entries
   *  (oldest dropped first). Off by default; subscribeTrace stays the
   *  zero-retention stream. */
  log?: boolean | { cap?: number };
  /**
   * The host's resolver for @world - the values the game owns and the
   * story reads (and, where `set` is offered, writes). Omit it and the
   * engine self-backs @world from the declared defaults. Engine-level,
   * shared by all flows, never in saveGame(): the host saves its container
   * once, each engine saves its own envelope (design/flows.md).
   */
  world?: ScopeResolver;
}

export interface OpenFlowOptions {
  /** Seed for this flow's PRNG (defaults to the engine's `seed`). */
  seed?: number;
}

/** A card view in a dealt hand or a peeked list. Carries NO outcome
 *  availability - ask `outcomes()` for current truth (schema 5). */
export interface DealtCard {
  id: string;
  gameId: string;
  title?: string;
  purpose?: string;
  fields?: Record<string, ScalarValue>;
}

export interface OutcomeView {
  id: string;
  gameId: string;
  title?: string;
  purpose?: string;
  /** Evaluated against CURRENT state at the moment of the ask. */
  available: boolean;
}

/** What a peek returns: the top of the stock, looked at and put back.
 *  The engine has no pick policy (Reboot 2.1). */
export interface RankedList {
  box: string;
  cards: DealtCard[];
}

export interface PlayOptions {
  /** Turn advance override; default settings.playAdvancesTurns. */
  advanceTurns?: number;
}

// --- the trace (schema 5): the deal/play log for tooling ----------------------

/** Why a card did or did not make an ask, in availability order (schema 3.1). */
export type TraceVerdict =
  | "dealt"        // in the hand / the returned list
  | "capped"       // eligible, ranked below the size cap
  | "cooldown"     // schema 3.1 step 1
  | "deck-gate"    // step 2
  | "tags"         // step 3 (incl. the home group's inverted default)
  | "condition"    // steps 4-5 (a failing or erroring condition)
  | "priority"     // a priority expression errored or was not a number
  | "claimed"      // step 6: no free copy on YOUR board
  | "claimed-elsewhere"  // step 6: another flow holds the world's copies
  | "taken";       // a shared redraw:never was spent, by anyone, for everyone

/** One event on the deal/play log - "why did Ambush at the ford get dealt
 *  here?" is answered by the ask event's per-card verdicts and keys. The
 *  verb is the event type, so a peek is distinguishable from a deal when
 *  reading a run back. */
export type TraceEvent =
  | {
      type: "deal";
      /** Hand gameId. */
      hand: string;
      cards: { id: string; verdict: TraceVerdict; priority?: number; specificity?: number }[];
    }
  | {
      type: "peek";
      /** Box gameId. */
      box: string;
      criteria: Record<string, string>;
      cards: { id: string; verdict: TraceVerdict; priority?: number; specificity?: number }[];
    }
  | { type: "evict"; hand: string; card: string; reason: TraceVerdict | "hand-condition" | "vanished" }
  | { type: "play"; card: string; outcome: string; turn: number }
  /** One landed outcome change; `path` is the resolved store location (a
   *  routed @hand write shows where it actually went, schema 3.6). `prev`
   *  is the value it replaced, so a log can read "0 -> 1". */
  | { type: "write"; target: string; path: string; value: ScalarValue; prev?: ScalarValue }
  /** An explicit clock advance via advanceTurns (schema 3.4); `turn` is the
   *  box's new value. Plays stamp their own turn on the play event. */
  | { type: "turns"; box: string; turn: number }
  /** An expression eval error: never a silent pass (schema 3.1), always a
   *  visible diagnostic. */
  | { type: "diagnostic"; where: string; message: string };

export type TraceHandler = (event: TraceEvent) => void;
/** The engine-level tap: every flow's events, tagged with the flow id -
 *  the tools' one stream. */
export type EngineTraceHandler = (flow: string, event: TraceEvent) => void;

/** A retained log entry: the trace event plus its place in flow time.
 *  `seq` orders the whole flow (monotonic; survives clearLog). `turn` is
 *  the clock of the box the event happened in when it fired (peek: the box;
 *  deal/evict: the hand's box; play and its writes: the played card's box,
 *  stamped together with the play's own turn). Diagnostics carry no turn. */
export type LogEntry = TraceEvent & { seq: number; turn?: number };

/** One entry on the ENGINE's log: the same event, plus the flow it happened
 *  in. A run is several flows over shared state, so "what happened in this
 *  run" is only answerable in one ordered stream, and only if each line says
 *  who. The flow's own log stays flow-local and unchanged. */
export type EngineLogEntry = LogEntry & { flow: string };

// --- internals ---------------------------------------------------------------

interface CardEntry {
  card: Card<Expression>;
  deck: Deck<Expression>;
  box: Box<Expression>;
}

/** Is this card scarce across flows (design/shared-scarcity.md)? The deck says
 *  what the pile is for and the card may override it, the same inheritance a
 *  property has with its scope default. Hoist the deck's flag out of a card
 *  loop and pass the answer down: the ask runs this per card per deal. */
const cardIsShared = (card: Card<Expression>, deckShared: boolean): boolean =>
  card.shared ?? deckShared;

/** How many hands ACROSS EVERY FLOW may hold this at once. Defaults to
 *  `copies`, so the common case writes one number and only "five in the world,
 *  one to a customer" needs both. Meaningless on an unshared card, and the
 *  compiler warns when one sets it. */
const sharedCap = (card: Card<Expression>): number => card.sharedCopies ?? card.copies ?? 1;

type HandSource = { kind: "value"; id: string } | { kind: "hand"; id: string } | { kind: "criteria" };

/** The composed @hand for one ask: the read bag, plus where each name
 *  routes on write (schema 3.6). */
interface HandEnv {
  bag: PropertyBag;
  sources: Map<string, HandSource>;
  /** tag group id -> bound tag id (home included, its "tag" a hand id). */
  boundTags: Map<string, string>;
}

/** One ask, resolved: a deal (hand present, condition from its template or
 *  rule) or a peek (criteria only, no condition - schema 3.1). */
interface AskDescriptor {
  box: Box<Expression>;
  hand?: Hand<Expression>;
  condition?: Expression;
  /** tag group id -> tag id, everything the ask binds (fixed + chosen +
   *  criteria; for deals also home -> the hand's own id). */
  boundTags: Map<string, string>;
  /** Chosen tags / criteria surfaced into @hand by group gameId, the tag's
   *  gameId as the value (schema 3.6). */
  askNames: Record<string, string>;
}

// Stores are shared-kernel bags (@wildwinter/scoperegistry, the properties
// implementer Patter shares): identity normalisation because storylets
// property names are case-significant as authored.
// `pathPrefix` carries its own separator, so a bag composes its rows' addresses itself
// (`story.gold`, `deck.tavern.drawn`) instead of every caller pasting a prefix onto a row.
const bagFromDecls = (decls: PropertyDecl[], pathPrefix: string): StateBag =>
  new StateBag(decls, { normalise: (n) => n, pathPrefix });

// Truthiness for a bare condition. Booleans and numbers as you would expect;
// a string passes when non-empty and a flag list when non-empty, matching
// JavaScript's own coercion for those two.
//
// Until 2026-09-01 this admitted ONLY booleans and numbers, and Patterplay's
// `truthy` admitted strings and lists as well. That was drift from writing the
// two engines at different times, not a considered difference: the two share a
// property registry, so the same value read from the same registry answered a
// condition differently depending on which engine asked. expr-specificity calls
// truthiness host-bound, and it is, but "host-bound" is licence for a host to
// choose, not licence for two hosts in one family to disagree by accident.
function conditionPasses(v: ScalarValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  return v.length > 0; // string[] (flags)
}

/** One examiner row, addressed by the property-path grammar
 *  (getProperty / setProperty take the same `path`).
 *
 *  An ALIAS now. This was the shared row plus a `path`, declared here because the shared
 *  row had no address field - and Patterplay had forked it for the same reason, in the
 *  same shape, in its own runtimes. `path` moved onto the shared PropertyRow on
 *  2026-09-02 and a bag composes it from its own pathPrefix, so there is nothing left to
 *  add; the name stays because it is exported API and reads well at call sites. */
export type PropertyView = PropertyRow;

/** One kernel bag with its store path prefix (story / box.<id> / deck.<id>
 *  / hand.<id> / value.<id>): the state logger's mount surface
 *  (design/engine-runtimes.md 3.4 - the logger builds on the PropertyBag
 *  audit hook, so it needs the bags themselves, not just their rows).
 *  The Engine lists the shared bags, a Flow its own; the @world container
 *  is the host's bag and the host mounts it itself. loadGame() replaces
 *  every bag, so re-enumerate after a load. */
export interface BagMount {
  prefix: string;
  bag: StateBag;
}

/** One box on the enumeration surface (examiners, hosts): identity plus
 *  its clock (per flow). */
export interface BoxView {
  id: string;
  gameId: string;
  title?: string;
  turn: number;
}

/** The sharing default per scope (design/flows.md, the old system's rule):
 *  @story is the playthrough family's globals, shared; the narrower scopes
 *  are geographic, per-flow, so "this flow's danger in the docks" stays
 *  expressible. A declaration's `shared` flag overrides. */
const SCOPE_DEFAULT_SHARED = { story: true, box: false, deck: false, hand: false, value: false } as const;
type FlaggedScope = keyof typeof SCOPE_DEFAULT_SHARED;

const isShared = (scope: FlaggedScope, d: PropertyDecl): boolean => d.shared ?? SCOPE_DEFAULT_SHARED[scope];
const sharedHalf = (scope: FlaggedScope, decls: PropertyDecl[]): PropertyDecl[] =>
  decls.filter((d) => isShared(scope, d));
const flowHalf = (scope: FlaggedScope, decls: PropertyDecl[]): PropertyDecl[] =>
  decls.filter((d) => !isShared(scope, d));

/** One side's five stores (shared on the engine, per-flow on each flow). */
interface Partition {
  story: StateBag;
  box: Map<string, StateBag>;
  deck: Map<string, StateBag>;
  hand: Map<string, StateBag>;
  value: Map<string, StateBag>;
}

type PartitionKind = keyof Partition;

/** Everything a Flow shares with its Engine: the bundle-derived lookups
 *  (immutable), the shared stores (replaced wholesale by loadGame/reset),
 *  and the seams. One object, held by both classes - the two are one
 *  machine in two lifetimes. */
interface Internals {
  bundle: Bundle;
  logCap?: number;
  cardsById: Map<string, CardEntry>;
  cardsByGameId: Map<string, CardEntry>;
  boxesByGameId: Map<string, Box<Expression>>;
  boxesById: Map<string, Box<Expression>>;
  handsById: Map<string, { hand: Hand<Expression>; box: Box<Expression> }>;
  handsByGameId: Map<string, { hand: Hand<Expression>; box: Box<Expression> }>;
  templatesById: Map<string, HandTemplate<Expression>>;
  groupsById: Map<string, { group: TagGroup; box: Box<Expression> }>;
  requiredGroups: Set<string>;
  nodeCache: WeakMap<Expression, ExprNode>;
  ladders: {
    world: Map<string, readonly string[]>;
    story: Map<string, readonly string[]>;
    box: Map<string, Map<string, readonly string[]>>;
    deck: Map<string, Map<string, readonly string[]>>;
    value: Map<string, Map<string, readonly string[]>>;
    hand: Map<string, Map<string, readonly string[]>>;
  };
  hasQualities: boolean;
  /** Does ANY deck or card in the bundle opt into shared scarcity? False for
   *  the overwhelming majority of projects, and when it is false the two
   *  claim-ledger walks in dealing are skipped entirely. Same idea as
   *  `hasQualities` above: a bundle that does not use a feature must not pay
   *  for it. */
  hasShared: boolean;
  /** The per-flow halves of every declaration list, precomputed once: each
   *  new flow builds its bags from these. */
  flowDecls: { story: PropertyDecl[]; box: Map<string, PropertyDecl[]>; deck: Map<string, PropertyDecl[]>; hand: Map<string, PropertyDecl[]>; value: Map<string, PropertyDecl[]> };
  /** The shared stores. Reassigned wholesale by loadGame/reset. */
  shared: Partition;
  /** @world: the host's resolver, or the self-backed bag's. */
  worldResolver: ScopeResolver;
  /** `turn` is the box clock the event happened on, where the caller knows it
   *  - the same stamp the flow's own log carries. Unity and Unreal passed it
   *  from the start; JS and Godot dropped it, so their examiners printed "[-]"
   *  on every deal, peek, evict and write line while the other two printed the
   *  real turn. Four runtimes, two different run logs (2026-08-29). */
  emitEngine: (flow: string, event: TraceEvent, turn?: number) => void;
  engineTracing: () => boolean;
}

const handDeclsOf = (internals: Internals, hand: Hand<Expression>): PropertyDecl[] => {
  if (hand.template !== undefined) {
    return internals.templatesById.get(hand.template)?.properties
      ?? internals.bundle.boxes.flatMap((b) => b.handTemplates).find((t) => t.id === hand.template)?.properties
      ?? [];
  }
  return hand.properties ?? [];
};

/** Build one side of the partition from the bundle. */
const buildPartition = (internals: Internals, half: (scope: FlaggedScope, decls: PropertyDecl[]) => PropertyDecl[]): Partition => {
  const b = internals.bundle;
  return {
    story: bagFromDecls(half("story", b.story.properties), "story."),
    box: new Map(b.boxes.map((box) => [box.id, bagFromDecls(half("box", box.properties), `box.${box.id}.`)])),
    deck: new Map(b.boxes.flatMap((box) => box.decks.map(
      (deck): [string, StateBag] => [deck.id, bagFromDecls(half("deck", deck.properties), `deck.${deck.id}.`)]))),
    // A template instance inherits the template's property declarations;
    // a standalone hand declares its own (schema 2.6).
    hand: new Map(b.boxes.flatMap((box) => box.hands.map(
      (hand): [string, StateBag] => [hand.id, bagFromDecls(half("hand", handDeclsOf(internals, hand)), `hand.${hand.id}.`)]))),
    value: new Map(b.boxes.flatMap((box) => box.tagGroups.flatMap((group) => group.tags.map(
      (tag): [string, StateBag] => [tag.id, bagFromDecls(half("value", tag.properties ?? []), `value.${tag.id}.`)])))),
  };
};

const partitionValues = (p: Partition): PropsPartition => ({
  story: p.story.values,
  box: Object.fromEntries([...p.box].map(([id, bag]) => [id, bag.values])),
  deck: Object.fromEntries([...p.deck].map(([id, bag]) => [id, bag.values])),
  hand: Object.fromEntries([...p.hand].map(([id, bag]) => [id, bag.values])),
  value: Object.fromEntries([...p.value].map(([id, bag]) => [id, bag.values])),
});

const loadPartition = (p: Partition, values: PropsPartition | undefined): void => {
  // Fresh defaults are already in the bags; the saved values land over
  // them: orphaned keys (deleted entities, re-flagged properties) drop;
  // newly declared properties keep defaults.
  p.story.load(values?.story ?? {});
  for (const kind of ["box", "deck", "hand", "value"] as const) {
    for (const [id, bag] of Object.entries(values?.[kind] ?? {})) {
      p[kind].get(id)?.load(bag);
    }
  }
};

// --- the Engine ---------------------------------------------------------------

export class Engine {
  private readonly internals: Internals;
  private readonly seed: number;
  private readonly flowsById = new Map<string, Flow>();
  private readonly engineTraceHandlers = new Set<EngineTraceHandler>();
  /** The host's @world binding, if the engine was built with one: it
   *  outlives reset/loadGame (the host's container is the host's). The
   *  self-backed resolver is rebuilt instead. */
  private readonly hostWorld?: ScopeResolver;

  constructor(bundle: Bundle, opts: EngineOptions = {}) {
    this.seed = opts.seed ?? 0;
    if (opts.world !== undefined) this.hostWorld = opts.world;
    const internals: Internals = {
      bundle,
      ...(opts.log ? { logCap: typeof opts.log === "object" ? (opts.log.cap ?? 1000) : 1000 } : {}),
      cardsById: new Map(), cardsByGameId: new Map(),
      boxesByGameId: new Map(), boxesById: new Map(),
      handsById: new Map(), handsByGameId: new Map(),
      templatesById: new Map(), groupsById: new Map(),
      requiredGroups: new Set(),
      nodeCache: new WeakMap(),
      ladders: { world: new Map(), story: new Map(), box: new Map(), deck: new Map(), value: new Map(), hand: new Map() },
      hasQualities: false,
      hasShared: false,
      flowDecls: { story: [], box: new Map(), deck: new Map(), hand: new Map(), value: new Map() },
      shared: undefined as unknown as Partition,
      worldResolver: undefined as unknown as ScopeResolver,
      emitEngine: (flow, event, turn) => {
        if (this.internals.logCap !== undefined) {
          this.engineLog.push({ ...event, flow, seq: this.engineSeq++, ...(turn !== undefined ? { turn } : {}) });
          if (this.engineLog.length > this.internals.logCap) {
            this.engineLog.splice(0, this.engineLog.length - this.internals.logCap);
          }
        }
        for (const h of this.engineTraceHandlers) h(flow, event);
      },
      engineTracing: () => this.engineTraceHandlers.size > 0,
    };
    this.internals = internals;

    for (const box of bundle.boxes) {
      internals.boxesById.set(box.id, box);
      internals.boxesByGameId.set(effectiveGameId(box), box);
      for (const group of box.tagGroups) {
        internals.groupsById.set(group.id, { group, box });
        if (group.required === true) internals.requiredGroups.add(group.id);
      }
      for (const deck of box.decks) {
        if (deck.shared === true) internals.hasShared = true;
        for (const card of deck.cards) {
          const entry = { card, deck, box };
          internals.cardsById.set(card.id, entry);
          internals.cardsByGameId.set(effectiveGameId(card), entry);
          if (card.shared === true) internals.hasShared = true;
        }
      }
      for (const template of box.handTemplates) {
        internals.templatesById.set(template.id, template);
      }
      for (const hand of box.hands) {
        internals.handsById.set(hand.id, { hand, box });
        internals.handsByGameId.set(effectiveGameId(hand), { hand, box });
      }
    }
    this.initLadders();

    // The per-flow halves, precomputed once (a bundle's declarations never
    // change): each openFlow builds its bags from these.
    internals.flowDecls = {
      story: flowHalf("story", bundle.story.properties),
      box: new Map(bundle.boxes.map((box) => [box.id, flowHalf("box", box.properties)])),
      deck: new Map(bundle.boxes.flatMap((box) => box.decks.map(
        (deck): [string, PropertyDecl[]] => [deck.id, flowHalf("deck", deck.properties)]))),
      hand: new Map(bundle.boxes.flatMap((box) => box.hands.map(
        (hand): [string, PropertyDecl[]] => [hand.id, flowHalf("hand", handDeclsOf(internals, hand))]))),
      value: new Map(bundle.boxes.flatMap((box) => box.tagGroups.flatMap((group) => group.tags.map(
        (tag): [string, PropertyDecl[]] => [tag.id, flowHalf("value", tag.properties ?? [])])))),
    };

    this.initShared(this.hostWorld);
  }

  /** Build the shared stores and the @world seam. `hostWorld` sticks for the
   *  engine's lifetime; reset/loadGame rebuild the shared bags around it. */
  private initShared(hostWorld?: ScopeResolver): void {
    const internals = this.internals;
    internals.shared = buildPartition(internals, sharedHalf);
    if (hostWorld !== undefined) {
      internals.worldResolver = hostWorld;
    } else {
      // Standalone: self-backed from the declared defaults. Still FOREIGN
      // in spirit - never in saveGame(); a host that wants @world to
      // persist saves the container itself (play-helpers ships one).
      const bag = bagFromDecls(internals.bundle.world.properties, "world.");
      internals.worldResolver = {
        get: (n) => bag.get(n),
        set: (n, v) => { bag.set(n, v); },
      };
    }
  }

  /** Quality ladders by scope for the eval channel (design/quality.md):
   *  world/story keyed by name; box/deck/value keyed by owner id then name.
   *  Built once - a bundle's declarations never change. Ladders are
   *  declaration-level, so the sharing flag does not touch them. */
  private initLadders(): void {
    const internals = this.internals;
    const grab = (decls: PropertyDecl[] | undefined): Map<string, readonly string[]> => {
      const m = new Map<string, readonly string[]>();
      for (const d of decls ?? []) if (d.type === "quality" && d.stages !== undefined) m.set(d.name, d.stages);
      return m;
    };
    const b = internals.bundle;
    internals.ladders.world = grab(b.world.properties);
    internals.ladders.story = grab(b.story.properties);
    for (const box of b.boxes) {
      internals.ladders.box.set(box.id, grab(box.properties));
      for (const deck of box.decks) internals.ladders.deck.set(deck.id, grab(deck.properties));
      for (const group of box.tagGroups) {
        for (const tag of group.tags) internals.ladders.value.set(tag.id, grab(tag.properties));
      }
      for (const hand of box.hands) internals.ladders.hand.set(hand.id, grab(handDeclsOf(internals, hand)));
    }
    const any = (m: Map<string, Map<string, readonly string[]>>): boolean =>
      [...m.values()].some((x) => x.size > 0);
    internals.hasQualities = internals.ladders.world.size > 0 || internals.ladders.story.size > 0
      || any(internals.ladders.box) || any(internals.ladders.deck)
      || any(internals.ladders.value) || any(internals.ladders.hand);
  }

  // --- flow management (Patter's surface, name for name) ----------------------

  /** Open (or REPLACE) the named flow. An existing id's flow is closed
   *  first - re-opening a name is a reset of that name's whole per-flow
   *  state; shared state is untouched. There is no default flow: "main" is
   *  a caller convention, not an engine rule. */
  openFlow(id: string, opts: OpenFlowOptions = {}): Flow {
    // Replacing an existing id KEEPS its place in the order. `close()` would
    // drop the key, and a JS Map re-inserts a deleted key at the END, so
    // openFlow("a"); openFlow("b"); openFlow("a") listed [b, a] here and
    // [a, b] on all three ports - a different `flows()` order and, since
    // `saveGame` keys its flows in that order, a different `.storyletsave`
    // byte stream for the same run (2026-08-29). markClosed without dropFlow
    // is the difference: the old handle goes inert, the slot stays put.
    this.flowsById.get(id)?.markClosed();
    const flow = new Flow(this, this.internals, id, opts.seed ?? this.seed);
    this.flowsById.set(id, flow);
    return flow;
  }

  getFlow(id: string): Flow | undefined {
    return this.flowsById.get(id);
  }

  /** Every live flow, open order. */
  flows(): Flow[] {
    return [...this.flowsById.values()];
  }

  /** Close the named flow: its handle goes INERT (every verb throws). A
   *  dropped-but-held flow must not keep writing shared state (Patter's
   *  stale-handle lesson). Unknown ids are a quiet no-op, like closing a
   *  closed door. */
  closeFlow(id: string): void {
    const flow = this.flowsById.get(id);
    if (!flow) return;
    this.flowsById.delete(id);
    flow.markClosed();
  }

  /** @internal - Flow.close() routes here so both doors agree. */
  dropFlow(id: string, flow: Flow): void {
    if (this.flowsById.get(id) === flow) this.flowsById.delete(id);
  }

  /** Close every flow and reseed the shared state to its defaults (the
   *  self-backed @world included; a host-bound @world is the host's and is
   *  not touched). */
  reset(): void {
    // The log is a run-lifetime utility and is not saved; a reset is a new run.
    // All three ports cleared it here and the reference did not, so `reset()`
    // (and `loadGame`, which calls it) left the previous run's entries in place
    // with `seq` continuing across the boundary - while the same call on Godot,
    // Unity or Unreal returned an empty log (2026-08-29).
    this.engineLog = [];
    for (const flow of this.flowsById.values()) flow.markClosed();
    this.flowsById.clear();
    this.spent.clear();
    this.initShared(this.hostWorld);
  }

  // --- shared scarcity (design/shared-scarcity.md) -----------------------------

  /** Cards a shared `redraw: "never"` has taken out of the world, by card id.
   *  The claim ledger is DERIVED from live boards and so needs no storage;
   *  this one is durable, so it rides the save's shared half. */
  private spent = new Set<string>();

  /** @internal */
  isTaken(cardId: string): boolean {
    return this.spent.has(cardId);
  }

  /** @internal */
  markTaken(cardId: string): void {
    this.spent.add(cardId);
  }

  // --- the run's log (design/shared-scarcity.md 8.2) ---------------------------

  /** Every flow's events in one ordered stream, each tagged with its flow.
   *  Opt in with the same `log` option the flow logs use; capped the same way.
   *
   *  This exists because a flow's own log cannot answer the question a run
   *  raises: when a story action in ANOTHER flow moves shared state, your
   *  flow's log says nothing and your value simply changes. Reading a run
   *  needs one stream that says who did what, and merging the per-flow logs by
   *  hand is a thing every host would otherwise have to write. */
  private engineLog: EngineLogEntry[] = [];
  private engineSeq = 0;

  log(): readonly EngineLogEntry[] {
    return this.engineLog;
  }

  clearLog(): void {
    this.engineLog = [];
  }

  /** @internal - shared claims across every LIVE flow, card id -> holders.
   *  Derived, which is what makes closeFlow and the openFlow replace release
   *  what a flow was holding: its board leaves the map with it. */
  sharedClaims(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const flow of this.flowsById.values()) {
      for (const id of flow.heldCardIds()) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  // --- engine-level state access ----------------------------------------------

  /**
   * Read shared state by path: "world.x", "story.gold" (when shared),
   * "box.b_x.heat" (when shared). A ref that resolves PER-FLOW throws,
   * naming the fix - silently answering with some flow's copy (or a junk
   * default) was the bug Patter's engine.getProperty guard exists to stop.
   */
  getProperty(path: string): ScalarValue {
    const found = this.resolveShared(path);
    const value = found.kind === "world" ? this.internals.worldResolver.get(found.name) : found.bag.get(found.name);
    if (value === undefined) throw new Error(`no property at "${path}"`);
    return value;
  }

  setProperty(path: string, value: ScalarValue): void {
    const found = this.resolveShared(path);
    if (found.kind === "world") {
      if (!this.internals.worldResolver.set) {
        throw new Error(`@world is read-only here: the host bound no write`);
      }
      this.internals.worldResolver.set(found.name, value);
      return;
    }
    // A host write: silent under the firing rule (no subscriber feedback
    // loop), but visible to the bag's audit hook.
    found.bag.set(found.name, value, { silent: true, reason: "host setProperty" });
  }

  private resolveShared(path: string): { kind: "world"; name: string } | { kind: "bag"; bag: StateBag; name: string } {
    const parts = path.split(".");
    const perFlow = (): never => {
      throw new Error(`"${path}" is per-flow state - read it on a Flow, not the Engine`);
    };
    if (parts.length === 2 && parts[0] === "world") return { kind: "world", name: parts[1]! };
    if (parts.length === 2 && parts[0] === "story") {
      const name = parts[1]!;
      if (this.internals.shared.story.get(name) !== undefined) return { kind: "bag", bag: this.internals.shared.story, name };
      if (this.internals.flowDecls.story.some((d) => d.name === name)) perFlow();
      throw new Error(`no property at "${path}"`);
    }
    if (parts.length === 3 && (parts[0] === "box" || parts[0] === "deck" || parts[0] === "hand" || parts[0] === "value")) {
      const kind = parts[0] as Exclude<PartitionKind, "story">;
      const [, id, name] = parts as unknown as [string, string, string];
      const bag = this.internals.shared[kind].get(id);
      if (bag !== undefined && bag.get(name) !== undefined) return { kind: "bag", bag, name };
      if (this.internals.flowDecls[kind].get(id)?.some((d) => d.name === name)) perFlow();
      if (bag === undefined && !this.internals.flowDecls[kind].has(id)) throw new Error(`no ${kind} store "${id}"`);
      throw new Error(`no property at "${path}"`);
    }
    throw new Error(`bad property path "${path}"`);
  }

  /** The shared surface as examiner rows: @world (read through the
   *  resolver) then the shared partitions. Per-flow rows live on each Flow. */
  listProperties(): PropertyView[] {
    const out: PropertyView[] = [];
    for (const d of this.internals.bundle.world.properties) {
      const value = this.internals.worldResolver.get(d.name);
      out.push({
        path: `world.${d.name}`, name: d.name, type: d.type,
        value: value ?? d.default, default: d.default,
        ...(d.values !== undefined ? { values: d.values } : {}),
        ...(d.stages !== undefined ? { stages: d.stages } : {}),
        // @world is FOREIGN - a host resolver backs it - so writability is whether that
        // resolver can be written at all, which is the shared registry's own rule for a
        // foreign scope. The `as PropertyView` cast this replaces was hiding the field's
        // absence: the row type has always required it, and these rows shipped without one.
        writable: this.internals.worldResolver.set !== undefined,
      });
    }
    // The bag composes its rows' addresses from its own pathPrefix, so the prefix here is
    // only the caller's label for the mount; the row arrives already addressed.
    const add = (_prefix: string, bag: StateBag): void => {
      for (const row of bag.rows()) out.push(row);
    };
    add("story", this.internals.shared.story);
    for (const [id, bag] of this.internals.shared.box) add(`box.${id}`, bag);
    for (const [id, bag] of this.internals.shared.deck) add(`deck.${id}`, bag);
    for (const [id, bag] of this.internals.shared.hand) add(`hand.${id}`, bag);
    for (const [id, bag] of this.internals.shared.value) add(`value.${id}`, bag);
    return out;
  }

  /** The SHARED kernel bags with their store path prefixes (the state
   *  logger's mount surface). The @world container is the host's own bag -
   *  the host mounts it itself. */
  listBags(): BagMount[] {
    const mounts: BagMount[] = [{ prefix: "story", bag: this.internals.shared.story }];
    for (const kind of ["box", "deck", "hand", "value"] as const) {
      for (const [id, bag] of this.internals.shared[kind]) mounts.push({ prefix: `${kind}.${id}`, bag });
    }
    return mounts;
  }

  /** Every flow's trace, one stream, each event tagged with its flow id. */
  subscribeTrace(handler: EngineTraceHandler): () => void {
    this.engineTraceHandlers.add(handler);
    return () => this.engineTraceHandlers.delete(handler);
  }

  // --- persistence (schema 4) -------------------------------------------------

  /** The whole engine, one envelope: the shared partitions once, then
   *  every live flow keyed by its id. @world is NEVER here - the host
   *  saves its container, each engine saves its own envelope. */
  saveGame(): SaveEnvelope {
    return structuredClone({
      schema: "storylets/save@1" as const,
      content: this.internals.bundle.content,
      shared: { props: partitionValues(this.internals.shared), spent: [...this.spent].sort() },
      flows: Object.fromEntries([...this.flowsById].map(([id, flow]) => [id, flow.snapshot()])),
    });
  }

  /** Restore: shared state once, then every flow REBUILT from its blob.
   *  Handles held from before the load are closed and inert (Patter's
   *  rule); take fresh ones from getFlow()/flows(). */
  loadGame(envelope: SaveEnvelope): void {
    if (envelope.content.project !== this.internals.bundle.content.project) {
      throw new Error(`save is for project "${envelope.content.project}", bundle is "${this.internals.bundle.content.project}"`);
    }
    const env = structuredClone(envelope);
    this.reset();
    loadPartition(this.internals.shared, env.shared.props);
    for (const id of env.shared.spent ?? []) this.spent.add(id);
    for (const [id, saved] of Object.entries(env.flows ?? {})) {
      this.openFlow(id).restore(saved);
    }
  }
}

// --- the Flow -----------------------------------------------------------------

export class Flow {
  readonly id: string;
  private readonly engine: Engine;
  private readonly internals: Internals;
  private closed = false;

  private prng: Prng;
  /** Per-box turn counters, keyed by box id (schema 3.4) - per flow. */
  private turnCounts = new Map<string, number>();
  private cooldowns: Record<string, number> = {};
  /** The board: hand contents (card ids, dealt order), keyed by hand id. */
  private boardContents = new Map<string, string[]>();
  private playLog: PlayRecord[] = [];
  // --- play-history indexes -------------------------------------------------
  // The four play-history host functions used to SCAN playLog on every call,
  // and they are called once per candidate card per ask, so dealing was
  // O(candidates x playLog): a shipped game got measurably slower the longer
  // somebody played it, which is the failure mode nobody meets in testing.
  // Measured before the change, 2000 cards: a box with no history condition
  // held flat at 0.3ms while `count_played` went 0.8ms -> 27.9ms as the log
  // reached 4000 plays.
  //
  // These are a pure summary of `playLog`, maintained where it is appended and
  // rebuilt where it is replaced, so they cannot drift from it. They are NOT
  // saved: `playLog` is the record, this is a derivation, and rebuilding on
  // load keeps the save format untouched.
  //
  // The tag keys are the played card's OWN (groupId, tagId) pairs, which is
  // what makes the box-local rule survive: a group name resolves inside the
  // ASKING box, so a card in another box carries different ids and cannot
  // match, exactly as the per-record `inTag` check used to decide.
  private playCount = new Map<string, number>();
  private lastPlayOf = new Map<string, PlayRecord>();
  private tagPlayCount = new Map<string, number>();
  private lastPlayInTag = new Map<string, PlayRecord>();
  /** The per-flow property partitions (the not-shared halves). */
  private stores: Partition;

  private traceHandlers = new Set<TraceHandler>();
  private logEntries: LogEntry[] = [];
  private logSeq = 0;

  /** Merged read view per scope, built once (bags are stable for the
   *  flow's life): the flow's own bag first, the shared bag behind it.
   *  Names are disjoint (shared XOR per-flow by declaration), so "first"
   *  is routing, not shadowing. */
  private readonly storyReader: ScopeResolver;
  private readonly boxReaders = new Map<string, ScopeResolver>();
  private readonly deckReaders = new Map<string, ScopeResolver>();

  /** @internal - built by Engine.openFlow / Engine.loadGame only. */
  constructor(engine: Engine, internals: Internals, id: string, seed: number) {
    this.engine = engine;
    this.internals = internals;
    this.id = id;
    this.prng = makePrng(seed);
    this.stores = buildPartition(internals, flowHalf);
    for (const box of internals.bundle.boxes) {
      this.turnCounts.set(box.id, 0);
      for (const hand of box.hands) this.boardContents.set(hand.id, []);
    }
    const pair = (own: StateBag | undefined, shared: StateBag | undefined): ScopeResolver => ({
      get: (n) => own?.get(n) ?? shared?.get(n),
    });
    // `internals.shared` is reassigned wholesale by loadGame/reset, but a
    // load rebuilds every Flow too, so a live flow's readers and the
    // shared partition are always the same generation.
    this.storyReader = pair(this.stores.story, internals.shared.story);
    for (const box of internals.bundle.boxes) {
      this.boxReaders.set(box.id, pair(this.stores.box.get(box.id), internals.shared.box.get(box.id)));
      for (const deck of box.decks) {
        this.deckReaders.set(deck.id, pair(this.stores.deck.get(deck.id), internals.shared.deck.get(deck.id)));
      }
    }
  }

  // --- lifetime ----------------------------------------------------------------

  get isClosed(): boolean {
    return this.closed;
  }

  /** Close this flow: the handle goes inert, every verb throws. */
  close(): void {
    if (this.closed) return;
    this.engine.dropFlow(this.id, this);
    this.markClosed();
  }

  /** @internal */
  markClosed(): void {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`flow "${this.id}" is closed`);
  }

  /** A box's current turn (schema 3.4), on THIS flow's clock. */
  turn(boxRef: string): number {
    this.assertOpen();
    const box = this.internals.boxesByGameId.get(boxRef) ?? this.internals.boxesById.get(boxRef);
    if (!box) throw new Error(`unknown box "${boxRef}"`);
    return this.turnCounts.get(box.id) ?? 0;
  }

  /** Subscribe to this flow's deal/play trace (schema 5). Returns the
   *  unsubscribe. With no subscribers anywhere the flow does no trace work. */
  subscribeTrace(handler: TraceHandler): () => void {
    this.traceHandlers.add(handler);
    return () => this.traceHandlers.delete(handler);
  }

  private get tracing(): boolean {
    return this.traceHandlers.size > 0 || this.internals.logCap !== undefined || this.internals.engineTracing();
  }

  private emit(event: TraceEvent, turn?: number): void {
    if (this.internals.logCap !== undefined) {
      this.logEntries.push({ ...event, seq: this.logSeq++, ...(turn !== undefined ? { turn } : {}) });
      if (this.logEntries.length > this.internals.logCap) this.logEntries.splice(0, this.logEntries.length - this.internals.logCap);
    }
    for (const handler of this.traceHandlers) handler(event);
    this.internals.emitEngine(this.id, event, turn);
  }

  /** The retained flow log (opt-in via the Engine's `log`), oldest first,
   *  capped. The introspection seam for hosts and tools; the durable play
   *  history in a save stays `playLog` (schema 4) - the log is a
   *  flow-lifetime utility and is NOT saved. */
  log(): readonly LogEntry[] {
    return this.logEntries;
  }

  /** Empty the retained log; `seq` keeps counting, so ordering across a
   *  clear stays meaningful. */
  clearLog(): void {
    this.logEntries = [];
  }

  // --- expression plumbing ----------------------------------------------------

  private node(expr: Expression): ExprNode {
    let node = this.internals.nodeCache.get(expr);
    if (!node) {
      node = deserialiseAst(expr.ast);
      this.internals.nodeCache.set(expr, node);
    }
    return node;
  }

  /** Tag group names are box-scoped: two boxes may name a group the same way
   *  (schema 1 - boxes namespace their groups), so a name is only ever
   *  resolved inside the box being asked, never bundle-wide. Ids are
   *  project-unique and accepted here too, still confined to the box. */
  private groupInBox(box: Box<Expression>, ref: string): TagGroup | undefined {
    return box.tagGroups.find((g) => effectiveGameId(g) === ref)
      ?? box.tagGroups.find((g) => g.id === ref);
  }

  /** Fold one play into the indexes. O(the card's tags), not O(the log). */
  private indexPlay(record: PlayRecord): void {
    this.playCount.set(record.card, (this.playCount.get(record.card) ?? 0) + 1);
    this.lastPlayOf.set(record.card, record);
    const entry = this.internals.cardsByGameId.get(record.card);
    if (!entry) return;
    for (const [groupId, tagIds] of Object.entries(entry.card.tags ?? {})) {
      for (const tagId of tagIds) {
        const key = tagKey(groupId, tagId);
        this.tagPlayCount.set(key, (this.tagPlayCount.get(key) ?? 0) + 1);
        this.lastPlayInTag.set(key, record);
      }
    }
  }

  /** Rebuild the indexes from the log. Called wherever `playLog` is REPLACED
   *  rather than appended to, which is `restore` alone. */
  private rebuildPlayIndex(): void {
    this.playCount.clear();
    this.lastPlayOf.clear();
    this.tagPlayCount.clear();
    this.lastPlayInTag.clear();
    for (const record of this.playLog) this.indexPlay(record);
  }

  /** `box` is the box whose ask is being evaluated: the play-history
   *  functions take a bare group name, so it resolves there (a card's tags
   *  reference its own box's group, which keeps the counts box-local).
   *  History is THIS flow's: countPlayed answers "have I done this". */
  /** One host per box, built once.
   *
   *  The closures below read `this.playCount`, `this.turnCounts` and the rest
   *  LIVE, so a cached host answers with current state - which is what makes
   *  caching safe rather than a snapshot bug. Unreal did this from the start
   *  (`hostsByBox_`, built at flow construction) and the other three rebuilt a
   *  host, and its closures, on every `evalCtx` call: once per deck per ask,
   *  and once per surviving card in the eviction pass. Structural divergence
   *  in one port AND the allocation the audit flagged, so the other three
   *  copied it (2026-08-29). Lazy rather than eager, so a bundle's unvisited
   *  boxes cost nothing. */
  private hostsByBox = new Map<string, StoryletsHost>();

  private host(box: Box<Expression>): StoryletsHost {
    const cached = this.hostsByBox.get(box.id);
    if (cached !== undefined) return cached;
    const made = this.makeHost(box);
    this.hostsByBox.set(box.id, made);
    return made;
  }

  private makeHost(box: Box<Expression>): StoryletsHost {
    /** A group NAME and tag name resolved in THIS box, as the index's key.
     *  Resolved once per call now, where `inTag` used to resolve it again for
     *  every record in the log. Undefined when either name is unknown here,
     *  which is the old per-record `false` and answers "never". */
    const keyOf = (group: string, tag: string): string | undefined => {
      const found = this.groupInBox(box, group);
      const t = found?.tags.find((v) => v.gameId === tag);
      return found && t ? tagKey(found.id, t.id) : undefined;
    };
    /** Turns-since is measured on the played card's box's clock (3.4). */
    const since = (record: PlayRecord): number => {
      const entry = this.internals.cardsByGameId.get(record.card);
      if (!entry) return NEVER_PLAYED;
      return (this.turnCounts.get(entry.box.id) ?? 0) - record.turn;
    };
    return {
      nextRandom: () => this.prng.next(),
      countPlayed: (card) => this.playCount.get(card) ?? 0,
      turnsSincePlayed: (card) => {
        const last = this.lastPlayOf.get(card);
        return last ? since(last) : NEVER_PLAYED;
      },
      countPlayedIn: (group, tag) => {
        const key = keyOf(group, tag);
        return key === undefined ? 0 : this.tagPlayCount.get(key) ?? 0;
      },
      turnsSincePlayedIn: (group, tag) => {
        const key = keyOf(group, tag);
        const last = key === undefined ? undefined : this.lastPlayInTag.get(key);
        return last ? since(last) : NEVER_PLAYED;
      },
    };
  }

  /** The evaluation environment (schema 3.1/6.2): @box/@deck resolve to the
   *  card under evaluation; in hand-condition contexts @deck is an empty bag,
   *  so any reference is an eval error (missing-policy throw). Every scope
   *  is the flow's MERGED view - its own copies over the shared values,
   *  names disjoint - and @world reads through the engine's resolver. */
  private evalCtx(box: Box<Expression>, deck: Deck<Expression> | undefined, handEnv: HandEnv): EvalContext {
    return {
      scopes: {
        world: this.internals.worldResolver,
        story: this.storyReader,
        box: this.boxReaders.get(box.id) ?? {},
        deck: deck ? this.deckReaders.get(deck.id) ?? {} : {},
        hand: handEnv.bag,
      },
      host: this.host(box) as unknown as Record<string, unknown>,
      // The quality channel, answering for THIS ask's box and deck. Only wired
      // when a quality exists, so a bundle without one evaluates byte-
      // identically to before the feature.
      ...(this.internals.hasQualities ? {
        qualities: (scope: string, name: string): readonly string[] | undefined =>
          scope === "world" ? this.internals.ladders.world.get(name)
          : scope === "story" ? this.internals.ladders.story.get(name)
          : scope === "box" ? this.internals.ladders.box.get(box.id)?.get(name)
          : scope === "deck" && deck ? this.internals.ladders.deck.get(deck.id)?.get(name)
          // @hand is composed, so the ladder belongs to whatever supplied the
          // value THIS ask: the bound tag, or the asking hand. `sources` is
          // already the map that answers that, because write-back needs it.
          : scope === "hand" ? this.handLadder(handEnv, name)
          : undefined,
      } : {}),
    };
  }

  /** The ladder behind one composed @hand name, or undefined when the name is
   *  not a quality (or came from criteria, which are tag NAMES, never state). */
  private handLadder(handEnv: HandEnv, name: string): readonly string[] | undefined {
    const source = handEnv.sources.get(name);
    if (!source) return undefined;
    return source.kind === "value" ? this.internals.ladders.value.get(source.id)?.get(name)
      : source.kind === "hand" ? this.internals.ladders.hand.get(source.id)?.get(name)
      : undefined;
  }

  private eval(expr: Expression, ctx: EvalContext): ScalarValue {
    return evaluate(this.node(expr), ctx, storyletsDialect);
  }

  private passes(expr: Expression | undefined, ctx: EvalContext, where?: string): boolean {
    if (!expr) return true;
    try {
      return conditionPasses(this.eval(expr, ctx));
    } catch (e) {
      // An eval error is never a silent pass: the card/deck is unavailable
      // (schema 3.1), and the trace surfaces the diagnostic.
      if (this.tracing) {
        this.emit({ type: "diagnostic", where: where ?? "condition", message: e instanceof Error ? e.message : String(e) });
      }
      return false;
    }
  }

  // --- resolving asks (schema 2.6 + 3.6) -----------------------------------------

  private tagByGameId(group: TagGroup, gameId: string): Tag | undefined {
    return group.tags.find((t) => t.gameId === gameId);
  }

  /** A deal's ask: the hand's template bindings + chosen tags, or its rule's
   *  bindings, plus the implicit home binding (schema 2.4). */
  private askForHand(hand: Hand<Expression>, box: Box<Expression>): AskDescriptor {
    const boundTags = new Map<string, string>();
    const askNames: Record<string, string> = {};
    let condition: Expression | undefined;
    if (hand.template !== undefined) {
      const template = this.internals.templatesById.get(hand.template);
      if (!template) throw new Error(`hand "${effectiveGameId(hand)}": unknown template "${hand.template}"`);
      for (const [groupId, tagId] of Object.entries(template.bindings ?? {})) {
        boundTags.set(groupId, tagId);
      }
      for (const [groupId, tagId] of Object.entries(hand.chosen ?? {})) {
        boundTags.set(groupId, tagId);
        const found = this.internals.groupsById.get(groupId);
        const tag = found?.group.tags.find((t) => t.id === tagId);
        if (found && tag) askNames[effectiveGameId(found.group)] = effectiveGameId(tag);
      }
      condition = template.condition;
    } else {
      for (const [groupId, tagId] of Object.entries(hand.rule?.bindings ?? {})) {
        boundTags.set(groupId, tagId);
        // ...and name it, exactly as the template branch above does: a card
        // reading @hand.<group> must not care HOW the group got bound
        // (design/hand-typing.md, the residues).
        const found = this.internals.groupsById.get(groupId);
        const tag = found?.group.tags.find((t) => t.id === tagId);
        if (found && tag) askNames[effectiveGameId(found.group)] = effectiveGameId(tag);
      }
      condition = hand.rule?.condition;
    }
    boundTags.set(PLACE_GROUP, hand.id);
    this.bindStateGroups(box, boundTags, askNames);
    return { box, hand, ...(condition !== undefined ? { condition } : {}), boundTags, askNames };
  }

  /** A peek's ask: raw criteria ({group gameId: tag gameId}), bindings only,
   *  no condition slot (schema 3.1; the boundary, Reboot 4). */
  private askForPeek(box: Box<Expression>, criteria: Record<string, string>): AskDescriptor {
    const boundTags = new Map<string, string>();
    const askNames: Record<string, string> = {};
    for (const [groupRef, tagRef] of Object.entries(criteria)) {
      if (groupRef === PLACE_GROUP) {
        const hand = this.internals.handsByGameId.get(tagRef) ?? this.internals.handsById.get(tagRef);
        if (!hand) throw new Error(`peek: unknown hand "${tagRef}" in home criteria`);
        boundTags.set(PLACE_GROUP, hand.hand.id);
        continue;
      }
      const found = this.groupInBox(box, groupRef);
      if (!found) {
        throw new Error(`peek: unknown tag group "${groupRef}" in box "${effectiveGameId(box)}"`);
      }
      const tag = this.tagByGameId(found, tagRef) ?? found.tags.find((t) => t.id === tagRef);
      if (!tag) throw new Error(`peek: unknown tag "${tagRef}" in group "${effectiveGameId(found)}"`);
      boundTags.set(found.id, tag.id);
      askNames[effectiveGameId(found)] = effectiveGameId(tag);
    }
    this.bindStateGroups(box, boundTags, askNames);
    return { box, boundTags, askNames };
  }

  /**
   * Bind every `boundBy` group in the box from the property it names.
   *
   * The gap this closes: only a hand could bind a group, and `deal` takes no
   * criteria, so an axis driven by state (an act, a chapter) had nowhere to
   * gate. Runs AFTER the hand's own bindings and never overwrites one: an
   * explicit binding is a deliberate act and beats a default.
   *
   * A value naming no tag in the group leaves the group UNBOUND rather than
   * matching nothing. Unbound is a wildcard, so the ask still deals; a silent
   * empty hand would look like content that does not exist, and the diagnostic
   * is what says otherwise.
   */
  private bindStateGroups(box: Box<Expression>, boundTags: Map<string, string>, askNames: Record<string, string>): void {
    for (const group of box.tagGroups) {
      if (group.boundBy === undefined || boundTags.has(group.id)) continue;
      const ref = /^@(world|story)\.([a-z][a-z0-9_-]*)$/.exec(group.boundBy);
      if (!ref) {
        this.emit({ type: "diagnostic", where: `tag group ${effectiveGameId(group)}`, message: `boundBy "${group.boundBy}" is not a @world or @story property reference` });
        continue;
      }
      let value: ScalarValue | undefined;
      try {
        value = this.getProperty(`${ref[1]}.${ref[2]}`);
      } catch {
        this.emit({ type: "diagnostic", where: `tag group ${effectiveGameId(group)}`, message: `boundBy "${group.boundBy}" names a property that is not declared` });
        continue;
      }
      const wanted = typeof value === "string" ? value : String(value);
      const tag = group.tags.find((t) => effectiveGameId(t) === wanted);
      if (!tag) {
        this.emit({ type: "diagnostic", where: `tag group ${effectiveGameId(group)}`, message: `${group.boundBy} is "${wanted}", which is not one of its tags` });
        continue;
      }
      boundTags.set(group.id, tag.id);
      askNames[effectiveGameId(group)] = effectiveGameId(tag);
    }
  }

  // --- @hand composition (schema 3.6) -------------------------------------------

  /** A store's full value view for one owner: the shared half under the
   *  flow's half. Names are disjoint, so the spread is routing, not
   *  shadowing. */
  private valuesOf(kind: Exclude<PartitionKind, "story">, id: string): PropertyBag {
    return {
      ...(this.internals.shared[kind].get(id)?.values ?? {}),
      ...(this.stores[kind].get(id)?.values ?? {}),
    };
  }

  private buildHandEnv(ask: AskDescriptor): HandEnv {
    const bag: PropertyBag = {};
    const sources = new Map<string, HandSource>();

    // 1. Tag properties of every bound tag (home binds a hand, not a tag).
    for (const [groupId, tagId] of ask.boundTags) {
      if (groupId === PLACE_GROUP) continue;
      for (const [name, value] of Object.entries(this.valuesOf("value", tagId))) {
        bag[name] = value;
        sources.set(name, { kind: "value", id: tagId });
      }
    }
    // 2. Hand properties, when the ask is a deal.
    if (ask.hand) {
      for (const [name, value] of Object.entries(this.valuesOf("hand", ask.hand.id))) {
        bag[name] = value;
        sources.set(name, { kind: "hand", id: ask.hand.id });
      }
    }
    // 3. Chosen tags / criteria, by group name (the tag's gameId as value).
    for (const [name, value] of Object.entries(ask.askNames)) {
      bag[name] = value;
      sources.set(name, { kind: "criteria" });
    }
    return { bag, sources, boundTags: ask.boundTags };
  }

  // --- the ask (schema 3.1 + 3.2) ------------------------------------------------

  /** The claims ledger, derived from THIS flow's board: card id -> holding
   *  hands (schema 3.5). Claims are per flow - another flow holding the
   *  card is another playthrough, not a rival hand. */
  private claims(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const contents of this.boardContents.values()) {
      for (const id of contents) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  /** @internal - every card id on THIS flow's board, one entry per holding
   *  hand. The engine sums these across live flows for the shared ledger. */
  heldCardIds(): string[] {
    return [...this.boardContents.values()].flat();
  }

  private copiesOf(card: Card<Expression>): number {
    return card.copies ?? 1;
  }

  /** The claims step (schema 3.1 step 6) for one card, as a verdict or null
   *  for "available". Two caps apply to a shared card and they are different
   *  statements, so they get different verdicts: `copies` is your own board
   *  filling up, `sharedCopies` is somebody else already holding it, and a
   *  participant told "claimed" about a card sitting on another person's
   *  table would read it as an engine fault (design/shared-scarcity 9.3.1).
   *
   *  `mine` counts this flow's holdings, `world` every live flow's. */
  private claimVerdict(
    card: Card<Expression>,
    shared: boolean,
    mine: Map<string, number>,
    world: Map<string, number>,
  ): "claimed" | "claimed-elsewhere" | null {
    const id = card.id;
    if ((mine.get(id) ?? 0) >= this.copiesOf(card)) return "claimed";
    if (shared && (world.get(id) ?? 0) >= sharedCap(card)) return "claimed-elsewhere";
    return null;
  }

  /** Tag matching (schema 3.1 step 3): for every bound group the card lists
   *  the bound tag or omits the group (wildcard); the home group inverts -
   *  a homed card requires a matching home binding (schema 2.4). */
  private tagsMatch(card: Card<Expression>, boundTags: Map<string, string>): boolean {
    const home = card.tags?.[PLACE_GROUP];
    if (home !== undefined && home.length > 0) {
      const bound = boundTags.get(PLACE_GROUP);
      if (bound === undefined || !home.includes(bound)) return false;
    }
    for (const [groupId, tagId] of boundTags) {
      if (groupId === PLACE_GROUP) continue;
      const tags = card.tags?.[groupId];
      if (tags === undefined) {
        // Omission is a wildcard unless the group says otherwise. A required
        // group inverts it, which is what `place` has always done per card.
        if (this.internals.requiredGroups.has(groupId)) return false;
        continue;
      }
      if (!tags.includes(tagId)) return false;
    }
    return true;
  }

  /** Run one ask: availability filter then ranking. `claimed` decides the
   *  claims step (step 6) per card, returning the verdict that refused it or
   *  null for available. `trace` (when a subscriber exists) collects the
   *  per-card verdicts. */
  private runAsk(
    ask: AskDescriptor,
    claimed: (card: Card<Expression>, shared: boolean) => "claimed" | "claimed-elsewhere" | null,
    trace?: { id: string; verdict: TraceVerdict; priority?: number; specificity?: number }[],
  ): { ordered: CardEntry[]; handEnv: HandEnv } {
    const { box } = ask;
    const handEnv = this.buildHandEnv(ask);
    const verdict = (id: string, v: TraceVerdict): void => {
      trace?.push({ id, verdict: v });
    };

    // The hand's condition: ask-constant, evaluated once (schema 3.1 step 4).
    if (!this.passes(ask.condition, this.evalCtx(box, undefined, handEnv), `hand ${ask.hand ? effectiveGameId(ask.hand) : ""} condition`)) {
      return { ordered: [], handEnv };
    }

    // Deck gates: evaluated once per ask, in deck (id) order (schema 2.5).
    const gateOk = new Map<string, boolean>();
    for (const deck of box.decks) {
      gateOk.set(deck.id, this.passes(deck.condition, this.evalCtx(box, deck, handEnv), `deck ${deck.gameId} gate`));
    }

    const turn = this.turnCounts.get(box.id) ?? 0;
    const scored: { entry: CardEntry; priority: number; spec: number }[] = [];
    for (const deck of box.decks) {
      // ONE context per deck, not per card. It is built from box, deck and
      // handEnv, none of which vary inside this loop, and a condition is a
      // read-only gate (schema 3.1), so nothing can write through it and make
      // sharing visible. Rebuilding it per card cost an EvalContext, a scopes
      // map and five bag wrappers each time: about half the garbage a peek over
      // a large box produced (port-review-2026-08.md, measured).
      const deckCtx = this.evalCtx(box, deck, handEnv);
      const deckShared = deck.shared ?? false;
      for (const card of deck.cards) {
        const shared = cardIsShared(card, deckShared);
        if (!gateOk.get(deck.id)) {
          verdict(card.id, "deck-gate");
          continue;
        }
        // Taken out of the world by somebody's shared one-shot. Checked
        // before the flow's own clock, because "cooldown" would point the
        // reader at a turn counter that has nothing to do with it.
        if (shared && this.engine.isTaken(card.id)) {
          verdict(card.id, "taken");
          continue;
        }
        if ((this.cooldowns[card.id] ?? 0) > turn) {
          verdict(card.id, "cooldown");
          continue;
        }
        if (!this.tagsMatch(card, handEnv.boundTags)) {
          verdict(card.id, "tags");
          continue;
        }
        // The label is only read when an eval THROWS and only when tracing, so
        // building it per card was pure waste on the path that matters. Built
        // when tracing is on, where the cost is already accepted.
        if (card.condition && !this.passes(card.condition, deckCtx,
          this.tracing ? `card ${card.gameId} condition` : undefined)) {
          verdict(card.id, "condition");
          continue;
        }
        const refused = claimed(card, shared);   // claims, last (schema 3.1 step 6)
        if (refused) {
          verdict(card.id, refused);
          continue;
        }

        let priority: number;
        if (typeof card.priority === "number") {
          priority = card.priority;
        } else {
          try {
            const v = this.eval(card.priority, deckCtx);
            if (typeof v !== "number") {
              verdict(card.id, "priority");
              continue;
            }
            priority = v;
          } catch (e) {
            if (this.tracing) {
              this.emit({ type: "diagnostic", where: `card ${card.gameId} priority`, message: e instanceof Error ? e.message : String(e) });
            }
            verdict(card.id, "priority");
            continue;
          }
        }
        let spec = 0;
        if (box.ranking.specificity && card.condition) {
          const node = this.node(card.condition);
          spec = matchedSpecificity(node, (n) => {
            try {
              return conditionPasses(evaluate(n, deckCtx, storyletsDialect));
            } catch {
              return false;
            }
          });
        }
        scored.push({ entry: { card, deck, box }, priority, spec });
      }
    }

    scored.sort((a, b) => b.priority - a.priority || b.spec - a.spec);   // stable
    // Seeded shuffle of each maximal tie run; runs of 1 consume no draws.
    let i = 0;
    while (i < scored.length) {
      let j = i + 1;
      while (j < scored.length
        && scored[j]!.priority === scored[i]!.priority
        && scored[j]!.spec === scored[i]!.spec) j++;
      if (j - i > 1) {
        const run = scored.slice(i, j);
        shuffleInPlace(run, this.prng);
        // Written back element by element, as all three ports do. It used to be
        // `scored.splice(i, j - i, ...run)`, which SPREADS one argument per
        // element: with every card at the default priority 0 the tie run is the
        // whole list, and a box of 150 000 such cards threw `RangeError:
        // Maximum call stack size exceeded` rather than dealing. Far-fetched
        // for one box, but it was a crash where the ports had no limit, and the
        // reference is supposed to be the thing they are transliterated from.
        for (let k = 0; k < run.length; k++) scored[i + k] = run[k]!;
      }
      i = j;
    }
    for (const s of scored) {
      trace?.push({ id: s.entry.card.id, verdict: "dealt", priority: s.priority, specificity: s.spec });
    }
    return { ordered: scored.map((s) => s.entry), handEnv };
  }

  /** Flip eligible-but-not-taken trace entries to "capped". */
  private capTrace(
    trace: { id: string; verdict: TraceVerdict; priority?: number; specificity?: number }[],
    taken: ReadonlySet<string>,
  ): void {
    for (const entry of trace) {
      if (entry.verdict === "dealt" && !taken.has(entry.id)) entry.verdict = "capped";
    }
  }

  private view(entry: CardEntry): DealtCard {
    const { card } = entry;
    return {
      id: card.id,
      gameId: effectiveGameId(card),
      ...(card.title !== undefined ? { title: card.title } : {}),
      ...(card.purpose !== undefined ? { purpose: card.purpose } : {}),
      ...(card.fields !== undefined ? { fields: card.fields } : {}),
    };
  }

  private handCapacity(hand: Hand<Expression>): number {
    if (hand.slots !== undefined) return hand.slots;
    const declared = hand.template !== undefined
      ? this.internals.templatesById.get(hand.template)?.slots
      : hand.rule?.slots;
    return declared === undefined || declared === "unbounded" ? Infinity : declared;
  }

  private resolveHand(ref: string): { hand: Hand<Expression>; box: Box<Expression> } {
    const found = this.internals.handsByGameId.get(ref) ?? this.internals.handsById.get(ref);
    if (!found) throw new Error(`unknown hand "${ref}"`);
    return found;
  }

  // --- host surface (schema 5) ---------------------------------------------------

  /** Look at the top of the stock through raw tag criteria (schema 3.1):
   *  claims respected, nothing registered, nothing left behind but the
   *  trace line. You can never play a card you only peeked. */
  peek(boxRef: string, criteria: Record<string, string> = {}, n?: number): RankedList {
    this.assertOpen();
    const box = this.internals.boxesByGameId.get(boxRef) ?? this.internals.boxesById.get(boxRef);
    if (!box) throw new Error(`unknown box "${boxRef}"`);
    const ask = this.askForPeek(box, criteria);
    const claimCounts = this.claims();
    // Skipped outright when the bundle shares nothing, which is most bundles:
    // the ledger walks every live flow's whole board, and an empty map answers
    // every question the same way a computed one would.
    const worldClaims = this.internals.hasShared ? this.engine.sharedClaims() : new Map<string, number>();
    const trace = this.tracing ? [] : undefined;
    const { ordered } = this.runAsk(ask, (card, shared) => this.claimVerdict(card, shared, claimCounts, worldClaims), trace);
    // CLAMPED. `slice(0, -1)` drops the last card and returns the rest, so a
    // negative n answered with almost the whole list here while every port
    // returned nothing (2026-08-29).
    const listed = n === undefined ? ordered : ordered.slice(0, Math.max(n, 0));
    if (trace) {
      this.capTrace(trace, new Set(listed.map((e) => e.card.id)));
      this.emit({ type: "peek", box: effectiveGameId(box), criteria, cards: trace }, this.turnCounts.get(box.id) ?? 0);
    }
    return { box: effectiveGameId(box), cards: listed.map((e) => this.view(e)) };
  }

  /** Refresh one hand (schema 3.5); returns its new shape. */
  deal(handRef: string): DealtCard[] {
    this.assertOpen();
    const { hand } = this.resolveHand(handRef);
    return this.dealMany([handRef])[effectiveGameId(hand)] ?? [];
  }

  /** Re-deal several / all hands (schema 3.5): seeded hand-order shuffle
   *  (fairness), evict, seed the ledger from survivors, fill in order.
   *  Returns the dealt slice - the new contents of exactly the hands this
   *  call dealt, keyed by hand gameId (board() stays the whole-board read). */
  dealMany(handRefs?: string[]): Record<string, DealtCard[]> {
    this.assertOpen();
    const dealt = (handRefs ?? [...this.internals.handsById.keys()].sort())
      .map((ref) => this.resolveHand(ref));
    shuffleInPlace(dealt, this.prng);

    // Eviction first: drop dealt cards no longer available to their hand
    // (minus the claims check against their own seat).
    for (const { hand, box } of dealt) {
      const ask = this.askForHand(hand, box);
      const handEnv = this.buildHandEnv(ask);
      const conditionOk = this.passes(ask.condition, this.evalCtx(box, undefined, handEnv));
      const gateOk = new Map<string, boolean>();
      for (const deck of box.decks) {
        gateOk.set(deck.id, this.passes(deck.condition, this.evalCtx(box, deck, handEnv)));
      }
      const turn = this.turnCounts.get(box.id) ?? 0;
      // Trace events fire after the state they report has landed (a handler
      // reading the board sees the eviction), so they are collected here and
      // emitted once the survivors are set.
      const evicted: { card: string; reason: Extract<TraceEvent, { type: "evict" }>["reason"] }[] = [];
      const evict = (cardId: string, reason: Extract<TraceEvent, { type: "evict" }>["reason"]): false => {
        evicted.push({ card: cardId, reason });
        return false;
      };
      const survivors = (this.boardContents.get(hand.id) ?? []).filter((cardId) => {
        if (!conditionOk) return evict(cardId, "hand-condition");
        const entry = this.internals.cardsById.get(cardId);
        if (!entry) return evict(cardId, "vanished");   // edited content: dropped
        if (!gateOk.get(entry.deck.id)) return evict(cardId, "deck-gate");
        if ((this.cooldowns[cardId] ?? 0) > turn) return evict(cardId, "cooldown");
        if (!this.tagsMatch(entry.card, handEnv.boundTags)) return evict(cardId, "tags");
        if (!this.passes(entry.card.condition, this.evalCtx(box, entry.deck, handEnv), `card ${entry.card.gameId} condition`)) {
          return evict(cardId, "condition");
        }
        return true;
      });
      this.boardContents.set(hand.id, survivors);
      if (this.tracing) {
        for (const e of evicted) this.emit({ type: "evict", hand: hand.id, card: e.card, reason: e.reason }, turn);
      }
    }

    const claimCounts = this.claims();
    // The world ledger is taken once for the whole batch and kept in step with
    // the local one below, so two hands in the SAME deal cannot both take the
    // last shared copy. Skipped outright when the bundle shares nothing (most
    // bundles): an empty map answers every question the same way.
    const worldClaims = this.internals.hasShared ? this.engine.sharedClaims() : new Map<string, number>();
    for (const { hand, box } of dealt) {
      const contents = this.boardContents.get(hand.id) ?? [];
      const free = this.handCapacity(hand) - contents.length;
      if (free <= 0) continue;
      const ask = this.askForHand(hand, box);
      const own = new Set(contents);
      const trace = this.tracing ? [] : undefined;
      // At most once in any one hand; at most `copies` hands here, and at most
      // `sharedCopies` hands anywhere (schema 3.5, shared-scarcity 5).
      const { ordered } = this.runAsk(ask,
        (card, shared) => (own.has(card.id) ? "claimed" : this.claimVerdict(card, shared, claimCounts, worldClaims)), trace);
      const added = ordered.slice(0, free).map((e) => e.card.id);
      this.boardContents.set(hand.id, [...contents, ...added]);
      for (const id of added) {
        claimCounts.set(id, (claimCounts.get(id) ?? 0) + 1);
        worldClaims.set(id, (worldClaims.get(id) ?? 0) + 1);
      }
      // Emitted after the hand is set: a handler reading board() sees the deal.
      if (trace) {
        this.capTrace(trace, new Set(added));
        this.emit({ type: "deal", hand: effectiveGameId(hand), cards: trace }, this.turnCounts.get(box.id) ?? 0);
      }
    }

    return Object.fromEntries(dealt.map(({ hand }) => [
      effectiveGameId(hand),
      (this.boardContents.get(hand.id) ?? []).map((id) => this.view(this.internals.cardsById.get(id)!)),
    ]));
  }

  /** The board: current hand contents, in dealt order, keyed by hand gameId
   *  (schema 5). Read it for what is out; peek the stock for what could
   *  come.
   *
   *  `boxRef` (a box gameId or id) narrows the read to that box's hands, in
   *  the same shape and the same order: "give me the barks hands" is a
   *  common host query, and boxes are how a game separates its storylet
   *  systems, so the grouping belongs here rather than in every host. An
   *  unknown box throws, as it does on turn() and peek(). */
  board(boxRef?: string): Record<string, DealtCard[]> {
    this.assertOpen();
    let keep: string | undefined;
    if (boxRef !== undefined) {
      const box = this.internals.boxesByGameId.get(boxRef) ?? this.internals.boxesById.get(boxRef);
      if (!box) throw new Error(`unknown box "${boxRef}"`);
      keep = box.id;
    }
    return Object.fromEntries([...this.boardContents.entries()]
      .filter(([handId]) => keep === undefined || this.internals.handsById.get(handId)!.box.id === keep)
      .map(([handId, ids]) => [
        effectiveGameId(this.internals.handsById.get(handId)!.hand),
        ids.map((id) => this.view(this.internals.cardsById.get(id)!)),
      ]));
  }

  /** Resolve a played/inspected card within a hand on the board. */
  private resolveDealt(cardId: string, handRef: string): { entry: CardEntry; ask: AskDescriptor } {
    const entry = this.internals.cardsById.get(cardId) ?? this.internals.cardsByGameId.get(cardId);
    if (!entry) throw new Error(`unknown card "${cardId}"`);
    const { hand, box } = this.resolveHand(handRef);
    if (!(this.boardContents.get(hand.id) ?? []).includes(entry.card.id)) {
      throw new Error(`card "${effectiveGameId(entry.card)}" is not dealt to hand "${effectiveGameId(hand)}"`);
    }
    return { entry, ask: this.askForHand(hand, box) };
  }

  /** Outcome availability, evaluated against CURRENT state on every ask
   *  (schema 3.1/5) - never a deal-time snapshot. */
  outcomes(cardId: string, from: string): OutcomeView[] {
    this.assertOpen();
    const { entry, ask } = this.resolveDealt(cardId, from);
    const ctx = this.evalCtx(entry.box, entry.deck, this.buildHandEnv(ask));
    return entry.card.outcomes.map((o) => ({
      id: o.id,
      gameId: effectiveGameId(o),
      ...(o.title !== undefined ? { title: o.title } : {}),
      ...(o.purpose !== undefined ? { purpose: o.purpose } : {}),
      available: this.passes(o.condition, ctx),
    }));
  }

  /** Apply an outcome (schema 3.7): the card must sit in a hand on the
   *  board (you never play a card from inside the deck). Throws before any
   *  mutation on a gated-shut outcome or a bad write target. */
  play(cardId: string, outcomeGameId: string, from: string, opts: PlayOptions = {}): void {
    this.assertOpen();
    const { entry, ask } = this.resolveDealt(cardId, from);
    const outcome = entry.card.outcomes.find((o) => effectiveGameId(o) === outcomeGameId);
    if (!outcome) throw new Error(`card "${effectiveGameId(entry.card)}" has no outcome "${outcomeGameId}"`);

    const handEnv = this.buildHandEnv(ask);
    const ctx = this.evalCtx(entry.box, entry.deck, handEnv);
    if (!this.passes(outcome.condition, ctx)) {
      throw new Error(`outcome "${outcomeGameId}" on "${effectiveGameId(entry.card)}" is gated shut`);
    }

    // The played card's box's clock advances (schema 3.4); computed up
    // front so the play and its writes log as one action, one turn stamp.
    const newTurn = (this.turnCounts.get(entry.box.id) ?? 0)
      + (opts.advanceTurns ?? this.internals.bundle.settings.playAdvancesTurns);

    // Every right-hand side evaluates against PRE-play state, then all
    // writes land (schema 3.7).
    const writes: { target: string; value: ScalarValue }[] = [];
    for (const [target, expr] of Object.entries(outcome.changes)) {
      writes.push({ target, value: this.eval(expr, ctx) });
    }
    for (const { target, value } of writes) {
      const { path, prev } = this.applyWrite(target, value, entry, handEnv);
      if (this.tracing) this.emit({ type: "write", target, path, value, ...(prev !== undefined ? { prev } : {}) }, newTurn);
    }

    const record: PlayRecord = { card: effectiveGameId(entry.card), outcome: effectiveGameId(outcome), turn: newTurn };
    this.playLog.push(record);
    this.indexPlay(record);
    if (entry.card.redraw === "never") {
      // A shared one-shot leaves the world rather than this flow: the engine
      // holds it, so every flow is refused. A finite redraw deliberately does
      // NOT share, whatever the deck says - a cooldown is an absolute turn of
      // this flow's box clock, and there is no shared clock to compare it
      // against (design/shared-scarcity.md 9.3.2).
      if (cardIsShared(entry.card, entry.deck.shared ?? false)) this.engine.markTaken(entry.card.id);
      else this.cooldowns[entry.card.id] = Number.MAX_SAFE_INTEGER;
    } else if (typeof entry.card.redraw === "number") {
      this.cooldowns[entry.card.id] = newTurn + entry.card.redraw;
    }
    // The card leaves its hand, releasing its claim (schema 3.5/3.7).
    const handId = ask.hand!.id;
    this.boardContents.set(handId,
      (this.boardContents.get(handId) ?? []).filter((id) => id !== entry.card.id));
    this.turnCounts.set(entry.box.id, newTurn);
    // Emitted last: a handler reading the board and the clock sees the play.
    if (this.tracing) this.emit({ type: "play", card: entry.card.id, outcome: effectiveGameId(outcome), turn: newTurn }, newTurn);
  }

  /** Land one change in whichever partition declares the name: the flow's
   *  bag when the property is per-flow, the shared bag when it is shared -
   *  the union/partition invariant made executable. */
  private landIn(kind: Exclude<PartitionKind, "story"> | "story", id: string | undefined, name: string, value: ScalarValue, path: string): { path: string; prev?: ScalarValue } {
    const own = kind === "story" ? this.stores.story : id !== undefined ? this.stores[kind].get(id) : undefined;
    const shared = kind === "story" ? this.internals.shared.story : id !== undefined ? this.internals.shared[kind].get(id) : undefined;
    const bag = own !== undefined && own.get(name) !== undefined ? own
      : shared !== undefined && shared.get(name) !== undefined ? shared
      : undefined;
    if (bag === undefined) throw new Error(`no property at "${path}"`);
    // An engine write: the bag's subscribers fire (the firing rule).
    const change = bag.set(name, value);
    return { path, ...(change.prev !== undefined ? { prev: change.prev } : {}) };
  }

  /** Land one change; returns the resolved store path (for the trace) and
   *  the value it replaced (for the log's "0 -> 1" reading). */
  private applyWrite(target: string, value: ScalarValue, entry: CardEntry, handEnv: HandEnv): { path: string; prev?: ScalarValue } {
    const match = /^@([a-z]+)\.([A-Za-z_][A-Za-z0-9_-]*)$/.exec(target);
    if (!match) throw new Error(`bad change target "${target}"`);
    const [, scope, name] = match as unknown as [string, string, string];
    switch (scope) {
      case "world": {
        const resolver = this.internals.worldResolver;
        if (!resolver.set) throw new Error(`@world.${name} cannot be written: the host bound @world read-only`);
        const prev = resolver.get(name);
        resolver.set(name, value);
        return { path: `world.${name}`, ...(prev !== undefined ? { prev } : {}) };
      }
      case "story": return this.landIn("story", undefined, name, value, `story.${name}`);
      case "box": return this.landIn("box", entry.box.id, name, value, `box.${entry.box.id}.${name}`);
      case "deck": return this.landIn("deck", entry.deck.id, name, value, `deck.${entry.deck.id}.${name}`);
      case "hand": {
        // Write-back routing (schema 3.6): the composed name remembers its
        // source store; writes to criteria/chosen-tag names are errors.
        const source = handEnv.sources.get(name);
        if (!source) throw new Error(`@hand.${name} is not composed in this ask`);
        if (source.kind === "criteria") throw new Error(`@hand.${name} is a chosen tag / criteria name and cannot be written`);
        return this.landIn(source.kind, source.id, name, value, `${source.kind}.${source.id}.${name}`);
      }
      default: throw new Error(`bad change target scope "@${scope}"`);
    }
  }

  /** Advance one box's clock (schema 3.4): a turn is one draw-from-stock
   *  session for that box, on THIS flow's clock. */
  advanceTurns(boxRef: string, n = 1): void {
    this.assertOpen();
    const box = this.internals.boxesByGameId.get(boxRef) ?? this.internals.boxesById.get(boxRef);
    if (!box) throw new Error(`unknown box "${boxRef}"`);
    const next = (this.turnCounts.get(box.id) ?? 0) + n;
    this.turnCounts.set(box.id, next);
    if (this.tracing) this.emit({ type: "turns", box: effectiveGameId(box), turn: next }, next);
  }

  // --- state access (host surface + test tooling) ---------------------------------

  /** Every box, bundle order: identity + this flow's clock (the enumeration
   *  surface examiners key their turns sections on; parity member). */
  listBoxes(): BoxView[] {
    this.assertOpen();
    return this.internals.bundle.boxes.map((b) => ({
      id: b.id,
      gameId: effectiveGameId(b),
      ...(b.title !== undefined ? { title: b.title } : {}),
      turn: this.turnCounts.get(b.id) ?? 0,
    }));
  }

  /** THIS flow's kernel bags with their store path prefixes (the state
   *  logger's mount surface; parity member). The shared bags are the
   *  Engine's listBags; the flows are rebuilt by loadGame, so consumers
   *  re-enumerate after a load. */
  listBags(): BagMount[] {
    this.assertOpen();
    const mounts: BagMount[] = [{ prefix: "story", bag: this.stores.story }];
    for (const kind of ["box", "deck", "hand", "value"] as const) {
      for (const [id, bag] of this.stores[kind]) mounts.push({ prefix: `${kind}.${id}`, bag });
    }
    return mounts;
  }

  /** The flow's FULL merged view as examiner rows (the property examiner /
   *  editor surface, parity across all runtimes): @world read through the
   *  resolver, then per scope the shared values and this flow's own.
   *  Bundle order: world, story, then per-box / per-deck / per-hand /
   *  per-tag stores. */
  listProperties(): PropertyView[] {
    this.assertOpen();
    const out: PropertyView[] = [];
    for (const d of this.internals.bundle.world.properties) {
      const value = this.internals.worldResolver.get(d.name);
      out.push({
        path: `world.${d.name}`, name: d.name, type: d.type,
        value: value ?? d.default, default: d.default,
        ...(d.values !== undefined ? { values: d.values } : {}),
        ...(d.stages !== undefined ? { stages: d.stages } : {}),
        // @world is FOREIGN - a host resolver backs it - so writability is whether that
        // resolver can be written at all, which is the shared registry's own rule for a
        // foreign scope. The `as PropertyView` cast this replaces was hiding the field's
        // absence: the row type has always required it, and these rows shipped without one.
        writable: this.internals.worldResolver.set !== undefined,
      });
    }
    const add = (_prefix: string, shared: StateBag | undefined, own: StateBag | undefined): void => {
      for (const bag of [shared, own]) {
        if (bag === undefined) continue;
        for (const row of bag.rows()) out.push(row);
      }
    };
    add("story", this.internals.shared.story, this.stores.story);
    for (const kind of ["box", "deck", "hand", "value"] as const) {
      const ids = new Set([...this.internals.shared[kind].keys(), ...this.stores[kind].keys()]);
      for (const id of ids) add(`${kind}.${id}`, this.internals.shared[kind].get(id), this.stores[kind].get(id));
    }
    return out;
  }

  /** Read by path: "world.x", "story.gold", "value.v_docks.danger",
   *  "box.b_x.heat", "deck.k_main.n", "hand.h_board.owner" - the flow's
   *  merged view, routed by the declaration's sharing. */
  getProperty(path: string): ScalarValue {
    this.assertOpen();
    const found = this.resolvePath(path);
    const value = found.kind === "world" ? this.internals.worldResolver.get(found.name)
      : found.own?.get(found.name) ?? found.shared?.get(found.name);
    if (value === undefined) throw new Error(`no property at "${path}"`);
    return value;
  }

  setProperty(path: string, value: ScalarValue): void {
    this.assertOpen();
    const found = this.resolvePath(path);
    if (found.kind === "world") {
      if (!this.internals.worldResolver.set) throw new Error(`@world is read-only here: the host bound no write`);
      this.internals.worldResolver.set(found.name, value);
      return;
    }
    const bag = found.own !== undefined && found.own.get(found.name) !== undefined ? found.own
      : found.shared !== undefined && found.shared.get(found.name) !== undefined ? found.shared
      : undefined;
    if (bag === undefined) throw new Error(`no property at "${path}"`);
    // A host write: silent under the firing rule (no subscriber feedback
    // loop), but visible to the bag's audit hook.
    bag.set(found.name, value, { silent: true, reason: "host setProperty" });
  }

  private resolvePath(path: string): { kind: "world"; name: string } | { kind: "bag"; own?: StateBag; shared?: StateBag; name: string } {
    const parts = path.split(".");
    if (parts.length === 2 && parts[0] === "world") return { kind: "world", name: parts[1]! };
    if (parts.length === 2 && parts[0] === "story") {
      return { kind: "bag", own: this.stores.story, shared: this.internals.shared.story, name: parts[1]! };
    }
    if (parts.length === 3 && (parts[0] === "box" || parts[0] === "deck" || parts[0] === "hand" || parts[0] === "value")) {
      const kind = parts[0] as Exclude<PartitionKind, "story">;
      const own = this.stores[kind].get(parts[1]!);
      const shared = this.internals.shared[kind].get(parts[1]!);
      if (own === undefined && shared === undefined) throw new Error(`no ${parts[0]} store "${parts[1]}"`);
      return { kind: "bag", ...(own !== undefined ? { own } : {}), ...(shared !== undefined ? { shared } : {}), name: parts[2]! };
    }
    throw new Error(`bad property path "${path}"`);
  }

  // --- persistence (schema 4) -------------------------------------------------

  /** @internal - this flow's blob inside the engine's envelope. */
  snapshot(): FlowSave {
    return {
      props: partitionValues(this.stores),
      turns: Object.fromEntries(this.turnCounts),
      prng: this.prng.state(),
      cooldowns: this.cooldowns,
      board: Object.fromEntries(this.boardContents),
      playLog: this.playLog,
    };
  }

  /** @internal - restore a freshly opened flow from its blob (loadGame).
   *  Orphaned keys (deleted entities) drop; new declarations keep defaults. */
  restore(saved: FlowSave): void {
    loadPartition(this.stores, saved.props);
    this.turnCounts = new Map(this.internals.bundle.boxes.map((b) => [b.id, 0]));
    for (const [boxId, turn] of Object.entries(saved.turns ?? {})) {
      if (this.turnCounts.has(boxId)) this.turnCounts.set(boxId, turn);
    }
    this.prng = makePrng(saved.prng);
    this.cooldowns = saved.cooldowns ?? {};
    this.playLog = saved.playLog ?? [];
    this.rebuildPlayIndex();
    this.boardContents = new Map(Object.entries(saved.board ?? {})
      .filter(([handId]) => this.internals.handsById.has(handId))
      .map(([handId, ids]) => [handId, ids.filter((id) => this.internals.cardsById.has(id))]));
    for (const handId of this.internals.handsById.keys()) {
      if (!this.boardContents.has(handId)) this.boardContents.set(handId, []);
    }
  }
}
