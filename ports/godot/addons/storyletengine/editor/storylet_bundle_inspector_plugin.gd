@tool
extends EditorInspectorPlugin

# The bundle inspector, Godot idiom (design/engine-runtimes.md 2, piece 6).
#
# This is the true analogue of Unity's [CustomEditor(typeof(
# StoryletBundleAsset))] and Unreal's UStoryletBundle details customisation:
# the callable-surface summary appears in the Inspector for the bundle you
# selected, so "select the asset, see the asset" holds in all three engines.
# (It replaced a separate bottom-left dock, which put the one engine where
# that gesture is most natural in the only place it did not work.)
#
# Read-only, and cheap: the rows are built once per selection, not per
# repaint. The raw json_text property still draws below, as Unity keeps its
# source JSON behind a foldout.

const BundleView := preload("res://addons/storyletengine/editor/storylet_bundle_view.gd")


func _can_handle(object: Object) -> bool:
	return object is StoryletBundleResource


func _parse_begin(object: Object) -> void:
	var view: Control = BundleView.new()
	view.set_bundle_resource(object as StoryletBundleResource)
	add_custom_control(view)
