# StoryletLiveLink - the game-side client for Storyletter's Live Link
# (design/live-link.md). Joins a running game to the editor over a loopback
# WebSocket. Two things travel on it: the attached flow's trace stream and
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
# It reconnects, by the rule Patter's debug link shares: until the game closes
# it, a socket that closes or never opens is tried again after 1 s, doubling to
# 10 s, and back to 1 s once a hello goes. Each new socket says hello again with
# the build and the open flows, then every flow's board. One line is printed
# when an open link is lost and one when it is back; a link that never opened
# prints nothing. Frames queue only while the first socket connects: after any
# attempt fails or closes, nothing queues until a socket is open again. The
# editor closes a game it replaced (another game connected) with code 4000, and
# that one does not retry, so two games do not take turns.
#
# Usage - add it under any node and attach your ENGINE (v2: the link discovers
# your flows itself, so every flow is followed and none is announced by hand):
#   var link := StoryletLiveLink.new(bundle["content"]["hash"], "My Game")
#   add_child(link)                                   # starts polling
#   link.attach(engine)                               # hello + a board snapshot, then every trace event
#   link.bundle_pushed.connect(func(build: String, data: String) -> void:
#       var r := StoryletLiveLink.apply_live_bundle(engine, data)
#       if not r["ok"]:
#           return                                    # bad JSON, another project: keep yours
#       engine = r["engine"]                          # re-bind: hot_swap rebuilt every flow
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
# `data` is the full .storyletsc JSON: hand it (with your current flow) to
# apply_live_bundle, attach the flow it returns, then call set_build(build)
# so the editor's icon flips back to in sync. Emitted from _process, so the
# handler runs on the main thread. Never emitted with a malformed frame.
signal bundle_pushed(build: String, data: String)

const DEFAULT_URL := "ws://127.0.0.1:4472"
# The trace kinds that move the board, and so are followed by a snapshot.
# A discard changes the board as a play does.
const BOARD_EVENTS := ["deal", "play", "discard", "evict", "turns"]
# The editor's server closes a game it replaced (another game connected) with
# this code. A replaced link stays closed: retrying would only take the editor
# back from the game that took it over.
const CLOSE_REPLACED := 4000
# The wait before trying again after a close or a failed attempt: 1 s,
# doubling to at most 10 s, back to 1 s once a hello goes out.
const RETRY_FIRST_MS := 1000
const RETRY_MAX_MS := 10000

## The socket. A WebSocketPeer, created by open() when nothing is set; a test
## sets a stand-in with the same surface first (connect_to_url, poll,
## get_ready_state, get_close_code, send_text, get_available_packet_count,
## get_packet, close) and drives poll() by hand. A retry dials the same socket
## again.
var socket = null

var _build: String
var _project: String
var _url: String
var _queue: Array[String] = []   # frames awaiting the first socket's open
var _hello_sent := false         # this socket has said hello (so it opened)
var _enabled := false            # the game wants the link: on until close(), or the editor replaced us
var _closed := false
var _dropped := false            # an attempt has failed or closed: queue nothing until a socket opens
var _retry_at := 0               # clock ms of the next attempt; 0 while one is under way
var _retry_wait := RETRY_FIRST_MS
var _lost := false               # an open link went away and we said so; say so when it's back
# A test's clock: when 0 or more it stands in for Time.get_ticks_msec(), so the
# waits are asserted without sleeping through them.
var _clock_ms := -1
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
## when the node is not in a tree (a headless test). A second call is a no-op,
## and so is any call after close(). A link the editor replaced (another game
## took its place) is switched back on by calling open() again.
func open() -> void:
	if _closed or _enabled:
		return
	if socket == null:
		socket = WebSocketPeer.new()
	_enabled = true
	_dial()


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
	if _retry_at > 0:
		# Between attempts there is no socket to pump: wait for the next one.
		if _now() < _retry_at:
			return
		_retry_at = 0
		_dial()
		return
	if socket.get_ready_state() == WebSocketPeer.STATE_CONNECTING:
		# Godot warns from inside poll() when an attempt finds nobody listening
		# ("Unable to set TCP no delay option" on macOS), which with retries
		# would be a warning every few seconds for as long as the editor is
		# away. Attempts are meant to be silent, so the poll that settles one
		# is too.
		var printing := Engine.print_error_messages
		Engine.print_error_messages = false
		socket.poll()
		Engine.print_error_messages = printing
	else:
		socket.poll()
	match socket.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _hello_sent:
				# The handshake goes straight to the socket, never through the
				# queue: the editor must read it ahead of anything queued while
				# the socket was still connecting. On a reconnect it is the same
				# hello, with the build and the flows open now.
				_send_hello()
				_hello_sent = true
				if _lost:
					_lost = false
					print("[storylets] Live Link is back (%s)." % _url)
				# A reconnect: nothing was queued while the editor was away, so
				# every flow's board follows the hello and the editor's Board
				# comes back as the game has it. (The first socket's boards are
				# already queued.)
				if _dropped:
					for f in _live_flows():
						_post(board_frame(f as StoryletFlow))
			_flush()
			_drain_incoming()
		WebSocketPeer.STATE_CLOSED:
			_socket_gone(socket.get_close_code())


