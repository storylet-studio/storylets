@tool
extends SceneTree

# Headless check of the Runtime State panel (ui/storylet_state_panel.gd).
#
# The panel is a plain PanelContainer, so a headless SceneTree can build it,
# register an engine and read back what it drew. It is checked here because
# the registry is ENGINE-keyed (StoryletDebug.register(engine, "label"), the
# shape Unity, Unreal and all three Patterplay ports share) and the panel asks
# the engine for its open flows: nothing else in the suite runs that walk, so
# a change to it would otherwise only ever be parsed.
#
# One step per FRAME, deliberately. The panel drops the old rows with
# queue_free(), which lands at the end of the frame, so two rebuilds in one
# frame read as both states at once.

const PANEL := preload("res://addons/storyletengine/ui/storylet_state_panel.gd")
const BUNDLE_PATH := "res://../../examples/the-hamlet.storylets/dist/the-hamlet.storyletsc"

var _fails := 0
var _step := 0
var _panel: PanelContainer = null
var _engine: StoryletEngine = null


func _check(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("PASS %s" % label)
	else:
		_fails += 1
		print("FAIL %s%s" % [label, ("  (%s)" % detail) if detail != "" else ""])


## Every line of text the panel is currently showing, flattened.
func _text_of(node: Node) -> String:
	var out := ""
	if node is Label:
		out += (node as Label).text + "\n"
	elif node is Button:
		out += (node as Button).text + "\n"
	elif node is RichTextLabel:
		out += (node as RichTextLabel).text + "\n"
	for child in node.get_children():
		out += _text_of(child)
	return out


func _initialize() -> void:
	var text := FileAccess.get_file_as_string(BUNDLE_PATH)
	if text == "":
		print("SKIP state panel: no built bundle at %s (run `storyletengine export`)" % BUNDLE_PATH)
		quit(0)
		return
	var loaded := StoryletBundle.load_from_string(text)
	if not loaded["ok"]:
		print("FAIL state panel: bundle would not load (%s)" % loaded["error"])
		quit(1)
		return

	StoryletDebug.clear()
	_engine = StoryletEngine.create(loaded["bundle"], {"seed": 7, "log": true})
	# _ready (which builds the panel's body) runs on the first frame, so every
	# check below waits for one.
	_panel = PANEL.new()
	root.add_child(_panel)


func _process(_delta: float) -> bool:
	var body := _text_of(_panel)
	match _step:
		0:
			_check("nothing registered says so", body.contains("No engines registered"), body)
			StoryletDebug.register(_engine, "under test")
		1:
			_check("the engine's label heads its section", body.contains("Engine under test"), body)
			_check("an engine with no flows says so", body.contains("no open flows"), body)
			_check("save and load are offered per engine", body.contains("Save State"), body)
			_check("the run's log sits with the engine", body.contains("Run log (every flow)"), body)
			# Two flows on one engine: the panel finds them through the engine,
			# so it draws a section for each without either being registered.
			_engine.open_flow("alice").deal_many()
			_engine.open_flow("bob")
			_panel._tick()   # what the panel's own 4 Hz timer does
		2:
			# The run log names the flow that acted; a flow's own log does not,
			# because its heading already says whose it is.
			_check("the run log names the acting flow", body.contains("] alice deal"), body)
			_check("the first flow is drawn", body.contains("flow: alice"), body)
			_check("the second flow is drawn", body.contains("flow: bob"), body)
			_check("the no-flows hint is gone", not body.contains("no open flows"), body)
			# Closing one takes its section with it, again with no registry call.
			_engine.close_flow("bob")
			_panel._tick()
		3:
			_check("the closed flow's section goes", not body.contains("flow: bob"), body)
			_check("the open one stays", body.contains("flow: alice"), body)
			# A QUALITY edits as its ladder, not as free text and not as a label.
			# The widget is asked for directly: whether the demo bundle happens to
			# declare a quality is not what is under test, and a check that only
			# runs when it does is a check that stops running the day it does not.
			var ladder := ["dawn", "noon", "dusk"]
			var q_row := {
				"path": "story.hour", "name": "hour", "type": "quality",
				"value": "noon", "default": "dawn", "stages": ladder, "writable": true,
			}
			var w = _panel._make_widget(_engine.open_flow("alice"), q_row)
			_check("a quality edits as a dropdown, not a read-only label", w is OptionButton, str(w))
			if w is OptionButton:
				var ob := w as OptionButton
				_check("the dropdown offers the ladder's stages", ob.item_count == ladder.size(),
					"item_count=%d, expected %d" % [ob.item_count, ladder.size()])
				_check("it opens on the current stage", ob.selected == 1,
					"selected=%d, expected 1 (noon)" % ob.selected)
			StoryletDebug.unregister(_engine)
		_:
			_check("unregistering empties the panel", body.contains("No engines registered"), body)
			StoryletDebug.clear()
			if _fails == 0:
				print("STATE PANEL ALL PASS")
			else:
				print("STATE PANEL %d FAILED" % _fails)
			quit(1 if _fails > 0 else 0)
			return true
	_step += 1
	return false
