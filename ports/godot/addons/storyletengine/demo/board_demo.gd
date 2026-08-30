# The Godot Board demo: the village dealt onto a board you can actually play.
# Mirrors the Unity / Unreal / JS Board demos beat for beat: the same header
# line, the same hands, the same three controls (Deal all hands, Next turn,
# Restart) and the same transcript grammar, so the four demos read as one demo
# in four idioms.
#
# The board IS the loop: deal every hand, click a card to see its outcomes,
# play one, watch the box clocks move. The smallest possible integration is
# the top of _ready() plus _on_deal_all_hands(): load the bundle, create a
# session, deal, read board(). Everything else here is the UI around it.
#
# The bundle ships INSIDE the addon (demo/the-hamlet.storyletsc), so the demo
# runs straight from the downloaded zip. The session is created with the log
# option and registered with StoryletDebug under "board demo", so the
# StoryletStatePanel in this scene fills with properties, clocks and log lines
# as you play.
#
# It also carries a StoryletLiveLink (debug builds only; inert without an
# editor): with Play > Live Link on in Storyletter, the editor's Board shows
# this demo's run, and saving in the editor pushes the new bundle in here
# (_on_bundle_pushed swaps it under the run and re-binds the session).
#
# Open addons/storyletengine/demo/board_demo.tscn and press Play (F6 with the
# scene focused). Delete the demo folder freely.
extends Control

const BUNDLE_PATH := "res://addons/storyletengine/demo/the-hamlet.storyletsc"
const SEED := 7
const NOTHING := "(nothing here right now)"

var _bundle: Dictionary
var _engine: StoryletEngine
var _session: StoryletFlow
var _link: StoryletLiveLink
# Hand gameId (what board() keys on) -> the name we show: title, else gameId.
var _hand_names: Dictionary = {}
# The one open card, if any: only ever one at a time.
var _open_hand := ""
var _open_card := ""

@onready var _header: Label = $Layout/Header
@onready var _board: VBoxContainer = $Layout/BoardScroll/Board
@onready var _transcript: VBoxContainer = $Layout/TranscriptScroll/Transcript
@onready var _transcript_scroll: ScrollContainer = $Layout/TranscriptScroll


func _ready() -> void:
	var text := FileAccess.get_file_as_string(BUNDLE_PATH)
	if text == "":
		push_error("board demo: cannot read " + BUNDLE_PATH)
		return
	var loaded := StoryletBundle.load_from_string(text)
	if not loaded["ok"]:
		push_error("board demo: " + loaded["error"])
		return
	_bundle = loaded["bundle"]
	_name_hands()

	$Layout/Controls/DealAllHands.pressed.connect(_on_deal_all_hands)
	$Layout/Controls/NextTurn.pressed.connect(_on_next_turn)
	$Layout/Controls/Restart.pressed.connect(_on_restart)

	# The Live Link, before the session so the first deal reaches the editor.
	# A debug build opens it; a missing editor is a silent no-op.
	var content: Dictionary = _bundle["content"]
	_link = StoryletLiveLink.new(str(content["hash"]), "%s %s" % [content["project"], content["version"]])
	_link.bundle_pushed.connect(_on_bundle_pushed)
	add_child(_link)
	StoryletDebug.register_link(_link)   # the state panel shows where the link is

	_open_session()
	# The board opens dealt: the first hands are already out, so there is
	# something to read and play the moment the demo starts.
	_on_deal_all_hands()


func _exit_tree() -> void:
	_close_session()


# -- the session ------------------------------------------------------------------

func _open_session() -> void:
	# Seed 7 and the retained log on, so the examiner's log panel fills as you play.
	_engine = StoryletEngine.create(_bundle, {"seed": SEED, "log": true})
	_session = _engine.open_flow("main")
	_bind_session()


func _close_session() -> void:
	if _session != null:
		_link.detach()
		StoryletDebug.unregister(_engine)
		_session = null
		_engine = null


# Everything that holds the session: the state panel's registry and the link.
func _bind_session() -> void:
	StoryletDebug.register(_engine, "board demo")   # the state panel finds it here
	_link.attach(_engine)                             # the editor's Board follows its flows


# board() and deal_many() key on hand gameIds; the board shows names.
func _name_hands() -> void:
	_hand_names.clear()
	for box in _bundle["boxes"]:
		for hand in box["hands"]:
			_hand_names[StoryletBundle.effective_game_id(hand)] = _display(hand)


# Live refresh: Storyletter saved and pushed the new bundle. Swap it in under
# the run (a new session carrying the old one's save), re-bind everything that
# held the old session or bundle, then tell the editor which build runs now.
func _on_bundle_pushed(build: String, data: String) -> void:
	var r := StoryletLiveLink.apply_live_bundle(_engine, data, {"seed": SEED, "log": true})
	if not r["ok"]:
		_append("! live link: " + str(r["error"]))   # bad JSON, another project: keep the run we have
		return
StoryletDebug.unregister_link(_link)
		StoryletDebug.unregister(_engine)
	_bundle = r["bundle"]
	_engine = r["engine"]
	_session = _engine.get_flow("main")
	if _session == null:
		_session = _engine.open_flow("main")
	_name_hands()
	_bind_session()
	_link.set_build(build)
	_append("live link: build %s applied, the run carried across" % build)
	_collapse()
	_refresh()


