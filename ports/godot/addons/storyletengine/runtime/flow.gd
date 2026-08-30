@tool   # editor-reachable alongside the engine
# The Flow: one personal playthrough over a StoryletEngine's world
# (design/flows.md) - the dealing semantics of design/storylets-schema.md
# section 3, transliterated from the reference runtime
# (packages/runtime/src/engine.ts, class Flow) and held to the conformance
# corpus. The engine owns the bundle, the lookups, the SHARED property
# partitions and @world; this flow owns its own PRNG, per-box clocks,
# cooldowns, board, claims, play history and per-flow partitions. Every
# name is shared XOR per-flow by declaration, so a read is a union of two
# bags and a write routes by name.
#
# Error model (GDScript has no exceptions): methods whose failures are part
# of play - play(), set_property() - RETURN an error String ("" on
# success). Programmer errors ALSO push_error. A CLOSED flow's handle is
# inert: every verb refuses (peek carries "error", play returns it, the
# rest push_error and return their empty shape).
class_name StoryletFlow
extends RefCounted

const PLAY_OPTION_KEYS := ["advance_turns"]

var _engine: StoryletEngine
var id: String
var _closed := false

var _prng: StoryletMulberry32
# Per-box turn counters, keyed by box id (schema 3.4), PER FLOW.
var _turn_counts: Dictionary = {}
# Absolute next-eligible turn per card id; float(MAX_SAFE_INTEGER) = never.
var _cooldowns: Dictionary = {}
# The board: hand contents (card ids, dealt order), keyed by hand id.
var _board_contents: Dictionary = {}
# Play records: {"card": gameId, "outcome": gameId, "turn": float}.
var _play_log: Array = []
# --- play-history indexes -------------------------------------------------
# A pure summary of _play_log, maintained where it is appended and rebuilt
# where it is replaced. The four history host functions used to SCAN the whole
# log on every call, once per candidate card per ask, so dealing was
# O(candidates x play log) and a shipped game got slower the longer somebody
# played it. Measured in the JS reference before the change (2000 cards):
# count_played went 0.8ms -> 27.9ms as the log reached 4000 plays, and 0.8ms
# flat afterwards. Not saved: the log is the record, this is derived.
#
# The tag keys are the played card's OWN (group id, tag id) pairs, which keeps
# the box-local rule: a group NAME resolves inside the asking box, so a card
# from another box carries different ids and cannot match, exactly as the old
# per-record _in_tag decided.
## A shared empty stand-in for an absent "tags" bag, so the read paths below
## never allocate one just to iterate nothing. Read-only by construction:
## nothing in this file writes through it.
const _NO_TAGS := {}
var _play_count: Dictionary = {}
var _last_play_of: Dictionary = {}
var _tag_play_count: Dictionary = {}
var _last_play_in_tag: Dictionary = {}

# The per-flow partitions: {"story": bag, "box"/"deck"/"hand"/"value": {id: bag}}.
var _stores: Dictionary = {}

var _trace_handlers: Array[Callable] = []
var _log_entries: Array = []
var _log_seq: int = 0


## @internal - built by StoryletEngine.open_flow / load_game only.
func _init(engine: StoryletEngine, flow_id: String, seed_value: int) -> void:
	_engine = engine
	id = flow_id
	_prng = StoryletMulberry32.new(seed_value)
	var fd: Dictionary = engine._flow_decls
	var stores := {"story": StoryletEngine._bag_from_decls(fd["story"]), "box": {}, "deck": {}, "hand": {}, "value": {}}
	for kind in ["box", "deck", "hand", "value"]:
		for owner_id in fd[kind]:
			stores[kind][owner_id] = StoryletEngine._bag_from_decls(fd[kind][owner_id])
	_stores = stores
	for box in engine._bundle["boxes"]:
		_turn_counts[box["id"]] = 0.0
		for hand in box["hands"]:
			_board_contents[hand["id"]] = []


func is_closed() -> bool:
	return _closed


## Close this flow: the handle goes inert, every verb refuses.
func close() -> void:
	if _closed:
		return
	_engine.drop_flow(id, self)
	mark_closed()


## @internal
func mark_closed() -> void:
	_closed = true


# A store's merged read for one owner: the flow's own bag first, the shared
# bag behind it. Names are disjoint (shared XOR per-flow by declaration), so
# "first" is routing, not shadowing.
func _read_pair(kind: String, owner_id: String, name: String) -> Variant:
	var own = _stores[kind].get(owner_id)
	if own != null:
		var v = (own as StoryletPropertyBag).get_value(name)
		if v != null:
			return v
	var shared = _engine._shared[kind].get(owner_id)
	if shared != null:
		return (shared as StoryletPropertyBag).get_value(name)
	return null


func _read_story(name: String) -> Variant:
	var v = (_stores["story"] as StoryletPropertyBag).get_value(name)
	if v != null:
		return v
	return (_engine._shared["story"] as StoryletPropertyBag).get_value(name)


# A store's full value view for one owner: shared under the flow's own.
func _values_of(kind: String, owner_id: String) -> Dictionary:
	var out := {}
	var shared = _engine._shared[kind].get(owner_id)
	if shared != null:
		for n in (shared as StoryletPropertyBag).values:
			out[n] = (shared as StoryletPropertyBag).values[n]
	var own = _stores[kind].get(owner_id)
	if own != null:
		for n in (own as StoryletPropertyBag).values:
			out[n] = (own as StoryletPropertyBag).values[n]
	return out


## A box's current turn (schema 3.4), on THIS flow's clock. NAN (with
## push_error) on an unknown box or a closed flow.
func turn(box_ref: String) -> float:
	if _closed:
		push_error('StoryletFlow: flow "%s" is closed' % id)
		return NAN
	var box = _engine._boxes_by_game_id.get(box_ref)
	if box == null:
		box = _engine._boxes_by_id.get(box_ref)
	if box == null:
		push_error('StoryletFlow: unknown box "%s"' % box_ref)
		return NAN
	return _turn_counts.get(box["id"], 0.0)


## Subscribe to this flow's deal/play trace (schema 5). Returns the
## unsubscribe Callable.
func subscribe_trace(handler: Callable) -> Callable:
	_trace_handlers.append(handler)
	return func() -> void: _trace_handlers.erase(handler)


func _tracing() -> bool:
	return not _trace_handlers.is_empty() or _engine._log_cap >= 0 or _engine.engine_tracing()


func _emit(event: Dictionary, turn_stamp = null) -> void:
	if _engine._log_cap >= 0:
		var entry := event.duplicate()
		entry["seq"] = _log_seq
		_log_seq += 1
		if turn_stamp != null:
			entry["turn"] = turn_stamp
		_log_entries.append(entry)
		if _log_entries.size() > _engine._log_cap:
			_log_entries = _log_entries.slice(_log_entries.size() - _engine._log_cap)
	# Over a COPY, and skipping anything freed: see the note on
	# StoryletEngine.emit_engine, which this mirrors.
	for handler in _trace_handlers.duplicate():
		if handler.is_valid():
			handler.call(event)
	_engine.emit_engine(id, event, turn_stamp)


## The retained flow log (opt-in via the engine's log option), oldest first,
## capped. NOT saved; the durable play history in a save stays the play log.
func log() -> Array:
	return _log_entries


## Empty the retained log; seq keeps counting.
func clear_log() -> void:
	_log_entries = []


# --- expression plumbing ------------------------------------------------------

# Tag group names are box-scoped: two boxes may name a group the same way
# (schema 1 - boxes namespace their groups), so a name is only ever resolved
# inside the box being asked, never bundle-wide. Ids are project-unique and
# accepted here too, still confined to the box.
static func _group_in_box(box: Dictionary, reference: String) -> Variant:
	for group in box["tagGroups"]:
		if StoryletBundle.effective_game_id(group) == reference:
			return group
	for group in box["tagGroups"]:
		if group["id"] == reference:
			return group
	return null


