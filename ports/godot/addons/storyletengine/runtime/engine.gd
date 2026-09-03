@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The Engine: the world + flow manager (design/flows.md; the shape is
# Patter's), transliterated from the reference runtime
# (packages/runtime/src/engine.ts) and held to the conformance corpus.
#
# The flow model, in one place:
#   - an Engine owns the bundle, every lookup built from it, the SHARED
#     property partitions and the @world resolver; a StoryletFlow owns its
#     own PRNG, per-box clocks, cooldowns, board, claims, play history and
#     the per-flow property partitions. Flows meet only through shared state.
#   - sharing is a per-property `shared` flag on the declaration: @story
#     defaults shared; box, deck, hand and tag properties default per-flow.
#     Every name is shared XOR per-flow, so a read is a union of two bags
#     and a write routes by name.
#   - @world is the game's own state: always engine-level, resolved through
#     the host's resolver (create's "world" option, {"get": Callable,
#     "set": Callable?}) or a self-backed bag, and NEVER in save_game() -
#     the host saves its container, each engine saves its own envelope.
#   - there is no default flow and no ambient current flow: open_flow(id)
#     is the only way in, an existing id is REPLACED (the old flow closes),
#     and a closed flow's handle is INERT - every verb refuses.
#   - engine-level get_property serves world.* and shared refs only; a ref
#     that resolves per-flow is refused, naming the fix.
class_name StoryletEngine
extends RefCounted

const CREATE_OPTION_KEYS := ["seed", "log", "world", "on_replaced_flow"]

var _bundle: Dictionary
var _seed: int
var _dialect: Dictionary
# The retained log cap each flow inherits; -1 = disabled.
var _log_cap: int = -1

# Lookups (bundle is immutable; built once). Shared with every flow.
var _cards_by_id: Dictionary = {}
## Does ANY deck or card in the bundle opt into shared scarcity? False for the
## overwhelming majority of projects, and when it is false the two claim-ledger
## walks in dealing are skipped entirely: a bundle that does not use a feature
## must not pay for it.
var _has_shared: bool = false
var _cards_by_game_id: Dictionary = {}
var _boxes_by_id: Dictionary = {}
var _boxes_by_game_id: Dictionary = {}
var _hands_by_id: Dictionary = {}       # id -> {"hand", "box"}
var _hands_by_game_id: Dictionary = {}
var _templates_by_id: Dictionary = {}
var _groups_by_id: Dictionary = {}      # id -> {"group", "box"}
var _required_groups: Dictionary = {}   # id -> true

# Quality ladders (quality.md), declaration-level so partition-blind.
var _world_ladders: Dictionary = {}
var _story_ladders: Dictionary = {}
var _box_ladders: Dictionary = {}
var _deck_ladders: Dictionary = {}
var _value_ladders: Dictionary = {}
var _hand_ladders: Dictionary = {}
var _has_qualities := false

# The per-flow halves of every declaration list, precomputed once: each
# open_flow builds its bags from these.
# {"story": Array, "box"/"deck"/"hand"/"value": {id: Array}}
var _flow_decls: Dictionary = {}
# The shared stores: {"story": bag, "box"/"deck"/"hand"/"value": {id: bag}}.
# Reassigned wholesale by load_game/reset.
var _shared: Dictionary = {}
# @world: {"get": Callable, "set": Callable | null}. The host's when bound
# (it outlives reset/load_game - the container is the host's); self-backed
# from the declared defaults when not.
var _world: Dictionary = {}
var _host_world = null
var _on_replaced_flow = null

var _flows: Dictionary = {}             # id -> StoryletFlow, open order
var _engine_trace_handlers: Array[Callable] = []


## The sharing default per scope (design/flows.md): @story shared, the
## narrower geographic scopes per-flow. A declaration's flag overrides.
static func _is_shared(scope: String, decl: Dictionary) -> bool:
	if decl.has("shared"):
		return bool(decl["shared"])
	return scope == "story"


static func _half(scope: String, decls: Array, shared: bool) -> Array:
	var out: Array = []
	for d in decls:
		if _is_shared(scope, d) == shared:
			out.append(d)
	return out


# path_prefix carries its own separator, so a bag composes its rows' addresses itself
# ("story.gold", "deck.tavern.drawn") instead of every caller pasting a prefix on.
static func _bag_from_decls(decls: Array, path_prefix: String) -> StoryletPropertyBag:
	return StoryletPropertyBag.new(decls, {
		"normalise": func(n: String) -> String: return n,
		"path_prefix": path_prefix,
	})


## new StoryletEngine(bundle, opts). Options: {"seed": int (default 0; each
## flow's PRNG default), "log": bool | {"cap": int} (per-flow retained
## logs), "world": {"get": Callable, "set": Callable?} (the host's @world
## resolver; omitted = self-backed from the declared defaults)}. Unknown
## option keys are an error: returns null with push_error.
static func create(bundle: Dictionary, opts: Dictionary = {}) -> StoryletEngine:
	for key in opts:
		if not CREATE_OPTION_KEYS.has(key):
			push_error('StoryletEngine.create: unknown option "%s" (valid: %s)' % [key, ", ".join(CREATE_OPTION_KEYS)])
			return null
	if opts.has("log"):
		var log_opt = opts["log"]
		if not (log_opt is bool) and not (log_opt is Dictionary):
			push_error("StoryletEngine.create: log option must be a bool or {\"cap\": int}")
			return null
		if log_opt is Dictionary:
			for key in log_opt:
				if key != "cap":
					push_error('StoryletEngine.create: unknown log option key "%s"' % key)
					return null
	if opts.has("world"):
		var w = opts["world"]
		if not (w is Dictionary) or not (w.get("get") is Callable):
			push_error('StoryletEngine.create: world option must be {"get": Callable, "set": Callable?}')
			return null
	return StoryletEngine.new(bundle, opts)


func _init(bundle: Dictionary, opts: Dictionary = {}) -> void:
	_bundle = bundle
	_seed = int(opts.get("seed", 0))
	var log_opt = opts.get("log", false)
	if log_opt is Dictionary:
		_log_cap = int(log_opt.get("cap", 1000))
	elif log_opt is bool and log_opt:
		_log_cap = 1000
	_dialect = StoryletDialect.dialect()
	if opts.has("world"):
		_host_world = opts["world"]
	# Diagnostics hook (opt-in, dev only): a Callable(id: String, dealt: int)
	# fired when open_flow REPLACES a flow that still had cards dealt. Behaviour
	# is unchanged; this makes observable the host that calls open_flow straight
	# after load_game and discards the restored hand - get_flow is the call.
	# Parity with the JS runtime's onReplacedFlow. Zero cost when unset.
	_on_replaced_flow = opts.get("on_replaced_flow")

	for box in _bundle["boxes"]:
		_boxes_by_id[box["id"]] = box
		_boxes_by_game_id[StoryletBundle.effective_game_id(box)] = box
		for group in box["tagGroups"]:
			_groups_by_id[group["id"]] = {"group": group, "box": box}
			if group.get("required", false):
				_required_groups[group["id"]] = true
		for deck in box["decks"]:
			if deck.get("shared", false) == true:
				_has_shared = true
			for card in deck["cards"]:
				var entry := {"card": card, "deck": deck, "box": box}
				_cards_by_id[card["id"]] = entry
				_cards_by_game_id[StoryletBundle.effective_game_id(card)] = entry
				if card.get("shared", false) == true:
					_has_shared = true
		for template in box["handTemplates"]:
			_templates_by_id[template["id"]] = template
		for hand in box["hands"]:
			_hands_by_id[hand["id"]] = {"hand": hand, "box": box}
			_hands_by_game_id[StoryletBundle.effective_game_id(hand)] = {"hand": hand, "box": box}
	_init_ladders()

	# The per-flow halves, precomputed once (a bundle never changes).
	var fd := {"story": _half("story", _bundle["story"].get("properties", []), false),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	for box in _bundle["boxes"]:
		fd["box"][box["id"]] = _half("box", box.get("properties", []), false)
		for deck in box["decks"]:
			fd["deck"][deck["id"]] = _half("deck", deck.get("properties", []), false)
		for hand in box["hands"]:
			fd["hand"][hand["id"]] = _half("hand", hand_decls(hand), false)
		for group in box["tagGroups"]:
			for tag in group["tags"]:
				fd["value"][tag["id"]] = _half("value", tag.get("properties", []), false)
	_flow_decls = fd

	_init_shared()


## Build the shared stores and the @world seam. The host binding sticks for
## the engine's lifetime; reset/load_game rebuild the shared bags around it.
func _init_shared() -> void:
	var shared := {"story": _bag_from_decls(_half("story", _bundle["story"].get("properties", []), true), "story."),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	for box in _bundle["boxes"]:
		shared["box"][box["id"]] = _bag_from_decls(_half("box", box.get("properties", []), true), "box.%s." % box["id"])
		for deck in box["decks"]:
			shared["deck"][deck["id"]] = _bag_from_decls(_half("deck", deck.get("properties", []), true), "deck.%s." % deck["id"])
		for hand in box["hands"]:
			shared["hand"][hand["id"]] = _bag_from_decls(_half("hand", hand_decls(hand), true), "hand.%s." % hand["id"])
		for group in box["tagGroups"]:
			for tag in group["tags"]:
				shared["value"][tag["id"]] = _bag_from_decls(_half("value", tag.get("properties", []), true), "value.%s." % tag["id"])
	_shared = shared
	if _host_world != null:
		_world = {"get": _host_world["get"], "set": _host_world.get("set")}
	else:
		# Standalone: self-backed from the declared defaults. Still FOREIGN in
		# spirit - never in save_game(); a host that wants @world to persist
		# saves the container itself.
		var bag := _bag_from_decls(_bundle["world"].get("properties", []), "world.")
		_world = {
			"get": func(n: String) -> Variant: return bag.get_value(n),
			"set": func(n: String, v) -> void: bag.set_value(n, v),
		}


func hand_decls(hand: Dictionary) -> Array:
	if hand.has("template"):
		var known = _templates_by_id.get(hand["template"])
		if known != null:
			return known.get("properties", [])
		for box in _bundle["boxes"]:
			for t in box["handTemplates"]:
				if t["id"] == hand["template"]:
					return t.get("properties", [])
		return []
	return hand.get("properties", [])


func _init_ladders() -> void:
	var grab := func(decls: Array) -> Dictionary:
		var m := {}
		for d in decls:
			if str(d.get("type", "")) == "quality" and d.get("stages") != null:
				m[d["name"]] = d["stages"]
		return m
	_world_ladders = grab.call(_bundle.get("world", {}).get("properties", []))
	_story_ladders = grab.call(_bundle.get("story", {}).get("properties", []))
	for box in _bundle.get("boxes", []):
		_box_ladders[box["id"]] = grab.call(box.get("properties", []))
		for deck in box.get("decks", []):
			_deck_ladders[deck["id"]] = grab.call(deck.get("properties", []))
		for group in box.get("tagGroups", []):
			for tag in group.get("tags", []):
				_value_ladders[tag["id"]] = grab.call(tag.get("properties", []))
		for hand in box.get("hands", []):
			_hand_ladders[hand["id"]] = grab.call(hand_decls(hand))
	_has_qualities = not (_world_ladders.is_empty() and _story_ladders.is_empty())
	for owners in [_box_ladders, _deck_ladders, _value_ladders, _hand_ladders]:
		if _has_qualities:
			break
		for m in (owners as Dictionary).values():
			if not (m as Dictionary).is_empty():
				_has_qualities = true
				break


# --- flow management (Patter's surface, name for name) --------------------------

## Open (or REPLACE) the named flow. An existing id's flow is closed first -
## re-opening a name is a reset of that name's whole per-flow state; shared
## state is untouched. There is no default flow: "main" is a caller
## convention, not an engine rule. Options: {"seed": int} overrides the
## engine's default for this flow's PRNG.
func open_flow(id: String, opts: Dictionary = {}) -> StoryletFlow:
	for key in opts:
		if key != "seed":
			push_error('StoryletEngine.open_flow: unknown option "%s" (valid: seed)' % key)
			return null
	var old = _flows.get(id)
	if old != null:
		# Say so BEFORE the old flow goes inert, while its board is readable.
		var dealt := (old as StoryletFlow).held_card_ids().size()
		if dealt > 0 and _on_replaced_flow is Callable and (_on_replaced_flow as Callable).is_valid():
			(_on_replaced_flow as Callable).call(id, dealt)
		(old as StoryletFlow).mark_closed()
	var flow := StoryletFlow.new(self, id, int(opts.get("seed", _seed)))
	_flows[id] = flow
	return flow


func get_flow(id: String) -> Variant:
	return _flows.get(id)


## Every live flow, open order.
func flows() -> Array:
	return _flows.values()


## Close the named flow: its handle goes INERT (every verb refuses). A
## dropped-but-held flow must not keep writing shared state (Patter's
## stale-handle lesson). Unknown ids are a quiet no-op.
func close_flow(id: String) -> void:
	var flow = _flows.get(id)
	if flow == null:
		return
	_flows.erase(id)
	(flow as StoryletFlow).mark_closed()


## @internal - StoryletFlow.close() routes here so both doors agree.
func drop_flow(id: String, flow: StoryletFlow) -> void:
	if _flows.get(id) == flow:
		_flows.erase(id)


## Close every flow and reseed the shared state to its defaults (the
## self-backed @world included; a host-bound @world is the host's and is
## not touched).
func reset() -> void:
	# The log is a run-lifetime utility and is not saved; a reset is a new run.
	_engine_log = []
	for flow in _flows.values():
		(flow as StoryletFlow).mark_closed()
	_flows = {}
	_spent = {}
	_init_shared()


# --- shared scarcity (design/shared-scarcity.md) ---------------------------------

## Cards a shared `redraw: "never"` has taken out of the world, by card id
## (a Dictionary used as a set). The claim ledger is DERIVED from live boards
## and needs no storage; this one is durable, so it rides the save.
var _spent: Dictionary = {}


# --- the run's log (design/shared-scarcity.md 8.2) --------------------------------

## Every flow's events in one ordered stream, each tagged with its flow. Opt in
## with the same "log" option the flow logs use; capped the same way.
##
## This exists because a flow's own log cannot answer the question a run raises:
## when a story action in ANOTHER flow moves shared state, your flow's log says
## nothing and your value simply changes.
var _engine_log: Array = []
var _engine_seq: int = 0


## The run's log, oldest first: Array of the flow's log entry plus "flow".
func log() -> Array:
	return _engine_log


func clear_log() -> void:
	_engine_log = []


func is_taken(card_id: String) -> bool:
	return _spent.has(card_id)


func mark_taken(card_id: String) -> void:
	_spent[card_id] = true


## Shared claims across every LIVE flow, card id -> holders. Derived, which is
## what makes close_flow and the open_flow replace release what a flow was
## holding: its board leaves the map with it.
## The spent set as a sorted Array, so a save is byte-stable for a diff.
func _spent_ids() -> Array:
	var ids: Array = _spent.keys()
	ids.sort()
	return ids


func shared_claims() -> Dictionary:
	var counts := {}
	for flow in _flows.values():
		for id in (flow as StoryletFlow).held_card_ids():
			counts[id] = counts.get(id, 0) + 1
	return counts


# --- engine-level state access ---------------------------------------------------

## Read shared state by path: "world.x", "story.gold" (when shared),
## "box.b_x.heat" (when shared). A ref that resolves PER-FLOW is refused,
## naming the fix (Patter's teaching rule). Returns the value, or null with
## push_error.
func get_property(path: String) -> Variant:
	var r := _resolve_shared(path)
	if r.has("error"):
		push_error("StoryletEngine.get_property: " + r["error"])
		return null
	var value
	if r["kind"] == "world":
		value = (_world["get"] as Callable).call(r["name"])
	else:
		value = (r["bag"] as StoryletPropertyBag).get_value(r["name"])
	if value == null:
		push_error('StoryletEngine.get_property: no property at "%s"' % path)
		return null
	return value


## Write shared state by path. A host write: silent under the firing rule,
## visible to the bag's audit hook. Returns "" or the error message.
func set_property(path: String, value) -> String:
	var r := _resolve_shared(path)
	if r.has("error"):
		push_error("StoryletEngine.set_property: " + r["error"])
		return r["error"]
	if r["kind"] == "world":
		var setter = _world.get("set")
		if setter == null:
			var msg := "@world is read-only here: the host bound no write"
			push_error("StoryletEngine.set_property: " + msg)
			return msg
		(setter as Callable).call(r["name"], value)
		return ""
	var change: Dictionary = (r["bag"] as StoryletPropertyBag).set_value(r["name"], value, {"silent": true, "reason": "host setProperty"})
	if change.has("error"):
		return change["error"]
	return ""


func _resolve_shared(path: String) -> Dictionary:
	var parts := path.split(".")
	if parts.size() == 2 and parts[0] == "world":
		return {"kind": "world", "name": parts[1]}
	if parts.size() == 2 and parts[0] == "story":
		var name := parts[1]
		if (_shared["story"] as StoryletPropertyBag).get_value(name) != null:
			return {"kind": "bag", "bag": _shared["story"], "name": name}
		for d in _flow_decls["story"]:
			if d["name"] == name:
				return {"error": '"%s" is per-flow state - read it on a Flow, not the Engine' % path}
		return {"error": 'no property at "%s"' % path}
	if parts.size() == 3 and ["box", "deck", "hand", "value"].has(parts[0]):
		var kind := parts[0]
		var id := parts[1]
		var name := parts[2]
		var bag = _shared[kind].get(id)
		if bag != null and (bag as StoryletPropertyBag).get_value(name) != null:
			return {"kind": "bag", "bag": bag, "name": name}
		for d in _flow_decls[kind].get(id, []):
			if d["name"] == name:
				return {"error": '"%s" is per-flow state - read it on a Flow, not the Engine' % path}
		if bag == null and not _flow_decls[kind].has(id):
			return {"error": 'no %s store "%s"' % [kind, id]}
		return {"error": 'no property at "%s"' % path}
	return {"error": 'bad property path "%s"' % path}


## The shared surface as examiner rows: @world (read through the resolver)
## then the shared partitions. Per-flow rows live on each flow.
func list_properties() -> Array:
	var out: Array = []
	for d in _bundle["world"].get("properties", []):
		var value = (_world["get"] as Callable).call(d["name"])
		var row := {"path": "world.%s" % d["name"], "name": d["name"], "type": d.get("type", "string"),
			"value": value if value != null else d.get("default"), "default": d.get("default")}
		if d.has("values"):
			row["values"] = d["values"]
		if d.has("stages"):
			row["stages"] = d["stages"]
		out.append(row)
	_add_rows(out, "story", _shared["story"])
	for kind in ["box", "deck", "hand", "value"]:
		for id in _shared[kind]:
			_add_rows(out, "%s.%s" % [kind, id], _shared[kind][id])
	return out


static func _add_rows(out: Array, prefix: String, bag: StoryletPropertyBag) -> void:
	for row in bag.rows():
		var r: Dictionary = row.duplicate()
		# The bag addressed the row already; prefix stays as the mount label.
		out.append(r)


## The SHARED kernel bags with their store path prefixes (the state logger's
## mount surface). The @world container is the host's own bag.
func list_bags() -> Array:
	var mounts: Array = [{"prefix": "story", "bag": _shared["story"]}]
	for kind in ["box", "deck", "hand", "value"]:
		for id in _shared[kind]:
			mounts.append({"prefix": "%s.%s" % [kind, id], "bag": _shared[kind][id]})
	return mounts


## Every flow's trace, one stream: handler.call(flow_id, event). Returns the
## unsubscribe Callable.
func subscribe_trace(handler: Callable) -> Callable:
	_engine_trace_handlers.append(handler)
	return func() -> void: _engine_trace_handlers.erase(handler)


func engine_tracing() -> bool:
	return not _engine_trace_handlers.is_empty()


## `turn_stamp` is the box clock the event happened on, where the caller knows
## it - the same stamp the flow's own log carries. Unity and Unreal passed it
## from the start; JS and Godot dropped it, so their examiners printed "[-]" on
## every deal, peek, evict and write line (2026-08-29).
func emit_engine(flow_id: String, event: Dictionary, turn_stamp = null) -> void:
	# Retain first, then notify: the run's log is the record, subscribers are
	# the live view, and a handler that reads log() should see its own event.
	if _log_cap >= 0:
		var entry: Dictionary = event.duplicate(true)
		entry["flow"] = flow_id
		entry["seq"] = _engine_seq
		if turn_stamp != null:
			entry["turn"] = turn_stamp
		_engine_seq += 1
		_engine_log.append(entry)
		if _engine_log.size() > _log_cap:
			_engine_log = _engine_log.slice(_engine_log.size() - _log_cap)
	# Over a COPY, and skipping anything freed. Two failures this prevents,
	# both found by the pre-release audit (2026-08-29):
	#
	#   A handler bound to a node that has since been queue_free()d - a scene
	#   change, an entity despawn - is an "attempt to call function on a
	#   previously freed instance" error once per trace event, for every event
	#   after. Only an explicit detach() unhooks, and StoryletLiveLink has no
	#   _exit_tree, so freeing the node is not an exit path that releases this.
	#
	#   A handler that unsubscribes from inside its own call mutates the array
	#   mid-iteration and the next handler is skipped. Unreal copies before
	#   dispatch and Unity calls .ToArray(); JS iterates a Set, where deletion
	#   during iteration is defined. Godot was the outlier.
	for handler in _engine_trace_handlers.duplicate():
		if handler.is_valid():
			handler.call(flow_id, event)


# --- persistence (schema 4) -------------------------------------------------------

func _partition_values(p: Dictionary) -> Dictionary:
	var out := {"story": (p["story"] as StoryletPropertyBag).save(), "box": {}, "deck": {}, "hand": {}, "value": {}}
	for kind in ["box", "deck", "hand", "value"]:
		for id in p[kind]:
			out[kind][id] = (p[kind][id] as StoryletPropertyBag).save()
	return out


## The whole engine, one envelope ("storylets/save@1"): the shared
## partitions once, then every live flow keyed by its id. @world is NEVER
## here - the host saves its container, each engine saves its own envelope.
func save_game() -> Dictionary:
	var out_flows := {}
	for id in _flows:
		out_flows[id] = (_flows[id] as StoryletFlow).snapshot()
	return {
		"schema": StoryletBundle.SAVE_SCHEMA,
		"content": (_bundle["content"] as Dictionary).duplicate(true),
		"shared": {"props": _partition_values(_shared), "spent": _spent_ids()},
		"flows": out_flows,
	}


## Restore: shared state once, then every flow REBUILT from its blob.
## Handles held from before the load are closed and inert; take fresh ones
## from get_flow()/flows(). Returns "" or the error message on a foreign
## save (wrong project).
func load_game(envelope: Dictionary) -> String:
	var content = envelope.get("content", {})
	if str(content.get("project")) != str(_bundle["content"]["project"]):
		return 'save is for project "%s", bundle is "%s"' % [str(content.get("project")), str(_bundle["content"]["project"])]
	var env: Dictionary = envelope.duplicate(true)
	reset()
	var shared_half: Dictionary = env.get("shared", {})
	for id in shared_half.get("spent", []):
		_spent[str(id)] = true
	var shared_values: Dictionary = shared_half.get("props", {})
	(_shared["story"] as StoryletPropertyBag).load(shared_values.get("story", {}))
	for kind in ["box", "deck", "hand", "value"]:
		var saved: Dictionary = shared_values.get(kind, {})
		for id in saved:
			var bag = _shared[kind].get(id)
			if bag != null:
				(bag as StoryletPropertyBag).load(saved[id])
	for id in env.get("flows", {}):
		var flow := open_flow(str(id))
		flow.restore(env["flows"][id])
	return ""
