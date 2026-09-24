# One registry per game, held from the GAME's side (patterkit
# design/one-registry-handover.md): what the engine puts in the registry, what
# the game saves, and that loading works in either order and from a version 1
# envelope. The same checks as the JS reference's
# packages/runtime/test/one-registry.test.ts, case for case, with the
# expectations written from that contract rather than from this runtime.
#
# Run by test_corpus.gd, which CI already runs, after the corpora:
#
#   var r = preload("res://test/one_registry_checks.gd").new().run()
#   # {"passed": int, "cases": int, "failures": Array[String]}
#
# No class_name: a test helper has no business in the project-wide namespace.
extends RefCounted

## The JS test's scaffold, expanded exactly as the conformance package's
## expandBundle writes it: @story.gold shared, @story.steps each flow's own, a
## deck property (per flow, a deck's default), and the scaffold's tag, whose one
## declared property makes it a registered bag too.
const BUNDLE_JSON := """{"schema":"storylets/bundle@0","content":{"project":"conf","version":"0.0.0","hash":""},"metadata":"full","settings":{"playAdvancesTurns":1},
"world":{"properties":[{"name":"alarm","type":"number","default":0}]},
"story":{"properties":[{"name":"gold","type":"number","default":0},{"name":"steps","type":"number","default":0,"shared":false}]},
"boxes":[{"id":"b_x","gameId":"box","ranking":{"specificity":true},"fields":[],"properties":[],
 "tagGroups":[{"id":"d_zone","gameId":"zone","tags":[{"id":"v_docks","gameId":"docks","properties":[{"name":"danger","type":"number","default":0}]},{"id":"v_market","gameId":"market"}]}],
 "decks":[{"id":"k_main","gameId":"main","properties":[{"name":"drawn","type":"number","default":0}],
  "cards":[{"id":"c_heist","gameId":"heist","priority":0,"redraw":"always","outcomes":[{"id":"o_go","gameId":"go","changes":{
   "@deck.drawn":{"src":"@deck.drawn + 1","ast":["bin","+",["sv","deck","drawn"],["n",1]]},
   "@story.gold":{"src":"@story.gold + 1","ast":["bin","+",["sv","story","gold"],["n",1]]},
   "@story.steps":{"src":"@story.steps + 1","ast":["bin","+",["sv","story","steps"],["n",1]]},
   "@world.alarm":{"src":"@world.alarm + 1","ast":["bin","+",["sv","world","alarm"],["n",1]]}}}]}]}],
 "handTemplates":[],"hands":[{"id":"h_q","gameId":"q","rule":{"slots":"unbounded"}}]}]}"""

## The JS hotSwap describe's `edited`, expanded the same way: @story gains
## `rumours`, the per-flow `steps` is gone, and the box gains a SHARED property
## (a bag, and a key, the old engine never had).
const EDITED_JSON := """{"schema":"storylets/bundle@0","content":{"project":"conf","version":"0.0.0","hash":""},"metadata":"full","settings":{"playAdvancesTurns":1},
"world":{"properties":[{"name":"alarm","type":"number","default":0}]},
"story":{"properties":[{"name":"gold","type":"number","default":0},{"name":"rumours","type":"number","default":0}]},
"boxes":[{"id":"b_x","gameId":"box","ranking":{"specificity":true},"fields":[],"properties":[{"name":"heat","type":"number","default":0,"shared":true}],
 "tagGroups":[{"id":"d_zone","gameId":"zone","tags":[{"id":"v_docks","gameId":"docks","properties":[{"name":"danger","type":"number","default":0}]},{"id":"v_market","gameId":"market"}]}],
 "decks":[{"id":"k_main","gameId":"main","properties":[{"name":"drawn","type":"number","default":0}],
  "cards":[{"id":"c_heist","gameId":"heist","priority":0,"redraw":"always","outcomes":[{"id":"o_go","gameId":"go","changes":{
   "@deck.drawn":{"src":"@deck.drawn + 1","ast":["bin","+",["sv","deck","drawn"],["n",1]]},
   "@story.gold":{"src":"@story.gold + 1","ast":["bin","+",["sv","story","gold"],["n",1]]},
   "@world.alarm":{"src":"@world.alarm + 1","ast":["bin","+",["sv","world","alarm"],["n",1]]}}}]}]}],
 "handTemplates":[],"hands":[{"id":"h_q","gameId":"q","rule":{"slots":"unbounded"}}]}]}"""

