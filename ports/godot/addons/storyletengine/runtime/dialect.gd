@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The storylets expression dialect - port of @storylet-studio/dialect. Five
# scopes, fixed (Reboot 3); a missing property in a PRESENT scope is always an
# error (every property is declared with a default, so absence means a publish
# bug, a drifted save, or a foreign scope the host never fed - schema 6.2).
# Function eval semantics: random / check_flags / set_flags carried from the
# old engine; the play-history functions are the set pinned in schema 6.3.
#
# Host callbacks read from the context's "host" Dictionary (the runtime
# supplies them; keys are snake_case in this port):
#   next_random() -> float                 one PRNG draw in [0, 1)
#   count_played(card) -> float            plays of the card (gameId)
#   turns_since_played(card) -> float      NEVER_PLAYED when never
#   count_played_in(group, tag) -> float
#   turns_since_played_in(group, tag) -> float
class_name StoryletDialect

## turns_since_played / _in when the card / value has never been played.
const NEVER_PLAYED := 9999.0


## Build the dialect descriptor StoryletExpression.evaluate consumes. Callers
## should hold one instance (the session builds it once).
static func dialect() -> Dictionary:
	return {
		"scopes": [
			{"token": "story", "missing": "throw"},
			{"token": "world", "missing": "throw"},
			{"token": "box", "missing": "throw"},
			{"token": "deck", "missing": "throw"},
			{"token": "hand", "missing": "throw"},
		],
		"default_scope": "story",
		"functions": {
			"random": Callable(StoryletDialect, "_fn_random"),
			"check_flags": Callable(StoryletDialect, "_fn_check_flags"),
			"set_flags": Callable(StoryletDialect, "_fn_set_flags"),
			"count_played": Callable(StoryletDialect, "_fn_count_played"),
			"turns_since_played": Callable(StoryletDialect, "_fn_turns_since_played"),
			"count_played_in": Callable(StoryletDialect, "_fn_count_played_in"),
			"turns_since_played_in": Callable(StoryletDialect, "_fn_turns_since_played_in"),
		},
	}


static func _host(h: Dictionary) -> Dictionary:
	var host = h["ctx"].get("host")
	return host if host is Dictionary else {}


# Evaluate argument i and require a non-empty string.
static func _string_arg(fn: String, args: Array, h: Dictionary, i: int) -> Variant:
	var v = (h["evaluate"] as Callable).call(args[i])
	if StoryletExpression.is_error(v):
		return v
	if not (v is String) or v == "":
		return StoryletExpression.error("%s() argument %d must be a non-empty string" % [fn, i + 1])
	return v


# Resolve the first argument of check_flags / set_flags to a flag set.
static func _flags_arg(fn: String, args: Array, h: Dictionary) -> Variant:
	if args.is_empty():
		return StoryletExpression.error("%s() requires at least one argument (the flags property)" % fn)
	var v = (h["evaluate"] as Callable).call(args[0])
	if StoryletExpression.is_error(v):
		return v
	if v is Array:
		return v
	# An unset flags property may surface as false; treat as the empty set
	# (carried from the old dialect). Anything else is a type error.
	if typeof(v) == TYPE_BOOL and v == false:
		return []
	return StoryletExpression.error("%s() first argument must be a flags property" % fn)


static func _fn_random(args: Array, h: Dictionary) -> Variant:
	if args.size() != 2:
		return StoryletExpression.error("random(a, b) requires exactly 2 arguments")
	var next_random = _host(h).get("next_random")
	if not (next_random is Callable):
		return StoryletExpression.error("random() called without a PRNG in context")
	var a = (h["evaluate"] as Callable).call(args[0])
	if StoryletExpression.is_error(a):
		return a
	var b = (h["evaluate"] as Callable).call(args[1])
	if StoryletExpression.is_error(b):
		return b
	if not StoryletValues.is_number(a) or not StoryletValues.is_number(b):
		return StoryletExpression.error("random(a, b) arguments must be numbers")
	var af := float(a)
	var bf := float(b)
	if af != floor(af) or bf != floor(bf):
		return StoryletExpression.error("random(a, b) arguments must be integers")
	var lo := minf(af, bf)
	var hi := maxf(af, bf)
	return floor(float(next_random.call()) * (hi - lo + 1.0)) + lo


