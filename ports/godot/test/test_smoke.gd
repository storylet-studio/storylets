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


## Lifetimes (2026-10-06). An engine owned its flows and every flow held its
## engine, and each flow cached host functions whose lambdas held the flow: two
## reference cycles, so no engine or flow was ever freed. Every live-bundle swap
## kept the old engine, bundle and all, for the life of the game. Each case
## builds in a function of its own and hands back only WeakRefs, so nothing on
## this stack can be what keeps an object alive.
func _lifetime(bundle: Dictionary) -> void:
	var played := _played_engine(bundle)
	_check("a dropped engine with an open, dealt and played flow is freed",
		played["engine"].get_ref() == null)
	_check("and so is its flow", played["flow"].get_ref() == null)
	_check("and the registry it made", played["registry"].get_ref() == null)

	var kept: StoryletFlow = _flow_outliving_its_engine(bundle)
	_check("a flow kept past its engine is closed", kept.is_closed())
	print("(an expected refusal error follows)")
	var refused := kept.play("any", "any", "any")
	_check("and refuses, naming the cause", refused.contains("its engine was freed"), refused)

	var closed := _closed_flow(bundle)
	_check("a closed flow the host dropped is freed while its engine lives", closed.get_ref() == null)

	var swapped := _swapped_engine(bundle)
	_check("an engine a hot_swap replaced is freed once dropped", swapped["old"].get_ref() == null)
	_check("and its replacement lives while held", swapped["held"])


func _played_engine(bundle: Dictionary) -> Dictionary:
	var engine := StoryletEngine.create(bundle, {"seed": 7, "log": true})
	var flow := engine.open_flow("main")
	var events: Array = []
	flow.subscribe_trace(func(e: Dictionary) -> void: events.append(e["type"]))
	engine.subscribe_trace(func(_id: String, e: Dictionary) -> void: events.append(e["type"]))
	var dealt := flow.deal_many()
	for hand in dealt:
		for card in dealt[hand]:
			for outcome in flow.outcomes(card["id"], hand):
				if outcome["available"]:
					flow.play(card["id"], outcome["gameId"], hand)
					break
			break
	flow.peek(str(bundle["boxes"][0]["id"]))
	flow.list_properties()
	_check("the lifetime case dealt and traced", not events.is_empty())
	return {"engine": weakref(engine), "flow": weakref(flow), "registry": weakref(engine._registry)}


func _flow_outliving_its_engine(bundle: Dictionary) -> StoryletFlow:
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	var flow := engine.open_flow("main")
	flow.deal_many()
	return flow


func _closed_flow(bundle: Dictionary) -> WeakRef:
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	var flow := engine.open_flow("main")
	flow.deal_many()
	flow.close()
	var ref: WeakRef = weakref(flow)
	flow = null
	# Still holding the engine: the flow must go on its own.
	_check("the engine outlives the flow it closed", engine.flows().is_empty())
	return ref


func _swapped_engine(bundle: Dictionary) -> Dictionary:
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	engine.open_flow("main").deal_many()
	var old: WeakRef = weakref(engine)
	var replacement = engine.hot_swap(bundle).get("engine")
	engine = null
	var carried = replacement.get_flow("main") if replacement != null else null
	return {"old": old, "held": carried != null and not (carried as StoryletFlow).is_closed()}


## The messages push_error'd while a Logger like this one is added: the
## refusal channel of a verb with no exceptions to throw.
class _Caught extends Logger:
	var errors: Array = []
	func _log_error(_function: String, _file: String, _line: int, code: String, _rationale: String,
			_editor_notify: bool, _error_type: int, _script_backtrace: Array[ScriptBacktrace]) -> void:
		errors.append(code)


