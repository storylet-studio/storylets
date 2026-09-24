// The Storylets expression evaluator: a thin shim over the SHARED implementation.
//
// The algorithm lives once, in expr/ports/unity/Expr.cs, vendored beside this
// file as Expr/Expr.cs. It is part of the expression kernel (namespace
// Wildwinter.Expr: ExprValue, IScopeSource, EvalContext, Dialect, Expr.Evaluate,
// ScopeRegistry, and the rest), which sits in its own assembly definition,
// StoryletEngine.Expr. The kernel is ONE type in a game: installed beside
// Patterplay 0.14.0 or newer, which carries the same kernel, this package's
// copy switches itself off and both engines run on Patterplay's, so both can be
// handed one registry. See expr/docs/port-sharing.md.
//
// The storylets dialect itself (five scopes, its built-ins) is Dialect.cs.
// What stays here is the engine's error types, the rethrow of the kernel's own
// errors as them, and BagScope.

using System;
using Wildwinter.Expr;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>The runtime's error type (TS throws plain Errors; one class per
    /// concern here keeps a catch specific).</summary>
    public class StoryletError : Exception
    {
        public StoryletError(string message) : base(message) { }
        internal StoryletError(string message, Exception inner) : base(message, inner) { }
    }

    /// <summary>An expression that cannot be evaluated. The kernel's own
    /// ExprError is rethrown as this, with the same message, wherever the engine
    /// evaluates.</summary>
    public sealed class EvalError : StoryletError
    {
        public EvalError(string message) : base(message) { }
        internal EvalError(string message, Exception inner) : base(message, inner) { }
    }

    /// <summary>The kernel's errors, as the engine's. Every call from the engine
    /// into the kernel that can refuse catches with <c>when (KernelErrors.Is(e))</c>
    /// and throws <c>KernelErrors.As(e)</c>: an ExprError becomes an EvalError and
    /// a RegistryError a StoryletError, as the engine threw before the kernel was
    /// shared, so a game's catch keeps working. A game calling the registry itself
    /// sees RegistryError.</summary>
    internal static class KernelErrors
    {
        internal static bool Is(Exception e) => e is ExprError || e is RegistryError;
        internal static StoryletError As(Exception e) =>
            e is ExprError ? new EvalError(e.Message, e) : new StoryletError(e.Message, e);
    }

    /// <summary>A static bag scope over an ordered values map (a PropertyBag's
    /// live values, or a composed @hand bag).</summary>
    public sealed class BagScope : IScopeSource
    {
        private readonly OrderedMap<string, ExprValue> _values;
        public BagScope(OrderedMap<string, ExprValue> values) { _values = values; }
        public ExprValue Get(string name) => _values.GetOrDefault(name);
    }
}
