// Evaluator - walk an AstNode against an EvalContext, parameterised by
// Dialect. Port of @wildwinter/expr's evaluate.ts + dialect.ts (the core
// Dialect / EvalContext types live here; the storylets dialect itself is
// Dialect.h).
//
// Operators (binary/unary), short-circuiting, and type-checking are generic.
// Scope resolution uses the context's scope sources + the Dialect's per-scope
// missing-property policy. Function calls dispatch to the Dialect's functions.
#pragma once

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "Storylets/Ast.h"
#include "Storylets/OrderedMap.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** A scope readable by the evaluator: a static bag or a host resolver.
     *  get returns nullopt when the property is not present (TS undefined). */
    class IScopeSource
    {
    public:
        virtual ~IScopeSource() = default;
        virtual std::optional<StoryletValue> get(const std::string& name) const = 0;
    };

    /** A static bag scope over an ordered values map (a PropertyBag's live
     *  values, or a composed @hand bag). Non-owning: the map must outlive the
     *  evaluation it is used in (the session guarantees this per ask). */
    class BagScope : public IScopeSource
    {
    public:
        explicit BagScope(const OrderedMap<std::string, StoryletValue>& values) : values_(&values) {}

        std::optional<StoryletValue> get(const std::string& name) const override
        {
            const StoryletValue* v = values_->get(name);
            return v ? std::optional<StoryletValue>(*v) : std::nullopt;
        }

    private:
        const OrderedMap<std::string, StoryletValue>* values_;
    };

    /** Policy when a property is missing from a PRESENT scope: False resolves
     *  to false (the default), Throw raises an EvalError. A scope entirely
     *  absent from the EvalContext always resolves to false regardless. */
    enum class MissingPolicy { False, Throw };

    struct ScopeDef
    {
        /** The scope token, e.g. "story" / "world" / "hand". */
        std::string token;
        MissingPolicy missing = MissingPolicy::False;
    };

    struct EvalContext
    {
        /** Values per scope token. A scope absent from this map resolves to
         *  false (graceful) for any reference. */
        std::unordered_map<std::string, std::shared_ptr<const IScopeSource>> scopes;
        /** Arbitrary host callbacks a Dialect's functions read at eval time (the
         *  storylets dialect casts to StoryletsHost). The core never inspects
         *  this. Non-owning. */
        const void* host = nullptr;
        /** The quality channel (quality.md): "is @scope.name a quality, and
         *  what is its ladder?" Unset when the bundle declares no quality, and
         *  evaluation is then byte-identical to before. */
        std::function<const std::vector<std::string>*(const std::string&, const std::string&)> qualities;
    };

    struct EvalHelpers
    {
        /** Evaluate a child node (for functions to evaluate their arguments). */
        std::function<StoryletValue(const AstPtr&)> evaluate;
        /** The active evaluation context (scopes + host). */
        EvalContext* ctx = nullptr;
    };

    struct FunctionDef
    {
        int minArgs = 0;
        std::optional<int> maxArgs;
        std::string returnType;             // "boolean" | "number" | "string" | "flags" | "unknown"
        /** When true, trailing arguments (after the first) reach eval as
         *  FlagDelta nodes rather than expressions (check_flags / set_flags). */
        bool flagDeltaArgs = false;
        /** Evaluate the call. Receives the RAW argument nodes (not
         *  pre-evaluated); implementations own their own arity/type checks. */
        std::function<StoryletValue(const std::vector<AstPtr>&, EvalHelpers&)> eval;
    };

    struct Dialect
    {
        std::vector<ScopeDef> scopes;
        /** Bare `@name` is shorthand for `@<defaultScope>.name` (already
         *  resolved at compile time; kept for parity). */
        std::string defaultScope;
        std::unordered_map<std::string, FunctionDef> functions;
    };

    /** JS typeof for error messages (a flags array is "object"). */
    inline std::string TypeOf(const StoryletValue& v)
    {
        switch (v.kind())
        {
            case StoryletKind::Bool: return "boolean";
            case StoryletKind::Number: return "number";
            case StoryletKind::Str: return "string";
            default: return "object";
        }
    }

    namespace detail
    {
        /** The ladder behind an operand NODE, when the context's quality channel
         *  says it references one (quality.md). */
        inline const std::vector<std::string>* LadderOf(const AstPtr& node, const EvalContext& ctx)
        {
            if (!ctx.qualities || !node || node->tag != AstTag::ScopedVar) return nullptr;
            return ctx.qualities(node->scope, node->name);
        }

        /** Index of a stage in a ladder; an unknown stage is an error naming the
         *  value (a drifted save is exactly what lands here). */
        inline int StageIndex(const StoryletValue& value, const std::vector<std::string>& ladder, const std::string& op)
        {
            if (!value.isString()) throw EvalError("'" + op + "' on a quality compares stages, got " + TypeOf(value));
            for (size_t i = 0; i < ladder.size(); i++) if (ladder[i] == value.asString()) return (int)i;
            std::string all;
            for (size_t i = 0; i < ladder.size(); i++) all += (i ? ", " : "") + ladder[i];
            throw EvalError("\"" + value.asString() + "\" is not a stage of this quality (stages: " + all + ")");
        }

        inline void AssertNumbers(const StoryletValue& l, const StoryletValue& r, const std::string& op)
        {
            if (!l.isNumber() || !r.isNumber())
            {
                throw EvalError("'" + op + "' requires numeric operands, got " + TypeOf(l) + " and " + TypeOf(r));
            }
        }

        struct Evaluator
        {
            EvalContext& ctx;
            const Dialect& dialect;
            /** Per-scope missing-property policy, precomputed once per top-level
             *  evaluate. */
            std::unordered_map<std::string, MissingPolicy> missingPolicy;

            Evaluator(EvalContext& c, const Dialect& d) : ctx(c), dialect(d)
            {
                for (const auto& s : d.scopes) missingPolicy[s.token] = s.missing;
            }

            StoryletValue rec(const AstPtr& n)
            {
                switch (n->tag)
                {
                    case AstTag::Bool: return StoryletValue::Bool(n->b);
                    case AstTag::Number: return StoryletValue::Num(n->n);
                    case AstTag::Str: return StoryletValue::Str(n->s);

                    case AstTag::ScopedVar:
                    {
                        auto it = ctx.scopes.find(n->scope);
                        if (it == ctx.scopes.end() || !it->second)
                        {
                            // Scope context absent -> graceful false.
                            return StoryletValue::Bool(false);
                        }
                        std::optional<StoryletValue> val = it->second->get(n->name);
                        if (!val.has_value())
                        {
                            // Property not declared on the present scope. Policy decides.
                            auto policy = missingPolicy.find(n->scope);
                            if (policy != missingPolicy.end() && policy->second == MissingPolicy::Throw)
                            {
                                throw EvalError("@" + n->scope + "." + n->name
                                    + " is not declared on the current " + n->scope + ".");
                            }
                            return StoryletValue::Bool(false);
                        }
                        return *val;
                    }

                    case AstTag::Call:
                    {
                        // `advance` is the language's own (quality.md): the next
                        // stage, saturating at the last. A dialect defining its
                        // own advance still wins.
                        if (n->fn == "advance" && dialect.functions.find("advance") == dialect.functions.end())
                        {
                            if (n->args.size() != 1)
                            {
                                throw EvalError("advance() takes exactly 1 argument, got " + std::to_string(n->args.size()));
                            }
                            const std::vector<std::string>* ladder = LadderOf(n->args[0], ctx);
                            if (!ladder)
                            {
                                throw EvalError("advance() needs a quality reference (@scope.name of a quality property)");
                            }
                            const int current = StageIndex(rec(n->args[0]), *ladder, "advance");
                            const size_t next = std::min((size_t)current + 1, ladder->size() - 1);
                            return StoryletValue::Str((*ladder)[next]);
                        }
                        auto def = dialect.functions.find(n->fn);
                        if (def == dialect.functions.end())
                        {
                            throw EvalError("unknown function '" + n->fn + "'");
                        }
                        EvalHelpers helpers;
                        helpers.evaluate = [this](const AstPtr& child) { return rec(child); };
                        helpers.ctx = &ctx;
                        return def->second.eval(n->args, helpers);
                    }

                    case AstTag::FlagDelta:
                        throw EvalError("flagdelta node is only valid as an argument to a flag-delta function");

                    case AstTag::Unary:
                    {
                        if (n->op == "not")
                        {
                            StoryletValue val = rec(n->operand);
                            if (!val.isBool()) throw EvalError("'not' requires a boolean operand, got " + TypeOf(val));
                            return StoryletValue::Bool(!val.asBool());
                        }
                        // neg
                        StoryletValue operand = rec(n->operand);
                        if (!operand.isNumber()) throw EvalError("unary '-' requires a numeric operand, got " + TypeOf(operand));
                        return StoryletValue::Num(-operand.asNumber());
                    }

                    case AstTag::Binary:
                    {
                        // Short-circuit operators first.
                        if (n->op == "and")
                        {
                            StoryletValue l = rec(n->left);
                            if (!l.isBool()) throw EvalError("'and' requires boolean operands, left is " + TypeOf(l));
                            if (!l.asBool()) return StoryletValue::Bool(false);
                            StoryletValue r = rec(n->right);
                            if (!r.isBool()) throw EvalError("'and' requires boolean operands, right is " + TypeOf(r));
                            return r;
                        }
                        if (n->op == "or")
                        {
                            StoryletValue l = rec(n->left);
                            if (!l.isBool()) throw EvalError("'or' requires boolean operands, left is " + TypeOf(l));
                            if (l.asBool()) return StoryletValue::Bool(true);
                            StoryletValue r = rec(n->right);
                            if (!r.isBool()) throw EvalError("'or' requires boolean operands, right is " + TypeOf(r));
                            return r;
                        }

                        StoryletValue left = rec(n->left);
                        StoryletValue right = rec(n->right);

                        // Quality (quality.md): when either operand REFERENCES a
                        // quality, ordering compares by ladder position and
                        // arithmetic is refused; == and != stay value equality.
                        {
                            const std::vector<std::string>* lLadder = LadderOf(n->left, ctx);
                            const std::vector<std::string>* rLadder = LadderOf(n->right, ctx);
                            const std::vector<std::string>* ladder = lLadder ? lLadder : rLadder;
                            if (ladder)
                            {
                                const bool ordering = n->op == ">" || n->op == ">=" || n->op == "<" || n->op == "<=";
                                if (ordering && lLadder && rLadder && *lLadder != *rLadder)
                                {
                                    throw EvalError("'" + n->op + "' compares two different qualities, whose stage orders are unrelated");
                                }
                                if (ordering)
                                {
                                    const int li = StageIndex(left, *ladder, n->op);
                                    const int ri = StageIndex(right, *ladder, n->op);
                                    if (n->op == ">") return StoryletValue::Bool(li > ri);
                                    if (n->op == ">=") return StoryletValue::Bool(li >= ri);
                                    if (n->op == "<") return StoryletValue::Bool(li < ri);
                                    return StoryletValue::Bool(li <= ri);
                                }
                                if (n->op == "+" || n->op == "-" || n->op == "*" || n->op == "/")
                                {
                                    throw EvalError("'" + n->op + "' cannot be applied to a quality - a stage is a position, not a number; use advance() to move it");
                                }
                            }
                        }

                        if (n->op == "==") return StoryletValue::Bool(left.valueEquals(right));
                        if (n->op == "!=") return StoryletValue::Bool(!left.valueEquals(right));
                        if (n->op == ">")
                        {
                            AssertNumbers(left, right, ">");
                            return StoryletValue::Bool(left.asNumber() > right.asNumber());
                        }
                        if (n->op == ">=")
                        {
                            AssertNumbers(left, right, ">=");
                            return StoryletValue::Bool(left.asNumber() >= right.asNumber());
                        }
                        if (n->op == "<")
                        {
                            AssertNumbers(left, right, "<");
                            return StoryletValue::Bool(left.asNumber() < right.asNumber());
                        }
                        if (n->op == "<=")
                        {
                            AssertNumbers(left, right, "<=");
                            return StoryletValue::Bool(left.asNumber() <= right.asNumber());
                        }
                        if (n->op == "+")
                        {
                            if (left.isNumber() && right.isNumber()) return StoryletValue::Num(left.asNumber() + right.asNumber());
                            if (left.isString() && right.isString()) return StoryletValue::Str(left.asString() + right.asString());
                            throw EvalError("'+' requires two numbers or two strings, got " + TypeOf(left) + " and " + TypeOf(right));
                        }
                        if (n->op == "-")
                        {
                            AssertNumbers(left, right, "-");
                            return StoryletValue::Num(left.asNumber() - right.asNumber());
                        }
                        if (n->op == "*")
                        {
                            AssertNumbers(left, right, "*");
                            return StoryletValue::Num(left.asNumber() * right.asNumber());
                        }
                        if (n->op == "/")
                        {
                            AssertNumbers(left, right, "/");
                            if (right.asNumber() == 0) throw EvalError("division by zero");
                            return StoryletValue::Num(left.asNumber() / right.asNumber());
                        }
                        throw EvalError("unknown operator '" + n->op + "'");
                    }

                    default:
                        throw EvalError("unknown expression node");
                }
            }
        };
    }

    inline StoryletValue Evaluate(const AstPtr& node, EvalContext& ctx, const Dialect& dialect)
    {
        detail::Evaluator evaluator(ctx, dialect);
        return evaluator.rec(node);
    }
}
