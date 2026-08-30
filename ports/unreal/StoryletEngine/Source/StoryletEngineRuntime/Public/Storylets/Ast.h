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
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "Storylets/JsonValue.h"
#include "Storylets/StoryletValue.h"

namespace storylets
{
    enum class AstTag { Bool, Number, Str, ScopedVar, Unary, Binary, Call, FlagDelta };

    struct AstNode;
    using AstPtr = std::shared_ptr<const AstNode>;

    struct AstNode
    {
        AstTag tag = AstTag::Bool;
        bool b = false;                          // bool literal
        double n = 0;                            // number literal
        std::string s;                           // string literal
        std::string scope, name;                 // scopedvar (scope.name) / flagdelta (name)
        std::string op;                          // unary ("not" | "neg") / binary op
        std::string sign;                        // flagdelta sign ("+" | "-")
        std::string fn;                          // call name
        AstPtr left, right, operand;
        std::vector<AstPtr> args;
    };

    /** Published tagged-tuple AstNode -> in-memory node tree. */
    inline AstPtr DeserialiseAst(const JsonValue& node)
    {
        if (!node.isArray() || node.arr.empty() || !node.arr[0].isString())
        {
            throw StoryletError("malformed ast node");
        }
        const std::string& tag = node.arr[0].str;
        auto out = std::make_shared<AstNode>();
        if (tag == "b") { out->tag = AstTag::Bool; out->b = node.arr[1].b; }
        else if (tag == "n") { out->tag = AstTag::Number; out->n = node.arr[1].num; }
        else if (tag == "s") { out->tag = AstTag::Str; out->s = node.arr[1].str; }
        else if (tag == "sv") { out->tag = AstTag::ScopedVar; out->scope = node.arr[1].str; out->name = node.arr[2].str; }
        else if (tag == "u") { out->tag = AstTag::Unary; out->op = node.arr[1].str; out->operand = DeserialiseAst(node.arr[2]); }
        else if (tag == "bin")
        {
            out->tag = AstTag::Binary;
            out->op = node.arr[1].str;
            out->left = DeserialiseAst(node.arr[2]);
            out->right = DeserialiseAst(node.arr[3]);
        }
        else if (tag == "call")
        {
            out->tag = AstTag::Call;
            out->fn = node.arr[1].str;
            for (size_t i = 2; i < node.arr.size(); ++i) out->args.push_back(DeserialiseAst(node.arr[i]));
        }
        else if (tag == "fd") { out->tag = AstTag::FlagDelta; out->sign = node.arr[1].str; out->name = node.arr[2].str; }
        else throw StoryletError("unknown ast tag \"" + tag + "\"");
        return out;
    }

    /** A compiled expression envelope: canonical source + the deserialised AST.
     *  The TS bundle carries { src, ast } with ast in tagged-tuple form; the
     *  loader deserialises once at load, so the session's per-expression node
     *  cache disappears (the ast IS the node). */
    struct Expression
    {
        std::string src;
        AstPtr ast;
    };

    using ExpressionPtr = std::shared_ptr<const Expression>;
}
