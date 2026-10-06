@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The compiled bundle model + loader. Port of @storylet-studio/model
# (packages/model/src/index.ts): the bundle schema constants, the gameId
# derivation rules (game_idify / effective_game_id), the home group and the
# project map's reading helpers (groups_of_box / all_tag_groups). The bundle stays a parsed JSON Dictionary - raw JSON is the
# cross-runtime contract, never re-serialised into engine-native shapes -
# and the session reads it as-is (expressions are compiled lazily into a
# "__node" cache key on each {src, ast} envelope, idempotently).
class_name StoryletBundle

## The bundle schema this build of the format writes: @1 since the project map
## (design/project-map-contract.md 2.4), the bundle that can carry "map" and a
## box's "usesMap".
##
## The runtime READS @0 and @1 and refuses anything else, by name. Reading @0 is
## not a compatibility branch: an @0 bundle cannot carry a map, so it is the
## same shape with less in it. The check exists so that a runtime meeting a
## schema it does not know says so, rather than half-working the way an @0
## runtime does on a map bundle (tag matching is by id, so its deals look right
## while every zone value is missing).
const BUNDLE_SCHEMA := "storylets/bundle@1"
## The schema before the project map, still read.
const BUNDLE_SCHEMA_V0 := "storylets/bundle@0"
## Every bundle schema this runtime accepts.
const BUNDLE_SCHEMAS := [BUNDLE_SCHEMA_V0, BUNDLE_SCHEMA]
## The engine's save envelope. Version 2 is the one-registry model: property
## values are the registry's, so the envelope holds what is NOT a property, plus
## the engine's own registry's values under "registry" when it made that
## registry itself. Version 1 envelopes still load: their property partitions
## move into the registry under the keys StoryletEngine.shared_key and
## flow_key write.
const SAVE_SCHEMA := "storylets/save@2"
## The version 1 envelope's schema tag, still read.
const SAVE_SCHEMA_V1 := "storylets/save@1"
const SAVEFILE_SCHEMA := "storylets/savefile@1"

## The reserved tag group (schema 2.4): present in every box without
## declaration, its tags the box's hand ids. Every hand implicitly binds it to
## its own name; a homed card is available only to its hand.
const PLACE_GROUP := "place"

## JS Number.MAX_SAFE_INTEGER: the "never" cooldown (deliberately not INF,
## which JSON-serialises to null). An int constant: the GDScript float LITERAL
## 9007199254740991.0 parses inexactly, but float(int) is exact.
const MAX_SAFE_INTEGER := 9007199254740991

static var _re_apostrophes: RegEx = null
static var _re_non_slug: RegEx = null
static var _re_dash_runs: RegEx = null
static var _re_edge_dashes: RegEx = null
static var _re_valid_game_id: RegEx = null
static var _re_hole_ref: RegEx = null


static func _compile_res() -> void:
	if _re_apostrophes != null:
		return
	_re_apostrophes = RegEx.create_from_string("['’]")
	_re_non_slug = RegEx.create_from_string("[^a-z0-9-]+")
	_re_dash_runs = RegEx.create_from_string("-+")
	_re_edge_dashes = RegEx.create_from_string("^-+|-+$")
	# \z, not $, in the two grammars: PCRE's $ also matches before a trailing
	# newline, so "@story.act\n" parsed as a reference here and was refused in JS,
	# whose $ ends the string (2026-10-06). The same holds in flow.gd.
	_re_valid_game_id = RegEx.create_from_string("^[a-z0-9]([a-z0-9-]*[a-z0-9])?\\z")
	_re_hole_ref = RegEx.create_from_string("^@(hand|world|story)\\.([a-z][a-z0-9_-]*)\\z")


## Slugify a human label into a filename- / address-safe gameId.
static func game_idify(text: String) -> String:
	_compile_res()
	var s := text.to_lower()
	s = _re_apostrophes.sub(s, "", true)
	s = _re_non_slug.sub(s, "-", true)
	s = _re_dash_runs.sub(s, "-", true)
	s = _re_edge_dashes.sub(s, "", true)
	return s


static func is_valid_game_id(game_id: String) -> bool:
	_compile_res()
	return _re_valid_game_id.search(game_id) != null


## Is this `chosen` / binding value MEANT as a property reference rather than a
## tag id (design/engine-server.md 4.6)? The leading "@" alone, deliberately: a
## value that starts with one and does not parse is a mistyped reference, not
## an odd tag id.
static func is_hole_ref(value: String) -> bool:
	return value.begins_with("@")


