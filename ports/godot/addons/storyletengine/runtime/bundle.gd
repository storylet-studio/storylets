@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The compiled bundle model + loader. Port of @storylet-studio/model
# (packages/model/src/index.ts): the bundle schema constants, the gameId
# derivation rules (game_idify / effective_game_id), the home group and the
# project map's reading helpers (groups_of_box / all_tag_groups). The bundle stays a parsed JSON Dictionary - raw JSON is the
# cross-runtime contract, never re-serialised into engine-native shapes -
# and the flow reads it as-is (expressions are compiled lazily into a
# "__node" cache key on each {src, ast} envelope, idempotently).
class_name StoryletBundle

## The bundle schema this build of the format writes: @2 since host scopes
## (2026-10-28), the bundle whose game scopes are "scopeRegistry" and which has
## no "world" block. @1 was the project map's (design/project-map-contract.md
## 2.4), the bundle that can carry "map" and a box's "usesMap".
##
## @2 is a new number because the "world" block is GONE, not added to: a
## runtime that reads only @1 would reach for "world" and fail, where a schema
## it does not know is refused by name.
##
## The runtime READS @0, @1 and @2 and refuses anything else, by name. Reading @0 is
## not a compatibility branch: an @0 bundle cannot carry a map, so it is the
## same shape with less in it. The check exists so that a runtime meeting a
## schema it does not know says so, rather than half-working the way an @0
## runtime does on a map bundle (tag matching is by id, so its deals look right
## while every zone value is missing).
const BUNDLE_SCHEMA := "storylets/bundle@2"
## The project map's schema, before host scopes: the game's scopes were one
## "world" block. Still read, its "world.properties" as the host scope `world`.
const BUNDLE_SCHEMA_V1 := "storylets/bundle@1"
## The schema before the project map, still read.
const BUNDLE_SCHEMA_V0 := "storylets/bundle@0"
## Every bundle schema this runtime accepts.
const BUNDLE_SCHEMAS := [BUNDLE_SCHEMA_V0, BUNDLE_SCHEMA_V1, BUNDLE_SCHEMA]
## The engine's save envelope. Version 3 (the hands-on review, 2026-10,
## foundation 7): a flow's turns, cooldowns and board, and the shared spent
## cards, are keyed by GAME ID, as the play log always was, so a card deleted
## and made again under the same Game ID keeps its cooldown and its place as
## well as its play count. Since version 2, the one-registry model, property
## values are the registry's, so the envelope holds what is NOT a property, plus
## the engine's own registry's values under "registry" when it made that
## registry itself.
const SAVE_SCHEMA := "storylets/save@3"
## Version 2, keyed by internal id: still read, every key resolved as a Game ID
## first and an internal id second.
const SAVE_SCHEMA_V2 := "storylets/save@2"
## The version 1 envelope's schema tag, still read: its property partitions
## move into the registry under the keys StoryletEngine.shared_key and flow_key
## write.
const SAVE_SCHEMA_V1 := "storylets/save@1"
## Every save envelope schema this runtime reads.
const SAVE_SCHEMAS := [SAVE_SCHEMA_V1, SAVE_SCHEMA_V2, SAVE_SCHEMA]
const SAVEFILE_SCHEMA := "storylets/savefile@1"
## The schema tag every DURABLE HALF carries (ruling H, 2026-10-06): what
## save_durable writes and load_durable and open_flow's "durable" read, so the
## shape can change later and a runtime can tell which one it was given.
const DURABLE_SCHEMA := "storylets/durable@1"

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
	if not (bundle.get("story") is Dictionary):
		return {"ok": false, "error": "bundle has no story section"}
	# A bundle @1 or @0 has a "world" block; from @2 the game's scopes are
	# "scopeRegistry", absent when the project declares none.
	if bundle.get("schema") != BUNDLE_SCHEMA and not (bundle.get("world") is Dictionary):
		return {"ok": false, "error": "bundle has no world section"}
	if bundle.has("scopeRegistry"):
		var registry = bundle["scopeRegistry"]
		if not (registry is Dictionary) or not (registry.get("scopes") is Array):
			return {"ok": false, "error": "bundle scopeRegistry must have a scopes array"}
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
	# Storylet extensions, optional: each entry an object with a
	# "fields" object. The values themselves are the game's, never read here,
	# and an old bundle's "settings" (removed 2026-10-20) are ignored.
	if bundle.has("extensions"):
		var exts = bundle["extensions"]
		var ok: bool = exts is Dictionary
		if ok:
			for id in exts:
				ok = ok and exts[id] is Dictionary and exts[id].get("fields") is Dictionary
		if not ok:
			return {"ok": false, "error": "bundle extensions must map each extension id to an object with fields"}
	return {"ok": true, "bundle": bundle}


## What is wrong with a bundle's schema tag, or "" when this runtime reads it
## (D4). The engine asks this first at construction too, so a hand-built
## bundle that never came through the loader is held to the same rule.
static func schema_error(bundle: Dictionary) -> String:
	var schema = bundle.get("schema")
	if schema is String and BUNDLE_SCHEMAS.has(schema):
		return ""
	var all: Array[String] = []
	for known in BUNDLE_SCHEMAS:
		all.append(str(known))
	var last: String = all.pop_back()
	return "unsupported bundle schema: %s (this runtime reads %s and %s)" % [str(schema), ", ".join(all), last]


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




# --- host scopes (the game's own: @world, @player, ...) -----------------------

## The host scopes a bundle declares, in order, each {"token", "writable"?,
## "declarations"?} (no "declarations": an opaque scope, any name): its
## "scopeRegistry"'s, or, for a bundle @1 or @0, its "world" block read as the
## scope `world` (none when that block declares nothing, which is what an empty
## "world" always meant). The model's bundleHostScopes.
static func host_scopes(bundle: Dictionary) -> Array:
	var registry = bundle.get("scopeRegistry")
	if registry is Dictionary:
		var out: Array = []
		for s in registry.get("scopes", []):
			if s is Dictionary:
				out.append(s)
		return out
	var world = bundle.get("world")
	var legacy = world.get("properties") if world is Dictionary else null
	if legacy is Array and not (legacy as Array).is_empty():
		return [{"token": "world", "declarations": legacy}]
	return []


## One host scope by token, case-sensitive, or {}. The model's hostScopeSpec.
static func host_scope_spec(bundle: Dictionary, token: String) -> Dictionary:
	for s in host_scopes(bundle):
		if str(s.get("token", "")) == token:
			return s
	return {}


## A host scope's declarations by token: empty when it declares none, is
## opaque, or isn't there. host_scope_decls(bundle, "world") is what
## bundle["world"]["properties"] was. The model's hostScopeDecls.
static func host_scope_decls(bundle: Dictionary, token: String) -> Array:
	var decls = host_scope_spec(bundle, token).get("declarations")
	return decls if decls is Array else []
