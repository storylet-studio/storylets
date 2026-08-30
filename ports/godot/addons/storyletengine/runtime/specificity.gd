@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# Matched-constraint specificity - port of @wildwinter/expr-specificity: score
# how many atomic constraints in an expression are actively holding it true
# against current state. An evaluation-aware walk (an `or`'s score depends on
# which branch is currently matching). The host supplies truthiness via an
# eval_truthy Callable, so this stays ignorant of the eval context, the dialect
# and the truthiness rule.
#
# The walk carries a polarity flag `want` ("the truth value this subtree must
# have for the whole to hold"), applying De Morgan as it descends:
#   - atom: 1 if its truth matches want, else 0
#   - and:  under want, both must hold -> sum; under not want, behaves as or
#   - or:   under want, strongest branch -> max; under not want, behaves as and
#   - not:  recurse with want flipped
#   - check_flags(v, f1..fN): N constraints (an N-ary AND over the flag
#     operands), never fewer than 1
class_name StoryletSpecificity


## Score `node` via `eval_truthy` (a Callable(node Dictionary) -> bool that
## must never raise; an erroring condition counts as false). Root polarity
## defaults to true (production only scores conditions already known eligible).
static func matched_specificity(node: Dictionary, eval_truthy: Callable, want: bool = true) -> int:
	if node["kind"] == "binary" and (node["op"] == "and" or node["op"] == "or"):
		var l := matched_specificity(node["left"], eval_truthy, want)
		var r := matched_specificity(node["right"], eval_truthy, want)
		# De Morgan: an `and` under negation behaves like an `or`, and vice versa.
		var behave_as_and: bool = (node["op"] == "and") == want
		if behave_as_and:
			return l + r if (l > 0 and r > 0) else 0   # both must hold -> sum
		return maxi(l, r)                              # either holds -> strongest branch
	if node["kind"] == "unary" and node["op"] == "not":
		return matched_specificity(node["operand"], eval_truthy, not want)
	if node["kind"] == "call" and node["name"] == "check_flags":
		# args[0] is the flags source, so the operand count is size - 1.
		var operands: int = maxi(1, (node["args"] as Array).size() - 1)
		var holds: bool = eval_truthy.call(node)
		if want:
			return operands if holds else 0
		return 0 if holds else 1   # negated: at least one operand fails -> 1
	# Any other node is an atom worth one constraint when its truth matches want.
	return 1 if eval_truthy.call(node) == want else 0
