@tool
# The bundle export plugin: a thin subclass of the SHARED implementation.
#
# The logic, and the reasoning for it, live once in
# expr/ports/godot/bundle_export_plugin.gd, vendored beside the runtime as
# expr/bundle_export_plugin.gd. This file supplies only what differs between the
# two addons: a name, an extension and a label.
#
# It is shared because this exact pairing shipped broken in Patterplay 0.4.3
# (patterkit/patter#45), was fixed there, and then had to be fixed here a second
# time by hand. See the shared source for the full account.
extends "res://addons/storyletengine/runtime/expr/bundle_export_plugin.gd"


func _init() -> void:
	plugin_name = "StoryletBundleExport"
	bundle_extension = ".storyletsc"
	addon_label = "StoryletEngine"
