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
// seeded runs", never a proof of unreachability. v0 analyses @world and
// @story refs for the unwritten-inputs net; @hand refs (deal-composed) are
// not analysed yet.
// ---------------------------------------------------------------------------

import { compileProject } from "@storylet-studio/compiler";
import type { Issue, SourceProject } from "@storylet-studio/compiler";
import { Engine, makePrng } from "@storylet-studio/runtime";
import type { Flow } from "@storylet-studio/runtime";
import { PLACE_GROUP, effectiveGameId } from "@storylet-studio/model";
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
   *  deliberately: it costs two eligibility probes per play, and the ordinary
   *  sweep answers "what is never dealt", which needs none of it. */
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
  /** The owning box, so a reader can jump straight to the card. */
  box: string;
  /** Times the card appeared in any hand. */
  dealt: number;
  /** Times an outcome of it was played. */
  played: number;
  /** Refs in its condition that no outcome writes and no driver drives -
   *  only reported on never-dealt cards (the honesty net). */
  unwrittenRefs?: string[];
  /** The honesty net's second hop: refs in its condition that ARE written, but
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
  /** The owning box, so a reader can jump straight to the hand. */
  box: string;
  /** Total deals into this hand across all runs. */
  deals: number;
  /** Distinct cards the hand held at least once. */
  cardsDealt: string[];
  /** Cards in the hand's box it never held (the per-hand gap list). */
  cardsNeverDealt: string[];
}

/** The composed-name net's finding: a `@hand.<name>` read where some hand
 *  that can legitimately ask it never composes the name - so evaluation
 *  faults there and the card (or its whole deck) silently never deals from
 *  that hand. Static: found without running anything. */
export interface UnprovidedHandRef {
  /** Where the ref is read: "card <gameId>" or "deck <gameId> gate". */
  where: string;
  ref: string;
  /** The asking hands that never compose the name, as gameIds. */
  hands: string[];
}

/** A diagnostic the runtime emitted during the seeded runs, deduplicated. */
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
  plays: number;
  terminations: Record<"exhausted" | "maxTurns" | "stuck", number>;
  cards: CardCoverage[];
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

/** Walk an AST for `@scope.name` refs and the literals they compare against. */
/** `@story.world_events:traders_arrived` - one FLAG, not the property that
 *  holds it. A flags property is a bag of independent latches, and the
 *  honesty net's second hop is useless at property granularity: half the
 *  Village writes `@story.world_events`, so "is it written?" is always yes
 *  while the flag a card actually reads may be written by nothing that ever
 *  happens. deadstate.ts draws the same distinction, for the same reason. */
const flagKey = (ref: string, flag: string): string => `${ref}:${flag}`;

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
  /** Refs each card's condition reads, by card id. */
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
      conditionRefs(deck.condition);
      for (const card of deck.cards) {
        const refs = new Set<string>();
        conditionRefs(card.condition, refs);
        if (typeof card.priority !== "number") conditionRefs(card.priority);
        cardRefs.set(card.id, refs);
        for (const outcome of card.outcomes) {
          conditionRefs(outcome.condition, refs);
          for (const [target, expr] of Object.entries(outcome.changes)) {
            written.add(target);
            const notes = (key: string): void => {
              let by = writtenBy.get(key);
              if (by === undefined) { by = new Set<string>(); writtenBy.set(key, by); }
              by.add(card.id);
            };
            notes(target);
            // `@x = set_flags(@x, +a, +b)`: this card writes flags a and b of x.
            const ast = expr.ast;
            if (Array.isArray(ast) && ast[0] === "call" && ast[1] === "set_flags") {
              for (const arg of ast.slice(3)) {
                if (Array.isArray(arg) && arg[0] === "fd" && arg[1] === "+") notes(flagKey(target, String(arg[2])));
              }
            }
            conditionRefs(expr);
          }
        }
      }
    }
  }
  return { cardRefs, allRefs, written, writtenBy, pools };
}

// --- the composed-name net (static) --------------------------------------------
// The class the Board's peek false alarm pointed at (design/board-legibility.md):
// a card reading @hand.X that some hand which can legitimately ask it never
// composes. Mirrors the runtime's ask composition (schema 2.6/3.6): a hand
// composes its template's (or its own) properties, the flattened properties of
// every tag it binds, the NAMES of groups it chooses or rule-binds (askNames -
// a fixed template binding does not name its group), and whatever a boundBy
// group may bind at ask time (counted as composed, conservatively). A card's
// asking hands are those whose bound tags its own tags admit (tag matching
// runs before condition evaluation); a deck gate evaluates for EVERY ask of
// the box, so its refs must be composed by every hand.

