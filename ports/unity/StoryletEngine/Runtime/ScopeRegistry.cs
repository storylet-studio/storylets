// The scope registry / runtime state container: each named scope is either an
// OWNED scope (a property bag this registry stores and saves) or a FOREIGN
// scope (host- or other-engine-resolved at runtime, never stored here). Port
// of @wildwinter/scoperegistry's ScopeRegistry
// (expr/packages/scoperegistry/src/index.ts); the shared-kernel contract with
// Patter (design/engine-runtimes.md section 3).

using System;
using System.Collections.Generic;

namespace StoryletStudio.StoryletEngine
{
    /// <summary>A scope backed by a host resolver rather than a static bag - the
    /// basis for foreign scopes whose values live in a host or another engine.
    /// Get returns null when the scope does not have the property.</summary>
    public interface IScopeResolver : IScopeSource
    {
        /// <summary>Whether the resolver accepts writes at all (a TS resolver
        /// without `set` is read-only).</summary>
        bool CanSet { get; }
        void Set(string name, StoryletValue value);
    }

    /// <summary>The versioned owned-state fragment both product save envelopes
    /// embed (one serialisation shape for bags).</summary>
    public sealed class OwnedStateFragment
    {
        public int Version;
        public OrderedMap<string, OrderedMap<string, StoryletValue>> Scopes;
    }

    /// <summary>One scope in a scopeRegistrySpec: a token + (optional)
    /// declarations. Null declarations = an opaque scope (any name,
    /// unchecked).</summary>
    public sealed class ScopeSpec
    {
        public string Token;
        /// <summary>Scope-level read/write default for its declarations
        /// (default true).</summary>
        public bool? Writable;
        public List<ScopeDeclaration> Declarations;
    }

    /// <summary>The interop format an owner (Storylet Studio, a host game)
    /// exports so another engine can validate references into its scopes.
    /// Carried under the well-known `scopeRegistrySpec` JSON key (inside a
    /// .storyworld, or a standalone file).</summary>
    public sealed class ScopeRegistrySpec
    {
        public int Version;
        public List<ScopeSpec> Scopes;
    }

    public sealed class ScopeRegistry
    {
        public const int SAVE_FRAGMENT_VERSION = 1;

        /// <summary>The scopeRegistrySpec versions this build understands.</summary>
        public static readonly int[] SUPPORTED_SPEC_VERSIONS = { 1 };

        /// <summary>Extract + validate a `scopeRegistrySpec` from a parsed JSON
        /// value as the core's neutral tree (objects as
        /// OrderedMap&lt;string, object&gt; in document order, arrays as
        /// List&lt;object&gt;, scalars as bool / double / string, JSON null as
        /// null - the same host-built shape the AST path consumes). Returns null
        /// when the key is absent (so callers can probe arbitrary files); throws
        /// StoryletError on a malformed or unsupported-version spec.</summary>
        public static ScopeRegistrySpec ReadScopeRegistrySpec(object source)
        {
            var root = source as OrderedMap<string, object>;
            if (root == null || !root.ContainsKey("scopeRegistrySpec")) return null;
            var raw = root.GetOrDefault("scopeRegistrySpec") as OrderedMap<string, object>;
            if (raw == null) throw new StoryletError("scopeRegistrySpec must be an object");
            if (!(raw.GetOrDefault("version") is double version))
            {
                throw new StoryletError("scopeRegistrySpec.version must be a number");
            }
            bool supported = false;
            foreach (var v in SUPPORTED_SPEC_VERSIONS) supported = supported || version == v;
            if (!supported)
            {
                throw new StoryletError(
                    $"unsupported scopeRegistrySpec version {StoryletValue.JsNumber(version)} "
                    + $"(supported: {string.Join(", ", SUPPORTED_SPEC_VERSIONS)})");
            }
            if (!(raw.GetOrDefault("scopes") is IReadOnlyList<object> scopes))
            {
                throw new StoryletError("scopeRegistrySpec.scopes must be an array");
            }
            var spec = new ScopeRegistrySpec { Version = (int)version, Scopes = new List<ScopeSpec>() };
            foreach (var s in scopes)
            {
                var entry = s as OrderedMap<string, object>;
                if (entry == null || !(entry.GetOrDefault("token") is string token))
                {
                    throw new StoryletError("each scopeRegistrySpec scope needs a string token");
                }
                var scope = new ScopeSpec { Token = token };
                if (entry.GetOrDefault("writable") is bool writable) scope.Writable = writable;
                if (entry.GetOrDefault("declarations") is IReadOnlyList<object> decls)
                {
                    scope.Declarations = new List<ScopeDeclaration>();
                    foreach (var d in decls)
                    {
                        if (d is OrderedMap<string, object> decl) scope.Declarations.Add(ReadSpecDeclaration(decl));
                    }
                }
                spec.Scopes.Add(scope);
            }
            return spec;
        }

