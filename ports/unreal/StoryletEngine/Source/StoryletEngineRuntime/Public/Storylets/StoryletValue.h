// The runtime's error types, and the scalar value type.
//
// StoryletValue and StoryletKind are the SHARED source, vendored from
// expr/ports/unreal/Value.h to Expr/Value.h beside this; they land in the
// `storylets` namespace, so they read here exactly as they did when this file
// held them. The errors stay, because the shared evaluator throws EvalError and
// expects the family to declare it: a host catching StoryletError still catches
// everything this runtime raises.
#pragma once

#include <stdexcept>
#include <string>

#include "Storylets/Expr/Value.h"

namespace storylets
{
    /** The runtime's error type (TS throws plain Errors; one class per concern
     *  here keeps a catch specific). */
    class StoryletError : public std::runtime_error
    {
    public:
        explicit StoryletError(const std::string& message) : std::runtime_error(message) {}
    };

    /** An expression that cannot be evaluated. */
    class EvalError : public StoryletError
    {
    public:
        explicit EvalError(const std::string& message) : StoryletError(message) {}
    };
}
