# EditorImportPlugin for .storyletsc files: teaches Godot to import a compiled
# bundle as a StoryletBundleResource so it becomes a first-class asset in the
# FileSystem dock (the sibling ports' ScriptedImporter / UFactory role).
#
# Import model:
#   Source:  <name>.storyletsc          (JSON text, the cross-runtime contract)
#   Product: .godot/imported/....tres   (StoryletBundleResource holding json_text)
#
# A broken bundle still imports - the error lands on the resource
# (import_error) and in the import log - so a bad export shows its diagnosis
# in-project instead of vanishing (the pattern the old Unity importer got
# right). The resource re-validates lazily on first use, so a stale product
# from an old plugin version still produces useful errors.
@tool
extends EditorImportPlugin


func _get_importer_name() -> String:
	return "storyletengine.bundle"


func _get_visible_name() -> String:
	return "Storylet Bundle"


func _get_recognized_extensions() -> PackedStringArray:
	return PackedStringArray(["storyletsc"])


func _get_save_extension() -> String:
	return "tres"


func _get_resource_type() -> String:
	# Declaring the base "Resource" is idiomatic for EditorImportPlugin (the
	# class_name is not referenceable at import registration time); the saved
	# type is StoryletBundleResource, which extends Resource.
	return "Resource"


func _get_preset_count() -> int:
	return 1


func _get_preset_name(_preset_index: int) -> String:
	return "Default"


func _get_import_options(_path: String, _preset_index: int) -> Array[Dictionary]:
	return []


func _get_option_visibility(_path: String, _option_name: StringName, _options: Dictionary) -> bool:
	return true


func _get_priority() -> float:
	return 1.0


func _get_import_order() -> int:
	return 0


func _import(source_file: String, save_path: String, _options: Dictionary, _platform_variants: Array[String], _gen_files: Array[String]) -> Error:
	var f := FileAccess.open(source_file, FileAccess.READ)
	if f == null:
		push_error("StoryletBundleImportPlugin: cannot open %s" % source_file)
		return ERR_CANT_OPEN
	var text := f.get_as_text()
	f.close()

	var res := StoryletBundleResource.new()
	res.json_text = text
	var check := StoryletBundle.load_from_string(text)
	if not check["ok"]:
		# Import anyway: the asset carries its error instead of vanishing.
		res.import_error = str(check["error"])
		push_error("StoryletBundleImportPlugin: %s: %s" % [source_file, check["error"]])

	var err := ResourceSaver.save(res, "%s.%s" % [save_path, _get_save_extension()])
	if err != OK:
		push_error("StoryletBundleImportPlugin: ResourceSaver.save failed: %d" % err)
	return err