# `box` is the box whose ask is being evaluated: the play-history functions
# take a bare group name, so it resolves there (a card's tags reference its own
# box's group, which keeps the counts box-local).
## One host per box, built once. The Callables below read _play_count,
## _turn_counts and the rest LIVE, so a cached host answers with current state -
## which is what makes caching safe rather than a snapshot bug. Unreal did this
## from the start and the other three rebuilt a host, and its lambdas, on every
## _eval_ctx: once per deck per ask, and once per surviving card in the
## eviction pass. Copied here 2026-08-29, lazily, so unvisited boxes cost
## nothing.
var _hosts_by_box: Dictionary = {}


func _host(box: Dictionary) -> Dictionary:
	var box_id: String = box["id"]
	if _hosts_by_box.has(box_id):
		return _hosts_by_box[box_id]
	var made := _make_host(box)
	_hosts_by_box[box_id] = made
	return made


func _make_host(box: Dictionary) -> Dictionary:
	return {
		"next_random": func() -> float: return _prng.next(),
		"count_played": _host_count_played,
		"turns_since_played": _host_turns_since_played,
		"count_played_in": func(group: String, tag: String) -> float:
			return _host_count_played_in(box, group, tag),
		"turns_since_played_in": func(group: String, tag: String) -> float:
			return _host_turns_since_played_in(box, group, tag),
	}


func _host_count_played(card: String) -> float:
	return float(_play_count.get(card, 0))


func _host_turns_since_played(card: String) -> float:
	var last = _last_play_of.get(card)
	return _since(last) if last != null else StoryletDialect.NEVER_PLAYED


func _host_count_played_in(box: Dictionary, group: String, tag: String) -> float:
	var key = _tag_key_in(box, group, tag)
	return 0.0 if key == null else float(_tag_play_count.get(key, 0))


func _host_turns_since_played_in(box: Dictionary, group: String, tag: String) -> float:
	var key = _tag_key_in(box, group, tag)
	var last = null if key == null else _last_play_in_tag.get(key)
	return _since(last) if last != null else StoryletDialect.NEVER_PLAYED


## A group NAME and tag name resolved in THIS box, as the index's key; null
## when either is unknown here, which is the old per-record "false" and reads
## as "never". Resolved once per call, where _in_tag used to resolve it again
## for every record in the log.
func _tag_key_in(box: Dictionary, group: String, tag: String) -> Variant:
	var found = _group_in_box(box, group)
	if found == null:
		return null
	for v in found["tags"]:
		if v.get("gameId") == tag:
			return _tag_key(found["id"], v["id"])
	return null


## The key for one (group, tag) pair. A UNIT SEPARATOR (U+001F) joins them:
## ids are letters, digits and underscores, so a control character cannot occur
## in one and two pairs can never collide into one key. Not NUL, which GDScript
## will not carry in a string (it substitutes U+FFFD and warns on every parse).
static func _tag_key(group_id: String, tag_id: String) -> String:
	return "%s\u001f%s" % [group_id, tag_id]


## Fold one play into the indexes. O(the card's tags), not O(the log).
func _index_play(record: Dictionary) -> void:
	var card: String = record["card"]
	_play_count[card] = int(_play_count.get(card, 0)) + 1
	_last_play_of[card] = record
	var entry = _engine._cards_by_game_id.get(card)
	if entry == null:
		return
	var tags: Dictionary = entry["card"]["tags"] if entry["card"].has("tags") else _NO_TAGS
	for group_id in tags:
		for tag_id in tags[group_id]:
			var key := _tag_key(group_id, tag_id)
			_tag_play_count[key] = int(_tag_play_count.get(key, 0)) + 1
			_last_play_in_tag[key] = record


## Rebuild from the log, wherever it is REPLACED rather than appended to.
func _rebuild_play_index() -> void:
	_play_count = {}
	_last_play_of = {}
	_tag_play_count = {}
	_last_play_in_tag = {}
	for record in _play_log:
		_index_play(record)


# Turns-since is measured on the played card's box's clock (3.4).
func _since(record: Dictionary) -> float:
	var entry = _engine._cards_by_game_id.get(record["card"])
	if entry == null:
		return StoryletDialect.NEVER_PLAYED
	return float(_turn_counts.get(entry["box"]["id"], 0.0)) - float(record["turn"])


# The evaluation environment (schema 3.1/6.2): @box/@deck resolve to the card
# under evaluation; in hand-condition contexts @deck is an empty bag, so any
# reference is an eval error (missing-policy throw). Every scope is the
# flow's MERGED view - its own copies over the shared values, names
# disjoint - and @world reads through the engine's resolver. Quality
# ladders live on the engine (declaration-level, partition-blind).

# The ladder behind one composed @hand name, or null when the name is not a
# quality (or came from criteria, which are tag names, never state).
func _hand_ladder(hand_env: Dictionary, name: String) -> Variant:
	var source = hand_env["sources"].get(name)
	if source == null:
		return null
	match str(source.get("kind", "")):
		"value":
			return (_engine._value_ladders.get(source["id"], {}) as Dictionary).get(name)
		"hand":
			return (_engine._hand_ladders.get(source["id"], {}) as Dictionary).get(name)
	return null


func _eval_ctx(box: Dictionary, deck, hand_env: Dictionary) -> Dictionary:
	var box_id: String = box["id"]
	var deck_id = deck["id"] if deck != null else null
	var ctx := {
		"scopes": {
			"world": _engine._world["get"],
			"story": func(n: String) -> Variant: return _read_story(n),
			"box": func(n: String) -> Variant: return _read_pair("box", box_id, n),
			"deck": (func(n: String) -> Variant: return _read_pair("deck", deck_id, n)) if deck_id != null else {},
			"hand": hand_env["bag"],
		},
		"host": _host(box),
	}
	if _engine._has_qualities:
		# The quality channel, answering for THIS ask's box and deck.
		var env := hand_env
		ctx["qualities"] = func(scope: String, name: String) -> Variant:
			match scope:
				"world":
					return _engine._world_ladders.get(name)
				"story":
					return _engine._story_ladders.get(name)
				"box":
					return (_engine._box_ladders.get(box_id, {}) as Dictionary).get(name)
				"deck":
					if deck_id == null:
						return null
					return (_engine._deck_ladders.get(deck_id, {}) as Dictionary).get(name)
				"hand":
					return _hand_ladder(env, name)
			return null
	return ctx


# Evaluate an {src, ast} envelope; a scalar value or an EvalError.
func _eval(expr: Dictionary, ctx: Dictionary) -> Variant:
	var node = StoryletBundle.node_of(expr)
	if node == null:
		return StoryletExpression.error("malformed expression AST")
	return StoryletExpression.evaluate(node, ctx, _engine._dialect)


# A condition gate: absent passes; an eval error is never a silent pass - the
# card/deck is unavailable (schema 3.1) and the trace surfaces the diagnostic.
func _passes(expr, ctx: Dictionary, where: String = "condition") -> bool:
	if expr == null:
		return true
	var v = _eval(expr, ctx)
	if StoryletExpression.is_error(v):
		if _tracing():
			_emit({"type": "diagnostic", "where": where, "message": v.message})
		return false
	return StoryletValues.condition_passes(v)


# --- resolving asks (schema 2.6 + 3.6) -----------------------------------------

static func _tag_by_game_id(group: Dictionary, game_id: String) -> Variant:
	for t in group["tags"]:
		if t.get("gameId") == game_id:
			return t
	return null