static func _fn_check_flags(args: Array, h: Dictionary) -> Variant:
	var flags = _flags_arg("check_flags", args, h)
	if StoryletExpression.is_error(flags):
		return flags
	for i in range(1, args.size()):
		# A flagdelta node is ["fd", sign, name] in the tagged-tuple form.
		var arg = args[i]
		if not (arg is Array) or arg.size() != 3 or arg[0] != "fd":
			return StoryletExpression.error("check_flags() flag args must be +flagName or -flagName")
		var present: bool = (flags as Array).has(arg[2])
		if (not present) if arg[1] == "+" else present:
			return false
	return true


static func _fn_set_flags(args: Array, h: Dictionary) -> Variant:
	var flags = _flags_arg("set_flags", args, h)
	if StoryletExpression.is_error(flags):
		return flags
	var result: Array = (flags as Array).duplicate()
	for i in range(1, args.size()):
		# A flagdelta node is ["fd", sign, name] in the tagged-tuple form.
		var arg = args[i]
		if not (arg is Array) or arg.size() != 3 or arg[0] != "fd":
			return StoryletExpression.error("set_flags() flag args must be +flagName or -flagName")
		if arg[1] == "+":
			if not result.has(arg[2]):
				result.append(arg[2])
		else:
			result.erase(arg[2])
	# Sorted so a SAVE is deterministic: the same flags reached by different
	# routes serialise to the same bytes, which keeps save diffs and cross-runtime
	# byte comparisons stable. It is no longer what makes equality work - flags
	# compare as a SET since 2026-09-01 - so this is now about the stored form
	# only, and Patterplay not sorting is a difference that costs nothing.
	result.sort()
	return result


static func _fn_count_played(args: Array, h: Dictionary) -> Variant:
	var card = _string_arg("count_played", args, h, 0)
	if StoryletExpression.is_error(card):
		return card
	var fn = _host(h).get("count_played")
	if not (fn is Callable):
		return StoryletExpression.error("count_played() called without a play log in context")
	return float(fn.call(card))


static func _fn_turns_since_played(args: Array, h: Dictionary) -> Variant:
	var card = _string_arg("turns_since_played", args, h, 0)
	if StoryletExpression.is_error(card):
		return card
	var fn = _host(h).get("turns_since_played")
	if not (fn is Callable):
		return StoryletExpression.error("turns_since_played() called without a play log in context")
	return float(fn.call(card))


static func _fn_count_played_in(args: Array, h: Dictionary) -> Variant:
	var dimension = _string_arg("count_played_in", args, h, 0)
	if StoryletExpression.is_error(dimension):
		return dimension
	var value = _string_arg("count_played_in", args, h, 1)
	if StoryletExpression.is_error(value):
		return value
	var fn = _host(h).get("count_played_in")
	if not (fn is Callable):
		return StoryletExpression.error("count_played_in() called without a play log in context")
	return float(fn.call(dimension, value))


static func _fn_turns_since_played_in(args: Array, h: Dictionary) -> Variant:
	var dimension = _string_arg("turns_since_played_in", args, h, 0)
	if StoryletExpression.is_error(dimension):
		return dimension
	var value = _string_arg("turns_since_played_in", args, h, 1)
	if StoryletExpression.is_error(value):
		return value
	var fn = _host(h).get("turns_since_played_in")
	if not (fn is Callable):
		return StoryletExpression.error("turns_since_played_in() called without a play log in context")
	return float(fn.call(dimension, value))
