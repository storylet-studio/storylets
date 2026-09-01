@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# Matched-constraint specificity: a thin shim over the SHARED implementation.
#
# The scorer lives once, in expr/ports/godot/expr_specificity.gd, vendored
# beside this as expr/expr_specificity.gd. This file only gives it a Storylet
# Engine identity, because Godot registers class_name project-wide and the
# shared source must not claim one.
class_name StoryletSpecificity

const Impl := preload("expr/expr_specificity.gd")

## Score `node` via `eval_truthy` (a Callable(node Array) -> bool that must
## never raise; an erroring condition counts as false). Root polarity defaults
## to true (production only scores conditions already known eligible).
static func matched_specificity(node: Array, eval_truthy: Callable, want: bool = true) -> int:
	return Impl.matched_specificity(node, eval_truthy, want)
