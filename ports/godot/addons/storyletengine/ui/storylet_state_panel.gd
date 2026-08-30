# StoryletStatePanel - the in-game property examiner + editor (the parity
# examiner surface, design/engine-runtimes.md 2.4, in Godot's idiom: the game
# runs in its own process, so live inspection lives in the running game, not
# an editor dock).
#
# Watches AND edits a live session's declared properties during play (with a
# name/path filter over the rows), shows each box's clock and the board's
# current hands (read-only, keyed by title or gameId, never internal ids),
# and saves / loads the whole run to a .storyletsave file through
# StoryletSave.
#
# The log panel (design 2.3: the session's retained log surfaced in every
# examiner; the old port's Unreal log panel is the high-water mark): the
# lines of session.log() behind per-kind filters (a peek files under Deal -
# both are asks), with Autoscroll, Copy and Clear. Empty until the session
# is created with the log option ({"log": true}).
#
# Usage - drop it into your scene and point it at sessions:
#   var panel := preload("res://addons/storyletengine/ui/storylet_state_panel.gd").new()
#   add_child(panel)
#   StoryletDebug.register(engine, "main")   # the panel auto-discovers
# or assign panel.engine directly for a single engine.
class_name StoryletStatePanel
extends PanelContainer

## Optional single engine to inspect. If null, the panel shows every
## StoryletDebug-registered engine. Its open flows are read from it, so a
## flow opened later appears here on its own.
var engine: StoryletEngine = null

## Debug-only tool (default): inert in a release export (hidden, no rows, no
## timer), so it is safe to leave wired into a scene that ships. Set false to
## allow the panel in release builds (e.g. a player-facing sandbox).
@export var debug_only := true

const REFRESH_SECONDS := 0.25   # ~4 Hz

const LOG_KINDS := ["deal", "play", "write", "evict", "turns", "diagnostic"]
const LOG_KIND_LABELS := ["Deal", "Play", "Write", "Evict", "Turns", "Diag"]

var _body: VBoxContainer
var _filter := ""
var _signature := ""
# of {"widget", "type", "session", "path", "default", "reset"}
var _value_widgets: Array = []
# of {"label", "session"} - the read-only turns/board text blocks
var _live_labels: Array = []
# The log panel's state: kind filters and autoscroll are panel-wide (they
# survive rebuilds); each session gets a view {"session", "label", "scroll",
# "last_seq"}.
var _log_kind_on := {}
var _log_autoscroll := true
var _log_views: Array = []


func _ready() -> void:
	if debug_only and not OS.is_debug_build():
		hide()
		return
	custom_minimum_size = Vector2(380, 300)
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(column)
	# The property filter (name/path substring, case-blind - the parity
	# member Unreal renders as an SSearchBox). It lives above the rebuilt
	# body, so typing in it survives every rebuild.
	var filter := LineEdit.new()
	filter.placeholder_text = "Filter properties"
	filter.clear_button_enabled = true
	filter.text_changed.connect(_on_filter_changed)
	column.add_child(filter)
	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(scroll)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_body)

	var timer := Timer.new()
	timer.wait_time = REFRESH_SECONDS
	timer.autostart = true
	timer.timeout.connect(_tick)
	add_child(timer)
	StoryletDebug.bus.changed.connect(_rebuild)
	_rebuild()


func _entries() -> Array:
	if engine != null:
		return [{"engine": engine, "label": ""}]
	return StoryletDebug.list()


# A cheap fingerprint of "which sessions, with which property paths" - rebuild
# the rows only when it changes, so editing a field is not interrupted by the
# refresh timer.
func _current_signature() -> String:
	var parts: Array = []
	for e in _entries():
		parts.append(str(e["engine"].get_instance_id()))
		for f in e["engine"].flows():
			parts.append(str(f.get_instance_id()))
			for row in f.list_properties():
				parts.append(row["path"])
	return "|".join(parts)


