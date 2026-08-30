@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The compiled bundle model + loader. Port of @storylet-studio/model
# (packages/model/src/index.ts): the "storylets/bundle@0" schema constants,
# the gameId derivation rules (game_idify / effective_game_id) and the home
# group. The bundle stays a parsed JSON Dictionary - raw JSON is the
# cross-runtime contract, never re-serialised into engine-native shapes -
# and the session reads it as-is (expressions are compiled lazily into a
# "__node" cache key on each {src, ast} envelope, idempotently).
class_name StoryletBundle

const BUNDLE_SCHEMA := "storylets/bundle@0"
const SAVE_SCHEMA := "storylets/save@1"
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


static func _compile_res() -> void:
	if _re_apostrophes != null:
		return
	_re_apostrophes = RegEx.create_from_string("['’]")
	_re_non_slug = RegEx.create_from_string("[^a-z0-9-]+")
	_re_dash_runs = RegEx.create_from_string("-+")
	_re_edge_dashes = RegEx.create_from_string("^-+|-+$")
	_re_valid_game_id = RegEx.create_from_string("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


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
	if bundle.get("schema") != BUNDLE_SCHEMA:
		return {"ok": false, "error": "not a %s bundle (schema: %s)" % [BUNDLE_SCHEMA, str(bundle.get("schema"))]}
	if not (bundle.get("content") is Dictionary) or not (bundle["content"].get("project") is String):
		return {"ok": false, "error": "bundle has no content.project"}
	if not (bundle.get("settings") is Dictionary):
		return {"ok": false, "error": "bundle has no settings"}
	if not (bundle.get("world") is Dictionary) or not (bundle.get("story") is Dictionary):
		return {"ok": false, "error": "bundle has no world/story sections"}
	if not (bundle.get("boxes") is Array):
		return {"ok": false, "error": "bundle has no boxes"}
	return {"ok": true, "bundle": bundle}


## The compiled node for an {src, ast} expression envelope, deserialised once
## and cached on the envelope itself (idempotent; the bundle Dictionary is
## otherwise immutable). Returns null (with push_error) on a malformed AST.
static func node_of(expr: Dictionary) -> Variant:
	if expr.has("__node"):
		return expr["__node"]
	var node = StoryletAst.deserialise(expr.get("ast"))
	expr["__node"] = node
	return node
