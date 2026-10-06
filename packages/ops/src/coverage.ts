// ---------------------------------------------------------------------------
// Coverage: run the project headlessly N times through the reference runtime
// and tally what gets dealt and played - the answer to Reboot 4's "how do I
// test it": coverage per HAND (round 2: coverage is keyed to deals and
// plays; peeks are looked-at telemetry and are not exercised here).
//
// The synthesis of both predecessors (decided 2026-07-19):
//   - Patter's architecture: drivers live in the project shard (one versioned
//     spec for CLI / CI / editor), whole-driver auto-proposal, and a single
//     harness PRNG seeding everything - a coverage run is bit-for-bit
//     reproducible from its seed.
//   - The old system's domain riches: real gated-outcome-aware plays,
//     per-outcome and dealt-but-never-played reporting, exhaustion-aware
//     termination, and the honesty net - a never-dealt card gated on state
//     nothing writes and nothing drives is flagged, not called dead.
//   - Natively ours: hands are the coverage unit; a template instance's
//     chosen tags vary across its sibling instances, so the axis is
//     exercised hand by hand.
//
// Semantics are honest Monte-Carlo: zero hits means "never sampled in N
// seeded runs", never a proof of unreachability. The unwritten-inputs net
// reads @world, @story and @hand refs (an @hand name counts as varying when it
// is a tag group's name or something writes it back); the composed-name net
// reads @hand refs statically against the hands that ask them.
// ---------------------------------------------------------------------------

import { compileProject, worldDeclarations } from "@storylet-studio/compiler";
import type { Issue, SourceProject } from "@storylet-studio/compiler";
import { previewRegistry } from "./game-scopes.js";
import { Engine, makePrng } from "@storylet-studio/runtime";
import type { Flow, Prng } from "@storylet-studio/runtime";
import { PLACE_GROUP, effectiveGameId, groupsOfBox } from "@storylet-studio/model";
import { RARE_DEALT_PCT, rarelyDealt } from "./coverage-order.js";
import { handReach } from "./reach.js";
import { flagKey, handDeclarations, writesOf } from "./analysis-common.js";
import type {
  AstNode, Box, Bundle, Card, CoverageConfig, CoverageDriver, Deck,
  Expression, Hand, ScalarValue,
} from "@storylet-studio/model";

export interface CoverageOptions {
  /** Number of seeded playthroughs (default 200). */
  runs?: number;
  /** Per-run turn cap (default 100). */
  maxTurns?: number;
  /** Harness seed; the whole coverage run is reproducible from it (default 0). */
  seed?: number;
  /** Override the project's coverage config (drivers + arg domains). */
  coverage?: CoverageConfig;
  /** Asked between runs: true stops the sweep early and reports what it has.
   *  Set by runCoverageAsync when the author cancels; a partial report is a
   *  real answer, so the runs completed so far are still tallied. */
  shouldStop?: () => boolean;
  /** Watch what each play makes newly eligible, for the Links window's
   *  observed-edge overlay (design/graphical-views.md 4). OFF by default and
   *  deliberately: it costs two eligibility probes per play (a peek per hand,
   *  each time), and the ordinary sweep answers "what is never dealt", which
   *  needs none of it. A peek draws nothing (ruling A), so the tallies are the
   *  same with it on or off; and its own diagnostics stay out of the report. */
  observeEdges?: boolean;
}

/** How often a recurring driver re-rolls, per turn. */
const CADENCE_PROB: Record<NonNullable<CoverageDriver["cadence"]>, number> = {
  rarely: 0.05,
  sometimes: 0.2,
  often: 0.5,
};

/** Consecutive turns with nothing dealt anywhere before a run is "stuck". */
const MAX_EMPTY_TURNS = 20;

export interface CardCoverage {
  id: string;
  gameId: string;
  title?: string;
  deck: string;
  /** The owning deck as a reader knows it: its title, else its gameId. */
  deckName: string;
  /** The owning box, so a reader can jump straight to the card. */
  box: string;
  /** The owning box as a reader knows it: its title, else its gameId. */
  boxName: string;
  /** Times the card appeared in any hand, across all runs. A card that stays
   *  in a hand counts again each turn, so this can exceed `runs`. */
  dealt: number;
  /** Times an outcome of it was played, across all runs. A card with no
   *  outcomes is played with "" as a host would (ruling K), freeing its slot,
   *  but that play has no outcome and is not counted here. */
  played: number;
  /** Runs that dealt it at least once: what "how easily does this come up"
   *  is measured in, where `dealt` says how much it was seen. */
  dealtRuns: number;
  /** Runs that played it at least once. */
  playedRuns: number;
  /** Dealt, but in fewer than `rareThresholdPct`% of runs (`rarelyDealt`):
   *  content that CAN come up but hangs on an unlikely route or a condition
   *  that is nearly always false. Worth a look, not necessarily a fault (one
   *  of many random picks is rare by design). Never set on a never-dealt
   *  card, which has its own, louder flag. */
  rare: boolean;
  /** Refs it is dealt on that no outcome writes and no driver drives - only
   *  reported on never-dealt cards (the honesty net). What a card is dealt on
   *  is its condition, its deck's gate, and its priority when that is an
   *  expression; an outcome's gate is not in it, since it cannot stop the
   *  card being dealt. */
  unwrittenRefs?: string[];
  /** The honesty net's second hop: refs it is dealt on that ARE written, but
   *  only by cards which were themselves never dealt in this sweep. `by` is
   *  those card ids, so the reader has somewhere to go next. Never-dealt cards
   *  only, and never overlapping `unwrittenRefs`. */
  refsWrittenOnlyByNeverDealtCards?: { ref: string; by: string[] }[];
}

export interface OutcomeCoverage {
  id: string;
  gameId: string;
  card: string;
  played: number;
}

