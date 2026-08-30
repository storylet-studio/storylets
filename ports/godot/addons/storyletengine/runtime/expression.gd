@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# Evaluator - walk a node Dictionary against an eval context, parameterised by
# a dialect. Port of @wildwinter/expr's evaluate.ts.
#
# GDScript has no exceptions, so an eval error is a returned
# StoryletExpression.EvalError object (unambiguous: scalar values are only
# bool / float / String / Array). Callers test with is_error(). This is the ONE
# place the error type is defined; every eval-error path in the runtime speaks
# it. The semantics are identical to the TS throw paths: a condition that
# errors is a fail-plus-diagnostic, never a silent pass.
#
# Context shape:
#   {"scopes": {token: Dictionary bag | Callable get(name)}, "host": Dictionary}
# A scope absent from the map resolves to false (graceful). A property missing
# from a PRESENT scope follows the dialect's per-scope missing policy
# ("false" | "throw").
class_name StoryletExpression


class EvalError:
	extends RefCounted
	var message: String

	func _init(msg: String) -> void:
		message = msg


static func error(message: String) -> EvalError:
	return EvalError.new(message)


static func is_error(v) -> bool:
	return v is EvalError


## Evaluate `node` in `ctx` under `dialect`; returns a scalar value or an
## EvalError. Dialect shape: {"scopes": [{"token", "missing"?}], "default_scope",
## "functions": {name: Callable(args, helpers)}}.
static func evaluate(node: Dictionary, ctx: Dictionary, dialect: Dictionary) -> Variant:
	# Per-scope missing-property policy, precomputed once per top-level evaluate.
	var policy := {}
	for s in dialect.get("scopes", []):
		policy[s["token"]] = s.get("missing", "false")
	return _rec(node, ctx, dialect, policy)


static func _rec(n: Dictionary, ctx: Dictionary, dialect: Dictionary, policy: Dictionary) -> Variant:
	match n["kind"]:
		"bool", "number", "string":
			return n["value"]

		"scopedvar":
			var scopes: Dictionary = ctx.get("scopes", {})
			if not scopes.has(n["scope"]):
				# Scope context absent -> graceful false.
				return false
			var scope = scopes[n["scope"]]
			var val = null
			if scope is Callable:
				# A host resolver (foreign scope): Callable(name) -> value | null.
				val = scope.call(n["name"])
			elif scope is Dictionary:
				val = scope.get(n["name"])
			if val == null:
				# Property not declared on the present scope. Policy decides.
				if policy.get(n["scope"]) == "throw":
					return error("@%s.%s is not declared on the current %s." % [n["scope"], n["name"], n["scope"]])
				return false
			return val

		"call":
			var functions: Dictionary = dialect.get("functions", {})
			# `advance` is the language's own (quality.md): the next stage in the
			# argument's ladder, saturating at the last. A dialect defining its
			# own advance still wins.
			if n["name"] == "advance" and not functions.has("advance"):
				var args: Array = n["args"]
				if args.size() != 1:
					return error("advance() takes exactly 1 argument, got %d" % args.size())
				var adv_ladder = _ladder_of(args[0], ctx)
				if adv_ladder == null:
					return error("advance() needs a quality reference (@scope.name of a quality property)")
				var current = _rec(args[0], ctx, dialect, policy)
				if is_error(current):
					return current
				var idx = _stage_index(current, adv_ladder, "advance")
				if idx is EvalError:
					return idx
				return (adv_ladder as Array)[mini(int(idx) + 1, (adv_ladder as Array).size() - 1)]
			if not functions.has(n["name"]):
				return error("unknown function '%s'" % n["name"])
			var helpers := {
				"evaluate": func(child: Dictionary): return _rec(child, ctx, dialect, policy),
				"ctx": ctx,
			}
			return (functions[n["name"]] as Callable).call(n["args"], helpers)

		"flagdelta":
			return error("flagdelta node is only valid as an argument to a flag-delta function")

		"unary":
			var val = _rec(n["operand"], ctx, dialect, policy)
			if is_error(val):
				return val
			if n["op"] == "not":
				if typeof(val) != TYPE_BOOL:
					return error("'not' requires a boolean operand, got %s" % StoryletValues.type_name(val))
				return not val
			# neg
			if not StoryletValues.is_number(val):
				return error("unary '-' requires a numeric operand, got %s" % StoryletValues.type_name(val))
			return -float(val)

		"binary":
			return _binary(n, ctx, dialect, policy)

	return error("unknown node kind '%s'" % str(n.get("kind")))


