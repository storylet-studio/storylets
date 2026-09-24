// The runtime's error types, and the value type's Storylet Engine names.
//
// The value type is the SHARED KERNEL's, vendored from expr/ports/unreal to Expr/ beside this:
// wildwinter::expr::ExprValue, one type in every product since 2026-09-24, so a game can hand
// ONE registry to the Storylet Engine and Patterplay. StoryletValue and StoryletKind stay as
// aliases, so `storylets::StoryletValue` and its accessors read exactly as they did.
//
// The kernel throws its own errors (ExprError, RegistryError). The engine catches them where it
// calls the kernel and rethrows its own (kernelCall, in Kernel.h): an ExprError as EvalError, a
// RegistryError as StoryletError, as the engine threw them before the kernel was shared. So a
// host catching StoryletError still catches everything this runtime raises.
//
// Light on purpose: nothing here throws, so a module built without exceptions can include it
// (StoryletWorld.h and StoryletEngine.h do). The whole kernel, with every name it brings into
// `storylets`, is Storylets/Kernel.h.
#pragma once

#include <stdexcept>
#include <string>

#include "Storylets/Expr/Value.h"
#include "Storylets/Expr/Fwd.h"

namespace storylets
{
    using StoryletValue = wildwinter::expr::ExprValue;
    using StoryletKind = wildwinter::expr::ExprKind;

    // The kernel's types under the names the engine's code and games have always used
    // (storylets::ScopeRegistry, storylets::PropertyBag, ...): declared here, defined by Kernel.h.
    using wildwinter::expr::ExprValue;
    using wildwinter::expr::ExprKind;
    using wildwinter::expr::ExprError;
    using wildwinter::expr::RegistryError;
    using wildwinter::expr::OrderedMap;
    using wildwinter::expr::AstNode;
    using wildwinter::expr::IScopeSource;
    using wildwinter::expr::FnScope;
    using wildwinter::expr::EvalContext;
    using wildwinter::expr::Dialect;
    using wildwinter::expr::Mulberry32;
    using wildwinter::expr::ScopeDeclaration;
    using wildwinter::expr::BagChange;
    using wildwinter::expr::PropertyRow;
    using wildwinter::expr::PropertyBag;
    using wildwinter::expr::StateLogger;
    using wildwinter::expr::IScopeResolver;
    using wildwinter::expr::ScopePropertyRow;
    using wildwinter::expr::ScopeRegistry;

    /** The runtime's error type (TS throws plain Errors; one class per concern
     *  here keeps a catch specific). A refusal from the kernel's registry, a
     *  property bag or the ordered map beneath them is rethrown as this. */
    class StoryletError : public std::runtime_error
    {
    public:
        explicit StoryletError(const std::string& message) : std::runtime_error(message) {}
    };

    /** An expression that cannot be evaluated; the kernel's ExprError is
     *  rethrown as this. */
    class EvalError : public StoryletError
    {
    public:
        explicit EvalError(const std::string& message) : StoryletError(message) {}
    };
}