export interface HandCoverage {
  id: string;
  gameId: string;
  /** The hand's display title, when it has one (a stripped bundle has none). */
  title?: string;
  /** The owning box, so a reader can jump straight to the hand. */
  box: string;
  /** The owning box as a reader knows it: its title, else its gameId. */
  boxName: string;
  /** Total deals into this hand across all runs. */
  deals: number;
  /** Cards that could come up at this hand, by tags and place alone (see
   *  `handReach`): what the hand's coverage is out of. Conditions are not
   *  considered, and a group bound at run time counts as a wildcard, so this
   *  errs towards "could". Sorted ids. */
  cardsPossible: string[];
  /** Distinct cards the hand held at least once, across all runs. Normally a
   *  subset of `cardsPossible`; a card dealt here that the static rule says
   *  could not be is still listed, because the run is the evidence. */
  cardsDealt: string[];
  /** Cards that could come up at this hand and never did in any run (the
   *  per-hand gap list). A card pinned to another hand, or tagged out of
   *  this hand's slice, is not a gap here and is not listed. */
  cardsNeverDealt: string[];
}

/** The composed-name net's finding: a `@hand.<name>` read or written where
 *  some hand that can legitimately ask it never composes the name - so
 *  evaluation faults there and the card (or its whole deck, or the hand
 *  itself) silently never deals from that hand, or the play is refused.
 *  Static: found without running anything. */
export interface UnprovidedHandRef {
  /** Where the ref is read: "card <gameId>", "deck <gameId> gate",
   *  "hand <gameId> condition" or "hand template <gameId> condition". */
  where: string;
  ref: string;
  /** The asking hands that never compose the name, as gameIds. */
  hands: string[];
}

/** A diagnostic the runtime emitted during the seeded runs, deduplicated. A
 *  play the engine refused is one too, `where` "card <gameId> play" and the
 *  engine's own message: the run carries on, since a refused play changes
 *  nothing (ruling B). */
export interface CoverageDiagnostic {
  where: string;
  message: string;
  /** How many runs it fired in at least once. */
  runs: number;
}

/** One observed edge: playing `from` (by `outcome`) left `to` eligible when it
 *  was not immediately before. Evidence, against the Links window's static
 *  inference of what COULD enable a card - and where the two disagree, one of
 *  them is wrong, which is the point of collecting it
 *  (design/graphical-views.md 4). */
export interface ObservedEdge {
  /** Card id played. */
  from: string;
  /** Outcome id chosen: the thing that actually wrote the state. */
  outcome: string;
  /** Card id that became eligible. */
  to: string;
  /** Runs in which this was seen at least once ("seen in 41 of 200 runs"). */
  runs: number;
  /** Times seen across every run. */
  count: number;
}

/** The report's headline counts, so every reader says the same thing. */
export interface CoverageTotals {
  cards: number;
  /** Cards dealt in at least one run. */
  dealt: number;
  neverDealt: number;
  /** Cards flagged `rare`: dealt, but in fewer than `rareThresholdPct`% of runs. */
  rare: number;
  /** Cards dealt at least once and never played. Only cards that HAVE
   *  outcomes count: a card with none is dealt-only by design (the news and
   *  codex pattern), and "never played" would be an accusation it cannot
   *  answer. */
  dealtNeverPlayed: number;
}

export interface CoverageReport {
  runs: number;
  seed: number;
  /** The per-run turn cap used, echoed so the report reads on its own. */
  maxTurns: number;
  /** How long one turn lasts, when the whole project agrees on an answer:
   *  every box is TIMED (design/engine-server.md 4.8) and every one of them
   *  declares the same `seconds`. The sweep's turns can then be read as time
   *  and the report says so. Absent whenever the project mixes units or has
   *  any untimed box, because a mixed turn count is not a duration. */
  turnSeconds?: number;
  /** The refs the run actually drove, sorted - what the honesty net was told
   *  about. Empty means every @world gate reads as "nothing drives it". */
  drivers: string[];
  turns: number;
  /** Outcomes played. A dealt-only card's play with "" is not one. */
  plays: number;
  terminations: Record<"exhausted" | "maxTurns" | "stuck", number>;
  /** Every card, in deck order: box by box, deck by deck, as authored.
   *  `leastReachedFirst` gives the order a reader should look in. */
  cards: CardCoverage[];
  totals: CoverageTotals;
  /** The share of runs below which a dealt card counts as rare
   *  ({@link RARE_DEALT_PCT}). */
  rareThresholdPct: number;
  outcomes: OutcomeCoverage[];
  hands: HandCoverage[];
  /** Refs conditions read that no outcome writes and no driver drives. */
  unwrittenInputs: string[];
  /** @hand names read where some asking hand never composes them (static). */
  unprovidedHandRefs: UnprovidedHandRef[];
  /** Runtime warnings the runs actually fired, previously swallowed. */
  diagnostics: CoverageDiagnostic[];
  /** What each play made newly eligible. Present only when `observeEdges` was
   *  asked for; an empty array from a run that did ask means the plays opened
   *  nothing, which is itself an answer. */
  observedEdges?: ObservedEdge[];
  issues: Issue[];
}

// --- static analysis: refs, writes, literal pools ------------------------------

/** Walk an AST for `@scope.name` refs and the literals they compare against,
 *  and, given `flags`, the flags a `check_flags(@x, +f)` asks for, each as its
 *  own key (`flagKey`): `@story.world_events:traders_arrived` is one FLAG, not
 *  the property that holds it. A flags property is a bag of independent
 *  latches, and the honesty net's second hop is useless at property
 *  granularity: half the Village writes `@story.world_events`, so "is it
 *  written?" is always yes while the flag a card actually reads may be written
 *  by nothing that ever happens. deadstate.ts draws the same distinction, for
 *  the same reason. */
