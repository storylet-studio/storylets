# A tiny static registry so a debug overlay (StoryletStatePanel) can find the
# engine your game created without wiring a reference through. Call
# StoryletDebug.register(engine, "label") right after you build it, and
# StoryletDebug.unregister(engine) when you tear it down. The registry holds
# engines WEAKLY, so a host that forgets to unregister does not keep a dead
# engine, its bundle and its flows alive for the process - Unity uses
# WeakReference and Unreal TWeakObjectPtr for the same reason, and this port
# was the one holding strongly (2026-08-29). Patterplay's registries hold
# strongly in both of its ports; that is a departure worth them knowing about,
# written up in patterkit's from-storylets. One entry per ENGINE:
# the panel asks the engine for its open flows, so flows opened and closed
# later appear and disappear on their own. Parity with the Unity
# StoryletDebug.Register(...) hook and Unreal's RegisterForDebug, and the
# shape Patterplay's PatterDebug has in all three of its ports.
#
# Change notification: connect to StoryletDebug.bus.changed (signals cannot
# be static, so a tiny shared bus object carries the one signal).
class_name StoryletDebug


class Bus:
	extends RefCounted
	signal changed


static var bus := Bus.new()
static var _entries: Array = []   # of {"engine": StoryletEngine, "label": String}


## The game's Live Link to Storyletter, if it registered one, so the state
## panel can show where the link is. One per process: a game talks to one
## editor. Parity with Unity's StoryletDebug.Link (2026-08-29 - it had this and
## Godot and Unreal did not, so the same panel answered a different question in
## each engine).
static var link = null


static func register_link(l) -> void:
	if link == l:
		return
	link = l
	bus.changed.emit()


static func unregister_link(l) -> void:
	if link == null or link != l:
		return
	link = null
	bus.changed.emit()


static func register(engine: StoryletEngine, label: String = "") -> void:
	_prune()
	for e in _entries:
		if e["ref"].get_ref() == engine:
			return
	_entries.append({"ref": weakref(engine), "label": label})
	bus.changed.emit()


static func unregister(engine: StoryletEngine) -> void:
	for i in _entries.size():
		if _entries[i]["ref"].get_ref() == engine:
			_entries.remove_at(i)
			bus.changed.emit()
			return
	_prune()


## Drop entries whose engine has been collected. Called wherever the list is
## read or written, which is the same shape Unity and Unreal prune on.
static func _prune() -> void:
	var live: Array = []
	for e in _entries:
		if e["ref"].get_ref() != null:
			live.append(e)
	if live.size() != _entries.size():
		_entries = live


## Registered engines, registration order: Array of {"engine", "label"}.
## Entries whose engine has gone are dropped rather than returned as nulls, so
## a caller never has to test.
static func list() -> Array:
	_prune()
	var out: Array = []
	for e in _entries:
		out.append({"engine": e["ref"].get_ref(), "label": e["label"]})
	return out


static func clear() -> void:
	_entries.clear()
	bus.changed.emit()
