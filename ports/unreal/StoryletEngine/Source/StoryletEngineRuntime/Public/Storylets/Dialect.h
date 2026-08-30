// The storylets expression dialect. Port of @storylet-studio/dialect
// (packages/dialect/src/index.ts): five scopes, fixed; bare `@name` is
// `@story.name`; the function set (random, check_flags, set_flags, and the
// play-history functions) with eval semantics carried exactly.
#pragma once

#include <algorithm>
#include <cmath>
#include <functional>
#include <string>
#include <vector>

#include "Storylets/Expression.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** Host callbacks the dialect's functions read from EvalContext::host. The
     *  runtime supplies these (its PRNG, its play log); empty members mirror
     *  the TS "no host capability" state, so a call without the capability is
     *  an EvalError, never a crash. */
    struct StoryletsHost
    {
        /** One PRNG draw in [0, 1) - the session mulberry32 (schema 3.3). */
        std::function<double()> nextRandom;
        /** Plays of the card (gameId) from the play log. */
        std::function<double(const std::string&)> countPlayed;
        /** Turns since the card (gameId) last played; NEVER_PLAYED when never. */
        std::function<double(const std::string&)> turnsSincePlayed;
        /** Plays of cards belonging to the dimension value (both by gameId). */
        std::function<double(const std::string&, const std::string&)> countPlayedIn;
        /** As above; NEVER_PLAYED when never. */
        std::function<double(const std::string&, const std::string&)> turnsSincePlayedIn;
    };

    /** turns_since_played / _in when the card / value has never been played. */
    constexpr double NEVER_PLAYED = 9999;

    namespace detail
    {
        inline const StoryletsHost& DialectHost(EvalHelpers& h)
        {
            static const StoryletsHost empty;
            const StoryletsHost* host = h.ctx ? static_cast<const StoryletsHost*>(h.ctx->host) : nullptr;
            return host ? *host : empty;
        }

        inline std::string StringArg(const std::string& fn, const std::vector<AstPtr>& args, EvalHelpers& h, size_t i)
        {
            StoryletValue v = h.evaluate(args[i]);
            if (!v.isString() || v.asString().empty())
            {
                throw EvalError(fn + "() argument " + std::to_string(i + 1) + " must be a non-empty string");
            }
            return v.asString();
        }

        /** Resolve the first argument of check_flags / set_flags to a flag set. */
        inline std::vector<std::string> FlagsArg(const std::string& fn, const std::vector<AstPtr>& args, EvalHelpers& h)
        {
            if (args.empty())
            {
                throw EvalError(fn + "() requires at least one argument (the flags property)");
            }
            StoryletValue v = h.evaluate(args[0]);
            if (v.isFlags()) return v.asFlags();
            // An unset flags property may surface as false; treat as the empty set
            // (carried from the old dialect). Anything else is a type error.
            if (v.isBool() && !v.asBool()) return {};
            throw EvalError(fn + "() first argument must be a flags property");
        }

        /** JS Number.isInteger. */
        inline bool IsInteger(double d)
        {
            return !std::isnan(d) && !std::isinf(d) && std::floor(d) == d;
        }

        inline Dialect BuildStoryletsDialect()
        {
            Dialect dialect;
            // A missing property in a PRESENT scope is always an error: every
            // property is declared with a default, so absence means a publish
            // bug, a drifted save, or a foreign scope the host never fed.
            dialect.scopes = {
                ScopeDef{"story", MissingPolicy::Throw},
                ScopeDef{"world", MissingPolicy::Throw},
                ScopeDef{"box", MissingPolicy::Throw},
                ScopeDef{"deck", MissingPolicy::Throw},
                ScopeDef{"hand", MissingPolicy::Throw},
            };
            dialect.defaultScope = "story";

            {
                FunctionDef def;
                def.minArgs = 2;
                def.maxArgs = 2;
                def.returnType = "number";
                def.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> StoryletValue
                {
                    if (args.size() != 2) throw EvalError("random(a, b) requires exactly 2 arguments");
                    const auto& nextRandom = DialectHost(h).nextRandom;
                    if (!nextRandom) throw EvalError("random() called without a PRNG in context");
                    StoryletValue a = h.evaluate(args[0]);
                    StoryletValue b = h.evaluate(args[1]);
                    if (!a.isNumber() || !b.isNumber())
                    {
                        throw EvalError("random(a, b) arguments must be numbers");
                    }
                    if (!IsInteger(a.asNumber()) || !IsInteger(b.asNumber()))
                    {
                        throw EvalError("random(a, b) arguments must be integers");
                    }
                    double lo = std::min(a.asNumber(), b.asNumber());
                    double hi = std::max(a.asNumber(), b.asNumber());
                    return StoryletValue::Num(std::floor(nextRandom() * (hi - lo + 1)) + lo);
                };
                dialect.functions["random"] = def;
            }

            {
                FunctionDef def;
                def.minArgs = 1;
                def.returnType = "boolean";
                def.flagDeltaArgs = true;
                def.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> StoryletValue
                {
                    std::vector<std::string> flags = FlagsArg("check_flags", args, h);
                    for (size_t i = 1; i < args.size(); ++i)
                    {
                        if (args[i]->tag != AstTag::FlagDelta)
                        {
                            throw EvalError("check_flags() flag args must be +flagName or -flagName");
                        }
                        bool present = std::find(flags.begin(), flags.end(), args[i]->name) != flags.end();
                        if (args[i]->sign == "+" ? !present : present)
                        {
                            return StoryletValue::Bool(false);
                        }
                    }
                    return StoryletValue::Bool(true);
                };
                dialect.functions["check_flags"] = def;
            }

            {
                FunctionDef def;
                def.minArgs = 1;
                def.returnType = "flags";
                def.flagDeltaArgs = true;
                def.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> StoryletValue
                {
                    std::vector<std::string> result = FlagsArg("set_flags", args, h);
                    for (size_t i = 1; i < args.size(); ++i)
                    {
                        if (args[i]->tag != AstTag::FlagDelta)
                        {
                            throw EvalError("set_flags() flag args must be +flagName or -flagName");
                        }
                        auto found = std::find(result.begin(), result.end(), args[i]->name);
                        if (args[i]->sign == "+")
                        {
                            if (found == result.end()) result.push_back(args[i]->name);
                        }
                        else if (found != result.end())
                        {
                            result.erase(found);
                        }
                    }
                    // Canonically sorted: flag values compare by value across ports
                    // and in saves, so the stored order must be deterministic. JS
                    // Array.sort() default order is UTF-16 code units: ordinal.
                    std::sort(result.begin(), result.end());
                    return StoryletValue::Flags(std::move(result));
                };
                dialect.functions["set_flags"] = def;
            }

            {
                FunctionDef def;
                def.minArgs = 1;
                def.maxArgs = 1;
                def.returnType = "number";
                def.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> StoryletValue
                {
                    std::string card = StringArg("count_played", args, h, 0);
                    const auto& fn = DialectHost(h).countPlayed;
                    if (!fn) throw EvalError("count_played() called without a play log in context");
                    return StoryletValue::Num(fn(card));
                };
                dialect.functions["count_played"] = def;
            }

            {
                FunctionDef def;
                def.minArgs = 1;
                def.maxArgs = 1;
                def.returnType = "number";
                def.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> StoryletValue
                {
                    std::string card = StringArg("turns_since_played", args, h, 0);
                    const auto& fn = DialectHost(h).turnsSincePlayed;
                    if (!fn) throw EvalError("turns_since_played() called without a play log in context");
                    return StoryletValue::Num(fn(card));
                };
                dialect.functions["turns_since_played"] = def;
            }

            {
                FunctionDef def;
                def.minArgs = 2;
                def.maxArgs = 2;
                def.returnType = "number";
                def.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> StoryletValue
                {
                    std::string dimension = StringArg("count_played_in", args, h, 0);
                    std::string value = StringArg("count_played_in", args, h, 1);
                    const auto& fn = DialectHost(h).countPlayedIn;
                    if (!fn) throw EvalError("count_played_in() called without a play log in context");
                    return StoryletValue::Num(fn(dimension, value));
                };
                dialect.functions["count_played_in"] = def;
            }

            {
                FunctionDef def;
                def.minArgs = 2;
                def.maxArgs = 2;
                def.returnType = "number";
                def.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> StoryletValue
                {
                    std::string dimension = StringArg("turns_since_played_in", args, h, 0);
                    std::string value = StringArg("turns_since_played_in", args, h, 1);
                    const auto& fn = DialectHost(h).turnsSincePlayedIn;
                    if (!fn) throw EvalError("turns_since_played_in() called without a play log in context");
                    return StoryletValue::Num(fn(dimension, value));
                };
                dialect.functions["turns_since_played_in"] = def;
            }

            return dialect;
        }
    }

    /** The one dialect instance (storyletsDialect in TS). */
    inline const Dialect& StoryletsDialect()
    {
        static const Dialect dialect = detail::BuildStoryletsDialect();
        return dialect;
    }
}