## Parse a hole reference into {"scope", "name"}; an EMPTY dictionary when the
## value is not one. The on-disk form stays a plain string.
static func parse_hole_ref(value: String) -> Dictionary:
	_compile_res()
	var m := _re_hole_ref.search(value)
	if m == null:
		return {}
	return {"scope": m.get_string(1), "name": m.get_string(2)}


## The effective address: a pinned gameId, else derived from the title, else
## the immutable id (so there is always something addressable).
static func effective_game_id(entity: Dictionary) -> String:
	var pinned := str(entity.get("gameId", "")).strip_edges()
	if pinned != "":
		return pinned
	if entity.has("title"):
		var from_title := game_idify(str(entity["title"]))
		if from_title != "":
			return from_title
	return str(entity.get("id", ""))


## Parse + validate a .storyletsc bundle string. Returns {"ok": true,
## "bundle": Dictionary} or {"ok": false, "error": message}. Validation is a
## boundary check (schema tag + load-bearing shape); the bundle is a compiled
## artifact, trusted beyond that.
static func load_from_string(json_text: String) -> Dictionary:
	var parsed = JSON.parse_string(json_text)
	if parsed == null or not (parsed is Dictionary):
		return {"ok": false, "error": "bundle is not valid JSON"}
	return load_from_dict(parsed)


## Validate an already-parsed bundle Dictionary (same result shape as
## load_from_string).
static func load_from_dict(bundle: Dictionary) -> Dictionary:
	var refused := schema_error(bundle)
	if refused != "":
		return {"ok": false, "error": refused}
	if not (bundle.get("content") is Dictionary) or not (bundle["content"].get("project") is String):
		return {"ok": false, "error": "bundle has no content.project"}
	if not (bundle.get("settings") is Dictionary):
		return {"ok": false, "error": "bundle has no settings"}
	if not (bundle.get("world") is Dictionary) or not (bundle.get("story") is Dictionary):
		return {"ok": false, "error": "bundle has no world/story sections"}
	if not (bundle.get("boxes") is Array):
		return {"ok": false, "error": "bundle has no boxes"}
	if bundle.has("externalScopes"):
		var ext = bundle["externalScopes"]
		var ok: bool = ext is Array
		if ok:
			for t in ext:
				ok = ok and t is String
		if not ok:
			return {"ok": false, "error": "bundle externalScopes must be an array of scope tokens"}
	return {"ok": true, "bundle": bundle}


## What is wrong with a bundle's schema tag, or "" when this runtime reads it
## (D4). The engine asks this first at construction too, so a hand-built
## bundle that never came through the loader is held to the same rule.
static func schema_error(bundle: Dictionary) -> String:
	var schema = bundle.get("schema")
	if schema is String and BUNDLE_SCHEMAS.has(schema):
		return ""
	return "unsupported bundle schema: %s (this runtime reads %s)" % [str(schema), " and ".join(BUNDLE_SCHEMAS)]


# --- reading the project map (design/project-map-contract.md 5, Q12) ---------
#
# A group may now live outside the box that uses it: the project map's zone
# group is in bundle["map"]["group"] and in no box's "tagGroups". These answer
# the two questions every reader asks once, as the model's helpers do.

## The tag groups a box sees, by NAME as well as by id: its own groups, then
## the project map's group when the box has opted in ("usesMap"). Own groups
## first is stated for determinism only: a bundle the engine loads never has a
## box group sharing the project group's name.
static func groups_of_box(bundle: Dictionary, box: Dictionary) -> Array:
	var own: Array = box.get("tagGroups", [])
	var map = bundle.get("map")
	if box.get("usesMap", false) == true and map is Dictionary:
		return own + [map["group"]]
	return own


## Every tag group in the bundle, each once: the boxes' groups in bundle order,
## then the project map's. What a walk over every value bag wants.
static func all_tag_groups(bundle: Dictionary) -> Array:
	var out: Array = []
	for box in bundle.get("boxes", []):
		out.append_array(box.get("tagGroups", []))
	var map = bundle.get("map")
	if map is Dictionary:
		out.append(map["group"])
	return out


## Other engines' game-wide scopes the content names (`patter`), sorted, from
## the bundle's "externalScopes": the family's shared vocabulary, which the
## compiler lets through unchecked. [] when the bundle names none (the key is
## absent then).
static func external_scopes(bundle: Dictionary) -> Array:
	var out: Array = []
	var ext = bundle.get("externalScopes")
	if ext is Array:
		for t in ext:
			if t is String and t != "":
				out.append(t)
	return out


