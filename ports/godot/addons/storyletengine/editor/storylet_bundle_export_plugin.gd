# Puts the RAW bundle back into an exported build.
#
# The importer (storylet_bundle_import_plugin.gd) makes a .storyletsc a Resource so the Inspector has
# something to draw. That alone changes what ships: Godot exports the imported product, and
# `FileAccess.get_file_as_string("res://game.storyletsc")` - how a game loads a bundle - then reads
# NOTHING in an exported build.
#
# This is not theoretical. The identical pairing shipped in Patterplay 0.4.3 and broke every game
# that had one: patterkit/patter#45, an empty read and a cutscene that never advanced. This port had
# the same importer and no export plugin, so it had the same bug waiting for its first export.
#
# So the editor gets its Resource and the build gets its file: the original bytes go back at the
# original path, and skip() drops the imported copy - without it a pack carries the whole story
# twice (measured on the Patter side: 7.2 MB against 3.6 MB for a 3.4 MB bundle).
@tool
extends EditorExportPlugin


func _get_name() -> String:
	return "StoryletBundleExport"


func _export_file(path: String, _type: String, _features: PackedStringArray) -> void:
	if not path.ends_with(".storyletsc"):
		return
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_warning("StoryletEngine: could not re-add %s to the export" % path)
		return
	var bytes := f.get_buffer(f.get_length())
	f.close()
	skip()
	add_file(path, bytes, false)
