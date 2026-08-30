@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# describe_bundle - the bundle inspector's runtime half
# (design/engine-runtimes.md section 2, piece 6). Port of
# packages/runtime/src/describe.ts.
#
# A BUNDLE-level API, deliberately NOT a session method: it answers the
# integrator's question - "I dropped a .storyletsc into my project, what may my
# game code call?" - from the imported asset alone, with no session, no state
# and no game running. That makes the boundary rule (design 4) visible: hands
# are what deal() takes, tag groups + tags are what peek() criteria are drawn
# from, declared properties are what expressions read and a host may set. Card
# lists are deliberately absent: cards are the engine's business, counts are
# the orientation an integrator needs.
#
# Everything is in bundle order, so the description is deterministic and two
# runtimes render the same rows in the same sequence. The property scopes are
# the static twin of StoryletSession.list_properties(): the same stores, in the
# same order, before anything is instantiated (a hand instance carries its
# template's declarations, exactly as the session's hand bags do).
#
# Dictionary keys are camelCase, exactly as list_boxes() / list_properties()
# rows are: they mirror the bundle's own JSON vocabulary.
class_name StoryletBundleInspector

## The scope kinds a declaration block can belong to. Tag declarations compose
## into @hand for any ask that binds the tag (schema 3.6).
const SCOPE_WORLD := "world"
const SCOPE_STORY := "story"
const SCOPE_BOX := "box"
const SCOPE_DECK := "deck"
const SCOPE_HAND := "hand"
const SCOPE_TAG := "tag"


## Describe a compiled bundle: the callable surface of an imported asset, no
## session required (design 2, piece 6). Bundle order throughout; the same
## shape every runtime returns.
##
## Returns {
##   "identity": {"schema", "project", "version", "hash", "metadata"},
##   "totals": {"boxes", "decks", "cards", "hands", "templates", "tagGroups"},
##   "boxes": [{"gameId", "title"?, "ranking": {"specificity"},
##              "tagGroups": [{"gameId", "tags": [gameId]}],
##              "counts": {"decks", "cards", "hands", "templates", "tagGroups"}}],
##   "hands": [{"gameId", "title"?, "box", "slots" (INF = unbounded), "template"?}],
##   "properties": [{"scope", "owner", "box"?, "group"?,
##                   "properties": [{"name", "type", "default", "values"?, "purpose"?}]}],
## }
static func describe_bundle(bundle: Dictionary) -> Dictionary:
	var content: Dictionary = bundle.get("content", {})
	var identity := {
		"schema": str(bundle.get("schema", "")),
		"project": str(content.get("project", "")),
		"version": str(content.get("version", "")),
		"hash": str(content.get("hash", "")),
		"metadata": str(bundle.get("metadata", "full")),
	}
	var totals := {
		"boxes": 0, "decks": 0, "cards": 0, "hands": 0, "templates": 0, "tagGroups": 0,
	}
	var boxes: Array = []
	var hands: Array = []
	var properties: Array = [
		{"scope": SCOPE_WORLD, "owner": "",
			"properties": _summarise(bundle.get("world", {}).get("properties", []))},
		{"scope": SCOPE_STORY, "owner": "",
			"properties": _summarise(bundle.get("story", {}).get("properties", []))},
	]

	for box in bundle.get("boxes", []):
		var box_game_id := StoryletBundle.effective_game_id(box)
		var decks: Array = box.get("decks", [])
		var box_hands: Array = box.get("hands", [])
		var templates: Array = box.get("handTemplates", [])
		var groups: Array = box.get("tagGroups", [])
		var cards := 0
		for deck in decks:
			cards += (deck.get("cards", []) as Array).size()

		var tag_groups: Array = []
		for group in groups:
			var tags: Array = []
			for tag in group.get("tags", []):
				tags.append(StoryletBundle.effective_game_id(tag))
			tag_groups.append({"gameId": StoryletBundle.effective_game_id(group), "tags": tags})

		var summary := {"gameId": box_game_id}
		if box.has("title"):
			summary["title"] = str(box["title"])
		summary["ranking"] = {"specificity": bool(box.get("ranking", {}).get("specificity", true))}
		summary["tagGroups"] = tag_groups
		summary["counts"] = {
			"decks": decks.size(),
			"cards": cards,
			"hands": box_hands.size(),
			"templates": templates.size(),
			"tagGroups": groups.size(),
		}
		boxes.append(summary)

		totals["boxes"] += 1
		totals["decks"] += decks.size()
		totals["cards"] += cards
		totals["hands"] += box_hands.size()
		totals["templates"] += templates.size()
		totals["tagGroups"] += groups.size()

		for hand in box_hands:
			var template = _template_of(hand, templates)
			var row := {"gameId": StoryletBundle.effective_game_id(hand)}
			if hand.has("title"):
				row["title"] = str(hand["title"])
			row["box"] = box_game_id
			row["slots"] = _hand_slots(hand, template)
			if template != null:
				row["template"] = StoryletBundle.effective_game_id(template)
			hands.append(row)

		# The property scopes, in the session's store order: box, decks, hands,
		# tags. Empty declaration blocks are dropped (nothing to read or set).
		_push(properties, SCOPE_BOX, box_game_id, box_game_id, "", box.get("properties", []))
		for deck in decks:
			_push(properties, SCOPE_DECK, StoryletBundle.effective_game_id(deck), box_game_id, "",
				deck.get("properties", []))
		for hand in box_hands:
			_push(properties, SCOPE_HAND, StoryletBundle.effective_game_id(hand), box_game_id, "",
				_hand_decls(hand, templates))
		for group in groups:
			var group_game_id := StoryletBundle.effective_game_id(group)
			for tag in group.get("tags", []):
				_push(properties, SCOPE_TAG, StoryletBundle.effective_game_id(tag), box_game_id,
					group_game_id, tag.get("properties", []))

	# Maps are inert payload: nothing in the engine reads them, which is exactly
	# why the inspector has to say they are there. A host that wants the polygons
	# reads bundle["maps"] directly - the parsed Dictionary IS the bundle here,
	# so the geometry needs no accessor of its own.
	var maps: Array = []
	for map in bundle.get("maps", []):
		maps.append({
			"box": str(map.get("box", "")),
			"group": str(map.get("group", "")),
			"zones": (map.get("zones", []) as Array).size(),
			"backgrounds": (map.get("backgrounds", []) as Array).size(),
		})

	return {
		"identity": identity,
		"totals": totals,
		"boxes": boxes,
		"hands": hands,
		"properties": properties,
		"maps": maps,
	}