## The JS compiler test's "other engines' scopes" project, as compileProject
## writes it: one card gated on @patter.visits that spends @patter.gold, and the
## bundle's record that the content names @patter.
const PATRON_JSON := """{"schema":"storylets/bundle@0","content":{"project":"p","version":"0.0.1","hash":"16f2jt4"},"metadata":"full","settings":{"playAdvancesTurns":1},
"world":{"properties":[]},"story":{"properties":[]},
"boxes":[{"id":"b_1","gameId":"b1","ranking":{"specificity":true},"fields":[],"properties":[],
 "tagGroups":[{"id":"d_1","gameId":"d1","tags":[{"id":"v_1","gameId":"v1"}]}],
 "decks":[{"id":"k_1","gameId":"main","properties":[],"cards":[{"id":"c_1","gameId":"c1",
  "condition":{"src":"@patter.visits >= 1","ast":["bin",">=",["sv","patter","visits"],["n",1]]},"priority":0,"redraw":"always",
  "outcomes":[{"id":"o_1","gameId":"go","changes":{"@patter.gold":{"src":"@patter.gold - 1","ast":["bin","-",["sv","patter","gold"],["n",1]]}}}]}]}],
 "handTemplates":[],"hands":[{"id":"h_1","gameId":"h1","rule":{"slots":1}}]}],"externalScopes":["patter"]}"""

var _bundle: Dictionary
var _failures: Array = []
## Set by each case as its last act: a GDScript runtime error abandons the
## function part way, which would otherwise read as a case with no failures.
var _finished := false


func run() -> Dictionary:
	_bundle = JSON.parse_string(BUNDLE_JSON)
	var cases := [
		["registers every bag that declares something, under the engine's keys and owner label", _registers_under_keys],
		["leaves the values out of save_game when the game passed the registry", _save_leaves_values_out],
		["does not self-back @world in the game's registry", _no_self_world_in_game_registry],
		["a standalone engine self-backs @world as a stored property, and a save round-trips exactly", _standalone_round_trip],
		["one save for the game: registry first, then the engine", _registry_first],
		["one save for the game: the engine first, then the registry", _engine_first],
		["one save for the game: into a game already playing, flows the save lacks leave nothing behind", _into_live_game],
		["a version 1 envelope still loads, its values moving into the registry", _v1_loads],
		["a version 1 envelope loads into the game's registry beside values the game already loaded", _v1_into_game_registry],
		["a version 1 envelope still reports drift in the values it moves", _v1_reports_drift],
		["a version 1 .storyletsave file still loads through StoryletSave", _v1_save_file],
		["save_flow parks a flow whole, properties included, and a resume puts them back", _park_and_resume],
		["a fresh flow never claims values a load left for its name", _fresh_flow_does_not_claim],
		["reset drops this engine's waiting values and no other engine's", _reset_discards_own_parked],
		["refuses a token another engine holds, naming it, and leaves the registry as it was", _clash_refused],
		["reads and writes another engine's game-wide scope by path", _other_engines_scope],
		["another engine's game-wide scope reaches a card's condition", _other_engines_scope_in_conditions],
		["reset reseeds a self-backed @world in place", _reset_reseeds_self_world],
		# Other engines' scopes (the JS compiler test's "other engines' scopes").
		["the loader reads externalScopes, and refuses one that is not a list of tokens", _external_scopes_loaded],
		["the engine reads and writes another engine's scope through the game's registry", _external_scopes_read_written],
		["refuses to open a flow, or load a save, where nobody registered the scope, before anything changes", _external_scopes_refused],
		["a scope the content does not name as another engine's stays a bad change target", _external_scopes_unnamed_write],
		# hot_swap on the game's registry (the JS "hotSwap on the game's registry").
		["hot_swap carries the run across, reports the dropped property, and really drops it", _hot_swap_carries],
		["hot_swap touches nothing that is not this engine's, and waiting values wait on", _hot_swap_touches_nothing_else],
		["hot_swap refuses another project before anything moves", _hot_swap_refuses_project],
		["a hot_swap rebuild that fails part way leaves this engine and the registry exactly as they were", _hot_swap_rolls_back],
		["the Live Link's apply_live_bundle now works on the game's registry", _hot_swap_live_link],
	]
	var passed := 0
	var all: Array = []
	for c in cases:
		_failures = []
		_finished = false
		(c[1] as Callable).call()
		if not _finished:
			_failures.append("stopped on a script error part way through (see SCRIPT ERROR above)")
		if _failures.is_empty():
			passed += 1
		else:
			for f in _failures:
				all.append("%s: %s" % [c[0], f])
	return {"passed": passed, "cases": cases.size(), "failures": all}


