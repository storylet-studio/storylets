// The scope registry / runtime state container: each named scope is either an
// OWNED scope (a property bag this registry stores and saves) or a FOREIGN
// scope (host- or other-engine-resolved at runtime, never stored here). Port
// of @wildwinter/scoperegistry's ScopeRegistry
// (expr/packages/scoperegistry/src/index.ts); the shared-kernel contract with
// Patter (design/engine-runtimes.md section 3).
#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "Storylets/Expression.h"
#include "Storylets/JsonValue.h"
#include "Storylets/OrderedMap.h"
#include "Storylets/PropertyBag.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** A scope backed by a host resolver rather than a static bag - the basis
     *  for foreign scopes whose values live in a host or another engine.
     *  get returns nullopt when the scope does not have the property. */
    class IScopeResolver : public IScopeSource
    {
    public:
        /** Whether the resolver accepts writes at all (a TS resolver without
         *  `set` is read-only). */
        virtual bool canSet() const = 0;
        virtual void set(const std::string& name, const StoryletValue& value) = 0;
    };

    /** The versioned owned-state fragment both product save envelopes embed
     *  (one serialisation shape for bags). */
    struct OwnedStateFragment
    {
        int version = 0;
        OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> scopes;
    };

    /** One scope in a scopeRegistrySpec: a token + (optional) declarations.
     *  Absent declarations = an opaque scope (any name, unchecked). */
    struct ScopeSpec
    {
        std::string token;
        /** Scope-level read/write default for its declarations (default true). */
        std::optional<bool> writable;
        std::optional<std::vector<ScopeDeclaration>> declarations;
    };

    /** The interop format an owner (Storylet Studio, a host game) exports so
     *  another engine can validate references into its scopes. Carried under
     *  the well-known `scopeRegistrySpec` JSON key (inside a .storyworld, or a
     *  standalone file). */
    struct ScopeRegistrySpec
    {
        int version = 0;
        std::vector<ScopeSpec> scopes;
    };

    /** A PropertyRow with the scope token it belongs to (the registry's
     *  listProperties row shape). */
    struct ScopePropertyRow : PropertyRow
    {
        std::string scope;

        static ScopePropertyRow From(const std::string& scopeToken, const PropertyRow& row)
        {
            ScopePropertyRow out;
            out.scope = scopeToken;
            out.name = row.name;
            out.type = row.type;
            out.value = row.value;
            out.defaultValue = row.defaultValue;
            out.values = row.values;
            out.writable = row.writable;
            return out;
        }
    };

    class ScopeRegistry
    {
    public:
        static constexpr int SAVE_FRAGMENT_VERSION = 1;

        /** The scopeRegistrySpec version this build understands. */
        static constexpr int SUPPORTED_SPEC_VERSION = 1;

        /** Extract + validate a `scopeRegistrySpec` from any JsonValue tree (a
         *  parsed .storyworld bundle, or a vanilla { scopeRegistrySpec: ... }
         *  manifest). Returns nullopt when the key is absent (so callers can
         *  probe arbitrary files); throws StoryletError on a malformed or
         *  unsupported-version spec. */
        static std::optional<ScopeRegistrySpec> readScopeRegistrySpec(const JsonValue& source)
        {
            if (!source.isObject()) return std::nullopt;
            const JsonValue* raw = source.find("scopeRegistrySpec");
            if (!raw) return std::nullopt;
            if (!raw->isObject()) throw StoryletError("scopeRegistrySpec must be an object");
            const JsonValue* version = raw->find("version");
            if (!version || !version->isNumber())
            {
                throw StoryletError("scopeRegistrySpec.version must be a number");
            }
            if (version->num != static_cast<double>(SUPPORTED_SPEC_VERSION))
            {
                throw StoryletError("unsupported scopeRegistrySpec version "
                    + StoryletValue::JsNumber(version->num)
                    + " (supported: " + std::to_string(SUPPORTED_SPEC_VERSION) + ")");
            }
            const JsonValue* scopes = raw->find("scopes");
            if (!scopes || !scopes->isArray())
            {
                throw StoryletError("scopeRegistrySpec.scopes must be an array");
            }
            ScopeRegistrySpec spec;
            spec.version = static_cast<int>(version->num);
            for (const JsonValue& s : scopes->arr)
            {
                const JsonValue* token = s.isObject() ? s.find("token") : nullptr;
                if (!token || !token->isString())
                {
                    throw StoryletError("each scopeRegistrySpec scope needs a string token");
                }
                ScopeSpec scope;
                scope.token = token->str;
                const JsonValue* writable = s.find("writable");
                if (writable && writable->isBool()) scope.writable = writable->b;
                const JsonValue* decls = s.find("declarations");
                if (decls && decls->isArray())
                {
                    scope.declarations.emplace();
                    for (const JsonValue& d : decls->arr)
                    {
                        if (d.isObject()) scope.declarations->push_back(readSpecDeclaration(d));
                    }
                }
                spec.scopes.push_back(std::move(scope));
            }
            return spec;
        }

        /** Register a scope this registry owns and stores. Its bag is seeded
         *  from each declaration's default (or a type default). */
        ScopeRegistry& defineOwned(const std::string& token, const std::vector<ScopeDeclaration>& declarations)
        {
            return mountOwned(token, std::make_shared<PropertyBag>(&declarations));
        }

        /** Attach an EXISTING bag as an owned scope - the shared-container
         *  move: a host (or the other product) holds the bag; this registry
         *  reads, writes and lists it like its own, but the holder saves it. */
        ScopeRegistry& mountOwned(const std::string& token, std::shared_ptr<PropertyBag> bag)
        {
            assertFree(token);
            Entry e;
            e.kind = Entry::Owned;
            e.bag = std::move(bag);
            scopes_.set(token, std::move(e));
            return *this;
        }

        /** An owned scope's bag (subscribe, audit, rows live there). */
        const std::shared_ptr<PropertyBag>& ownedBag(const std::string& token) const
        {
            const Entry* e = scopes_.get(token);
            if (!e || e->kind != Entry::Owned)
            {
                throw StoryletError("'@" + token + "' is not an owned scope");
            }
            return e->bag;
        }

        /** Re-initialise an existing owned scope's bag from new declarations,
         *  clearing its current values. Mutates the bag in place, so an eval
         *  context already built from this registry stays valid. */
        ScopeRegistry& reseedOwned(const std::string& token, const std::vector<ScopeDeclaration>& declarations)
        {
            ownedBag(token)->reseed(&declarations);
            return *this;
        }

        /** Register a FOREIGN scope backed by a host resolver. The values live
         *  in the host/other engine and are never stored or saved here.
         *  Declarations (optional) are used only for listing/validation; omit
         *  them for an opaque scope. */
        ScopeRegistry& defineForeign(
            const std::string& token,
            std::shared_ptr<IScopeResolver> resolver,
            const std::vector<ScopeDeclaration>* declarations = nullptr,
            bool scopeWritable = true)
        {
            assertFree(token);
            Entry e;
            e.kind = Entry::Foreign;
            e.resolver = std::move(resolver);
            e.scopeWritable = scopeWritable;
            if (declarations)
            {
                for (const auto& d : *declarations) e.decls.set(LowercaseName(d.name), d);
            }
            scopes_.set(token, std::move(e));
            return *this;
        }

        bool has(const std::string& token) const { return scopes_.contains(token); }

        /** Read a property; nullopt if the scope or property is not present. */
        std::optional<StoryletValue> get(const std::string& scope, const std::string& name) const
        {
            const Entry* e = scopes_.get(scope);
            if (!e) return std::nullopt;
            if (e->kind == Entry::Owned) return e->bag->get(name);
            return e->resolver->get(LowercaseName(name));
        }

        /** Write a property (an ENGINE write: the bag's subscribers fire; use
         *  the bag directly for silent host writes). Throws on an unknown or
         *  read-only scope/property. */
        void set(const std::string& scope, const std::string& name, const StoryletValue& value)
        {
            Entry* e = scopes_.get(scope);
            if (!e) throw StoryletError("unknown scope '@" + scope + "'");
            if (e->kind == Entry::Owned)
            {
                try
                {
                    e->bag->set(name, value);
                }
                catch (const std::exception&)
                {
                    throw StoryletError("'@" + scope + "." + name + "' is read-only");
                }
                return;
            }
            std::string n = LowercaseName(name);
            if (!foreignWritable(*e, n)) throw StoryletError("'@" + scope + "." + name + "' is read-only");
            e->resolver->set(n, value);
        }

        /** Examiner rows across every scope with a declared surface: owned bags
         *  first-registered first, then declared foreign scopes (values read
         *  through, writability reflecting the resolver). Opaque foreign scopes
         *  are not listed. */
        std::vector<ScopePropertyRow> listProperties() const
        {
            std::vector<ScopePropertyRow> rows;
            for (const auto& pair : scopes_)
            {
                const Entry& e = pair.second;
                if (e.kind == Entry::Owned)
                {
                    for (const auto& row : e.bag->rows()) rows.push_back(ScopePropertyRow::From(pair.first, row));
                }
                else
                {
                    for (const auto& declPair : e.decls)
                    {
                        std::string name = LowercaseName(declPair.second.name);
                        std::optional<StoryletValue> value = e.resolver->get(name);
                        PropertyRow row = PropertyBag::RowFor(declPair.second,
                            value.has_value() ? *value : declPair.second.defaultOrTypeDefault(),
                            foreignWritable(e, name));
                        rows.push_back(ScopePropertyRow::From(pair.first, row));
                    }
                }
            }
            return rows;
        }

        /** Build the eval context the evaluator consumes: owned scopes as
         *  static bags, foreign scopes as their resolvers. `host` carries
         *  dialect callbacks and is passed through untouched. */
        EvalContext toEvalContext(const void* host = nullptr) const
        {
            EvalContext ctx;
            ctx.host = host;
            for (const auto& pair : scopes_)
            {
                const Entry& e = pair.second;
                if (e.kind == Entry::Owned)
                {
                    ctx.scopes[pair.first] = std::make_shared<BagScope>(e.bag->values());
                }
                else
                {
                    ctx.scopes[pair.first] = e.resolver;
                }
            }
            // The quality channel (quality.md): declared here once, so a host
            // that registers a quality gets ordering comparisons and advance()
            // with no further wiring. Only wired when a quality exists, so
            // contexts stay identical for products that declare none. The JS
            // kernel (../expr scoperegistry) has had this since qualities
            // landed and all three ports returned scopes and host alone, so a
            // host driving the registry DIRECTLY - the engine builds its own
            // context and is unaffected - silently lost every ladder
            // (2026-08-29). Patterplay's ports do not vendor this registry at
            // all, so the reference here is the kernel, not the sibling.
            auto ladders = std::make_shared<OrderedMap<std::string, OrderedMap<std::string, std::vector<std::string>>>>(
                qualityLadders());
            if (ladders->size() > 0)
            {
                ctx.qualities = [ladders](const std::string& scope, const std::string& name)
                    -> const std::vector<std::string>*
                {
                    const OrderedMap<std::string, std::vector<std::string>>* m = ladders->get(scope);
                    return m ? m->get(LowercaseName(name)) : nullptr;
                };
            }
            return ctx;
        }

        /** Every quality declaration's ladder, keyed scope token then
         *  lower-cased name. */
        OrderedMap<std::string, OrderedMap<std::string, std::vector<std::string>>> qualityLadders() const
        {
            OrderedMap<std::string, OrderedMap<std::string, std::vector<std::string>>> out;
            for (const auto& pair : scopes_)
            {
                const Entry& e = pair.second;
                std::vector<ScopeDeclaration> decls;
                if (e.kind == Entry::Owned)
                {
                    decls = e.bag->declarations();
                }
                else
                {
                    for (const auto& d : e.decls) decls.push_back(d.second);
                }
                for (const auto& d : decls)
                {
                    if (d.type != "quality" || !d.stages.has_value()) continue;
                    OrderedMap<std::string, std::vector<std::string>>* m = out.get(pair.first);
                    if (!m)
                    {
                        out.set(pair.first, OrderedMap<std::string, std::vector<std::string>>{});
                        m = out.get(pair.first);
                    }
                    m->set(LowercaseName(d.name), *d.stages);
                }
            }
            return out;
        }

        /** Serialise OWNED scopes only (foreign scopes are host-owned,
         *  host-saved), as bare bags. */
        OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> save() const
        {
            OrderedMap<std::string, OrderedMap<std::string, StoryletValue>> blob;
            for (const auto& pair : scopes_)
            {
                if (pair.second.kind == Entry::Owned) blob.set(pair.first, pair.second.bag->save());
            }
            return blob;
        }

        /** Restore owned-scope values from a save blob. Unknown/foreign scopes
         *  are ignored. */
        void load(const OrderedMap<std::string, OrderedMap<std::string, StoryletValue>>& blob)
        {
            for (const auto& pair : blob)
            {
                Entry* e = scopes_.get(pair.first);
                if (e && e->kind == Entry::Owned) e->bag->load(pair.second);
            }
        }

        /** The versioned owned-state fragment: save() wrapped with a version
         *  stamp. */
        OwnedStateFragment saveFragment() const
        {
            OwnedStateFragment fragment;
            fragment.version = SAVE_FRAGMENT_VERSION;
            fragment.scopes = save();
            return fragment;
        }

        /** Restore from a versioned fragment; an unsupported version throws. */
        void loadFragment(const OwnedStateFragment& fragment)
        {
            if (fragment.version != SAVE_FRAGMENT_VERSION)
            {
                throw StoryletError("unsupported owned-state fragment version "
                    + std::to_string(fragment.version)
                    + " (supported: " + std::to_string(SAVE_FRAGMENT_VERSION) + ")");
            }
            load(fragment.scopes);
        }

    private:
        /** One spec declaration, read leniently (the reference reader
         *  validates only version / scopes / token; the rest passes through). */
        static ScopeDeclaration readSpecDeclaration(const JsonValue& d)
        {
            ScopeDeclaration decl;
            decl.name = d.strOr("name");
            decl.type = d.strOr("type");
            const JsonValue* values = d.find("values");
            if (values && values->isArray())
            {
                std::vector<std::string> list;
                for (const JsonValue& v : values->arr)
                {
                    if (v.isString()) list.push_back(v.str);
                }
                decl.values = std::move(list);
            }
            const JsonValue* def = d.find("default");
            if (def) decl.defaultValue = specScalar(*def);
            const JsonValue* writable = d.find("writable");
            if (writable && writable->isBool()) decl.writable = writable->b;
            return decl;
        }

        /** A spec scalar (bool / number / string / string[]) as a runtime
         *  value; nullopt for JSON null or an unsupported kind. */
        static std::optional<StoryletValue> specScalar(const JsonValue& v)
        {
            switch (v.type)
            {
                case JsonValue::Bool: return StoryletValue::Bool(v.b);
                case JsonValue::Number: return StoryletValue::Num(v.num);
                case JsonValue::String: return StoryletValue::Str(v.str);
                case JsonValue::Array:
                {
                    std::vector<std::string> flags;
                    for (const JsonValue& item : v.arr)
                    {
                        if (item.isString()) flags.push_back(item.str);
                    }
                    return StoryletValue::Flags(std::move(flags));
                }
                default: return std::nullopt;
            }
        }

        struct Entry
        {
            enum Kind { Owned, Foreign };
            Kind kind = Owned;
            std::shared_ptr<PropertyBag> bag;                     // owned scopes
            std::shared_ptr<IScopeResolver> resolver;             // foreign scopes
            OrderedMap<std::string, ScopeDeclaration> decls;      // foreign scopes
            bool scopeWritable = true;                            // foreign scopes
        };

        static bool foreignWritable(const Entry& e, const std::string& name)
        {
            if (!e.resolver->canSet()) return false;              // no setter => read-only scope
            const ScopeDeclaration* decl = e.decls.get(name);
            if (decl && decl->writable.has_value()) return *decl->writable;
            return e.scopeWritable;
        }

        void assertFree(const std::string& token) const
        {
            if (scopes_.contains(token)) throw StoryletError("scope '@" + token + "' is already registered");
        }

        OrderedMap<std::string, Entry> scopes_;
    };
}