# A deal's ask: the hand's template bindings + chosen tags, or its rule's
# bindings, plus the implicit home binding (schema 2.4). Returns the ask
# descriptor {"box", "hand", "condition"?, "bound_tags", "ask_names"} or
# {"error": message}.
func _ask_for_hand(hand: Dictionary, box: Dictionary) -> Dictionary:
	var bound_tags := {}
	var ask_names := {}
	var condition = null
	if hand.has("template"):
		var template = _engine._templates_by_id.get(hand["template"])
		if template == null:
			return {"error": 'hand "%s": unknown template "%s"' % [StoryletBundle.effective_game_id(hand), hand["template"]]}
		for group_id in template.get("bindings", {}):
			bound_tags[group_id] = template["bindings"][group_id]
		for group_id in hand.get("chosen", {}):
			var tag_id = hand["chosen"][group_id]
			bound_tags[group_id] = tag_id
			var found = _engine._groups_by_id.get(group_id)
			if found != null:
				var tag = null
				for t in found["group"]["tags"]:
					if t["id"] == tag_id:
						tag = t
						break
				if tag != null:
					ask_names[StoryletBundle.effective_game_id(found["group"])] = StoryletBundle.effective_game_id(tag)
		condition = template.get("condition")
	else:
		var rule: Dictionary = hand.get("rule", {})
		for group_id in rule.get("bindings", {}):
			var rule_tag_id = rule["bindings"][group_id]
			bound_tags[group_id] = rule_tag_id
			# ...and name it, as the template branch does: a card reading
			# @hand.<group> must not care HOW the group got bound.
			var rule_found = _engine._groups_by_id.get(group_id)
			if rule_found != null:
				var rule_tag = null
				for t in rule_found["group"]["tags"]:
					if t["id"] == rule_tag_id:
						rule_tag = t
						break
				if rule_tag != null:
					ask_names[StoryletBundle.effective_game_id(rule_found["group"])] = StoryletBundle.effective_game_id(rule_tag)
		condition = rule.get("condition")
	bound_tags[StoryletBundle.PLACE_GROUP] = hand["id"]
	_bind_state_groups(box, bound_tags, ask_names)
	var ask := {"box": box, "hand": hand, "bound_tags": bound_tags, "ask_names": ask_names}
	if condition != null:
		ask["condition"] = condition
	return ask


# A peek's ask: raw criteria ({group gameId: tag gameId}), bindings only, no
# condition slot (schema 3.1; the boundary, Reboot 4). Same result shape as
# _ask_for_hand.
func _ask_for_peek(box: Dictionary, criteria: Dictionary) -> Dictionary:
	var bound_tags := {}
	var ask_names := {}
	for group_ref in criteria:
		var tag_ref: String = str(criteria[group_ref])
		if group_ref == StoryletBundle.PLACE_GROUP:
			var hand = _engine._hands_by_game_id.get(tag_ref)
			if hand == null:
				hand = _engine._hands_by_id.get(tag_ref)
			if hand == null:
				return {"error": 'peek: unknown hand "%s" in home criteria' % tag_ref}
			bound_tags[StoryletBundle.PLACE_GROUP] = hand["hand"]["id"]
			continue
		var found = _group_in_box(box, group_ref)
		if found == null:
			return {"error": 'peek: unknown tag group "%s" in box "%s"' % [group_ref, StoryletBundle.effective_game_id(box)]}
		var tag = _tag_by_game_id(found, tag_ref)
		if tag == null:
			for t in found["tags"]:
				if t["id"] == tag_ref:
					tag = t
					break
		if tag == null:
			return {"error": 'peek: unknown tag "%s" in group "%s"' % [tag_ref, StoryletBundle.effective_game_id(found)]}
		bound_tags[found["id"]] = tag["id"]
		ask_names[StoryletBundle.effective_game_id(found)] = StoryletBundle.effective_game_id(tag)
	_bind_state_groups(box, bound_tags, ask_names)
	return {"box": box, "bound_tags": bound_tags, "ask_names": ask_names}


# Bind every state-bound group in the box from the property it names. Runs
# after the hand's own bindings and never overwrites one: an explicit binding
# beats a default. A value naming no tag leaves the group UNBOUND (a wildcard)
# with a diagnostic, because a silently empty hand reads as content that does
# not exist.
func _bind_state_groups(box: Dictionary, bound_tags: Dictionary, ask_names: Dictionary) -> void:
	for group in box.get("tagGroups", []):
		var bound_by = group.get("boundBy")
		if bound_by == null or str(bound_by).is_empty() or bound_tags.has(group["id"]):
			continue
		var ref := str(bound_by)
		var where := "tag group %s" % StoryletBundle.effective_game_id(group)
		var dot := ref.find(".")
		var scope := ref.substr(1, dot - 1) if ref.begins_with("@") and dot > 0 else ""
		var name := ref.substr(dot + 1) if dot > 0 else ""
		# The NAME is checked too, not just the scope word: JS and Unity apply
		# ^@(world|story)\.([a-z][a-z0-9_-]*)$ and Godot and Unreal accepted any
		# non-empty remainder, so `@story.Act` bound here and was refused there
		# (2026-08-29). The compiler applies the same regex, so only a
		# hand-edited or foreign-produced bundle can reach this - which is
		# exactly when the four should still agree.
		if (scope != "world" and scope != "story") or not RegEx.create_from_string("^[a-z][a-z0-9_-]*$").search(name):
			_emit({"type": "diagnostic", "where": where, "message": 'boundBy "%s" is not a @world or @story property reference' % ref})
			continue
		# Resolve without get_property, which push_error()s on a missing name:
		# an undeclared boundBy is a diagnostic on the trace, not engine noise.
		var r := _resolve_path("%s.%s" % [scope, name])
		if r.has("error"):
			_emit({"type": "diagnostic", "where": where, "message": 'boundBy "%s" names a property that is not declared' % ref})
			continue
		var value = r["value"]
		var wanted := str(value)
		var tag = null
		for t in group.get("tags", []):
			if StoryletBundle.effective_game_id(t) == wanted:
				tag = t
				break
		if tag == null:
			_emit({"type": "diagnostic", "where": where, "message": '%s is "%s", which is not one of its tags' % [ref, wanted]})
			continue
		bound_tags[group["id"]] = tag["id"]
		ask_names[StoryletBundle.effective_game_id(group)] = StoryletBundle.effective_game_id(tag)


# --- @hand composition (schema 3.6) --------------------------------------------

# The composed @hand for one ask: {"bag": name -> value, "sources": name ->
# {"kind": "value"|"hand"|"criteria", "id"?}, "bound_tags"}. Later layers
# shadow earlier; a re-set keeps its slot (Dictionary insertion order matches
# JS object semantics, verified).
func _build_hand_env(ask: Dictionary) -> Dictionary:
	var bag := {}
	var sources := {}

	# 1. Tag properties of every bound tag (home binds a hand, not a tag) -
	#    the MERGED view: shared under the flow's own, names disjoint.
	for group_id in ask["bound_tags"]:
		if group_id == StoryletBundle.PLACE_GROUP:
			continue
		var tag_id = ask["bound_tags"][group_id]
		var tag_values := _values_of("value", tag_id)
		for prop_name in tag_values:
			bag[prop_name] = tag_values[prop_name]
			sources[prop_name] = {"kind": "value", "id": tag_id}
	# 2. Hand properties, when the ask is a deal.
	if ask.has("hand"):
		var hand_values := _values_of("hand", ask["hand"]["id"])
		for prop_name in hand_values:
			bag[prop_name] = hand_values[prop_name]
			sources[prop_name] = {"kind": "hand", "id": ask["hand"]["id"]}
	# 3. Chosen tags / criteria, by group name (the tag's gameId as value).
	for name in ask["ask_names"]:
		bag[name] = ask["ask_names"][name]
		sources[name] = {"kind": "criteria"}
	return {"bag": bag, "sources": sources, "bound_tags": ask["bound_tags"]}


