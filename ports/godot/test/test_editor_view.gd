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
const BUNDLE_PATH := "res://../../examples/storylet-dist/the-hamlet.storyletsc"

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
	# and an always-empty section teaches people to skip it. The Hamlet is on a
	# project map now, so the map is taken off it here to make the plain case.
	var stripped: Dictionary = JSON.parse_string(text)
	stripped.erase("map")
	for box in stripped["boxes"]:
		box.erase("usesMap")
	var plain := StoryletBundleResource.from_json_text(JSON.stringify(stripped))
	view.set_bundle_resource(plain)
	var plain_text := _text_of(view)
	_check("the view renders a bundle", plain_text.contains("HANDS (DEAL)"), plain_text.substr(0, 80))
	_check("no map section on a bundle without one", not plain_text.contains("PROJECT MAP"))

	# The same bundle with a project map bolted on (design/project-map-contract.md
	# 2.1): the section appears, names the group, its zones and the boxes on it,
	# and counts the geometry, saying out loud that the engine does not read it.
	var mapped: Dictionary = JSON.parse_string(text)
	mapped["schema"] = StoryletBundle.BUNDLE_SCHEMA
	mapped["boxes"][0]["usesMap"] = true
	var box_name := StoryletBundle.effective_game_id(mapped["boxes"][0])
	var sites := {}
	sites[box_name] = [{"hand": "the-forge", "x": 5, "y": 6}, {"hand": "the-well", "x": 7, "y": 8}]
	mapped["map"] = {
		"group": {"id": "d_district", "gameId": "district",
			"tags": [{"id": "v_quay", "gameId": "quay"}, {"id": "v_hill", "gameId": "hill"}]},
		"geometry": {
			"zones": [{"tag": "quay", "polygon": [
				{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 3}]}],
			"backgrounds": [{"file": "assets/plan.png",
				"x": 1, "y": 2, "width": 8, "height": 6}],
			"sites": sites,
		},
	}
	view.set_bundle_resource(StoryletBundleResource.from_json_text(JSON.stringify(mapped)))
	var mapped_text := _text_of(view)
	_check("the project map section appears", mapped_text.contains("PROJECT MAP"))
	_check("it names the group and its zones", mapped_text.contains("district: quay, hill"),
		mapped_text.substr(0, 120))
	_check("it names the boxes on the map", mapped_text.contains("boxes on the map: " + box_name))
	_check("it counts the geometry and says the engine ignores it",
		mapped_text.contains("geometry carried (the engine ignores it): zones 1, pictures 1, hands %s 2" % box_name))


	# The two states the SHARED frame owns (expr/bundle_view.gd), rather than
	# the render. Neither was covered until 2026-09-01, and they are exactly
	# where the Unreal equivalents of this view drifted: one family taught its
	# error state to distinguish "failed to load" from "never parsed" and the
	# other did not, so an unparsed bundle showed a blank Inspector.
	view.set_bundle_resource(null)
	var empty_text := _text_of(view)
	_check("nothing selected says so", empty_text.contains("No bundle selected"), empty_text.substr(0, 60))

	# Built the way the IMPORT PLUGIN builds it, not via from_json_text: that
	# returns null for an invalid bundle, so it can never reach this state.
	var broken := StoryletBundleResource.new()
	broken.json_text = "{ not json at all"
	view.set_bundle_resource(broken)
	var broken_text := _text_of(view)
	_check("a bundle that fails to load says so", broken_text.contains("failed to load"), broken_text.substr(0, 80))
	_check("and says why, rather than showing a blank panel", broken_text.strip_edges().length() > 30, broken_text.substr(0, 80))

	print("EDITOR VIEW %s" % ("ALL PASS" if _fails == 0 else "%d FAILED" % _fails))
	quit(0 if _fails == 0 else 1)
