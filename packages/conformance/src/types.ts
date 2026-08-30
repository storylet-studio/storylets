// ---------------------------------------------------------------------------
// Conformance corpus types (design/conformance.md - the parity contract).
//
// The corpus is a language-agnostic JSON document. Four case kinds:
//   - expressions: compiled `ast` + `scopes` (+ optional PRNG `seed`) ->
//     `expected` scalar or `expectError`.
//   - specificity: compiled `ast` + `scopes` -> integer matched-constraint
//     score at root polarity want = true.
//   - peek: a compiled `bundle` + one peek (box + raw tag criteria) -> the
//     ordered top of the stock. A peek registers nothing; peek cases also
//     pin that (the runner peeks twice and expects identity).
//   - scripted: a compiled `bundle` + ops (deals, plays, turns, save/load).
//
// Cases carry COMPILED artifacts (ast / bundle), so a runtime-only port
// consumes the corpus without a parser or compiler. Fixture (source) forms
// are kept only for readability + corpus regeneration.
// ---------------------------------------------------------------------------

import type { AstNode, ScalarValue } from "@wildwinter/expr";
import type { Bundle, PropertyDecl, RedrawPolicy } from "@storylet-studio/model";

export type ScopeBag = Record<string, ScalarValue>;

/** Direct store writes/reads for setup and setState: story/world are single
 *  bags; box/deck/hand/value are keyed by immutable id. */
export interface StateSelector {
  story?: ScopeBag;
  world?: ScopeBag;
  box?: Record<string, ScopeBag>;
  deck?: Record<string, ScopeBag>;
  hand?: Record<string, ScopeBag>;
  value?: Record<string, ScopeBag>;
}

/** A compiled expression case. `src` is informational; ports evaluate `ast`. */
export interface ExpressionCase {
  name: string;
  src: string;
  ast: AstNode;
  scopes: Record<string, ScopeBag>;
  /** Seeds the PRNG behind random(); omit when deterministic. */
  seed?: number;
  expected?: ScalarValue;
  /** Evaluation must raise an eval error (mutually exclusive with expected). */
  expectError?: true;
}

/** A compiled matched-constraint specificity case (schema 3.2), scored at
 *  root polarity want = true with the shared scorer. */
export interface SpecificityCase {
  name: string;
  src: string;
  ast: AstNode;
  scopes: Record<string, ScopeBag>;
  expected: number;
}

/** One peek end to end (design/conformance.md 4.3): the top of the stock
 *  through raw tag criteria. The runner peeks TWICE and requires identical
 *  results (a peek registers nothing; asking twice is free - schema 3.5). */
export interface PeekCase {
  name: string;
  bundle: Bundle;
  /** Session seed; defaults to 0. */
  seed?: number;
  setup?: StateSelector;
  /** Box gameId (the session API surface speaks gameIds). */
  box: string;
  /** Tag group gameId -> tag gameId (place -> hand gameId). */
  criteria?: Record<string, string>;
  /** Peek cap. */
  n?: number;
  /** The ranked list: card ids, IN ORDER. */
  expect: string[];
}

/** Why a card was not dealt, as the deal/peek trace reports it. A closed
 *  vocabulary: it is what every examiner's "Not listed - why" switches on, so
 *  a runtime inventing its own spelling is a divergence a board read cannot
 *  see. `claimed-elsewhere` and `taken` are the shared-scarcity pair
 *  (design/shared-scarcity.md 9.3.1): without them a participant is told
 *  "claimed" or "cooldown" about a card they have never seen, which reads as
 *  an engine bug. */
export type TraceVerdictKind =
  | "dealt"
  | "capped"
  | "cooldown"
  | "deck-gate"
  | "tags"
  | "condition"
  | "priority"
  | "claimed"
  | "claimed-elsewhere"
  | "taken";

/** Every play op runs on a named flow (design/flows.md); `flow` defaults to
 *  "main", which the runner opens lazily on first use - so a single-flow
 *  script reads exactly as it always did, and a case that never says "flow"
 *  pins single-flow behaviour unchanged. */