## The slot cap as the inspectors show it ("unbounded" for the uncapped hand).
static func slots_label(slots: float) -> String:
	return "unbounded" if is_inf(slots) else StoryletValues.js_number(slots)


## The scope label a declaration block files under ("world", "box box",
## "tag docks (zone)").
static func scope_label(scope: Dictionary) -> String:
	var kind := str(scope.get("scope", ""))
	if kind == SCOPE_WORLD or kind == SCOPE_STORY:
		return kind
	var group := str(scope.get("group", ""))
	var suffix := "" if group == "" else " (%s)" % group
	return "%s %s%s" % [kind, str(scope.get("owner", "")), suffix]


## "name: type = default", plus enum/flags options where declared.
static func property_label(p: Dictionary) -> String:
	var values = p.get("values")
	var options := ""
	if values is Array and (values as Array).size() > 0:
		options = " [%s]" % ", ".join((values as Array).map(func(v): return str(v)))
	return "%s: %s = %s%s" % [
		str(p.get("name", "")), str(p.get("type", "")),
		StoryletValues.show(p.get("default")), options,
	]


static func _summarise(decls: Variant) -> Array:
	var rows: Array = []
	if not (decls is Array):
		return rows
	for decl in decls:
		var row := {
			"name": str(decl.get("name", "")),
			"type": str(decl.get("type", "")),
			"default": decl.get("default"),
		}
		if decl.has("values"):
			row["values"] = decl["values"]
		if decl.has("purpose"):
			row["purpose"] = str(decl["purpose"])
		rows.append(row)
	return rows


static func _push(out: Array, scope: String, owner: String, box: String, group: String,
		decls: Variant) -> void:
	if not (decls is Array) or (decls as Array).is_empty():
		return
	var row := {"scope": scope, "owner": owner, "box": box}
	if group != "":
		row["group"] = group
	row["properties"] = _summarise(decls)
	out.append(row)


static func _template_of(hand: Dictionary, templates: Array) -> Variant:
	if not hand.has("template"):
		return null
	for t in templates:
		if t.get("id") == hand["template"]:
			return t
	return null


## A hand's declared @hand state: a template instance inherits its template's
## declarations, a standalone hand declares its own (schema 2.6) - the same rule
## the session's hand bags are built on.
static func _hand_decls(hand: Dictionary, templates: Array) -> Variant:
	if hand.has("template"):
		var template = _template_of(hand, templates)
		return template.get("properties", []) if template != null else []
	return hand.get("properties", [])


## The effective slot cap, resolved the way the session resolves capacity: the
## hand's override, else the template's or rule's, else unbounded (INF).
static func _hand_slots(hand: Dictionary, template: Variant) -> float:
	if hand.has("slots"):
		return float(hand["slots"])
	var declared = null
	if hand.has("template"):
		if template != null:
			declared = template.get("slots")
	else:
		declared = hand.get("rule", {}).get("slots")
	if declared == null or (declared is String and declared == "unbounded"):
		return INF
	return float(declared)