func _tick() -> void:
	var sig := _current_signature()
	if sig != _signature:
		_rebuild()
	else:
		_refresh_values()


# -- build -----------------------------------------------------------------------

func _rebuild() -> void:
	if _body == null:
		return
	_signature = _current_signature()
	_value_widgets.clear()
	_live_labels.clear()
	_log_views.clear()
	for child in _body.get_children():
		child.queue_free()

	# Where the Live Link is, when the game registered one: the same line the
	# Unity examiner has shown since the link landed, so a host can tell "the
	# editor is not listening" from "I never attached" in any engine.
	var link = StoryletDebug.link
	if link != null:
		var state: String = link.link_state()
		var shown := ("connected, build %s" % link.build()) if state == "connected" else state
		_body.add_child(_hint("Live Link: %s (%s)" % [shown, link.url()]))

	var entries := _entries()
	if entries.is_empty():
		_body.add_child(_hint('No engines registered. Call StoryletDebug.register(engine, "label"), or set panel.engine.'))
		return

	var idx := 0
	for e in entries:
		var header := Label.new()
		var label: String = e["label"]
		header.text = ("Engine %s" % label) if label != "" else ("Engine #%d" % idx)
		header.add_theme_font_size_override("font_size", 16)
		_body.add_child(header)
		idx += 1
		_build_save_load(e["engine"])
		# The run's log sits with the engine, because that is whose it is: one
		# ordered stream over every flow. A flow's section below carries its own.
		_build_log(e["engine"], "Run log (every flow)")
		# One section per open flow: a flow IS the playthrough, so its clocks,
		# board, properties and log are what a debugger wants to see.
		var open_flows: Array = e["engine"].flows()
		if open_flows.is_empty():
			_body.add_child(_hint("(no open flows - call open_flow)"))
		for f in open_flows:
			var flow_header := Label.new()
			flow_header.text = "flow: %s" % f.id
			_body.add_child(flow_header)
			_build_live_block(f)
			_build_properties(f)
			_build_log(f)
		_body.add_child(HSeparator.new())


