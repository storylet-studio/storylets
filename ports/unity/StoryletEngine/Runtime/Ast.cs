// AST - the in-memory expression tree and its serialised tagged-tuple form.
// Port of @wildwinter/expr's ast.ts: the in-memory ExprNode hierarchy plus the
// deserialiser for the compact tagged-array format compiled bundles carry
// ({ src, ast } envelopes; corpus expression cases carry bare ASTs). No port
// ships a parser - expressions arrive pre-compiled.
//
// This layer is dialect-agnostic: scope tokens and function names are plain
// strings here; meaning is supplied by a Dialect (see Expression.cs).

using System.Collections.Generic;

namespace StoryletStudio.StoryletEngine
{
    public abstract class ExprNode { }

    public sealed class BoolNode : ExprNode { public bool Value; }
    public sealed class NumberNode : ExprNode { public double Value; }
    public sealed class StringNode : ExprNode { public string Value; }

    /// <summary>All property references are scoped: bare `@name` was already
    /// canonicalised to `@&lt;defaultScope&gt;.name` at compile time.</summary>
    public sealed class ScopedVarNode : ExprNode { public string Scope; public string Name; }

    public sealed class CallNode : ExprNode { public string Name; public ExprNode[] Args; }
    public sealed class UnaryNode : ExprNode { public string Op; public ExprNode Operand; }         // "not" | "neg"
    public sealed class BinaryNode : ExprNode { public string Op; public ExprNode Left; public ExprNode Right; }

    /// <summary>Produced only by flag-delta function argument parsing (see
    /// FunctionDef.FlagDeltaArgs) - not valid elsewhere.</summary>
    public sealed class FlagDeltaNode : ExprNode { public string Sign; public string Name; }         // "+" | "-"

    public static class Ast
    {
        /// <summary>Published tagged-tuple AstNode -&gt; in-memory ExprNode. The input
        /// is a neutral object tree (bool / double / string / IReadOnlyList of the
        /// same), so the pure runtime needs no JSON library; the Json layer feeds
        /// it from its parser.</summary>
        public static ExprNode DeserialiseAst(IReadOnlyList<object> node)
        {
            var tag = (string)node[0];
            switch (tag)
            {
                case "b": return new BoolNode { Value = (bool)node[1] };
                case "n": return new NumberNode { Value = (double)node[1] };
                case "s": return new StringNode { Value = (string)node[1] };
                case "sv": return new ScopedVarNode { Scope = (string)node[1], Name = (string)node[2] };
                case "u": return new UnaryNode { Op = (string)node[1], Operand = DeserialiseAst((IReadOnlyList<object>)node[2]) };
                case "bin":
                    return new BinaryNode
                    {
                        Op = (string)node[1],
                        Left = DeserialiseAst((IReadOnlyList<object>)node[2]),
                        Right = DeserialiseAst((IReadOnlyList<object>)node[3]),
                    };
                case "call":
                {
                    var args = new List<ExprNode>();
                    for (int i = 2; i < node.Count; i++) args.Add(DeserialiseAst((IReadOnlyList<object>)node[i]));
                    return new CallNode { Name = (string)node[1], Args = args.ToArray() };
                }
                case "fd": return new FlagDeltaNode { Sign = (string)node[1], Name = (string)node[2] };
                default: throw new StoryletError($"unknown ast tag \"{tag}\"");
            }
        }
    }

    /// <summary>A compiled expression envelope: canonical source + the deserialised
    /// AST. The TS bundle carries { src, ast } with ast in tagged-tuple form; the
    /// loader deserialises once at load, so the session's per-expression node
    /// cache disappears (Ast IS the node).</summary>
    public sealed class Expression
    {
        public string Src;
        public ExprNode Ast;
    }
}