# --- the ask (schema 3.1 + 3.2) --------------------------------------------------

# The claims ledger, derived from the board: card id -> holding hands (3.5).
func _claims() -> Dictionary:
	var counts := {}
	for hand_id in _board_contents:
		for id in _board_contents[hand_id]:
			counts[id] = counts.get(id, 0) + 1
	return counts


static func _copies_of(card: Dictionary) -> float:
	return float(card.get("copies", 1))


## Is this card scarce across flows (design/shared-scarcity.md)? The deck says
## what the pile is for and the card may override it. The deck's flag hoists
## out of the card loop: the ask runs this per card per deal.
static func _card_is_shared(card: Dictionary, deck_shared: bool) -> bool:
	return bool(card.get("shared", deck_shared))


## How many hands ACROSS EVERY FLOW may hold this at once; defaults to copies.
static func _shared_cap(card: Dictionary) -> float:
	return float(card.get("sharedCopies", card.get("copies", 1)))


## Every card id on THIS flow's board, one entry per holding hand. The engine
## sums these across live flows for the shared ledger.
func held_card_ids() -> Array:
	var out: Array = []
	for hand_id in _board_contents:
		for id in _board_contents[hand_id]:
			out.append(id)
	return out


## The claims step (3.1 step 6) for one card, as a verdict or "" for available.
## Two caps apply to a shared card and they are different statements, so they
## get different verdicts: `copies` is your own board filling up,
## `sharedCopies` is somebody else already holding it, and a participant told
## "claimed" about a card on another person's table would read it as a fault.
func _claim_verdict(card: Dictionary, shared: bool, mine: Dictionary, world: Dictionary) -> String:
	var id: String = card["id"]
	if float(mine.get(id, 0)) >= _copies_of(card):
		return "claimed"
	if shared and float(world.get(id, 0)) >= _shared_cap(card):
		return "claimed-elsewhere"
	return ""


# Tag matching (schema 3.1 step 3): for every bound group the card lists the
# bound tag or omits the group (wildcard); the home group inverts - a homed
# card requires a matching home binding (schema 2.4).
func _tags_match(card: Dictionary, bound_tags: Dictionary) -> bool:
	# NOT card.get("tags", {}): GDScript builds a default argument eagerly, so
	# that allocated a fresh Dictionary on EVERY call for every card with no
	# tags - and this runs once per candidate card per ask, which is the
	# hottest loop in the port. _NO_TAGS is only ever read.
	var card_tags: Dictionary = card["tags"] if card.has("tags") else _NO_TAGS
	var home = card_tags.get(StoryletBundle.PLACE_GROUP)
	if home != null and not (home as Array).is_empty():
		if not bound_tags.has(StoryletBundle.PLACE_GROUP):
			return false
		if not (home as Array).has(bound_tags[StoryletBundle.PLACE_GROUP]):
			return false
	for group_id in bound_tags:
		if group_id == StoryletBundle.PLACE_GROUP:
			continue
		if not card_tags.has(group_id):
			# Omission is a wildcard unless the group says otherwise.
			if _engine._required_groups.has(group_id):
				return false
			continue
		if not (card_tags[group_id] as Array).has(bound_tags[group_id]):
			return false
	return true


# Run one ask: availability filter then ranking. `claimed(card, shared)`
# decides the claims step (step 6) per card, returning the verdict that
# refused it or "" for available. `trace` (an Array when a
# subscriber exists, else null) collects the per-card verdicts. Returns
# {"ordered": Array of card entries, "hand_env"}.
func _run_ask(ask: Dictionary, claimed: Callable, trace) -> Dictionary:
	var box: Dictionary = ask["box"]
	var hand_env := _build_hand_env(ask)

	# The hand's condition: ask-constant, evaluated once (schema 3.1 step 4).
	var hand_where := "hand %s condition" % (StoryletBundle.effective_game_id(ask["hand"]) if ask.has("hand") else "")
	if not _passes(ask.get("condition"), _eval_ctx(box, null, hand_env), hand_where):
		return {"ordered": [], "hand_env": hand_env}

	# Deck gates: evaluated once per ask, in deck (id) order (schema 2.5).
	var gate_ok := {}
	for deck in box["decks"]:
		gate_ok[deck["id"]] = _passes(deck.get("condition"), _eval_ctx(box, deck, hand_env), "deck %s gate" % str(deck.get("gameId", deck["id"])))

	var turn_now: float = _turn_counts.get(box["id"], 0.0)
	var scored: Array = []
	for deck in box["decks"]:
		# ONE context per deck, not per card: box, deck and hand_env do not vary
		# inside this loop, and a condition is a read-only gate (schema 3.1).
		# Reference: engine.ts runAsk, and design/port-review-2026-08.md.
		var deck_ctx := _eval_ctx(box, deck, hand_env)
		var deck_shared: bool = bool(deck.get("shared", false))
		for card in deck["cards"]:
			var shared := _card_is_shared(card, deck_shared)
			if not gate_ok[deck["id"]]:
				_verdict(trace, card["id"], "deck-gate")
				continue
			# Taken out of the world by somebody's shared one-shot. Checked
			# before this flow's own clock, because "cooldown" would point the
			# reader at a turn counter that has nothing to do with it.
			if shared and _engine.is_taken(card["id"]):
				_verdict(trace, card["id"], "taken")
				continue
			if float(_cooldowns.get(card["id"], 0.0)) > turn_now:
				_verdict(trace, card["id"], "cooldown")
				continue
			if not _tags_match(card, hand_env["bound_tags"]):
				_verdict(trace, card["id"], "tags")
				continue
			var ctx := deck_ctx
			# The label is only read when an eval THROWS and only when tracing, so
			# formatting it per card was waste on the path that matters.
			if card.has("condition") and not _passes(card["condition"], ctx, ("card %s condition" % str(card.get("gameId", card["id"]))) if _tracing() else ""):
				_verdict(trace, card["id"], "condition")
				continue
			var refused: String = claimed.call(card, shared)   # claims, last (schema 3.1 step 6)
			if refused != "":
				_verdict(trace, card["id"], refused)
				continue

			var priority: float
			var raw_priority = card.get("priority", 0)
			if raw_priority is Dictionary:
				var v = _eval(raw_priority, ctx)
				if StoryletExpression.is_error(v):
					if _tracing():
						_emit({"type": "diagnostic", "where": "card %s priority" % str(card.get("gameId", card["id"])), "message": v.message})
					_verdict(trace, card["id"], "priority")
					continue
				if not StoryletValues.is_number(v):
					_verdict(trace, card["id"], "priority")
					continue
				priority = float(v)
			else:
				priority = float(raw_priority)

			var spec := 0
			if box["ranking"].get("specificity", true) and card.has("condition"):
				var node = StoryletBundle.node_of(card["condition"])
				if node != null:
					var truthy := func(n: Dictionary) -> bool:
						var r = StoryletExpression.evaluate(n, ctx, _engine._dialect)
						if StoryletExpression.is_error(r):
							return false
						return StoryletValues.condition_passes(r)
					spec = StoryletSpecificity.matched_specificity(node, truthy)
			scored.append({
				"entry": {"card": card, "deck": deck, "box": box},
				"priority": priority,
				"spec": spec,
				"index": scored.size(),
			})

	# STABLE sort: priority desc -> spec desc -> original index asc (the index
	# tiebreak makes the order total, so sort_custom's instability is moot).
	var by_rank := func(a: Dictionary, b: Dictionary) -> bool:
		if a["priority"] != b["priority"]:
			return a["priority"] > b["priority"]
		if a["spec"] != b["spec"]:
			return a["spec"] > b["spec"]
		return a["index"] < b["index"]
	scored.sort_custom(by_rank)
	# Seeded shuffle of each maximal tie run; runs of 1 consume no draws.
	var i := 0
	while i < scored.size():
		var j := i + 1
		while j < scored.size() \
				and scored[j]["priority"] == scored[i]["priority"] \
				and scored[j]["spec"] == scored[i]["spec"]:
			j += 1
		if j - i > 1:
			var run := scored.slice(i, j)
			StoryletMulberry32.shuffle_in_place(run, _prng)
			for k in run.size():
				scored[i + k] = run[k]
		i = j
	if trace != null:
		for s in scored:
			trace.append({"id": s["entry"]["card"]["id"], "verdict": "dealt", "priority": s["priority"], "specificity": s["spec"]})
	var ordered: Array = []
	for s in scored:
		ordered.append(s["entry"])
	return {"ordered": ordered, "hand_env": hand_env}


