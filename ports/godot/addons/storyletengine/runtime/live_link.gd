# StoryletLiveLink - the game-side client for Storyletter's Live Link
# (design/live-link.md). Joins a running game to the editor over a loopback
# WebSocket. Two things travel on it: the attached session's trace stream and
# board snapshots go UP, so the editor's Board can show the game's run instead
# of its own (OBSERVE-ONLY: the game stays in control, the editor is a passive
# mirror); freshly compiled bundles come DOWN after a save, so the run picks
# up the edit without restarting (apply_live_bundle does the swap). The
# GDScript parity of the JS @storylet-studio/play-helpers createLiveLink, same
# `storyletengine/debug@1` wire protocol, held to the same shared fixture
# (packages/conformance/live-link/).
#
# It is a debug tool: it only opens the link in a debug build
# (OS.is_debug_build()); in a release export it is inert, so it is safe to
# leave wired in. A missing editor is a silent no-op, and nothing here ever
# push_errors or throws into the game.
#
# Usage - add it under any node and attach your ENGINE (v2: the link discovers
# your flows itself, so every flow is followed and none is announced by hand):
#   var link := StoryletLiveLink.new(bundle["content"]["hash"], "My Game")
#   add_child(link)                                   # starts polling
#   link.attach(engine)                               # hello + a board snapshot, then every trace event
#   link.bundle_pushed.connect(func(build: String, data: String) -> void:
#       var r := StoryletLiveLink.apply_live_bundle(engine, data, {"seed": 7})
#       if not r["ok"]:
#           return                                    # bad JSON, another project: keep yours
#       engine = r["engine"]                          # re-bind: load_game rebuilt every flow
#       flow = engine.get_flow("main")                # so re-take your flow handles too
#       link.attach(engine)
#       link.set_build(build))                        # the editor's icon goes back to in sync
#
# Wire protocol (one JSON object per text frame):
#   hello : { t:"hello", v:2, build, project?, boxes?, flows:[id...] }
#                                                         - on open, and again on set_build
#   flowOpen / flowClose : { t:"flowOpen"|"flowClose", flow }
#   trace : { t:"trace", flow, event }                    - every trace event any flow emits
#   board : { t:"board", flow, hands:{ hand: [card...] }, turns:{ box: n } }
#                                                         - after hello, and after every deal / play /
#                                                           evict / turns event
#   bundle: { t:"bundle", v:1, build, data }              - EDITOR -> game: the full .storyletsc JSON
# Frames are serialised by to_json (compact, the reference's key order and
# number formatting), not JSON.stringify, which writes 1.0 where the reference
# writes 1: the fixture is byte for byte.
class_name StoryletLiveLink
extends Node

# Live refresh: the editor pushed a freshly compiled bundle over the link.
# `data` is the full .storyletsc JSON: hand it (with your current session) to
# apply_live_bundle, attach the session it returns, then call set_build(build)
# so the editor's icon flips back to in sync. Emitted from _process, so the
# handler runs on the main thread. Never emitted with a malformed frame.
signal bundle_pushed(build: String, data: String)

const DEFAULT_URL := "ws://127.0.0.1:4472"
# The trace kinds that move the board, and so are followed by a snapshot.
const BOARD_EVENTS := ["deal", "play", "evict", "turns"]

## The socket. A WebSocketPeer, created by open() when nothing is set; a test
## sets a stand-in with the same surface first (connect_to_url, poll,
## get_ready_state, send_text, get_available_packet_count, get_packet, close)
## and drives poll() by hand.
var socket = null

var _build: String
var _project: String
var _url: String
var _queue: Array[String] = []   # frames awaiting an open socket
var _hello_sent := false
var _enabled := false            # a socket is connecting or open
var _closed := false
var _engine: StoryletEngine = null
# The flows the EDITOR believes are open; diffed against engine.flows() so
# flowOpen / flowClose are the link's own business, not the host's.
var _announced: Dictionary = {}
var _unsubscribe := Callable()


func _init(build: String, project: String = "", url: String = DEFAULT_URL) -> void:
	_build = build
	_project = project
	_url = url


func _ready() -> void:
	# Debug-only: never open the link in a release export.
	if not OS.is_debug_build():
		return
	open()


## Open the socket. _ready() does this in a debug build; call it yourself only
## when the node is not in a tree (a headless test). A second call is a no-op.
func open() -> void:
	if _closed or _enabled:
		return
	if socket == null:
		socket = WebSocketPeer.new()
	if socket.connect_to_url(_url) == OK:
		_enabled = true   # otherwise the editor is unreachable: stay a silent no-op



## Freeing the node releases everything, so a scene change or a despawn is a
## valid exit path and not just detach()/close().
##
## Without this the engine kept a Callable bound to a freed instance, and every
## later trace event produced "attempt to call function on a previously freed
## instance" - once per event, for the rest of the run. The demo happened to
## detach in its own _exit_tree, so this only bit a host following the usage
## block at the top of this file, which never mentioned teardown. Found by the
## pre-release audit, 2026-08-29.
func _exit_tree() -> void:
	close()

