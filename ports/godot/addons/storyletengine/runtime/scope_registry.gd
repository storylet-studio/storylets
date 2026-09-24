@tool   # editor-reachable, like the shared source it wraps
# StoryletScopeRegistry - this addon's NAME for the shared scope registry.
#
# The implementation is expr/ports/godot/scope_registry.gd, vendored beside this file as
# runtime/expr/scope_registry.gd and shared with Patterplay: one registry per game, holding
# every engine's property bags, and the eval context StoryletExpression consumes. It declares
# no `class_name`, because Godot registers those in a PROJECT-WIDE namespace and two addons
# vendoring one file cannot both claim the name. So identity lives here, in a shim, as it
# does for the property bag.
#
# Everything is inherited but the one bag factory: an owned scope the registry builds
# (`define_owned`) is a StoryletPropertyBag, so `owned_bag()` hands back this addon's type.
class_name StoryletScopeRegistry
extends "res://addons/storyletengine/runtime/expr/scope_registry.gd"


func _new_bag(declarations: Array, opts: Dictionary):
	return StoryletPropertyBag.new(declarations, opts)
