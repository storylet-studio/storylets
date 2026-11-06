# The Live Link reconnects until the game closes it: a close is tried again
# after 1 s, doubling to at most 10 s; a hello puts the wait back to 1 s; the
# hello on a reconnect carries the build and the flows open now, followed by
# every flow's board; nothing is queued while a retry connects; a link the
# editor replaced (close code 4000) stays closed; and close() stops it.
#
# Driven over a fake socket on a fake clock (the link's _clock_ms), so the
# waits are asserted rather than slept through.
#
#   godot --headless --path ports/godot --script res://test/test_live_link_reconnect.gd
#
# (import the project once first: godot --headless --path ports/godot --import)
# Prints PASS/FAIL lines then LIVE LINK RECONNECT ALL PASS (exit 0) or N FAILED (exit 1).
extends SceneTree

var _fails := 0


# A stand-in for WebSocketPeer that can be dialled again after it closes, as
# the real one can. The test's side opens it, closes it with a code, or
# refuses the attempt under way.
class FakePeer:
	extends RefCounted
	var state: int = WebSocketPeer.STATE_CLOSED
	var code := -1
	var dials := 0
	var sent: Array[String] = []
	var closed_by_link := false

	func connect_to_url(_to: String) -> int:
		dials += 1
		state = WebSocketPeer.STATE_CONNECTING
		code = -1
		return OK

	func poll() -> void:
		pass

	func get_ready_state() -> int:
		return state

	func get_close_code() -> int:
		return code

	func send_text(text: String) -> int:
		if state != WebSocketPeer.STATE_OPEN:
			push_error("fake peer: send on a socket that is not open")
			return ERR_UNAVAILABLE
		sent.append(text)
		return OK

	func get_available_packet_count() -> int:
		return 0

	func get_packet() -> PackedByteArray:
		return PackedByteArray()

	func close(_code: int = 1000, _reason: String = "") -> void:
		closed_by_link = true
		state = WebSocketPeer.STATE_CLOSED

	# The editor's side.
	func open() -> void:
		state = WebSocketPeer.STATE_OPEN

	func server_close(with_code: int) -> void:
		state = WebSocketPeer.STATE_CLOSED
		code = with_code

	func refuse() -> void:
		state = WebSocketPeer.STATE_CLOSED
		code = -1

	# Everything sent since `from`, parsed.
	func frames(from: int) -> Array:
		var out: Array = []
		for i in range(from, sent.size()):
			out.append(JSON.parse_string(sent[i]))
		return out