func _process(_delta: float) -> void:
	poll()


## Pump the socket: the handshake once it opens, queued frames, incoming
## bundles. _process() calls this every frame.
func poll() -> void:
	if not _enabled:
		return
	socket.poll()
	match socket.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _hello_sent:
				# The handshake goes straight to the socket, never through the
				# queue: the editor must read it ahead of anything queued while
				# the socket was still connecting.
				_send_hello()
				_hello_sent = true
			_flush()
			_drain_incoming()
		WebSocketPeer.STATE_CLOSED:
			# The editor closed the link, or was never there: go quiet.
			_enabled = false
			_queue.clear()


## Where the link is: "connecting", "connected" or "closed". The same three
## Unity's LiveLinkState carries, as strings because GDScript enums do not
## cross a boundary usefully. For the Runtime State panel, which shows it so a
## host can tell "the editor is not listening" from "I never attached"
## (2026-08-29: Unity's examiner had this and the other two did not).
func link_state() -> String:
	if _closed or not _enabled:
		return "closed"
	if socket != null and socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		return "connected"
	return "connecting"


## The editor URL this link talks to.
func url() -> String:
	return _url


## The build id the editor has been told this game is running.
func build() -> String:
	return _build


# -- public API (mirrors the JS LiveLink) -----------------------------------------

## Start forwarding this ENGINE's trace: every flow's events, each frame naming
## the flow it came from, so the editor can follow one participant and switch.
## An earlier engine is detached first. Sends a board snapshot per open flow
## straight away, queued behind the hello if the socket is not open yet.
##
## Flows are discovered rather than declared: the link diffs engine.flows()
## whenever anything happens and emits flowOpen / flowClose itself, so the host
## has nothing to remember and cannot get the editor's flow list wrong.
func attach(engine: StoryletEngine) -> void:
	if _closed or engine == null:
		return
	detach()
	_engine = engine
	_unsubscribe = engine.subscribe_trace(_on_trace)
	_announced = {}
	for f in _engine.flows():
		_announced[(f as StoryletFlow).id] = true
	for f in _engine.flows():
		_post(board_frame(f as StoryletFlow))


## Stop forwarding. A refresh replaces the engine (and rebuilds its flows),
## so attach the new flow afterwards.
func detach() -> void:
	if _unsubscribe.is_valid():
		_unsubscribe.call()
	_unsubscribe = Callable()
	_engine = null
	_announced = {}


## After applying a pushed bundle: report the build now running (re-hellos
## with the new build and a fresh board snapshot, so the editor's icon goes
## back to in sync and it stops re-pushing the same bundle).
func set_build(build: String) -> void:
	if _closed or build == "" or build == _build:
		return
	_build = build
	if _enabled and socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		# Re-handshake: the editor re-reads the build, then gets every flow's
		# table as the new engine has it.
		_send_hello()
		for f in _live_flows():
			_post(board_frame(f as StoryletFlow))


## Close the link; every later call is a no-op.
func close() -> void:
	_closed = true
	detach()
	_queue.clear()
	if _enabled and socket.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		socket.close()
	_enabled = false


## Live refresh: apply a bundle the editor pushed. A new ENGINE over the
## parsed bundle, loaded from the old one's save (the run carries across -
## every flow of it: turns, properties, cooldowns, the hands on the table;
## a deleted card leaves the table, a new property takes its default).
## Returns {"ok": true, "engine", "bundle"} or {"ok": false, "error"} with
## the old engine untouched: malformed JSON, a bundle the runtime rejects,
## another project. `opts` are the options the old engine was created with
## ("log" and "world" matter - neither rides the envelope; "seed" only
## shapes fresh flows, the save carries each flow's PRNG state). load_game
## rebuilt every flow, so re-take your handles from the returned engine.
static func apply_live_bundle(engine: StoryletEngine, data: String, opts: Dictionary = {}) -> Dictionary:
	var loaded := StoryletBundle.load_from_string(data)
	if not loaded["ok"]:
		return {"ok": false, "error": "pushed bundle: " + str(loaded["error"])}
	var next := StoryletEngine.create(loaded["bundle"], opts)
	if next == null:
		return {"ok": false, "error": "pushed bundle: could not create an engine (bad options)"}
	var err := next.load_game(engine.save_game())
	if err != "":
		return {"ok": false, "error": err}
	return {"ok": true, "engine": next, "bundle": loaded["bundle"]}


