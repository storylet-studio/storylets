// ---------------------------------------------------------------------------
// Conditions that can never hold (design/reachability.md).
//
// The fault: the Village's `Expose the Conspiracy` wants
// `@deck.connected && !@deck.torin_offer_seen`, and the only writer of
// `connected` is itself gated on `torin_offer_seen`, which nothing ever sets
// back to false. So `connected` implies `torin_offer_seen`, the condition is
// unsatisfiable, and the card is dead. Four checks were blind to it: coverage
// reports bodies rather than causes, the honesty net found both refs written,
// dead state found both halves of both latches present, and Links has the
// edges but needs a person to join them.
//
// THE ONE RULE, above every detail below: only report what can be REFUTED. A
// false "this can never happen" on a card that plays fine teaches authors to
// ignore the panel, and this is exactly the sort of check that gets ignored
// when it cries wolf. So every step here is conservative in the same
// direction: anything not provably monotonic drops out of the analysis
// entirely rather than being guessed at.
//
// Scope, deliberately small: MONOTONIC LATCHES - a boolean only ever written
// `true`, and a flag only ever `+set`. That is where the faults live, and it
// is decidable by walking a graph. Qualities (advance up a ladder) and
// counters are out: they are ordered comparisons, they want a different
// argument, and a wrong answer about them would cost more than the check is
// worth. No solver: full satisfiability over the expression language is a
// different project answering questions nobody is asking.
//
// A WARNING, never an error, like dead state and for the same reason: content
// is written in pieces, and "I have not written that bit yet" must stay an
// obvious reading.
// ---------------------------------------------------------------------------

import { compileProject } from "@storylet-studio/compiler";
import type { Issue, SourceProject } from "@storylet-studio/compiler";
import type { Bundle, Expression, PropertyDecl } from "@storylet-studio/model";
import { effectiveGameId } from "@storylet-studio/model";

type AstNode = Expression["ast"];

/** Which deck or box a reference was seen in. @deck.x in one deck and @deck.x
 *  in another are different properties at runtime, so they are kept apart -
 *  the mistake deadstate.ts records having made once. */
interface Owner { box?: string; deck?: string }

const SEP = "";
const keyOf = (ref: string, o: Owner): string =>
  ref.startsWith("@deck.") ? `${o.deck ?? ""}${SEP}${ref}`
  : ref.startsWith("@box.") ? `${o.box ?? ""}${SEP}${ref}`
  : ref;
/** The half of a key a person reads: `@deck.connected`, or `@story.rel +met`. */
const shown = (key: string): string => {
  const bare = key.includes(SEP) ? key.slice(key.indexOf(SEP) + 1) : key;
  const at = bare.indexOf(":");
  return at < 0 ? bare : `${bare.slice(0, at)} +${bare.slice(at + 1)}`;
};

/** One latch mentioned in a condition, and whether it was mentioned negated. */
interface Term { key: string; negated: boolean }

const svRef = (ast: AstNode): string | undefined =>
  (Array.isArray(ast) && ast[0] === "sv" ? `@${ast[1]}.${ast[2]}` : undefined);

/** The latch a node asserts, if it is one of the shapes we understand.
 *  Anything else returns undefined and takes no part in the analysis. */
function latchOf(ast: AstNode, owner: Owner): string | undefined {
  const direct = svRef(ast);
  if (direct !== undefined) return keyOf(direct, owner);
  if (!Array.isArray(ast)) return undefined;
  // `@x == true` is the same assertion as `@x`.
  if (ast[0] === "bin" && ast[1] === "==") {
    const [, , l, r] = ast as ["bin", string, AstNode, AstNode];
    for (const [a, b] of [[l, r], [r, l]] as [AstNode, AstNode][]) {
      const ref = svRef(a);
      if (ref !== undefined && Array.isArray(b) && b[0] === "b" && b[1] === true) return keyOf(ref, owner);
    }
    return undefined;
  }
  // `check_flags(@x, +f)` - ONE flag only. Two flags in one call is a
  // conjunction we could split, and a needless generality until something asks.
  if (ast[0] === "call" && ast[1] === "check_flags") {
    const ref = svRef(ast[2] as AstNode);
    const args = ast.slice(3);
    if (ref === undefined || args.length !== 1) return undefined;
    const arg = args[0];
    if (Array.isArray(arg) && arg[0] === "fd" && arg[1] === "+") return `${keyOf(ref, owner)}:${String(arg[2])}`;
  }
  return undefined;
}

/** Split a condition on top-level `or`. Every branch must be refuted before
 *  the whole condition is. */
function disjuncts(ast: AstNode): AstNode[] {
  if (Array.isArray(ast) && ast[0] === "bin" && ast[1] === "or") {
    const [, , l, r] = ast as ["bin", string, AstNode, AstNode];
    return [...disjuncts(l), ...disjuncts(r)];
  }
  return [ast];
}

