// AST - the in-memory expression tree and its serialised tagged-tuple form.
// Port of @wildwinter/expr's ast.ts: one tagged node struct (the Patterplay
// C++ idiom; the reference's class-per-node hierarchy collapses onto a tag
// enum) plus the deserialiser for the compact tagged-array format compiled
// bundles carry ({ src, ast } envelopes; corpus expression cases carry bare
// ASTs). No port ships a parser - expressions arrive pre-compiled.
//
//   ["b",v] ["n",v] ["s",v] ["sv",scope,name] ["u",op,operand]
//   ["bin",op,left,right] ["call",name,...args] ["fd",sign,name]
//
// This layer is dialect-agnostic: scope tokens and function names are plain
// strings here; meaning is supplied by a Dialect (see Expression.h). The
// deserialiser consumes the core's neutral JsonValue tree, so the pure
// runtime needs no JSON library; hosts feed it from their own parsers.
//
// The NODE STRUCT is shared with Patterplay (expr/ports/unreal/Ast.h,
// vendored to Expr/Ast.h beside this). The deserialiser stays here because it
// needs a JSON type and each plugin ships its own.
#pragma once

#include <memory>
#include <string>
#include <vector>

// The node struct itself is the SHARED source, vendored from expr/ports/unreal.
#include "Storylets/Expr/Ast.h"
#include "Storylets/JsonValue.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    /** Published tagged-tuple AstNode -> in-memory node tree.
     *
     *  One line, because the tag dispatch is the SHARED source (Expr/Ast.h),
     *  parameterised on the JSON type. Our neutral JsonValue matches the default
     *  AstJson accessors, so there is nothing to specialise. */
    inline AstPtr DeserialiseAst(const JsonValue& node)
    {
        return DeserialiseAstFrom<JsonValue>(node);
    }

    struct Expression
    {
        std::string src;
        AstPtr ast;
    };

    using ExpressionPtr = std::shared_ptr<const Expression>;
}
