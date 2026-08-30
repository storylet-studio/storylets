# The Live Link fixture replay (packages/conformance/live-link/): the scripted
# session from script.json driven against a StoryletLiveLink over a fake
# socket, and every string the link put on the wire compared, byte for byte,
# with the compact form of frames.json (packages/conformance/README.md says
# how: key order and number formatting are the JS reference's). This is the
# client's contract; a port that sends anything else is wrong by definition.
#
#   godot --headless --path ports/godot --script res://test/test_live_link.gd
#
# (import the project once first: godot --headless --path ports/godot --import)
# Prints PASS/FAIL lines then LIVE LINK ALL PASS (exit 0) or N FAILED (exit 1).
extends SceneTree

var _fails := 0


# A stand-in for WebSocketPeer with the surface the link uses: the test opens
# it by hand and reads back every string sent. Nothing is sent before open.
class FakePeer:
	extends RefCounted
	var state: int = WebSocketPeer.STATE_CONNECTING
	var url := ""
	var sent: Array[String] = []
	var inbox: Array[PackedByteArray] = []
	var closed := false

	func connect_to_url(to: String) -> int:
		url = to
		return OK

	func poll() -> void:
		pass

	func get_ready_state() -> int:
		return state

	func send_text(text: String) -> int:
		if state != WebSocketPeer.STATE_OPEN:
			push_error("fake peer: send on a socket that is not open")
			return ERR_UNAVAILABLE
		sent.append(text)
		return OK

	func get_available_packet_count() -> int:
		return inbox.size()

	func get_packet() -> PackedByteArray:
		return inbox.pop_front()

	func close(_code: int = 1000, _reason: String = "") -> void:
		closed = true
		state = WebSocketPeer.STATE_CLOSED

	# The test's side of the wire.
	func open() -> void:
		state = WebSocketPeer.STATE_OPEN

	func receive(text: String) -> void:
		inbox.append(text.to_utf8_buffer())