## Refusals the corpus cannot see, because it reads only what a verb returns.
## A closed flow's list verbs refused nothing and answered from its stale
## bags, where every other verb push_errors and returns its empty shape; and
## play() returned a bad reference without pushing it, where outcomes() pushes
## the same resolve (2026-10-06).
func _refusals(bundle: Dictionary) -> void:
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	var flow := engine.open_flow("main")
	var caught := _Caught.new()
	print("(expected refusal errors follow)")
	OS.add_logger(caught)
	var played := flow.play("no-such-card", "go", "no-such-hand")
	flow.close()
	var boxes := flow.list_boxes()
	var bags := flow.list_bags()
	var rows := flow.list_properties()
	OS.remove_logger(caught)
	_check("play pushes a bad reference as well as returning it",
		played != "" and caught.errors.has("StoryletFlow.play: " + played), str(caught.errors))
	_check("a closed flow's list verbs return nothing", boxes.is_empty() and bags.is_empty() and rows.is_empty())
	var closed := 'flow "main" is closed'
	_check("and each push_errors the refusal",
		caught.errors.has("StoryletFlow.list_boxes: " + closed)
		and caught.errors.has("StoryletFlow.list_bags: " + closed)
		and caught.errors.has("StoryletFlow.list_properties: " + closed), str(caught.errors))
	print("(an expected refusal error follows)")
	flow.id = "renamed"
	_check("a flow's id is read-only", flow.id == "main", flow.id)


## Ruling F (2026-10-06), a host API, so checked per runtime rather than in the
## corpus: the same handler subscribed twice is registered once, and delivery is
## from a copy, so a subscribe during an event is heard from the next one.
func _handlers(bundle: Dictionary) -> void:
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	var flow := engine.open_flow("main")
	var heard := {"flow": 0, "engine": 0, "late": 0}
	var on_flow := func(_e: Dictionary) -> void: heard["flow"] += 1
	var on_engine := func(_id: String, _e: Dictionary) -> void: heard["engine"] += 1
	flow.subscribe_trace(on_flow)
	var unsubscribe := flow.subscribe_trace(on_flow)
	engine.subscribe_trace(on_engine)
	engine.subscribe_trace(on_engine)
	var late := func(_e: Dictionary) -> void: heard["late"] += 1
	var adds_late := func(_e: Dictionary) -> void: flow.subscribe_trace(late)
	flow.subscribe_trace(adds_late)
	flow.advance_turns(str(bundle["boxes"][0]["id"]))
	_check("a flow handler subscribed twice hears an event once", heard["flow"] == 1, str(heard))
	_check("an engine handler subscribed twice hears an event once", heard["engine"] == 1, str(heard))
	_check("a handler subscribed during an event does not hear that event", heard["late"] == 0, str(heard))
	flow.advance_turns(str(bundle["boxes"][0]["id"]))
	_check("and hears the next", heard["late"] == 1, str(heard))
	unsubscribe.call()
	flow.advance_turns(str(bundle["boxes"][0]["id"]))
	_check("one unsubscribe removes a handler subscribed twice", heard["flow"] == 2, str(heard))


## The LoadReport reaches the host from both helpers that used to drop it, and
## a save writes whole numbers as JS does (2026-10-06).
func _reports_and_bytes(bundle: Dictionary, saved: String) -> void:
	var whole := RegEx.create_from_string("[0-9]\\.0[,\\n\\]}]")
	_check("a save writes whole numbers as JS does (3, not 3.0)", whole.search(saved) == null,
		whole.search(saved).get_string() if whole.search(saved) != null else "")
	var reports: Array = []
	var into := StoryletEngine.create(bundle, {"seed": 7})
	var world = StoryletSave.deserialize_state(into, saved, {"on_report": func(r: Dictionary) -> void: reports.append(r)})
	_check("deserialize_state hands the load's report to on_report", world != null and reports.size() == 1
		and (reports[0] as Dictionary).has("exact"), str(reports))
	_check("and the reloaded engine saves the same bytes", StoryletSave.serialize_state(into) == saved)
	var live := StoryletLiveLink.apply_live_bundle(into, JSON.stringify(bundle))
	_check("apply_live_bundle returns the hot swap's report", live.get("ok", false) and live.get("report") is Dictionary
		and (live["report"] as Dictionary).has("exact"), str(live.keys()))


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

	var probe_engine := StoryletEngine.create(bundle, {"seed": 7})
	var probe := probe_engine.open_flow("main")
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

	_lifetime(bundle)
	_refusals(bundle)
	_handlers(bundle)
	_reports_and_bytes(bundle, saved)

	print("SMOKE %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)