static func _verdict(trace, id: String, v: String) -> void:
	if trace != null:
		trace.append({"id": id, "verdict": v})


# Flip eligible-but-not-taken trace entries to "capped".
static func _cap_trace(trace: Array, taken: Dictionary) -> void:
	for entry in trace:
		if entry["verdict"] == "dealt" and not taken.has(entry["id"]):
			entry["verdict"] = "capped"


# A card view in a dealt hand or a peeked list. Carries NO outcome
# availability - ask outcomes() for current truth (schema 5).
func _view(entry: Dictionary) -> Dictionary:
	var card: Dictionary = entry["card"]
	var v := {"id": card["id"], "gameId": StoryletBundle.effective_game_id(card)}
	if card.has("title"):
		v["title"] = card["title"]
	if card.has("purpose"):
		v["purpose"] = card["purpose"]
	if card.has("fields"):
		v["fields"] = card["fields"]
	return v


func _hand_capacity(hand: Dictionary) -> float:
	if hand.has("slots"):
		return float(hand["slots"])
	var declared = null
	if hand.has("template"):
		var template = _engine._templates_by_id.get(hand["template"])
		if template != null:
			declared = template.get("slots")
	else:
		declared = hand.get("rule", {}).get("slots")
	if declared == null or (declared is String and declared == "unbounded"):
		return INF
	return float(declared)


func _resolve_hand(ref: String) -> Variant:
	var found = _engine._hands_by_game_id.get(ref)
	if found == null:
		found = _engine._hands_by_id.get(ref)
	return found


# --- host surface (schema 5) -----------------------------------------------------

## Look at the top of the stock through raw tag criteria (schema 3.1): claims
## respected, nothing registered, nothing left behind but the trace line. You
## can never play a card you only peeked. Returns {"box": gameId, "cards":
## Array of card views}; a bad reference push_errors and adds "error".
func peek(box_ref: String, criteria: Dictionary = {}, n = null) -> Dictionary:
	if _closed:
		var closed_msg := 'flow "%s" is closed' % id
		push_error("StoryletFlow.peek: " + closed_msg)
		return {"box": box_ref, "cards": [], "error": closed_msg}
	var box = _engine._boxes_by_game_id.get(box_ref)
	if box == null:
		box = _engine._boxes_by_id.get(box_ref)
	if box == null:
		var msg := 'unknown box "%s"' % box_ref
		push_error("StoryletFlow.peek: " + msg)
		return {"box": box_ref, "cards": [], "error": msg}
	var ask := _ask_for_peek(box, criteria)
	if ask.has("error"):
		push_error("StoryletFlow.peek: " + ask["error"])
		return {"box": StoryletBundle.effective_game_id(box), "cards": [], "error": ask["error"]}
	var claim_counts := _claims()
	# Skipped outright when the bundle shares nothing, which is most bundles:
	# the ledger walks every live flow's whole board, and an empty dictionary
	# answers every question the same way a computed one would.
	var world_claims := _engine.shared_claims() if _engine._has_shared else {}
	var trace = [] if _tracing() else null
	var claimed := func(card: Dictionary, shared: bool) -> String: return _claim_verdict(card, shared, claim_counts, world_claims)
	var res := _run_ask(ask, claimed, trace)
	var ordered: Array = res["ordered"]
	var listed := ordered if n == null else ordered.slice(0, maxi(int(n), 0))
	if trace != null:
		var taken := {}
		for e in listed:
			taken[e["card"]["id"]] = true
		_cap_trace(trace, taken)
		_emit({"type": "peek", "box": StoryletBundle.effective_game_id(box), "criteria": criteria.duplicate(), "cards": trace}, _turn_counts.get(box["id"], 0.0))
	var cards: Array = []
	for e in listed:
		cards.append(_view(e))
	return {"box": StoryletBundle.effective_game_id(box), "cards": cards}


## Refresh one hand (schema 3.5); returns its new shape (Array of card views).
func deal(hand_ref: String) -> Array:
	if _closed:
		push_error('StoryletFlow.deal: flow "%s" is closed' % id)
		return []
	var found = _resolve_hand(hand_ref)
	if found == null:
		push_error('StoryletFlow.deal: unknown hand "%s"' % hand_ref)
		return []
	return deal_many([hand_ref]).get(StoryletBundle.effective_game_id(found["hand"]), [])