# --- helpers ------------------------------------------------------------------------

func _heist(flow: StoryletFlow) -> void:
	var dealt := flow.deal("q")
	if dealt.is_empty():
		_failures.append("the heist was not dealt")
		return
	var err := flow.play(str(dealt[0]["gameId"]), "go", "q")
	if err != "":
		_failures.append("the heist would not play: " + err)


## A game that owns its registry and registers @world itself, as a property the
## registry stores.
func _game() -> Dictionary:
	var registry := StoryletScopeRegistry.new()
	registry.define_owned("world", [{"name": "alarm", "type": "number", "default": 0}], {"owner": "Game"})
	return {"registry": registry, "engine": StoryletEngine.create(_bundle, {"registry": registry, "seed": 1})}


## Through JSON and back, as a save file would travel.
static func _json(v) -> Variant:
	return JSON.parse_string(JSON.stringify(v))


## Deep equality with every number compared as a float: JSON hands back floats,
## a bag may hold ints, and neither is a difference a save file can see.
static func _same(a, b) -> bool:
	if (a is int or a is float) and (b is int or b is float):
		return float(a) == float(b)
	if a is Dictionary and b is Dictionary:
		if a.size() != b.size():
			return false
		for k in a:
			if not b.has(k) or not _same(a[k], b[k]):
				return false
		return true
	if a is Array and b is Array:
		if a.size() != b.size():
			return false
		for i in a.size():
			if not _same(a[i], b[i]):
				return false
		return true
	return typeof(a) == typeof(b) and a == b


func _expect(what: String, got, want) -> void:
	if not _same(got, want):
		_failures.append("%s: expected %s, got %s" % [what, JSON.stringify(want), JSON.stringify(got)])


func _check(what: String, ok: bool) -> void:
	if not ok:
		_failures.append(what)


# --- the cases --------------------------------------------------------------------

func _registers_under_keys() -> void:
	var g := _game()
	_heist((g["engine"] as StoryletEngine).open_flow("f"))
	_expect("registry.save()", g["registry"].save(), {
		"world": {"alarm": 1},
		"story": {"gold": 1},
		"storylets/flow/f/story": {"steps": 1},
		"storylets/flow/f/deck/k_main": {"drawn": 1},
		"storylets/flow/f/value/v_docks": {"danger": 0},
	})
	var rows: Array = []
	for r in g["registry"].list_properties():
		if r.get("owner") == "Storylet Engine":
			rows.append([r["scope"], r["path"], r["value"]])
	_expect("the engine's examiner rows", rows, [
		["story", "story.gold", 1],
		["storylets/flow/f/story", "story.steps", 1],
		["storylets/flow/f/deck/k_main", "deck.main.drawn", 1],
		["storylets/flow/f/value/v_docks", "value.docks.danger", 0],
	])
	_finished = true


func _save_leaves_values_out() -> void:
	var g := _game()
	_heist((g["engine"] as StoryletEngine).open_flow("f"))
	var save: Dictionary = (g["engine"] as StoryletEngine).save_game()
	_expect("the schema", save.get("schema"), "storylets/save@2")
	_check("the envelope carried the registry's values", not save.has("registry"))
	_expect("save.shared", save["shared"], {"spent": []})
	_check("the flow's blob carried props", not (save["flows"]["f"] as Dictionary).has("props"))
	_finished = true


func _no_self_world_in_game_registry() -> void:
	var registry := StoryletScopeRegistry.new()
	var engine := StoryletEngine.create(_bundle, {"registry": registry})
	_check("the engine was refused", engine != null)
	_check("story is not registered", registry.has("story"))
	_check("world was self-backed in the game's registry", not registry.has("world"))
	_finished = true


