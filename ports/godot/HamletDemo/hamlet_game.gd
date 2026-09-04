# The Hamlet, the game part, with no UI in it: the same shape as the JS client's
# main.ts + performance.ts + world.ts, so the two can be read side by side.
#
#   the Storylet Engine decides WHICH beat happens, and when
#   Patter performs that beat's dialogue
#   this class owns @world, and hands the SAME resolver to both
#
# Neither engine is told the other exists. What joins them is a naming
# convention (a card's gameId is its scene id; an outcome's gameId is what its
# scene names, on the option taken or in a gameEvent, with a single-outcome card
# needing neither) and the world dictionary.
class_name HamletGame

const SEED := 7
const FLOW := "main"
## The box this host performs through Patter, and the name of its ONE Patter flow:
## opened once, found again after a load, entered per card with goto. Never re-opened,
## so the flow's visit counts, shuffle cursors and PRNG carry on between performances.
const BOX := "village"

var world := {"time_of_day": "day", "knows_road": false}
## The GAME's policy, as opposed to either story's promise: names nothing but
## the host may move. A story that tries is refused loudly.
var performance: PatterFlow
var read_only: Array[String] = []   # nothing read-only: both projects let a scene or a card move time

var story_engine: StoryletEngine
var story: StoryletFlow
var patter: PatterEngine
var places: Array = []           # [{gameId, title}]
var at: String = ""              # the hand the player stands at, "" = nowhere
## The card being performed, and the flow performing it. null when at the hand.
var playing = null               # {card, flow, shown, choices, outcome, labelled, done}
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
	performance = patter.open_flow(BOX)
	places = []
	for h in storylet_bundle["boxes"][0].get("hands", []):
		places.append({"gameId": h["gameId"], "title": h.get("title", h["gameId"])})
	story.deal_many()
	# Open where there is something to do: the first hand that deals a card. The
	# project does not order its hands for this (the demo opens with one card, at
	# the gate), so the host looks rather than guessing a place.
	for p in places:
		if story.deal(p["gameId"]).size() > 0:
			at = p["gameId"]
			break

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
	if not performance.goto(card["gameId"]): push_error("no Patter scene " + str(card["gameId"])); return
	playing = {"card": card, "flow": performance, "shown": [], "choices": [], "outcome": "", "labelled": "", "done": false}
	_run()

func choose(option_id: String) -> void:
	if playing == null: return
	# The label rides with the option, so it is taken HERE, while the host still
	# knows which option was clicked. By the end of the branch it is gone.
	for ch in playing["choices"]:
		if ch["id"] == option_id and str(ch.get("outcome", "")) != "": playing["labelled"] = str(ch["outcome"])
	playing["flow"].choose(option_id); playing["choices"] = []
	_run()

## The outcome ids the storylet side will accept for this card RIGHT NOW.
## Read afresh at every stop: a scene can write @world mid-performance and
## change what is open under itself.
func _open_outcomes() -> Dictionary:
	var open := {}
	for o in story.outcomes(playing["card"]["id"], at):
		if o.get("available", true): open[str(o["gameId"])] = true
	return open

## The choices a step offers, with BOTH engines' gates applied. Patter says
## whether the option can be offered at all; the Storylet Engine says whether
## the outcome it leads to is open. Clickable only when both agree.
func _choices_from(options: Array) -> Array:
	var open := _open_outcomes()
	var out: Array = []
	for opt in options:
		var outcome := str(opt.get("gameData", {}).get("outcome", ""))
		var shut := outcome != "" and not open.has(outcome)
		var eligible: bool = opt.get("eligible", true)
		out.append({"id": opt["id"], "text": str(opt.get("text", opt["id"])), "outcome": outcome,
			"enabled": eligible and not shut,
			"why": ("not available here" if not eligible else ("requirements not met" if shut else ""))})
	return out

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
				playing["choices"] = _choices_from(step.get("options", []))
				return
			_:
				# The scene has ENDED but its outcome is not played yet: its closing
				# lines, and the whole of a scene with no choice, would vanish under
				# the redeal before anyone read them. The player presses Continue.
				playing["done"] = true
				return

## The scene ended and reported an outcome; THAT is what the storylet engine
## plays. The world moves because of what was said in dialogue.
## An explicit gameEvent, else the option the player took, else the card's only
## outcome. Loud when none of the three answers: guessing would move the world
## the wrong way, and the build catches this shape first (scripts/pairing.mjs).
func _resolve_outcome() -> String:
	if str(playing["outcome"]) != "": return str(playing["outcome"])
	if str(playing["labelled"]) != "": return str(playing["labelled"])
	var declared: Array = []
	for o in story.outcomes(playing["card"]["id"], at): declared.append(str(o["gameId"]))
	if declared.size() == 1: return declared[0]
	push_error('scene "%s" ended without saying which outcome it reached, and its card declares %d (%s)'
		% [playing["card"]["gameId"], declared.size(), ", ".join(declared)])
	return ""

## Called by the UI's Continue button, once the player has read what the scene said.
func finish() -> void:
	var card: Dictionary = playing["card"]
	var outcome: String = _resolve_outcome()
	if outcome == "":
		playing = null; return
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
			"shown": playing["shown"], "outcome": playing["outcome"], "labelled": playing["labelled"], "done": playing["done"]}
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
	performance = patter.get_flow(BOX)
	if performance == null:
		push_error("the save has no \"" + BOX + "\" Patter flow: this save's Patter part is not in the shape this addon loads"); return false
	at = str(env.get("at", ""))
	var p = env.get("performing", null)
	if p != null:
		var flow := performance
		if flow != null:
			playing = {"card": p["card"], "flow": flow, "shown": p.get("shown", []), "choices": [],
				"outcome": str(p.get("outcome", "")), "labelled": str(p.get("labelled", "")), "done": bool(p.get("done", false))}
			# A scene that had ended and not been continued needs nothing from Patter:
			# the transcript and the outcome are the envelope's, and Continue is waiting.
			if not playing["done"]:
				playing["choices"] = _choices_from(flow.get_choices())
	return true

func world_line() -> String:
	var parts := []
	for k in world.keys():
		var v = world[k]
		if v is bool: (parts.append(k) if v else null)
		else: parts.append(str(v))
	return " · ".join(parts)