## The cheap snapshot: hands by gameId holding card gameIds in dealt order,
## and every box's clock by gameId. Exposed for the fixture test; hosts never
## build frames by hand.
static func board_frame(flow: StoryletFlow) -> Dictionary:
	var hands := {}
	var the_board := flow.board()
	for hand in the_board:
		var ids: Array = []
		for card in the_board[hand]:
			ids.append(card["gameId"])
		hands[hand] = ids
	var turns := {}
	for box in flow.list_boxes():
		turns[box["gameId"]] = box["turn"]
	return {"t": "board", "flow": flow.id, "hands": hands, "turns": turns}


# -- internals ----------------------------------------------------------------------

func _live_flows() -> Array:
	return _engine.flows() if _engine != null else []


func _hello_frame() -> Dictionary:
	var flows := _live_flows()
	var ids: Array = []
	for f in flows:
		ids.append((f as StoryletFlow).id)
	var hello := {"t": "hello", "v": 2, "build": _build, "flows": ids}
	if _project != "":
		hello["project"] = _project
	if not flows.is_empty():
		var boxes: Array = []
		for box in (flows[0] as StoryletFlow).list_boxes():
			boxes.append(box["gameId"])
		hello["boxes"] = boxes
	# The editor's list starts from the hello, so the diff starts there too.
	_announced = {}
	for id in ids:
		_announced[id] = true
	return hello


func _send_hello() -> void:
	socket.send_text(to_json(_hello_frame()))


## Announce anything that opened or closed since the last look. Runs before
## each forwarded event, so a frame never names a flow the editor has not been
## told about.
func _sync_flows() -> void:
	var now := _live_flows()
	var ids := {}
	for f in now:
		ids[(f as StoryletFlow).id] = true
	for f in now:
		var id: String = (f as StoryletFlow).id
		if _announced.has(id):
			continue
		_announced[id] = true
		_post({"t": "flowOpen", "flow": id})
		_post(board_frame(f as StoryletFlow))
	for id in _announced.keys():
		if ids.has(id):
			continue
		_announced.erase(id)
		_post({"t": "flowClose", "flow": id})


func _on_trace(flow_id: String, event: Dictionary) -> void:
	_sync_flows()
	_post({"t": "trace", "flow": flow_id, "event": event})
	if BOARD_EVENTS.has(event.get("type", "")):
		var f = _engine.get_flow(flow_id) if _engine != null else null
		if f != null:
			_post(board_frame(f as StoryletFlow))


func _post(frame: Dictionary) -> void:
	if _closed or not _enabled:
		return
	_queue.append(to_json(frame))
	_flush()


func _flush() -> void:
	if socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	for m in _queue:
		socket.send_text(m)
	_queue.clear()


# Live refresh: the editor pushes {t:"bundle", build, data}. The shape is
# checked here so the host's handler never sees a malformed frame; anything
# else the editor might send is ignored.
func _drain_incoming() -> void:
	while socket.get_available_packet_count() > 0:
		var raw: String = socket.get_packet().get_string_from_utf8()
		# A JSON instance, not JSON.parse_string: a frame that is not JSON is
		# ignored quietly, without an error line in the game's log.
		var parser := JSON.new()
		if parser.parse(raw) != OK:
			continue
		var msg = parser.data
		if typeof(msg) != TYPE_DICTIONARY:
			continue
		if msg.get("t", "") == "bundle" and msg.get("build", "") is String and msg.get("data", "") is String:
			var build: String = msg["build"]
			var data: String = msg["data"]
			if build != "" and data != "":
				bundle_pushed.emit(build, data)


# -- JSON, the reference's way -------------------------------------------------------

## Compact JSON in the shape JS JSON.stringify gives: Dictionary keys in
## insertion order, no whitespace, and numbers formatted as JavaScript does
## (an integer-valued float is "1", never "1.0"; a fraction is its shortest
## round-trip form). JSON numbers parse to floats in Godot, so every count and
## turn in a trace event is one, and Godot's own JSON.stringify would put them
## on the wire as 1.0 where the reference writes 1.
static func to_json(value) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return str(value)
		TYPE_FLOAT:
			return _js_number(value)
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(value))
		TYPE_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_INT64_ARRAY:
			var items: Array = []
			for x in value:
				items.append(to_json(x))
			return "[" + ",".join(items) + "]"
		TYPE_DICTIONARY:
			var pairs: Array = []
			for k in value:
				pairs.append(JSON.stringify(str(k)) + ":" + to_json(value[k]))
			return "{" + ",".join(pairs) + "}"
	return JSON.stringify(value)


# JavaScript's Number-to-string: integers plain, fractions at the shortest
# precision that round-trips, exponent form outside [1e-6, 1e21), and NaN /
# Infinity as null (what JSON.stringify does with them).
static func _js_number(n: float) -> String:
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
		return "%se%s%d" % [_js_number(m), "+" if e > 0 else "", e]
	if n == floor(n) and mag < 9.2e18:
		return str(int(n))
	if n == floor(n):
		return String.num(n, 0)
	for decimals in range(1, 18):
		var s := String.num(n, decimals)
		if s.to_float() == n:
			return s
	return String.num(n, 17)