func _check(name: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("PASS %s" % name)
	else:
		_fails += 1
		printerr("FAIL %s%s" % [name, (": " + detail) if detail != "" else ""])


func _kinds(frames: Array) -> Array:
	var out: Array = []
	for f in frames:
		out.append("%s:%s" % [f.get("t"), f.get("flow", "")] if f.get("t") == "board" else str(f.get("t")))
	return out


func _initialize() -> void:
	var repo := ProjectSettings.globalize_path("res://").path_join("../..")
	var script: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(repo.path_join("packages/conformance/live-link/script.json")))
	var loaded := StoryletBundle.load_from_string(FileAccess.get_file_as_string(repo.path_join(str(script["bundle"]))))
	_check("bundle loads", loaded["ok"], str(loaded.get("error", "")))
	if not loaded["ok"]:
		quit(2)
		return
	var bundle: Dictionary = loaded["bundle"]

	var peer := FakePeer.new()
	var link := StoryletLiveLink.new("h1", "Test")
	link.socket = peer
	link._clock_ms = 1000
	link.open()
	var engine := StoryletEngine.create(bundle, {"seed": 7})
	var main := engine.open_flow("main")
	link.attach(engine)

	# -- the first socket: hello, then the board queued behind it ---------------------
	_check("dials once on open", peer.dials == 1, str(peer.dials))
	_check("reads as connecting while the first socket connects", link.link_state() == "connecting", link.link_state())
	peer.open()
	link.poll()
	_check("first socket: hello then the board", _kinds(peer.frames(0)) == ["hello", "board:main"], str(_kinds(peer.frames(0))))
	_check("and reads as connected", link.link_state() == "connected", link.link_state())

	# -- the editor closes normally: retried after 1 s, the next wait 2 s -------------
	peer.server_close(1000)
	link.poll()
	_check("a close schedules a retry 1 s away", link._retry_at == 2000, str(link._retry_at))
	_check("and the next wait is 2 s", link._retry_wait == 2000, str(link._retry_wait))
	_check("and reads as connecting, not closed", link.link_state() == "connecting", link.link_state())
	_check("logged as lost, once", link._lost)

	# Nothing queues between attempts, whatever the game does meanwhile.
	main.deal_many()
	link.poll()
	_check("nothing is queued between attempts", link._queue.is_empty(), str(link._queue.size()))
	link._clock_ms = 1999
	link.poll()
	_check("no attempt before the wait is up", peer.dials == 1, str(peer.dials))

	# -- the editor stays away: 1, 2, 4, 8, 10, 10 s -----------------------------------
	var waits: Array = []
	var queued_while_connecting := 0
	var scheduled_from := 1000   # the clock when the close above was seen
	for i in 6:
		waits.append(link._retry_at - scheduled_from)
		link._clock_ms = link._retry_at
		var before := peer.dials
		link.poll()   # dials
		if peer.dials != before + 1:
			_check("attempt %d dials" % (i + 1), false, str(peer.dials))
		main.advance_turns("village", 1)   # trace while the retry connects
		queued_while_connecting += link._queue.size()
		peer.refuse()
		link.poll()
		scheduled_from = link._clock_ms
	_check("the waits are 1, 2, 4, 8, 10, 10 s", waits == [1000, 2000, 4000, 8000, 10000, 10000], str(waits))
	_check("and stay at 10 s", link._retry_wait == 10000, str(link._retry_wait))
	_check("nothing queues while a retry connects", queued_while_connecting == 0, str(queued_while_connecting))
	_check("still connecting while it retries", link.link_state() == "connecting", link.link_state())

	# The build and the flows move on while the editor is away.
	link.set_build("h2")
	engine.open_flow("side")
	main.deal_many()
	_check("not even the new build's hello is queued", link._queue.is_empty() and peer.sent.size() == 2, str(peer.sent.size()))

	# -- the editor is back: hello with the build and flows, then every board ----------
	link._clock_ms = link._retry_at
	link.poll()
	var mark := peer.sent.size()
	peer.open()
	link.poll()
	var again := peer.frames(mark)
	var hello: Dictionary = again[0] if again.size() > 0 else {}
	_check("reconnect: hello then a board per open flow", _kinds(again) == ["hello", "board:main", "board:side"], str(_kinds(again)))
	_check("the hello carries the new build and the open flows",
		hello.get("build") == "h2" and hello.get("flows") == ["main", "side"] and hello.get("project") == "Test", str(hello))
	_check("a hello puts the wait back to 1 s", link._retry_wait == 1000, str(link._retry_wait))
	_check("logged as back", not link._lost)
	_check("reads as connected again", link.link_state() == "connected", link.link_state())
	mark = peer.sent.size()
	main.advance_turns("village", 1)
	link.poll()
	_check("trace flows again", _kinds(peer.frames(mark)).has("trace"), str(_kinds(peer.frames(mark))))

	# Closed after a hello: the wait starts at 1 s again.
	peer.server_close(1001)
	link.poll()
	_check("a second close retries 1 s away", link._retry_at - link._clock_ms == 1000, str(link._retry_at - link._clock_ms))
	link._clock_ms = link._retry_at
	link.poll()
	peer.open()
	link.poll()

	# -- replaced by another game: closed for good, no retry ---------------------------
	peer.server_close(StoryletLiveLink.CLOSE_REPLACED)
	link.poll()
	_check("a replaced link reads as closed", link.link_state() == "closed", link.link_state())
	_check("and schedules no retry", link._retry_at == 0, str(link._retry_at))
	var dials := peer.dials
	for i in 5:
		link._clock_ms += 10000
		link.poll()
	_check("and does not dial again", peer.dials == dials, "%d -> %d" % [dials, peer.dials])
	main.deal_many()
	_check("nor queue anything", link._queue.is_empty(), str(link._queue.size()))
	# Switched on again by the game: it dials.
	link.open()
	_check("open() after a replace dials again", peer.dials == dials + 1 and link.link_state() == "connecting", "%d %s" % [peer.dials, link.link_state()])
	link.close()
	link.free()

	# -- a first connect that fails is connecting, quietly; close() stops it ------------
	var off_peer := FakePeer.new()
	var off := StoryletLiveLink.new("h1", "Test")
	off.socket = off_peer
	off._clock_ms = 0
	off.open()
	off_peer.refuse()
	off.poll()
	_check("a failed first connect reads as connecting", off.link_state() == "connecting", off.link_state())
	_check("and retries 1 s later", off._retry_at == 1000, str(off._retry_at))
	_check("and logs nothing (never opened)", not off._lost)
	off.close()
	_check("close() reads as closed and leaves no retry", off.link_state() == "closed" and off._retry_at == 0)
	off._clock_ms = 100000
	off.poll()
	_check("and never dials again", off_peer.dials == 1, str(off_peer.dials))
	off.free()

	print("LIVE LINK RECONNECT %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)
