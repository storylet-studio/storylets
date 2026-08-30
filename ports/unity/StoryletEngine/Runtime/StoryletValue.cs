// A storylets scalar value: boolean, number, string, or a flags list (string[]).
// Mirrors @wildwinter/expr's ScalarValue and the VALUE equality the JS runtime
// uses for == / != (primitives by value; flags element-wise, in order; mixed
// kinds unequal - the old PAR-3 lesson lives here, in one place).
//
// The storylets PropertyType set is boolean / number / string / enum / flags;
// an enum value is a string at runtime, so four kinds carry all five types.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace StoryletStudio.StoryletEngine
{
    public enum StoryletKind { Bool, Number, Str, Flags }

    public sealed class StoryletValue
    {
        public StoryletKind Kind { get; }
        private readonly bool _b;
        private readonly double _n;
        private readonly string _s;
        private readonly IReadOnlyList<string> _f;

        private StoryletValue(StoryletKind kind, bool b = false, double n = 0, string s = null, IReadOnlyList<string> f = null)
        {
            Kind = kind; _b = b; _n = n; _s = s; _f = f;
        }

        public static StoryletValue Bool(bool v) => v ? True : False;
        public static StoryletValue Num(double v) => new StoryletValue(StoryletKind.Number, n: v);
        public static StoryletValue Str(string v) => new StoryletValue(StoryletKind.Str, s: v ?? "");
        /// <summary>Flags list. The list is copied, so a StoryletValue is immutable.</summary>
        public static StoryletValue Flags(IEnumerable<string> v)
        {
            var list = v != null ? new List<string>(v) : new List<string>();
            return new StoryletValue(StoryletKind.Flags, f: list);
        }

        public static readonly StoryletValue False = new StoryletValue(StoryletKind.Bool, b: false);
        public static readonly StoryletValue True = new StoryletValue(StoryletKind.Bool, b: true);

        public bool IsBool => Kind == StoryletKind.Bool;
        public bool IsNumber => Kind == StoryletKind.Number;
        public bool IsString => Kind == StoryletKind.Str;
        public bool IsFlags => Kind == StoryletKind.Flags;

        public bool AsBool => _b;
        public double AsNumber => _n;
        public string AsString => _s;
        public IReadOnlyList<string> AsFlags => _f;

        /// <summary>`==` / `!=` semantics: primitives by value; flags element-wise,
        /// in order; mixed kinds unequal (the evaluator's valueEquals).</summary>
        public bool ValueEquals(StoryletValue other)
        {
            if (other == null) return false;
            if (Kind == StoryletKind.Flags || other.Kind == StoryletKind.Flags)
            {
                if (Kind != StoryletKind.Flags || other.Kind != StoryletKind.Flags) return false;
                if (_f.Count != other._f.Count) return false;
                for (int i = 0; i < _f.Count; i++) if (_f[i] != other._f[i]) return false;
                return true;
            }
            if (Kind != other.Kind) return false;
            switch (Kind)
            {
                case StoryletKind.Bool: return _b == other._b;
                case StoryletKind.Number: return _n == other._n;
                case StoryletKind.Str: return _s == other._s;
                default: return false;
            }
        }

        /// <summary>The JSON.stringify-stable rendering the JS runner compares with
        /// (and the failure reports print).</summary>
        public string ToJsonString()
        {
            switch (Kind)
            {
                case StoryletKind.Bool: return _b ? "true" : "false";
                case StoryletKind.Number: return JsNumber(_n);
                case StoryletKind.Str: return JsonQuote(_s);
                case StoryletKind.Flags:
                {
                    var sb = new StringBuilder("[");
                    for (int i = 0; i < _f.Count; i++)
                    {
                        if (i > 0) sb.Append(",");
                        sb.Append(JsonQuote(_f[i]));
                    }
                    return sb.Append("]").ToString();
                }
                default: return "null";
            }
        }

        /// <summary>Format a double the way JavaScript's String(n) does (the
        /// cross-runtime number-rendering contract).</summary>
        public static string JsNumber(double n)
        {
            if (double.IsNaN(n)) return "NaN";
            if (double.IsPositiveInfinity(n)) return "Infinity";
            if (double.IsNegativeInfinity(n)) return "-Infinity";
            // Integral doubles print without a decimal point (matches JS).
            if (n == Math.Floor(n) && Math.Abs(n) < 1e21)
                return ((long)n).ToString(CultureInfo.InvariantCulture);
            return n.ToString("R", CultureInfo.InvariantCulture);
        }

        public static string JsonQuote(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append("\"").ToString();
        }

        public override string ToString() => ToJsonString();
    }
}
