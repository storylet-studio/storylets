# The combined proof on Godot: a Patter engine and a Storylet Engine in one game,
# on ONE scope registry, with one save (patterkit
# design/one-registry-handover.md). The GDScript port of the JS runtime's
# packages/runtime/test/with-patter/combined-game.test.ts, case for case, with
# the same content and the same expectations.
#
# The game owns the registry and registers @world itself, as a property the
# registry stores. Each engine registers its own scopes: the Storylet Engine
# @story and its per-flow bags, Patter @patter and its per-flow and per-scene
# bags. Every expression reads every scope, so a Patter scene gates on
# @story.act, and a storylet gates on a @world value a Patter scene wrote.
# One save is {registry, patter, storylets}.
#
# It needs BOTH addons in one project, and Patterplay from the SOURCE of a
# sibling ../patter checkout, so it does not run in this repo's own project
# (this folder carries a .gdignore). run.sh beside it assembles a throwaway
# project from the two addons' source and runs it there:
#
#   bash ports/godot/test/with-patter/run.sh
#
# GDScript is duck typed and both addons wrap one shared registry source, so
# either addon's registry serves both engines: every case runs twice, once on a
# registry the game made with Patterplay's shim and once with the Storylet
# Engine's. A first case proves the two addons' class_names coexist.
#
# Prints ok/FAIL lines, then WITH PATTER ALL PASS (exit 0) or
# WITH PATTER N FAILED (exit 1). A script that fails to PARSE exits 0 printing
# neither, which is why run.sh reads for the verdict line.
extends SceneTree

var _fails := 0
## Set by each case as its last act: a GDScript runtime error abandons the
## function part way, which would otherwise read as a case with no failures.
var _finished := false
## The same for the whole run: an error in it would skip quit() and hang.
var _run_finished := false
## Which shim builds the game's registry for the current pass.
var _shim_name := "setup"
var _shim: GDScript = null


# --- the Storylet Engine's content -----------------------------------------------
#
# The JS test's storyletBundle(), expanded exactly as the conformance package's
# expandBundle writes it (the scaffold's box, zone tags and hand included).
# `extra_story` is the newer build's extra @story property, rumours.

const STORYLET_BUNDLE_JSON := """{"schema":"storylets/bundle@0","content":{"project":"conf","version":"0.0.0","hash":""},"metadata":"full","settings":{"playAdvancesTurns":1},
"world":{"properties":[{"name":"alarm","type":"number","default":0}]},
"story":{"properties":[{"name":"act","type":"number","default":1}]},
"boxes":[{"id":"b_x","gameId":"box","ranking":{"specificity":true},"fields":[],"properties":[],
 "tagGroups":[{"id":"d_zone","gameId":"zone","tags":[{"id":"v_docks","gameId":"docks","properties":[{"name":"danger","type":"number","default":0}]},{"id":"v_market","gameId":"market"}]}],
 "decks":[{"id":"k_main","gameId":"main","properties":[],
  "cards":[
   {"id":"c_heist","gameId":"heist","priority":0,"redraw":"never","outcomes":[{"id":"o_go","gameId":"go","changes":{
    "@story.act":{"src":"@story.act + 1","ast":["bin","+",["sv","story","act"],["n",1]]},
    "@world.alarm":{"src":"@world.alarm + 1","ast":["bin","+",["sv","world","alarm"],["n",1]]}}}]},
   {"id":"c_manhunt","gameId":"manhunt","condition":{"src":"@world.alarm >= 10","ast":["bin",">=",["sv","world","alarm"],["n",10]]},
    "priority":0,"redraw":"always","outcomes":[{"id":"o_run","gameId":"run","changes":{}}]}]}],
 "handTemplates":[],"hands":[{"id":"h_q","gameId":"q","rule":{"slots":"unbounded"}}]}]}"""


