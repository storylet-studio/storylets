// ---------------------------------------------------------------------------
// The influence graph: which cards can turn which other cards on and off,
// derived from conditions and outcomes alone. No playthrough, no simulation.
//
// The foundation for the node canvas (a deck's subgraph, drawn) and the
// relationship view (one card's neighbourhood), per design/graphical-views.md.
// A pure function over a project, so the CLI prints it and CI could gate on it.
//
// Ported from the old system's `packages/connections` (design/graphical-views.md
// section 0), which had already done the expensive thinking: the four edge
// classes, polarity matching, parallel-edge aggregation, and warnings instead of
// failures. Adapted to round 2: cards not storylets, the five scopes, and no
// act/zone/site axes.
//
// WHAT IT DOES NOT DO, deliberately:
//   - `@hand` is composed per deal from tags, hand properties and the ask's
//     criteria, so two cards reading `@hand.danger` may or may not be talking
//     about the same hand. Statically we cannot say, so hand-scope reads and
//     writes raise a warning and produce NO edge. Conservative, and the same
//     stance coverage.ts already takes for its honesty net.
//   - Cross-scope analysis stays inside the requested scope: a deck-scoped
//     analysis draws edges among that deck's cards only. Whole-project
//     influence is what `{ kind: "all" }` and the card pivot are for.
// ---------------------------------------------------------------------------

import { compileProject } from "@storylet-studio/compiler";
import type { Issue, SourceProject } from "@storylet-studio/compiler";
import { effectiveGameId } from "@storylet-studio/model";
import type { AstNode, Box, Bundle, Card, Deck, Expression } from "@storylet-studio/model";

/** The scopes an influence edge can travel through. `hand` is recognised so it
 *  can be reported as unanalysed rather than silently dropped. */
export type InfluenceScopeName = "world" | "story" | "box" | "deck" | "hand";

export type EdgeClass = "enable" | "disable" | "influence" | "reference";

/** One property behind an aggregated edge, with a note when the match is not
 *  obvious. This is what lets the UI answer "why is this edge here?". */
export interface EdgeContribution {
  /** Canonical `@scope.name`. */
  property: string;
  scope: InfluenceScopeName;
  name: string;
  /** The flag, when the match was flag-level inside a flags property. */
  flag?: string;
  /** The writing outcome's gameId. Load-bearing: one card's outcomes often
   *  push a property in OPPOSITE directions, so the same pair of cards gets
   *  both an enable and a disable edge. Without the outcome named, that reads
   *  as a contradiction; with it, it reads as "enabled if you fight, disabled
   *  if you flee", which is the truth and worth knowing. */
  outcome?: string;
  /** A one-line caveat: "through the deck gate", "computed value", ... */
  note?: string;
}

export interface InfluenceEdge {
  /** The card whose outcome writes (for `reference`, one of the two readers). */
  from: string;
  /** The card whose condition reads. */
  to: string;
  cls: EdgeClass;
  /** Every contributing property, after aggregation. Never empty. */
  via: EdgeContribution[];
}

export interface InfluenceNode {
  id: string;
  gameId: string;
  title?: string;
  deck: string;
  box: string;
}

export type AnalysisWarningKind =
  | "hand-scope-not-analysed"
  | "unknown-builtin"
  | "computed-value"
  | "no-cards";

export interface AnalysisWarning {
  kind: AnalysisWarningKind;
  message: string;
  /** The card the warning was raised against, when it belongs to one. */
  card?: string;
}

/** What to analyse. `card` pivots: it analyses everything and marks the focus,
 *  because "what breaks if I delete this" does not respect deck boundaries. */
export type InfluenceScope =
  | { kind: "all" }
  | { kind: "box"; box: string }
  | { kind: "deck"; deck: string }
  | { kind: "card"; card: string };

export interface InfluenceGraph {
  nodes: InfluenceNode[];
  edges: InfluenceEdge[];
  countsByClass: Record<EdgeClass, number>;
  warnings: AnalysisWarning[];
  /** Set for a card-scoped analysis: the card to centre on. */
  focusCard?: string;
  issues: Issue[];
}

