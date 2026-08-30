@tool
extends SceneTree

# Headless check of the state logger (runtime/state_logger.gd).
#
# It exists because nothing else in the suite ran snapshot_state, and a bug
# lived there undetected: the save envelope's shared half is
# {"props": ..., "spent": [...]}, and the snapshot read env["shared"]["story"]
# rather than env["shared"]["props"]["story"], so every SHARED property was
# silently missing. @story is shared by DEFAULT, so that was most of the state,
# and diff_state over two such snapshots could never report a shared change.
#
# The reference (packages/play-helpers/src/logger.ts) reads
# env.shared.props.story, and Unity and Unreal match it. This holds Godot to
# the same shape, from the outside: take a snapshot, write a @story property,
# take another, and require the diff to name it.

const BUNDLE_PATH := "res://addons/storyletengine/demo/the-hamlet.storyletsc"

var _fails := 0


func _check(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("PASS %s" % label)
	else:
		_fails += 1
		print("FAIL %s%s" % [label, ("  (%s)" % detail) if detail != "" else ""])


func _init() -> void:
	var text := FileAccess.get_file_as_string(BUNDLE_PATH)
	if text == "":
		print("FAIL could not read %s" % BUNDLE_PATH)
		quit(1)
		return
	var loaded := StoryletBundle.load_from_string(text)
	if not loaded["ok"]:
		print("FAIL bundle load: %s" % str(loaded.get("error", "")))
		quit(1)
		return
	var bundle: Dictionary = loaded["bundle"]
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	var flow := engine.open_flow("main")

	# A shared property, straight off the engine, so the test names what it
	# means rather than depending on which cards the deal happened to turn up.
	# A plain scalar row, so the test can write a value the declaration accepts:
	# an enum ("values") or a quality ("stages") would refuse an arbitrary one and
	# the failure would look like the bug this test is for.
	var shared_rows := []
	for row in engine.list_properties():
		if not String(row.get("path", "")).begins_with("story."):
			continue
		if row.has("values") or row.has("stages"):
			continue
		shared_rows.append(row)
	_check("the bundle declares at least one shared @story property",
		shared_rows.size() > 0, "found none, so this test proves nothing")
	if shared_rows.is_empty():
		quit(1)
		return

	var row: Dictionary = shared_rows[0]
	var prop: String = row["path"]
	var kind := String(row.get("type", "string"))
	var written: Variant = 999 if kind == "number" else (true if kind == "bool" else "changed-by-test")
	var before := StoryletStateLogger.snapshot_state(engine, flow)
	_check("a shared property is IN the snapshot", before.has(prop),
		"snapshot holds %d paths, none of them %s" % [before.size(), prop])

	var err := engine.set_property(prop, written)
	_check("the write was accepted", err == "", err)
	var after := StoryletStateLogger.snapshot_state(engine, flow)
	_check("the snapshot sees the new value",
		after.get(prop) == written, "wrote %s, snapshot says %s" % [written, after.get(prop)])

	var changed := StoryletStateLogger.diff_state(before, after)
	var paths := []
	for c in changed:
		paths.append(String(c.get("path", "")))
	_check("diff_state reports the shared change", paths.has(prop),
		"reported %s" % [paths])

	print("%s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(1 if _fails > 0 else 0)