function scanAst(
  ast: AstNode, refs: Set<string>, pools?: Map<string, Set<ScalarValue>>, flags?: Set<string>,
): void {
  if (!Array.isArray(ast)) return;
  const [tag] = ast;
  if (tag === "sv") {
    refs.add(`@${ast[1]}.${ast[2]}`);
    return;
  }
  if (flags && tag === "call" && ast[1] === "check_flags") {
    const target = ast[2];
    if (Array.isArray(target) && target[0] === "sv") {
      const ref = `@${target[1]}.${target[2]}`;
      for (const arg of ast.slice(3)) {
        if (Array.isArray(arg) && arg[0] === "fd" && arg[1] === "+") flags.add(flagKey(ref, String(arg[2])));
      }
    }
  }
  if (tag === "bin") {
    const [, op, l, r] = ast as ["bin", string, AstNode, AstNode];
    if (pools && ["==", "!=", ">", ">=", "<", "<="].includes(op)) {
      const sides: [AstNode, AstNode][] = [[l, r], [r, l]];
      for (const [a, b] of sides) {
        if (Array.isArray(a) && a[0] === "sv" && Array.isArray(b) && ["n", "s", "b"].includes(b[0] as string)) {
          const ref = `@${a[1]}.${a[2]}`;
          const pool = pools.get(ref) ?? new Set<ScalarValue>();
          const value = b[1] as ScalarValue;
          pool.add(value);
          // Ordering comparisons: the boundary's integer neighbours matter.
          if (typeof value === "number" && Number.isInteger(value) && op !== "==" && op !== "!=") {
            pool.add(value - 1);
            pool.add(value + 1);
          }
          pools.set(ref, pool);
        }
      }
    }
    scanAst(l, refs, pools, flags);
    scanAst(r, refs, pools, flags);
    return;
  }
  for (const part of ast.slice(1)) scanAst(part as AstNode, refs, pools, flags);
}

interface Analysis {
  /** Refs each card is DEALT on, by card id: its condition, its deck's gate,
   *  and its priority when that is an expression. What the honesty net may
   *  blame for a card never coming up. An outcome's gate is not in it: it
   *  decides what can be played once the card is in a hand, never whether the
   *  card gets there. */
  cardRefs: Map<string, Set<string>>;
  /** Every ref any condition/gate reads. */
  allRefs: Set<string>;
  /** Refs some outcome change writes (story-owned: covered by play). */
  written: Set<string>;
  /** Which CARDS write each ref, by ref. The honesty net's second hop: a ref
   *  written only by cards that were themselves never dealt is unreachable in
   *  practice, however well wired it looks on paper.
   *
   *  Keyed by ref AND by `ref:flag` (see `flagKey`), because a flags property
   *  is a bag of independent latches and only the flag granularity answers
   *  the question a card's condition actually asks. */
  writtenBy: Map<string, Set<string>>;
  /** Literal pools per ref, for proposal. */
  pools: Map<string, Set<ScalarValue>>;
}

function analyse(bundle: Bundle): Analysis {
  const cardRefs = new Map<string, Set<string>>();
  const allRefs = new Set<string>();
  const written = new Set<string>();
  const writtenBy = new Map<string, Set<string>>();
  const pools = new Map<string, Set<ScalarValue>>();
  const conditionRefs = (expr: Expression | undefined, into?: Set<string>): void => {
    if (!expr) return;
    const refs = new Set<string>();
    const flags = new Set<string>();
    scanAst(expr.ast, refs, pools, flags);
    for (const ref of refs) {
      allRefs.add(ref);
      into?.add(ref);
    }
    // A checked flag joins the card's read set as its own key, so the second
    // hop can ask about `@story.world_events:traders_arrived` rather than
    // about a property half the project writes.
    for (const flag of flags) into?.add(flag);
  };
  for (const box of bundle.boxes) {
    for (const template of box.handTemplates) conditionRefs(template.condition);
    for (const hand of box.hands) conditionRefs(hand.rule?.condition);
    for (const deck of box.decks) {
      // The deck's gate is asked before any of its cards is, so it is part of
      // what every one of them is dealt on.
      const gate = new Set<string>();
      conditionRefs(deck.condition, gate);
      for (const card of deck.cards) {
        const refs = new Set<string>(gate);
        conditionRefs(card.condition, refs);
        if (typeof card.priority !== "number") conditionRefs(card.priority, refs);
        cardRefs.set(card.id, refs);
        for (const outcome of card.outcomes) {
          // Read, so an input of the project, but not what the card is dealt on.
          conditionRefs(outcome.condition);
          for (const w of writesOf(outcome)) {
            written.add(w.target);
            const notes = (key: string): void => {
              let by = writtenBy.get(key);
              if (by === undefined) { by = new Set<string>(); writtenBy.set(key, by); }
              by.add(card.id);
            };
            notes(w.target);
            // `@x = set_flags(@x, +a, +b)`: this card writes flags a and b of x.
            for (const d of w.flags?.deltas ?? []) if (d.sign === "+") notes(flagKey(w.target, d.flag));
            conditionRefs(w.expr);
          }
        }
      }
    }
  }
  return { cardRefs, allRefs, written, writtenBy, pools };
}

// --- what could come up where (static) ------------------------------------------
// The rule lives in reach.ts (`handReach`), one copy shared with the editor's
// hand page, so the per-hand report and the page can never disagree about who
// can hold what.

// --- the composed-name net (static) --------------------------------------------
// The class the Board's peek false alarm pointed at (design/board-legibility.md):
// a card reading @hand.X that some hand which can legitimately ask it never
// composes. Mirrors the runtime's ask composition (schema 2.6/3.6): a hand
// composes its template's (or its own) properties, the flattened properties of
// every tag it binds, the NAMES of groups it chooses or rule-binds (askNames -
// a fixed template binding does not name its group), and whatever a boundBy
// group or a movable hole may bind at ask time (counted as composed,
// conservatively). A card's asking hands are those `handReach` admits (tag
// matching runs before condition evaluation); a deck gate evaluates for EVERY
// ask of the box, so its refs must be composed by every hand. A hand's own
// condition (its rule's, or its template's for an instance) is asked of that
// hand alone. A change TARGET counts as well as a read: writing a name the
// hand does not compose is a play the engine refuses.