func _hint(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _build_save_load(e: StoryletEngine) -> void:
	var row := HBoxContainer.new()
	var save_btn := Button.new()
	save_btn.text = "Save State…"
	save_btn.pressed.connect(_pick_save.bind(e))
	row.add_child(save_btn)
	var load_btn := Button.new()
	load_btn.text = "Load State…"
	load_btn.pressed.connect(_pick_load.bind(e))
	row.add_child(load_btn)
	_body.add_child(row)


# Read-only: each box's clock (title or gameId, never internal ids) and the
# board's current hands.
func _build_live_block(s: StoryletFlow) -> void:
	var label := Label.new()
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.text = _live_text(s)
	_body.add_child(label)
	_live_labels.append({"label": label, "session": s})


static func _live_text(s: StoryletFlow) -> String:
	var lines: Array = []
	for b in s.list_boxes():
		var display: String = b.get("title", b["gameId"])
		lines.append("%s: turn %s" % [display, StoryletValues.js_number(b["turn"])])
	var the_board := s.board()
	for hand_game_id in the_board:
		var ids: Array = []
		for card in the_board[hand_game_id]:
			ids.append(card["gameId"])
		lines.append("  %s: %s" % [hand_game_id, ", ".join(ids) if not ids.is_empty() else "(empty)"])
	return "\n".join(lines)


func _on_filter_changed(text: String) -> void:
	_filter = text
	_rebuild()


func _build_properties(s: StoryletFlow) -> void:
	var caption := Label.new()
	caption.text = "Properties"
	_body.add_child(caption)
	var rows := s.list_properties()
	if rows.is_empty():
		_body.add_child(_hint("  (none)"))
		return
	var shown := 0
	for row in rows:
		if _filter != "" and str(row["path"]).findn(_filter) == -1:
			continue
		shown += 1
		_build_property_row(s, row)
	if shown == 0:
		_body.add_child(_hint("  (none match the filter)"))


func _build_property_row(s: StoryletFlow, row: Dictionary) -> void:
	var line := HBoxContainer.new()
	var label := Label.new()
	label.text = row["path"]
	label.custom_minimum_size = Vector2(160, 0)
	line.add_child(label)

	var widget := _make_widget(s, row)
	widget.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(widget)

	var reset := Button.new()
	reset.text = "↺"
	reset.tooltip_text = "Reset to default"
	reset.disabled = StoryletValues.value_equals(row["value"], row["default"])
	reset.pressed.connect(_reset.bind(s, row["path"], row["default"]))
	line.add_child(reset)
	_body.add_child(line)
	_value_widgets.append({
		"widget": widget,
		"type": row["type"],
		"session": s,
		"path": row["path"],
		"default": row["default"],
		"reset": reset,
	})


# The five type-aware editors: boolean / number / string / enum / flags.
func _make_widget(s: StoryletFlow, row: Dictionary) -> Control:
	var path: String = row["path"]
	match row["type"]:
		"boolean":
			var cb := CheckBox.new()
			cb.button_pressed = bool(row["value"])
			cb.toggled.connect(_on_bool.bind(s, path))
			return cb
		"number":
			var sb := SpinBox.new()
			sb.min_value = -1000000000
			sb.max_value = 1000000000
			sb.step = 0.0001
			sb.allow_greater = true
			sb.allow_lesser = true
			sb.value = float(row["value"]) if row["value"] != null else 0.0
			sb.value_changed.connect(_on_number.bind(s, path))
			return sb
		"string":
			var le := LineEdit.new()
			le.text = str(row["value"]) if row["value"] != null else ""
			le.text_submitted.connect(_on_string.bind(s, path))
			return le
		"enum":
			var ob := OptionButton.new()
			var opts: Array = row.get("values", [])
			for o in opts:
				ob.add_item(str(o))
			var cur := opts.find(row["value"]) if row["value"] != null else -1
			ob.selected = cur if cur >= 0 else 0
			ob.item_selected.connect(_on_enum.bind(s, path, opts))
			return ob
		"flags":
			var fe := LineEdit.new()
			fe.placeholder_text = "comma, separated, flags"
			fe.text = _join_flags(row["value"])
			fe.text_submitted.connect(_on_flags.bind(s, path))
			return fe
	var ro := Label.new()
	ro.text = str(row["value"])
	return ro


# -- the log panel (design 2.3) -----------------------------------------------------

## `s` is anything with log() and clear_log(): a StoryletFlow for its own log,
## or the StoryletEngine for the RUN's log, where every flow's events arrive in
## one order and each line names its flow (design/shared-scarcity.md 8.2).
func _build_log(s, caption_text := "Log") -> void:
	var caption := Label.new()
	caption.text = caption_text
	_body.add_child(caption)

	# Per-kind visibility filters + Autoscroll + Copy / Clear.
	var kinds_row := HBoxContainer.new()
	for i in LOG_KINDS.size():
		var kind: String = LOG_KINDS[i]
		if not _log_kind_on.has(kind):
			_log_kind_on[kind] = true
		var cb := CheckBox.new()
		cb.text = LOG_KIND_LABELS[i]
		cb.button_pressed = _log_kind_on[kind]
		cb.toggled.connect(_on_log_kind.bind(kind))
		kinds_row.add_child(cb)
	_body.add_child(kinds_row)

	var tools_row := HBoxContainer.new()
	var auto_cb := CheckBox.new()
	auto_cb.text = "Autoscroll"
	auto_cb.tooltip_text = "Scroll to the latest entry on every refresh."
	auto_cb.button_pressed = _log_autoscroll
	auto_cb.toggled.connect(func(on: bool) -> void: _log_autoscroll = on)
	tools_row.add_child(auto_cb)
	var copy_btn := Button.new()
	copy_btn.text = "Copy"
	copy_btn.tooltip_text = "Copy the visible (filtered) log to the clipboard."
	copy_btn.pressed.connect(_copy_log.bind(s))
	tools_row.add_child(copy_btn)
	var clear_btn := Button.new()
	clear_btn.text = "Clear"
	clear_btn.tooltip_text = "Drop the retained log entries. Cosmetic - no game state changes."
	clear_btn.pressed.connect(_clear_log.bind(s))
	tools_row.add_child(clear_btn)
	_body.add_child(tools_row)

	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 150)
	var lines := Label.new()
	lines.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(lines)
	_body.add_child(scroll)
	_log_views.append({"session": s, "label": lines, "scroll": scroll, "last_seq": -1})
	_refresh_log()


