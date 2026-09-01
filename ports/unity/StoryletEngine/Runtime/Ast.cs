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
    // The node classes are the SHARED source, vendored to Expr/Ast.cs beside
    // this. What stays here is the deserialiser, which needs a JSON shape, and
    // the { src, ast } envelope, which is this bundle format's own.

    // The deserialiser is the SHARED source too, in Expr/Ast.cs: it takes a
    // NORMALISED tree (nested IReadOnlyList<object>), which is what lets one
    // implementation serve every JSON library. BundleLoader's ToTree does the
    // normalising, and that part IS library-specific.

    public sealed class Expression
    {
        public string Src;
        public ExprNode Ast;
    }
}