func _standalone_round_trip() -> void:
	var engine := StoryletEngine.create(_bundle, {"seed": 1})
	_heist(engine.open_flow("f"))
	var save: Dictionary = _json(engine.save_game())
	_expect("save.registry", save.get("registry"), {
		"story": {"gold": 1}, "world": {"alarm": 1},
		"storylets/flow/f/story": {"steps": 1},
		"storylets/flow/f/deck/k_main": {"drawn": 1},
		"storylets/flow/f/value/v_docks": {"danger": 0},
	})
	var restored := StoryletEngine.create(_bundle, {"seed": 1})
	var report := restored.load_game(save)
	_check("the report was not exact: %s" % JSON.stringify(report), bool(report.get("exact", false)))
	_expect("world.alarm", restored.get_property("world.alarm"), 1)
	_expect("deck.main.drawn", (restored.get_flow("f") as StoryletFlow).get_property("deck.main.drawn"), 1)
	_expect("the restored engine's save", _json(restored.save_game()), save)
	_finished = true


## A game with flow f (one heist) and flow g, saved as the game would: the
## registry once, beside the engine's envelope.
func _session1() -> Dictionary:
	var g := _game()
	_heist((g["engine"] as StoryletEngine).open_flow("f"))
	(g["engine"] as StoryletEngine).open_flow("g")
	return _json({"registry": g["registry"].save(), "storylets": (g["engine"] as StoryletEngine).save_game()})


func _check_session(g: Dictionary) -> void:
	var engine: StoryletEngine = g["engine"]
	_expect("story.gold", engine.get_property("story.gold"), 1)
	_expect("world.alarm", engine.get_property("world.alarm"), 1)
	var f = engine.get_flow("f")
	var fg = engine.get_flow("g")
	if f == null or fg == null:
		_failures.append("flows after the load: %s" % str(engine.flows().map(func(x): return x.id)))
		return
	_expect("f story.steps", (f as StoryletFlow).get_property("story.steps"), 1)
	_expect("f deck.main.drawn", (f as StoryletFlow).get_property("deck.main.drawn"), 1)
	_expect("g story.steps", (fg as StoryletFlow).get_property("story.steps"), 0)
	_heist(fg)
	_expect("the registry's story.gold after g plays", g["registry"].get_value("story", "gold"), 2)


func _registry_first() -> void:
	var save := _session1()
	var g := _game()
	g["registry"].load(save["registry"])
	(g["engine"] as StoryletEngine).load_game(save["storylets"])
	_check_session(g)
	_finished = true


func _engine_first() -> void:
	var save := _session1()
	var g := _game()
	(g["engine"] as StoryletEngine).load_game(save["storylets"])
	g["registry"].load(save["registry"])
	_check_session(g)
	_finished = true


func _into_live_game() -> void:
	var save := _session1()
	var g := _game()
	var engine: StoryletEngine = g["engine"]
	var live := engine.open_flow("f")
	_heist(live)
	_heist(live)                          # live values the save's must replace
	_heist(engine.open_flow("stray"))     # not in the save: its bags must not survive
	g["registry"].load(save["registry"])
	engine.load_game(save["storylets"])
	_check_session(g)
	var strays: Array = []
	for k in g["registry"].save():
		if str(k).contains("stray"):
			strays.append(k)
	_expect("keys left behind by a flow the save lacks", strays, [])
	_finished = true


## A version 1 envelope, from before the registry held the properties.
func _v1(engine: StoryletEngine) -> Dictionary:
	return {
		"schema": "storylets/save@1",
		"content": engine.save_game()["content"],
		"shared": {"props": {"story": {"gold": 4}, "box": {}, "deck": {}, "hand": {}, "value": {}}, "spent": []},
		"flows": {"f": {
			"props": {"story": {"steps": 2}, "box": {}, "deck": {"k_main": {"drawn": 3}}, "hand": {}, "value": {"v_docks": {"danger": 1}}},
			"turns": {"b_x": 0}, "prng": 1, "cooldowns": {}, "board": {"h_q": []}, "playLog": [],
		}},
	}


func _v1_loads() -> void:
	var engine := StoryletEngine.create(_bundle, {"seed": 1})
	var report := engine.load_game(_v1(engine))
	_check("the report was not exact: %s" % JSON.stringify(report), bool(report.get("exact", false)))
	_expect("story.gold", engine.get_property("story.gold"), 4)
	_expect("f deck.main.drawn", (engine.get_flow("f") as StoryletFlow).get_property("deck.main.drawn"), 3)
	_expect("save_game().registry", engine.save_game().get("registry"), {
		"story": {"gold": 4}, "world": {"alarm": 0},
		"storylets/flow/f/story": {"steps": 2},
		"storylets/flow/f/deck/k_main": {"drawn": 3},
		"storylets/flow/f/value/v_docks": {"danger": 1},
	})
	_finished = true