        /// <summary>One spec declaration, read leniently (the reference reader
        /// validates only version / scopes / token; the rest passes through).</summary>
        private static ScopeDeclaration ReadSpecDeclaration(OrderedMap<string, object> d)
        {
            var decl = new ScopeDeclaration
            {
                Name = d.GetOrDefault("name") as string ?? "",
                Type = d.GetOrDefault("type") as string ?? "",
            };
            if (d.GetOrDefault("values") is IReadOnlyList<object> values)
            {
                decl.Values = new List<string>();
                foreach (var v in values)
                {
                    if (v is string value) decl.Values.Add(value);
                }
            }
            if (d.ContainsKey("default")) decl.Default = SpecScalar(d.GetOrDefault("default"));
            if (d.GetOrDefault("writable") is bool writable) decl.Writable = writable;
            return decl;
        }

        /// <summary>A spec scalar (bool / number / string / string[]) as a
        /// runtime value; null for JSON null or an unsupported kind.</summary>
        private static StoryletValue SpecScalar(object node)
        {
            switch (node)
            {
                case bool b: return StoryletValue.Bool(b);
                case double n: return StoryletValue.Num(n);
                case string s: return StoryletValue.Str(s);
                case IReadOnlyList<object> items:
                {
                    var flags = new List<string>();
                    foreach (var item in items)
                    {
                        if (item is string flag) flags.Add(flag);
                    }
                    return StoryletValue.Flags(flags);
                }
                default: return null;
            }
        }

        private abstract class Entry { }
        private sealed class OwnedScope : Entry { public PropertyBag Bag; }
        private sealed class ForeignScope : Entry
        {
            public IScopeResolver Resolver;
            public OrderedMap<string, ScopeDeclaration> Decls;
            public bool ScopeWritable;
        }

        private readonly OrderedMap<string, Entry> _scopes = new OrderedMap<string, Entry>();

        /// <summary>Register a scope this registry owns and stores. Its bag is
        /// seeded from each declaration's default (or a type default).</summary>
        public ScopeRegistry DefineOwned(string token, IEnumerable<ScopeDeclaration> declarations)
        {
            return MountOwned(token, new PropertyBag(declarations));
        }

        /// <summary>Attach an EXISTING bag as an owned scope - the shared-container
        /// move: a host (or the other product) holds the bag; this registry reads,
        /// writes and lists it like its own, but the holder saves it.</summary>
        public ScopeRegistry MountOwned(string token, PropertyBag bag)
        {
            AssertFree(token);
            _scopes.Set(token, new OwnedScope { Bag = bag });
            return this;
        }

        /// <summary>An owned scope's bag (subscribe, audit, rows live there).</summary>
        public PropertyBag OwnedBag(string token)
        {
            var e = _scopes.GetOrDefault(token) as OwnedScope;
            if (e == null) throw new StoryletError($"'@{token}' is not an owned scope");
            return e.Bag;
        }

        /// <summary>Re-initialise an existing owned scope's bag from new
        /// declarations, clearing its current values. Mutates the bag in place, so
        /// an eval context already built from this registry stays valid.</summary>
        public ScopeRegistry ReseedOwned(string token, IEnumerable<ScopeDeclaration> declarations)
        {
            OwnedBag(token).Reseed(declarations);
            return this;
        }