static func _storylet_bundle(extra_story := false) -> Dictionary:
	var b: Dictionary = JSON.parse_string(STORYLET_BUNDLE_JSON)
	if extra_story:
		b["story"]["properties"].append({"name": "rumours", "type": "number", "default": 0})
	return b


# --- Patter's content, compiled against the Storylet Engine's published scopes -----
#
# The JS test's patterBundle(line), as Patter's exportBundle writes it: the
# guard's snippet waits for @story.act >= 2 and, on exit, raises @world.alarm by
# ten and counts a visit. Only the line's text changes between the builds, so
# the structure hash is one and the build hash is the compiler's for each text.

const LINE_HASHES := {"Thief!": "1q2dsxn", "Stop, thief!": "1d8lt0v", "Halt!": "04hkhhs"}


static func _src(src: String, ast: Array) -> Dictionary:
	return {"src": src, "ast": ast}


static func _patter_bundle(line := "Thief!") -> Dictionary:
	return {
		"schema": "patter/bundle@0",
		"content": {"project": "p", "hash": LINE_HASHES.get(line, ""), "structureHash": "0zmhmuj"},
		"voiced": false,
		"locales": {"default": "en", "included": ["en"]},
		"cast": [{"name": "GUARD"}],
		"properties": [{"name": "visits", "type": "number", "default": 0, "shared": true}],
		"scenes": {"gate": {"id": "gate", "type": "scene", "name": "Gate", "gameId": "gate",
			"blocks": [{"id": "b", "type": "block", "name": "B", "children": [{
				"id": "shout", "type": "snippet",
				"condition": _src("@story.act >= 2", ["bin", ">=", ["sv", "story", "act"], ["n", 2]]),
				"beats": [{"id": "L", "kind": "line", "character": "GUARD"}],
				"onExit": [
					{"kind": "set", "target": "@world.alarm",
						"value": _src("@world.alarm + 10", ["bin", "+", ["sv", "world", "alarm"], ["n", 10]])},
					{"kind": "set", "target": "@visits",
						"value": _src("@visits + 1", ["bin", "+", ["sv", "patter", "visits"], ["n", 1]])},
				],
				"jump": {"to": "END"},
			}]}]}},
		"strings": {"en": {"L": line}},
	}


# --- the game ----------------------------------------------------------------------

## One registry for the game, made with the current pass's shim. @world is the
## game's, stored by the registry; both engines read it.
func _combined_game(storylet_bundle = null, patter_line := "Thief!") -> Dictionary:
	var registry = _shim.new()
	registry.define_owned("world", [{"name": "alarm", "type": "number", "default": 0}], {"owner": "Game"})
	var storylets := StoryletEngine.create(
		storylet_bundle if storylet_bundle != null else _storylet_bundle(), {"registry": registry, "seed": 3})
	var patter := PatterEngine.new(_patter_bundle(patter_line), {"registry": registry, "seed": 3})
	_check("the Storylet Engine took the game's registry", storylets != null, "create returned null")
	_check("Patter took the game's registry", patter.init_error() == "", patter.init_error())
	return {"registry": registry, "storylets": storylets, "patter": patter}


func _heist(flow: StoryletFlow) -> void:
	var dealt := flow.deal("q")
	var card = null
	for c in dealt:
		if c["gameId"] == "heist":
			card = c
	if card == null:
		_check("the heist is dealt", false, str(dealt))
		return
	var err := flow.play(str(card["gameId"]), "go", "q")
	_check("the heist plays", err == "", err)


## Play the first part: a heist moves the story to act two, then the Patter
## guard shouts.
func _play_first_part(g: Dictionary) -> void:
	var patter: PatterEngine = g["patter"]
	var guard := patter.open_flow("guard", "gate")
	_expect("act 1: the gate stays quiet", guard.advance(), {"type": "end"})
	_heist((g["storylets"] as StoryletEngine).open_flow("thief"))
	var again := patter.open_flow("guard", "gate")
	var step: Dictionary = again.advance()
	_check("act 2: the guard shouts", step.get("type") == "line" and step.get("character") == "GUARD", str(step))
	patter.open_flow("watch", "gate")   # a second Patter flow, mid-scene