/** The latches one AND-branch asserts, positively or negated. Terms it does
 *  not understand are simply absent: a branch is only ever refuted by what is
 *  proven, never by what is missing. */
function terms(ast: AstNode, owner: Owner, negated = false, into: Term[] = []): Term[] {
  const latch = latchOf(ast, owner);
  if (latch !== undefined) { into.push({ key: latch, negated }); return into; }
  if (!Array.isArray(ast)) return into;
  if (ast[0] === "u" && ast[1] === "not") return terms(ast[2] as AstNode, owner, !negated, into);
  // Inside a negation, `and` becomes `or` and the branch stops being a plain
  // conjunction - so only descend through `and` while positive.
  if (ast[0] === "bin" && ast[1] === "and" && !negated) {
    terms(ast[2] as AstNode, owner, false, into);
    terms(ast[3] as AstNode, owner, false, into);
  }
  return into;
}

interface Writer { requires: Term[] }

export function reachabilityIssues(source: SourceProject, compiled?: Bundle): Issue[] {
  const bundle = compiled ?? compileProject(source).bundle;
  if (!bundle) return [];   // does not compile: the real errors are already told

  // --- 1. classify: which latches only ever move one way ---------------------
  //
  // `monotonic` starts as every latch something latches, and a single write we
  // cannot vouch for removes it for good.
  const latched = new Set<string>();
  const broken = new Set<string>();
  const writers = new Map<string, Writer[]>();

  const noteWrite = (key: string, requires: Term[]): void => {
    latched.add(key);
    const list = writers.get(key) ?? [];
    list.push({ requires });
    writers.set(key, list);
  };

  for (const box of bundle.boxes) {
    const boxName = effectiveGameId(box);
    for (const deck of box.decks) {
      const owner: Owner = { box: boxName, deck: effectiveGameId(deck) };
      for (const card of deck.cards) {
        const requires = disjuncts(card.condition?.ast ?? true as unknown as AstNode).length === 1
          ? terms(card.condition?.ast ?? (true as unknown as AstNode), owner)
          // A card whose own condition is a disjunction requires none of its
          // branches for certain, so it constrains nothing.
          : [];
        for (const outcome of card.outcomes) {
          // An outcome's own gate is a requirement too, on top of the card's.
          const gate = outcome.condition !== undefined ? terms(outcome.condition.ast, owner) : [];
          const need = [...requires, ...gate];
          for (const [target, expr] of Object.entries(outcome.changes)) {
            const key = keyOf(target, owner);
            const ast = expr.ast;
            // `@x = true`: a boolean latch.
            if (Array.isArray(ast) && ast[0] === "b" && ast[1] === true) { noteWrite(key, need); continue; }
            // `@x = set_flags(@x, +a, ...)`: each named flag is a latch. Any
            // OTHER shape of write to a flags property - a clear, an
            // assignment, a computed value - breaks every flag it holds,
            // because we can no longer say the set only grows.
            if (Array.isArray(ast) && ast[0] === "call" && ast[1] === "set_flags"
              && svRef(ast[2] as AstNode) === target) {
              let clean = true;
              for (const arg of ast.slice(3)) {
                if (Array.isArray(arg) && arg[0] === "fd" && arg[1] === "+") noteWrite(`${key}:${String(arg[2])}`, need);
                else clean = false;
              }
              if (clean) continue;
            }
            // Anything else: this ref is not a latch we can reason about.
            broken.add(key);
            for (const k of [...latched]) if (k.startsWith(`${key}:`)) broken.add(k);
          }
        }
      }
    }
  }
  // A property written unsafely poisons its own flags, whichever order we met
  // them in.
  for (const key of [...latched]) {
    const at = key.indexOf(":");
    if (at > 0 && broken.has(key.slice(0, at))) broken.add(key);
  }
  const monotonic = (key: string): boolean => latched.has(key) && !broken.has(key);

  // Latches whose DECLARED DEFAULT already holds them, so they are true before
  // anything runs. They are still monotonic - nothing moves them back - but they
  // do not need a writer, and every refutation this check makes is an argument
  // about a writer having run. `A can only become true after B` is worth nothing
  // when A was true on turn one.
  //
  // From the Patter side (to-storylets/reachability-positive-latch.md). They found
  // the missing `monotonic` on the positive term and flagged it as possibly
  // unreachable here; it is reachable by TWO routes here, and this is the one
  // their one-line fix does not cover, because a defaulted latch is monotonic.
  // Our model makes it likelier than theirs: `default` is required on every
  // declaration, not optional.
  const startsSet = new Set<string>();
  const noteDefaults = (decls: readonly PropertyDecl[] | undefined, scope: string, owner: string): void => {
    for (const d of decls ?? []) {
      const key = keyOf(`${scope}.${d.name}`, { box: owner, deck: owner });
      if (d.type === "boolean" && d.default === true) startsSet.add(key);
      // A flags property whose default already contains a flag starts that flag set.
      if (d.type === "flags" && Array.isArray(d.default)) {
        for (const f of d.default) startsSet.add(`${key}:${String(f)}`);
      }
    }
  };
  noteDefaults(bundle.story?.properties, "@story", "");
  for (const box of bundle.boxes) {
    const boxName = effectiveGameId(box);
    noteDefaults(box.properties, "@box", boxName);
    for (const deck of box.decks) noteDefaults(deck.properties, "@deck", effectiveGameId(deck));
  }

  // --- 2. what must already be true before a latch can be set ---------------
  //
  // INTERSECTION across writers, not union: any one live route to a latch is
  // enough, so only a requirement EVERY route shares is a requirement of the
  // latch. Getting this backwards would report every second card.
  const cache = new Map<string, Set<string>>();
  const inFlight = new Set<string>();
  /** `cut` means a cycle was broken to get this answer, so it is an
   *  approximation rather than a fact - and an approximation must never reach
   *  the refutation. Two latches that require each other are indeed both
   *  unreachable, but that is a DIFFERENT diagnosis from the one this check
   *  makes, and reporting it here would give a true verdict with a false
   *  reason. Provisional answers are also never cached, or the first walk to
   *  hit the cycle would poison the cache for every later one. */
  const mustHold = (key: string): { need: Set<string>; cut: boolean } => {
    const done = cache.get(key);
    if (done !== undefined) return { need: done, cut: false };
    if (inFlight.has(key)) return { need: new Set(), cut: true };
    const routes = writers.get(key);
    // No writer at all is dead state's story, told better by dead state.
    if (routes === undefined || routes.length === 0) return { need: new Set(), cut: false };
    inFlight.add(key);
    let shared: Set<string> | undefined;
    let cut = false;
    for (const route of routes) {
      const need = new Set<string>();
      for (const t of route.requires) {
        if (t.negated || !monotonic(t.key)) continue;
        need.add(t.key);
        const deeper = mustHold(t.key);
        cut ||= deeper.cut;
        for (const k of deeper.need) need.add(k);
      }
      shared = shared === undefined ? need : new Set([...shared].filter((k) => need.has(k)));
    }
    inFlight.delete(key);
    const result = shared ?? new Set<string>();
    if (!cut) cache.set(key, result);
    return { need: result, cut };
  };

  // --- 3. refute --------------------------------------------------------------
  const issues: Issue[] = [];
  const deckPaths = new Map<string, string>();
  for (const sb of source.boxes) for (const d of sb.decks) deckPaths.set(d.shard.deck.id, d.path);

  for (const box of bundle.boxes) {
    const boxName = effectiveGameId(box);
    for (const deck of box.decks) {
      const owner: Owner = { box: boxName, deck: effectiveGameId(deck) };
      for (const card of deck.cards) {
        if (!card.condition) continue;
        let reason: string | undefined;
        const branches = disjuncts(card.condition.ast);
        const refuted = branches.every((branch) => {
          const ts = terms(branch, owner);
          for (const no of ts.filter((t) => t.negated)) {
            if (!monotonic(no.key)) continue;
            for (const yes of ts.filter((t) => !t.negated && t.key !== no.key)) {
              // The POSITIVE term has to be a latch too. The refutation argues
              // "A can only become true after B", which is sound only when A
              // becoming true REQUIRES a writer to have run. A term that is not
              // monotonic (written somewhere in a shape we cannot read) or that
              // starts already set (its default holds it) can be true without
              // any writer, and then it implies nothing about order.
              if (!monotonic(yes.key) || startsSet.has(yes.key)) continue;
              const chain = mustHold(yes.key);
              if (!chain.cut && chain.need.has(no.key)) {
                reason ??= `${shown(yes.key)} can only become true after ${shown(no.key)}, `
                  + `which nothing sets back, so this condition can never hold`;
                return true;
              }
            }
            // `A && !A`, which needs no chain at all.
            if (ts.some((t) => !t.negated && t.key === no.key)) {
              reason ??= `it asks for ${shown(no.key)} to be both set and not set`;
              return true;
            }
          }
          return false;
        });
        if (refuted && reason !== undefined) {
          issues.push({
            severity: "warning",
            path: deckPaths.get(deck.id) ?? source.path,
            where: effectiveGameId(card),
            field: "condition",
            message: `this card can never be dealt: ${reason}`,
          });
        }
      }
    }
  }
  return issues;
}