        /// <summary>Register a FOREIGN scope backed by a host resolver. The values
        /// live in the host/other engine and are never stored or saved here.
        /// Declarations (optional) are used only for listing/validation; omit them
        /// for an opaque scope.</summary>
        public ScopeRegistry DefineForeign(
            string token,
            IScopeResolver resolver,
            IEnumerable<ScopeDeclaration> declarations = null,
            bool scopeWritable = true)
        {
            AssertFree(token);
            var decls = new OrderedMap<string, ScopeDeclaration>();
            if (declarations != null)
                foreach (var d in declarations) decls.Set(d.Name.ToLowerInvariant(), d);
            _scopes.Set(token, new ForeignScope { Resolver = resolver, Decls = decls, ScopeWritable = scopeWritable });
            return this;
        }

        public bool Has(string token) => _scopes.ContainsKey(token);

        /// <summary>Read a property; null if the scope or property is not present.</summary>
        public StoryletValue Get(string scope, string name)
        {
            var e = _scopes.GetOrDefault(scope);
            if (e == null) return null;
            if (e is OwnedScope owned) return owned.Bag.Get(name);
            return ((ForeignScope)e).Resolver.Get(name.ToLowerInvariant());
        }

        /// <summary>Write a property (an ENGINE write: the bag's subscribers fire;
        /// use the bag directly for silent host writes). Throws on an unknown or
        /// read-only scope/property.</summary>
        public void Set(string scope, string name, StoryletValue value)
        {
            var e = _scopes.GetOrDefault(scope);
            if (e == null) throw new StoryletError($"unknown scope '@{scope}'");
            if (e is OwnedScope owned)
            {
                try
                {
                    owned.Bag.Set(name, value);
                }
                catch (Exception)
                {
                    throw new StoryletError($"'@{scope}.{name}' is read-only");
                }
                return;
            }
            var foreign = (ForeignScope)e;
            var n = name.ToLowerInvariant();
            if (!ForeignWritable(foreign, n)) throw new StoryletError($"'@{scope}.{name}' is read-only");
            foreign.Resolver.Set(n, value);
        }

        private static bool ForeignWritable(ForeignScope e, string name)
        {
            if (!e.Resolver.CanSet) return false;              // no setter => read-only scope
            var decl = e.Decls.GetOrDefault(name);
            return decl?.Writable ?? e.ScopeWritable;
        }

        /// <summary>Examiner rows across every scope with a declared surface: owned
        /// bags first, then declared foreign scopes (values read through,
        /// writability reflecting the resolver). Opaque foreign scopes are not
        /// listed.</summary>
        public List<ScopePropertyRow> ListProperties()
        {
            var rows = new List<ScopePropertyRow>();
            foreach (var pair in _scopes)
            {
                if (pair.Value is OwnedScope owned)
                {
                    foreach (var row in owned.Bag.Rows()) rows.Add(ScopePropertyRow.From(pair.Key, row));
                }
                else
                {
                    var foreign = (ForeignScope)pair.Value;
                    foreach (var declPair in foreign.Decls)
                    {
                        var name = declPair.Value.Name.ToLowerInvariant();
                        var row = PropertyBag.RowFor(declPair.Value, foreign.Resolver.Get(name), ForeignWritable(foreign, name));
                        rows.Add(ScopePropertyRow.From(pair.Key, row));
                    }
                }
            }
            return rows;
        }

