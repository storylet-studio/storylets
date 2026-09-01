@tool
# The bundle import plugin: a thin subclass of the SHARED implementation.
#
# The import flow lives once in expr/ports/godot/bundle_import_plugin.gd,
# vendored beside the runtime as expr/bundle_import_plugin.gd. This file
# supplies only what differs: four names and the Resource type.
#
# It pairs with storylet_bundle_export_plugin.gd, and they are shared together:
# importing is what changes the shipped bytes, so an addon that has this and not
# the export plugin has the bug that shipped as patterkit/patter#45.
extends "res://addons/storyletengine/runtime/expr/bundle_import_plugin.gd"


func _init() -> void:
	importer_name = "storyletengine.bundle"
	visible_name = "Storylet Bundle"
	bundle_extension = "storyletsc"
	log_prefix = "StoryletBundleImportPlugin"


func _make_resource() -> Resource:
	return StoryletBundleResource.new()
