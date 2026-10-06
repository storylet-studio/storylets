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

	# A game's handler that reads its own flow holds that flow. A closed flow lets
	# go of its handlers, so the loop breaks whether the game closes the flow or
	# drops the engine (2026-10-06; until then the flow and its bags never went).
	_check("a flow whose own handler holds it is freed once closed and dropped",
		_self_held_flow(bundle, true).get_ref() == null)
	_check("and once its engine is dropped", _self_held_flow(bundle, false).get_ref() == null)


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


func _self_held_flow(bundle: Dictionary, close: bool) -> WeakRef:
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	var flow := engine.open_flow("main")
	flow.subscribe_trace(func(_e: Dictionary) -> void: flow.board())
	flow.deal_many()
	if close:
		flow.close()
	return weakref(flow)


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


## Durable state as a feature (ruling H, 2026-10-06): the host API's edges the
## corpus cannot reach, as the JS runtime's durable.test.ts has them. The shape of
## a half as a game stores it, the refusals made before anything moves, a memory
## loaded into an engine that is not fresh. The bundle is the corpus's own
## ("a durable half kept under one build..."), with a `writable: false` durable
## value and a run-scoped shared one added.
func _durable_halves() -> void:
	var corpus = JSON.parse_string(FileAccess.get_file_as_string(
		ProjectSettings.globalize_path("res://").path_join("../../packages/conformance/corpus.json")))
	var bundle = null
	for c in (corpus["scripted"] if corpus is Dictionary else []):
		if str(c["name"]).begins_with("a durable half kept under one build"):
			bundle = (c["bundle"] as Dictionary).duplicate(true)
	_check("the durable bundle is in the corpus", bundle != null)
	if bundle == null:
		return
	(bundle["story"]["properties"] as Array).append_array([
		{"name": "seal", "type": "number", "default": 0, "shared": false, "durable": true, "writable": false},
		{"name": "gold", "type": "number", "default": 0},
	])
	var engine := _durable_played(bundle)
	var alice: StoryletFlow = engine.get_flow("alice")
	var memory := engine.save_durable()
	var pocket := alice.save_durable()
	_check("the memory is the shared half, by address and gameId", StoryletSave.to_json(memory) == StoryletSave.to_json({
		"schema": "storylets/durable@1", "content": bundle["content"],
		"values": {"story.souls": 4}, "spent": ["gone", "relic"]}), StoryletSave.to_json(memory))
	_check("the pocket is the flow's half, keys in byte order", StoryletSave.to_json(pocket) == StoryletSave.to_json({
		"schema": "storylets/durable@1", "content": bundle["content"],
		"values": {"story.oath": "oak", "story.seal": 9, "story.title": ""}, "spent": ["once"]}), StoryletSave.to_json(pocket))
	(pocket["values"] as Dictionary)["story.oath"] = "iron"
	_check("a half is a copy", alice.get_property("story.oath") == "oak")

	# Through JSON, which is how a game keeps them.
	var kept_memory = JSON.parse_string(StoryletSave.to_json(engine.save_durable()))
	var kept_pocket = JSON.parse_string(StoryletSave.to_json(alice.save_durable()))
	_check("a half writes whole numbers as JS does", StoryletSave.to_json(kept_memory).contains('"story.souls":4}'),
		StoryletSave.to_json(kept_memory))
	var next := StoryletEngine.create(bundle, {"seed": 7})
	_check("the memory loads exactly", next.load_durable(kept_memory).get("exact", false))
	var reports: Array = []
	var flow := next.open_flow("alice", {"durable": kept_pocket,
		"on_restore_report": func(r: Dictionary) -> void: reports.append(r)})
	_check("the pocket opens exactly", reports.size() == 1 and (reports[0] as Dictionary).get("exact", false), str(reports))
	_check("a writable: false value goes back", flow.get_property("story.seal") == 9.0)
	_check("the memory saves back as it was kept", StoryletSave.to_json(next.save_durable()) == StoryletSave.to_json(kept_memory))
	_check("the pocket saves back as it was kept", StoryletSave.to_json(flow.save_durable()) == StoryletSave.to_json(kept_pocket))

	# Refused before anything moves.
	var fresh := StoryletEngine.create(bundle, {"seed": 7})
	var before := StoryletSave.to_json(fresh.save_game())
	var wrong_schema := memory.duplicate(true)
	wrong_schema["schema"] = "storylets/durable@9"
	var wrong_project := memory.duplicate(true)
	wrong_project["content"]["project"] = "other"
	var caught := _Caught.new()
	print("(expected refusal errors follow)")
	OS.add_logger(caught)
	var schema_refused := fresh.load_durable(wrong_schema)
	var project_refused := fresh.load_durable(wrong_project)
	var null_refused := fresh.load_durable(null)
	OS.remove_logger(caught)
	_check("an unknown schema is refused", schema_refused.is_empty()
		and caught.errors.has("StoryletEngine.load_durable: unsupported durable schema: storylets/durable@9"), str(caught.errors))
	_check("another project's memory is refused", project_refused.is_empty()
		and caught.errors.has('StoryletEngine.load_durable: durable state is for project "other", bundle is "conf"'), str(caught.errors))
	_check("a memory that is not one is refused", null_refused.is_empty())
	_check("and the refusals changed nothing", StoryletSave.to_json(fresh.save_game()) == before)

	var foreign := alice.save_durable()
	foreign["content"]["project"] = "other"
	caught = _Caught.new()
	OS.add_logger(caught)
	var opened_foreign = engine.open_flow("alice", {"durable": foreign})
	var opened_both = engine.open_flow("alice", {"durable": alice.save_durable(), "restore": engine.save_flow("alice")})
	OS.remove_logger(caught)
	_check("a pocket for another project is refused as the flow opens", opened_foreign == null
		and caught.errors.has('StoryletEngine.open_flow: durable state is for project "other", bundle is "conf"'), str(caught.errors))
	_check("a pocket with a restore is refused", opened_both == null
		and caught.errors.has('StoryletEngine.open_flow: openFlow "alice": restore and durable cannot be given together; a restore already carries the flow\'s durable state'),
		str(caught.errors))
	_check("and the flow already open is as it was", not alice.is_closed() and alice.get_property("story.oath") == "oak")

	# A memory makes the engine's durable half exactly that, and touches nothing else.
	var busy := StoryletEngine.create(bundle, {"seed": 7})
	busy.open_flow("bob").set_property("story.gold", 3)
	busy.set_property("story.souls", 8)
	var emptied := memory.duplicate(true)
	emptied["values"] = {}
	var report := busy.load_durable(emptied)
	_check("a memory with no value defaults it, and says so",
		StoryletSave.to_json(report.get("defaultedProperties")) == '[{"path":"story.souls"}]', str(report.get("defaultedProperties")))
	_check("and the value is its default", busy.get_property("story.souls") == 0.0)
	_check("a run-scoped value is untouched", busy.get_property("story.gold") == 3.0)
	_check("and so is the open flow", not (busy.get_flow("bob") as StoryletFlow).is_closed())

	# Spends by gameId: an internal id is a card this build does not have.
	var by_id := StoryletEngine.create(bundle, {"seed": 7})
	var internal := {"schema": "storylets/durable@1", "content": bundle["content"], "values": {"story.souls": 1}, "spent": ["c_relic"]}
	_check("a spend named by internal id is dropped", by_id.load_durable(internal).get("droppedSpent") == ["c_relic"])
	internal["spent"] = ["once"]
	_check("a pocket's spend in a memory is dropped", by_id.load_durable(internal).get("droppedSpent") == ["once"])

	# A missing or non-string schema or project is quoted as JS's String() prints it.
	var quoting := StoryletEngine.create(bundle, {"seed": 7})
	var quoted := {
		'{}': "unsupported durable schema: undefined",
		'{"schema":null}': "unsupported durable schema: null",
		'{"schema":42}': "unsupported durable schema: 42",
		'{"schema":"storylets/durable@1"}': 'durable state is for project "undefined", bundle is "conf"',
		'{"schema":"storylets/durable@1","content":{}}': 'durable state is for project "undefined", bundle is "conf"',
		'{"schema":"storylets/durable@1","content":{"project":5}}': 'durable state is for project "5", bundle is "conf"',
	}
	caught = _Caught.new()
	OS.add_logger(caught)
	for text in quoted:
		quoting.load_durable(JSON.parse_string(text))
	OS.remove_logger(caught)
	for text in quoted:
		_check("%s is refused in JS's words" % text, caught.errors.has("StoryletEngine.load_durable: " + str(quoted[text])), str(caught.errors))

	# A value no property can hold is reported as JS reports it (a null or an
	# object fits no declaration: retyped where the address is durable on that
	# side, dropped where it is not), [1] for a number too, and nothing is written.
	var paths := func(list) -> String:
		var out: Array = []
		for entry in list:
			out.append("%s:%s" % [entry.get("flow", ""), entry["path"]])
		return ",".join(PackedStringArray(out))
	var odd := StoryletEngine.create(bundle, {"seed": 7})
	odd.set_property("story.souls", 8)
	var odd_report := odd.load_durable(JSON.parse_string('{"schema":"storylets/durable@1","content":{"project":"conf","version":"0.0.0","hash":""},"values":{"story.souls":null,"story.gone":{},"story.oath":"oak"},"spent":[]}'))
	_check("an unreadable memory value is dropped or retyped, as JS reports it",
		paths.call(odd_report.get("droppedProperties", [])) == ":story.gone,:story.oath"
		and paths.call(odd_report.get("retypedProperties", [])) == ":story.souls"
		and (odd_report.get("defaultedProperties", []) as Array).is_empty(), str(odd_report))
	_check("and the value keeps its default", odd.get_property("story.souls") == 0.0)
	var odd_reports: Array = []
	var odd_flow := odd.open_flow("alice", {"durable": JSON.parse_string('{"schema":"storylets/durable@1","content":{"project":"conf","version":"0.0.0","hash":""},"values":{"story.oath":null,"story.seal":[1],"story.souls":[],"story.title":""},"spent":[]}'),
		"on_restore_report": func(r: Dictionary) -> void: odd_reports.append(r)})
	var odd_pocket: Dictionary = odd_reports[0] if odd_reports.size() == 1 else {}
	_check("an unreadable pocket value is dropped or retyped, as JS reports it",
		paths.call(odd_pocket.get("droppedProperties", [])) == "alice:story.souls"
		and paths.call(odd_pocket.get("retypedProperties", [])) == "alice:story.oath,alice:story.seal"
		and (odd_pocket.get("defaultedProperties", []) as Array).is_empty(), str(odd_pocket))
	_check("and nothing unreadable reaches a bag", odd_flow != null and odd_flow.get_property("story.oath") == "iron"
		and odd_flow.get_property("story.seal") == 0.0)

	engine.close_flow("alice")
	caught = _Caught.new()
	OS.add_logger(caught)
	var closed_half := alice.save_durable()
	OS.remove_logger(caught)
	_check("a closed flow's save_durable is refused", closed_half.is_empty()
		and caught.errors.has('StoryletFlow.save_durable: flow "alice" is closed'), str(caught.errors))


## A run that has spent every one-shot and moved every durable value.
func _durable_played(bundle: Dictionary) -> StoryletEngine:
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	var flow := engine.open_flow("alice")
	flow.set_property("story.souls", 4)
	flow.set_property("story.oath", "oak")
	flow.set_property("story.seal", 9)
	var dealt := flow.deal("q")
	for card in dealt:
		flow.play(card["gameId"], "", "q")
	return engine


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
	_durable_halves()

	print("SMOKE %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)