export type ScriptOp =
  | ({ op: "setState"; flow?: string } & StateSelector)
  /** `expectError` pins the asks that must be REFUSED - notably a tag group
   *  gameId that belongs to another box (group gameIds are box-scoped, so
   *  box-scoping must be a real scope, never a bundle-wide fallback), and
   *  every verb on a CLOSED flow (the inert-handle rule). */
  | { op: "peek"; flow?: string; box?: string; criteria?: Record<string, string>; n?: number; expect?: string[]; expectError?: true; expectVerdicts?: Record<string, TraceVerdictKind> }
  /** `expectVerdicts` pins WHY a card was refused, keyed by card id, against
   *  the deal's own trace. The reason matters as much as the outcome once
   *  flows share cards: "claimed" and "claimed-elsewhere" look identical on a
   *  board read and mean quite different things to whoever is debugging.
   *
   *  Refresh hands (all when omitted). expectBoard is keyed by hand ID and
   *  read from board(); expectDealt is asserted against dealMany's RETURN,
   *  which holds exactly the hands this call dealt (the dealt slice) - its
   *  key set must match, so an extra or missing hand in the return fails. */
  | { op: "deal"; flow?: string; hands?: string[]; expectBoard?: Record<string, string[]>; expectDealt?: Record<string, string[]>; expectVerdicts?: Record<string, TraceVerdictKind> }
  /** Read the board and check it WHOLE: `expect` is keyed by hand ID and its
   *  key set must MATCH, not merely be included - that is what pins the
   *  filter. `box` (a box gameId or id) narrows the read to one box's hands;
   *  omitted, it is the whole-board read. `expectError` pins the reads that
   *  must be refused (an unknown box). */
  | { op: "assertBoard"; flow?: string; box?: string; expect?: Record<string, string[]>; expectError?: true }
  /** `from` is the hand the card sits in: you never play a card from inside
   *  the deck (schema 3.1). */
  | { op: "play"; flow?: string; card: string; outcome: string; from: string; advanceTurns?: number; expectError?: true }
  /** Each box has its own clock (schema 3.4), PER FLOW; `box` is the box id. */
  | { op: "advanceTurns"; flow?: string; box: string; n: number }
  | { op: "assertOutcomes"; flow?: string; card: string; from: string; expect: Record<string, boolean> }
  /** The ORDER `outcomes()` hands them back in, exactly. Separate from
   *  `assertOutcomes`, which is a map and so says nothing about sequence. */
  | { op: "assertOutcomeOrder"; flow?: string; card: string; from: string; expect: string[] }
  /** Paths: "turn.b_x", "story.gold", "value.v_docks.danger", "box.b_x.heat",
   *  "world.x", ... - read on the op's flow (the merged view). */
  | { op: "assertState"; flow?: string; expect: Record<string, ScalarValue> }
  /** Open (or REPLACE - re-opening an existing name resets its per-flow
   *  state, shared state untouched) a named flow. `seed` overrides the
   *  engine's default for this flow's PRNG. */
  | { op: "openFlow"; flow: string; seed?: number }
  /** Close a named flow: its handle goes INERT - every later verb on that
   *  flow (an op naming it) must error. */
  | { op: "closeFlow"; flow: string }
  /** The engine's live flows, IN ORDER, by id.
   *
   *  Order is a contract, not an implementation detail: `saveGame` keys its
   *  flows in this order, so two runtimes that disagree write different
   *  `.storyletsave` bytes for the same run. Added 2026-08-29 because they
   *  did - re-opening an existing name moved it to the END in the JS
   *  reference and kept its slot on all three ports. */
  | { op: "assertFlows"; expect: string[] }
  /** Engine-level read: "world.x" and shared refs answer; a ref that
   *  resolves per-flow must THROW (the teaching rule - never silently
   *  answer with some flow's copy). */
  | { op: "assertEngineRead"; path: string; expect?: ScalarValue; expectError?: true }
  /** Serialise the WHOLE engine (shared partitions + every flow, and NOT
   *  @world), discard it, restore into a fresh one - built from `bundleB`
   *  when `into: "B"` (the drifted-content contract: orphaned state drops
   *  harmlessly, never a crash). Every flow is rebuilt. */
  | { op: "saveLoad"; into?: "B" }
  | { op: "reset" };

export interface ScriptedCase {
  name: string;
  bundle: Bundle;
  /** The EDITED bundle a `saveLoad into: "B"` restores into. */
  bundleB?: Bundle;
  /** Session seed; defaults to 0. */
  seed?: number;
  script: ScriptOp[];
}

export interface Corpus {
  version: number;
  expressions: ExpressionCase[];
  specificity: SpecificityCase[];
  peek: PeekCase[];
  scripted: ScriptedCase[];
}

// --- Authoring fixtures (source form, compiled into the corpus) -------------
//
// Fixtures share the scaffold of design/conformance.md section 5: one box
// `b_x`, deck `k_main`, tag group `d_zone` (tags `v_docks` with a `danger`
// property, `v_market`). Expressions are `src` strings; entity gameIds derive
// from ids by stripping the type prefix (c_ambush -> "ambush"). Fixtures
// speak group/tag gameIds; buildCorpus resolves them to ids for the bundle
// (place tags name hand ids directly). `otherBox` adds the second box the
// cross-box cases need.

export interface ExpressionFixture {
  name: string;
  src: string;
  scopes: Record<string, ScopeBag>;
  seed?: number;
  expected?: ScalarValue;
  expectError?: true;
}

export interface SpecificityFixture {
  name: string;
  src: string;
  scopes: Record<string, ScopeBag>;
  /** Hand-derived from the metric's rules, never from an engine. */
  expected: number;
}

export interface OutcomeFixture {
  id: string;
  condition?: string;
  changes?: Record<string, string>;
  /** Display order. The BUNDLE carries outcomes in this order, not id order:
   *  which option is offered first is authorial, and a game reading them off a
   *  dealt card is building the player's menu. Source shards are id-sorted for
   *  the merge; a bundle has no merge story. */
  order?: number;
}

