// ---------------------------------------------------------------------------
// The reference runners: one per case kind, driven from the compiled corpus.
// A port re-implements these four in its own language and drives them from
// corpus.json; this file documents the exact obligations.
//
// Scripted/draw runners return a list of FAILURE strings (empty = pass) so a
// test can report every divergence in one run.
// ---------------------------------------------------------------------------

import { deserialiseAst, evaluate } from "@wildwinter/expr";
import type { EvalContext, ScalarValue } from "@wildwinter/expr";
import { matchedSpecificity } from "@wildwinter/expr-specificity";
import { storyletsDialect } from "@storylet-studio/dialect";
import { Engine, Flow, makePrng } from "@storylet-studio/runtime";
import { effectiveGameId } from "@storylet-studio/model";
import type { Bundle } from "@storylet-studio/model";
import type { ExpressionCase, PeekCase, ScriptedCase, SpecificityCase, StateSelector } from "./types.js";

/** Truthiness for a bare condition; mirrors the runtime's `conditionPasses`,
 *  and Patterplay's `truthy`, which it was aligned with on 2026-09-01. */
const conditionPasses = (v: ScalarValue): boolean =>
  typeof v === "boolean" ? v
  : typeof v === "number" ? v !== 0
  : typeof v === "string" ? v !== ""
  : v.length > 0;

const show = (v: unknown): string => JSON.stringify(v);
const same = (a: unknown, b: unknown): boolean => show(a) === show(b);

