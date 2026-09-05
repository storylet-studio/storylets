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
## open_flow's options. "restore" takes a save_flow blob and opens the flow AS
## IT WAS (design/engine-server.md 4.1); "on_restore_report" is a
## Callable(report: Dictionary) handed what that restore did - the same report
## preview_flow_restore returns, and the only way out for it, since open_flow
## returns the handle.
const OPEN_FLOW_OPTION_KEYS := ["seed", "restore", "on_restore_report"]
## The load report's sort-key separator: a UNIT SEPARATOR, because it cannot
## occur in an id, a gameId or a property name.
const REPORT_SEP := "\u001f"

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
# The shared halves, the same way. Not used to build anything - the shared bags
# are built straight from the bundle - but a load report has to say what the
# shared side WOULD hold without building a bag, which is what makes
# preview_load pure.
var _shared_decls: Dictionary = {}
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

	# Both halves, precomputed once (a bundle never changes): each open_flow
	# builds its bags from the per-flow half, and a load report asks either half
	# what it declares without building anything at all.
	var fd := {"story": _half("story", _bundle["story"].get("properties", []), false),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	var sd := {"story": _half("story", _bundle["story"].get("properties", []), true),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	for box in _bundle["boxes"]:
		fd["box"][box["id"]] = _half("box", box.get("properties", []), false)
		sd["box"][box["id"]] = _half("box", box.get("properties", []), true)
		for deck in box["decks"]:
			fd["deck"][deck["id"]] = _half("deck", deck.get("properties", []), false)
			sd["deck"][deck["id"]] = _half("deck", deck.get("properties", []), true)
		for hand in box["hands"]:
			fd["hand"][hand["id"]] = _half("hand", hand_decls(hand), false)
			sd["hand"][hand["id"]] = _half("hand", hand_decls(hand), true)
		for group in box["tagGroups"]:
			for tag in group["tags"]:
				fd["value"][tag["id"]] = _half("value", tag.get("properties", []), false)
				sd["value"][tag["id"]] = _half("value", tag.get("properties", []), true)
	_flow_decls = fd
	_shared_decls = sd

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
## The story's promise about a @world value (writable: false on its declaration).
## Read by a flow before it writes; the host's own set_property never asks.
func world_read_only(name: String) -> bool:
	for d in _bundle.get("world", {}).get("properties", []):
		if d.get("name", "") == name:
			return d.get("writable", true) == false
	return false


func open_flow(id: String, opts: Dictionary = {}) -> StoryletFlow:
	for key in opts:
		if not OPEN_FLOW_OPTION_KEYS.has(key):
			push_error('StoryletEngine.open_flow: unknown option "%s" (valid: %s)' % [key, ", ".join(OPEN_FLOW_OPTION_KEYS)])
			return null
	# The world's claims as they stand WITHOUT this name, taken before the
	# replace: a resume competes with the other flows, never with the flow it is
	# replacing (which is about to release everything it holds).
	var other_claims = _shared_claims_except(id) if opts.has("restore") else null
	var old = _flows.get(id)
	if old != null:
		# Say so BEFORE the old flow goes inert, while its board is readable.
		var dealt := (old as StoryletFlow).held_card_ids().size()
		if dealt > 0 and _on_replaced_flow is Callable and (_on_replaced_flow as Callable).is_valid():
			(_on_replaced_flow as Callable).call(id, dealt)
		(old as StoryletFlow).mark_closed()
	var flow := StoryletFlow.new(self, id, int(opts.get("seed", _seed)))
	_flows[id] = flow
	if opts.has("restore"):
		var draft := _empty_draft()
		var clean := _plan_flow_restore(id, opts["restore"], other_claims, draft)
		flow.restore(clean)
		var on_report = opts.get("on_restore_report")
		if on_report is Callable and (on_report as Callable).is_valid():
			(on_report as Callable).call(_finish_report(_bundle["content"], _bundle["content"], [id], draft))
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


## The same ledger with one name left out: what the REST of the world holds,
## which is the question a resume under that name has to ask.
func _shared_claims_except(id: String) -> Dictionary:
	var counts := {}
	for flow_id in _flows:
		if str(flow_id) == id:
			continue
		for card_id in (_flows[flow_id] as StoryletFlow).held_card_ids():
			counts[card_id] = counts.get(card_id, 0) + 1
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


## ONE flow's blob, to park a visit that is walking away: the same shape the
## envelope carries per flow, and the same shape open_flow's "restore" option
## takes back (design/engine-server.md 4.1). Saving the whole envelope to park
## one of four hundred players is wrong in cost and in meaning. A name that is
## not open is an error: returns {} with push_error, since a closed flow has
## nothing left to save.
func save_flow(id: String) -> Dictionary:
	var flow = _flows.get(id)
	if flow == null:
		push_error('StoryletEngine.save_flow: unknown flow "%s"' % id)
		return {}
	return (flow as StoryletFlow).snapshot()


## What load_game(envelope) would do that is not a plain restore, without doing
## any of it (design/engine-server.md 4.9). Pure: nothing on this engine moves.
## A project mismatch is refused here exactly as load_game refuses it - it is
## the one thing neither call will tolerate - and returns {} with push_error.
func preview_load(envelope: Dictionary) -> Dictionary:
	var refusal := _project_mismatch(envelope)
	if refusal != "":
		push_error("StoryletEngine.preview_load: " + refusal)
		return {}
	return (_plan_load(envelope)["report"] as Dictionary)


## What open_flow(id, {"restore": saved}) would do to a flow of that name,
## without doing it: the same report shape, since a visit parked under one
## build and resumed under the next raises the same questions. Pure.
func preview_flow_restore(id: String, saved: Dictionary) -> Dictionary:
	var draft := _empty_draft()
	_plan_flow_restore(id, saved, _shared_claims_except(id), draft)
	return _finish_report(_bundle["content"], _bundle["content"], [id], draft)


## Restore: shared state once, then every flow REBUILT from its blob.
## Handles held from before the load are closed and inert; take fresh ones
## from get_flow()/flows().
##
## Returns the LoadReport preview_load would have given for this envelope: the
## drift tolerance that makes a load forgiving is what hides its cost, so the
## cost comes back with the load whether or not anybody looked first. A foreign
## save (wrong project) is refused: {} with push_error, and nothing is touched.
func load_game(envelope: Dictionary) -> Dictionary:
	var refusal := _project_mismatch(envelope)
	if refusal != "":
		push_error("StoryletEngine.load_game: " + refusal)
		return {}
	var plan := _plan_load(envelope)
	reset()
	for id in (plan["spent"] as Array):
		_spent[str(id)] = true
	var shared_values: Dictionary = plan["shared"]
	(_shared["story"] as StoryletPropertyBag).load(shared_values.get("story", {}))
	for kind in ["box", "deck", "hand", "value"]:
		var saved: Dictionary = shared_values.get(kind, {})
		for id in saved:
			var bag = _shared[kind].get(id)
			if bag != null:
				(bag as StoryletPropertyBag).load(saved[id])
	var flows_clean: Dictionary = plan["flows"]
	for id in flows_clean:
		var flow := open_flow(str(id))
		flow.restore(flows_clean[id])
	return plan["report"]


## "" when the save is for this project, else the refusal message.
func _project_mismatch(envelope: Dictionary) -> String:
	var content = envelope.get("content", {})
	if str(content.get("project")) != str(_bundle["content"]["project"]):
		return 'save is for project "%s", bundle is "%s"' % [str(content.get("project")), str(_bundle["content"]["project"])]
	return ""


# --- the load report (design/engine-server.md 4.9) ---------------------------------
#
# One walk, two entry points. preview_load runs it and returns the report;
# load_game runs it, returns the same report and then applies the CLEANED blob
# the walk produced. Two implementations of "what does this save cost" would
# drift the first time one of them was fixed, so there is one, and the apply
# half consumes its output rather than repeating its decisions.
#
# A reported property's "path" is the engine's property address, spelled exactly
# as list_properties() prints it and exactly as get_property and set_property
# accept it: "story.name" for the story scope, "scope.owner.name" for the box,
# deck, hand and tag scopes. No "@", which belongs to the expression language and
# not to an address. The owner segment is the engine's own id today, the same gap
# every other address in the API has; design change 4.4 moves property addresses
# and trace events to gameIds together, in all four runtimes.

## The report under construction: unsorted, until _finish_report orders it.
static func _empty_draft() -> Dictionary:
	return {
		"evicted": [], "droppedCooldowns": [], "droppedSpent": [],
		"droppedProperties": [], "defaultedProperties": [], "retypedProperties": [],
	}


## Does a saved value still fit its declaration?
##
## The type first, then the declaration's own vocabulary: an enum value or a
## quality stage the edit struck out is still a string of the right type and
## still no longer a legal value. A declaration with no vocabulary constrains
## nothing, so anything of the right type fits.
static func _value_fits(decl: Dictionary, value) -> bool:
	match str(decl.get("type", "")):
		"boolean":
			return value is bool
		"number":
			return (value is int or value is float) and not (value is bool)
		"string":
			return value is String
		"enum":
			return value is String and (not decl.has("values") or (decl["values"] as Array).has(value))
		"quality":
			return value is String and (not decl.has("stages") or (decl["stages"] as Array).has(value))
		"flags":
			if not (value is Array):
				return false
			if not decl.has("values"):
				return true
			for f in (value as Array):
				if not (decl["values"] as Array).has(f):
					return false
			return true
		_:
			return true


## Walk one bag's worth of saved values against one bag's worth of
## declarations: report the orphans, the newcomers and the misfits, and return
## the values that survive.
static func _walk_scope(decls: Array, saved: Dictionary, prefix: String, flow, draft: Dictionary) -> Dictionary:
	var by_name := {}
	for d in decls:
		by_name[str(d["name"])] = d
	var clean := {}
	for name in saved:
		var entry := {"path": prefix + str(name)}
		if flow != null:
			entry["flow"] = flow
		if not by_name.has(name):
			(draft["droppedProperties"] as Array).append(entry)
			continue
		if not _value_fits(by_name[name], saved[name]):
			(draft["retypedProperties"] as Array).append(entry)
			continue
		clean[name] = saved[name]
	for d in decls:
		var dname := str(d["name"])
		if not saved.has(dname):
			var missing := {"path": prefix + dname}
			if flow != null:
				missing["flow"] = flow
			(draft["defaultedProperties"] as Array).append(missing)
	return clean


## The same walk over all five scopes of one partition. An owner the save
## carries and the build no longer has drops whole (its bag is gone, so its
## values have nowhere to land); an owner the build has and the save lacks
## keeps every default.
func _walk_partition(decls: Dictionary, values: Dictionary, flow, draft: Dictionary) -> Dictionary:
	var out := {"story": _walk_scope(decls["story"], values.get("story", {}), "story.", flow, draft),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	for kind in ["box", "deck", "hand", "value"]:
		var decl_kind: Dictionary = decls[kind]
		var saved_kind: Dictionary = values.get(kind, {})
		var ids := {}
		for id in decl_kind:
			ids[id] = true
		for id in saved_kind:
			ids[id] = true
		var ordered: Array = ids.keys()
		ordered.sort()
		for id in ordered:
			out[kind][id] = _walk_scope(decl_kind.get(id, []), saved_kind.get(id, {}),
				"%s.%s." % [kind, id], flow, draft)
	return out


## The whole-envelope walk: the report, and the cleaned state the apply half
## writes. Nothing here touches the engine, which is what lets preview_load and
## load_game share it.
func _plan_load(envelope: Dictionary) -> Dictionary:
	var draft := _empty_draft()
	var shared_half: Dictionary = envelope.get("shared", {})
	var shared_clean := _walk_partition(_shared_decls, shared_half.get("props", {}), null, draft)
	var spent: Array = []
	for card_id in shared_half.get("spent", []):
		if _cards_by_id.has(str(card_id)):
			spent.append(str(card_id))
		else:
			(draft["droppedSpent"] as Array).append(str(card_id))
	var flows_clean := {}
	var ids: Array = []
	for id in envelope.get("flows", {}):
		ids.append(str(id))
		flows_clean[str(id)] = _plan_flow_restore(str(id), envelope["flows"][id], null, draft)
	return {
		"report": _finish_report(_bundle["content"], envelope.get("content", {}), ids, draft),
		"shared": shared_clean, "spent": spent, "flows": flows_clean,
	}


## One flow's walk. other_claims is the rest of the world's shared ledger and is
## present only for a SINGLE-flow restore into a live engine: a whole-envelope
## load rebuilds every flow from one consistent moment, so there is nobody else
## to compete with.
func _plan_flow_restore(id: String, saved: Dictionary, other_claims, draft: Dictionary) -> Dictionary:
	var clean := {
		"props": _walk_partition(_flow_decls, saved.get("props", {}), id, draft),
		"turns": (saved.get("turns", {}) as Dictionary).duplicate(true),
		"prng": int(saved.get("prng", 0)),
		"cooldowns": {},
		"board": {},
		"playLog": (saved.get("playLog", []) as Array).duplicate(true),
	}
	for card_id in saved.get("cooldowns", {}):
		if _cards_by_id.has(str(card_id)):
			clean["cooldowns"][str(card_id)] = saved["cooldowns"][card_id]
		else:
			(draft["droppedCooldowns"] as Array).append({"flow": id, "card": str(card_id)})
	var restored := {}
	for hand_id in saved.get("board", {}):
		var known = _hands_by_id.get(str(hand_id))
		if known == null:
			# A deleted entity has no gameId left, so it is named by the id the
			# save carries; everything the build still knows keeps its gameId.
			for card_id in saved["board"][hand_id]:
				(draft["evicted"] as Array).append({"flow": id, "hand": str(hand_id),
					"card": _card_report_name(str(card_id)), "reason": "hand-vanished"})
			continue
		var hand_name := StoryletBundle.effective_game_id(known["hand"])
		var kept: Array = []
		for card_id in saved["board"][hand_id]:
			var entry = _cards_by_id.get(str(card_id))
			if entry == null:
				(draft["evicted"] as Array).append({"flow": id, "hand": hand_name,
					"card": str(card_id), "reason": "vanished"})
				continue
			if other_claims != null and StoryletFlow._card_is_shared(entry["card"], bool(entry["deck"].get("shared", false))):
				var elsewhere := float((other_claims as Dictionary).get(str(card_id), 0))
				var here := float(restored.get(str(card_id), 0))
				if elsewhere + here >= StoryletFlow._shared_cap(entry["card"]):
					(draft["evicted"] as Array).append({"flow": id, "hand": hand_name,
						"card": StoryletBundle.effective_game_id(entry["card"]), "reason": "claimed-elsewhere"})
					continue
				restored[str(card_id)] = here + 1.0
			kept.append(str(card_id))
		clean["board"][str(hand_id)] = kept
	return clean


func _card_report_name(card_id: String) -> String:
	var entry = _cards_by_id.get(card_id)
	return StoryletBundle.effective_game_id(entry["card"]) if entry != null else card_id


static func _sort_by_key(list: Array, fields: Array) -> Array:
	var keyed: Array = []
	for entry in list:
		var parts: Array = []
		for f in fields:
			parts.append(str((entry as Dictionary).get(f, "")))
		keyed.append({"k": REPORT_SEP.join(parts), "v": entry})
	keyed.sort_custom(func(a, b): return str(a["k"]) < str(b["k"]))
	var out: Array = []
	for e in keyed:
		out.append(e["v"])
	return out


## Order the draft and answer the identity questions. `saved` is the content
## block the save carries; for a single-flow restore there is none, so the
## caller passes the bundle's own and no drift is reported.
static func _finish_report(bundle_content: Dictionary, saved_content: Dictionary, flows_in_order: Array, draft: Dictionary) -> Dictionary:
	var evicted := _sort_by_key(draft["evicted"], ["flow", "hand", "card", "reason"])
	var dropped_cooldowns := _sort_by_key(draft["droppedCooldowns"], ["flow", "card"])
	var dropped_spent: Array = (draft["droppedSpent"] as Array).duplicate()
	dropped_spent.sort()
	var dropped_props := _sort_by_key(draft["droppedProperties"], ["flow", "path"])
	var defaulted_props := _sort_by_key(draft["defaultedProperties"], ["flow", "path"])
	var retyped_props := _sort_by_key(draft["retypedProperties"], ["flow", "path"])
	var saved_version := str(saved_content.get("version", ""))
	var saved_hash := str(saved_content.get("hash", ""))
	var bundle_version := str(bundle_content.get("version", ""))
	var bundle_hash := str(bundle_content.get("hash", ""))
	var drift := saved_version != bundle_version or saved_hash != bundle_hash
	return {
		# "flows" is what the load restores, not something it had to change, so
		# it never makes a report inexact.
		"exact": not drift and evicted.is_empty() and dropped_cooldowns.is_empty()
			and dropped_spent.is_empty() and dropped_props.is_empty()
			and defaulted_props.is_empty() and retyped_props.is_empty(),
		"project": str(bundle_content.get("project", "")),
		"version": {"saved": saved_version, "bundle": bundle_version},
		"hash": {"saved": saved_hash, "bundle": bundle_hash},
		"flows": flows_in_order,
		"evicted": evicted,
		"droppedCooldowns": dropped_cooldowns,
		"droppedSpent": dropped_spent,
		"droppedProperties": dropped_props,
		"defaultedProperties": defaulted_props,
		"retypedProperties": retyped_props,
	}
