// The storylets expression dialect. Port of @storylet-studio/dialect
// (packages/dialect/src/index.ts): five scopes, fixed; bare `@name` is
// `@story.name`; the function set (random, check_flags, set_flags, and the
// play-history functions) with eval semantics carried exactly.

using System;
using System.Collections.Generic;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>Host callbacks the dialect's functions read from
    /// EvalContext.Host. The runtime supplies these (its PRNG, its play log);
    /// null members mirror the TS "no host capability" state, so a call without
    /// the capability is an EvalError, never a crash.</summary>
    public sealed class StoryletsHost
    {
        /// <summary>One PRNG draw in [0, 1) - the session mulberry32 (schema 3.3).</summary>
        public Func<double> NextRandom;
        /// <summary>Plays of the card (gameId) from the play log.</summary>
        public Func<string, double> CountPlayed;
        /// <summary>Turns since the card (gameId) last played; NEVER_PLAYED when never.</summary>
        public Func<string, double> TurnsSincePlayed;
        /// <summary>Plays of cards belonging to the dimension value (both by gameId).</summary>
        public Func<string, string, double> CountPlayedIn;
        /// <summary>As above; NEVER_PLAYED when never.</summary>
        public Func<string, string, double> TurnsSincePlayedIn;
    }

    public static class StoryletsDialect
    {
        /// <summary>turns_since_played / _in when the card / value has never been played.</summary>
        public const double NEVER_PLAYED = 9999;

        /// <summary>The one dialect instance (storyletsDialect in TS).</summary>
        public static readonly Dialect Instance = Build();

        private static StoryletsHost Host(EvalHelpers h)
        {
            return (h.Ctx.Host as StoryletsHost) ?? new StoryletsHost();
        }

        private static string StringArg(string fn, ExprNode[] args, EvalHelpers h, int i)
        {
            var v = h.Evaluate(args[i]);
            if (!v.IsString || v.AsString == "")
            {
                throw new EvalError($"{fn}() argument {i + 1} must be a non-empty string");
            }
            return v.AsString;
        }

        /// <summary>Resolve the first argument of check_flags / set_flags to a flag set.</summary>
        private static List<string> FlagsArg(string fn, ExprNode[] args, EvalHelpers h)
        {
            if (args.Length == 0)
            {
                throw new EvalError($"{fn}() requires at least one argument (the flags property)");
            }
            var v = h.Evaluate(args[0]);
            if (v.IsFlags) return new List<string>(v.AsFlags);
            // An unset flags property may surface as false; treat as the empty set
            // (carried from the old dialect). Anything else is a type error.
            if (v.IsBool && !v.AsBool) return new List<string>();
            throw new EvalError($"{fn}() first argument must be a flags property");
        }

        private static Dialect Build()
        {
            var dialect = new Dialect
            {
                // A missing property in a PRESENT scope is always an error: every
                // property is declared with a default, so absence means a publish
                // bug, a drifted save, or a foreign scope the host never fed.
                Scopes = new List<ScopeDef>
                {
                    new ScopeDef { Token = "story", Missing = MissingPolicy.Throw },
                    new ScopeDef { Token = "world", Missing = MissingPolicy.Throw },
                    new ScopeDef { Token = "box", Missing = MissingPolicy.Throw },
                    new ScopeDef { Token = "deck", Missing = MissingPolicy.Throw },
                    new ScopeDef { Token = "hand", Missing = MissingPolicy.Throw },
                },
                DefaultScope = "story",
            };

            dialect.Functions["random"] = new FunctionDef
            {
                MinArgs = 2, MaxArgs = 2, ReturnType = "number",
                Eval = (args, h) =>
                {
                    if (args.Length != 2) throw new EvalError("random(a, b) requires exactly 2 arguments");
                    var nextRandom = Host(h).NextRandom;
                    if (nextRandom == null) throw new EvalError("random() called without a PRNG in context");
                    var a = h.Evaluate(args[0]);
                    var b = h.Evaluate(args[1]);
                    if (!a.IsNumber || !b.IsNumber)
                    {
                        throw new EvalError("random(a, b) arguments must be numbers");
                    }
                    if (!IsInteger(a.AsNumber) || !IsInteger(b.AsNumber))
                    {
                        throw new EvalError("random(a, b) arguments must be integers");
                    }
                    var lo = Math.Min(a.AsNumber, b.AsNumber);
                    var hi = Math.Max(a.AsNumber, b.AsNumber);
                    return StoryletValue.Num(Math.Floor(nextRandom() * (hi - lo + 1)) + lo);
                },
            };

            dialect.Functions["check_flags"] = new FunctionDef
            {
                MinArgs = 1, ReturnType = "boolean", FlagDeltaArgs = true,
                Eval = (args, h) =>
                {
                    var flags = FlagsArg("check_flags", args, h);
                    for (int i = 1; i < args.Length; i++)
                    {
                        if (!(args[i] is FlagDeltaNode delta))
                        {
                            throw new EvalError("check_flags() flag args must be +flagName or -flagName");
                        }
                        if (delta.Sign == "+" ? !flags.Contains(delta.Name) : flags.Contains(delta.Name))
                        {
                            return StoryletValue.False;
                        }
                    }
                    return StoryletValue.True;
                },
            };

            dialect.Functions["set_flags"] = new FunctionDef
            {
                MinArgs = 1, ReturnType = "flags", FlagDeltaArgs = true,
                Eval = (args, h) =>
                {
                    var result = FlagsArg("set_flags", args, h);
                    for (int i = 1; i < args.Length; i++)
                    {
                        if (!(args[i] is FlagDeltaNode delta))
                        {
                            throw new EvalError("set_flags() flag args must be +flagName or -flagName");
                        }
                        if (delta.Sign == "+")
                        {
                            if (!result.Contains(delta.Name)) result.Add(delta.Name);
                        }
                        else
                        {
                            result.Remove(delta.Name);
                        }
                    }
                    // Canonically sorted: flag values compare by value across ports
                    // and in saves, so the stored order must be deterministic. JS
                    // Array.sort() default order is UTF-16 code units: ordinal.
                    result.Sort(StringComparer.Ordinal);
                    return StoryletValue.Flags(result);
                },
            };

            dialect.Functions["count_played"] = new FunctionDef
            {
                MinArgs = 1, MaxArgs = 1, ReturnType = "number",
                Eval = (args, h) =>
                {
                    var card = StringArg("count_played", args, h, 0);
                    var fn = Host(h).CountPlayed;
                    if (fn == null) throw new EvalError("count_played() called without a play log in context");
                    return StoryletValue.Num(fn(card));
                },
            };

            dialect.Functions["turns_since_played"] = new FunctionDef
            {
                MinArgs = 1, MaxArgs = 1, ReturnType = "number",
                Eval = (args, h) =>
                {
                    var card = StringArg("turns_since_played", args, h, 0);
                    var fn = Host(h).TurnsSincePlayed;
                    if (fn == null) throw new EvalError("turns_since_played() called without a play log in context");
                    return StoryletValue.Num(fn(card));
                },
            };

            dialect.Functions["count_played_in"] = new FunctionDef
            {
                MinArgs = 2, MaxArgs = 2, ReturnType = "number",
                Eval = (args, h) =>
                {
                    var dimension = StringArg("count_played_in", args, h, 0);
                    var value = StringArg("count_played_in", args, h, 1);
                    var fn = Host(h).CountPlayedIn;
                    if (fn == null) throw new EvalError("count_played_in() called without a play log in context");
                    return StoryletValue.Num(fn(dimension, value));
                },
            };

            dialect.Functions["turns_since_played_in"] = new FunctionDef
            {
                MinArgs = 2, MaxArgs = 2, ReturnType = "number",
                Eval = (args, h) =>
                {
                    var dimension = StringArg("turns_since_played_in", args, h, 0);
                    var value = StringArg("turns_since_played_in", args, h, 1);
                    var fn = Host(h).TurnsSincePlayedIn;
                    if (fn == null) throw new EvalError("turns_since_played_in() called without a play log in context");
                    return StoryletValue.Num(fn(dimension, value));
                },
            };

            return dialect;
        }

        /// <summary>JS Number.isInteger.</summary>
        private static bool IsInteger(double d)
        {
            return !double.IsNaN(d) && !double.IsInfinity(d) && Math.Floor(d) == d;
        }
    }
}