const handRefsOf = (expr: Expression | undefined): string[] => {
  if (!expr) return [];
  const refs = new Set<string>();
  scanAst(expr.ast, refs);
  return [...refs].filter((r) => r.startsWith("@hand."));
};

function findUnprovidedHandRefs(bundle: Bundle): UnprovidedHandRef[] {
  const out: UnprovidedHandRef[] = [];
  for (const box of bundle.boxes) {
    const groupsById = new Map(box.tagGroups.map((g) => [g.id, g]));
    const required = new Set(box.tagGroups.filter((g) => g.required === true).map((g) => g.id));
    const templatesById = new Map(box.handTemplates.map((t) => [t.id, t]));

    const composed = new Map<string, Set<string>>();
    const bindings = new Map<string, Map<string, string>>();
    for (const hand of box.hands) {
      const names = new Set<string>();
      const bind = new Map<string, string>();
      const template = hand.template !== undefined ? templatesById.get(hand.template) : undefined;
      for (const decl of template?.properties ?? hand.properties ?? []) names.add(decl.name);
      const bindTag = (groupId: string, tagId: string, named: boolean): void => {
        bind.set(groupId, tagId);
        const group = groupsById.get(groupId);
        for (const decl of group?.tags.find((t) => t.id === tagId)?.properties ?? []) names.add(decl.name);
        if (named && group) names.add(effectiveGameId(group));
      };
      for (const [g, t] of Object.entries(template?.bindings ?? {})) bindTag(g, t, false);
      for (const [g, t] of Object.entries(hand.rule?.bindings ?? {})) bindTag(g, t, true);
      for (const [g, t] of Object.entries(hand.chosen ?? {})) bindTag(g, t, true);
      for (const group of box.tagGroups) {
        if (group.boundBy === undefined || bind.has(group.id)) continue;
        names.add(effectiveGameId(group));
        for (const tag of group.tags) for (const decl of tag.properties ?? []) names.add(decl.name);
      }
      composed.set(hand.id, names);
      bindings.set(hand.id, bind);
    }

    const admits = (card: Card<Expression> | undefined, hand: Hand<Expression>): boolean => {
      if (card === undefined) return true;   // a deck gate: every hand asks
      const home = card.tags?.[PLACE_GROUP];
      if (home !== undefined && home.length > 0 && !home.includes(hand.id)) return false;
      for (const [groupId, tagId] of bindings.get(hand.id)!) {
        const tags = card.tags?.[groupId];
        if (tags === undefined) { if (required.has(groupId)) return false; continue; }
        if (!tags.includes(tagId)) return false;
      }
      return true;
    };

    const check = (where: string, refs: string[], card: Card<Expression> | undefined): void => {
      for (const ref of refs) {
        const name = ref.slice("@hand.".length);
        const missing = box.hands
          .filter((hand) => admits(card, hand) && !composed.get(hand.id)!.has(name))
          .map((hand) => effectiveGameId(hand))
          .sort();
        if (missing.length > 0) out.push({ where, ref, hands: missing });
      }
    };

    for (const deck of box.decks) {
      check(`deck ${effectiveGameId(deck)} gate`, handRefsOf(deck.condition), undefined);
      for (const card of deck.cards) {
        const refs = new Set<string>(handRefsOf(card.condition));
        if (typeof card.priority !== "number") for (const r of handRefsOf(card.priority)) refs.add(r);
        for (const outcome of card.outcomes) {
          for (const r of handRefsOf(outcome.condition)) refs.add(r);
          for (const expr of Object.values(outcome.changes)) for (const r of handRefsOf(expr)) refs.add(r);
        }
        check(`card ${effectiveGameId(card)}`, [...refs].sort(), card);
      }
    }
  }
  return out.sort((a, b) => a.where.localeCompare(b.where) || a.ref.localeCompare(b.ref));
}

// --- the harness -------------------------------------------------------------------