func _on_log_kind(on: bool, kind: String) -> void:
	_log_kind_on[kind] = on
	_refresh_log(true)


## Which filter bucket an entry files under; a peek files under "deal" (both
## are asks).
static func _log_kind_of(e: Dictionary) -> String:
	return "deal" if e["type"] == "peek" else str(e["type"])


static func _show_log_value(v) -> String:
	return "<unset>" if v == null else StoryletValues.show(v)


static func _dealt_ids(cards: Array) -> String:
	var dealt: Array = []
	for c in cards:
		if c["verdict"] == "dealt":
			dealt.append(c["id"])
	return ", ".join(dealt) if not dealt.is_empty() else "(none)"


## One line per entry, [turn]-stamped where the event has a box context
## (write lines share the state logger's "path: from -> to" reading).
static func _format_log_entry(e: Dictionary) -> String:
	var stamp: String = ("[%s] " % StoryletValues.js_number(float(e["turn"]))) if e.has("turn") else "[-] "
	# The run's log names the flow; a flow's own would only repeat its heading.
	if e.has("flow"):
		stamp += "%s " % str(e["flow"])
	match str(e["type"]):
		"deal":
			return "%sdeal %s: %s (%d considered)" % [stamp, e["hand"], _dealt_ids(e["cards"]), e["cards"].size()]
		"peek":
			var crit: Array = []
			for group in e["criteria"]:
				crit.append("%s=%s" % [group, e["criteria"][group]])
			var suffix: String = (" [%s]" % ", ".join(crit)) if not crit.is_empty() else ""
			return "%speek %s%s: %s (%d considered)" % [stamp, e["box"], suffix, _dealt_ids(e["cards"]), e["cards"].size()]
		"evict":
			return "%sevict %s from %s (%s)" % [stamp, e["card"], e["hand"], e["reason"]]
		"play":
			return "%splay %s -> %s" % [stamp, e["card"], e["outcome"]]
		"write":
			return "%swrite %s: %s -> %s" % [stamp, e["path"], _show_log_value(e.get("prev")), _show_log_value(e["value"])]
		"turns":
			return "%sturns %s -> %s" % [stamp, e["box"], StoryletValues.js_number(float(e["turn"]))]
		"diagnostic":
			return "%sdiagnostic %s: %s" % [stamp, e["where"], e["message"]]
	return "%s(unknown)" % stamp


func _visible_log_lines(s) -> Array:
	var lines: Array = []
	for e in s.log():
		if _log_kind_on.get(_log_kind_of(e), true):
			lines.append(_format_log_entry(e))
	return lines


func _refresh_log(force := false) -> void:
	for view in _log_views:
		var s = view["session"]
		var entries: Array = s.log()
		var last_seq: int = entries[-1]["seq"] if not entries.is_empty() else -1
		if not force and last_seq == view["last_seq"]:
			continue
		var moved: bool = last_seq != view["last_seq"]
		view["last_seq"] = last_seq
		var lines := _visible_log_lines(s)
		var label := view["label"] as Label
		if lines.is_empty():
			label.text = "(empty - the engine retains logs when created with the log option)" \
				if entries.is_empty() else "(all kinds filtered out)"
		else:
			label.text = "\n".join(lines)
		if _log_autoscroll and moved:
			# Deferred: the label needs a layout pass before the scroll range grows.
			(view["scroll"] as ScrollContainer).set_deferred("scroll_vertical", 1 << 30)