func _check(name: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("PASS %s" % name)
	else:
		_fails += 1
		printerr("FAIL %s%s" % [name, (": " + detail) if detail != "" else ""])


func _initialize() -> void:
	var repo := ProjectSettings.globalize_path("res://").path_join("../..")
	var fixture := repo.path_join("packages/conformance/live-link")
	var script_text := FileAccess.get_file_as_string(fixture.path_join("script.json"))
	var frames_text := FileAccess.get_file_as_string(fixture.path_join("frames.json"))
	_check("fixture readable", script_text != "" and frames_text != "", fixture)
	if script_text == "" or frames_text == "":
		quit(2)
		return
	var script: Dictionary = JSON.parse_string(script_text)
	_check("fixture schema", script.get("schema") == "storylets/live-link-fixture@1", str(script.get("schema")))

	var bundle_text := FileAccess.get_file_as_string(repo.path_join(str(script["bundle"])))
	var loaded := StoryletBundle.load_from_string(bundle_text)
	_check("bundle loads", loaded["ok"], str(loaded.get("error", "")))
	if not loaded["ok"]:
		quit(2)
		return
	var bundle: Dictionary = loaded["bundle"]
	_check("the bundle the script names is the build it claims",
		str(bundle["content"]["hash"]) == str(script["build"]))

	# -- the replay ------------------------------------------------------------------
	var peer := FakePeer.new()
	var link := StoryletLiveLink.new(str(script["build"]), str(script.get("project", "")))
	link.socket = peer
	link.open()   # a headless test: the node is not in a tree, so _ready() never runs
	var engine := StoryletEngine.create(bundle, {"seed": int(script["seed"])})
	engine.open_flow("main")
	# `flow` names which participant runs the step; absent means "main", so the
	# single-flow half of the script reads exactly as it always did.
	var on := func(step: Dictionary) -> StoryletFlow:
		return engine.get_flow(str(step.get("flow", "main")))
	for step in script["steps"]:
		match str(step["op"]):
			"attach":
				link.attach(engine)
			"open":
				peer.open()
				link.poll()
			"openFlow":
				engine.open_flow(str(step["flow"]))
			"closeFlow":
				engine.close_flow(str(step["flow"]))
			"dealMany":
				(on.call(step) as StoryletFlow).deal_many(step.get("hands"))
			"deal":
				(on.call(step) as StoryletFlow).deal(str(step["hand"]))
			"play":
				var err: String = (on.call(step) as StoryletFlow).play(str(step["card"]), str(step["outcome"]), str(step["hand"]))
				_check("play %s -> %s" % [step["card"], step["outcome"]], err == "", err)
			"advanceTurns":
				(on.call(step) as StoryletFlow).advance_turns(str(step["box"]), float(step.get("n", 1)))
			"peek":
				(on.call(step) as StoryletFlow).peek(str(step["box"]), step.get("criteria", {}), step.get("n"))
			_:
				_check("known step op", false, str(step["op"]))
		link.poll()
	link.close()
	_check("close closes the socket", peer.closed)
	link.free()   # a Node outside any tree is freed by hand

	# -- the comparison ----------------------------------------------------------------
	# frames.json is pretty-printed for review; the contract is its compact
	# form. Minifying the committed text (whitespace outside strings dropped)
	# keeps the reference's own number spelling, so the comparison is against
	# what JSON.stringify wrote, not against this port's idea of it.
	var expected := _split_top_level(_minify(frames_text))
	_check("frame count", expected.size() == peer.sent.size(),
		"expected %d frames, sent %d" % [expected.size(), peer.sent.size()])
	var n := mini(expected.size(), peer.sent.size())
	var first_diff := -1
	for i in n:
		if expected[i] != peer.sent[i]:
			first_diff = i
			break
	_check("every frame is byte for byte the reference's", first_diff < 0,
		"" if first_diff < 0 else "frame %d\n  expected %s\n  sent     %s" % [first_diff, expected[first_diff], peer.sent[first_diff]])

	# The shape rules, independently of the fixture text: hello then board,
	# and a board after every board-moving trace event, never otherwise.
	var kinds: Array = []
	for s in peer.sent:
		kinds.append(JSON.parse_string(s))
	_check("opens with hello then board", kinds.size() >= 2 and kinds[0].get("t") == "hello" and kinds[1].get("t") == "board")
	var boards_ok := true
	for i in kinds.size():
		var f: Dictionary = kinds[i]
		if f.get("t") != "trace":
			continue
		var moves: bool = StoryletLiveLink.BOARD_EVENTS.has(f["event"].get("type", ""))
		var followed: bool = i + 1 < kinds.size() and kinds[i + 1].get("t") == "board"
		if moves != followed:
			boards_ok = false
	_check("every board-moving event is followed by a board, nothing else is", boards_ok)

	# -- the editor's side: a pushed bundle -----------------------------------------
	_check_live_refresh(bundle, bundle_text)

	# -- the number formatting the contract leans on ----------------------------------
	_check("to_json writes integer floats as integers",
		StoryletLiveLink.to_json({"a": 1.0, "b": [10.0, 0.5], "c": -0.0}) == '{"a":1,"b":[10,0.5],"c":0}',
		StoryletLiveLink.to_json({"a": 1.0, "b": [10.0, 0.5], "c": -0.0}))
	_check("to_json writes fractions at their shortest round trip",
		StoryletLiveLink.to_json([0.1, 0.1 + 0.2, 1.0 / 3.0]) == "[0.1,0.30000000000000004,0.3333333333333333]",
		StoryletLiveLink.to_json([0.1, 0.1 + 0.2, 1.0 / 3.0]))
	_check("to_json writes exponents as JavaScript does",
		StoryletLiveLink.to_json([1e21, 1e-7, 1.5e-7, 1e22]) == "[1e+21,1e-7,1.5e-7,1e+22]",
		StoryletLiveLink.to_json([1e21, 1e-7, 1.5e-7, 1e22]))
	_check("to_json keeps strings, bools and null",
		StoryletLiveLink.to_json({"s": "a\"b", "t": true, "n": null}) == '{"s":"a\\"b","t":true,"n":null}',
		StoryletLiveLink.to_json({"s": "a\"b", "t": true, "n": null}))

	print("LIVE LINK %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)


# A pushed bundle arrives as {t:"bundle", build, data}: the link emits
# bundle_pushed, apply_live_bundle builds a new session carrying the run, and
# set_build re-hellos with the new build and a fresh board. Garbage never
# reaches the handler; a foreign bundle never replaces the session.
func _check_live_refresh(bundle: Dictionary, bundle_text: String) -> void:
	var peer := FakePeer.new()
	var link := StoryletLiveLink.new(str(bundle["content"]["hash"]), "Refresh")
	link.socket = peer
	link.open()
	peer.open()
	var engine := StoryletEngine.create(bundle, {"seed": 7, "log": true})
	var session := engine.open_flow("main")
	link.attach(engine)
	link.poll()
	session.deal_many()
	link.poll()
	var before := peer.sent.size()
	var saved_turn := session.turn("village")
	var saved_board := StoryletLiveLink.board_frame(session)

	var pushed: Array = []
	link.bundle_pushed.connect(func(build: String, data: String) -> void: pushed.append({"build": build, "data": data}))
	peer.receive("not json")
	peer.receive('{"t":"bundle","build":"","data":""}')
	peer.receive('{"t":"other"}')
	link.poll()
	_check("malformed and empty bundle frames never reach the handler", pushed.is_empty(), str(pushed.size()))

	# The edited bundle: the same project with a new hash (an edit the
	# editor compiled), so the run must carry across.
	var edited: Dictionary = JSON.parse_string(bundle_text)
	edited["content"]["hash"] = "edited1"
	peer.receive(JSON.stringify({"t": "bundle", "v": 1, "build": "edited1", "data": JSON.stringify(edited)}))
	link.poll()
	_check("a bundle frame reaches the handler once", pushed.size() == 1, str(pushed.size()))
	if pushed.size() != 1:
		return
	var r := StoryletLiveLink.apply_live_bundle(engine, pushed[0]["data"], {"seed": 7, "log": true})
	_check("apply_live_bundle succeeds on the edited bundle", r["ok"], str(r.get("error", "")))
	if not r["ok"]:
		return
	var next_engine: StoryletEngine = r["engine"]
	_check("the new engine is a different engine", next_engine != engine)
	var next: StoryletFlow = next_engine.get_flow("main")
	_check("load_game rebuilt the main flow", next != null)
	_check("the run carried across (turns and board)",
		next.turn("village") == saved_turn and StoryletLiveLink.board_frame(next) == saved_board)
	_check("the new engine runs the edited bundle", str(r["bundle"]["content"]["hash"]) == "edited1")

	link.attach(next_engine)
	var after_attach := peer.sent.size()
	_check("attach sends a board", after_attach == before + 1, "%d -> %d" % [before, after_attach])
	link.set_build(pushed[0]["build"])
	_check("set_build re-hellos with the new build then sends a board",
		peer.sent.size() == after_attach + 2
		and peer.sent[after_attach] == StoryletLiveLink.to_json({"t": "hello", "v": 2, "build": "edited1", "flows": ["main"], "project": "Refresh", "boxes": ["village"]})
		and JSON.parse_string(peer.sent[after_attach + 1]).get("t") == "board",
		str(peer.sent.slice(after_attach)))
	link.set_build("edited1")
	_check("set_build with the same build is a no-op", peer.sent.size() == after_attach + 2)

	# Refusals leave the old session alone (the bundle loader's parse error
	# line below is expected).
	print("(expected refusal error follows)")
	var bad := StoryletLiveLink.apply_live_bundle(next_engine, "{ nope")
	_check("garbage JSON is refused", not bad["ok"] and str(bad.get("error", "")) != "")
	var foreign: Dictionary = JSON.parse_string(bundle_text)
	foreign["content"]["project"] = "proj_other"
	var wrong := StoryletLiveLink.apply_live_bundle(next_engine, JSON.stringify(foreign))
	_check("another project's bundle is refused", not wrong["ok"] and str(wrong.get("error", "")).contains("project"), str(wrong))
	link.close()
	link.free()   # a Node outside any tree is freed by hand


# -- JSON text helpers ------------------------------------------------------------------

# Drop every whitespace character outside string literals: the compact form
# of a pretty-printed JSON text, with the numbers exactly as written.
static func _minify(text: String) -> String:
	var out := PackedStringArray()
	var in_string := false
	var escaped := false
	for ch in text:
		if in_string:
			out.append(ch)
			if escaped:
				escaped = false
			elif ch == "\\":
				escaped = true
			elif ch == "\"":
				in_string = false
		elif ch == "\"":
			in_string = true
			out.append(ch)
		elif ch == " " or ch == "\n" or ch == "\r" or ch == "\t":
			continue
		else:
			out.append(ch)
	return "".join(out)


# The elements of a compact top-level JSON array, each as its own compact text.
static func _split_top_level(compact: String) -> Array[String]:
	var items: Array[String] = []
	var depth := 0
	var in_string := false
	var escaped := false
	var start := -1
	for i in compact.length():
		var ch := compact[i]
		if in_string:
			if escaped:
				escaped = false
			elif ch == "\\":
				escaped = true
			elif ch == "\"":
				in_string = false
			continue
		match ch:
			"\"":
				in_string = true
			"[", "{":
				if depth == 1 and start < 0:
					start = i
				depth += 1
			"]", "}":
				depth -= 1
				if depth == 1 and start >= 0:
					items.append(compact.substr(start, i - start + 1))
					start = -1
	return items
