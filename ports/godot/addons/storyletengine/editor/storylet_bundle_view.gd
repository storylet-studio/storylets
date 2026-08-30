@tool
extends VBoxContainer

# The bundle summary view: the rows the Inspector section draws
# (storylet_bundle_inspector_plugin.gd) and the same content every runtime's
# bundle inspector shows, in the same order, with the same section headings
# (design/engine-runtimes.md 2, piece 6). Lifted verbatim from the retired
# bottom-left dock, minus its file picker: the Inspector already tells you
# which asset you are looking at.

var _selected: StoryletBundleResource
var _summary: RichTextLabel
var _sections: VBoxContainer


func _ready() -> void:
	if _summary != null:
		return
	_summary = RichTextLabel.new()
	_summary.bbcode_enabled = true
	_summary.fit_content = true
	add_child(_summary)
	_sections = VBoxContainer.new()
	add_child(_sections)
	_refresh()


## Point the view at a bundle (safe before _ready: the selection is stashed
## and rendered when the node enters the tree).
func set_bundle_resource(res: StoryletBundleResource) -> void:
	_selected = res
	if _summary != null:
		_refresh()


func _refresh() -> void:
	if _sections == null:
		return   # not in the tree yet; _ready() renders the stashed selection
	for c in _sections.get_children():
		c.queue_free()

	if _selected == null:
		_summary.text = "[i]No bundle selected.[/i]"
		return

	# A broken bundle still imports: say so first, and loudly.
	if not _selected.is_valid():
		var lines: Array[String] = []
		for e in _selected.get_errors():
			lines.append("- " + str(e))
		_summary.text = ("[b][color=red]Bundle failed to load[/color][/b]\n\n"
			+ "\n".join(lines))
		return

	var d := StoryletBundleInspector.describe_bundle(_selected.get_bundle())
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


func _add_section(title: String) -> void:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.text = "[b]%s[/b]" % title.to_upper()
	label.modulate = Color(0.75, 0.75, 0.75)
	_sections.add_child(label)


func _add_row(text: String, muted: bool = false) -> void:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.text = text
	if muted:
		label.modulate = Color(0.7, 0.7, 0.7)
	_sections.add_child(label)