## Re-deal several / all hands (schema 3.5): seeded hand-order shuffle
## (fairness), evict, seed the ledger from survivors, fill in order. Returns
## the dealt slice - the new contents of exactly the hands this call dealt,
## keyed by hand gameId (board() stays the whole-board read).
func deal_many(hand_refs = null) -> Dictionary:
	if _closed:
		push_error('StoryletFlow.deal_many: flow "%s" is closed' % id)
		return {}
	var refs: Array = []
	if hand_refs == null:
		refs = _engine._hands_by_id.keys()
		refs.sort()
	else:
		for r in hand_refs:
			refs.append(str(r))
	var dealt: Array = []
	for ref in refs:
		var found = _resolve_hand(ref)
		if found == null:
			push_error('StoryletFlow.deal_many: unknown hand "%s"' % ref)
			return {}
		dealt.append(found)
	StoryletMulberry32.shuffle_in_place(dealt, _prng)

	# Eviction first: drop dealt cards no longer available to their hand
	# (minus the claims check against their own seat).
	for f in dealt:
		var hand: Dictionary = f["hand"]
		var box: Dictionary = f["box"]
		var ask := _ask_for_hand(hand, box)
		if ask.has("error"):
			push_error("StoryletFlow.deal_many: " + ask["error"])
			continue
		var hand_env := _build_hand_env(ask)
		var condition_ok := _passes(ask.get("condition"), _eval_ctx(box, null, hand_env))
		var gate_ok := {}
		for deck in box["decks"]:
			gate_ok[deck["id"]] = _passes(deck.get("condition"), _eval_ctx(box, deck, hand_env))
		var turn_now: float = _turn_counts.get(box["id"], 0.0)
		var survivors: Array = []
		# Trace events fire after the state they report has landed (a handler
		# reading the board sees the eviction), so they are collected here and
		# emitted once the survivors are set.
		var evicted: Array = []
		for card_id in _board_contents.get(hand["id"], []):
			var reason := ""
			if not condition_ok:
				reason = "hand-condition"
			else:
				var entry = _engine._cards_by_id.get(card_id)
				if entry == null:
					reason = "vanished"   # edited content: dropped
				elif not gate_ok[entry["deck"]["id"]]:
					reason = "deck-gate"
				elif float(_cooldowns.get(card_id, 0.0)) > turn_now:
					reason = "cooldown"
				elif not _tags_match(entry["card"], hand_env["bound_tags"]):
					reason = "tags"
				elif not _passes(entry["card"].get("condition"), _eval_ctx(box, entry["deck"], hand_env), "card %s condition" % str(entry["card"].get("gameId", card_id))):
					reason = "condition"
			if reason == "":
				survivors.append(card_id)
			else:
				evicted.append({"card": card_id, "reason": reason})
		_board_contents[hand["id"]] = survivors
		if _tracing():
			for e in evicted:
				_emit({"type": "evict", "hand": hand["id"], "card": e["card"], "reason": e["reason"]}, turn_now)

	var claim_counts := _claims()
	# Taken once for the whole batch and kept in step with the local ledger
	# below, so two hands in the SAME deal cannot both take the last shared copy.
	# Skipped outright when the bundle shares nothing, which is most bundles:
	# the ledger walks every live flow's whole board, and an empty dictionary
	# answers every question the same way a computed one would.
	var world_claims := _engine.shared_claims() if _engine._has_shared else {}
	for f in dealt:
		var hand: Dictionary = f["hand"]
		var box: Dictionary = f["box"]
		var contents: Array = _board_contents.get(hand["id"], [])
		var free := _hand_capacity(hand) - float(contents.size())
		if free <= 0.0:
			continue
		var ask := _ask_for_hand(hand, box)
		if ask.has("error"):
			continue   # already reported in the evict pass
		var own := {}
		for id in contents:
			own[id] = true
		var trace = [] if _tracing() else null
		# At most once in any one hand; at most `copies` hands here, and at most
		# `sharedCopies` hands anywhere (schema 3.5, shared-scarcity 5).
		var claimed := func(card: Dictionary, shared: bool) -> String: return "claimed" if own.has(card["id"]) else _claim_verdict(card, shared, claim_counts, world_claims)
		var res := _run_ask(ask, claimed, trace)
		var ordered: Array = res["ordered"]
		var take := ordered.size() if is_inf(free) else mini(int(free), ordered.size())
		var added: Array = []
		for k in take:
			added.append(ordered[k]["card"]["id"])
		var next_contents := contents.duplicate()
		next_contents.append_array(added)
		_board_contents[hand["id"]] = next_contents
		for id in added:
			claim_counts[id] = claim_counts.get(id, 0) + 1
			world_claims[id] = world_claims.get(id, 0) + 1
		# Emitted after the hand is set: a handler reading board() sees the deal.
		if trace != null:
			var taken := {}
			for id in added:
				taken[id] = true
			_cap_trace(trace, taken)
			_emit({"type": "deal", "hand": StoryletBundle.effective_game_id(hand), "cards": trace}, _turn_counts.get(box["id"], 0.0))

	var out := {}
	for f in dealt:
		var ids: Array = _board_contents.get(f["hand"]["id"], [])
		var views: Array = []
		for id in ids:
			views.append(_view(_engine._cards_by_id[id]))
		out[StoryletBundle.effective_game_id(f["hand"])] = views
	return out


## The board: current hand contents, in dealt order, keyed by hand gameId
## (schema 5). Read it for what is out; peek the stock for what could come.
##
## box_ref (a box gameId or id) narrows the read to that box's hands, in the
## same shape and the same order: "give me the barks hands" is a common host
## query, and boxes are how a game separates its storylet systems, so the
## grouping belongs here rather than in every host. An unknown box
## push_errors and returns {} (as deal_many does on an unknown hand).
## `box_ref` defaults to NULL, not "": with an empty-string sentinel,
## `board("")` read as the whole board here while JS and Unity threw "unknown
## box" for the same call (2026-08-29). An empty string is not a box name in
## any of them, and a host passing one out of blank config should learn that in
## every engine rather than silently getting everything in two. Unity uses an
## overload pair for the same reason; GDScript has null, so it uses that.
func board(box_ref = null) -> Dictionary:
	if _closed:
		push_error('StoryletFlow.board: flow "%s" is closed' % id)
		return {}
	var keep := ""
	if box_ref != null:
		var box = _engine._boxes_by_game_id.get(box_ref)
		if box == null:
			box = _engine._boxes_by_id.get(box_ref)
		if box == null:
			push_error('StoryletFlow.board: unknown box "%s"' % box_ref)
			return {}
		keep = box["id"]
	var out := {}
	for hand_id in _board_contents:
		var found: Dictionary = _engine._hands_by_id[hand_id]
		if keep != "" and found["box"]["id"] != keep:
			continue
		var views: Array = []
		for id in _board_contents[hand_id]:
			views.append(_view(_engine._cards_by_id[id]))
		out[StoryletBundle.effective_game_id(found["hand"])] = views
	return out


# Resolve a played/inspected card within a hand on the board. Returns
# {"entry", "ask"} or {"error": message}.
func _resolve_dealt(card_id: String, hand_ref: String) -> Dictionary:
	var entry = _engine._cards_by_id.get(card_id)
	if entry == null:
		entry = _engine._cards_by_game_id.get(card_id)
	if entry == null:
		return {"error": 'unknown card "%s"' % card_id}
	var found = _resolve_hand(hand_ref)
	if found == null:
		return {"error": 'unknown hand "%s"' % hand_ref}
	if not (_board_contents.get(found["hand"]["id"], []) as Array).has(entry["card"]["id"]):
		return {"error": 'card "%s" is not dealt to hand "%s"' % [StoryletBundle.effective_game_id(entry["card"]), StoryletBundle.effective_game_id(found["hand"])]}
	var ask := _ask_for_hand(found["hand"], found["box"])
	if ask.has("error"):
		return {"error": ask["error"]}
	return {"entry": entry, "ask": ask}


## Outcome availability, evaluated against CURRENT state on every ask (schema
## 3.1/5) - never a deal-time snapshot. Returns Array of {"id", "gameId",
## "title"?, "purpose"?, "available"}; a bad reference push_errors and
## returns [].
func outcomes(card_id: String, from_hand: String) -> Array:
	if _closed:
		push_error('StoryletFlow.outcomes: flow "%s" is closed' % id)
		return []
	var rd := _resolve_dealt(card_id, from_hand)
	if rd.has("error"):
		push_error("StoryletFlow.outcomes: " + rd["error"])
		return []
	var entry: Dictionary = rd["entry"]
	var ctx := _eval_ctx(entry["box"], entry["deck"], _build_hand_env(rd["ask"]))
	var out: Array = []
	for o in entry["card"]["outcomes"]:
		var view := {"id": o["id"], "gameId": StoryletBundle.effective_game_id(o)}
		if o.has("title"):
			view["title"] = o["title"]
		if o.has("purpose"):
			view["purpose"] = o["purpose"]
		view["available"] = _passes(o.get("condition"), ctx)
		out.append(view)
	return out


