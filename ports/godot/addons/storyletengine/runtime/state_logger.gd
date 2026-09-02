@tool   # editor-reachable, like the shared source it wraps
# StoryletStateLogger - this addon's NAME for the shared state logger, plus the two
# storylets-shaped pieces the kernel asks for.
#
# The core is expr/ports/godot/state_logger.gd, vendored beside this file as
# runtime/expr/state_logger.gd and shared with Patterplay: push-based property logging on
# the PropertyBag audit hook, a diff for everything without one, and the re-mount that
# survives a load. It declares no `class_name`, because Godot registers those PROJECT-WIDE
# and two addons vendoring one file cannot both claim the name - so identity lives here,
# exactly as it does for the bag and the evaluator.
#
# What is storylets' own and stays here: the flattened path scheme
#   world.x / story.x / box.<id>.x / deck.<id>.x / hand.<id>.x / value.<id>.x
#   turn:<boxId>      per-box clocks
#   cooldown:<cardId> next-eligible turns
#   board:<handId>    hand contents (card ids, dealt order)
# snapshot_state (one flow's view off the save envelope) and the create_state_logger
# factory that mounts the engine's bags and one flow's own.
class_name StoryletStateLogger
extends "res://addons/storyletengine/runtime/expr/state_logger.gd"


## The full flattened snapshot of ONE FLOW's view - the shared partitions plus that flow's
## own - straight off the save envelope, so "what the snapshot sees" is by construction
## "what a save persists". @world is not here for the same reason it is not in the envelope:
## the host owns that container and mounts/saves it itself.
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