func _v1_into_game_registry() -> void:
	var registry := StoryletScopeRegistry.new()
	registry.load({"another-engine/flow/x/scene/s": {"mood": 2}})
	var engine := StoryletEngine.create(_bundle, {"registry": registry, "seed": 1})
	engine.load_game(_v1(engine))
	_expect("registry.save()", registry.save(), {
		"story": {"gold": 4},
		"storylets/flow/f/story": {"steps": 2},
		"storylets/flow/f/deck/k_main": {"drawn": 3},
		"storylets/flow/f/value/v_docks": {"danger": 1},
		"another-engine/flow/x/scene/s": {"mood": 2},
	})
	_finished = true


func _v1_reports_drift() -> void:
	var engine := StoryletEngine.create(_bundle, {"seed": 1})
	var old := _v1(engine)
	old["shared"]["props"]["story"] = {"gold": "lots", "retired": 1}
	var report := engine.load_game(old)
	_expect("report.retypedProperties", report.get("retypedProperties"), [{"path": "story.gold"}])
	_expect("report.droppedProperties", report.get("droppedProperties"), [{"path": "story.retired"}])
	_expect("story.gold (a misfit keeps the default)", engine.get_property("story.gold"), 0)
	_finished = true


func _v1_save_file() -> void:
	var engine := StoryletEngine.create(_bundle, {"seed": 1})
	var file := {"schema": StoryletBundle.SAVEFILE_SCHEMA, "engine": _v1(engine)}
	var world = StoryletSave.load_state(engine, file)
	_check("StoryletSave refused a version 1 file", world != null)
	_expect("story.gold", engine.get_property("story.gold"), 4)
	_finished = true


func _park_and_resume() -> void:
	var g := _game()
	var engine: StoryletEngine = g["engine"]
	_heist(engine.open_flow("f"))
	var parked := engine.save_flow("f")
	_expect("the parked blob's deck props", (parked.get("props", {}) as Dictionary).get("deck"), {"k_main": {"drawn": 1}})
	engine.close_flow("f")
	var left: Array = []
	for k in g["registry"].save():
		if str(k).begins_with("storylets/flow/f/"):
			left.append(k)
	_expect("f's keys after it closed", left, [])
	var back := engine.open_flow("f", {"restore": parked})
	_expect("deck.main.drawn after the resume", back.get_property("deck.main.drawn"), 1)
	_finished = true


func _fresh_flow_does_not_claim() -> void:
	var g := _game()
	g["registry"].load({"storylets/flow/f/deck/k_main": {"drawn": 9}})
	_expect("a fresh f's deck.main.drawn", (g["engine"] as StoryletEngine).open_flow("f").get_property("deck.main.drawn"), 0)
	_finished = true


func _reset_discards_own_parked() -> void:
	var g := _game()
	var blob: Dictionary = g["registry"].save()
	blob["storylets/flow/z/story"] = {"steps": 5}
	blob["other/deck/inn"] = {"drawn": 1}
	g["registry"].load(blob)
	(g["engine"] as StoryletEngine).reset()
	var after: Dictionary = g["registry"].save()
	_check("this engine's waiting value survived the reset", not after.has("storylets/flow/z/story"))
	_expect("another engine's waiting value", after.get("other/deck/inn"), {"drawn": 1})
	_finished = true


func _clash_refused() -> void:
	var registry := StoryletScopeRegistry.new()
	StoryletEngine.create(_bundle, {"registry": registry})
	var before: Dictionary = registry.save()
	var second := StoryletEngine.create(_bundle, {"registry": registry})
	_check("a second engine took the same registry's @story", second == null)
	_expect("the registry after the refusal", registry.save(), before)
	var probe := StoryletEngine.new(_bundle, {"registry": registry})
	_check("the refusal did not name the holder: " + probe._init_error,
		probe._init_error.contains("scope '@story' is already registered by Storylet Engine"))

	var with_world := StoryletScopeRegistry.new()
	with_world.define_owned("world", [], {"owner": "Game"})
	var bound := StoryletEngine.new(_bundle, {"registry": with_world, "world": {"get": func(_n): return 0}})
	_check("the @world clash did not name the holder: " + bound._init_error,
		bound._init_error.contains("scope '@world' is already registered by Game"))
	_check("a refused engine left @story registered", not with_world.has("story"))
	_check("a refused engine created", StoryletEngine.create(_bundle, {"registry": with_world, "world": {"get": func(_n): return 0}}) == null)
	_finished = true