/** The sweep itself, as a generator that yields the count of completed runs.
 *  Two drivers share it: runCoverage (drain it, stay synchronous - the CLI and
 *  the tests) and runCoverageAsync (await between runs, so a host can paint a
 *  progress bar and hear a Cancel). One body, so the two can never drift. */
function* sweep(source: SourceProject, opts: CoverageOptions = {}): Generator<number, CoverageReport, void> {
  const { bundle, issues } = compileProject(source);
  const runs = opts.runs ?? 200;
  const maxTurns = opts.maxTurns ?? 100;
  const seed = opts.seed ?? 0;
  const coverage = opts.coverage ?? source.project.coverage ?? {};
  const drivers = Object.entries(coverage.drivers ?? {});
  const drivenRefs = drivers.map(([ref]) => ref).sort();

  const empty: CoverageReport = {
    runs: 0, seed, maxTurns, drivers: drivenRefs, turns: 0, plays: 0,
    terminations: { exhausted: 0, maxTurns: 0, stuck: 0 },
    cards: [], outcomes: [], hands: [], unwrittenInputs: [], unprovidedHandRefs: [], diagnostics: [], issues,
  };
  if (!bundle) return empty;

  // The sweep's turns read as time only when the whole project agrees: every
  // box timed, on one unit (design/engine-server.md 4.8). A project that mixes
  // a timed box with an untimed one has no single answer to "how long was that
  // run", so the report says turns and stops there.
  const units = new Set(bundle.boxes.map((b) => b.turn?.seconds));
  const turnSeconds = units.size === 1 && !units.has(undefined)
    ? [...units][0] as number : undefined;
  // A timed box has no clock of its own: whoever runs the engine ticks it, and
  // during a sweep that is the harness. One sweep turn is one tick, which is
  // what makes a cooldown in a timed box expire in a run at all.
  const timedBoxes = bundle.boxes.filter((b) => b.turn !== undefined);


  const analysis = analyse(bundle);

  const prng = makePrng(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(prng.next() * arr.length)]!;

  // Tallies.
  const dealt = new Map<string, number>();
  const played = new Map<string, number>();
  const outcomePlayed = new Map<string, number>();
  const handDeals = new Map<string, number>();
  const handCards = new Map<string, Set<string>>();
  const terminations = { exhausted: 0, maxTurns: 0, stuck: 0 };
  let totalTurns = 0;
  let totalPlays = 0;

  const allCards: { card: Card<Expression>; deck: Deck<Expression>; box: Box<Expression> }[] =
    bundle.boxes.flatMap((box) => box.decks.flatMap((deck) => deck.cards.map((card) => ({ card, deck, box }))));
  // One-shots the exhaustion test waits to see PLAYED: only cards that can
  // be. A dealt-only card (no outcomes - the news/codex pattern, where dealt
  // is the card's whole job) must not hold every run at the turn cap waiting
  // for a play that cannot exist.
  const neverRedraw = new Set(allCards
    .filter((e) => e.card.redraw === "never" && e.card.outcomes.length > 0)
    .map((e) => e.card.id));
  const handsByGameId = new Map(bundle.boxes.flatMap((box) => box.hands.map((h) => [effectiveGameId(h), h])));

  const tallyDeal = (cardId: string, handId: string): void => {
    dealt.set(cardId, (dealt.get(cardId) ?? 0) + 1);
    handDeals.set(handId, (handDeals.get(handId) ?? 0) + 1);
    (handCards.get(handId) ?? handCards.set(handId, new Set()).get(handId)!).add(cardId);
  };

  const applyDriver = (session: Flow, ref: string, driver: CoverageDriver): void => {
    if (driver.values.length === 0) return;
    session.setProperty(ref.slice(1), pick(driver.values));   // "@world.x" -> "world.x"
  };

  // Runtime warnings, deduplicated by (where, message), counted by run.
  const diagCounts = new Map<string, { where: string; message: string; runs: number }>();

  // Observed edges (design/graphical-views.md 4), when asked for. Keyed
  // "from\0outcome\0to"; `runs` counts runs that saw it at least once, which
  // is the number the overlay quotes, so each run contributes at most one.
  const edgeCounts = new Map<string, { from: string; outcome: string; to: string; runs: number; count: number }>();
  const boxRefs = bundle.boxes.map((b) => effectiveGameId(b));
  /** Every card a generic ask would find available right now, across all boxes.
   *  A peek looks without claiming (the look/use rule), so probing costs the
   *  run nothing but time - which is why this is opt-in. */
  const eligibleNow = (session: Flow): Set<string> => {
    const out = new Set<string>();
    for (const ref of boxRefs) {
      try { for (const card of session.peek(ref).cards) out.add(card.id); }
      catch { /* a box with no askable hands: nothing to see */ }
    }
    return out;
  };

  let runsDone = 0;
  for (let run = 0; run < runs; run++) {
    if (opts.shouldStop?.()) break;
    // The engine's own seed derives from the harness PRNG: one seed, whole
    // run reproducible.
    const session = new Engine(bundle, { seed: Math.floor(prng.next() * 0x100000000) }).openFlow("main");
    // Subscribing turns the trace on; the diagnostics it surfaces (a faulting
    // condition, an undeclared name) used to be swallowed by the sweep.
    const runDiags = new Set<string>();
    // Edges already counted for THIS run, so `runs` counts runs not sightings.
    const runEdges = new Set<string>();
    // What THIS run has seen, for the exhaustion test above.
    const runDealt = new Set<string>();
    const runPlayed = new Set<string>();
    const unsubscribe = session.subscribeTrace((e) => {
      if (e.type === "diagnostic") runDiags.add(`${e.where}\u0000${e.message}`);
    });
    for (const [ref, driver] of drivers) {
      if (driver.kind === "initial") applyDriver(session, ref, driver);
    }

    let emptyTurns = 0;
    let turn = 0;
    for (; turn < maxTurns; turn++) {
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
        const hand = handsByGameId.get(handGameId);
        for (const card of cards) {
          candidates.push({ cardId: card.id, from: handGameId });
          runDealt.add(card.id);
          if (hand) tallyDeal(card.id, hand.id);
        }
      }

      if (candidates.length === 0) {
        if (++emptyTurns >= MAX_EMPTY_TURNS) break;
        for (const box of bundle.boxes) session.advanceTurns(box.id, 1);
        totalTurns++;
        continue;
      }
      emptyTurns = 0;

      const choice = pick(candidates);
      const available = session.outcomes(choice.cardId, choice.from).filter((o) => o.available);
      if (available.length === 0) {
        // Dealt but nothing playable: the clocks still move.
        for (const box of bundle.boxes) session.advanceTurns(box.id, 1);
        totalTurns++;
        continue;
      }
      const outcome = pick(available);
      // Immediately before and immediately after, so what is attributed to this
      // play is what THIS play changed. Measured between deals, because a deal
      // claims cards and would read as the play having closed them.
      const before = opts.observeEdges ? eligibleNow(session) : undefined;
      session.play(choice.cardId, outcome.gameId, choice.from);
      // The tick a timed box's plays no longer do, done by the harness, which
      // is this sweep's host: before the "after" reading, so the clock has
      // moved by the time eligibility is measured, exactly as it has already
      // moved in an untimed box.
      for (const box of timedBoxes) session.advanceTurns(box.id, 1);
      if (before) {
        for (const id of eligibleNow(session)) {
          // The played card returns to the pool as it leaves the hand: that is
          // the claim releasing, not the play opening anything.
          if (id === choice.cardId || before.has(id)) continue;
          const key = `${choice.cardId}\u0000${outcome.id}\u0000${id}`;
          const found = edgeCounts.get(key);
          if (found) { found.count++; if (!runEdges.has(key)) found.runs++; }
          else edgeCounts.set(key, { from: choice.cardId, outcome: outcome.id, to: id, runs: 1, count: 1 });
          runEdges.add(key);
        }
      }
      runPlayed.add(choice.cardId);
      played.set(choice.cardId, (played.get(choice.cardId) ?? 0) + 1);
      outcomePlayed.set(outcome.id, (outcomePlayed.get(outcome.id) ?? 0) + 1);
      totalPlays++;
      totalTurns++;

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
      const exhausted = allCards.every((e) => runDealt.has(e.card.id))
        && [...neverRedraw].every((id) => runPlayed.has(id));
      if (exhausted) break;
    }
    if (turn >= maxTurns) terminations.maxTurns++;
    else if (emptyTurns >= MAX_EMPTY_TURNS) terminations.stuck++;
    else terminations.exhausted++;
    unsubscribe();
    for (const key of runDiags) {
      const found = diagCounts.get(key);
      if (found) found.runs++;
      else {
        const cut = key.indexOf("\u0000");
        diagCounts.set(key, { where: key.slice(0, cut), message: key.slice(cut + 1), runs: 1 });
      }
    }
    runsDone++;
    yield runsDone;
  }

  // The honesty net: refs read by never-dealt cards that nothing writes and
  // nothing drives. An @hand name counts as driven when it is a tag group's
  // gameId (chosen tags / criteria vary across hands, schema 3.6); as
  // written when some outcome targets "@hand.<name>" (write-back, 3.6).
  const driven = new Set(Object.keys(coverage.drivers ?? {}));
  // Only tag GROUP names clear the flag: chosen tags / criteria vary across
  // hands, while a tag or hand property's default never varies unless some
  // outcome writes it (then `written` clears it) or a driver drives it.
  const composedNames = new Set<string>(
    bundle.boxes.flatMap((b) => b.tagGroups.map((g) => effectiveGameId(g))));
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
  const neverDealt = (id: string): boolean => (dealt.get(id) ?? 0) === 0;
  const writtenOnlyByDeadCards = (ref: string): boolean => {
    const writers = analysis.writtenBy.get(ref);
    if (writers === undefined || writers.size === 0) return false;   // the first net owns this
    return [...writers].every(neverDealt);
  };

  return {
    // The runs actually completed, not the runs asked for: a cancelled sweep
    // must not claim a sample size it never took.
    runs: runsDone, seed, maxTurns, ...(turnSeconds !== undefined ? { turnSeconds } : {}),
    drivers: drivenRefs, turns: totalTurns, plays: totalPlays, terminations,
    cards: allCards.map(({ card, deck, box }) => {
      const cardReads = [...(analysis.cardRefs.get(card.id) ?? [])];
      const refs = cardReads.filter(unwritten).sort();
      // ...and the same list one hop out, minus anything the first net already
      // names, so a ref is reported once and for the sharper reason.
      const deadRefs = cardReads.filter((r) => !unwritten(r) && writtenOnlyByDeadCards(r)).sort()
        // A flag key implies its property, so reporting both says the same
        // thing twice and the vaguer half reads as a second problem.
        .filter((r, _i, all) => r.includes(":") || !all.some((o) => o.startsWith(`${r}:`)));
      return {
        id: card.id,
        gameId: effectiveGameId(card),
        ...(card.title !== undefined ? { title: card.title } : {}),
        deck: deck.id,
        box: box.id,
        dealt: dealt.get(card.id) ?? 0,
        played: played.get(card.id) ?? 0,
        ...(neverDealt(card.id) && refs.length > 0 ? { unwrittenRefs: refs } : {}),
        ...(neverDealt(card.id) && deadRefs.length > 0
          ? { refsWrittenOnlyByNeverDealtCards: deadRefs.map((ref) => ({
              ref,
              by: [...analysis.writtenBy.get(ref)!].sort(),
            })) }
          : {}),
      };
    }),
    outcomes: allCards.flatMap(({ card }) => card.outcomes.map((o) => ({
      id: o.id, gameId: effectiveGameId(o), card: card.id, played: outcomePlayed.get(o.id) ?? 0,
    }))),
    hands: bundle.boxes.flatMap((box) => box.hands.map((hand) => {
      const dealtSet = handCards.get(hand.id) ?? new Set<string>();
      const boxCards = box.decks.flatMap((d) => d.cards.map((c) => c.id));
      return {
        id: hand.id,
        gameId: effectiveGameId(hand),
        box: box.id,
        deals: handDeals.get(hand.id) ?? 0,
        cardsDealt: [...dealtSet].sort(),
        cardsNeverDealt: boxCards.filter((id) => !dealtSet.has(id)).sort(),
      };
    })),
    unwrittenInputs,
    unprovidedHandRefs: findUnprovidedHandRefs(bundle),
    diagnostics: [...diagCounts.values()].sort((a, b) => b.runs - a.runs || a.where.localeCompare(b.where)),
    // Present only when asked for, so a report with no key and a report with an
    // empty array say different things: "not measured" and "nothing opened".
    ...(opts.observeEdges
      ? { observedEdges: [...edgeCounts.values()].sort((a, b) =>
          b.runs - a.runs || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)) }
      : {}),
    issues,
  };
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

  const declByName = new Map((source.project.world?.properties ?? []).map((d) => [d.name, d]));
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
