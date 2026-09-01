// ---------------------------------------------------------------------------
// @storylet-studio/dialect - the storylets expression dialect.
//
// One dialect drives runtime eval AND publish-time validation (schema 6.1).
// Five scopes, fixed (Reboot 3); bare `@name` is `@story.name` (schema 6.2,
// resolved 2026-07-19). Function eval semantics carry from the old engine's
// storylets-dialect.ts where the function survives (random, check_flags,
// set_flags); the play-history functions are the new set pinned in schema 6.3.
// ---------------------------------------------------------------------------

import { EvalError } from "@wildwinter/expr";
import type { Dialect, EvalHelpers, ExprNode, ScalarValue } from "@wildwinter/expr";

/** turns_since_played / _in when the card / value has never been played. */
export const NEVER_PLAYED = 9999;

/**
 * Host callbacks the dialect's functions read from `EvalContext.host`. The
 * runtime supplies these (its PRNG, its play log); the compiler validates
 * without them.
 */
export interface StoryletsHost {
  /** One PRNG draw in [0, 1) - the session mulberry32 (schema 3.3). */
  nextRandom(): number;
  /** Plays of the card (gameId) from the play log. */
  countPlayed(card: string): number;
  /** Turns since the card (gameId) last played; NEVER_PLAYED when never. */
  turnsSincePlayed(card: string): number;
  /** Plays of cards belonging to the dimension value (both by gameId). */
  countPlayedIn(dimension: string, value: string): number;
  /** As above; NEVER_PLAYED when never. */
  turnsSincePlayedIn(dimension: string, value: string): number;
}

const host = (h: EvalHelpers): Partial<StoryletsHost> =>
  (h.ctx.host ?? {}) as Partial<StoryletsHost>;

const stringArg = (fn: string, args: ExprNode[], h: EvalHelpers, i: number): string => {
  const v = h.evaluate(args[i]!);
  if (typeof v !== "string" || v === "") {
    throw new EvalError(`${fn}() argument ${i + 1} must be a non-empty string`);
  }
  return v;
};

/** Resolve the first argument of check_flags / set_flags to a flag set. */
const flagsArg = (fn: string, args: ExprNode[], h: EvalHelpers): string[] => {
  if (args.length === 0) {
    throw new EvalError(`${fn}() requires at least one argument (the flags property)`);
  }
  const v = h.evaluate(args[0]!);
  if (Array.isArray(v)) return v as string[];
  // An unset flags property may surface as false; treat as the empty set
  // (carried from the old dialect). Anything else is a type error.
  if (v === false) return [];
  throw new EvalError(`${fn}() first argument must be a flags property`);
};

export const storyletsDialect: Dialect = {
  // A missing property in a PRESENT scope is always an error: every property
  // is declared with a default, so absence means a publish bug, a drifted
  // save, or a foreign scope the host never fed (schema 6.2).
  scopes: [
    { token: "story", missing: "throw" },
    { token: "world", missing: "throw" },
    { token: "box", missing: "throw" },
    { token: "deck", missing: "throw" },
    { token: "hand", missing: "throw" },
  ],
  defaultScope: "story",
  functions: {
    random: {
      minArgs: 2, maxArgs: 2, returnType: "number",
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        if (args.length !== 2) throw new EvalError("random(a, b) requires exactly 2 arguments");
        const nextRandom = host(h).nextRandom;
        if (!nextRandom) throw new EvalError("random() called without a PRNG in context");
        const a = h.evaluate(args[0]!);
        const b = h.evaluate(args[1]!);
        if (typeof a !== "number" || typeof b !== "number") {
          throw new EvalError("random(a, b) arguments must be numbers");
        }
        if (!Number.isInteger(a) || !Number.isInteger(b)) {
          throw new EvalError("random(a, b) arguments must be integers");
        }
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return Math.floor(nextRandom() * (hi - lo + 1)) + lo;
      },
    },
    check_flags: {
      minArgs: 1, returnType: "boolean", flagDeltaArgs: true,
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        const flags = flagsArg("check_flags", args, h);
        for (let i = 1; i < args.length; i++) {
          const arg = args[i]!;
          if (arg.kind !== "flagdelta") {
            throw new EvalError("check_flags() flag args must be +flagName or -flagName");
          }
          if (arg.sign === "+" ? !flags.includes(arg.name) : flags.includes(arg.name)) {
            return false;
          }
        }
        return true;
      },
    },
    set_flags: {
      minArgs: 1, returnType: "flags", flagDeltaArgs: true,
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        const result = [...flagsArg("set_flags", args, h)];
        for (let i = 1; i < args.length; i++) {
          const arg = args[i]!;
          if (arg.kind !== "flagdelta") {
            throw new EvalError("set_flags() flag args must be +flagName or -flagName");
          }
          if (arg.sign === "+") {
            if (!result.includes(arg.name)) result.push(arg.name);
          } else {
            const idx = result.indexOf(arg.name);
            if (idx >= 0) result.splice(idx, 1);
          }
        }
        // Sorted so a SAVE is deterministic: the same flags reached by different routes
        // serialise to the same bytes, which keeps save diffs and cross-runtime byte
        // comparisons stable. It is no longer what makes equality work - flags compare
        // as a SET since 2026-09-01 - so this is now about the stored form only, and
        // Patterplay not sorting is a difference that costs nothing.
        return result.sort();
      },
    },
    count_played: {
      minArgs: 1, maxArgs: 1, returnType: "number",
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        const card = stringArg("count_played", args, h, 0);
        const fn = host(h).countPlayed;
        if (!fn) throw new EvalError("count_played() called without a play log in context");
        return fn(card);
      },
    },
    turns_since_played: {
      minArgs: 1, maxArgs: 1, returnType: "number",
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        const card = stringArg("turns_since_played", args, h, 0);
        const fn = host(h).turnsSincePlayed;
        if (!fn) throw new EvalError("turns_since_played() called without a play log in context");
        return fn(card);
      },
    },
    count_played_in: {
      minArgs: 2, maxArgs: 2, returnType: "number",
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        const dimension = stringArg("count_played_in", args, h, 0);
        const value = stringArg("count_played_in", args, h, 1);
        const fn = host(h).countPlayedIn;
        if (!fn) throw new EvalError("count_played_in() called without a play log in context");
        return fn(dimension, value);
      },
    },
    turns_since_played_in: {
      minArgs: 2, maxArgs: 2, returnType: "number",
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        const dimension = stringArg("turns_since_played_in", args, h, 0);
        const value = stringArg("turns_since_played_in", args, h, 1);
        const fn = host(h).turnsSincePlayedIn;
        if (!fn) throw new EvalError("turns_since_played_in() called without a play log in context");
        return fn(dimension, value);
      },
    },
  },
};