## The game's one save, through JSON and back as a save file would travel.
static func _save_all(g: Dictionary) -> Dictionary:
	return JSON.parse_string(JSON.stringify({
		"registry": g["registry"].save(),
		"patter": (g["patter"] as PatterEngine).save_game(),
		"storylets": (g["storylets"] as StoryletEngine).save_game(),
	}))


static func _game_ids(cards: Array) -> Array:
	return cards.map(func(c): return c["gameId"])


static func _sorted(a: Array) -> Array:
	var out := a.duplicate()
	out.sort()
	return out


# --- the run -----------------------------------------------------------------------

func _initialize() -> void:
	_run()
	if not _run_finished:
		print("  FAIL the run stopped on a script error part way through (see SCRIPT ERROR above)")
		_fails += 1
	print("WITH PATTER " + ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(1 if _fails > 0 else 0)


func _run() -> void:
	_case("both addons' class_names coexist in one project", _class_names_coexist)
	var shims := [
		["a registry made with Patterplay's shim", PatterScopeRegistry],
		["a registry made with the Storylet Engine's shim", StoryletScopeRegistry],
	]
	for s in shims:
		_shim_name = s[0]
		_shim = s[1]
		print("-- on " + _shim_name)
		_case("each engine reads the other's writes through the one registry", _reads_each_others_writes)
		_case("saves every property once, in the registry; neither engine's save holds one", _saves_once)
		_case("resumes both engines from the one save, registry first", _resumes.bind(true))
		_case("resumes both engines from the one save, engines first", _resumes.bind(false))
		_case("loads across content drift in both engines, and Patter hot-swaps without disturbing the other", _drift_and_hot_swap)
		_case("a token clash fails as the game combines its engines, naming who holds it", _clash)
	_run_finished = true


func _case(title: String, body: Callable) -> void:
	var before := _fails
	_finished = false
	body.call()
	if not _finished:
		_check("stopped on a script error part way through (see SCRIPT ERROR above)", false, "")
	print(("  ok   " if _fails == before else "  FAIL ") + title)


# --- the cases ---------------------------------------------------------------------

## Godot keeps class_names in ONE project-wide namespace, so two addons that
## both claimed a name could not be installed together. Every class_name either
## addon's source declares must be registered, and registered to the file that
## declares it: a name two files claimed would leave one of them unregistered.
## Read from the files, not a list, so a class added to either addon is covered.
func _class_names_coexist() -> void:
	var registered := {}
	for c in ProjectSettings.get_global_class_list():
		registered[str(c["class"])] = str(c["path"])
	var declared := {}   # name -> [paths]
	for addon in ["res://addons/patterplay", "res://addons/storyletengine"]:
		var found := _declared_class_names(addon, declared)
		_check("%s declares class_names" % addon, found > 0, "none found")
	for name in declared:
		var paths: Array = declared[name]
		_check("class_name %s is declared once across both addons" % name, paths.size() == 1, str(paths))
		_check("class_name %s is registered to the file declaring it" % name,
			registered.get(name, "") == paths[0], "%s -> %s" % [paths, registered.get(name, "(unregistered)")])
	print("    %d class_names across the two addons" % declared.size())
	# And the four the game touches here resolve to the right addon.
	_check("PatterEngine is Patterplay's", (PatterEngine as Script).resource_path.begins_with("res://addons/patterplay/"), "")
	_check("StoryletEngine is the Storylet Engine's", (StoryletEngine as Script).resource_path.begins_with("res://addons/storyletengine/"), "")
	var p_base := (PatterScopeRegistry as Script).get_base_script()
	var s_base := (StoryletScopeRegistry as Script).get_base_script()
	# Each shim extends its own addon's vendored copy of the shared registry (the
	# copies differ only in the identity stamped in at vendoring).
	_check("the two registry shims are distinct classes, each over its own addon's copy",
		PatterScopeRegistry != StoryletScopeRegistry and p_base != null and s_base != null
		and p_base.resource_path == "res://addons/patterplay/runtime/expr/scope_registry.gd"
		and s_base.resource_path == "res://addons/storyletengine/runtime/expr/scope_registry.gd",
		"%s / %s" % [p_base, s_base])
	_finished = true


func _declared_class_names(dir_path: String, into: Dictionary) -> int:
	var n := 0
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return 0
	for sub in dir.get_directories():
		n += _declared_class_names(dir_path + "/" + sub, into)
	for f in dir.get_files():
		if not f.ends_with(".gd"):
			continue
		var path := dir_path + "/" + f
		for line in FileAccess.get_file_as_string(path).split("\n"):
			if line.begins_with("class_name "):
				var name := line.substr(11).strip_edges().split(" ")[0]
				if not into.has(name):
					into[name] = []
				into[name].append(path)
				n += 1
	return n


func _reads_each_others_writes() -> void:
	var g := _combined_game()
	_play_first_part(g)
	var guard := (g["patter"] as PatterEngine).get_flow("guard")
	_expect("onExit: alarm +10, visits +1", guard.advance(), {"type": "end"})
	_expect("1 from the heist, 10 from the guard", g["registry"].get_value("world", "alarm"), 11)
	_expect("Patter reads the Storylet Engine's scope", (g["patter"] as PatterEngine).get_property("@story.act"), 2)
	_expect("and the Storylet Engine reads Patter's", (g["storylets"] as StoryletEngine).get_property("patter.visits"), 1)
	var dealt := _game_ids(((g["storylets"] as StoryletEngine).get_flow("thief") as StoryletFlow).deal("q"))
	_check("the storylet gated on Patter's write is dealt now", dealt.has("manhunt"), str(dealt))
	_finished = true


func _saves_once() -> void:
	var g := _combined_game()
	_play_first_part(g)
	(g["patter"] as PatterEngine).get_flow("guard").advance()
	var save := _save_all(g)
	_expect("save.registry.world", save["registry"].get("world"), {"alarm": 11})
	_expect("save.registry.story", save["registry"].get("story"), {"act": 2})
	_expect("save.registry.patter", save["registry"].get("patter"), {"visits": 1})
	_check("Patter's save holds no registry", not save["patter"].has("registry"), str(save["patter"].keys()))
	_check("the Storylet Engine's save holds no registry", not save["storylets"].has("registry"), str(save["storylets"].keys()))
	_expect("save.storylets.shared", save["storylets"].get("shared"), {"spent": []})
	# The owner label groups one examiner's rows by engine.
	var owners := {}
	for r in g["registry"].list_properties():
		owners[str(r.get("owner"))] = true
	_expect("the owner labels", _sorted(owners.keys()), ["Game", "Patter", "Storylet Engine"])
	_finished = true


func _resumes(registry_first: bool) -> void:
	var g1 := _combined_game()
	_play_first_part(g1)
	var save := _save_all(g1)

	var g2 := _combined_game()
	var patter: PatterEngine = g2["patter"]
	var storylets: StoryletEngine = g2["storylets"]
	if registry_first:
		g2["registry"].load(save["registry"])
	_check("Patter loads its part", patter.load_game(save["patter"]), "")
	storylets.load_game(save["storylets"])
	if not registry_first:
		g2["registry"].load(save["registry"])

	_expect("story.act", g2["registry"].get_value("story", "act"), 2)
	_expect("world.alarm", g2["registry"].get_value("world", "alarm"), 1)
	# Patter resumes the guard mid-line: the exit writes land on the restored world.
	var guard := patter.get_flow("guard")
	if guard == null:
		_check("the guard's flow resumed", false, "")
		return
	_expect("the guard ends", guard.advance(), {"type": "end"})
	_expect("world.alarm after the guard", g2["registry"].get_value("world", "alarm"), 11)
	# The Storylet Engine's spent heist stayed spent; the manhunt is open.
	var thief = storylets.get_flow("thief")
	if thief == null:
		_check("the thief's flow resumed", false, "")
		return
	var dealt := _game_ids((thief as StoryletFlow).deal("q"))
	_check("the manhunt is open", dealt.has("manhunt"), str(dealt))
	_check("the heist stayed spent", not dealt.has("heist"), str(dealt))
	# And a second save of the resumed game carries the same shape.
	_expect("a second save's registry keys", _sorted(_save_all(g2)["registry"].keys()), _sorted(save["registry"].keys()))
	_finished = true


func _drift_and_hot_swap() -> void:
	var g1 := _combined_game()
	_play_first_part(g1)
	var save := _save_all(g1)

	# A newer build: the Storylet Engine declares a new @story property, Patter rewords a line.
	var g2 := _combined_game(_storylet_bundle(true), "Stop, thief!")
	var storylets: StoryletEngine = g2["storylets"]
	g2["registry"].load(save["registry"])
	_check("Patter loads its part", (g2["patter"] as PatterEngine).load_game(save["patter"]), "")
	storylets.load_game(save["storylets"])
	_expect("new: its default", storylets.get_property("story.rumours"), 0)
	_expect("known: restored", storylets.get_property("story.act"), 2)

	# visits 0 -> 1, alarm 1 -> 11
	_expect("the guard ends", (g2["patter"] as PatterEngine).get_flow("guard").advance(), {"type": "end"})

	# A live Patter edit mid-game: its bags are handed over on the same registry.
	var swapped := (g2["patter"] as PatterEngine).hot_swap(_patter_bundle("Halt!"))
	_expect("Patter's own value, carried over", swapped.get_property("@visits"), 1)
	_expect("@story.act after the swap", swapped.get_property("@story.act"), 2)
	var watch := swapped.get_flow("watch")
	if watch == null:
		_check("the watch's flow survived the swap", false, "")
		return
	var step: Dictionary = watch.advance()
	_check("the watch speaks the new line", step.get("type") == "line" and step.get("text") == "Halt!", str(step))
	_expect("then ends", watch.advance(), {"type": "end"})
	_expect("@visits after the watch", swapped.get_property("@visits"), 2)
	_expect("world.alarm after the watch", g2["registry"].get_value("world", "alarm"), 21)
	_expect("the other engine never noticed", storylets.get_property("story.act"), 2)
	_finished = true


func _clash() -> void:
	var registry = _shim.new()
	_check("the first Storylet Engine registers", StoryletEngine.create(_storylet_bundle(), {"registry": registry}) != null, "")
	var before: Dictionary = registry.save()
	_check("a second Storylet Engine is refused", StoryletEngine.create(_storylet_bundle(), {"registry": registry}) == null, "")
	# create() hands back null with push_error; the message is the engine's.
	var probe := StoryletEngine.new(_storylet_bundle(), {"registry": registry})
	_check("naming the Storylet Engine as @story's holder",
		probe._init_error.contains("scope '@story' is already registered by Storylet Engine"), probe._init_error)
	_expect("the registry after the refusals", registry.save(), before)

	var first := PatterEngine.new(_patter_bundle(), {"registry": registry})
	_check("the first Patter registers beside it", first.init_error() == "", first.init_error())
	var second := PatterEngine.new(_patter_bundle(), {"registry": registry})
	_check("a second Patter is refused, naming Patter as @patter's holder",
		second.init_error().contains("scope '@patter' is already registered by Patter"), second.init_error())
	_finished = true


# --- helpers -----------------------------------------------------------------------

func _check(what: String, ok: bool, detail: String) -> void:
	if not ok:
		_fails += 1
		print("    FAIL [%s] %s  <- %s" % [_shim_name, what, detail])


func _expect(what: String, got, want) -> void:
	_check(what, _same(got, want), "expected %s, got %s" % [JSON.stringify(want), JSON.stringify(got)])


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