const handRefsOf = (expr: Expression | undefined): string[] => {
  if (!expr) return [];
  const refs = new Set<string>();
  scanAst(expr.ast, refs);
  return [...refs].filter((r) => r.startsWith("@hand."));
};

function findUnprovidedHandRefs(bundle: Bundle): UnprovidedHandRef[] {
  const out: UnprovidedHandRef[] = [];
  for (const box of bundle.boxes) {
    const groups = groupsOfBox(bundle, box);
    const groupsById = new Map(groups.map((g) => [g.id, g]));
    const reach = handReach(bundle, box);

    const composed = new Map<string, Set<string>>();
    for (const hand of box.hands) {
      const names = new Set<string>();
      const bound = new Set<string>();
      for (const decl of handDeclarations(box.handTemplates, hand)) names.add(decl.name);
      for (const { group: groupId, tag: tagId, named } of reach.fixed(hand)) {
        bound.add(groupId);
        const group = groupsById.get(groupId);
        for (const decl of group?.tags.find((t) => t.id === tagId)?.properties ?? []) names.add(decl.name);
        if (named && group) names.add(effectiveGameId(group));
      }
      const holes = reach.holes(hand);
      for (const group of groups) {
        const movable = holes.has(group.id) || (group.boundBy !== undefined && !bound.has(group.id));
        if (!movable) continue;
        names.add(effectiveGameId(group));
        for (const tag of group.tags) for (const decl of tag.properties ?? []) names.add(decl.name);
      }
      composed.set(hand.id, names);
    }

    const check = (where: string, refs: string[], asking: Hand<Expression>[]): void => {
      for (const ref of refs) {
        const name = ref.slice("@hand.".length);
        const missing = asking
          .filter((hand) => !composed.get(hand.id)!.has(name))
          .map((hand) => effectiveGameId(hand))
          .sort();
        if (missing.length > 0) out.push({ where, ref, hands: missing });
      }
    };

    for (const template of box.handTemplates) {
      check(`hand template ${effectiveGameId(template)} condition`, handRefsOf(template.condition),
        box.hands.filter((hand) => hand.template === template.id));
    }
    for (const hand of box.hands) {
      if (hand.template === undefined) check(`hand ${effectiveGameId(hand)} condition`, handRefsOf(hand.rule?.condition), [hand]);
    }
    for (const deck of box.decks) {
      check(`deck ${effectiveGameId(deck)} gate`, handRefsOf(deck.condition), box.hands);
      for (const card of deck.cards) {
        const refs = new Set<string>(handRefsOf(card.condition));
        if (typeof card.priority !== "number") for (const r of handRefsOf(card.priority)) refs.add(r);
        for (const outcome of card.outcomes) {
          for (const r of handRefsOf(outcome.condition)) refs.add(r);
          for (const w of writesOf(outcome)) {
            if (w.scope === "hand") refs.add(`@hand.${w.name}`);
            for (const r of handRefsOf(w.expr)) refs.add(r);
          }
        }
        check(`card ${effectiveGameId(card)}`, [...refs].sort(),
          box.hands.filter((hand) => reach.admits(card, hand)));
      }
    }
  }
  return out.sort((a, b) => a.where.localeCompare(b.where) || a.ref.localeCompare(b.ref));
}

// --- the harness -------------------------------------------------------------------
//
// In three parts: `setUp` (compile, the static analyses, everything a run
// reads), `runOnce` (one seeded playthrough, tallied into the sweep's state)
// and `report` (the honesty net, then the report). The harness PRNG is drawn
// from in exactly one order, run by run, which is what makes a sweep
// reproducible from its seed; nothing outside `runOnce` draws from it.

type Located = { card: Card<Expression>; deck: Deck<Expression>; box: Box<Expression> };

/** Everything a sweep carries from one run to the next. */
interface SweepState {
  source: SourceProject;
  opts: CoverageOptions;
  bundle: Bundle;
  issues: Issue[];
  runs: number;
  maxTurns: number;
  seed: number;
  coverage: CoverageConfig;
  drivers: [string, CoverageDriver][];
  drivenRefs: string[];
  engineFor: (engineSeed: number) => Engine;
  turnSeconds?: number;
  /** The timed boxes, which the harness ticks after each play. */
  timedBoxes: Box<Expression>[];
  analysis: Analysis;
  prng: Prng;
  allCards: Located[];
  cardsById: Map<string, Card<Expression>>;
  /** One-shots the exhaustion test waits to see PLAYED. */
  neverRedraw: Set<string>;
  handsByGameId: Map<string, Hand<Expression>>;
  /** The observed-edge probe's peeks, one per hand. */
  probes: { box: string; criteria: Record<string, string> }[];
  // Tallies.
  dealt: Map<string, number>;
  played: Map<string, number>;
  /** Runs, not occurrences: each run adds at most one to a card's count. */
  dealtRuns: Map<string, number>;
  playedRuns: Map<string, number>;
  outcomePlayed: Map<string, number>;
  handDeals: Map<string, number>;
  handCards: Map<string, Set<string>>;
  terminations: CoverageReport["terminations"];
  totalTurns: number;
  totalPlays: number;
  /** Runtime warnings, deduplicated by (where, message), counted by run. */
  diagCounts: Map<string, CoverageDiagnostic>;
  /** Observed edges, keyed "from\0outcome\0to". */
  edgeCounts: Map<string, ObservedEdge>;
  runsDone: number;
}

const emptyReport = (seed: number, maxTurns: number, drivenRefs: string[], issues: Issue[]): CoverageReport => ({
  runs: 0, seed, maxTurns, drivers: drivenRefs, turns: 0, plays: 0,
  terminations: { exhausted: 0, maxTurns: 0, stuck: 0 },
  cards: [], totals: { cards: 0, dealt: 0, neverDealt: 0, rare: 0, dealtNeverPlayed: 0 },
  rareThresholdPct: RARE_DEALT_PCT,
  outcomes: [], hands: [], unwrittenInputs: [], unprovidedHandRefs: [], diagnostics: [], issues,
});