# -- the controls -----------------------------------------------------------------

func _on_deal_all_hands() -> void:
	# One call deals every hand; the returned slice is exactly what it dealt.
	var dealt := _session.deal_many()
	for hand_game_id in dealt:
		var names: Array = []
		for card in dealt[hand_game_id]:
			names.append(_display(card))
		_append("dealt: %s <- %s" % [
			_hand_names.get(hand_game_id, hand_game_id),
			", ".join(names) if not names.is_empty() else NOTHING,
		])
	_collapse()
	_refresh()


# The world moved, so the board does too: re-deal every hand, which fills the
# slots a play emptied and drops any card the new state invalidated. Silently,
# on purpose: the transcript keeps the beats you caused, and the arrivals and
# departures are already in the state panel's log.
func _refill() -> void:
	_session.deal_many()
	_refresh()


func _on_next_turn() -> void:
	# Every box keeps its own clock, so a turn is advanced box by box.
	for box in _session.list_boxes():
		_session.advance_turns(box["gameId"], 1.0)
		_append("turn %s -> %s" % [_display(box), StoryletValues.js_number(_session.turn(box["gameId"]))])
	_refill()   # time passed: cooldowns lapse, so the hands refresh too


func _on_restart() -> void:
	_close_session()
	_open_session()
	_clear(_transcript)
	_append("restarted (seed %d)" % SEED)
	_collapse()
	_on_deal_all_hands()   # a restart deals too, so the board is never empty


func _on_card_pressed(hand_game_id: String, card_id: String) -> void:
	# Only one card is open at a time: the same card closes, another moves.
	if _open_hand == hand_game_id and _open_card == card_id:
		_collapse()
	else:
		_open_hand = hand_game_id
		_open_card = card_id
	_refresh_board()


func _on_outcome_pressed(hand_game_id: String, card: Dictionary, outcome: Dictionary) -> void:
	# play() is the only mutating verb: it applies the changes, logs the play,
	# takes the card out of its hand and advances that box's clock.
	var err := _session.play(card["id"], outcome["gameId"], hand_game_id)
	if err != "":
		_append("! " + err)
		return
	_append('played "%s" -> %s' % [_display(card), _display(outcome)])
	_collapse()
	_refill()


# -- the view ---------------------------------------------------------------------

func _refresh() -> void:
	_refresh_header()
	_refresh_board()


func _refresh_header() -> void:
	var content: Dictionary = _bundle["content"]
	var clocks: Array = []
	for box in _session.list_boxes():
		clocks.append("%s turn %s" % [_display(box), StoryletValues.js_number(box["turn"])])
	_header.text = "%s %s - %s" % [content["project"], content["version"], ", ".join(clocks)]


func _refresh_board() -> void:
	_clear(_board)
	var the_board := _session.board()
	for hand_game_id in the_board:
		var group := VBoxContainer.new()
		var label := Label.new()
		label.text = _hand_names.get(hand_game_id, hand_game_id)
		group.add_child(label)
		var cards: Array = the_board[hand_game_id]
		if cards.is_empty():
			var empty := Label.new()
			empty.text = NOTHING
			group.add_child(empty)
		for card in cards:
			var button := Button.new()
			button.text = _display(card)
			button.pressed.connect(_on_card_pressed.bind(hand_game_id, card["id"]))
			group.add_child(button)
			if hand_game_id == _open_hand and card["id"] == _open_card:
				group.add_child(_outcomes_block(hand_game_id, card))
		_board.add_child(group)


# The open card's outcomes, indented beneath it. Availability is asked fresh
# every time (the engine never snapshots it): unavailable outcomes stay on
# show, disabled and marked, so the player can see what is out of reach.
func _outcomes_block(hand_game_id: String, card: Dictionary) -> MarginContainer:
	var indent := MarginContainer.new()
	indent.add_theme_constant_override("margin_left", 24)
	var column := VBoxContainer.new()
	for outcome in _session.outcomes(card["id"], hand_game_id):
		var button := Button.new()
		if outcome["available"]:
			button.text = _display(outcome)
			button.pressed.connect(_on_outcome_pressed.bind(hand_game_id, card, outcome))
		else:
			button.text = _display(outcome) + " (locked)"
			button.disabled = true
		column.add_child(button)
	indent.add_child(column)
	return indent


func _append(line: String) -> void:
	var label := Label.new()
	label.text = line
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_transcript.add_child(label)
	# Deferred: the scroll range only grows once the new label has been laid out.
	_transcript_scroll.set_deferred("scroll_vertical", 1 << 30)


func _collapse() -> void:
	_open_hand = ""
	_open_card = ""


# remove_child before queue_free, so a rebuild in the same frame sees an empty
# container rather than the children waiting to die.
static func _clear(container: Node) -> void:
	for child in container.get_children():
		container.remove_child(child)
		child.queue_free()


# Boxes, hands, cards and outcomes are all shown by title, falling back to the
# gameId. Never the internal id: that is bookkeeping, not a name.
static func _display(entity: Dictionary) -> String:
	var title := str(entity.get("title", "")).strip_edges()
	if title != "":
		return title
	return StoryletBundle.effective_game_id(entity)
