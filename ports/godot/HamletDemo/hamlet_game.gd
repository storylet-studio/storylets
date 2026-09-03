# The Hamlet, the game part, with no UI in it: the same shape as the JS client's
# main.ts + performance.ts + world.ts, so the two can be read side by side.
#
#   the Storylet Engine decides WHICH beat happens, and when
#   Patter performs that beat's dialogue
#   this class owns @world, and hands the SAME resolver to both
#
# Neither engine is told the other exists. What joins them is a naming
# convention (a card's gameId is its scene id; an outcome's gameId is what the
# scene reports in a gameEvent's gameData.outcome) and the world dictionary.
class_name HamletGame

const SEED := 7
const FLOW := "main"
const PERFORMANCE := "performance"

var world := {"time_of_day": "day", "knows_road": false}
## The GAME's policy, as opposed to either story's promise: names nothing but
## the host may move. A story that tries is refused loudly.
var read_only := ["time_of_day"]

var story_engine: StoryletEngine
var story: StoryletFlow
var patter: PatterEngine
var places: Array = []           # [{gameId, title}]
var at: String = ""              # the hand the player stands at, "" = nowhere
## The card being performed, and the flow performing it. null when at the hand.
var playing = null               # {card, flow, shown: Array, choices: Array, outcome: String}
var log: Array = []

func _resolver() -> Dictionary:
	return {
		"get": func(n: String): return world.get(n),
		"set": func(n: String, v) -> void:
			if read_only.has(n):
				push_error("@world.%s is the game's alone: a story tried to set it" % n); return
			world[n] = v,
	}

func setup(storylet_bundle: Dictionary, patter_bundle: Dictionary) -> void:
	# ONE resolver, handed to BOTH. Not two copies kept in step: two copies kept
	# in step is the bug this design exists to make impossible.
	var resolver := _resolver()
	story_engine = StoryletEngine.create(storylet_bundle, {"seed": SEED, "world": resolver})
	# Patter's Godot addon takes the host resolver under "host_scopes", keyed by
	# scope token; its JS runtime, and our addon here, take "world". Same
	# resolver, two option names (findings 10).
	patter = PatterEngine.new(patter_bundle, {"host_scopes": {"world": resolver}})
	story = story_engine.open_flow(FLOW)
	places = []
	for h in storylet_bundle["boxes"][0].get("hands", []):
		places.append({"gameId": h["gameId"], "title": h.get("title", h["gameId"])})
	story.deal_many()

# --- the loop ---------------------------------------------------------------

## Arrive somewhere. A place is a HAND, so arriving means dealing it.
func go(place: String) -> void:
	at = place; playing = null
	if place != "": story.deal(place)

func hand() -> Array:
	return story.deal(at) if at != "" else []

## Pick a card: the storylet side has chosen the beat, so Patter performs it.
## The scene is found BY NAME, the card's own gameId.
func start(card: Dictionary) -> void:
	var flow := patter.open_flow(PERFORMANCE, card["gameId"])
	playing = {"card": card, "flow": flow, "shown": [], "choices": [], "outcome": ""}
	_run()

func choose(option_id: String) -> void:
	if playing == null: return
	playing["flow"].choose(option_id); playing["choices"] = []
	_run()

## Patter's step loop, the ordinary one. The only unusual line is what it does
## with a gameEvent: that is the scene saying which outcome it reached.
func _run() -> void:
	var flow: PatterFlow = playing["flow"]
	for _guard in range(500):
		var step: Dictionary = flow.advance()
		match step.get("type", "end"):
			"line": playing["shown"].append({"kind": "line", "character": str(step.get("characterName", step.get("character", ""))), "text": str(step.get("text", ""))})
			"text": playing["shown"].append({"kind": "text", "text": str(step.get("text", ""))})
			"gameEvent":
				var o = step.get("gameData", {}).get("outcome", null)
				if o != null: playing["outcome"] = str(o)
			"choice":
				for opt in step.get("options", []):
					if opt.get("eligible", true):
						playing["choices"].append({"id": opt["id"], "text": str(opt.get("text", opt["id"]))})
				return
			_:
				_finish(); return

## The scene ended and reported an outcome; THAT is what the storylet engine
## plays. The world moves because of what was said in dialogue.
func _finish() -> void:
	var card: Dictionary = playing["card"]
	var outcome: String = playing["outcome"]
	if outcome == "":
		push_error('scene "%s" ended without reporting an outcome' % card["gameId"]); playing = null; return
	var err := story.play(card["id"], outcome, at)
	if err != "": push_error(err)
	log.push_front("%s: %s" % [card.get("title", card["gameId"]), outcome])
	playing = null
	# Re-prime EVERYWHERE: the outcome's changes, or anything the scene wrote to
	# @world, may have re-gated content elsewhere. A refresh evicts what is no
	# longer eligible and fills EMPTY slots; a still-eligible card keeps its seat.
	story.deal_many()

## Time passes. The world is the host's, so this is the host's to change.
func wait() -> void:
	world["time_of_day"] = "night" if world["time_of_day"] == "day" else "day"
	story.advance_turns(story.list_boxes()[0]["gameId"], 1)
	story.deal_many()

# --- one envelope, both engines, the world once ----------------------------
# The same shape as the JS client writes, key for key, so a save from either
# host loads in the other: the storylet half as the .storyletsave TEXT, Patter's
# as its save dictionary, the world once (neither engine puts it in its own).

func save() -> Dictionary:
	var env := {
		"storylets": StoryletSave.serialize_state(story_engine),
		"patter": PatterSave.serialize_state(patter),   # Patter's own patter/save@0 text, as ours is a .storyletsave text
		"world": world.duplicate(),
		"at": at,
		"performing": null,
	}
	if playing != null:
		env["performing"] = {"card": {"id": playing["card"]["id"], "gameId": playing["card"]["gameId"], "title": playing["card"].get("title", "")},
			"shown": playing["shown"], "outcome": playing["outcome"]}
	return env

func load(env: Dictionary) -> bool:
	world = env.get("world", world).duplicate()
	if StoryletSave.deserialize_state(story_engine, str(env["storylets"])) == null and not env.has("storylets"): return false
	var pt = env["patter"]
	var patter_ok := PatterSave.deserialize_state(patter, pt) if pt is String else true
	if not (pt is String): patter.load_game(pt)
	if not patter_ok:
		push_error("Patter's half of the envelope did not load (PatterSave.deserialize_state refused it)"); return false
	# A LOAD REBUILDS THE FLOWS, and open_flow on an id that exists REPLACES it,
	# hand and all. get_flow is the call. (The JS client fell into this.)
	story = story_engine.get_flow(FLOW)
	if story == null: return false
	at = str(env.get("at", ""))
	var p = env.get("performing", null)
	if p != null:
		var flow := patter.get_flow(PERFORMANCE)
		if flow == null:
			push_error("the envelope says a scene was in flight, and Patter's half did not restore it: this save's Patter part is not in the shape this addon loads")
			return false
		if flow != null:
			var choices: Array = []
			for opt in flow.get_choices():
				if opt.get("eligible", true): choices.append({"id": opt["id"], "text": str(opt.get("text", opt["id"]))})
			playing = {"card": p["card"], "flow": flow, "shown": p.get("shown", []), "choices": choices, "outcome": str(p.get("outcome", ""))}
	return true

func world_line() -> String:
	var parts := []
	for k in world.keys():
		var v = world[k]
		if v is bool: (parts.append(k) if v else null)
		else: parts.append(str(v))
	return " · ".join(parts)