/** Compile and analyse, and build what every run reads. A finished report
 *  instead when there is nothing to run. */
function setUp(source: SourceProject, opts: CoverageOptions): SweepState | { done: CoverageReport } {
  const { bundle, issues } = compileProject(source);
  const runs = opts.runs ?? 200;
  const maxTurns = opts.maxTurns ?? 100;
  const seed = opts.seed ?? 0;
  const coverage = opts.coverage ?? source.project.coverage ?? {};
  const drivers = Object.entries(coverage.drivers ?? {});
  const drivenRefs = drivers.map(([ref]) => ref).sort();

  if (!bundle) return { done: emptyReport(seed, maxTurns, drivenRefs, issues) };
  // The sweep runs the Storylet Engine on its own, which refuses content that names another
  // engine's scope (`@patter.visits`) as a flow opens. Say so once, as an error, not per run.
  // With a game scopes folder, each run stands the other engines in from their declared
  // defaults instead (patterkit design/shared-scopes.md, decision 4): a fresh registry per
  // run, as each run is a fresh game.
  const merged = source.gameScopes?.merged;
  const engineFor = (engineSeed: number): Engine => {
    const registry = previewRegistry(bundle, merged);
    return new Engine(bundle, { seed: engineSeed, ...(registry ? { registry } : {}) });
  };
  try { engineFor(seed).openFlow("main"); }
  catch (e) {
    return { done: emptyReport(seed, maxTurns, drivenRefs,
      [...issues, { severity: "error", path: source.path, message: e instanceof Error ? e.message : String(e) }]) };
  }

  // The sweep's turns read as time only when the whole project agrees: every
  // box timed, on one unit (design/engine-server.md 4.8). A project that mixes
  // a timed box with an untimed one has no single answer to "how long was that
  // run", so the report says turns and stops there.
  const units = new Set(bundle.boxes.map((b) => b.turn?.seconds));
  const turnSeconds = units.size === 1 && !units.has(undefined)
    ? [...units][0] as number : undefined;

  const allCards: Located[] =
    bundle.boxes.flatMap((box) => box.decks.flatMap((deck) => deck.cards.map((card) => ({ card, deck, box }))));

  // The observed-edge probe peeks once per HAND, with the hand's place bound
  // and the fixed bindings it makes on every ask (ruling L, option a). A peek
  // through the box alone binds no place, so it refused every card pinned to a
  // hand: on the Village, 72 of 86 cards could never be seen opening. Still
  // blind to what a peek cannot compose (a hand's own properties, its
  // condition) and to a movable hole, which stays a wildcard: it errs towards
  // "could", as handReach does.
  const probes = bundle.boxes.flatMap((box) => {
    const reach = handReach(bundle, box);
    const groupsById = new Map(groupsOfBox(bundle, box).map((g) => [g.id, g]));
    return box.hands.map((hand) => {
      const criteria: Record<string, string> = { [PLACE_GROUP]: effectiveGameId(hand) };
      const holes = reach.holes(hand);
      for (const { group: groupId, tag: tagId } of reach.fixed(hand)) {
        if (groupId === PLACE_GROUP || holes.has(groupId)) continue;
        const group = groupsById.get(groupId);
        const tag = group?.tags.find((t) => t.id === tagId);
        if (group !== undefined && tag !== undefined) criteria[effectiveGameId(group)] = effectiveGameId(tag);
      }
      return { box: effectiveGameId(box), criteria };
    });
  });

  return {
    source, opts, bundle, issues, runs, maxTurns, seed, coverage, drivers, drivenRefs, engineFor,
    ...(turnSeconds !== undefined ? { turnSeconds } : {}),
    // A timed box has no clock of its own: whoever runs the engine ticks it, and
    // during a sweep that is the harness. One sweep turn is one tick, which is
    // what makes a cooldown in a timed box expire in a run at all.
    timedBoxes: bundle.boxes.filter((b) => b.turn !== undefined),
    analysis: analyse(bundle),
    prng: makePrng(seed),
    allCards,
    cardsById: new Map(allCards.map((e) => [e.card.id, e.card])),
    // One-shots the exhaustion test waits to see PLAYED: only cards that can
    // be. A dealt-only card (no outcomes - the news/codex pattern, where dealt
    // is the card's whole job) is played with "" when it is picked, but must
    // not hold every run at the turn cap waiting for that.
    neverRedraw: new Set(allCards
      .filter((e) => e.card.redraw === "never" && e.card.outcomes.length > 0)
      .map((e) => e.card.id)),
    handsByGameId: new Map(bundle.boxes.flatMap((box) => box.hands.map((h) => [effectiveGameId(h), h]))),
    probes,
    dealt: new Map(), played: new Map(), dealtRuns: new Map(), playedRuns: new Map(),
    outcomePlayed: new Map(), handDeals: new Map(), handCards: new Map(),
    terminations: { exhausted: 0, maxTurns: 0, stuck: 0 },
    totalTurns: 0, totalPlays: 0,
    diagCounts: new Map(), edgeCounts: new Map(),
    runsDone: 0,
  };
}

