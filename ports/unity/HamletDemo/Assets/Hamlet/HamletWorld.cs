// The shared world: ONE object, handed to BOTH engines.
//
// Each engine has its own resolver interface and its own value type (the two
// value types are the same shared source under two names), so this holds plain
// C# values once and converts at each door. The GAME's read-only policy lives
// here too: a story that tries to move a read-only value is refused loudly.
using System;
using System.Collections.Generic;
using StoryletStudio.StoryletEngine;
using Patterkit.Patterplay;
using Wildwinter.Expr;

namespace StoryletStudio.Hamlet
{
    public sealed class HamletWorld : IScopeResolver, IHostScope
    {
        public readonly Dictionary<string, object> Values = new Dictionary<string, object>();
        private readonly HashSet<string> _readOnly;
        public event Action Changed;

        public HamletWorld(Dictionary<string, object> initial, params string[] readOnly)
        {
            foreach (var kv in initial) Values[kv.Key] = kv.Value;
            _readOnly = new HashSet<string>(readOnly);
        }

        // --- the Storylet Engine's door (IScopeResolver) ---
        // Both packages declare an IScopeSource, so ours is named in full.
        ExprValue StoryletStudio.StoryletEngine.IScopeSource.Get(string name) => Values.TryGetValue(name, out var v) ? ToStorylet(v) : null;
        public bool CanSet => true;
        public void Set(string name, ExprValue value) => Write(name, FromStorylet(value));

        // --- Patter's door (IHostScope) ---
        PatterValue IHostScope.Get(string name) => Values.TryGetValue(name, out var v) ? ToPatter(v) : null;
        public void Set(string name, PatterValue value) => Write(name, FromPatter(value));

        // --- the host's own writes, which the read-only policy does not bind ---
        public void Host(string name, object value) { Values[name] = value; Changed?.Invoke(); }

        private void Write(string name, object value)
        {
            if (_readOnly.Contains(name)) throw new InvalidOperationException($"@world.{name} is the game's alone: a story tried to set it to {value}");
            Values[name] = value; Changed?.Invoke();
        }

        private static ExprValue ToStorylet(object v) => v switch
        {
            bool b => ExprValue.Bool(b), double d => ExprValue.Num(d), int i => ExprValue.Num(i),
            string s => ExprValue.Str(s), List<string> l => ExprValue.Flags(l), _ => null,
        };
        private static PatterValue ToPatter(object v) => v switch
        {
            bool b => PatterValue.Bool(b), double d => PatterValue.Num(d), int i => PatterValue.Num(i),
            string s => PatterValue.Str(s), List<string> l => PatterValue.Flags(l), _ => null,
        };
        private static object FromStorylet(ExprValue v) => v.IsBool ? v.AsBool : v.IsNumber ? (object)v.AsNumber : v.IsString ? v.AsString : null;
        private static object FromPatter(PatterValue v) => v.IsBool ? v.AsBool : v.IsNumber ? (object)v.AsNumber : v.IsString ? v.AsString : null;
    }
}