# The ladder behind an operand NODE, when the context's quality channel says
# it references one (quality.md). Null for anything else.
static func _ladder_of(node: Dictionary, ctx: Dictionary) -> Variant:
	if not ctx.has("qualities") or node.get("kind") != "scopedvar":
		return null
	return (ctx["qualities"] as Callable).call(node["scope"], node["name"])


# Index of a stage in a ladder; an unknown stage is an error naming the value
# (a drifted save is exactly what lands here).
static func _stage_index(value: Variant, ladder: Variant, op: String) -> Variant:
	if not (value is String):
		return error("'%s' on a quality compares stages, got %s" % [op, StoryletValues.type_name(value)])
	var i: int = (ladder as Array).find(value)
	if i < 0:
		return error('"%s" is not a stage of this quality (stages: %s)' % [value, ", ".join(ladder as Array)])
	return i


static func _binary(n: Dictionary, ctx: Dictionary, dialect: Dictionary, policy: Dictionary) -> Variant:
	var op: String = n["op"]

	# Short-circuit operators first.
	if op == "and" or op == "or":
		var l = _rec(n["left"], ctx, dialect, policy)
		if is_error(l):
			return l
		if typeof(l) != TYPE_BOOL:
			return error("'%s' requires boolean operands, left is %s" % [op, StoryletValues.type_name(l)])
		if op == "and" and not l:
			return false
		if op == "or" and l:
			return true
		var r = _rec(n["right"], ctx, dialect, policy)
		if is_error(r):
			return r
		if typeof(r) != TYPE_BOOL:
			return error("'%s' requires boolean operands, right is %s" % [op, StoryletValues.type_name(r)])
		return r

	var left = _rec(n["left"], ctx, dialect, policy)
	if is_error(left):
		return left
	var right = _rec(n["right"], ctx, dialect, policy)
	if is_error(right):
		return right

	# Quality (quality.md): when either operand REFERENCES a quality, ordering
	# compares by ladder position and arithmetic is refused; == and != stay
	# plain value equality.
	var l_ladder = _ladder_of(n["left"], ctx)
	var r_ladder = _ladder_of(n["right"], ctx)
	var ladder = l_ladder if l_ladder != null else r_ladder
	if ladder != null:
		var ordering := op == ">" or op == ">=" or op == "<" or op == "<="
		if ordering and l_ladder != null and r_ladder != null and (l_ladder as Array) != (r_ladder as Array):
			return error("'%s' compares two different qualities, whose stage orders are unrelated" % op)
		if ordering:
			var li = _stage_index(left, ladder, op)
			if li is EvalError:
				return li
			var ri = _stage_index(right, ladder, op)
			if ri is EvalError:
				return ri
			match op:
				">":
					return int(li) > int(ri)
				">=":
					return int(li) >= int(ri)
				"<":
					return int(li) < int(ri)
				_:
					return int(li) <= int(ri)
		if op == "+" or op == "-" or op == "*" or op == "/":
			return error("'%s' cannot be applied to a quality - a stage is a position, not a number; use advance() to move it" % op)

	match op:
		"==":
			return StoryletValues.value_equals(left, right)
		"!=":
			return not StoryletValues.value_equals(left, right)
		">", ">=", "<", "<=":
			if not StoryletValues.is_number(left) or not StoryletValues.is_number(right):
				return error("'%s' requires numeric operands, got %s and %s" % [op, StoryletValues.type_name(left), StoryletValues.type_name(right)])
			var lf := float(left)
			var rf := float(right)
			match op:
				">":
					return lf > rf
				">=":
					return lf >= rf
				"<":
					return lf < rf
				_:
					return lf <= rf
		"+":
			if StoryletValues.is_number(left) and StoryletValues.is_number(right):
				return float(left) + float(right)
			if left is String and right is String:
				return left + right
			return error("'+' requires two numbers or two strings, got %s and %s" % [StoryletValues.type_name(left), StoryletValues.type_name(right)])
		"-", "*", "/":
			if not StoryletValues.is_number(left) or not StoryletValues.is_number(right):
				return error("'%s' requires numeric operands, got %s and %s" % [op, StoryletValues.type_name(left), StoryletValues.type_name(right)])
			var a := float(left)
			var b := float(right)
			match op:
				"-":
					return a - b
				"*":
					return a * b
				_:
					if b == 0.0:
						return error("division by zero")
					return a / b

	return error("unknown operator '%s'" % op)
