@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The Storylets expression evaluator: a thin shim over the SHARED implementation.
#
# The algorithm lives once, in expr/ports/godot/expr_eval.gd, vendored beside
# this file as expr/expr_eval.gd. This file exists only to give it a Storylet
# Engine identity: `class_name StoryletExpression`, so every existing caller in
# this addon reads exactly as it did before.
#
# The shared source deliberately declares NO class_name. Godot registers
# class_name in a PROJECT-WIDE namespace, so if both this addon and Patterplay's
# vendored the same named class, installing both in one game would be a hard
# editor error. Identity belongs to the installing plugin; the shared source
# stays anonymous. See expr/docs/port-sharing.md.
#
# The dialect (Storylets' five scopes and its built-ins) is StoryletDialect; the
# evaluator takes it as a parameter, which is what lets one file serve two
# products.
class_name StoryletExpression

const Impl := preload("expr/expr_eval.gd")

## The eval-error type. GDScript has no exceptions, so a refusal is a returned
## object; callers test with is_error().
const EvalError := Impl.EvalError


static func error(message: String) -> Impl.EvalError:
	return Impl.error(message)


static func is_error(v) -> bool:
	return Impl.is_error(v)


## Evaluate `node` in `ctx` under `dialect`; a scalar value or an EvalError.
static func evaluate(node: Array, ctx: Dictionary, dialect: Dictionary) -> Variant:
	return Impl.evaluate(node, ctx, dialect)
