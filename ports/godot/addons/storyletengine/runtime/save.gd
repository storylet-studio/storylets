@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# StoryletSave: the .storyletsave string boundary, in the RUNTIME of every
# port, never editor-only (the parity rule; design/engine-runtimes.md 1).
# The FILE is the HOST's ("storylets/savefile@1"): the engine's envelope
# ("storylets/save@2" when written, "storylets/save@1" still read) plus, when
# the host keeps one, its @world container - "host saves its container once,
# each engine saves its own envelope" folded into one file (design/flows.md).
# A standalone engine's envelope carries its registry's values, a self-backed
# @world included; a game that passed the engine its registry saves that
# registry once itself, beside this file's envelope.
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


## Options load_state and deserialize_state take: "on_report" is a
## Callable(report: Dictionary) handed the LoadReport the engine's load_game
## produced (what the load dropped, defaulted or evicted), which these helpers
## otherwise have no way to return beside the @world values.
const LOAD_OPTION_KEYS := ["on_report"]


## Restore a save-file Dictionary into an engine (every flow is rebuilt;
## re-take Flow handles afterwards). Returns the file's @world values (a
## Dictionary, possibly empty) for the HOST to apply, or null (with
## push_error) on a foreign blob or a project mismatch. `opts` takes
## {"on_report": Callable}: see LOAD_OPTION_KEYS.
static func load_state(engine: StoryletEngine, file, opts: Dictionary = {}) -> Variant:
	for key in opts:
		if not LOAD_OPTION_KEYS.has(key):
			push_error('StoryletSave.load_state: unknown option "%s" (valid: %s)' % [key, ", ".join(LOAD_OPTION_KEYS)])
			return null
	if not (file is Dictionary) or file.get("schema") != SCHEMA \
			or not (file.get("engine") is Dictionary) \
			or not [StoryletBundle.SAVE_SCHEMA, StoryletBundle.SAVE_SCHEMA_V1].has((file["engine"] as Dictionary).get("schema")):
		push_error("StoryletSave.load_state: not a %s file" % SCHEMA)
		return null
	# Asked before the load rather than read from its return: load_game answers
	# with a LoadReport now, and the one thing it refuses (a foreign project)
	# needs a message this call can pass on.
	var refusal: String = engine._project_mismatch(file["engine"])
	if refusal != "":
		push_error("StoryletSave.load_state: " + refusal)
		return null
	var report := engine.load_game(file["engine"])
	var on_report = opts.get("on_report")
	if on_report is Callable and (on_report as Callable).is_valid():
		(on_report as Callable).call(report)
	return file.get("world", {})


## Serialise to a JSON string - drop into a .storyletsave file. Key order
## preserved, full float precision (both matter for cross-runtime byte
## stability).
## `indent` defaults to TWO SPACES, as JS's JSON.stringify(file, null, 2),
## Unity's Formatting.Indented and Unreal's Indent() all do. It defaulted to
## compact here, so a Godot save of the same run was a different file from the
## other three ports' - and a save is the one artefact a player's machine keeps
## (2026-08-29). Pass "" for the compact form if a host wants it.
##
## Written by to_json, not JSON.stringify, which writes a whole number as 3.0
## and a large one as 9.007199254740991e+15 where JS writes 3 and
## 9007199254740991: with it the same run saved different bytes here, against
## the claim above (2026-10-06).
static func serialize_state(engine: StoryletEngine, world = null, indent: String = "  ") -> String:
	return to_json(save_state(engine, world), indent)


## Parse + restore a serialize_state string: the TEXT twin of load_state, as
## Patterplay pairs them. Returns the file's @world values for the host, or
## null (with push_error) on malformed JSON, a foreign file or a project
## mismatch.
static func deserialize_state(engine: StoryletEngine, json: String, opts: Dictionary = {}) -> Variant:
	var data = JSON.parse_string(json)
	if data == null:
		push_error("StoryletSave.deserialize_state: malformed JSON")
		return null
	return load_state(engine, data, opts)


## JSON in the shape JS's JSON.stringify(value, null, indent) gives: Dictionary
## keys in insertion order, numbers as JavaScript writes them (an integer-valued
## float is "1", never "1.0"), and with an indent, one member per line and
## "key": value. The one JSON writer in this addon: the save files and the Live
## Link's frames (StoryletLiveLink.to_json, compact) both come through here.
static func to_json(value, indent: String = "", _at: String = "") -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return str(value)
		TYPE_FLOAT:
			return json_number(value)
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(value))
		TYPE_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_INT64_ARRAY:
			var inner := _at + indent
			var items: Array = []
			for x in value:
				items.append(to_json(x, indent, inner))
			return _wrap("[", "]", items, indent, _at)
		TYPE_DICTIONARY:
			var inner := _at + indent
			var pairs: Array = []
			var colon := ": " if indent != "" else ":"
			for k in value:
				pairs.append(JSON.stringify(str(k)) + colon + to_json(value[k], indent, inner))
			return _wrap("{", "}", pairs, indent, _at)
	return JSON.stringify(value)


static func _wrap(open: String, close: String, items: Array, indent: String, at: String) -> String:
	if items.is_empty():
		return open + close
	if indent == "":
		return open + ",".join(items) + close
	var inner := at + indent
	return open + "\n" + inner + (",\n" + inner).join(items) + "\n" + at + close


## A number as JSON.stringify writes it. The digits are StoryletValues.js_number's
## (JavaScript's String(n)), the one formatter this addon prints numbers with;
## what JSON adds is kept here: NaN and Infinity are null where String(n) says
## "NaN" and "Infinity", zero is "0" whatever its sign, and a magnitude outside
## [1e-6, 1e21) takes the exponent form, which the shared formatter does not
## write.
static func json_number(n: float) -> String:
	if is_nan(n) or is_inf(n):
		return "null"
	if n == 0.0:
		return "0"
	var mag := absf(n)
	if mag >= 1e21 or mag < 1e-6:
		var e := int(floor(log(mag) / log(10.0)))
		var m := n / pow(10.0, e)
		if absf(m) >= 10.0:   # rounding pushed the mantissa over
			m /= 10.0
			e += 1
		return "%se%s%d" % [json_number(m), "+" if e > 0 else "", e]
	return StoryletValues.js_number(n)