func _other_engines_scope() -> void:
	var registry := StoryletScopeRegistry.new()
	registry.define_owned("patter", [{"name": "gold", "type": "number", "default": 3}], {"owner": "Patter"})
	var engine := StoryletEngine.create(_bundle, {"registry": registry})
	_expect("engine patter.gold", engine.get_property("patter.gold"), 3)
	var flow := engine.open_flow("f")
	_expect("flow patter.gold", flow.get_property("patter.gold"), 3)
	var err := flow.set_property("patter.gold", 5)
	_check("the flow's write was refused: " + err, err == "")
	_expect("the registry's patter.gold", registry.get_value("patter", "gold"), 5)
	err = engine.set_property("patter.gold", 6)
	_check("the engine's write was refused: " + err, err == "")
	_expect("the registry's patter.gold", registry.get_value("patter", "gold"), 6)
	_finished = true


func _other_engines_scope_in_conditions() -> void:
	var gated: Dictionary = _bundle.duplicate(true)
	gated["boxes"][0]["decks"][0]["cards"][0]["condition"] = {"src": "@patter.gold >= 3",
		"ast": ["bin", ">=", ["sv", "patter", "gold"], ["n", 3]]}
	var registry := StoryletScopeRegistry.new()
	var engine := StoryletEngine.create(gated, {"registry": registry})
	# Evaluated once before the scope exists, so a context cached then has to see
	# the registration that follows.
	_expect("dealt before @patter exists", engine.open_flow("early").deal("q").map(func(v): return v["gameId"]), [])
	registry.define_owned("patter", [{"name": "gold", "type": "number", "default": 3}], {"owner": "Patter"})
	_expect("dealt while @patter.gold is 3", engine.open_flow("rich").deal("q").map(func(v): return v["gameId"]), ["heist"])
	registry.set_value("patter", "gold", 1)
	_expect("dealt once @patter.gold is 1", engine.open_flow("poor").deal("q").map(func(v): return v["gameId"]), [])
	_finished = true


func _reset_reseeds_self_world() -> void:
	var engine := StoryletEngine.create(_bundle, {"seed": 1})
	_heist(engine.open_flow("f"))
	_expect("world.alarm after the heist", engine.get_property("world.alarm"), 1)
	engine.reset()
	_expect("world.alarm after the reset", engine.get_property("world.alarm"), 0)
	_expect("the registry after the reset", engine.save_game().get("registry"), {"story": {"gold": 0}, "world": {"alarm": 0}})
	_finished = true


# --- other engines' scopes --------------------------------------------------------

func _external_scopes_loaded() -> void:
	var loaded := StoryletBundle.load_from_string(PATRON_JSON)
	_check("the patron bundle loads", loaded["ok"])
	if loaded["ok"]:
		_expect("its externalScopes", StoryletBundle.external_scopes(loaded["bundle"]), ["patter"])
	_expect("a bundle naming none", StoryletBundle.external_scopes(_bundle), [])
	var bad: Dictionary = JSON.parse_string(PATRON_JSON)
	bad["externalScopes"] = "patter"
	_check("a string for externalScopes loaded", not StoryletBundle.load_from_dict(bad)["ok"])
	bad["externalScopes"] = ["patter", 3]
	_check("a non-token in externalScopes loaded", not StoryletBundle.load_from_dict(bad)["ok"])
	_finished = true


func _external_scopes_read_written() -> void:
	var bundle: Dictionary = JSON.parse_string(PATRON_JSON)
	var registry := StoryletScopeRegistry.new()
	registry.define_owned("patter", [{"name": "gold", "type": "number", "default": 3},
		{"name": "visits", "type": "number", "default": 1}], {"owner": "Patter"})
	var flow := StoryletEngine.create(bundle, {"registry": registry}).open_flow("main")
	_expect("dealt", flow.deal("h1").map(func(c): return c["gameId"]), ["c1"])
	var err := flow.play("c1", "go", "h1")
	_check("the patron would not play: " + err, err == "")
	_expect("the registry's patter.gold", registry.get_value("patter", "gold"), 2)
	_finished = true