func _copy_log(s) -> void:
	DisplayServer.clipboard_set("\n".join(_visible_log_lines(s)))


func _clear_log(s) -> void:
	s.clear_log()
	_refresh_log(true)


# -- live value refresh (skip whatever the user is editing) ------------------------

func _refresh_values() -> void:
	for entry in _live_labels:
		(entry["label"] as Label).text = _live_text(entry["session"])
	_refresh_log()
	for entry in _value_widgets:
		var widget: Control = entry["widget"]
		var value = entry["session"].get_property(entry["path"])
		(entry["reset"] as Button).disabled = StoryletValues.value_equals(value, entry["default"])
		if widget.has_focus():
			continue
		match entry["type"]:
			"boolean":
				(widget as CheckBox).set_pressed_no_signal(bool(value))
			"number":
				(widget as SpinBox).set_value_no_signal(float(value) if value != null else 0.0)
			"string":
				(widget as LineEdit).text = str(value) if value != null else ""
			"enum":
				var ob := widget as OptionButton
				var i := ob.get_item_index(ob.get_selected_id())
				if value != null and ob.get_item_text(maxi(i, 0)) != str(value):
					for k in ob.item_count:
						if ob.get_item_text(k) == str(value):
							ob.select(k)
							break
			"flags":
				(widget as LineEdit).text = _join_flags(value)


static func _join_flags(value) -> String:
	if value is Array:
		var parts: Array = []
		for v in value:
			parts.append(str(v))
		return ", ".join(parts)
	return ""


# -- edit handlers ------------------------------------------------------------------

func _on_bool(pressed: bool, s: StoryletFlow, path: String) -> void:
	s.set_property(path, pressed)


func _on_number(value: float, s: StoryletFlow, path: String) -> void:
	s.set_property(path, value)


func _on_string(text: String, s: StoryletFlow, path: String) -> void:
	s.set_property(path, text)


func _on_enum(index: int, s: StoryletFlow, path: String, opts: Array) -> void:
	if index >= 0 and index < opts.size():
		s.set_property(path, str(opts[index]))


func _on_flags(text: String, s: StoryletFlow, path: String) -> void:
	var out: Array = []
	for piece in text.split(",", false):
		var trimmed := piece.strip_edges()
		if trimmed != "":
			out.append(trimmed)
	s.set_property(path, out)


func _reset(s: StoryletFlow, path: String, default_value) -> void:
	s.set_property(path, default_value.duplicate() if default_value is Array else default_value)
	_refresh_values()


# -- save / load ----------------------------------------------------------------------

func _pick_save(s: StoryletEngine) -> void:
	var dlg := FileDialog.new()
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	dlg.add_filter("*.storyletsave", "Storylet state")
	dlg.current_file = "save.storyletsave"
	dlg.file_selected.connect(_do_save.bind(s, dlg))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered_ratio(0.6)


func _pick_load(s: StoryletEngine) -> void:
	var dlg := FileDialog.new()
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dlg.add_filter("*.storyletsave", "Storylet state")
	dlg.file_selected.connect(_do_load.bind(s, dlg))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered_ratio(0.6)


func _do_save(path: String, s: StoryletEngine, dlg: FileDialog) -> void:
	dlg.queue_free()
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("Storylet Engine: cannot write " + path)
		return
	f.store_string(StoryletSave.serialize_state(s, null, "\t"))
	f.close()


func _do_load(path: String, s: StoryletEngine, dlg: FileDialog) -> void:
	dlg.queue_free()
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		push_error("Storylet Engine: cannot read " + path)
		return
	# A foreign or malformed blob is refused by StoryletSave, never applied.
	# (The panel is a debug tool with no world container of its own; the
	# file's world values, if any, are the host's to apply.)
	if StoryletSave.deserialize_state(s, text) == null:
		push_error("Storylet Engine: not a valid state file: " + path)
		return
	_rebuild()