## Apply an outcome (schema 3.7): the card must sit in a hand on the board
## (you never play a card from inside the deck). Options: {"advance_turns":
## float} overrides settings.playAdvancesTurns. Returns "" on success or the
## error message; errors before any mutation on a gated-shut outcome, an
## erroring change expression or a bad reference (the TS throw paths).
func play(card_id: String, outcome_game_id: String, from_hand: String, opts: Dictionary = {}) -> String:
	if _closed:
		var closed_msg := 'flow "%s" is closed' % id
		push_error("StoryletFlow.play: " + closed_msg)
		return closed_msg
	for key in opts:
		if not PLAY_OPTION_KEYS.has(key):
			var msg := 'unknown play option "%s" (valid: %s)' % [key, ", ".join(PLAY_OPTION_KEYS)]
			push_error("StoryletFlow.play: " + msg)
			return msg
	var rd := _resolve_dealt(card_id, from_hand)
	if rd.has("error"):
		return rd["error"]
	var entry: Dictionary = rd["entry"]
	var ask: Dictionary = rd["ask"]
	var outcome = null
	for o in entry["card"]["outcomes"]:
		if StoryletBundle.effective_game_id(o) == outcome_game_id:
			outcome = o
			break
	if outcome == null:
		return 'card "%s" has no outcome "%s"' % [StoryletBundle.effective_game_id(entry["card"]), outcome_game_id]

	var hand_env := _build_hand_env(ask)
	var ctx := _eval_ctx(entry["box"], entry["deck"], hand_env)
	if not _passes(outcome.get("condition"), ctx):
		return 'outcome "%s" on "%s" is gated shut' % [outcome_game_id, StoryletBundle.effective_game_id(entry["card"])]

	# The played card's box's clock advances (schema 3.4); computed up front
	# so the play and its writes log as one action, one turn stamp.
	var new_turn: float = float(_turn_counts.get(entry["box"]["id"], 0.0)) \
		+ float(opts.get("advance_turns", _engine._bundle["settings"]["playAdvancesTurns"]))

	# Every right-hand side evaluates against PRE-play state, then all writes
	# land (schema 3.7).
	var writes: Array = []
	for target in outcome.get("changes", {}):
		var v = _eval(outcome["changes"][target], ctx)
		if StoryletExpression.is_error(v):
			return v.message
		writes.append({"target": target, "value": v})
	for w in writes:
		var landed := _apply_write(w["target"], w["value"], entry, hand_env)
		if landed.has("error"):
			return landed["error"]
		if _tracing():
			var evt := {"type": "write", "target": w["target"], "path": landed["path"], "value": w["value"]}
			if landed.has("prev"):
				evt["prev"] = landed["prev"]
			_emit(evt, new_turn)

	var record := {
		"card": StoryletBundle.effective_game_id(entry["card"]),
		"outcome": StoryletBundle.effective_game_id(outcome),
		"turn": new_turn,
	}
	_play_log.append(record)
	_index_play(record)
	var redraw = entry["card"].get("redraw", "always")
	if redraw is String and redraw == "never":
		# A shared one-shot leaves the WORLD rather than this flow. A finite
		# redraw deliberately does not share, whatever the deck says: a cooldown
		# is an absolute turn of this flow's box clock and there is no shared
		# clock to compare it against (design/shared-scarcity.md 9.3.2).
		if _card_is_shared(entry["card"], bool(entry["deck"].get("shared", false))):
			_engine.mark_taken(entry["card"]["id"])
		else:
			_cooldowns[entry["card"]["id"]] = float(StoryletBundle.MAX_SAFE_INTEGER)
	elif StoryletValues.is_number(redraw):
		_cooldowns[entry["card"]["id"]] = new_turn + float(redraw)
	# The card leaves its hand, releasing its claim (schema 3.5/3.7).
	var hand_id: String = ask["hand"]["id"]
	var remaining: Array = []
	for id in _board_contents.get(hand_id, []):
		if id != entry["card"]["id"]:
			remaining.append(id)
	_board_contents[hand_id] = remaining
	_turn_counts[entry["box"]["id"]] = new_turn
	# Emitted last: a handler reading the board and the clock sees the play.
	if _tracing():
		_emit({"type": "play", "card": entry["card"]["id"], "outcome": StoryletBundle.effective_game_id(outcome), "turn": new_turn}, new_turn)
	return ""


static var _change_target_re := RegEx.create_from_string("^@([a-z]+)\\.([A-Za-z_][A-Za-z0-9_-]*)$")


# Land one change; returns {"path", "prev"?} (the resolved store path for the
# trace and the value it replaced for the log's "0 -> 1" reading) or
# {"error": message}.
# Land one change in whichever partition declares the name: the flow's bag
# when the property is per-flow, the shared bag when it is shared.
func _land_in(kind: String, owner_id, name: String, value, path: String) -> Dictionary:
	var own = _stores["story"] if kind == "story" else _stores[kind].get(owner_id)
	var shared = _engine._shared["story"] if kind == "story" else _engine._shared[kind].get(owner_id)
	var bag = null
	if own != null and (own as StoryletPropertyBag).get_value(name) != null:
		bag = own
	elif shared != null and (shared as StoryletPropertyBag).get_value(name) != null:
		bag = shared
	if bag == null:
		return {"error": 'no property at "%s"' % path}
	return _land(bag, name, value, path)


func _apply_write(target: String, value, entry: Dictionary, hand_env: Dictionary) -> Dictionary:
	var m := _change_target_re.search(target)
	if m == null:
		return {"error": 'bad change target "%s"' % target}
	var scope := m.get_string(1)
	var name := m.get_string(2)
	match scope:
		"world":
			var setter = _engine._world.get("set")
			if setter == null:
				return {"error": "@world.%s cannot be written: the host bound @world read-only" % name}
			var prev = (_engine._world["get"] as Callable).call(name)
			(setter as Callable).call(name, value)
			var out := {"path": "world.%s" % name}
			if prev != null:
				out["prev"] = prev
			return out
		"story":
			return _land_in("story", null, name, value, "story.%s" % name)
		"box":
			return _land_in("box", entry["box"]["id"], name, value, "box.%s.%s" % [entry["box"]["id"], name])
		"deck":
			return _land_in("deck", entry["deck"]["id"], name, value, "deck.%s.%s" % [entry["deck"]["id"], name])
		"hand":
			# Write-back routing (schema 3.6): the composed name remembers its
			# source store; writes to criteria/chosen-tag names are errors.
			var source = hand_env["sources"].get(name)
			if source == null:
				return {"error": "@hand.%s is not composed in this ask" % name}
			if source["kind"] == "criteria":
				return {"error": "@hand.%s is a chosen tag / criteria name and cannot be written" % name}
			return _land_in(source["kind"], source["id"], name, value, "%s.%s.%s" % [source["kind"], source["id"], name])
	return {"error": 'bad change target scope "@%s"' % scope}


static func _land(bag: StoryletPropertyBag, name: String, value, path: String) -> Dictionary:
	# An engine write: the bag's subscribers fire (the firing rule).
	var change := bag.set_value(name, value)
	if change.has("error"):
		return {"error": change["error"]}
	var out := {"path": path}
	if change.has("prev"):
		out["prev"] = change["prev"]
	return out


## Advance one box's clock (schema 3.4): a turn is one draw-from-stock session
## for that box. An unknown box push_errors and does nothing.
func advance_turns(box_ref: String, n: float = 1.0) -> void:
	if _closed:
		push_error('StoryletFlow.advance_turns: flow "%s" is closed' % id)
		return
	var box = _engine._boxes_by_game_id.get(box_ref)
	if box == null:
		box = _engine._boxes_by_id.get(box_ref)
	if box == null:
		push_error('StoryletFlow.advance_turns: unknown box "%s"' % box_ref)
		return
	var next: float = float(_turn_counts.get(box["id"], 0.0)) + n
	_turn_counts[box["id"]] = next
	if _tracing():
		_emit({"type": "turns", "box": StoryletBundle.effective_game_id(box), "turn": next}, next)


# --- state access (host surface + test tooling) -----------------------------------

## Every box, bundle order: identity + THIS flow's clock (parity member).
func list_boxes() -> Array:
	var out: Array = []
	for b in _engine._bundle["boxes"]:
		var row := {"id": b["id"], "gameId": StoryletBundle.effective_game_id(b)}
		if b.has("title"):
			row["title"] = b["title"]
		row["turn"] = _turn_counts.get(b["id"], 0.0)
		out.append(row)
	return out


## THIS flow's kernel bags with their store path prefixes (the state
## logger's mount surface; parity member). The shared bags are the engine's
## list_bags; flows are rebuilt by load_game, so consumers re-enumerate.
func list_bags() -> Array:
	var mounts: Array = [{"prefix": "story", "bag": _stores["story"]}]
	for kind in ["box", "deck", "hand", "value"]:
		for owner_id in _stores[kind]:
			mounts.append({"prefix": "%s.%s" % [kind, owner_id], "bag": _stores[kind][owner_id]})
	return mounts