## What `fn` returned, and the messages it push_error'd: the refusal channel of
## a verb that has no exceptions to throw.
class _Caught extends Logger:
	var errors: Array = []
	func _log_error(_function: String, _file: String, _line: int, code: String, _rationale: String,
			_editor_notify: bool, _error_type: int, _script_backtrace: Array[ScriptBacktrace]) -> void:
		errors.append(code)


static func _catching(fn: Callable) -> Dictionary:
	var caught := _Caught.new()
	OS.add_logger(caught)
	var result = fn.call()
	OS.remove_logger(caught)
	return {"result": result, "errors": caught.errors}


func _external_scopes_refused() -> void:
	var bundle: Dictionary = JSON.parse_string(PATRON_JSON)
	var refusal := "this content names @patter, which no engine on this registry registered: give every engine the game's one registry"
	var alone := StoryletEngine.create(bundle)
	var opened := _catching(func(): return alone.open_flow("main"))
	_check("open_flow was not refused: " + str(opened["result"]), opened["result"] == null)
	_expect("open_flow's refusal", opened["errors"], ["StoryletEngine.open_flow: " + refusal])
	_check("a refused open_flow opened a flow", alone.get_flow("main") == null and alone.flows().is_empty())

	# A save made where Patter was present, loaded where it is not: refused whole.
	var registry := StoryletScopeRegistry.new()
	registry.define_owned("patter", [{"name": "gold", "type": "number", "default": 3},
		{"name": "visits", "type": "number", "default": 1}], {"owner": "Patter"})
	var game := StoryletEngine.create(bundle, {"registry": registry})
	game.open_flow("main").deal("h1")
	var save := game.save_game()
	var elsewhere := StoryletScopeRegistry.new()
	elsewhere.define_owned("patter", [{"name": "gold", "type": "number", "default": 3},
		{"name": "visits", "type": "number", "default": 1}])
	var other := StoryletEngine.create(bundle, {"registry": elsewhere})
	var keep := other.open_flow("keep")
	elsewhere.remove("patter")
	var loaded := _catching(func(): return other.load_game(save))
	_expect("load_game's answer", loaded["result"], {})
	_expect("load_game's refusal", loaded["errors"], ["StoryletEngine.load_game: " + refusal])
	_expect("the flows after the refused load", other.flows().map(func(f): return f.id), ["keep"])
	_check("the refused load touched the flow it kept", other.get_flow("keep") == keep and not keep.is_closed())

	# The engine that took the scope away mid-game: a write names it.
	var pays: Dictionary = JSON.parse_string(PATRON_JSON)
	# Ungated, and writing a constant: reading nobody's @patter.gold would fail first.
	var card: Dictionary = pays["boxes"][0]["decks"][0]["cards"][0]
	card.erase("condition")
	card["outcomes"][0]["changes"] = {"@patter.gold": {"src": "1", "ast": ["n", 1]}}
	var shared := StoryletScopeRegistry.new()
	shared.define_owned("patter", [{"name": "gold", "type": "number", "default": 3}])
	var paying := StoryletEngine.create(pays, {"registry": shared}).open_flow("main")
	_expect("dealt", paying.deal("h1").map(func(c): return c["gameId"]), ["c1"])
	shared.remove("patter")
	var err := paying.play("c1", "go", "h1")
	_check("the write to nobody's @patter did not fail naming it: " + err,
		err.contains("@patter.gold cannot be written: no engine on this registry registered @patter"))
	_finished = true


func _external_scopes_unnamed_write() -> void:
	var bundle: Dictionary = JSON.parse_string(PATRON_JSON)
	var card: Dictionary = bundle["boxes"][0]["decks"][0]["cards"][0]
	card.erase("condition")
	card["outcomes"][0]["changes"] = {"@patter.gold": {"src": "1", "ast": ["n", 1]}}
	# A scope the content does not name as another engine's is still no target.
	bundle.erase("externalScopes")
	var other := StoryletEngine.create(bundle).open_flow("main")
	other.deal("h1")
	var err := other.play("c1", "go", "h1")
	_check("an unnamed scope was not a bad target: " + err, err.contains('bad change target scope "@patter"'))
	_finished = true


# --- hot_swap on the game's registry ------------------------------------------------

## A game playing: Patter's scope beside this engine's, one heist in flow f,
## and values the game loaded that wait for a flow z of this engine and for
## another engine altogether.
func _playing() -> Dictionary:
	var g := _game()
	g["registry"].define_owned("patter", [{"name": "visits", "type": "number", "default": 4}], {"owner": "Patter"})
	_heist((g["engine"] as StoryletEngine).open_flow("f"))
	g["registry"].load({"storylets/flow/z/story": {"steps": 5}, "other/deck/inn": {"drawn": 2}}, {"keep_parked": true})
	return g


