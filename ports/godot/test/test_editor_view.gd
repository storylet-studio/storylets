@tool
extends SceneTree

# Headless check of the EDITOR's bundle view (storylet_bundle_view.gd).
#
# The view is a @tool script that normally only runs inside the Godot editor's
# Inspector, which is precisely why it needs this: nothing else in the test
# suite instantiates it, so a change to it is otherwise only ever parsed, never
# executed. It is a plain VBoxContainer, so a headless SceneTree can build it,
# hand it a bundle and read the rows back out.

const VIEW := preload("res://addons/storyletengine/editor/storylet_bundle_view.gd")
const BUNDLE_PATH := "res://../../examples/the-hamlet.storylets/dist/the-hamlet.storyletsc"

var _fails := 0


func _check(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("PASS %s" % label)
	else:
		_fails += 1
		print("FAIL %s%s" % [label, ("  (%s)" % detail) if detail != "" else ""])


## Every row of text the view is currently showing, flattened.
func _text_of(node: Node) -> String:
	var out := ""
	if node is RichTextLabel:
		out += (node as RichTextLabel).text + "\n"
	for child in node.get_children():
		out += _text_of(child)
	return out


func _initialize() -> void:
	# Not the checks themselves: a node added during _initialize is readied on
	# the first frame, so the view would still be empty here.
	_run()


func _run() -> void:
	var text := FileAccess.get_file_as_string(BUNDLE_PATH)
	if text == "":
		print("SKIP editor view: no built bundle at %s (run `storyletengine export`)" % BUNDLE_PATH)
		quit(0)
		return

	var view: VBoxContainer = VIEW.new()
	root.add_child(view)
	await process_frame          # _ready builds the labels

	# An ordinary bundle: no map section at all, since most bundles carry none
	# and an always-empty section teaches people to skip it.
	var plain := StoryletBundleResource.from_json_text(text)
	view.set_bundle_resource(plain)
	var plain_text := _text_of(view)
	_check("the view renders a bundle", plain_text.contains("HANDS (DEAL)"), plain_text.substr(0, 80))
	_check("no map section on a bundle without one", not plain_text.contains("MAPS"))

	# The same bundle with a map bolted on: the section appears and says what is
	# in it, and says out loud that the engine does not read it.
	var mapped: Dictionary = JSON.parse_string(text)
	mapped["maps"] = [{
		"box": "village", "group": "zone",
		"zones": [{"tag": "tavern", "polygon": [
			{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 3}]}],
		"backgrounds": [{"file": "assets/village/plan.png",
			"x": 1, "y": 2, "width": 8, "height": 6}],
	}]
	view.set_bundle_resource(StoryletBundleResource.from_json_text(JSON.stringify(mapped)))
	var mapped_text := _text_of(view)
	_check("the map section appears", mapped_text.contains("MAPS (CARRIED, NOT READ)"))
	_check("it counts what is in the map", mapped_text.contains("village - zone: zones 1, pictures 1"),
		mapped_text.substr(0, 120))
	_check("it says the engine ignores it", mapped_text.contains("The engine ignores it"))

	print("EDITOR VIEW %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)
