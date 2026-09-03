# Headless smoke check for the shipped demo bundle: load the village, create a
# session, deal, play one outcome, then round-trip the whole run through the
# .storyletsave string boundary (StoryletSave) and assert nothing changed.
# PASS/FAIL lines; exit 0 only when everything holds.
#
#   godot --headless --path ports/godot --script res://test/test_smoke.gd
extends SceneTree

const BUNDLE_PATH := "res://addons/storyletengine/demo/the-hamlet.storyletsc"

var _fails := 0


func _check(name: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("PASS %s" % name)
	else:
		_fails += 1
		printerr("FAIL %s%s" % [name, (": " + detail) if detail != "" else ""])


func _initialize() -> void:
	var text := FileAccess.get_file_as_string(BUNDLE_PATH)
	_check("bundle readable", text != "", BUNDLE_PATH)
	if text == "":
		quit(1)
		return
	var loaded := StoryletBundle.load_from_string(text)
	_check("bundle loads", loaded["ok"], str(loaded.get("error", "")))
	if not loaded["ok"]:
		quit(1)
		return
	var bundle: Dictionary = loaded["bundle"]

	var engine := StoryletEngine.create(bundle, {"seed": 7})
	_check("engine created", engine != null)
	var session := engine.open_flow("main")
	_check("flow opened", session != null)

	# on_replaced_flow (parity with the JS runtime's onReplacedFlow): open_flow on
	# an id that exists REPLACES it, and the hook says so when the old flow still
	# held a dealt hand - the trap a host falls into calling open_flow instead of
	# get_flow after a load. A throwaway engine, so the smoke's own deal below is
	# not perturbed; the corpus never exercises the hook, so this is where it runs.
	var hook_hits: Array = []
	var hook_engine := StoryletEngine.create(bundle, {"seed": 7,
		"on_replaced_flow": func(id: String, dealt: int): hook_hits.append([id, dealt])})
	_check("hook engine accepts on_replaced_flow", hook_engine != null)
	if hook_engine != null:
		var hook_flow := hook_engine.open_flow("main")
		var held := 0   # no guessed hand id: deal everything, count what landed
		for hand in hook_flow.deal_many().values():
			held += (hand as Array).size()
		hook_engine.open_flow("main")   # replaces the flow holding that hand
		if held > 0:
			_check("on_replaced_flow fired once, naming the flow and its held count",
				hook_hits.size() == 1 and hook_hits[0][0] == "main" and int(hook_hits[0][1]) == held,
				str(hook_hits))
		else:
			_check("on_replaced_flow is silent for a flow holding nothing", hook_hits.is_empty(), str(hook_hits))
		hook_engine.open_flow("main")   # replacing an EMPTY flow is routine: no call
		_check("on_replaced_flow is silent when nothing was held", hook_hits.size() == 1, str(hook_hits))

	# The bundle inspector (design/engine-runtimes.md 2, piece 6): a
	# bundle-level API with no corpus family of its own. Hold it to the two
	# contracts that could silently drift - the criteria surface it advertises
	# must be the criteria peek() accepts, and its property scopes must be the
	# static twin of list_properties() (same names, same order).
	var described := StoryletBundleInspector.describe_bundle(bundle)
	_check("describe_bundle reads the identity",
		str(described["identity"]["project"]) == str(bundle["content"]["project"]),
		str(described["identity"]["project"]))
	_check("describe_bundle counts the boxes",
		int(described["totals"]["boxes"]) == (bundle["boxes"] as Array).size())
	_check("describe_bundle lists the deal() surface", not (described["hands"] as Array).is_empty())
	# Group gameIds are box-scoped, so the check is unconditional: EVERY
	# advertised group/tag pair must be accepted by the box that advertised it,
	# including the "zone" group both of this demo's boxes declare.
	# A throwaway session for the probes: a peek shuffles tie runs, so it
	# advances the PRNG - the smoke's own deal below must not be perturbed.
	# A bundle that carries a map: parsed, reported, and above all IGNORED. The
	# corpus has no map in it (geometry is inert payload, so it has no dealing
	# behaviour to conform to), so this is where the path gets executed.
	var mapped: Dictionary = bundle.duplicate(true)
	mapped["maps"] = [{
		"box": "village", "group": "zone",
		"zones": [{"tag": "tavern", "polygon": [
			{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 3}]}],
		"backgrounds": [{"file": "assets/village/plan.png",
			"x": 1, "y": 2, "width": 8, "height": 6, "opacity": 0.6}],
	}]
	var mapped_loaded := StoryletBundle.load_from_dict(mapped)
	_check("a bundle carrying a map still loads", mapped_loaded["ok"],
		str(mapped_loaded.get("error", "")))
	var mapped_described := StoryletBundleInspector.describe_bundle(mapped)
	var map_rows: Array = mapped_described.get("maps", [])
	_check("describe_bundle reports the map", map_rows.size() == 1)
	if map_rows.size() == 1:
		_check("the map keeps its box, group and counts",
			str(map_rows[0]["box"]) == "village" and str(map_rows[0]["group"]) == "zone"
			and int(map_rows[0]["zones"]) == 1 and int(map_rows[0]["backgrounds"]) == 1,
			str(map_rows[0]))
	# The geometry itself needs no accessor here: the parsed Dictionary IS the
	# bundle, so a host reads it straight off.
	_check("the geometry is readable by a host",
		int(mapped["maps"][0]["zones"][0]["polygon"][2]["x"]) == 4)
	_check("an ordinary bundle reports no maps",
		(described.get("maps", []) as Array).is_empty())
	# Inert means inert: an engine over it still runs.
	_check("an engine over a mapped bundle still runs",
		StoryletEngine.create(mapped, {"seed": 7}) != null)

	var probe := StoryletEngine.create(bundle, {"seed": 7}).open_flow("main")
	var criteria_ok := true
	var checked := 0
	for box in described["boxes"]:
		for group in box["tagGroups"]:
			for tag in group["tags"]:
				var looked := probe.peek(str(box["gameId"]), {str(group["gameId"]): str(tag)})
				checked += 1
				if looked.has("error"):
					criteria_ok = false
	_check("advertised peek criteria are accepted by peek", criteria_ok,
		"%d checked" % checked)
	var declared: Array = []
	for scope in described["properties"]:
		for p in scope["properties"]:
			declared.append(str(p["name"]))
	var live: Array = []
	for row in session.list_properties():
		live.append(str(row["name"]))
	_check("declared properties are the static twin of list_properties", declared == live,
		"%s vs %s" % [str(declared), str(live)])

	var dealt := session.deal_many()
	var total := 0
	for hand in dealt:
		total += (dealt[hand] as Array).size()
	_check("deal put cards on the board", total > 0, "dealt %d cards" % total)

	# Play the first available outcome of the first dealt card.
	var played := false
	for hand in dealt:
		if played or (dealt[hand] as Array).is_empty():
			continue
		var card: Dictionary = dealt[hand][0]
		for outcome in session.outcomes(card["id"], hand):
			if outcome["available"]:
				var err := session.play(card["id"], outcome["gameId"], hand)
				_check("play %s -> %s" % [card["gameId"], outcome["gameId"]], err == "", err)
				played = true
				break
	_check("an outcome was playable", played)

	# The save/load round trip through the string boundary: serialise the
	# whole ENGINE, restore into a FRESH one (every flow rebuilt), and
	# require the restored engine to serialise to the identical string
	# (turns, PRNG state, board, props, play log - per flow).
	var saved := StoryletSave.serialize_state(engine)
	var fresh := StoryletEngine.create(bundle, {"seed": 7})
	_check("deserialize_state accepts its own save", StoryletSave.deserialize_state(fresh, saved) != null)
	var resaved := StoryletSave.serialize_state(fresh)
	_check("save/load round trip is identical", resaved == saved,
		"lengths %d vs %d" % [saved.length(), resaved.length()])

	# Refusals: a foreign file and malformed JSON must be rejected (the
	# push_error lines below are expected).
	print("(expected refusal errors follow)")
	_check("foreign file refused", StoryletSave.deserialize_state(fresh, '{"schema":"patter/save@0"}') == null)
	_check("malformed JSON refused", StoryletSave.deserialize_state(fresh, "not json") == null)
	_check("refusal left the engine intact", StoryletSave.serialize_state(fresh) == saved)

	print("SMOKE %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)