/** Evaluate `ast` against `scopes` (PRNG seeded when `seed` is present). */
export function runExpressionCase(c: ExpressionCase): { value?: ScalarValue; error?: string } {
  const prng = makePrng(c.seed ?? 0);
  const ctx: EvalContext = {
    scopes: c.scopes,
    host: { nextRandom: () => prng.next() },
  };
  try {
    return { value: evaluate(deserialiseAst(c.ast), ctx, storyletsDialect) };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Score `ast` against `scopes` at root polarity want = true. */
export function runSpecificityCase(c: SpecificityCase): number {
  const ctx: EvalContext = { scopes: c.scopes };
  return matchedSpecificity(deserialiseAst(c.ast), (node) => {
    try {
      return conditionPasses(evaluate(node, ctx, storyletsDialect));
    } catch {
      return false;
    }
  });
}

const applyState = (session: Flow, selector: StateSelector): void => {
  for (const scope of ["story", "world"] as const) {
    for (const [name, value] of Object.entries(selector[scope] ?? {})) {
      session.setProperty(`${scope}.${name}`, value);
    }
  }
  for (const kind of ["box", "deck", "hand", "value"] as const) {
    for (const [id, bag] of Object.entries(selector[kind] ?? {})) {
      for (const [name, value] of Object.entries(bag)) {
        session.setProperty(`${kind}.${id}.${name}`, value);
      }
    }
  }
};

/** "turn.<boxId>" reads that box's clock (schema 3.4); everything else is a
 *  property path. */
const readState = (session: Flow, path: string): ScalarValue =>
  path.startsWith("turn.") ? session.turn(path.slice("turn.".length)) : session.getProperty(path);

const outcomeMap = (session: Flow, cardId: string, keys: string[], from: string): Record<string, boolean> => {
  const views = session.outcomes(cardId, from);
  return Object.fromEntries(keys.map((gameId) => [
    gameId,
    views.find((v) => v.gameId === gameId)?.available ?? false,
  ]));
};

/** Build a session, apply `setup`, peek, check the ordered list - then peek
 *  AGAIN and require the identical list: a peek registers nothing and asking
 *  twice is free (schema 3.5). Returns failures; empty = pass. */
export function runPeekCase(c: PeekCase): string[] {
  const failures: string[] = [];
  const session = new Engine(c.bundle, { seed: c.seed ?? 0 }).openFlow("main");
  if (c.setup) applyState(session, c.setup);
  const first = session.peek(c.box, c.criteria ?? {}, c.n).cards.map((card) => card.id);
  if (!same(first, c.expect)) {
    failures.push(`peek: expected ${show(c.expect)}, got ${show(first)}`);
  }
  const second = session.peek(c.box, c.criteria ?? {}, c.n).cards.map((card) => card.id);
  if (!same(second, first)) {
    failures.push(`second peek diverged (a peek must register nothing): ${show(first)} then ${show(second)}`);
  }
  return failures;
}

/** Hand id -> gameId (the board keys by gameId; scripts speak ids). */
const handGameIds = (bundle: Bundle): Map<string, string> =>
  new Map(bundle.boxes.flatMap((b) => b.hands.map((h) => [h.id, effectiveGameId(h)])));

/** Execute the ops in order; every `expect` must match exactly, `expectError`
 *  ops must fail without side effects. Returns failures; empty = pass.
 *
 *  Flows: every play op runs on `op.flow ?? "main"`, opened lazily on first
 *  use, so a script that never says "flow" pins single-flow behaviour
 *  unchanged. Handles are KEPT across closeFlow on purpose: a later op
 *  naming a closed flow exercises the inert handle (the stale-handle rule),
 *  never a quiet re-open. */
export function runScriptedCase(c: ScriptedCase): string[] {
  const failures: string[] = [];
  const seed = c.seed ?? 0;
  let engine = new Engine(c.bundle, { seed });
  let handles = new Map<string, Flow>();
  // Verdicts from the deal or peek an op just ran, card id -> verdict, taken
  // from the trace because that is the only place the REASON lives: a board
  // read says a card is absent, never why, and "claimed" against
  // "claimed-elsewhere" is exactly the distinction it cannot make. A deal
  // fires one event per hand, so the sink accumulates across them; subscribing
  // is also what switches tracing on (with no subscribers a flow does none).
  let verdictSink = new Map<string, string>();
  const watch = (f: Flow): Flow => {
    f.subscribeTrace((e) => {
      if (e.type !== "deal" && e.type !== "peek") return;
      for (const card of e.cards) verdictSink.set(card.id, card.verdict);
    });
    return f;
  };
  const flowOf = (name = "main"): Flow => {
    let f = handles.get(name);
    if (!f) {
      f = watch(engine.openFlow(name));
      handles.set(name, f);
    }
    return f;
  };
  const collect = (run: () => void): Map<string, string> => {
    verdictSink = new Map();
    run();
    return verdictSink;
  };
  const checkVerdicts = (at: string, expected: Record<string, string> | undefined,
                         actual: Map<string, string>): void => {
    if (!expected) return;
    for (const [cardId, want] of Object.entries(expected)) {
      const got = actual.get(cardId);
      if (got !== want) {
        failures.push(`${at}: verdict for ${cardId} expected "${want}", got ${got === undefined ? "no verdict" : `"${got}"`}`);
      }
    }
  };

  c.script.forEach((op, index) => {
    const at = `op ${index} (${op.op})`;
    switch (op.op) {
      case "setState": {
        const { op: _ignored, flow: _flow, ...selector } = op;
        applyState(flowOf(op.flow), selector);
        break;
      }
      case "openFlow":
        handles.set(op.flow, engine.openFlow(op.flow, op.seed !== undefined ? { seed: op.seed } : {}));
        break;
      case "closeFlow":
        engine.closeFlow(op.flow);
        break;
      case "assertFlows": {
        const got = engine.flows().map((f) => f.id);
        if (!same(got, op.expect)) {
          failures.push(`${at}: flows are [${got.join(", ")}], expected [${op.expect.join(", ")}]`);
        }
        break;
      }
      case "assertEngineRead": {
        let value: ScalarValue | undefined;
        let error: string | undefined;
        try {
          value = engine.getProperty(op.path);
        } catch (e) {
          error = String(e);
        }
        if (op.expectError && error === undefined) {
          failures.push(`${at}: expected an error, engine read of ${op.path} returned ${show(value)}`);
        }
        if (!op.expectError && error !== undefined) {
          failures.push(`${at}: unexpected error: ${error}`);
        }
        if (op.expect !== undefined && error === undefined && !same(value, op.expect)) {
          failures.push(`${at}: ${op.path} expected ${show(op.expect)}, got ${show(value)}`);
        }
        break;
      }
      case "peek": {
        let ids: string[] | undefined;
        let error: string | undefined;
        const peekVerdicts = collect(() => {
          try {
            ids = flowOf(op.flow).peek(op.box ?? "box", op.criteria ?? {}, op.n).cards.map((card) => card.id);
          } catch (e) {
            error = String(e);
          }
        });
        checkVerdicts(at, op.expectVerdicts, peekVerdicts);
        if (op.expectError && error === undefined) {
          failures.push(`${at}: expected an error, peek returned ${show(ids)}`);
        }
        if (!op.expectError && error !== undefined) {
          failures.push(`${at}: unexpected error: ${error}`);
        }
        if (op.expect && ids !== undefined && !same(ids, op.expect)) {
          failures.push(`${at}: expected ${show(op.expect)}, got ${show(ids)}`);
        }
        break;
      }
      case "deal": {
        const session = flowOf(op.flow);
        let dealt!: ReturnType<Flow["dealMany"]>;
        const verdicts = collect(() => { dealt = session.dealMany(op.hands); });
        checkVerdicts(at, op.expectVerdicts, verdicts);
        const names = handGameIds(c.bundle);
        for (const [handId, expected] of Object.entries(op.expectBoard ?? {})) {
          const board = session.board();
          const actual = (board[names.get(handId) ?? handId] ?? []).map((card) => card.id);
          if (!same(actual, expected)) {
            failures.push(`${at}: board[${handId}] expected ${show(expected)}, got ${show(actual)}`);
          }
        }
        if (op.expectDealt) {
          // The dealt slice holds exactly the hands this call dealt: the key
          // set must match, not merely include.
          const expectedKeys = Object.keys(op.expectDealt).map((id) => names.get(id) ?? id).sort();
          const actualKeys = Object.keys(dealt).sort();
          if (!same(actualKeys, expectedKeys)) {
            failures.push(`${at}: dealt hands expected ${show(expectedKeys)}, got ${show(actualKeys)}`);
          }
          for (const [handId, expected] of Object.entries(op.expectDealt)) {
            const actual = (dealt[names.get(handId) ?? handId] ?? []).map((card) => card.id);
            if (!same(actual, expected)) {
              failures.push(`${at}: dealt[${handId}] expected ${show(expected)}, got ${show(actual)}`);
            }
          }
        }
        break;
      }
      case "assertBoard": {
        const names = handGameIds(c.bundle);
        let board: Record<string, { id: string }[]> | undefined;
        let error: string | undefined;
        try {
          const session = flowOf(op.flow);
          board = op.box === undefined ? session.board() : session.board(op.box);
        } catch (e) {
          error = String(e);
        }
        if (op.expectError && error === undefined) {
          failures.push(`${at}: expected an error, board returned ${show(Object.keys(board!))}`);
        }
        if (!op.expectError && error !== undefined) {
          failures.push(`${at}: unexpected error: ${error}`);
        }
        if (op.expect && board !== undefined) {
          // The filtered board holds exactly the hands of that box: the key
          // set must match, not merely include.
          const expectedKeys = Object.keys(op.expect).map((id) => names.get(id) ?? id).sort();
          const actualKeys = Object.keys(board).sort();
          if (!same(actualKeys, expectedKeys)) {
            failures.push(`${at}: board hands expected ${show(expectedKeys)}, got ${show(actualKeys)}`);
          }
          for (const [handId, expected] of Object.entries(op.expect)) {
            const actual = (board[names.get(handId) ?? handId] ?? []).map((card) => card.id);
            if (!same(actual, expected)) {
              failures.push(`${at}: board[${handId}] expected ${show(expected)}, got ${show(actual)}`);
            }
          }
        }
        break;
      }
      case "play": {
        let error: string | undefined;
        try {
          flowOf(op.flow).play(op.card, op.outcome, op.from,
            op.advanceTurns !== undefined ? { advanceTurns: op.advanceTurns } : {});
        } catch (e) {
          error = String(e);
        }
        if (op.expectError && error === undefined) {
          failures.push(`${at}: expected an error, play succeeded`);
        }
        if (!op.expectError && error !== undefined) {
          failures.push(`${at}: unexpected error: ${error}`);
        }
        break;
      }
      case "advanceTurns":
        flowOf(op.flow).advanceTurns(op.box, op.n);
        break;
      case "assertOutcomes": {
        const actual = outcomeMap(flowOf(op.flow), op.card, Object.keys(op.expect), op.from);
        if (!same(actual, op.expect)) {
          failures.push(`${at}: expected ${show(op.expect)}, got ${show(actual)}`);
        }
        break;
      }
      case "assertOutcomeOrder": {
        const actual = flowOf(op.flow).outcomes(op.card, op.from).map((v) => v.gameId);
        if (actual.length !== op.expect.length || actual.some((g, i) => g !== op.expect[i])) {
          failures.push(`${at}: expected [${op.expect.join(", ")}], got [${actual.join(", ")}]`);
        }
        break;
      }
      case "assertState": {
        for (const [path, expected] of Object.entries(op.expect)) {
          let actual: ScalarValue | undefined;
          let error: string | undefined;
          try {
            actual = readState(flowOf(op.flow), path);
          } catch (e) {
            error = String(e);
          }
          if (error !== undefined || !same(actual, expected)) {
            failures.push(`${at}: ${path} expected ${show(expected)}, got ${error ?? show(actual)}`);
          }
        }
        break;
      }
      case "saveLoad": {
        // Serialise the WHOLE engine, discard it, restore into a fresh one
        // (semantic parity, not byte parity). `into: "B"` restores into the
        // case's EDITED bundle: the drifted-content contract. loadGame
        // rebuilds every flow, so the script's handles are re-taken.
        const envelope = engine.saveGame();
        engine = new Engine(op.into === "B" ? c.bundleB! : c.bundle, { seed });
        engine.loadGame(envelope);
        handles = new Map(engine.flows().map((f) => [f.id, f]));
        break;
      }
      case "reset":
        engine = new Engine(c.bundle, { seed });
        handles = new Map();
        break;
    }
  });
  return failures;
}
