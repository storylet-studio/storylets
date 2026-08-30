@tool
extends EditorPlugin

# The Storylet Engine runtime is plain GDScript (StoryletSession / StoryletBundle
# / ...), usable with or without enabling this plugin. The EditorPlugin exists so
# the addon installs tidily, to register the .storyletsc import plugin (which
# turns compiled bundles into first-class StoryletBundleResource assets in the
# FileSystem dock), and to register the bundle inspector
# (design/engine-runtimes.md 2, piece 6) as an EditorInspectorPlugin, so
# selecting a bundle shows its callable surface in the Inspector - the same
# gesture as Unity's [CustomEditor] and Unreal's details customisation.
# Nothing load-bearing lives here: with the plugin disabled you can still read
# a bundle with FileAccess and StoryletBundle.load_from_string.

const BundleImportPlugin := preload("res://addons/storyletengine/editor/storylet_bundle_import_plugin.gd")
const BundleInspectorPlugin := preload("res://addons/storyletengine/editor/storylet_bundle_inspector_plugin.gd")
const BundleExportPlugin := preload("res://addons/storyletengine/editor/storylet_bundle_export_plugin.gd")

var _import_plugin: EditorImportPlugin
var _inspector_plugin: EditorInspectorPlugin
var _export_plugin: EditorExportPlugin


func _enter_tree() -> void:
	# Export plugin FIRST: it is what keeps a build readable, so there is no window in which bundles
	# are imported without it. Importing without exporting is the bug (patterkit/patter#45).
	_export_plugin = BundleExportPlugin.new()
	add_export_plugin(_export_plugin)
	_import_plugin = BundleImportPlugin.new()
	add_import_plugin(_import_plugin)
	_inspector_plugin = BundleInspectorPlugin.new()
	add_inspector_plugin(_inspector_plugin)


func _exit_tree() -> void:
	if _import_plugin != null:
		remove_import_plugin(_import_plugin)
		_import_plugin = null
	if _inspector_plugin != null:
		remove_inspector_plugin(_inspector_plugin)
		_inspector_plugin = null
	# Removed last, mirroring registration. A plugin that registers and never removes leaves Godot
	# holding freed script instances, and it aborts on shutdown.
	if _export_plugin != null:
		remove_export_plugin(_export_plugin)
		_export_plugin = null