## Where the link is: "connecting", "connected" or "closed". The same three
## Unity's LiveLinkState carries, as strings because GDScript enums do not
## cross a boundary usefully. For the Runtime State panel, which shows it so a
## host can tell "the editor is not listening" from "I never attached"
## (2026-08-29: Unity's examiner had this and the other two did not).
## "connecting" covers a link that is retrying, between attempts too: "closed"
## is only close(), a link the editor replaced with another game, or a URL the
## socket cannot even parse.
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


## Close the link and stop retrying; every later call is a no-op.
func close() -> void:
	_closed = true
	detach()
	_queue.clear()
	_retry_at = 0
	if _enabled and socket.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		socket.close()
	_enabled = false


## Live refresh: apply a bundle the editor pushed, through the engine's own
## hot_swap. A new ENGINE over the parsed bundle carrying the old one's run
## (every flow of it: turns, properties, cooldowns, the hands on the table; a
## deleted card leaves the table, a new property takes its default).
## Returns {"ok": true, "engine", "bundle", "report"} or {"ok": false, "error"} with
## the old engine left as it was: malformed JSON, a bundle the runtime
## rejects, another project. hot_swap rebuilt every flow, so re-take your
## handles from the returned engine.
##
## Works whether the engine made its own registry or was given the game's: on
## the game's registry the old engine hands its keys to the replacement (and is
## spent), which a plain save and load into a second engine cannot do, since
## the two would clash. The engine remembers the options it was built with
## (seed, log, host_scopes), so `opts` is only for overriding one of them for the
## replacement.
static func apply_live_bundle(engine: StoryletEngine, data: String, opts: Dictionary = {}) -> Dictionary:
	var loaded := StoryletBundle.load_from_string(data)
	if not loaded["ok"]:
		return {"ok": false, "error": "pushed bundle: " + str(loaded["error"])}
	var swapped := engine._swap(loaded["bundle"], opts)
	if not swapped["ok"]:
		return {"ok": false, "error": swapped["error"]}
	# "report" is the LoadReport the replacement's load produced: what the edit
	# dropped, defaulted, retyped or evicted, which a refresh must not swallow.
	return {"ok": true, "engine": swapped["engine"], "bundle": loaded["bundle"], "report": swapped["report"]}


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
	_retry_wait = RETRY_FIRST_MS


func _now() -> int:
	return _clock_ms if _clock_ms >= 0 else Time.get_ticks_msec()


# Dial the editor. An address the socket cannot even parse is never going to
# work, so that one closes the link for good, silently; anything else that
# fails is tried again.
func _dial() -> void:
	var err: int = socket.connect_to_url(_url)
	if err == ERR_INVALID_PARAMETER:
		_enabled = false
	elif err != OK:
		_socket_gone(-1)


# The socket closed, or never opened. Retry while the game wants the link,
# unless the editor replaced us with another game. One line when an open link
# is lost, none per attempt, and nothing at all for a link that never opened.
func _socket_gone(code: int) -> void:
	var was_open := _hello_sent
	_hello_sent = false
	# The startup queue only holds frames for the first socket; once that is
	# gone a frame with no open socket has nowhere to go, so it is dropped
	# rather than kept, and nothing queues until a socket is open again.
	_dropped = true
	_queue.clear()
	if code == CLOSE_REPLACED:
		_enabled = false
		print("[storylets] Live Link: another game took the editor's link (%s)." % _url)
		return
	if was_open and not _lost:
		_lost = true
		print("[storylets] Live Link lost (%s); retrying." % _url)
	_retry_at = maxi(_now() + _retry_wait, 1)
	_retry_wait = mini(_retry_wait * 2, RETRY_MAX_MS)


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
	# After an attempt has failed the editor is away: nothing queues until a
	# socket is open again (the hello and boards stand in for what was missed).
	if _dropped and (_retry_at > 0 or socket.get_ready_state() != WebSocketPeer.STATE_OPEN):
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
## on the wire as 1.0 where the reference writes 1. The writer is StoryletSave's,
## shared with the save files.
static func to_json(value) -> String:
	return StoryletSave.to_json(value)