/** One seeded playthrough, tallied into `s`. */
function runOnce(s: SweepState): void {
  const { bundle, drivers, prng, opts } = s;
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(prng.next() * arr.length)]!;
  const applyDriver = (session: Flow, ref: string, driver: CoverageDriver): void => {
    if (driver.values.length === 0) return;
    session.setProperty(ref.slice(1), pick(driver.values));   // "@world.x" -> "world.x"
  };
  const tickAll = (session: Flow): void => {
    for (const box of bundle.boxes) session.advanceTurns(box.id, 1);
  };

  // The engine's own seed derives from the harness PRNG: one seed, whole
  // run reproducible.
  const session = s.engineFor(Math.floor(prng.next() * 0x100000000)).openFlow("main");
  // Subscribing turns the trace on; the diagnostics it surfaces (a faulting
  // condition, an undeclared name) used to be swallowed by the sweep.
  const runDiags = new Set<string>();
  const diagKey = (where: string, message: string): string => `${where}\u0000${message}`;
  // Edges already counted for THIS run, so `runs` counts runs not sightings.
  const runEdges = new Set<string>();
  // What THIS run has seen, for the exhaustion test below.
  const runDealt = new Set<string>();
  const runPlayed = new Set<string>();
  // Set while the observed-edge probe peeks. A peek composes no hand
  // properties, so a card reading one faults INSIDE the probe: a diagnostic
  // about the probe, which no deal raised and the report must not carry.
  let probing = false;
  const unsubscribe = session.subscribeTrace((e) => {
    if (e.type === "diagnostic" && !probing) runDiags.add(diagKey(e.where, e.message));
  });

  /** Every card some hand's peek would find available right now. A peek looks
   *  without claiming and draws nothing (the look/use rule, ruling A), so
   *  probing costs the run nothing but time - which is why this is opt-in. The
   *  criteria are built from the bundle itself, so a peek here cannot name what
   *  its box lacks; nothing is caught, and a throw is a fault worth seeing. */
  const eligibleNow = (): Set<string> => {
    const out = new Set<string>();
    probing = true;
    try {
      for (const probe of s.probes) for (const card of session.peek(probe.box, probe.criteria).cards) out.add(card.id);
    } finally {
      probing = false;
    }
    return out;
  };

  for (const [ref, driver] of drivers) {
    if (driver.kind === "initial") applyDriver(session, ref, driver);
  }

  let emptyTurns = 0;
  let turn = 0;
  for (; turn < s.maxTurns; turn++) {
    for (const [ref, driver] of drivers) {
      if (driver.kind === "recurring" && prng.next() < CADENCE_PROB[driver.cadence ?? "sometimes"]) {
        applyDriver(session, ref, driver);
      }
    }

    session.dealMany();
    const board = session.board();
    // Play candidates: (cardId, hand) pairs from the board - everything the
    // game could act on. Peeks cannot mark use (the look/use rule), so
    // coverage exercises deals and plays only.
    const candidates: { cardId: string; from: string }[] = [];
    for (const [handGameId, cards] of Object.entries(board)) {
      const hand = s.handsByGameId.get(handGameId);
      for (const card of cards) {
        candidates.push({ cardId: card.id, from: handGameId });
        runDealt.add(card.id);
        if (hand) tallyDeal(s, card.id, hand.id);
      }
    }

    if (candidates.length === 0) {
      if (++emptyTurns >= MAX_EMPTY_TURNS) break;
      tickAll(session);
      s.totalTurns++;
      continue;
    }
    emptyTurns = 0;

    const choice = pick(candidates);
    const card = s.cardsById.get(choice.cardId)!;
    // A card with no outcomes is played with "", as a host plays a masthead or
    // a notice (ruling K): its slot frees, and the card behind it can come up.
    // Held instead, a high-priority one kept its slot for the whole run.
    let outcome: { id: string; gameId: string } | undefined;
    if (card.outcomes.length > 0) {
      const available = session.outcomes(choice.cardId, choice.from).filter((o) => o.available);
      if (available.length === 0) {
        // Dealt but nothing playable: the clocks still move.
        tickAll(session);
        s.totalTurns++;
        continue;
      }
      outcome = pick(available);
    }
    // Immediately before and immediately after, so what is attributed to this
    // play is what THIS play changed. Measured between deals, because a deal
    // claims cards and would read as the play having closed them. Only an
    // outcome's play is measured: an edge is attributed to the outcome that
    // wrote the state.
    const before = opts.observeEdges && outcome !== undefined ? eligibleNow() : undefined;
    try {
      session.play(choice.cardId, outcome?.gameId ?? "", choice.from);
    } catch (e) {
      // A play the engine refuses (an uncomposed @hand write, a read-only
      // target) changes nothing at all (ruling B), so the run can go on: it
      // is reported, and the turn passes as one with nothing playable does.
      runDiags.add(diagKey(`card ${effectiveGameId(card)} play`, e instanceof Error ? e.message : String(e)));
      tickAll(session);
      s.totalTurns++;
      continue;
    }
    // The tick a timed box's plays no longer do, done by the harness, which
    // is this sweep's host: before the "after" reading, so the clock has
    // moved by the time eligibility is measured, exactly as it has already
    // moved in an untimed box.
    for (const box of s.timedBoxes) session.advanceTurns(box.id, 1);
    if (before && outcome) {
      for (const id of eligibleNow()) {
        // The played card returns to the pool as it leaves the hand: that is
        // the claim releasing, not the play opening anything.
        if (id === choice.cardId || before.has(id)) continue;
        const key = `${choice.cardId}\u0000${outcome.id}\u0000${id}`;
        const found = s.edgeCounts.get(key);
        if (found) { found.count++; if (!runEdges.has(key)) found.runs++; }
        else s.edgeCounts.set(key, { from: choice.cardId, outcome: outcome.id, to: id, runs: 1, count: 1 });
        runEdges.add(key);
      }
    }
    if (outcome) {
      runPlayed.add(choice.cardId);
      s.played.set(choice.cardId, (s.played.get(choice.cardId) ?? 0) + 1);
      s.outcomePlayed.set(outcome.id, (s.outcomePlayed.get(outcome.id) ?? 0) + 1);
      s.totalPlays++;
    }
    s.totalTurns++;

    // Exhaustion: THIS RUN has dealt every card at least once and played
    // every one-shot, so there is nothing left for it to discover.
    //
    // Measured per run, and that word is load-bearing. It used to read the
    // sweep-wide tallies, so once the CUMULATIVE sweep had seen everything -
    // about run 83 on the Village - every later run broke after its very
    // first play. Asking for 5000 runs then sampled no more than 84 runs'
    // worth: the report said `runs: 5000`, the tallies were byte-identical
    // to a 200-run sweep, and the same rare outcomes went unplayed every
    // single time however high you set the number. Which is exactly how the
    // author found it (2026-08-30): "even when running a 5000 pass coverage
    // I get these two, and can't see why it would be these two each time".
    const exhausted = s.allCards.every((e) => runDealt.has(e.card.id))
      && [...s.neverRedraw].every((id) => runPlayed.has(id));
    if (exhausted) break;
  }
  if (turn >= s.maxTurns) s.terminations.maxTurns++;
  else if (emptyTurns >= MAX_EMPTY_TURNS) s.terminations.stuck++;
  else s.terminations.exhausted++;
  unsubscribe();
  for (const id of runDealt) s.dealtRuns.set(id, (s.dealtRuns.get(id) ?? 0) + 1);
  for (const id of runPlayed) s.playedRuns.set(id, (s.playedRuns.get(id) ?? 0) + 1);
  for (const key of runDiags) {
    const found = s.diagCounts.get(key);
    if (found) found.runs++;
    else {
      const cut = key.indexOf("\u0000");
      s.diagCounts.set(key, { where: key.slice(0, cut), message: key.slice(cut + 1), runs: 1 });
    }
  }
}