func _edited() -> Dictionary:
	return JSON.parse_string(EDITED_JSON)


func _hot_swap_carries() -> void:
	var g := _playing()
	var old_flow: StoryletFlow = (g["engine"] as StoryletEngine).get_flow("f")
	var r: Dictionary = (g["engine"] as StoryletEngine).hot_swap(_edited())
	_check("the swap was refused: " + str(r.get("error", "")), r.get("ok", false))
	if not r.get("ok", false):
		_finished = true
		return
	_check("the old engine was not spent: its flow is still open", old_flow.is_closed())
	var engine: StoryletEngine = r["engine"]
	_expect("story.gold", engine.get_property("story.gold"), 1)
	_expect("story.rumours", engine.get_property("story.rumours"), 0)
	_expect("deck.main.drawn", (engine.get_flow("f") as StoryletFlow).get_property("deck.main.drawn"), 1)
	_expect("the report's droppedProperties", r["report"].get("droppedProperties"), [{"flow": "f", "path": "story.steps"}])
	_check("the dropped bag stayed as a stray", not g["registry"].save().has("storylets/flow/f/story"))
	_heist(engine.get_flow("f"))
	_expect("the registry's story.gold", g["registry"].get_value("story", "gold"), 2)
	_finished = true


func _hot_swap_touches_nothing_else() -> void:
	var g := _playing()
	var r: Dictionary = (g["engine"] as StoryletEngine).hot_swap(_edited())
	_check("the swap was refused: " + str(r.get("error", "")), r.get("ok", false))
	var saved: Dictionary = g["registry"].save()
	_expect("patter", saved.get("patter"), {"visits": 4})
	_expect("another engine's waiting values", saved.get("other/deck/inn"), {"drawn": 2})
	_expect("this engine's waiting values", saved.get("storylets/flow/z/story"), {"steps": 5})
	_expect("the game's world", saved.get("world"), {"alarm": 1})
	_finished = true


func _hot_swap_refuses_project() -> void:
	var g := _playing()
	var before := JSON.stringify(g["registry"].save())
	var other := _edited()
	other["content"]["project"] = "somebody-else"
	var r: Dictionary = (g["engine"] as StoryletEngine).hot_swap(other)
	_check("another project's bundle was not refused naming it: " + str(r),
		not r.get("ok", true) and str(r.get("error", "")).contains("somebody-else"))
	_expect("the registry", JSON.stringify(g["registry"].save()), before)
	_heist((g["engine"] as StoryletEngine).get_flow("f"))   # the old engine still plays
	_expect("the registry's story.gold", g["registry"].get_value("story", "gold"), 2)
	_finished = true


func _hot_swap_rolls_back() -> void:
	var g := _playing()
	var before: Dictionary = g["registry"].save()
	# The replacement is asked to bind @world, which the game already registered:
	# it clashes mid-build.
	var r: Dictionary = (g["engine"] as StoryletEngine).hot_swap(_edited(), {"world": {"get": func(_n): return 0}})
	_check("the clash was not the refusal: " + str(r),
		not r.get("ok", true) and str(r.get("error", "")).contains("scope '@world' is already registered by Game"))
	# Every key and value as before (the order of keys may differ: registering
	# again appends).
	_expect("the registry", g["registry"].save(), before)
	var flow = (g["engine"] as StoryletEngine).get_flow("f")
	_heist(flow)
	_expect("the registry's story.gold", g["registry"].get_value("story", "gold"), 2)
	_expect("the old flow's story.steps", (flow as StoryletFlow).get_property("story.steps"), 2)
	# Its bags are registered again, not left parked: the registry sees the write.
	_expect("the registry's copy of the old flow's steps", g["registry"].save().get("storylets/flow/f/story"), {"steps": 2})
	_finished = true


func _hot_swap_live_link() -> void:
	var g := _playing()
	var r := StoryletLiveLink.apply_live_bundle(g["engine"], EDITED_JSON)
	_check("apply_live_bundle refused: " + str(r.get("error", "")), r.get("ok", false))
	if r.get("ok", false):
		_expect("story.gold", (r["engine"] as StoryletEngine).get_property("story.gold"), 1)
	_finished = true