export interface InfluenceOptions {
  scope?: InfluenceScope;
  /** Include `reference` edges (two cards read a property nobody writes).
   *  Off by default: it is O(readers squared) and the noisiest class, so it is
   *  asked for rather than assumed. */
  includeReference?: boolean;
}

// --- what a read wants, and what a write does ---------------------------------

type ReadWant =
  | { kind: "wants-bool"; value: boolean }
  | { kind: "wants-eq"; value: string | number | boolean }
  | { kind: "wants-neq"; value: string | number | boolean }
  | { kind: "wants-gt"; threshold: number }
  | { kind: "wants-lt"; threshold: number }
  | { kind: "wants-flag"; flag: string; sign: "+" | "-" }
  | { kind: "computed" };

type WriteDoes =
  | { kind: "set-bool"; value: boolean }
  | { kind: "set-number"; value: number }
  | { kind: "set-string"; value: string }
  | { kind: "set-flag"; flag: string; sign: "+" | "-" }
  | { kind: "delta-up" }
  | { kind: "delta-down" }
  | { kind: "computed" };

interface Ref {
  scope: InfluenceScopeName;
  name: string;
  /** The container this reference resolves in: the box or deck id for those
   *  scopes, undefined for the singletons. */
  container?: string;
  note?: string;
}

interface ReadRecord extends Ref { card: string; want: ReadWant }
interface WriteRecord extends Ref { card: string; does: WriteDoes; outcome: string }

const SCOPES = new Set<string>(["world", "story", "box", "deck", "hand"]);
const isScope = (s: string): s is InfluenceScopeName => SCOPES.has(s);

const lit = (n: AstNode): string | number | boolean | undefined => {
  const tag = n[0];
  if (tag === "n" || tag === "s" || tag === "b") return n[1] as string | number | boolean;
  if (tag === "u" && n[1] === "neg" && Array.isArray(n[2]) && n[2][0] === "n") return -(n[2][1] as number);
  return undefined;
};
const isSv = (n: AstNode): boolean => Array.isArray(n) && n[0] === "sv";

// --- reading a condition ------------------------------------------------------

/** Walk a condition for the properties it reads and what it wants of them.
 *  `polarity` tracks whether we are under a `not`: the whole point is that
 *  `not (@story.done)` wants done FALSE, so a write of true DISABLES. */