export interface CardFixture {
  id: string;
  /** Author metadata; omitted from the compiled bundle when the fixture is
   *  `metadata: "stripped"`. */
  title?: string;
  condition?: string;
  /** Number, or an expression string. Default 0. */
  priority?: number | string;
  redraw?: RedrawPolicy;
  /** Tag group gameId -> tag gameIds (resolved to ids by buildCorpus;
   *  "place" entries name hand ids and pass through). */
  tags?: Record<string, string[]>;
  /** Copies on the board at once (schema 3.5); default 1. Always per flow. */
  copies?: number;
  /** Shared across flows (design/shared-scarcity.md); absent takes the deck's. */
  shared?: boolean;
  /** The world cap when shared; defaults to `copies`. */
  sharedCopies?: number;
  fields?: Record<string, ScalarValue>;
  outcomes?: OutcomeFixture[];
}

export interface DeckFixture {
  id: string;
  condition?: string;
  /** Every card in this pile is shared unless the card overrides it. */
  shared?: boolean;
  /** The @deck scope's declarations. */
  properties?: PropertyDecl[];
  cards: CardFixture[];
}

export interface TemplateFixture {
  id: string;
  /** Fixed bindings: tag group gameId -> tag gameId. */
  bindings?: Record<string, string>;
  /** Holes: tag group gameIds the instance fills. */
  chooses?: string[];
  condition?: string;
  slots?: number | "unbounded";
  properties?: PropertyDecl[];
}

export interface HandRuleFixture {
  /** Tag group gameId -> tag gameId. */
  bindings?: Record<string, string>;
  condition?: string;
  slots?: number | "unbounded";
}

export interface HandFixture {
  id: string;
  /** Template id (exactly one of template / rule). */
  template?: string;
  /** Hole fills: tag group gameId -> tag gameId. */
  chosen?: Record<string, string>;
  rule?: HandRuleFixture;
  slots?: number;
  properties?: PropertyDecl[];
}

/** The optional SECOND box `b_y` (gameId "other"), for the cases that need
 *  two boxes in one bundle. Its tag group `d_zone_y` deliberately carries the
 *  same gameId `"zone"` as `b_x`'s `d_zone`: group gameIds are unique within
 *  a box and boxes namespace them, so the same author-facing group name in
 *  two boxes is ordinary authoring, not a clash. It also carries
 *  `d_weather_y` ("weather"), a group `b_x` does NOT have, so a case can pin
 *  that box scoping is a real scope rather than a bundle-wide fallback. */
export interface OtherBoxFixture {
  /** The @box scope's declarations, for `b_y`. */
  properties?: PropertyDecl[];
  /** Shorthand: these cards go in `b_y`'s default deck `k_main_y`. */
  cards?: CardFixture[];
  /** Full deck list; overrides `cards`. */
  decks?: DeckFixture[];
  templates?: TemplateFixture[];
  hands?: HandFixture[];
  /** Box ranking override; default { specificity: true }. */
  ranking?: { specificity: boolean };
}

/** An extra tag group beyond the scaffold's `d_zone`, for the cases that pin
 *  state-bound and required groups (design/where-and-selectors.md Part B). */
export interface GroupFixture {
  id: string;
  gameId?: string;
  tags: { id: string; gameId?: string; properties?: PropertyDecl[] }[];
  /** A property reference whose value names a tag in this group by gameId. */
  boundBy?: string;
  /** Omitting this group makes a card unavailable wherever it is bound. */
  required?: boolean;
}

export interface BundleFixture {
  /** @story declarations. */
  story?: PropertyDecl[];
  /** @world declarations (engine-owned in fixtures). */
  world?: PropertyDecl[];
  /** The @box scope's declarations. */
  boxProperties?: PropertyDecl[];
  /** "stripped" builds a bundle with all titles/purposes omitted (schema 2.7). */
  metadata?: "full" | "stripped";
  settings?: { playAdvancesTurns?: number };
  /** Box ranking override; default { specificity: true }. */
  ranking?: { specificity: boolean };
  /** Shorthand: these cards go in the default deck `k_main`. */
  cards?: CardFixture[];
  /** Full deck list; overrides `cards`. */
  decks?: DeckFixture[];
  templates?: TemplateFixture[];
  hands?: HandFixture[];
  /** Extra tag groups beside the scaffold's `d_zone`. */
  groups?: GroupFixture[];
  /** A second box in the same bundle (see OtherBoxFixture). */
  otherBox?: OtherBoxFixture;
}

export interface PeekFixture extends BundleFixture {
  name: string;
  seed?: number;
  setup?: StateSelector;
  /** The box gameId to peek; defaults to `b_x`'s, "box". */
  box?: string;
  /** Tag group gameId -> tag gameId. */
  criteria?: Record<string, string>;
  n?: number;
  expect: string[];
}

export interface ScriptedFixture extends BundleFixture {
  name: string;
  /** The EDITED content compiled into `bundleB` for `saveLoad into: "B"`. */
  bundleB?: BundleFixture;
  seed?: number;
  script: ScriptOp[];
}

export interface Fixtures {
  expressions: ExpressionFixture[];
  specificity: SpecificityFixture[];
  peek: PeekFixture[];
  scripted: ScriptedFixture[];
}
