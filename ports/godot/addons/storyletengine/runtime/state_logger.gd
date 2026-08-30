@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The state logger (parity member: every runtime carries one; design/
# engine-runtimes.md 3.4 is the design of record). Kernel-shaped: property
# logging is PUSH-based on the PropertyBag audit hook - every write, engine
# or host, arrives with prev and reason and logs the moment it lands - while
# the product's non-property state (turns / cooldowns / board) arrives
# through a small path-provider adapter and is diffed on capture(). The
# kernel core (the instance over mounts + extra providers) is
# product-agnostic and moves into the shared kernel wholesale when the
# vendor-sync slice lands; create_state_logger is the storylets adapter over
# it. Flattened path scheme (the JS play-helpers logger's, verbatim):
#   world.x / story.x / box.<id>.x / deck.<id>.x / hand.<id>.x / value.<id>.x
#   turn:<boxId>      per-box clocks
#   cooldown:<cardId> next-eligible turns
#   board:<handId>    hand contents (card ids, dealt order)
# Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for null.
#
# Changes are Dictionaries {"path": String, "from": Variant, "to": Variant}
# (null = unset; a stored value is never null).
#
# NOTE - lifetime: the auditor Callables bound into the bags reference this
# logger, so a live logger and its session keep each other alive until
# dispose() is called (RefCounted collects no cycles). Dispose a logger you
# are done with.
class_name StoryletStateLogger
extends RefCounted

var _mounts_provider: Callable   # -> Array of {"prefix", "bag"}
var _extra_provider: Callable    # -> Dictionary path -> value
var _sink: Callable
var _label: String
var _baseline: Dictionary = {}
var _pushed: Array = []
var _mounted: Array = []   # of {"bag": StoryletPropertyBag, "off": Callable}


## The product-agnostic core: audit-hooked bags plus a diffed extra snapshot.
## opts: {"sink": Callable(String), "label": String}; sink defaults to print.
func _init(mounts_provider: Callable, extra_provider: Callable, opts: Dictionary = {}) -> void:
	_mounts_provider = mounts_provider
	_extra_provider = extra_provider
	var sink = opts.get("sink")
	_sink = sink if sink is Callable else func(line: String) -> void: print(line)
	_label = str(opts.get("label", ""))
	_baseline = _full()
	_mount()


static func _show(v) -> String:
	return "<unset>" if v == null else StoryletValues.show(v)


func _emit(change: Dictionary) -> void:
	_sink.call("%s%s: %s -> %s" % [_label, change["path"], _show(change["from"]), _show(change["to"])])



# --- the live logger's instance half ------------------------------------------
#
# Restored 2026-08-29, verbatim from before 302a623 (the flows refactor), which
# deleted all six of these while leaving _init calling _full() and _mount(). The
# whole script therefore failed to compile from that commit until now: not a
# wrong answer, no class at all, and with it went capture() and dispose(), i.e.
# the entire live-logging feature in the Godot port.
#
# They come back UNCHANGED because they never knew about sessions: the core is
# product-agnostic and talks only to the two providers it is constructed with,
# and create_state_logger below already supplies those in the Engine + Flow
# shape. That is also why the deletion was possible without anything obviously
# dangling: nothing in the file below refers to them.

## The full flattened snapshot: every mounted bag's values under its prefix,
## plus the adapter's non-property paths.
func snapshot() -> Dictionary:
	return _full()


func _full() -> Dictionary:
	var out := {}
	for mount in _mounts_provider.call():
		var bag: StoryletPropertyBag = mount["bag"]
		for name in bag.values:
			out["%s.%s" % [mount["prefix"], name]] = _copy(bag.values[name])
	var extra: Dictionary = _extra_provider.call()
	for path in extra:
		out[path] = _copy(extra[path])
	return out


func _hook(prefix: String, bag: StoryletPropertyBag) -> void:
	# Push-based: the write logs as it lands, prev straight off the audit
	# event; the baseline moves with it so capture() never re-reports.
	var auditor := func(change: Dictionary) -> void:
		var c := {
			"path": "%s.%s" % [prefix, change["name"]],
			"from": _copy(change.get("prev")),
			"to": _copy(change["next"]),
		}
		_emit(c)
		_pushed.append(c)
		_baseline[c["path"]] = _copy(change["next"])
	var off := bag.on_audit(auditor)
	_mounted.append({"bag": bag, "off": off})


func _mount() -> void:
	var mounts: Array = _mounts_provider.call()
	var same := _mounted.size() == mounts.size()
	if same:
		for i in mounts.size():
			if _mounted[i]["bag"] != mounts[i]["bag"]:
				same = false
				break
	if same:
		return
	for m in _mounted:
		(m["off"] as Callable).call()
	_mounted = []
	for mount in mounts:
		_hook(mount["prefix"], mount["bag"])


## Everything since the last capture: the audited writes already logged
## (push-based), plus anything that changed WITHOUT an audit event
## (non-property state; bags replaced by a load, which fires none), diffed,
## logged, and re-baselined.
func capture() -> Array:
	var next := _full()
	var diffed := diff_state(_baseline, next)
	for c in diffed:
		_emit(c)
	var changes := _pushed + diffed
	_pushed = []
	_baseline = next
	_mount()   # a load replaces the product's bags; re-hook them
	return changes


## Unhook the bag auditors. The logger is inert afterwards.
func dispose() -> void:
	for m in _mounted:
		(m["off"] as Callable).call()
	_mounted = []
	_pushed = []

## The full flattened snapshot of ONE FLOW's view - the shared partitions
## plus that flow's own - straight off the save envelope, so "what the
## snapshot sees" is by construction "what a save persists". @world is not
## here for the same reason it is not in the envelope: the host owns that
## container and mounts/saves it itself.

## A stored value, safe to hand out: arrays are duplicated so a snapshot cannot
## be mutated through the engine's own list, scalars are immutable already.
##
## Restored 2026-08-29. It was deleted in 302a623 (the flows refactor) with all
## four call sites below left in place, so this whole script failed to COMPILE
## from that commit on: not a wrong answer from snapshot_state, no answer at
## all, and every script that touched StoryletStateLogger went down with it.
## Nothing in the Godot suite loaded the class, which is why it went unseen.
static func _copy(v) -> Variant:
	return (v as Array).duplicate() if v is Array else v

static func snapshot_state(engine: StoryletEngine, flow: StoryletFlow) -> Dictionary:
	var env := engine.save_game()
	var flow_save: Dictionary = env["flows"].get(flow.id, {})
	var out := {}
	# Shared under the flow's own: names are disjoint (shared XOR per-flow by
	# declaration), so one path space holds both without collision.
	# The envelope's shared half is {"props": ..., "spent": [...]}, so the
	# partitions are one level down. Reading `env["shared"]` directly finds no
	# "story" key and silently drops every shared property, which is what this
	# did until 2026-08-29: `@story` is shared by default, so that was most of
	# the state. The reference reads `env.shared.props.story` (logger.ts).
	var shared: Dictionary = env.get("shared", {}).get("props", {})
	var props: Dictionary = flow_save.get("props", {})
	for name in shared.get("story", {}):
		out["story.%s" % name] = _copy(shared["story"][name])
	for name in props.get("story", {}):
		out["story.%s" % name] = _copy(props["story"][name])
	for kind in ["box", "deck", "hand", "value"]:
		for id in shared.get(kind, {}):
			for name in shared[kind][id]:
				out["%s.%s.%s" % [kind, id, name]] = _copy(shared[kind][id][name])
		for id in props.get(kind, {}):
			for name in props[kind][id]:
				out["%s.%s.%s" % [kind, id, name]] = _copy(props[kind][id][name])
	var extra := _extra_state(flow_save)
	for path in extra:
		out[path] = extra[path]
	return out


## The changed paths between two snapshots, sorted; null = unset.
static func diff_state(prev: Dictionary, next: Dictionary) -> Array:
	var paths := {}
	for p in prev:
		paths[p] = true
	for p in next:
		paths[p] = true
	var sorted := paths.keys()
	sorted.sort()
	var changes: Array = []
	for path in sorted:
		var from = prev.get(path)
		var to = next.get(path)
		var equal: bool = (to == null) if from == null \
			else (to != null and StoryletValues.value_equals(from, to))
		if not equal:
			changes.append({"path": path, "from": from, "to": to})
	return changes


## The storylets path-provider adapter for non-property state (design 3.4):
## one flow's turns / cooldowns / board, off its blob in the envelope.
static func _extra_state(flow_save: Dictionary) -> Dictionary:
	var out := {}
	for box_id in flow_save.get("turns", {}):
		out["turn:%s" % box_id] = flow_save["turns"][box_id]
	for card_id in flow_save.get("cooldowns", {}):
		out["cooldown:%s" % card_id] = flow_save["cooldowns"][card_id]
	for hand_id in flow_save.get("board", {}):
		out["board:%s" % hand_id] = (flow_save["board"][hand_id] as Array).duplicate()
	return out


## The storylets state logger: the kernel core mounted on the SHARED bags
## (engine.list_bags()) and one flow's own (flow.list_bags()) - the same
## prefixes, one path space, names disjoint - plus the flow's turns /
## cooldowns / board adapter. Tracks the flow BY NAME, so load_game's
## rebuild re-mounts on capture. opts: {"sink": Callable(String), "label":
## String}.
static func create_state_logger(engine: StoryletEngine, flow: StoryletFlow, opts: Dictionary = {}) -> StoryletStateLogger:
	var flow_id := flow.id
	var live := func() -> Variant: return engine.get_flow(flow_id)
	return StoryletStateLogger.new(
		func() -> Array:
			var mounts: Array = engine.list_bags()
			var f = live.call()
			if f != null:
				mounts.append_array((f as StoryletFlow).list_bags())
			return mounts,
		func() -> Dictionary: return _extra_state(engine.save_game()["flows"].get(flow_id, {})),
		opts)
