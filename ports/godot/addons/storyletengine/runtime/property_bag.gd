@tool   # editor-reachable, like the shared source it wraps
# StoryletPropertyBag - this addon's NAME for the shared property bag.
#
# The implementation is expr/ports/godot/property_bag.gd, vendored beside this file as
# runtime/expr/property_bag.gd and shared with Patterplay. It declares no `class_name`,
# because Godot registers those in a PROJECT-WIDE namespace and two addons vendoring one
# file cannot both claim the name. So identity lives here, in a shim, exactly as it does
# for the evaluator: a game can install this addon and Patterplay side by side.
#
# Everything is inherited. `clone()` in the base constructs through get_script(), so a
# clone of one of these is a StoryletPropertyBag and not a bare bag - which matters,
# because engine.gd casts with `as StoryletPropertyBag` in a dozen places.
class_name StoryletPropertyBag
extends "res://addons/storyletengine/runtime/expr/property_bag.gd"
