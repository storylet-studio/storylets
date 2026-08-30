// A storylets scalar value: boolean, number, string, or a flags list. Mirrors
// @wildwinter/expr's ScalarValue and the VALUE equality the JS runtime uses
// for == / != (primitives by value; flags element-wise, in order; mixed kinds
// unequal - the old PAR-3 lesson lives here, in one place).
//
// The storylets PropertyType set is boolean / number / string / enum / flags;
// an enum value is a string at runtime, so four kinds carry all five types.
//
// The runtime's error types live here too (the base header every layer sees):
// StoryletError is the port's one error class (TS throws plain Errors);
// EvalError marks expression evaluation errors, exactly as in the reference.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace storylets
{
    /** The runtime's error type (one class per port keeps catch sites honest). */
    class StoryletError : public std::runtime_error
    {
    public:
        explicit StoryletError(const std::string& message) : std::runtime_error(message) {}
    };

    /** An expression evaluation error (TS EvalError). */
    class EvalError : public StoryletError
    {
    public:
        explicit EvalError(const std::string& message) : StoryletError(message) {}
    };

    enum class StoryletKind { Bool, Number, Str, Flags };

    class StoryletValue
    {
    public:
        StoryletValue() : kind_(StoryletKind::Bool), b_(false), n_(0) {}

        static StoryletValue Bool(bool v)
        {
            StoryletValue x;
            x.kind_ = StoryletKind::Bool;
            x.b_ = v;
            return x;
        }
        static StoryletValue Num(double v)
        {
            StoryletValue x;
            x.kind_ = StoryletKind::Number;
            x.n_ = v;
            return x;
        }
        static StoryletValue Str(std::string v)
        {
            StoryletValue x;
            x.kind_ = StoryletKind::Str;
            x.s_ = std::move(v);
            return x;
        }
        /** Flags list (copied in; a StoryletValue is a value). */
        static StoryletValue Flags(std::vector<std::string> v)
        {
            StoryletValue x;
            x.kind_ = StoryletKind::Flags;
            x.f_ = std::move(v);
            return x;
        }

        StoryletKind kind() const { return kind_; }
        bool isBool() const { return kind_ == StoryletKind::Bool; }
        bool isNumber() const { return kind_ == StoryletKind::Number; }
        bool isString() const { return kind_ == StoryletKind::Str; }
        bool isFlags() const { return kind_ == StoryletKind::Flags; }

        bool asBool() const { return b_; }
        double asNumber() const { return n_; }
        const std::string& asString() const { return s_; }
        const std::vector<std::string>& asFlags() const { return f_; }

        /** `==` / `!=` semantics: primitives by value; flags element-wise, in
         *  order; mixed kinds unequal (the evaluator's valueEquals). */
        bool valueEquals(const StoryletValue& other) const
        {
            if (kind_ == StoryletKind::Flags || other.kind_ == StoryletKind::Flags)
            {
                if (kind_ != StoryletKind::Flags || other.kind_ != StoryletKind::Flags) return false;
                return f_ == other.f_;
            }
            if (kind_ != other.kind_) return false;
            switch (kind_)
            {
                case StoryletKind::Bool: return b_ == other.b_;
                case StoryletKind::Number: return n_ == other.n_;
                case StoryletKind::Str: return s_ == other.s_;
                default: return false;
            }
        }

        /** The JSON.stringify-stable rendering the JS runner compares with (and
         *  the failure reports print). */
        std::string toJsonString() const
        {
            switch (kind_)
            {
                case StoryletKind::Bool: return b_ ? "true" : "false";
                case StoryletKind::Number: return JsNumber(n_);
                case StoryletKind::Str: return JsonQuote(s_);
                case StoryletKind::Flags:
                {
                    std::string out = "[";
                    for (size_t i = 0; i < f_.size(); ++i)
                    {
                        if (i > 0) out += ",";
                        out += JsonQuote(f_[i]);
                    }
                    return out + "]";
                }
                default: return "null";
            }
        }

        /** Format a double the way JavaScript's String(n) does for the values the
         *  corpus carries: integral doubles without a decimal point, everything
         *  else via the shortest string that round-trips. */
        static std::string JsNumber(double n)
        {
            if (std::isnan(n)) return "NaN";
            if (std::isinf(n)) return n > 0 ? "Infinity" : "-Infinity";
            if (n == std::floor(n) && std::fabs(n) < 1e21)
            {
                char buf[64];
                std::snprintf(buf, sizeof(buf), "%.0f", n);
                return std::string(buf);
            }
            for (int precision = 1; precision <= 17; ++precision)
            {
                char buf[64];
                std::snprintf(buf, sizeof(buf), "%.*g", precision, n);
                if (std::strtod(buf, nullptr) == n) return std::string(buf);
            }
            char buf[64];
            std::snprintf(buf, sizeof(buf), "%.17g", n);
            return std::string(buf);
        }

        static std::string JsonQuote(const std::string& s)
        {
            std::string out = "\"";
            for (char c : s)
            {
                switch (c)
                {
                    case '"': out += "\\\""; break;
                    case '\\': out += "\\\\"; break;
                    case '\n': out += "\\n"; break;
                    case '\r': out += "\\r"; break;
                    case '\t': out += "\\t"; break;
                    case '\b': out += "\\b"; break;   // JSON.stringify's short forms, not \u0008 / \u000c
                    case '\f': out += "\\f"; break;
                    default:
                        if (static_cast<unsigned char>(c) < 0x20)
                        {
                            char buf[8];
                            std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(static_cast<unsigned char>(c)));
                            out += buf;
                        }
                        else
                        {
                            out += c;
                        }
                        break;
                }
            }
            return out + "\"";
        }

    private:
        StoryletKind kind_;
        bool b_ = false;
        double n_ = 0;
        std::string s_;
        std::vector<std::string> f_;
    };
}
