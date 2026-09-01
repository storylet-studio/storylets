@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# Scalar value helpers: a thin shim over the SHARED implementation.
#
# The helpers live once in expr/ports/godot/values.gd, vendored beside this as
# expr/values.gd. This file only gives them a Storylet Engine identity, because
# Godot registers class_name project-wide and the shared source must not claim
# one.
class_name StoryletValues
extends "expr/values.gd"


## The storylets condition coercion, under its historical name. The rule itself
## is truthy() on the shared source: the two families disagreed about it until
## 2026-09-01, and they share a property registry.
static func condition_passes(v) -> bool:
	return truthy(v)