        /// <summary>Build the eval context the evaluator consumes: owned scopes as
        /// static bags, foreign scopes as their resolvers. `host` carries dialect
        /// callbacks and is passed through untouched.</summary>
        public EvalContext ToEvalContext(object host = null)
        {
            var ctx = new EvalContext { Host = host };
            foreach (var pair in _scopes)
            {
                if (pair.Value is OwnedScope owned) ctx.Scopes[pair.Key] = new BagScope(owned.Bag.Values);
                else ctx.Scopes[pair.Key] = ((ForeignScope)pair.Value).Resolver;
            }
            // The quality channel (quality.md): declared here once, so a host
            // that registers a quality gets ordering comparisons and advance()
            // with no further wiring. Only wired when a quality exists, so
            // contexts stay identical for products that declare none. The JS
            // kernel has had this since qualities landed and all three ports
            // returned scopes and host alone, so a host driving the registry
            // DIRECTLY (the engine builds its own context and is unaffected)
            // silently lost every ladder (2026-08-29).
            var ladders = QualityLadders();
            if (ladders.Count > 0)
            {
                ctx.Qualities = (scope, name) =>
                {
                    Dictionary<string, List<string>> m;
                    if (!ladders.TryGetValue(scope, out m)) return null;
                    List<string> stages;
                    return m.TryGetValue(name.ToLowerInvariant(), out stages) ? stages : null;
                };
            }
            return ctx;
        }

        /// <summary>Every quality declaration's ladder, keyed scope token then
        /// lower-cased name.</summary>
        private Dictionary<string, Dictionary<string, List<string>>> QualityLadders()
        {
            var out_ = new Dictionary<string, Dictionary<string, List<string>>>();
            foreach (var pair in _scopes)
            {
                List<ScopeDeclaration> decls;
                if (pair.Value is OwnedScope owned) decls = owned.Bag.Declarations();
                else
                {
                    decls = new List<ScopeDeclaration>();
                    foreach (var declPair in ((ForeignScope)pair.Value).Decls) decls.Add(declPair.Value);
                }
                foreach (var d in decls)
                {
                    if (d.Type != PropertyTypes.Quality || d.Stages == null) continue;
                    Dictionary<string, List<string>> m;
                    if (!out_.TryGetValue(pair.Key, out m))
                    {
                        m = new Dictionary<string, List<string>>();
                        out_[pair.Key] = m;
                    }
                    m[d.Name.ToLowerInvariant()] = d.Stages;
                }
            }
            return out_;
        }

        /// <summary>Serialise OWNED scopes only (foreign scopes are host-owned,
        /// host-saved), as bare bags.</summary>
        public OrderedMap<string, OrderedMap<string, StoryletValue>> Save()
        {
            var blob = new OrderedMap<string, OrderedMap<string, StoryletValue>>();
            foreach (var pair in _scopes)
                if (pair.Value is OwnedScope owned) blob.Set(pair.Key, owned.Bag.Save());
            return blob;
        }

        /// <summary>Restore owned-scope values from a Save blob. Unknown/foreign
        /// scopes are ignored.</summary>
        public void Load(OrderedMap<string, OrderedMap<string, StoryletValue>> blob)
        {
            foreach (var pair in blob)
            {
                if (_scopes.GetOrDefault(pair.Key) is OwnedScope owned) owned.Bag.Load(pair.Value);
            }
        }

        /// <summary>The versioned owned-state fragment: Save() wrapped with a
        /// version stamp.</summary>
        public OwnedStateFragment SaveFragment()
        {
            return new OwnedStateFragment { Version = SAVE_FRAGMENT_VERSION, Scopes = Save() };
        }

        /// <summary>Restore from a versioned fragment; an unsupported version throws.</summary>
        public void LoadFragment(OwnedStateFragment fragment)
        {
            if (fragment.Version != SAVE_FRAGMENT_VERSION)
            {
                throw new StoryletError(
                    $"unsupported owned-state fragment version {fragment.Version} (supported: {SAVE_FRAGMENT_VERSION})");
            }
            Load(fragment.Scopes);
        }

        private void AssertFree(string token)
        {
            if (_scopes.ContainsKey(token)) throw new StoryletError($"scope '@{token}' is already registered");
        }
    }

    /// <summary>A PropertyRow with the scope token it belongs to (the registry's
    /// listProperties row shape).</summary>
    public sealed class ScopePropertyRow : PropertyRow
    {
        public string Scope;

        internal static ScopePropertyRow From(string scope, PropertyRow row)
        {
            return new ScopePropertyRow
            {
                Scope = scope,
                Name = row.Name,
                Type = row.Type,
                Value = row.Value,
                Default = row.Default,
                Values = row.Values,
                Writable = row.Writable,
            };
        }
    }
}
