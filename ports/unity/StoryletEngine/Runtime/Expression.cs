// The Storylets expression evaluator: a thin shim over the SHARED implementation.
//
// The algorithm lives once, in expr/ports/unity/Expr.cs, vendored beside this
// file as Expr/Expr.cs. It brings in IScopeSource, MissingPolicy, ScopeDef,
// EvalContext, EvalHelpers, FunctionDef, Dialect and Expr.Evaluate, all
// directly into this package's namespace, so every existing caller reads
// exactly as it did before.
//
// Shipping the shared code as its own assembly definition would break the
// moment a game installed both this and Patterplay, because Unity requires
// asmdef names to be unique project-wide. So it lives inside this package's
// own Runtime asmdef. Identity belongs to the installing package, never to the
// shared source. See expr/docs/port-sharing.md.
//
// The storylets dialect itself (five scopes, its built-ins) is Dialect.cs.
// What stays here is the error types, which the shared source expects the
// family to provide, and BagScope, the one scope kind that reaches into this
// package's own OrderedMap and so cannot be shared.

using System;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>The runtime's error type (TS throws plain Errors; one class per
    /// concern here keeps a catch specific).</summary>
    public class StoryletError : Exception
    {
        public StoryletError(string message) : base(message) { }
    }

    /// <summary>An expression that cannot be evaluated. The shared evaluator
    /// throws this, which is why it is declared here rather than there.</summary>
    public sealed class EvalError : StoryletError
    {
        public EvalError(string message) : base(message) { }
    }

    /// <summary>A static bag scope over an ordered values map (a PropertyBag's
    /// live values, or a composed @hand bag).</summary>
    public sealed class BagScope : IScopeSource
    {
        private readonly OrderedMap<string, StoryletValue> _values;
        public BagScope(OrderedMap<string, StoryletValue> values) { _values = values; }
        public StoryletValue Get(string name) => _values.GetOrDefault(name);
    }
}
