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
	# A bundle with a PROJECT MAP (design/project-map-contract.md 2.1): one zone
	# group above the boxes, which the village opts in to, plus the geometry a
	# build carries under `export.map`. The corpus pins the dealing; this is
	# where the inspector's half and the inert geometry get executed.
	var mapped: Dictionary = bundle.duplicate(true)
	mapped["schema"] = StoryletBundle.BUNDLE_SCHEMA
	mapped["boxes"][0]["usesMap"] = true
	mapped["map"] = {
		"group": {"id": "d_district", "gameId": "district", "tags": [
			{"id": "v_quay", "gameId": "quay",
				"properties": [{"name": "danger", "type": "number", "default": 0}]},
			{"id": "v_hill", "gameId": "hill"},
		]},
		"geometry": {
			"zones": [{"tag": "quay", "polygon": [
				{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 3}]}],
			"backgrounds": [{"file": "assets/plan.png",
				"x": 1, "y": 2, "width": 8, "height": 6, "opacity": 0.6}],
			"sites": {"village": [{"hand": "the-forge", "x": 5, "y": 6}, {"hand": "the-inn", "x": 7, "y": 8}]},
		},
	}
	var mapped_loaded := StoryletBundle.load_from_dict(mapped)
	_check("a bundle carrying a project map loads", mapped_loaded["ok"],
		str(mapped_loaded.get("error", "")))
	var mapped_described := StoryletBundleInspector.describe_bundle(mapped)
	_check("describe_bundle reports the project map", mapped_described.has("map"))
	if mapped_described.has("map"):
		var map_row: Dictionary = mapped_described["map"]
		_check("the map names its group, zones and boxes, and counts the geometry",
			str(map_row["group"]) == "district" and map_row["tags"] == ["quay", "hill"]
			and map_row["boxes"] == ["village"] and int(map_row["zones"]) == 1
			and int(map_row["backgrounds"]) == 1 and map_row["sites"] == {"village": 2},
			str(map_row))
	_check("the opted-in box says so, and its own groups stay its own",
		mapped_described["boxes"][0].get("usesMap") == true
		and (mapped_described["boxes"][0]["tagGroups"] as Array).size() == (bundle["boxes"][0]["tagGroups"] as Array).size())
	_check("the project group is counted once",
		int(mapped_described["totals"]["tagGroups"]) == int(described["totals"]["tagGroups"]) + 1)
	var zone_scopes: Array = (mapped_described["properties"] as Array).filter(
		func(p): return str(p.get("group", "")) == "district")
	_check("a zone's properties are a tag scope with a group and no box",
		zone_scopes.size() == 1 and str(zone_scopes[0]["owner"]) == "quay"
		and str(zone_scopes[0]["scope"]) == "tag" and not zone_scopes[0].has("box"),
		str(zone_scopes))
	_check("an ordinary bundle reports no map", not described.has("map"))
	# The geometry needs no accessor: the parsed Dictionary IS the bundle, so a
	# host reads it straight off. It is inert, and an engine over it still runs.
	_check("the geometry is readable by a host",
		int(mapped["map"]["geometry"]["zones"][0]["polygon"][2]["x"]) == 4
		and str(mapped["map"]["geometry"]["sites"]["village"][0]["hand"]) == "the-forge")
	var mapped_engine := StoryletEngine.create(mapped, {"seed": 7})
	_check("an engine over a mapped bundle runs", mapped_engine != null)
	if mapped_engine != null:
		var on_map := mapped_engine.open_flow("main")
		_check("the opted-in box names the map's group in peek criteria",
			not on_map.peek("village", {"district": "quay"}).has("error"))
		_check("a zone property has the short address",
			on_map.set_property("value.quay.danger", 2) == "" and on_map.get_property("value.quay.danger") == 2.0,
			str(on_map.get_property("value.quay.danger")))
		print("(an expected refusal error follows)")
		var qualified := on_map.set_property("value.village/quay.danger", 3)
		_check("the box-qualified form of a zone is refused, naming the short form",
			qualified.contains('write "value.quay.danger"'), qualified)

	# Construction refuses what it cannot read faithfully (3.8), through the
	# usual channel: null with push_error (the lines below are expected).
	print("(expected refusal errors follow)")
	var unknown := bundle.duplicate(true)
	unknown["schema"] = "storylets/bundle@9"
	_check("an unknown bundle schema is refused by the loader", not StoryletBundle.load_from_dict(unknown)["ok"])
	_check("and by the engine", StoryletEngine.create(unknown) == null)
	var no_map := bundle.duplicate(true)
	no_map["boxes"][0]["usesMap"] = true
	_check("a box on a map the bundle lacks is refused", StoryletEngine.create(no_map) == null)
	var reason: String = StoryletEngine.new(no_map)._init_error
	_check("the refusal names the box", reason.begins_with("bundle refused: ") and reason.contains('box "village"'), reason)

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
