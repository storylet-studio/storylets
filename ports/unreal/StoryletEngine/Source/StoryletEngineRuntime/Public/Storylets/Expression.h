// The Storylets expression evaluator: a thin shim over the SHARED implementation.
//
// The algorithm lives once, in expr/ports/unreal/Expr.h, vendored beside this
// file as Expr/Expr.h. It is the shared kernel's (wildwinter::expr, one type
// with Patterplay's copy), and Kernel.h names IScopeSource, FnScope,
// MissingPolicy, ScopeDef, EvalContext, EvalHelpers, FunctionDef, Dialect,
// TypeOf and Evaluate in the `storylets` namespace, so every existing caller in
// this plugin reads exactly as it did before. How two plugins' copies stay one
// type, and fail to build rather than differ: expr/docs/port-sharing.md.
//
// The storylets dialect itself (five scopes, its built-ins) is Dialect.h.
// What stays here is BagScope, which is the one scope kind that reaches into
// this plugin's own OrderedMap and so cannot be shared.
#pragma once

#include "Storylets/Ast.h"
#include "Storylets/Kernel.h"   // the shared kernel (Expr/), its names in `storylets`, and kernelCall
#include "Storylets/StoryletValue.h"

namespace storylets
{
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
}
