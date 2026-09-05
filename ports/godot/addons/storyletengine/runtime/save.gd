@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# StoryletSave: the .storyletsave string boundary, in the RUNTIME of every
# port, never editor-only (the parity rule; design/engine-runtimes.md 1).
# The FILE is the HOST's ("storylets/savefile@1"): the engine's envelope
# ("storylets/save@1", shared partitions + every flow) plus, when the host
# keeps one, its @world container - "host saves its container once, each
# engine saves its own envelope" folded into one file (design/flows.md).
# A foreign or malformed blob is refused with push_error instead of
# corrupting a run; a save for another project is refused by the engine's
# own project check.
#
#   var json := StoryletSave.serialize_state(engine, world_values)
#   var world = StoryletSave.deserialize_state(engine, json)  # null on refusal;
#   # the host applies the returned world values to its container.
#
# FOUR VERBS, in Patterplay's pairing (patter play-helpers save.ts, and the
# same in all four of its runtimes): save_state / load_state work on the
# PARSED Dictionary, serialize_state / deserialize_state work on TEXT. So
# deserialize_state takes an engine and restores - it is the text twin of
# load_state, not a parse step. Confirmed against Patter 2026-08-29 while
# aligning the Storylets runtimes: this port already had the family shape and
# the JS reference did not.
class_name StoryletSave

const SCHEMA := StoryletBundle.SAVEFILE_SCHEMA


## Capture the whole engine (and the host's @world values, if given) as the
## tagged save-file Dictionary.
static func save_state(engine: StoryletEngine, world = null) -> Dictionary:
	var file := {"schema": SCHEMA, "engine": engine.save_game()}
	if world != null:
		file["world"] = world
	return file


## Restore a save-file Dictionary into an engine (every flow is rebuilt;
## re-take Flow handles afterwards). Returns the file's @world values (a
## Dictionary, possibly empty) for the HOST to apply, or null (with
## push_error) on a foreign blob or a project mismatch.
static func load_state(engine: StoryletEngine, file) -> Variant:
	if not (file is Dictionary) or file.get("schema") != SCHEMA \
			or not (file.get("engine") is Dictionary) \
			or (file["engine"] as Dictionary).get("schema") != StoryletBundle.SAVE_SCHEMA:
		push_error("StoryletSave.load_state: not a %s file" % SCHEMA)
		return null
	# Asked before the load rather than read from its return: load_game answers
	# with a LoadReport now, and the one thing it refuses (a foreign project)
	# needs a message this call can pass on.
	var refusal: String = engine._project_mismatch(file["engine"])
	if refusal != "":
		push_error("StoryletSave.load_state: " + refusal)
		return null
	engine.load_game(file["engine"])
	return file.get("world", {})


## Serialise to a JSON string - drop into a .storyletsave file. Key order
## preserved, full float precision (both matter for cross-runtime byte
## stability).
## `indent` defaults to TWO SPACES, as JS's JSON.stringify(file, null, 2),
## Unity's Formatting.Indented and Unreal's Indent() all do. It defaulted to
## compact here, so a Godot save of the same run was a different file from the
## other three ports' - and a save is the one artefact a player's machine keeps
## (2026-08-29). Pass "" for the compact form if a host wants it.
static func serialize_state(engine: StoryletEngine, world = null, indent: String = "  ") -> String:
	return JSON.stringify(save_state(engine, world), indent, false, true)


## Parse + restore a serialize_state string: the TEXT twin of load_state, as
## Patterplay pairs them. Returns the file's @world values for the host, or
## null (with push_error) on malformed JSON, a foreign file or a project
## mismatch.
static func deserialize_state(engine: StoryletEngine, json: String) -> Variant:
	var data = JSON.parse_string(json)
	if data == null:
		push_error("StoryletSave.deserialize_state: malformed JSON")
		return null
	return load_state(engine, data)