function readsOf(ast: AstNode, polarity: boolean, out: ReadWant extends never ? never : { push: (w: { name: string; scope: InfluenceScopeName; want: ReadWant }) => void }, warn: (kind: AnalysisWarningKind, message: string) => void): void {
  if (!Array.isArray(ast)) return;
  const tag = ast[0];

  if (tag === "sv") {
    const scope = String(ast[1]);
    // THE LOWERCASING HERE AND BELOW IS DELIBERATE, and it looks like a bug.
    //
    // The expression parser folds every property reference to lower case
    // (`@wildwinter/expr`, parser.ts), so an AST name is already lower case; a
    // change TARGET is an object key that never went through the parser and keeps
    // whatever case it was written in. Folding both is what makes a read and a
    // write of one property meet. Take the fold out and every capitalised change
    // target stops matching its readers - which I did once, on the theory that
    // the analysis should match the engine's exact comparisons, and two tests
    // caught it immediately.
    //
    // What made this safe to leave alone is the other half, added the same day: a
    // capitalised property DECLARATION is now a compile error, so the case-twin
    // pair this fold would merge (`heat` and `Heat`) cannot exist in a project
    // that compiles. See `legalPropertyName` in compile.ts, and the tests in
    // influence.test.ts under "case in property names".
    if (isScope(scope)) out.push({ scope, name: String(ast[2]).toLowerCase(), want: { kind: "wants-bool", value: polarity } });
    return;
  }

  if (tag === "u") {
    if (ast[1] === "not") { readsOf(ast[2] as AstNode, !polarity, out, warn); return; }
    computedReads(ast[2] as AstNode, out);   // numeric negation: operand is a value
    return;
  }

  if (tag === "call") {
    const fn = String(ast[1]);
    if (fn === "check_flags" && isSv(ast[2] as AstNode)) {
      const sv = ast[2] as AstNode;
      const scope = String(sv[1]);
      if (isScope(scope)) {
        const name = String(sv[2]).toLowerCase();
        for (let i = 3; i < ast.length; i++) {
          const fd = ast[i] as AstNode;
          if (Array.isArray(fd) && fd[0] === "fd") {
            // Under a `not`, wanting +docks becomes wanting -docks.
            const sign = (fd[1] === "+") === polarity ? "+" : "-";
            out.push({ scope, name, want: { kind: "wants-flag", flag: String(fd[2]).toLowerCase(), sign } });
          }
        }
      }
      return;
    }
    // Any other call: its arguments are read, but what the call WANTS of them
    // is opaque, so every ref inside is an undecidable influence.
    if (fn !== "check_flags") warn("unknown-builtin", `${fn}() is not modelled; its operands read as undecidable`);
    for (let i = 2; i < ast.length; i++) computedReads(ast[i] as AstNode, out);
    return;
  }

  if (tag === "bin") {
    const op = String(ast[1]);
    const lhs = ast[2] as AstNode;
    const rhs = ast[3] as AstNode;

    if (op === "and" || op === "or") {
      readsOf(lhs, polarity, out, warn);
      readsOf(rhs, polarity, out, warn);
      return;
    }

    if (op === "==" || op === "!=") {
      // `not (x == y)` is `x != y`, so the operator flips with polarity.
      const effective = polarity ? op : op === "==" ? "!=" : "==";
      for (const [a, b] of [[lhs, rhs], [rhs, lhs]] as [AstNode, AstNode][]) {
        const value = lit(b);
        if (isSv(a) && value !== undefined) {
          const scope = String(a[1]);
          if (isScope(scope)) {
            out.push({
              scope, name: String(a[2]).toLowerCase(),
              want: effective === "==" ? { kind: "wants-eq", value } : { kind: "wants-neq", value },
            });
          }
          return;
        }
      }
      computedReads(lhs, out);
      computedReads(rhs, out);
      return;
    }

    if (op === ">" || op === ">=" || op === "<" || op === "<=") {
      const gt = op === ">" || op === ">=";
      // `@x > 5` wants x high; `5 > @x` wants x LOW, so the side matters.
      if (isSv(lhs) && typeof lit(rhs) === "number") {
        const scope = String(lhs[1]);
        if (isScope(scope)) {
          const wantsHigh = gt === polarity;
          out.push({
            scope, name: String(lhs[2]).toLowerCase(),
            want: wantsHigh ? { kind: "wants-gt", threshold: lit(rhs) as number } : { kind: "wants-lt", threshold: lit(rhs) as number },
          });
        }
        return;
      }
      if (isSv(rhs) && typeof lit(lhs) === "number") {
        const scope = String(rhs[1]);
        if (isScope(scope)) {
          const wantsHigh = gt !== polarity;
          out.push({
            scope, name: String(rhs[2]).toLowerCase(),
            want: wantsHigh ? { kind: "wants-gt", threshold: lit(lhs) as number } : { kind: "wants-lt", threshold: lit(lhs) as number },
          });
        }
        return;
      }
      computedReads(lhs, out);
      computedReads(rhs, out);
      return;
    }

    // Arithmetic inside a condition: both sides are values.
    computedReads(lhs, out);
    computedReads(rhs, out);
    return;
  }
}

/** Every property an expression mentions, once each, in the order met. What
 *  it WANTS of them is the influence question; this is the plain usage one
 *  ("where is @x read?"), and the Property tab and the CLI ask it here so the
 *  two scans cannot drift on what counts as a reference. */
