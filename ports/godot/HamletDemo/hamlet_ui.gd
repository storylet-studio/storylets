# The Hamlet's screen: places across the top, the stage in the middle (the hand,
# or the conversation), a footer. Built in code so it reads as source. All the
# game is HamletGame; this only draws it and forwards clicks.
extends Control

const SAVE_PATH := "user://hamlet-save.json"
var game := HamletGame.new()
var header: Label; var places: HBoxContainer; var stage: VBoxContainer; var log_label: Label

func _ready() -> void:
	var sb := StoryletBundle.load_from_string(FileAccess.get_file_as_string("res://hamlet.storyletsc"))
	var pb = PatterBundle.load_from_string(FileAccess.get_file_as_string("res://hamlet.patterc"))
	game.setup(sb["bundle"], pb)
	var root := VBoxContainer.new(); root.anchors_preset = Control.PRESET_FULL_RECT
	root.add_theme_constant_override("separation", 12); add_child(root)
	var title := Label.new(); title.text = "The Hamlet"; title.add_theme_font_size_override("font_size", 28); root.add_child(title)
	header = Label.new(); root.add_child(header)
	places = HBoxContainer.new(); root.add_child(places)
	stage = VBoxContainer.new(); stage.size_flags_vertical = Control.SIZE_EXPAND_FILL; root.add_child(stage)
	var footer := HBoxContainer.new(); root.add_child(footer)
	_button(footer, "Let time pass", func(): game.wait(); _save(); _render())
	_button(footer, "Step outside", func(): game.go(""); _save(); _render())
	_button(footer, "Restart", func(): DirAccess.remove_absolute(SAVE_PATH); get_tree().reload_current_scene())
	log_label = Label.new(); log_label.modulate.a = 0.7; root.add_child(log_label)
	_load(); _render()

func _button(parent: Control, text: String, on_press: Callable) -> Button:
	var b := Button.new(); b.text = text; b.pressed.connect(on_press); parent.add_child(b); return b

func _render() -> void:
	header.text = "The Storylet Engine chooses the beat. Patter performs it.    " + game.world_line()
	for c in places.get_children(): c.queue_free()
	for p in game.places:
		var b := _button(places, p["title"], func(): game.go(p["gameId"]); _save(); _render())
		if p["gameId"] == game.at: b.disabled = true
	for c in stage.get_children(): c.queue_free()
	if game.playing != null:
		for s in game.playing["shown"]:
			var l := Label.new(); l.autowrap_mode = TextServer.AUTOWRAP_WORD
			l.text = ("%s: %s" % [s["character"], s["text"]]) if s["kind"] == "line" else s["text"]; stage.add_child(l)
		for ch in game.playing["choices"]:
			_button(stage, ch["text"], func(): game.choose(ch["id"]); _save(); _render())
	elif game.at == "":
		var l := Label.new(); l.text = "Choose somewhere to be."; stage.add_child(l)
	else:
		var cards := game.hand()
		if cards.is_empty():
			var l := Label.new(); l.text = "Nothing here just now."; stage.add_child(l)
		for card in cards:
			_button(stage, card.get("title", card["gameId"]), func(): game.start(card); _save(); _render())
	log_label.text = "\n".join(game.log.slice(0, 6))

func _save() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f: f.store_string(JSON.stringify(game.save())); f.close()

func _load() -> void:
	if not FileAccess.file_exists(SAVE_PATH): return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if typeof(parsed) == TYPE_DICTIONARY and not game.load(parsed): DirAccess.remove_absolute(SAVE_PATH)
