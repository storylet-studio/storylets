@tool
# The bundle Inspector view: what Storylet Engine shows about a bundle.
#
# The FRAME - the widgets, the selection, the redraw, and the two states that
# are not about content (nothing selected, and a bundle that failed to load) -
# is the SHARED source, vendored beside the runtime as expr/bundle_view.gd. It
# is shared because this exact pair already drifted once: the Unreal
# equivalents diverged on the error state, and one of them stopped saying
# anything at all when a bundle had not parsed.
#
# What stays here is `_render`, which is the point of the view.
extends "res://addons/storyletengine/runtime/expr/bundle_view.gd"


func _render(res: Resource) -> void:
	var selected := res as StoryletBundleResource
	var d := StoryletBundleInspector.describe_bundle(selected.get_bundle())
	var identity: Dictionary = d["identity"]
	var totals: Dictionary = d["totals"]
	_summary.text = (
		"[b]%s[/b]  [color=gray]%s[/color]\n"
		+ "[color=gray]schema[/color] %s\n"
		+ "[color=gray]hash[/color] %s   [color=gray]metadata[/color] %s\n"
		+ "[color=gray]boxes[/color] %d   [color=gray]decks[/color] %d   "
		+ "[color=gray]cards[/color] %d   [color=gray]hands[/color] %d   "
		+ "[color=gray]templates[/color] %d   [color=gray]tag groups[/color] %d"
	) % [
		str(identity["project"]), str(identity["version"]), str(identity["schema"]),
		("(none)" if str(identity["hash"]) == "" else str(identity["hash"])),
		str(identity["metadata"]),
		int(totals["boxes"]), int(totals["decks"]), int(totals["cards"]),
		int(totals["hands"]), int(totals["templates"]), int(totals["tagGroups"]),
	]

	# Hands: the deal() surface (the name deal() is called with).
	_add_section("Hands (deal)")
	if (d["hands"] as Array).is_empty():
		_add_row("(no hands - this bundle is peek-only)", true)
	for hand in d["hands"]:
		var template := ""
		if hand.has("template"):
			template = ", template %s" % str(hand["template"])
		var title := ""
		if hand.has("title"):
			title = "  [color=gray]%s[/color]" % str(hand["title"])
		_add_row("%s: box %s, slots %s%s%s" % [
			str(hand["gameId"]), str(hand["box"]),
			StoryletBundleInspector.slots_label(float(hand["slots"])), template, title,
		])

	# Tags by box: the peek() criteria surface ({group gameId: tag gameId}).
	_add_section("Tags by box (peek criteria)")
	for box in d["boxes"]:
		_add_row("[b]%s[/b]" % str(box.get("title", box["gameId"])))
		if (box["tagGroups"] as Array).is_empty():
			_add_row("    (no tag groups)", true)
		for group in box["tagGroups"]:
			var tags: Array = group["tags"]
			_add_row("    %s: %s" % [
				str(group["gameId"]),
				", ".join(tags) if not tags.is_empty() else "(no tags)",
			])

	# Declared properties: what expressions read, what a host may set.
	_add_section("Properties (declared)")
	for scope in d["properties"]:
		_add_row("[b]%s[/b]" % StoryletBundleInspector.scope_label(scope))
		if (scope["properties"] as Array).is_empty():
			_add_row("    (none declared)", true)
		for p in scope["properties"]:
			_add_row("    " + StoryletBundleInspector.property_label(p))

	# Only when there are some: an empty section on every ordinary bundle would
	# teach the reader to skip the one that only matters when it is not empty.
	if not (d.get("maps", []) as Array).is_empty():
		_add_section("Maps (carried, not read)")
		_add_row("Geometry the build was asked to carry. The engine ignores it.", true)
		for map in d["maps"]:
			_add_row("%s - %s: zones %d, pictures %d" % [
				str(map["box"]), str(map["group"]), int(map["zones"]), int(map["backgrounds"]),
			])

	# Per-box counts: orientation, not inventory.
	_add_section("Counts by box")
	for box in d["boxes"]:
		var counts: Dictionary = box["counts"]
		_add_row("%s: decks %d, cards %d, hands %d, templates %d, tag groups %d, ranking.specificity %s" % [
			str(box["gameId"]), int(counts["decks"]), int(counts["cards"]), int(counts["hands"]),
			int(counts["templates"]), int(counts["tagGroups"]),
			"on" if bool(box["ranking"]["specificity"]) else "off",
		])