function tallyDeal(s: SweepState, cardId: string, handId: string): void {
  s.dealt.set(cardId, (s.dealt.get(cardId) ?? 0) + 1);
  s.handDeals.set(handId, (s.handDeals.get(handId) ?? 0) + 1);
  (s.handCards.get(handId) ?? s.handCards.set(handId, new Set()).get(handId)!).add(cardId);
}

/** The honesty net over the tallies, and the report. */
function report(s: SweepState): CoverageReport {
  const { bundle, analysis, coverage } = s;
  // The honesty net: refs read by never-dealt cards that nothing writes and
  // nothing drives. An @hand name counts as driven when it is a tag group's
  // gameId (chosen tags / criteria vary across hands, schema 3.6); as
  // written when some outcome targets "@hand.<name>" (write-back, 3.6).
  const driven = new Set(Object.keys(coverage.drivers ?? {}));
  // Only tag GROUP names clear the flag: chosen tags / criteria vary across
  // hands, while a tag or hand property's default never varies unless some
  // outcome writes it (then `written` clears it) or a driver drives it.
  const composedNames = new Set<string>(
    bundle.boxes.flatMap((b) => groupsOfBox(bundle, b).map((g) => effectiveGameId(g))));
  const unwritten = (ref: string): boolean => {
    if (ref.includes(":")) return false;   // a flag key: the second hop's business, not this one's
    if (analysis.written.has(ref) || driven.has(ref)) return false;
    if (ref.startsWith("@hand.")) return !composedNames.has(ref.slice("@hand.".length));
    return ref.startsWith("@world.") || ref.startsWith("@story.");
  };
  const unwrittenInputs = [...analysis.allRefs].filter(unwritten).sort();

  // THE SECOND HOP. The net above asks "does anything write this?", which the
  // Village's dangling @deck.well_vision failed. It has a blind spot exactly
  // one step wide: a ref written only by cards that were THEMSELVES never
  // dealt is just as unreachable, and reads as perfectly wired.
  //
  // The author found the blind spot by playing: "Sell the Legend" never came
  // up in a 200-run sweep, and the report said nothing, because its gate reads
  // `+traders_arrived` and something does write that flag. What nothing said
  // was that the only writer is "Expose the Conspiracy", which never came up
  // either - and whose OWN condition is unsatisfiable. Two silent cards, one
  // cause, and no arrow between them.
  //
  // So: for a never-dealt card, name the refs whose every writer was also
  // never dealt. It is a hop, not a proof - it says where to look next, which
  // is what turns two mysteries into one. The root cause itself wants the
  // static reachability check (design/reachability.md), not a play sweep.
  const neverDealt = (id: string): boolean => (s.dealt.get(id) ?? 0) === 0;
  const writtenOnlyByDeadCards = (ref: string): boolean => {
    const writers = analysis.writtenBy.get(ref);
    if (writers === undefined || writers.size === 0) return false;   // the first net owns this
    return [...writers].every(neverDealt);
  };

  const cards: CardCoverage[] = s.allCards.map(({ card, deck, box }) => {
    const cardReads = [...(analysis.cardRefs.get(card.id) ?? [])];
    const refs = cardReads.filter(unwritten).sort();
    // ...and the same list one hop out, minus anything the first net already
    // names, so a ref is reported once and for the sharper reason.
    const deadRefs = cardReads.filter((r) => !unwritten(r) && writtenOnlyByDeadCards(r)).sort()
      // A flag key implies its property, so reporting both says the same
      // thing twice and the vaguer half reads as a second problem.
      .filter((r, _i, all) => r.includes(":") || !all.some((o) => o.startsWith(`${r}:`)));
    const cardDealtRuns = s.dealtRuns.get(card.id) ?? 0;
    return {
      id: card.id,
      gameId: effectiveGameId(card),
      ...(card.title !== undefined ? { title: card.title } : {}),
      deck: deck.id,
      deckName: deck.title ?? effectiveGameId(deck),
      box: box.id,
      boxName: box.title ?? effectiveGameId(box),
      dealt: s.dealt.get(card.id) ?? 0,
      played: s.played.get(card.id) ?? 0,
      dealtRuns: cardDealtRuns,
      playedRuns: s.playedRuns.get(card.id) ?? 0,
      rare: rarelyDealt(cardDealtRuns, s.runsDone),
      ...(neverDealt(card.id) && refs.length > 0 ? { unwrittenRefs: refs } : {}),
      ...(neverDealt(card.id) && deadRefs.length > 0
        ? { refsWrittenOnlyByNeverDealtCards: deadRefs.map((ref) => ({
            ref,
            by: [...analysis.writtenBy.get(ref)!].sort(),
          })) }
        : {}),
    };
  });
  const playable = new Set(s.allCards.filter((e) => e.card.outcomes.length > 0).map((e) => e.card.id));
  const cardsDealt = cards.filter((c) => c.dealtRuns > 0).length;

  return {
    // The runs actually completed, not the runs asked for: a cancelled sweep
    // must not claim a sample size it never took.
    runs: s.runsDone, seed: s.seed, maxTurns: s.maxTurns, ...(s.turnSeconds !== undefined ? { turnSeconds: s.turnSeconds } : {}),
    drivers: s.drivenRefs, turns: s.totalTurns, plays: s.totalPlays, terminations: s.terminations,
    cards,
    totals: {
      cards: cards.length,
      dealt: cardsDealt,
      neverDealt: cards.length - cardsDealt,
      rare: cards.filter((c) => c.rare).length,
      dealtNeverPlayed: cards.filter((c) => c.dealtRuns > 0 && c.playedRuns === 0 && playable.has(c.id)).length,
    },
    rareThresholdPct: RARE_DEALT_PCT,
    outcomes: s.allCards.flatMap(({ card }) => card.outcomes.map((o) => ({
      id: o.id, gameId: effectiveGameId(o), card: card.id, played: s.outcomePlayed.get(o.id) ?? 0,
    }))),
    hands: bundle.boxes.flatMap((box) => {
      // Out of what could come up HERE, not out of the whole box. Measured
      // against the box, a hand in the Village read "6/86": a near-empty bar
      // over what was complete coverage, because most of the 86 are pinned to
      // other hands (the author, 2026-09-29). A short bar is now a real gap.
      const reach = handReach(bundle, box);
      const boxCards = box.decks.flatMap((d) => d.cards);
      return box.hands.map((hand) => {
        const dealtSet = s.handCards.get(hand.id) ?? new Set<string>();
        const possible = boxCards.filter((c) => reach.admits(c, hand)).map((c) => c.id).sort();
        return {
          id: hand.id,
          gameId: effectiveGameId(hand),
          ...(hand.title !== undefined ? { title: hand.title } : {}),
          box: box.id,
          boxName: box.title ?? effectiveGameId(box),
          deals: s.handDeals.get(hand.id) ?? 0,
          cardsPossible: possible,
          cardsDealt: [...dealtSet].sort(),
          cardsNeverDealt: possible.filter((id) => !dealtSet.has(id)),
        };
      });
    }),
    unwrittenInputs,
    unprovidedHandRefs: findUnprovidedHandRefs(bundle),
    diagnostics: [...s.diagCounts.values()].sort((a, b) => b.runs - a.runs || a.where.localeCompare(b.where)),
    // Present only when asked for, so a report with no key and a report with an
    // empty array say different things: "not measured" and "nothing opened".
    ...(s.opts.observeEdges
      ? { observedEdges: [...s.edgeCounts.values()].sort((a, b) =>
          b.runs - a.runs || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)) }
      : {}),
    issues: s.issues,
  };
}