## The flow's FULL merged view as examiner rows: @world read through the
## engine's resolver, then per scope the shared values and this flow's own.
func list_properties() -> Array:
	var out: Array = []
	for d in _engine._bundle["world"].get("properties", []):
		var value = (_engine._world["get"] as Callable).call(d["name"])
		var row := {"path": "world.%s" % d["name"], "name": d["name"], "type": d.get("type", "string"),
			"value": value if value != null else d.get("default"), "default": d.get("default")}
		if d.has("values"):
			row["values"] = d["values"]
		if d.has("stages"):
			row["stages"] = d["stages"]
		out.append(row)
	StoryletEngine._add_rows(out, "story", _engine._shared["story"])
	StoryletEngine._add_rows(out, "story", _stores["story"])
	for kind in ["box", "deck", "hand", "value"]:
		var ids := {}
		for owner_id in _engine._shared[kind]:
			ids[owner_id] = true
		for owner_id in _stores[kind]:
			ids[owner_id] = true
		for owner_id in ids:
			var shared = _engine._shared[kind].get(owner_id)
			if shared != null:
				StoryletEngine._add_rows(out, "%s.%s" % [kind, owner_id], shared)
			var own = _stores[kind].get(owner_id)
			if own != null:
				StoryletEngine._add_rows(out, "%s.%s" % [kind, owner_id], own)
	return out


## Read by path: "world.x", "story.gold", "value.v_docks.danger", ... - the
## flow's merged view, routed by the declaration's sharing. Returns the
## value, or null (with push_error) on a bad path or undeclared property.
func get_property(path: String) -> Variant:
	if _closed:
		push_error('StoryletFlow.get_property: flow "%s" is closed' % id)
		return null
	var parts := path.split(".")
	var value = null
	if parts.size() == 2 and parts[0] == "world":
		value = (_engine._world["get"] as Callable).call(parts[1])
	elif parts.size() == 2 and parts[0] == "story":
		value = _read_story(parts[1])
	elif parts.size() == 3 and ["box", "deck", "hand", "value"].has(parts[0]):
		if _stores[parts[0]].get(parts[1]) == null and _engine._shared[parts[0]].get(parts[1]) == null:
			push_error('StoryletFlow.get_property: no %s store "%s"' % [parts[0], parts[1]])
			return null
		value = _read_pair(parts[0], parts[1], parts[2])
	else:
		push_error('StoryletFlow.get_property: bad property path "%s"' % path)
		return null
	if value == null:
		push_error('StoryletFlow.get_property: no property at "%s"' % path)
		return null
	return value


## Write by path. A host write: silent under the firing rule, visible to
## the bag's audit hook. Returns "" or the error message (with push_error).
func set_property(path: String, value) -> String:
	if _closed:
		var closed_msg := 'flow "%s" is closed' % id
		push_error("StoryletFlow.set_property: " + closed_msg)
		return closed_msg
	var parts := path.split(".")
	if parts.size() == 2 and parts[0] == "world":
		var setter = _engine._world.get("set")
		if setter == null:
			var msg := "@world is read-only here: the host bound no write"
			push_error("StoryletFlow.set_property: " + msg)
			return msg
		(setter as Callable).call(parts[1], value)
		return ""
	var kind := ""
	var owner_id = null
	var name := ""
	if parts.size() == 2 and parts[0] == "story":
		kind = "story"
		name = parts[1]
	elif parts.size() == 3 and ["box", "deck", "hand", "value"].has(parts[0]):
		kind = parts[0]
		owner_id = parts[1]
		name = parts[2]
	else:
		var bad := 'bad property path "%s"' % path
		push_error("StoryletFlow.set_property: " + bad)
		return bad
	var own = _stores["story"] if kind == "story" else _stores[kind].get(owner_id)
	var shared = _engine._shared["story"] if kind == "story" else _engine._shared[kind].get(owner_id)
	if own == null and shared == null:
		var missing := 'no %s store "%s"' % [kind, str(owner_id)]
		push_error("StoryletFlow.set_property: " + missing)
		return missing
	var bag = null
	if own != null and (own as StoryletPropertyBag).get_value(name) != null:
		bag = own
	elif shared != null and (shared as StoryletPropertyBag).get_value(name) != null:
		bag = shared
	if bag == null:
		var none := 'no property at "%s"' % path
		push_error("StoryletFlow.set_property: " + none)
		return none
	var change: Dictionary = (bag as StoryletPropertyBag).set_value(name, value, {"silent": true, "reason": "host setProperty"})
	if change.has("error"):
		return change["error"]
	return ""


# _bind_state_groups reads world/story through this (a diagnostic path, so
# it must not push_error on a missing name).
func _resolve_path(path: String) -> Dictionary:
	var parts := path.split(".")
	if parts.size() == 2 and parts[0] == "world":
		var wv = (_engine._world["get"] as Callable).call(parts[1])
		if wv == null:
			return {"error": 'no property at "%s"' % path}
		return {"value": wv}
	if parts.size() == 2 and parts[0] == "story":
		var sv = _read_story(parts[1])
		if sv == null:
			return {"error": 'no property at "%s"' % path}
		return {"value": sv}
	return {"error": 'bad property path "%s"' % path}


# --- persistence (schema 4) ---------------------------------------------------------

## @internal - this flow's blob inside the engine's envelope, deep-copied.
func snapshot() -> Dictionary:
	var props := {"story": (_stores["story"] as StoryletPropertyBag).save(),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	for kind in ["box", "deck", "hand", "value"]:
		for owner_id in _stores[kind]:
			props[kind][owner_id] = (_stores[kind][owner_id] as StoryletPropertyBag).save()
	return {
		"props": props,
		"turns": _turn_counts.duplicate(true),
		"prng": _prng.state(),
		"cooldowns": _cooldowns.duplicate(true),
		"board": _board_contents.duplicate(true),
		"playLog": _play_log.duplicate(true),
	}


## @internal - restore a freshly opened flow from its blob (load_game).
## Orphaned keys (deleted entities) drop; new declarations keep defaults.
func restore(saved: Dictionary) -> void:
	var props: Dictionary = saved.get("props", {})
	(_stores["story"] as StoryletPropertyBag).load(props.get("story", {}))
	for kind in ["box", "deck", "hand", "value"]:
		var kept: Dictionary = props.get(kind, {})
		for owner_id in kept:
			var bag = _stores[kind].get(owner_id)
			if bag != null:
				(bag as StoryletPropertyBag).load(kept[owner_id])
	_turn_counts = {}
	for b in _engine._bundle["boxes"]:
		_turn_counts[b["id"]] = 0.0
	for box_id in saved.get("turns", {}):
		if _turn_counts.has(box_id):
			_turn_counts[box_id] = float(saved["turns"][box_id])
	_prng = StoryletMulberry32.new(int(saved.get("prng", 0)))
	_cooldowns = {}
	for card_id in saved.get("cooldowns", {}):
		_cooldowns[card_id] = float(saved["cooldowns"][card_id])
	_play_log = []
	for record in saved.get("playLog", []):
		_play_log.append({"card": str(record["card"]), "outcome": str(record["outcome"]), "turn": float(record["turn"])})
	_rebuild_play_index()
	_board_contents = {}
	for hand_id in saved.get("board", {}):
		if not _engine._hands_by_id.has(hand_id):
			continue
		var kept_cards: Array = []
		for cid in saved["board"][hand_id]:
			if _engine._cards_by_id.has(cid):
				kept_cards.append(cid)
		_board_contents[hand_id] = kept_cards
	for hand_id in _engine._hands_by_id:
		if not _board_contents.has(hand_id):
			_board_contents[hand_id] = []
