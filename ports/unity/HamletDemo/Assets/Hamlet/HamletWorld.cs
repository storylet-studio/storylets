// The shared world: ONE object, handed to BOTH engines.
//
// Both engines speak the one expression kernel's value type (Wildwinter.Expr),
// so a single Get and Set serve the Storylet Engine's resolver and Patter's
// host scope alike; this holds plain C# values once and converts at the door.
// The GAME's read-only policy lives here too: a story that tries to move a
// read-only value is refused loudly.
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

        // --- both engines' door ---
        public ExprValue Get(string name) => Values.TryGetValue(name, out var v) ? ToValue(v) : null;
        public bool CanSet => true;
        public void Set(string name, ExprValue value) => Write(name, FromValue(value));

        // --- the host's own writes, which the read-only policy does not bind ---
        public void Host(string name, object value) { Values[name] = value; Changed?.Invoke(); }

        private void Write(string name, object value)
        {
            if (_readOnly.Contains(name)) throw new InvalidOperationException($"@world.{name} is the game's alone: a story tried to set it to {value}");
            Values[name] = value; Changed?.Invoke();
        }

        private static ExprValue ToValue(object v) => v switch
        {
            bool b => ExprValue.Bool(b), double d => ExprValue.Num(d), int i => ExprValue.Num(i),
            string s => ExprValue.Str(s), List<string> l => ExprValue.Flags(l), _ => null,
        };
        private static object FromValue(ExprValue v) => v.IsBool ? v.AsBool : v.IsNumber ? (object)v.AsNumber : v.IsString ? v.AsString : null;
    }
}