export function propertyRefs(ast: AstNode): { scope: InfluenceScopeName; name: string }[] {
  const seen = new Set<string>();
  const out: { scope: InfluenceScopeName; name: string }[] = [];
  computedReads(ast, { push: (w) => {
    const key = `${w.scope}.${w.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ scope: w.scope, name: w.name });
  } });
  return out;
}

/** Every ref inside a value position, as undecidable reads. */
function computedReads(ast: AstNode, out: { push: (w: { name: string; scope: InfluenceScopeName; want: ReadWant }) => void }): void {
  if (!Array.isArray(ast)) return;
  if (ast[0] === "sv") {
    const scope = String(ast[1]);
    if (isScope(scope)) out.push({ scope, name: String(ast[2]).toLowerCase(), want: { kind: "computed" } });
    return;
  }
  for (let i = 1; i < ast.length; i++) computedReads(ast[i] as AstNode, out);
}

// --- reading a write ----------------------------------------------------------

/** What one outcome change does to its target. */
function writeOf(target: string, expr: Expression, warn: (kind: AnalysisWarningKind, message: string) => void): { scope: InfluenceScopeName; name: string; does: WriteDoes } | undefined {
  const bare = target.startsWith("@") ? target.slice(1) : target;
  const dot = bare.indexOf(".");
  if (dot < 0) return undefined;
  const scope = bare.slice(0, dot);
  if (!isScope(scope)) return undefined;
  const name = bare.slice(dot + 1).toLowerCase();
  const ast = expr.ast;

  // set_flags never arrives here: writesOfCard intercepts it, because one call
  // fans out to one write PER DELTA and this function returns a single write.

  const value = lit(ast);
  if (typeof value === "boolean") return { scope, name, does: { kind: "set-bool", value } };
  if (typeof value === "number") return { scope, name, does: { kind: "set-number", value } };
  if (typeof value === "string") return { scope, name, does: { kind: "set-string", value } };

  // A self-referential delta: @x + 2, @x - 2, 2 + @x.
  if (Array.isArray(ast) && ast[0] === "bin" && (ast[1] === "+" || ast[1] === "-")) {
    const lhs = ast[2] as AstNode;
    const rhs = ast[3] as AstNode;
    const self = (n: AstNode): boolean => isSv(n) && String(n[1]) === scope && String(n[2]).toLowerCase() === name;
    const ln = lit(lhs);
    const rn = lit(rhs);
    if (self(lhs) && typeof rn === "number") {
      const up = ast[1] === "+" ? rn > 0 : rn < 0;
      return { scope, name, does: up ? { kind: "delta-up" } : { kind: "delta-down" } };
    }
    if (self(rhs) && typeof ln === "number" && ast[1] === "+") {
      return { scope, name, does: ln > 0 ? { kind: "delta-up" } : { kind: "delta-down" } };
    }
  }

  warn("computed-value", `the change to @${scope}.${name} is computed; its direction is undecidable`);
  return { scope, name, does: { kind: "computed" } };
}

/** Every write a card's outcomes make, each tagged with the outcome that makes
 *  it. set_flags fans out to one write per delta. Exported for the usage scan
 *  (usage.ts), which must agree with the influence graph about what a write is. */
export function writesOfCard(card: Card<Expression>, warn: (kind: AnalysisWarningKind, message: string) => void): { scope: InfluenceScopeName; name: string; does: WriteDoes; outcome: string }[] {
  const out: { scope: InfluenceScopeName; name: string; does: WriteDoes; outcome: string }[] = [];
  for (const outcome of card.outcomes) {
    const from = effectiveGameId(outcome);
    for (const [target, expr] of Object.entries(outcome.changes)) {
      const bare = target.startsWith("@") ? target.slice(1) : target;
      const dot = bare.indexOf(".");
      const scope = dot < 0 ? "" : bare.slice(0, dot);
      const ast = expr.ast;
      if (isScope(scope) && Array.isArray(ast) && ast[0] === "call" && ast[1] === "set_flags") {
        const name = bare.slice(dot + 1).toLowerCase();
        for (let i = 3; i < ast.length; i++) {
          const fd = ast[i] as AstNode;
          if (Array.isArray(fd) && fd[0] === "fd") {
            out.push({ scope, name, outcome: from, does: { kind: "set-flag", flag: String(fd[2]).toLowerCase(), sign: fd[1] === "+" ? "+" : "-" } });
          }
        }
        continue;
      }
      const w = writeOf(target, expr, warn);
      if (w) out.push({ ...w, outcome: from });
    }
  }
  return out;
}

// --- the join ----------------------------------------------------------------

/** The property INSTANCE a ref refers to, as a key: two refs mean the same
 *  property exactly when their keys are equal and defined.
 *
 *  The singletons (`@world`, `@story`) are one instance each, so scope and
 *  name identify them. A container scope (`@box`, `@deck`, `@hand`) is one
 *  instance PER container, so the container joins the key - and a
 *  container-scoped ref that resolved to no container refers to no instance at
 *  all, which is the undefined case: it matches nothing, as it always did.
 *
 *  This replaced a `sameProperty(w, r)` predicate called once per (write,
 *  read) pair. Stating the rule as a key rather than a comparison is what lets
 *  the analysis bucket reads and skip the pairs that could never match. */
function propKey(ref: Ref): string | undefined {
  if (ref.scope === "world" || ref.scope === "story") return `${ref.scope}.${ref.name}`;
  return ref.container === undefined ? undefined : `${ref.scope}.${ref.name}.${ref.container}`;
}

/** The heart of it: does this write make that read more likely true, less
 *  likely, or is the direction undecidable? */
function classify(does: WriteDoes, want: ReadWant): EdgeClass | null {
  // A different flag in the same flags property is simply unrelated.
  if (does.kind === "set-flag" && want.kind === "wants-flag") {
    if (does.flag !== want.flag) return null;
    return does.sign === want.sign ? "enable" : "disable";
  }
  if (does.kind === "computed" || want.kind === "computed") return "influence";

  if (does.kind === "set-bool" && want.kind === "wants-bool") {
    return does.value === want.value ? "enable" : "disable";
  }
  if ((does.kind === "set-bool" || does.kind === "set-number" || does.kind === "set-string")
    && (want.kind === "wants-eq" || want.kind === "wants-neq")) {
    const matches = does.value === want.value;
    return want.kind === "wants-eq" ? (matches ? "enable" : "disable") : (matches ? "disable" : "enable");
  }
  if (does.kind === "set-number" && want.kind === "wants-gt") return does.value > want.threshold ? "enable" : "disable";
  if (does.kind === "set-number" && want.kind === "wants-lt") return does.value < want.threshold ? "enable" : "disable";

  if (does.kind === "delta-up" && want.kind === "wants-gt") return "enable";
  if (does.kind === "delta-up" && want.kind === "wants-lt") return "disable";
  if (does.kind === "delta-down" && want.kind === "wants-gt") return "disable";
  if (does.kind === "delta-down" && want.kind === "wants-lt") return "enable";

  // A nudge tells us nothing about landing on an exact value.
  if ((does.kind === "delta-up" || does.kind === "delta-down")
    && (want.kind === "wants-eq" || want.kind === "wants-neq")) return "influence";

  // Mismatched shapes (a flag write against a numeric want, say): the writer is
  // touching state the reader cares about, but not in a comparable way.
  return "influence";
}

// --- the walk ----------------------------------------------------------------

interface Located { card: Card<Expression>; deck: Deck<Expression>; box: Box<Expression> }

const allCards = (bundle: Bundle): Located[] =>
  bundle.boxes.flatMap((box) => box.decks.flatMap((deck) => deck.cards.map((card) => ({ card, deck, box }))));

/** Cards in scope. A card pivot analyses everything and marks the focus. */
function inScope(cards: Located[], scope: InfluenceScope): Located[] {
  switch (scope.kind) {
    case "all":
    case "card":
      return cards;
    case "box":
      return cards.filter((c) => c.box.id === scope.box || effectiveGameId(c.box) === scope.box);
    case "deck":
      return cards.filter((c) => c.deck.id === scope.deck || effectiveGameId(c.deck) === scope.deck);
  }
}

export function analyseInfluence(source: SourceProject, opts: InfluenceOptions = {}): InfluenceGraph {
  const { bundle, issues } = compileProject(source);
  const scope = opts.scope ?? { kind: "all" };
  const warnings: AnalysisWarning[] = [];
  const empty: InfluenceGraph = {
    nodes: [], edges: [],
    countsByClass: { enable: 0, disable: 0, influence: 0, reference: 0 },
    warnings, issues,
  };
  if (!bundle) return empty;

  const located = inScope(allCards(bundle), scope);
  if (located.length === 0) {
    warnings.push({ kind: "no-cards", message: "nothing to analyse in this scope" });
    return { ...empty, ...(scope.kind === "card" ? { focusCard: scope.card } : {}) };
  }

  const reads: ReadRecord[] = [];
  const writes: WriteRecord[] = [];
  let handScopeSeen = false;

  for (const { card, deck, box } of located) {
    const warn = (kind: AnalysisWarningKind, message: string): void => { warnings.push({ kind, message, card: card.id }); };
    const container = (s: InfluenceScopeName): string | undefined =>
      s === "box" ? box.id : s === "deck" ? deck.id : undefined;

    const collect = (expr: Expression | undefined, note?: string): void => {
      if (!expr) return;
      const found: { scope: InfluenceScopeName; name: string; want: ReadWant }[] = [];
      readsOf(expr.ast, true, { push: (w) => found.push(w) }, warn);
      for (const f of found) {
        if (f.scope === "hand") { handScopeSeen = true; continue; }
        reads.push({ card: card.id, scope: f.scope, name: f.name, want: f.want, container: container(f.scope), ...(note ? { note } : {}) });
      }
    };

    collect(card.condition);
    if (typeof card.priority !== "number") collect(card.priority, "through the priority");
    for (const outcome of card.outcomes) collect(outcome.condition, "through an outcome gate");
    // A deck gate governs every card in it, so a write that opens the gate
    // reaches all of them.
    collect(deck.condition, "through the deck gate");

    for (const w of writesOfCard(card, warn)) {
      if (w.scope === "hand") { handScopeSeen = true; continue; }
      writes.push({ card: card.id, scope: w.scope, name: w.name, does: w.does, outcome: w.outcome, container: container(w.scope) });
    }
  }

  if (handScopeSeen) {
    warnings.push({
      kind: "hand-scope-not-analysed",
      // Written for whoever reads it, which is an author in the Links window as
      // often as a developer at the CLI: it says what is MISSING, in the word the
      // interface uses ("links", never "edges"), and then why. A coverage run can
      // answer this one with evidence, because a run really does deal hands - so
      // this caveat is expected to go away rather than stand for ever
      // (design/graphical-views.md section 4, the observed-edge overlay).
      message: "Links through @hand are not included: a hand is composed at the deal, so what it contains is not knowable in advance",
    });
  }

  // Aggregate to one edge per (from, to, class), carrying every reason.
  const agg = new Map<string, InfluenceEdge>();
  const add = (from: string, to: string, cls: EdgeClass, via: EdgeContribution): void => {
    const key = `${from}|${to}|${cls}`;
    const existing = agg.get(key);
    if (!existing) { agg.set(key, { from, to, cls, via: [via] }); return; }
    const dup = existing.via.some((v) => v.property === via.property && v.flag === via.flag && v.note === via.note && v.outcome === via.outcome);
    if (!dup) existing.via.push(via);
  };

  // Reads BUCKETED by the property instance they refer to, so a write only
  // meets the reads that could possibly match it.
  //
  // This was a full cross product with `sameProperty` deciding each pair, i.e.
  // O(writes x reads) with the overwhelming majority of pairs rejected on the
  // first comparison. Measured before the change: 4000 cards took 308ms, and
  // the same project with six times fewer edges took just as long, which is
  // the proof that the SCAN dominated rather than the output. It runs on every
  // card selection while the Links window is open, on the main process, so an
  // author felt it as the whole app pausing.
  //
  // `propKey` is exactly `sameProperty` rewritten as a key: same scope and
  // name for the singletons, and additionally the same container otherwise. A
  // container-scoped ref with no container matched nothing before and buckets
  // to nothing now.
  const readsByProperty = new Map<string, ReadRecord[]>();
  for (const r of reads) {
    const key = propKey(r);
    if (key === undefined) continue;
    const bucket = readsByProperty.get(key);
    if (bucket) bucket.push(r); else readsByProperty.set(key, [r]);
  }

  for (const w of writes) {
    const key = propKey(w);
    if (key === undefined) continue;
    for (const r of readsByProperty.get(key) ?? []) {
      if (w.card === r.card) continue;          // a card influencing itself is not news
      const cls = classify(w.does, r.want);
      if (cls === null) continue;
      add(w.card, r.card, cls, {
        property: `@${w.scope}.${w.name}`,
        scope: w.scope,
        name: w.name,
        ...(w.does.kind === "set-flag" ? { flag: w.does.flag } : {}),
        outcome: w.outcome,
        ...(r.note ? { note: r.note } : {}),
      });
    }
  }

  if (opts.includeReference) {
    // Two cards reading a property nobody in scope writes: "who else cares?".
    const written = new Set(writes.map((w) => `${w.scope}.${w.name}.${w.container ?? ""}`));
    const byProperty = new Map<string, ReadRecord[]>();
    for (const r of reads) {
      const key = `${r.scope}.${r.name}.${r.container ?? ""}`;
      if (written.has(key)) continue;
      (byProperty.get(key) ?? byProperty.set(key, []).get(key)!).push(r);
    }
    for (const [, group] of byProperty) {
      const cards = [...new Set(group.map((g) => g.card))].sort();
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const r = group[0]!;
          add(cards[i]!, cards[j]!, "reference", { property: `@${r.scope}.${r.name}`, scope: r.scope, name: r.name });
        }
      }
    }
  }

  const edges = [...agg.values()].sort((a, b) =>
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.cls.localeCompare(b.cls));
  const countsByClass: Record<EdgeClass, number> = { enable: 0, disable: 0, influence: 0, reference: 0 };
  for (const e of edges) countsByClass[e.cls]++;

  return {
    nodes: located.map(({ card, deck, box }) => ({
      id: card.id,
      gameId: effectiveGameId(card),
      ...(card.title !== undefined ? { title: card.title } : {}),
      deck: deck.id,
      box: box.id,
    })),
    edges,
    countsByClass,
    warnings,
    ...(scope.kind === "card" ? { focusCard: scope.card } : {}),
    issues,
  };
}

/** One contribution as a human-readable phrase: the property, the outcome that
 *  writes it, and any caveat. Lives here so the CLI and the editor say the same
 *  thing rather than each inventing a format. */
export function describeContribution(v: EdgeContribution): string {
  return [
    v.property + (v.flag ? ` (${v.flag})` : ""),
    ...(v.outcome ? [`by ${v.outcome}`] : []),
    ...(v.note ? [v.note] : []),
  ].join(" ");
}

/** One card's immediate neighbourhood: what writes to it, what it writes to.
 *  The relationship view's shape (design/graphical-views.md section 4). */
export interface Neighbourhood {
  card: InfluenceNode | undefined;
  /** Edges INTO the card, with the neighbour resolved. */
  predecessors: { edge: InfluenceEdge; node: InfluenceNode | undefined }[];
  /** Edges OUT of the card. */
  dependents: { edge: InfluenceEdge; node: InfluenceNode | undefined }[];
  warnings: AnalysisWarning[];
  issues: Issue[];
}

/** The one-hop neighbourhood of a card, across every deck and box. */
export function cardNeighbourhood(source: SourceProject, cardId: string, opts: { includeReference?: boolean } = {}): Neighbourhood {
  const graph = analyseInfluence(source, { scope: { kind: "card", card: cardId }, ...opts });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return {
    card: byId.get(cardId),
    predecessors: graph.edges.filter((e) => e.to === cardId).map((edge) => ({ edge, node: byId.get(edge.from) })),
    dependents: graph.edges.filter((e) => e.from === cardId).map((edge) => ({ edge, node: byId.get(edge.to) })),
    warnings: graph.warnings,
    issues: graph.issues,
  };
}