/** The sweep itself, as a generator that yields the count of completed runs.
 *  Two drivers share it: runCoverage (drain it, stay synchronous - the CLI and
 *  the tests) and runCoverageAsync (await between runs, so a host can paint a
 *  progress bar and hear a Cancel). One body, so the two can never drift. */
function* sweep(source: SourceProject, opts: CoverageOptions = {}): Generator<number, CoverageReport, void> {
  const state = setUp(source, opts);
  if ("done" in state) return state.done;
  for (let run = 0; run < state.runs; run++) {
    if (opts.shouldStop?.()) break;
    runOnce(state);
    state.runsDone++;
    yield state.runsDone;
  }
  return report(state);
}

/** Run the whole sweep synchronously (the CLI, the tests, any caller that can
 *  afford to block). */
export function runCoverage(source: SourceProject, opts: CoverageOptions = {}): CoverageReport {
  const runner = sweep(source, opts);
  let step = runner.next();
  while (!step.done) step = runner.next();
  return step.value;
}

/** Run the sweep with a breath between runs, so a host stays responsive.
 *  `onRun` is awaited after each run: report progress there, and flip whatever
 *  `shouldStop` reads to cancel. The report describes the runs completed. */
export async function runCoverageAsync(
  source: SourceProject,
  opts: CoverageOptions & { onRun?: (done: number, total: number) => Promise<void> } = {},
): Promise<CoverageReport> {
  const total = opts.runs ?? 200;
  const runner = sweep(source, opts);
  let step = runner.next();
  while (!step.done) {
    await opts.onRun?.(step.value, total);
    step = runner.next();
  }
  return step.value;
}

// --- proposal ---------------------------------------------------------------------

/** Auto-propose a coverage block from the conditions: @world literal pools
 *  (plus declared boolean/enum domains), skipping refs an outcome writes. */
const sortValues = (values: ScalarValue[]): ScalarValue[] =>
  [...values].sort((a, b) =>
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));

export function proposeCoverage(source: SourceProject): { coverage: CoverageConfig; issues: Issue[] } {
  const { bundle, issues } = compileProject(source);
  if (!bundle) return { coverage: {}, issues };
  const analysis = analyse(bundle);

  const declByName = new Map(worldDeclarations(source).map((d) => [d.name, d]));
  const drivers: Record<string, CoverageDriver> = {};
  for (const ref of [...analysis.allRefs].sort()) {
    if (!ref.startsWith("@world.") || analysis.written.has(ref)) continue;
    const decl = declByName.get(ref.slice("@world.".length));
    if (!decl) continue;   // undeclared refs are validate's problem
    let values = [...(analysis.pools.get(ref) ?? [])];
    if (values.length === 0) {
      if (decl.type === "boolean") values = [true, false];
      else if (decl.type === "enum" && decl.values) values = [...decl.values];
    }
    if (values.length === 0) continue;
    drivers[ref] = { kind: "recurring", cadence: "sometimes", values: sortValues(values) };
  }

  return {
    coverage: {
      ...(Object.keys(drivers).length > 0 ? { drivers } : {}),
    },
    issues,
  };
}
