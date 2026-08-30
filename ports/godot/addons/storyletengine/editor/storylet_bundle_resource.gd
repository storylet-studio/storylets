# StoryletBundleResource: a Resource wrapper around a compiled .storyletsc
# bundle. Mirrors the Unity StoryletBundleAsset (ScriptableObject holding
# source JSON) adapted to Godot's Resource model.
#
# The resource holds the raw JSON text verbatim and parses it lazily on first
# use. It does NOT store the parsed bundle as Resource sub-properties - that
# would fork the bundle format (Godot would re-serialise it into .tres shape).
# Raw JSON preserves the cross-runtime contract; the compiled form is rebuilt
# on load, never re-serialised.
#
# A broken bundle still imports: the error is readable here (import_error /
# get_errors), so the asset shows what is wrong instead of vanishing.
@tool   # the editor dock and the import plugin call into this resource, and a
        # non-tool script loads as a placeholder in the editor (is_valid would
        # fail with "Attempt to call a method on a placeholder instance")
class_name StoryletBundleResource
extends Resource

## The raw .storyletsc JSON text: the single source of truth.
@export_multiline var json_text: String = "":
	set(value):
		json_text = value
		_parsed = false

## The import-time validation error, persisted so a broken bundle's asset
## carries its diagnosis ("" when the import-time parse was clean).
@export var import_error: String = ""

var _parsed := false
var _bundle: Dictionary = {}
var _errors: PackedStringArray = PackedStringArray()


## Build a resource straight from JSON text (the runtime side door for DLC /
## downloaded bundles; no importer involved). Returns null (with push_error)
## when the text is not a valid bundle.
static func from_json_text(text: String) -> StoryletBundleResource:
	var r := StoryletBundleResource.new()
	r.json_text = text
	if not r.is_valid():
		for e in r.get_errors():
			push_error("StoryletBundleResource: %s" % e)
		return null
	return r


## Parse (if needed) and return the bundle Dictionary; {} when invalid (check
## is_valid to distinguish an empty parse from a broken one).
func get_bundle() -> Dictionary:
	_ensure_parsed()
	return _bundle


func is_valid() -> bool:
	_ensure_parsed()
	return _errors.is_empty()


## Loader errors from the most recent parse attempt.
func get_errors() -> PackedStringArray:
	_ensure_parsed()
	return _errors


## The bundle's content.project, or "" when invalid.
func get_project_id() -> String:
	_ensure_parsed()
	if _errors.is_empty():
		return str(_bundle.get("content", {}).get("project", ""))
	return ""


## Force a re-parse (after writing json_text at runtime). Returns is_valid().
func reload() -> bool:
	_parsed = false
	return is_valid()


func _ensure_parsed() -> void:
	if _parsed:
		return
	_parsed = true
	_bundle = {}
	_errors = PackedStringArray()
	var result := StoryletBundle.load_from_string(json_text)
	if result["ok"]:
		_bundle = result["bundle"]
	else:
		_errors.append(result["error"])
