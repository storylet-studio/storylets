@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The Engine: the world + flow manager (design/flows.md; the shape is
# Patter's), transliterated from the reference runtime
# (packages/runtime/src/engine.ts) and held to the conformance corpus.
#
# The flow model, in one place:
#   - an Engine owns the bundle, every lookup built from it, the SHARED
#     property partitions and the @world resolver; a StoryletFlow owns its
#     own PRNG, per-box clocks, cooldowns, board, claims, play history and
#     the per-flow property partitions. Flows meet only through shared state.
#   - sharing is a per-property `shared` flag on the declaration: @story
#     defaults shared; box, deck, hand and tag properties default per-flow.
#     Every name is shared XOR per-flow, so a read is a union of two bags
#     and a write routes by name.
#   - every property bag lives in ONE scope registry per game (the
#     one-registry model): the game hands the engine its registry (create's
#     "registry" option) or the engine makes its own and acts as its own
#     game. The shared @story registers under `story`, every other bag that
#     declares something under a key starting `storylets/`, which no
#     expression can name. save_game() carries what is NOT a property, plus
#     the registry's values only when the engine made the registry itself.
#   - @world is the game's: a resolver it binds (create's "world" option,
#     {"get": Callable, "set": Callable?}, never saved), a scope it registers
#     in its registry, or, for a standalone engine, a self-backed bag the
#     registry stores and saves.
#   - there is no default flow and no ambient current flow: open_flow(id)
#     is the only way in, an existing id is REPLACED (the old flow closes),
#     and a closed flow's handle is INERT - every verb refuses.
#   - engine-level get_property serves world.* and shared refs only; a ref
#     that resolves per-flow is refused, naming the fix.
#   - the PROJECT MAP (design/project-map-contract.md 3) is one zone group
#     above the boxes, in bundle["map"]["group"] and in no box's "tagGroups".
#     A box that opts in ("usesMap") sees its name beside its own groups', so
#     its hands bind zones and its cards are tagged with them by id exactly as
#     with a box group. Each zone is ONE value bag, keyed by the tag's id like
#     any tag's, so a zone property is one value whichever box's hand is dealt
#     to it; the `shared` flag still decides per-flow against one for the
#     engine. What the boxes on a map do NOT share: a hand deals only from its
#     own box's decks, and play history stays the asking box's (D7). A bundle
#     that breaks the map's rules is refused at construction (3.8) rather than
#     half-played.
class_name StoryletEngine
extends RefCounted

const CREATE_OPTION_KEYS := ["seed", "log", "world", "registry", "on_replaced_flow"]
## The owner label on everything this engine registers: named in a clash error
## and carried on the registry's examiner rows.
const OWNER := "Storylet Engine"
## The four instance kinds, in the order their bags register.
const OWNED_KINDS := ["box", "deck", "hand", "value"]
## open_flow's options. "restore" takes a save_flow blob and opens the flow AS
## IT WAS (design/engine-server.md 4.1); "durable" takes a flow's durable half
## (its POCKET, from flow.save_durable()) and opens a fresh flow with it written
## in (ruling H); "on_restore_report" is a Callable(report: Dictionary) handed
## what either did - for a restore, the same report preview_flow_restore
## returns - and the only way out for it, since open_flow returns the handle.
const OPEN_FLOW_OPTION_KEYS := ["seed", "restore", "durable", "on_restore_report"]
## The load report's sort-key separator: a UNIT SEPARATOR, because it cannot
## occur in an id, a gameId or a property name.
const REPORT_SEP := "\u001f"

var _bundle: Dictionary
var _seed: int
var _dialect: Dictionary
# The retained log cap each flow inherits; -1 = disabled.
var _log_cap: int = -1

# Lookups (bundle is immutable; built once). Shared with every flow.
var _cards_by_id: Dictionary = {}
## Does ANY deck or card in the bundle opt into shared scarcity? False for the
## overwhelming majority of projects, and when it is false the two claim-ledger
## walks in dealing are skipped entirely: a bundle that does not use a feature
## must not pay for it.
var _has_shared: bool = false
var _cards_by_game_id: Dictionary = {}
var _boxes_by_id: Dictionary = {}
var _boxes_by_game_id: Dictionary = {}
var _hands_by_id: Dictionary = {}       # id -> {"hand", "box"}
var _hands_by_game_id: Dictionary = {}
var _templates_by_id: Dictionary = {}
# id -> {"group", "box"}; "box" is absent for the project map's group, which
# belongs to no box.
var _groups_by_id: Dictionary = {}
var _required_groups: Dictionary = {}   # id -> true

# The owner segment of a property address, both ways round (design change 4.4).
#
# The first map answers "what is this store called?" (internal id -> the segment
# an address prints) and the second "which store is that?" (owner segment ->
# internal id). Both are built in bundle order and a repeated key does NOT
# overwrite the first.
#
# Box, deck, hand and card gameIds are unique bundle-wide, so for three of the
# four scopes the segment is simply the gameId. A TAG's is unique only within
# its group, and a group's only within its box, so two boxes may each name a tag
# "docks": the value scope's segment is box-qualified,
# "value.<boxGameId>/<tagGameId>.<name>", wherever a gameId repeats, and the
# short form is REFUSED there rather than resolved to the first in bundle order.
# The third map is what such a refusal names.
#
# A ZONE of the project map is the one tag with no qualified form: it belongs to
# no box, so it prints and is accepted as "value.<zoneGameId>.<name>" whichever
# boxes use it. The fourth map holds the box-qualified forms that name a zone,
# "<box>/<zone>" -> "<zone>", which are REFUSED, naming the short form
# (design/project-map-contract.md 3.4).
var _owner_game_ids: Dictionary = {"box": {}, "deck": {}, "hand": {}, "value": {}}
var _owner_ids: Dictionary = {"box": {}, "deck": {}, "hand": {}, "value": {}}
var _owner_repeated: Dictionary = {"box": {}, "deck": {}, "hand": {}, "value": {}}
var _owner_zone_qualified: Dictionary = {"box": {}, "deck": {}, "hand": {}, "value": {}}

# Quality ladders (quality.md), declaration-level so partition-blind.
var _world_ladders: Dictionary = {}
var _story_ladders: Dictionary = {}
var _box_ladders: Dictionary = {}
var _deck_ladders: Dictionary = {}
var _value_ladders: Dictionary = {}
var _hand_ladders: Dictionary = {}
var _has_qualities := false

# The per-flow halves of every declaration list, precomputed once: each
# open_flow builds its bags from these.
# {"story": Array, "box"/"deck"/"hand"/"value": {id: Array}}
var _flow_decls: Dictionary = {}
# The shared halves, the same way. Not used to build anything - the shared bags
# are built straight from the bundle - but a load report has to say what the
# shared side WOULD hold without building a bag, which is what makes
# preview_load pure.
var _shared_decls: Dictionary = {}
## The durable declarations and durable cards on each side (ruling H), built
## once at construction: what save_durable carries and a durable load may
## write. "shared" / "flow" hold durable props ({"address", "kind", "owner"
## (absent for story), "decl"}), "shared_cards" / "flow_cards" card entries.
var _durable: Dictionary = {"shared": [], "flow": [], "shared_cards": [], "flow_cards": []}
# The shared stores: {"story": bag, "box"/"deck"/"hand"/"value": {id: bag}},
# registered in the registry for the engine's life. Reseeded in place by reset
# and by a load that carries values, so the registry never sees them come and go.
var _shared: Dictionary = {}
## The game's one registry (or the engine's own, when it is standalone). Held
## untyped: a combined game may pass the registry another addon's shim built
## (Patterplay's, say), which is the same shared source under another name.
var _registry = null
## True when the engine made the registry: save_game() then carries its values.
var _owns_registry := false
## The host's @world resolver, when bound: {"get": Callable, "set": Callable?}.
var _host_world = null
## True when the engine self-backed @world (standalone, no resolver bound): the
## registry stores it under `world` and saves it.
var _self_world := false
## Why construction was refused ("" when it was not): a registration the
## registry turned down, a token clash. create() returns null when it is set.
var _init_error := ""
var _on_replaced_flow = null
## Every OTHER scope in the registry as an eval context sees it (instance keys
## left out), rebuilt only when the registry's revision moves.
var _view_revision := -1
var _view_cache: Dictionary = {"scopes": {}, "qualities": null}

var _flows: Dictionary = {}             # id -> StoryletFlow, open order
var _engine_trace_handlers: Array[Callable] = []
## The options this engine was built with: hot_swap builds its replacement
## from them.
var _creation_options: Dictionary = {}
## How to register each shared scope again, in registration order: a failed
## hot_swap puts this engine back exactly as it was. Each entry is
## {"key", "bag"} (an owned bag) or {"key", "resolver", "decls"} (the game's
## bound @world). Data, not Callables: a lambda made here would hold this
## engine, and the engine holds the list.
var _shared_mounts: Array = []
## Other engines' game-wide scopes the content names (the bundle's
## externalScopes): every one must be registered for a flow to open.
var _external_scopes: Array = []
## group_in_box and tag_key_in, memoised: both answer from the bundle alone.
var _group_memo: Dictionary = {}
var _tag_key_memo: Dictionary = {}


## The sharing default per scope (design/flows.md): @story shared, the
## narrower geographic scopes per-flow. A declaration's flag overrides.
static func _is_shared(scope: String, decl: Dictionary) -> bool:
	if decl.has("shared"):
		return bool(decl["shared"])
	return scope == "story"


static func _half(scope: String, decls: Array, shared: bool) -> Array:
	var out: Array = []
	for d in decls:
		if _is_shared(scope, d) == shared:
			out.append(d)
	return out


# path_prefix carries its own separator, so a bag composes its rows' addresses itself
# ("story.gold", "deck.tavern.drawn") instead of every caller pasting a prefix on.
static func _bag_from_decls(decls: Array, path_prefix: String) -> StoryletPropertyBag:
	return StoryletPropertyBag.new(decls, {
		"normalise": func(n: String) -> String: return n,
		"path_prefix": path_prefix,
	})


# --- the owner segment of a property address (design change 4.4) -----------------

## @internal - file one entity under its scope, both ways round. A repeated
## gameId leaves the first winner in place: see the note on _owner_ids.
func _index_owner(kind: String, entity: Dictionary) -> void:
	var game_id := StoryletBundle.effective_game_id(entity)
	var id := str(entity["id"])
	(_owner_game_ids[kind] as Dictionary)[id] = game_id
	var by_game_id: Dictionary = _owner_ids[kind]
	if not by_game_id.has(game_id):
		by_game_id[game_id] = id


## @internal - the value scope's index, whole: the segment each tag PRINTS,
## every segment an address ACCEPTS, the gameIds that need qualifying, and the
## box-qualified forms of the project map's zones, which are refused.
##
## Built from the whole bundle rather than tag by tag, because whether a tag's
## own gameId is enough is a question about the OTHER boxes. The qualified form
## is always accepted; the short form is accepted while one tag in the bundle
## carries the gameId and refused when more do.
func _index_value_owners(bundle: Dictionary) -> void:
	var ids: Array[String] = []
	var game_ids: Array[String] = []
	var qualified: Array[String] = []
	for box in bundle["boxes"]:
		var box_game_id := StoryletBundle.effective_game_id(box)
		for group in box["tagGroups"]:
			for tag in group["tags"]:
				var game_id := StoryletBundle.effective_game_id(tag)
				ids.append(str(tag["id"]))
				game_ids.append(game_id)
				qualified.append("%s/%s" % [box_game_id, game_id])
	# Distinct qualified forms per gameId. Distinct rather than a count: two
	# groups in ONE box may also name a tag the same way, and a refusal that
	# offered the same address twice would be no help at all. That last case is
	# closing at the source rather than here (question 16, ruled 2026-09-06):
	# the compiler warns that a tag gameId must be unique within its box,
	# across all of that box's groups, and refuses it from the next release.
	# Until then the first in bundle order answers, as it always did.
	var forms: Dictionary = {}
	for i in ids.size():
		var list: Array = forms.get(game_ids[i], [])
		if not list.has(qualified[i]):
			list.append(qualified[i])
		forms[game_ids[i]] = list
	var by_id: Dictionary = _owner_game_ids["value"]
	var by_segment: Dictionary = _owner_ids["value"]
	var repeated: Dictionary = _owner_repeated["value"]
	for i in ids.size():
		var candidates: Array = forms[game_ids[i]]
		var ambiguous := candidates.size() > 1
		by_id[ids[i]] = qualified[i] if ambiguous else game_ids[i]
		if not by_segment.has(qualified[i]):
			by_segment[qualified[i]] = ids[i]
		if not ambiguous and not by_segment.has(game_ids[i]):
			by_segment[game_ids[i]] = ids[i]
		if ambiguous:
			repeated[game_ids[i]] = candidates
	# The zones, after the box tags and never in `repeated`. A zone whose gameId
	# a box tag also uses is a bundle refused at construction, so the "first in
	# wins" below decides nothing in a bundle that loads; it keeps the box tag's
	# short form rather than letting the zone take it over silently.
	var map = bundle.get("map")
	if map is Dictionary:
		var zone_qualified: Dictionary = _owner_zone_qualified["value"]
		for tag in map["group"]["tags"]:
			var game_id := StoryletBundle.effective_game_id(tag)
			by_id[str(tag["id"])] = game_id
			if not by_segment.has(game_id):
				by_segment[game_id] = str(tag["id"])
			for box in bundle["boxes"]:
				zone_qualified["%s/%s" % [StoryletBundle.effective_game_id(box), game_id]] = game_id


## @internal - one owned property owner's ADDRESS, segment and all:
## "box.village" for the box whose internal id is "b_village".
##
## The stores, the save envelope and the ladders stay keyed by internal id - a
## save must survive a rename, which is the whole reason ids exist - so this is
## the one place the two vocabularies meet, and it is a formatter, never a
## lookup key. An owner the build no longer has (a save that outlived an edit)
## keeps the id it arrived with: there is no gameId left to give it, which is
## the rule a load report's evictions have always used.
func address_of(kind: String, id: String) -> String:
	var game_id = (_owner_game_ids[kind] as Dictionary).get(id)
	return "%s.%s" % [kind, game_id if game_id != null else id]


## @internal - the same address's owner segment resolved back to the internal id
## the stores are keyed by: {"id", "legacy"}, or {} when the segment names no
## owner at all (which is the caller's "no <kind> store" refusal), or
## {"ambiguous": [candidates]} for a short-form value segment more than one box
## answers to (which the caller REFUSES, naming them), or {"zone": zone} for
## a box-qualified value segment naming a project-map zone (refused too, naming
## the short form). "legacy" says the caller
## used the pre-4.4 form - an internal id where a gameId belongs - which
## resolves for THIS release and earns a diagnostic; the next lockstep release
## refuses it, in every scope including "value".
func resolve_owner(kind: String, segment: String) -> Dictionary:
	# Checked before the lookup, because the short form is deliberately NOT in
	# the segment map when it is ambiguous: silently picking the first tag in
	# bundle order is the bug this removes.
	var candidates = (_owner_repeated[kind] as Dictionary).get(segment)
	if candidates != null:
		return {"ambiguous": candidates}
	# A box-qualified form of a project-map zone: never accepted, because the
	# zone belongs to no box (design/project-map-contract.md 3.4).
	var zone = (_owner_zone_qualified[kind] as Dictionary).get(segment)
	if zone != null:
		return {"zone": str(zone)}
	var by_game_id = (_owner_ids[kind] as Dictionary).get(segment)
	if by_game_id != null:
		return {"id": str(by_game_id), "legacy": false}
	# A gameId that equals its id took the branch above, so anything reaching
	# here and known as an id is genuinely the old spelling.
	if (_owner_game_ids[kind] as Dictionary).has(segment):
		return {"id": segment, "legacy": true}
	return {}


## @internal - what an ambiguous short-form value address is told: the
## candidates, in full, because "that names two tags" without them leaves a host
## reading a bundle it did not write to find out which boxes.
func ambiguous_address_message(segment: String, name: String, candidates: Array) -> String:
	var forms: Array[String] = []
	for q in candidates:
		forms.append('"value.%s.%s"' % [str(q), name])
	var list := ""
	if forms.size() == 1:
		list = forms[0]
	elif forms.size() > 1:
		list = ", ".join(forms.slice(0, forms.size() - 1)) + " or " + forms[forms.size() - 1]
	return '"value.%s.%s" names a tag in %d boxes; write %s' % [segment, name, candidates.size(), list]


## @internal - what a box-qualified address naming a project-map zone is told:
## why the form is wrong, and the address that works.
func zone_qualified_address_message(segment: String, zone: String, name: String) -> String:
	return '"value.%s.%s": "%s" is a zone of the project map, which belongs to no box; write "value.%s.%s"' \
		% [segment, name, zone, zone, name]


## @internal - what a legacy address is told. It NAMES the address to move to,
## because "that form is deprecated" without the replacement leaves a host
## grepping a bundle for ids it never chose.
func legacy_address_message(kind: String, segment: String, name: String) -> String:
	return '"%s.%s.%s" names the %s by its internal id; write "%s.%s". The internal-id form is refused after the next release.' \
		% [kind, segment, name, kind, address_of(kind, segment), name]


## new StoryletEngine(bundle, opts). Options: {"seed": int (default 0; each
## flow's PRNG default), "log": bool | {"cap": int} (per-flow retained
## logs), "world": {"get": Callable, "set": Callable?} (the host's @world
## resolver, never saved), "registry": StoryletScopeRegistry (the game's one
## registry)}. Unknown option keys are an error: returns null with push_error.
##
## "registry" is the game's ONE registry, holding every engine's properties
## except those the game keeps itself, saved once. Given one, the engine
## registers its own scopes in it (@story under `story`, every other bag under
## a key starting `storylets/`, and @world if "world" is passed), reads every
## other scope from it, and save_game() leaves the property values to the
## game. @world is then the game's to register: owned if the registry should
## store it, foreign if the game keeps it. Omit it and the engine makes its own
## registry and acts as its own game: it self-backs @world from the declared
## defaults, and save_game() carries the registry's values too. Any copy of the
## shared registry will do, so a game combining this addon with Patterplay
## passes both engines the same one.
##
## A token another engine already holds in that registry refuses the engine:
## null with push_error naming the holder, and the registry left as it was. So
## does a bundle this engine cannot read faithfully: a schema tag it does not
## know, or a project map whose rules the bundle breaks
## (design/project-map-contract.md 3.8; see _unreadable_bundle_error).
static func create(bundle: Dictionary, opts: Dictionary = {}) -> StoryletEngine:
	var bad := _options_error(opts)
	if bad != "":
		push_error("StoryletEngine.create: " + bad)
		return null
	var engine := StoryletEngine.new(bundle, opts)
	if engine._init_error != "":
		push_error("StoryletEngine.create: " + engine._init_error)
		return null
	return engine


## @internal - why this engine cannot read `bundle` faithfully, or "" when it
## can (design/project-map-contract.md 3.8). One message naming every problem
## found, each naming the box and the group or tag at fault, starting
## "bundle refused: "; the schema tag is checked alone and first.
##
## The compiler refuses all of these first. The engine checks again because it
## cannot tell a hand-built or stale bundle from a compiled one, and the
## alternative is the silent half-working the server audit found twice: a hand
## whose bound group is looked up in the wrong place comes back empty, and an
## old runtime given a map bundle deals plausibly while every zone value is
## missing. Only what would make the engine's OWN resolution ambiguous or
## wrong is refused here; the compiler's bundle-wide group-name rule is
## stricter.
static func _unreadable_bundle_error(bundle: Dictionary) -> String:
	# The schema tag (D4). Alone and first: a bundle of a schema this runtime
	# does not know may not have any of the shape the rest reads.
	var schema_refused := StoryletBundle.schema_error(bundle)
	if schema_refused != "":
		return schema_refused
	var problems: Array[String] = []
	var map = bundle.get("map")
	var group = map["group"] if map is Dictionary else null
	var map_name := StoryletBundle.effective_game_id(group) if group != null else ""
	if group != null and map_name == StoryletBundle.PLACE_GROUP:
		problems.append('the project map\'s tag group is called "%s", which is reserved for a box\'s own hands' % StoryletBundle.PLACE_GROUP)
	# Every box tag gameId, for the zone-name rule: a zone's address has no
	# qualified form to fall back on (3.4), so any box tag sharing it anywhere
	# makes "value.<zone>.<name>" ambiguous. The first box and group in bundle
	# order is the one named.
	var box_tags: Dictionary = {}
	for box in bundle.get("boxes", []):
		for g in box.get("tagGroups", []):
			for tag in g.get("tags", []):
				var game_id := StoryletBundle.effective_game_id(tag)
				if not box_tags.has(game_id):
					box_tags[game_id] = {"box": StoryletBundle.effective_game_id(box), "group": StoryletBundle.effective_game_id(g)}
	if group != null:
		for tag in group.get("tags", []):
			var zone := StoryletBundle.effective_game_id(tag)
			var clash = box_tags.get(zone)
			if clash != null:
				problems.append('the project map\'s zone "%s" has the name of tag "%s" in box "%s", group "%s", so "value.%s.<name>" would name two things' \
					% [zone, zone, clash["box"], clash["group"], zone])
	for box in bundle.get("boxes", []):
		var box_name := StoryletBundle.effective_game_id(box)
		if box.get("usesMap", false) == true:
			if group == null:
				problems.append('box "%s" uses the project map, but the bundle has no map' % box_name)
				continue
			# One namespace in an opted-in box (3.1): a box group with the map's
			# name would make every name-based lookup there a coin toss.
			for g in box.get("tagGroups", []):
				if StoryletBundle.effective_game_id(g) == map_name:
					problems.append('box "%s" uses the project map and declares its own tag group "%s", the map\'s name' % [box_name, map_name])
					break
			continue
		if group == null:
			continue
		# A box NOT on the map may not reference its group at all: every route a
		# reference takes, card tags, template bindings and choices, a hand's
		# chosen tags and a rule's bindings, by the group's id as written.
		var map_id: String = group["id"]
		var where: Array[String] = []
		for deck in box.get("decks", []):
			for card in deck.get("cards", []):
				if (card.get("tags", {}) as Dictionary).has(map_id):
					where.append('card "%s"' % StoryletBundle.effective_game_id(card))
		for template in box.get("handTemplates", []):
			if (template.get("bindings", {}) as Dictionary).has(map_id) or (template.get("chooses", []) as Array).has(map_id):
				where.append('hand template "%s"' % StoryletBundle.effective_game_id(template))
		for hand in box.get("hands", []):
			var rule = hand.get("rule")
			var rule_binds: bool = rule is Dictionary and (rule.get("bindings", {}) as Dictionary).has(map_id)
			if (hand.get("chosen", {}) as Dictionary).has(map_id) or rule_binds:
				where.append('hand "%s"' % StoryletBundle.effective_game_id(hand))
		for w in where:
			problems.append('box "%s" is not on the project map, but %s names the map\'s tag group "%s"' % [box_name, w, map_name])
	if problems.is_empty():
		return ""
	return "bundle refused: " + "; ".join(problems)


## What is wrong with create's options, or "" when nothing is.
static func _options_error(opts: Dictionary) -> String:
	for key in opts:
		if not CREATE_OPTION_KEYS.has(key):
			return 'unknown option "%s" (valid: %s)' % [key, ", ".join(CREATE_OPTION_KEYS)]
	if opts.has("log"):
		var log_opt = opts["log"]
		if not (log_opt is bool) and not (log_opt is Dictionary):
			return "log option must be a bool or {\"cap\": int}"
		if log_opt is Dictionary:
			for key in log_opt:
				if key != "cap":
					return 'unknown log option key "%s"' % key
	if opts.has("world"):
		var w = opts["world"]
		if not (w is Dictionary) or not (w.get("get") is Callable):
			return 'world option must be {"get": Callable, "set": Callable?}'
	if opts.has("registry") and not _is_registry(opts["registry"]):
		return "registry option must be a scope registry (StoryletScopeRegistry, or any copy of the shared one)"
	return ""


## Duck-typed, because a combined game may hand over the registry another
## addon's shim built: the same shared source under another class name.
static func _is_registry(r) -> bool:
	return r is Object and r.has_method("mount_owned") and r.has_method("discard_parked") \
		and r.has_method("define_foreign") and r.has_method("to_eval_context")


## Freed: every flow still open closes, so a handle a host kept refuses (naming
## the cause) instead of reaching for an engine that is gone. A flow holds its
## engine weakly (see StoryletFlow), which is what lets this run at all: the
## two held each other strongly, and neither was ever freed.
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for flow in _flows.values():
			(flow as StoryletFlow).engine_freed()


func _init(bundle: Dictionary, opts: Dictionary = {}) -> void:
	# A copy: the host's own Dictionary stays the host's, and an edit to it after
	# create() must not change what a later hot_swap rebuilds with.
	_creation_options = opts.duplicate()
	_bundle = bundle
	# First, before anything is indexed or registered: a bundle this engine
	# cannot read faithfully is refused whole (design/project-map-contract.md
	# 3.8), and a refusal must leave the game's registry untouched.
	_init_error = _unreadable_bundle_error(bundle)
	if _init_error != "":
		return
	_external_scopes = StoryletBundle.external_scopes(bundle)
	# Reduced as JS's toUint32 reduces it: int() first clamped a seed of 2^63 or
	# more to int64 before the reduction ever saw it (2026-10-06).
	_seed = StoryletMulberry32.to_uint32(float(opts.get("seed", 0)))
	var log_opt = opts.get("log", false)
	if log_opt is Dictionary:
		_log_cap = int(log_opt.get("cap", 1000))
	elif log_opt is bool and log_opt:
		_log_cap = 1000
	_dialect = StoryletDialect.dialect()
	if opts.has("world"):
		_host_world = opts["world"]
	_owns_registry = not opts.has("registry") or opts["registry"] == null
	_registry = StoryletScopeRegistry.new() if _owns_registry else opts["registry"]
	# Diagnostics hook (opt-in, dev only): a Callable(id: String, dealt: int)
	# fired when open_flow REPLACES a flow that still had cards dealt. Behaviour
	# is unchanged; this makes observable the host that calls open_flow straight
	# after load_game and discards the restored hand - get_flow is the call.
	# Parity with the JS runtime's onReplacedFlow. Zero cost when unset.
	_on_replaced_flow = opts.get("on_replaced_flow")

	# The value scope's segments come off the whole bundle at once (a tag gameId
	# is only unique within its group), so they are built before the walk rather
	# than tag by tag inside it.
	_index_value_owners(_bundle)

	for box in _bundle["boxes"]:
		_boxes_by_id[box["id"]] = box
		_boxes_by_game_id[StoryletBundle.effective_game_id(box)] = box
		_index_owner("box", box)
		for group in box["tagGroups"]:
			_groups_by_id[group["id"]] = {"group": group, "box": box}
			if group.get("required", false):
				_required_groups[group["id"]] = true
		for deck in box["decks"]:
			_index_owner("deck", deck)
			if deck.get("shared", false) == true:
				_has_shared = true
			for card in deck["cards"]:
				var entry := {"card": card, "deck": deck, "box": box}
				_cards_by_id[card["id"]] = entry
				_cards_by_game_id[StoryletBundle.effective_game_id(card)] = entry
				if card.get("shared", false) == true:
					_has_shared = true
				if _card_is_durable(card, deck):
					var side := "shared_cards" if StoryletFlow._card_is_shared(card, bool(deck.get("shared", false))) else "flow_cards"
					(_durable[side] as Array).append(entry)
		for template in box["handTemplates"]:
			_templates_by_id[template["id"]] = template
		for hand in box["hands"]:
			_hands_by_id[hand["id"]] = {"hand": hand, "box": box}
			_hands_by_game_id[StoryletBundle.effective_game_id(hand)] = {"hand": hand, "box": box}
			_index_owner("hand", hand)
	# The project map's group: by id like any group, so a hand's binding, a
	# filled hole and tag matching need no logic of their own for it. Which
	# boxes may NAME it is the flow's _group_in_box (3.1); which may reference
	# it at all was settled by the refusal above.
	var map = _bundle.get("map")
	if map is Dictionary:
		var map_group: Dictionary = map["group"]
		_groups_by_id[map_group["id"]] = {"group": map_group}
		if map_group.get("required", false):
			_required_groups[map_group["id"]] = true
	_init_ladders()

	# Both halves, precomputed once (a bundle never changes): each open_flow
	# builds its bags from the per-flow half, and a load report asks either half
	# what it declares without building anything at all.
	var fd := {"story": _half("story", _bundle["story"].get("properties", []), false),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	var sd := {"story": _half("story", _bundle["story"].get("properties", []), true),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	for box in _bundle["boxes"]:
		fd["box"][box["id"]] = _half("box", box.get("properties", []), false)
		sd["box"][box["id"]] = _half("box", box.get("properties", []), true)
		for deck in box["decks"]:
			fd["deck"][deck["id"]] = _half("deck", deck.get("properties", []), false)
			sd["deck"][deck["id"]] = _half("deck", deck.get("properties", []), true)
		for hand in box["hands"]:
			var decls := hand_decls(hand)
			fd["hand"][hand["id"]] = _half("hand", decls, false)
			sd["hand"][hand["id"]] = _half("hand", decls, true)
	# Every box's tags, then the project map's zones ONCE (design/project-map-
	# contract.md 3.3): a zone is one bag per partition, whichever boxes' hands
	# are dealt to it.
	for group in StoryletBundle.all_tag_groups(_bundle):
		for tag in group["tags"]:
			fd["value"][tag["id"]] = _half("value", tag.get("properties", []), false)
			sd["value"][tag["id"]] = _half("value", tag.get("properties", []), true)
	_flow_decls = fd
	_shared_decls = sd
	_durable["shared"] = _durable_props(_shared_decls)
	_durable["flow"] = _durable_props(_flow_decls)

	_init_shared()


## Build the shared stores, register them and @world, once, for the engine's
## life: reset and loads reseed the bags in place, so the registry never sees
## them come and go.
##
## The bags are KEYED by internal id and ADDRESSED by gameId; see address_of.
## A registration the registry refuses (a token clash) hands back everything
## this engine registered before it, keeping the values, and sets _init_error:
## a clash leaves the game's registry as it was.
func _init_shared() -> void:
	var at := func(kind: String, owner_id: String) -> String: return address_of(kind, owner_id) + "."
	var shared := {"story": _bag_from_decls(_shared_decls["story"], "story."),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	for box in _bundle["boxes"]:
		shared["box"][box["id"]] = _bag_from_decls(_shared_decls["box"][box["id"]], at.call("box", box["id"]))
		for deck in box["decks"]:
			shared["deck"][deck["id"]] = _bag_from_decls(_shared_decls["deck"][deck["id"]], at.call("deck", deck["id"]))
		for hand in box["hands"]:
			shared["hand"][hand["id"]] = _bag_from_decls(_shared_decls["hand"][hand["id"]], at.call("hand", hand["id"]))
	# The zones once, after the boxes' tags (3.3).
	for group in StoryletBundle.all_tag_groups(_bundle):
		for tag in group["tags"]:
			shared["value"][tag["id"]] = _bag_from_decls(_shared_decls["value"][tag["id"]], at.call("value", tag["id"]))
	_shared = shared
	var world_decls: Array = _bundle["world"].get("properties", [])
	# Built in a static function, so the lambda holds no reference to this engine:
	# the registry keeps it, and a lambda made here would tie the two in a cycle.
	var identity := _identity()
	var registered: Array[String] = []
	var refused := ""
	# `story` is this engine's token whether or not the bundle declares a shared
	# @story property: registering it is what makes a clash show at once. A
	# registration claims whatever values the game loaded for its key first.
	# Each registration is remembered as it lands (_shared_mounts), so a failed
	# hot_swap can register this engine again exactly as it was.
	refused = _mount_shared({"key": "story", "bag": shared["story"]})
	if refused == "":
		registered.append("story")
		for kind in OWNED_KINDS:
			for id in shared[kind]:
				var bag: StoryletPropertyBag = shared[kind][id]
				if bag.declarations().is_empty():
					continue   # holds nothing: not registered
				refused = _mount_shared({"key": shared_key(kind, id), "bag": bag})
				if refused != "":
					break
				registered.append(shared_key(kind, id))
			if refused != "":
				break
	if refused == "":
		if _host_world != null:
			# The game keeps these values: an external scope, never saved.
			var resolver := {"get": _host_world["get"]}
			if _host_world.get("set") is Callable:
				resolver["set"] = _host_world["set"]
			refused = _mount_shared({"key": "world", "resolver": resolver, "decls": world_decls})
			if refused == "":
				registered.append("world")
		elif _owns_registry and not _registry.has("world"):
			# Standalone: self-backed from the declared defaults, DECLARATIONS AND
			# ALL, as a property the registry stores and SAVES (only a resolver the
			# game binds is external). The bag keeps `writable: false` so an
			# examiner still reads it there, and the kernel lets a host write past
			# it, which is what the game's own surface passes.
			refused = _registry.define_owned("world", world_decls, {"normalise": identity, "path_prefix": "world.", "owner": OWNER})
			if refused == "":
				registered.append("world")
				_shared_mounts.append({"key": "world", "bag": _registry.owned_bag("world")})
				_self_world = true
		# Given the game's registry and no resolver, @world is the game's to
		# register: this engine registers nothing for it.
	if refused != "":
		for key in registered:
			_registry.remove(key, {"keep": true})   # a clash leaves the game's registry as it was
		_shared_mounts = []
		_self_world = false
		_init_error = refused


## Register one shared scope, and remember how (see _shared_mounts). Returns
## the registry's refusal, or "".
func _mount_shared(m: Dictionary) -> String:
	var refused := _register_mount(m)
	if refused == "":
		_shared_mounts.append(m)
	return refused


## One _shared_mounts entry into the registry. Returns the refusal, or "".
func _register_mount(m: Dictionary) -> String:
	if m.has("resolver"):
		return _registry.define_foreign(m["key"], m["resolver"], m["decls"], {"normalise": _identity(), "owner": OWNER})
	return _registry.mount_owned(m["key"], m["bag"], {"owner": OWNER})


## Identity name normalisation: storylets property names are case-significant
## as authored.
static func _identity() -> Callable:
	return func(n: String) -> String: return n


## Every shared bag back to its declared defaults, in place (the registry keeps
## them registered), the self-backed @world included.
func _reseed_shared() -> void:
	(_shared["story"] as StoryletPropertyBag).reseed(_shared_decls["story"])
	for kind in OWNED_KINDS:
		for id in _shared[kind]:
			(_shared[kind][id] as StoryletPropertyBag).reseed(_shared_decls[kind].get(id, []))
	if _self_world:
		_registry.reseed_owned("world", _bundle["world"].get("properties", []))


# --- registry keys (in the save, so identical on every runtime) --------------------
#
# `story` for the shared @story; `storylets/<kind>/<id>` for a shared box, deck,
# hand, or value bag; `storylets/flow/<flow>/story` and
# `storylets/flow/<flow>/<kind>/<id>` for a flow's own. Owners are keyed by
# INTERNAL id, as the save always was, so a save survives a rename. An id escapes
# `%` as `%25`, then `/` as `%2F`, so no two keys can meet.

static func _esc(id: String) -> String:
	return id.replace("%", "%25").replace("/", "%2F")


static func _unesc(id: String) -> String:
	return id.replace("%2F", "/").replace("%25", "%")


static func shared_key(kind: String, id: String) -> String:
	return "storylets/%s/%s" % [kind, _esc(id)]


static func flow_prefix(flow_id: String) -> String:
	return "storylets/flow/%s/" % _esc(flow_id)


## A flow's key: kind "story" takes no id.
static func flow_key(flow_id: String, kind: String, id: String = "") -> String:
	if kind == "story":
		return flow_prefix(flow_id) + "story"
	return "%s%s/%s" % [flow_prefix(flow_id), kind, _esc(id)]


## The registry this engine's bags live in: the game's, the very object create's
## "registry" option passed in, or the one the engine made because it was given
## none. The same object for the engine's life. Untyped, as the option is: a
## combined game's registry may be another addon's shim. A hot_swap replacement
## built on the game's registry answers that same registry; a standalone
## engine's replacement makes its own.
func registry():
	return _registry


## @internal - every OTHER scope in the registry, as an eval context sees it:
## {"scopes": token -> Dictionary | Callable, "qualities": Callable | null}.
## Instance keys (`storylets/deck/x`, another engine's) are no expression token,
## so they are left out. Rebuilt only when the registry's set of scopes moves:
## the values a context reads stay live.
func registry_view() -> Dictionary:
	var rev: int = _registry.revision
	if rev != _view_revision:
		var ctx: Dictionary = _registry.to_eval_context()
		var scopes := {}
		var all: Dictionary = ctx.get("scopes", {})
		for k in all:
			if not str(k).contains("/"):
				scopes[k] = all[k]
		_view_cache = {"scopes": scopes, "qualities": ctx.get("qualities")}
		_view_revision = rev
	return _view_cache


## @internal - a tag group NAME (or id) resolved inside one box, or null. Tag
## group names are box-scoped (schema 1), so a name is only ever resolved
## inside the box being asked, never bundle-wide; ids are project-unique and
## accepted too, still confined to the box.
##
## A box on the project map sees ONE namespace: its own groups, then the map's
## group (design/project-map-contract.md 3.1). A box that has not opted in does
## not see the map's name at all, so a peek naming it there is the ordinary
## unknown-group refusal. Own groups first is stated for determinism only: a
## bundle that loads never has the two share a name.
##
## Memoised, because the answer depends on the bundle alone and the history
## functions ask it once per candidate card per ask.
func group_in_box(box: Dictionary, reference: String) -> Variant:
	var key := "%s%s%s" % [box["id"], REPORT_SEP, reference]
	if _group_memo.has(key):
		return _group_memo[key]
	var found = null
	var groups := StoryletBundle.groups_of_box(_bundle, box)
	for group in groups:
		if StoryletBundle.effective_game_id(group) == reference:
			found = group
			break
	if found == null:
		for group in groups:
			if group["id"] == reference:
				found = group
				break
	_group_memo[key] = found
	return found


## @internal - a group NAME and tag name resolved in one box, as a flow's
## play-history index key, with that box in it: a zone's plays in another box
## are not this box's history. Null when either is unknown here, which reads as
## "never". Memoised like group_in_box, for the same reason.
func tag_key_in(box: Dictionary, group: String, tag: String) -> Variant:
	var memo_key := "%s%s%s%s%s" % [box["id"], REPORT_SEP, group, REPORT_SEP, tag]
	if _tag_key_memo.has(memo_key):
		return _tag_key_memo[memo_key]
	var key = null
	var found = group_in_box(box, group)
	if found != null:
		for v in found["tags"]:
			if v.get("gameId") == tag:
				key = StoryletFlow._tag_key(box["id"], found["id"], v["id"])
				break
	_tag_key_memo[memo_key] = key
	return key


## A hand's declarations: its template's, for a template hand. Only ever
## called once _init has indexed every template, so an unknown template has
## none.
func hand_decls(hand: Dictionary) -> Array:
	if hand.has("template"):
		var known = _templates_by_id.get(hand["template"])
		return known.get("properties", []) if known != null else []
	return hand.get("properties", [])


func _init_ladders() -> void:
	var grab := func(decls: Array) -> Dictionary:
		var m := {}
		for d in decls:
			if str(d.get("type", "")) == "quality" and d.get("stages") != null:
				m[d["name"]] = d["stages"]
		return m
	_world_ladders = grab.call(_bundle.get("world", {}).get("properties", []))
	_story_ladders = grab.call(_bundle.get("story", {}).get("properties", []))
	for box in _bundle.get("boxes", []):
		_box_ladders[box["id"]] = grab.call(box.get("properties", []))
		for deck in box.get("decks", []):
			_deck_ladders[deck["id"]] = grab.call(deck.get("properties", []))
		for group in box.get("tagGroups", []):
			for tag in group.get("tags", []):
				_value_ladders[tag["id"]] = grab.call(tag.get("properties", []))
		for hand in box.get("hands", []):
			_hand_ladders[hand["id"]] = grab.call(hand_decls(hand))
	# The zones, once, keyed by tag id like every other tag (3.3).
	var map = _bundle.get("map")
	if map is Dictionary:
		for tag in map["group"].get("tags", []):
			_value_ladders[tag["id"]] = grab.call(tag.get("properties", []))
	_has_qualities = not (_world_ladders.is_empty() and _story_ladders.is_empty())
	for owners in [_box_ladders, _deck_ladders, _value_ladders, _hand_ladders]:
		if _has_qualities:
			break
		for m in (owners as Dictionary).values():
			if not (m as Dictionary).is_empty():
				_has_qualities = true
				break


# --- the @world seam -----------------------------------------------------------

## @world, read through the registry by name (the scope's own normalisation),
## so a @world the game registered folded to lower case still answers the names
## as authored. null when nothing answers: no such property, or a game that
## passed its registry and has not registered @world.
func world_get(name: String) -> Variant:
	return _registry.get_value("world", name)


## The @world WRITE seam. `host` says the caller is the GAME's own surface -
## set_property and the tooling built on it - which the shared kernel lets past
## a `writable: false`: that flag is the story's promise, not the game's. The
## story's refusal is world_read_only, asked before this seam is reached. A
## BOUND resolver is opaque - it takes a name and a value and keeps whatever
## rule the game has - so every write to it passes host, and the story's flag
## is kept by world_read_only alone. Call world_can_set() first: this writes
## nothing without a setter. Returns "" or the registry's refusal (a game that
## passed its registry and never registered @world, say).
func world_set(name: String, value, host: bool = false) -> String:
	if _host_world != null:
		if not world_can_set():
			return "@world is read-only here: the host bound no write"
		return _registry.set_value("world", name, value, {"host": true})
	return _registry.set_value("world", name, value, {"host": true} if host else {})


## Whether @world can be written at all (a host may bind a resolver with no set).
func world_can_set() -> bool:
	return _host_world == null or _host_world.get("set") is Callable


## The story's promise about a @world value (writable: false on its declaration).
## Read by a flow before it writes; the host's own set_property never asks.
func world_read_only(name: String) -> bool:
	for d in _bundle.get("world", {}).get("properties", []):
		if d.get("name", "") == name:
			return d.get("writable", true) == false
	return false


# --- flow management (Patter's surface, name for name) --------------------------

## Open (or REPLACE) the named flow. An existing id's flow is closed first -
## re-opening a name is a reset of that name's whole per-flow state; shared
## state is untouched. There is no default flow: "main" is a caller
## convention, not an engine rule. Options: {"seed": int} overrides the
## engine's default for this flow's PRNG. Content that names another engine's
## scope nothing on this registry registered is refused: null with push_error,
## and nothing is touched.
##
## {"durable": pocket} opens the flow with its POCKET in, a durable half from
## flow.save_durable() (ruling H): the flow starts as any new flow does, on its
## own seed and clocks, with the pocket's values laid over its defaults and its
## durable spends spent. What no longer fits this build is reported through
## "on_restore_report", as load_durable reports the engine's half. Refused,
## before anything changes, with "restore" beside it (a restore already carries
## the flow's durable values, so a pocket would be a second answer for the same
## property), and for another project's pocket or an unknown schema.
func open_flow(id: String, opts: Dictionary = {}) -> StoryletFlow:
	for key in opts:
		if not OPEN_FLOW_OPTION_KEYS.has(key):
			push_error('StoryletEngine.open_flow: unknown option "%s" (valid: %s)' % [key, ", ".join(OPEN_FLOW_OPTION_KEYS)])
			return null
	return _open(id, opts, false)


## open_flow, and load_game's rebuild. `claim` says the new flow's bags take the
## values the registry holds for them (a load); a fresh open is a reset of that
## name, so anything waiting for it is discarded first.
func _open(id: String, opts: Dictionary, claim: bool) -> StoryletFlow:
	if opts.has("durable") and opts.has("restore"):
		push_error('StoryletEngine.open_flow: openFlow "%s": restore and durable cannot be given together; a restore already carries the flow\'s durable state' % id)
		return null
	# A pocket is checked and planned before the name is touched: a refusal, and
	# anything the plan finds, must leave the flow already open as it was.
	var durable = null
	if opts.has("durable"):
		var refused := _durable_refusal(opts["durable"])
		if refused != "":
			push_error("StoryletEngine.open_flow: " + refused)
			return null
		var durable_draft := _empty_draft()
		durable = {
			"plan": _plan_durable(_durable["flow"], _durable["flow_cards"], opts["durable"], id, durable_draft),
			"draft": durable_draft,
			"content": opts["durable"]["content"],
		}
	var unregistered := _external_scope_refusal()
	if unregistered != "":
		push_error("StoryletEngine.open_flow: " + unregistered)
		return null
	# The world's claims as they stand WITHOUT this name, taken before the
	# replace: a resume competes with the other flows, never with the flow it is
	# replacing (which is about to release everything it holds).
	var other_claims = shared_claims(id) if opts.has("restore") else null
	var old = _flows.get(id)
	if old != null:
		# Say so BEFORE the old flow goes inert, while its board is readable.
		var dealt := (old as StoryletFlow).held_card_ids().size()
		if dealt > 0 and _on_replaced_flow is Callable and (_on_replaced_flow as Callable).is_valid():
			(_on_replaced_flow as Callable).call(id, dealt)
		(old as StoryletFlow).mark_closed()
	if not claim:
		_registry.discard_parked(flow_prefix(id))
	var flow := StoryletFlow.new(self, id, StoryletMulberry32.to_uint32(float(opts.get("seed", _seed))))
	_flows[id] = flow
	if opts.has("restore"):
		var draft := _empty_draft()
		var clean := _plan_flow_restore(id, opts["restore"], other_claims, draft)
		flow.restore(clean)
		var on_report = opts.get("on_restore_report")
		if on_report is Callable and (on_report as Callable).is_valid():
			(on_report as Callable).call(_finish_report(_bundle["content"], _bundle["content"], [id], draft))
	if durable != null:
		flow.write_durable(durable["plan"])
		var on_durable_report = opts.get("on_restore_report")
		if on_durable_report is Callable and (on_durable_report as Callable).is_valid():
			(on_durable_report as Callable).call(_finish_report(_bundle["content"], durable["content"], [id], durable["draft"]))
	return flow


func get_flow(id: String) -> Variant:
	return _flows.get(id)


## Every live flow, open order.
func flows() -> Array:
	return _flows.values()


## Close the named flow: its handle goes INERT (every verb refuses). A
## dropped-but-held flow must not keep writing shared state (Patter's
## stale-handle lesson). Unknown ids are a quiet no-op.
func close_flow(id: String) -> void:
	var flow = _flows.get(id)
	if flow == null:
		return
	_flows.erase(id)
	(flow as StoryletFlow).mark_closed()


## @internal - StoryletFlow.close() routes here so both doors agree.
func drop_flow(id: String, flow: StoryletFlow) -> void:
	if _flows.get(id) == flow:
		_flows.erase(id)


## Close every flow and reseed the shared state to its defaults (the
## self-backed @world included; a host-bound @world is the host's and is
## not touched). Each flow's bags leave the registry, and values loaded for
## bags nobody has claimed yet are dropped if they are this engine's: they are
## the old run's too, and a flow opened after the reset must not pick them up.
## Other engines' waiting values stay.
func reset() -> void:
	_drop_run(null)
	_reseed_shared()
	_registry.discard_parked("storylets/")


## End the run: clear the log, close every flow, forget spent cards. Each flow's
## bags leave the registry; `keep_flows` (a Dictionary used as a set, or null)
## names the flows whose values are kept there for the flow that replaces them
## (a load into the game's registry).
func _drop_run(keep_flows) -> void:
	# The log is a run-lifetime utility and is not saved; a reset is a new run.
	_engine_log = []
	for id in _flows:
		var flow := _flows[id] as StoryletFlow
		flow.release_bags(keep_flows != null and (keep_flows as Dictionary).has(id))
		flow.mark_closed()
	_flows = {}
	_spent = {}


# --- shared scarcity (design/shared-scarcity.md) ---------------------------------

## Cards a shared `redraw: "never"` has taken out of the world, by card id
## (a Dictionary used as a set). The claim ledger is DERIVED from live boards
## and needs no storage; this one is durable, so it rides the save.
var _spent: Dictionary = {}


# --- the run's log (design/shared-scarcity.md 8.2) --------------------------------

## Every flow's events in one ordered stream, each tagged with its flow. Opt in
## with the same "log" option the flow logs use; capped the same way.
##
## This exists because a flow's own log cannot answer the question a run raises:
## when a story action in ANOTHER flow moves shared state, your flow's log says
## nothing and your value simply changes.
var _engine_log: Array = []
var _engine_seq: int = 0


## The run's log, oldest first: Array of the flow's log entry plus "flow".
func log() -> Array:
	_engine_log = _capped(_engine_log, _log_cap)
	return _engine_log


## @internal - append one entry to a capped log; returns the log to keep.
## Trimmed back to the cap only once it reaches TWICE the cap, so a full log
## costs one slice per `cap` events where it used to cost one per event; what
## reads a log trims it first (_capped), so a reader never sees the slack.
static func _append_capped(entries: Array, entry: Dictionary, cap: int) -> Array:
	entries.append(entry)
	if entries.size() > cap and entries.size() >= cap * 2:
		return entries.slice(entries.size() - cap)
	return entries


## @internal - a log as its reader sees it: the newest `cap` entries. A
## negative cap is a log that retains nothing, so it is never trimmed.
static func _capped(entries: Array, cap: int) -> Array:
	if cap >= 0 and entries.size() > cap:
		return entries.slice(entries.size() - cap)
	return entries


func clear_log() -> void:
	_engine_log = []


## @internal - has a shared one-shot left the world? Keyed by internal id; the
## `taken` verdict on a deal's trace is how a host learns it.
func is_taken(card_id: String) -> bool:
	return _spent.has(card_id)


## @internal - take a shared one-shot out of the world, as its play does. Keyed
## by internal id. A host carries spends across a run with save_durable and
## load_durable, which speak gameIds and check that the card is still one that
## may be carried (ruling H).
func mark_taken(card_id: String) -> void:
	_spent[card_id] = true


## @internal - keys in the order a JS object holds them (ruling E,
## 2026-10-06): the integer-like ones first, ascending, then the rest in the
## order given. JS is the contract for every keyed result, and any JS that reads
## a save sees this order whatever wrote it (JSON.parse applies it), so the
## save's flows, the order a load reopens them and a deal's or a board's hands
## all follow it.
static func js_key_order(keys: Array) -> Array:
	var ints: Array = []
	var rest: Array = []
	for k in keys:
		if _is_array_index(str(k)):
			ints.append(k)
		else:
			rest.append(k)
	if ints.is_empty():
		return keys
	ints.sort_custom(func(a, b) -> bool: return str(a).to_int() < str(b).to_int())
	return ints + rest


## @internal - the same Dictionary in JS object order: itself when no key is
## integer-like, which is nearly always.
static func js_ordered(d: Dictionary) -> Dictionary:
	var keys := js_key_order(d.keys())
	if keys == d.keys():
		return d
	var out := {}
	for k in keys:
		out[k] = d[k]
	return out


## A JS array index: "0", or digits with no leading zero, below 2^32 - 1. Only
## those are ordered first; "007" and "4294967295" are ordinary keys.
static func _is_array_index(k: String) -> bool:
	if k == "0":
		return true
	if k.is_empty() or k.length() > 10 or k.begins_with("0"):
		return false
	for i in k.length():
		var c := k.unicode_at(i)
		if c < 48 or c > 57:
			return false
	return k.to_int() < 4294967295


## The spent set as a sorted Array, so a save is byte-stable for a diff.
func _spent_ids() -> Array:
	var ids: Array = _spent.keys()
	ids.sort()
	return ids


## Shared claims across every LIVE flow, card id -> holders. Derived, which is
## what makes close_flow and the open_flow replace release what a flow was
## holding: its board leaves the map with it. With `except_id`, that name is
## left out: what the REST of the world holds, which is the question a resume
## under that name has to ask.
func shared_claims(except_id = null) -> Dictionary:
	var counts := {}
	for flow_id in _flows:
		if except_id != null and str(flow_id) == str(except_id):
			continue
		for card_id in (_flows[flow_id] as StoryletFlow).held_card_ids():
			counts[card_id] = counts.get(card_id, 0) + 1
	return counts


# --- engine-level state access ---------------------------------------------------

## Read shared state by path: "world.x", "story.gold" (when shared),
## "box.village.heat" (when shared) - the owner segment is its GAMEID (design
## change 4.4), and its internal id is accepted for this release with a
## `diagnostic` naming the address to move to. A ref that resolves PER-FLOW is
## refused, naming the fix (Patter's teaching rule). Another engine's game-wide
## scope in the same registry reads by its path too ("patter.gold"): every
## engine reads every scope. Returns the value, or null with push_error.
func get_property(path: String) -> Variant:
	var r := _resolve_shared(path)
	if r.has("error"):
		push_error("StoryletEngine.get_property: " + r["error"])
		return null
	var value
	if r["kind"] == "world":
		value = world_get(r["name"])
	elif r["kind"] == "scope":
		value = _registry.get_value(r["token"], r["name"])
	else:
		value = (r["bag"] as StoryletPropertyBag).get_value(r["name"])
	if value == null:
		push_error('StoryletEngine.get_property: no property at "%s"' % path)
		return null
	return value


## Write shared state by path, another engine's game-wide scope included. A
## host write: silent under the firing rule, visible to the bag's audit hook.
## Returns "" or the error message.
func set_property(path: String, value) -> String:
	var r := _resolve_shared(path)
	if r.has("error"):
		push_error("StoryletEngine.set_property: " + r["error"])
		return r["error"]
	if r["kind"] == "world":
		if not world_can_set():
			var msg := "@world is read-only here: the host bound no write"
			push_error("StoryletEngine.set_property: " + msg)
			return msg
		return world_set(r["name"], value, true)
	if r["kind"] == "scope":
		return _registry.set_value(r["token"], r["name"], value, {"host": true})
	# A HOST write, in any scope: silent under the firing rule, visible to the
	# audit hook, and never refused by a `writable: false` - that flag is the
	# story's promise about its own outcomes, and this is the game speaking.
	var change: Dictionary = (r["bag"] as StoryletPropertyBag).set_value(r["name"], value, {"silent": true, "reason": "host setProperty", "host": true})
	if change.has("error"):
		return change["error"]
	return ""


func _resolve_shared(path: String) -> Dictionary:
	var parts := path.split(".")
	if parts.size() == 2 and parts[0] == "world":
		return {"kind": "world", "name": parts[1]}
	# Another engine's game-wide scope (`patter.gold`): every engine reads every scope.
	if parts.size() == 2 and parts[0] != "story" and _registry.has(parts[0]):
		return {"kind": "scope", "token": parts[0], "name": parts[1]}
	if parts.size() == 2 and parts[0] == "story":
		var name := parts[1]
		if (_shared["story"] as StoryletPropertyBag).get_value(name) != null:
			return {"kind": "bag", "bag": _shared["story"], "name": name}
		for d in _flow_decls["story"]:
			if d["name"] == name:
				return {"error": '"%s" is per-flow state - read it on a Flow, not the Engine' % path}
		return {"error": 'no property at "%s"' % path}
	if parts.size() == 3 and OWNED_KINDS.has(parts[0]):
		var kind := parts[0]
		var segment := parts[1]
		var name := parts[2]
		var owner := resolve_owner(kind, segment)
		if owner.has("ambiguous"):
			return {"error": ambiguous_address_message(segment, name, owner["ambiguous"])}
		if owner.has("zone"):
			return {"error": zone_qualified_address_message(segment, owner["zone"], name)}
		if owner.is_empty():
			return {"error": 'no %s store "%s"' % [kind, segment]}
		if owner["legacy"]:
			_diagnose(legacy_address_message(kind, segment, name))
		var id: String = owner["id"]
		var bag = _shared[kind].get(id)
		if bag != null and (bag as StoryletPropertyBag).get_value(name) != null:
			return {"kind": "bag", "bag": bag, "name": name}
		for d in _flow_decls[kind].get(id, []):
			if d["name"] == name:
				return {"error": '"%s" is per-flow state - read it on a Flow, not the Engine' % path}
		if bag == null and not _flow_decls[kind].has(id):
			return {"error": 'no %s store "%s"' % [kind, segment]}
		return {"error": 'no property at "%s"' % path}
	return {"error": 'bad property path "%s"' % path}


## The engine's own surface has no flow, so an engine-level diagnostic carries
## the EMPTY flow id - the same way a load report's shared half carries no flow.
## It reaches the run's log and the engine tap; there is nowhere else for it to
## go, and it fires only on a legacy address.
func _diagnose(message: String) -> void:
	emit_engine("", {"type": "diagnostic", "where": "property address", "message": message})


## Other engines' scopes the content names (the bundle's externalScopes) must
## all be registered by the time a flow opens or a load runs: by then a game has
## built all of its engines, whatever order it built them in. The first token in
## the list the registry does not have is the refusal, or "" when every one is
## there.
func _external_scope_refusal() -> String:
	for token in _external_scopes:
		if not _registry.has(token):
			return ("this content names @%s, which no engine on this registry registered: " % token) \
				+ "give every engine the game's one registry"
	return ""


## The shared surface as examiner rows: @world (read through the resolver)
## then the shared partitions. Per-flow rows live on each flow.
func list_properties() -> Array:
	var out: Array = []
	for d in _bundle["world"].get("properties", []):
		var value = world_get(d["name"])
		# Whether @world can be written at all AND what the declaration says, which
		# is the kernel's own rule for a foreign scope. A row is where
		# `writable: false` is meant to SHOW: it says this is the game's value, not
		# the story's. The engine's rows carried no flag at all until 2026-09-05.
		var row := {"path": "world.%s" % d["name"], "name": d["name"], "type": d.get("type", "string"),
			"value": value if value != null else d.get("default"), "default": d.get("default"),
			"writable": world_can_set() and not world_read_only(d["name"])}
		if d.has("values"):
			row["values"] = d["values"]
		if d.has("stages"):
			row["stages"] = d["stages"]
		out.append(row)
	_add_rows(out, _shared["story"])
	for kind in OWNED_KINDS:
		for id in _shared[kind]:
			_add_rows(out, _shared[kind][id])
	return out


## A bag's examiner rows, copied. The bag addresses each row itself (its
## path_prefix), so there is no mount label to add.
static func _add_rows(out: Array, bag: StoryletPropertyBag) -> void:
	for row in bag.rows():
		out.append((row as Dictionary).duplicate())


## The SHARED kernel bags with their store path prefixes (the state logger's
## mount surface). The @world container is the host's own bag.
func list_bags() -> Array:
	var mounts: Array = [{"prefix": "story", "bag": _shared["story"]}]
	for kind in OWNED_KINDS:
		for id in _shared[kind]:
			mounts.append({"prefix": address_of(kind, id), "bag": _shared[kind][id]})
	return mounts


## Every flow's trace, one stream: handler.call(flow_id, event). Returns the
## unsubscribe Callable.
##
## The same Callable subscribed twice is registered once (ruling F), so one
## unsubscribe removes it. Delivery is from a copy (emit_engine), so a
## subscribe or unsubscribe during an event takes effect from the next.
func subscribe_trace(handler: Callable) -> Callable:
	if not _engine_trace_handlers.has(handler):
		_engine_trace_handlers.append(handler)
	return func() -> void: _engine_trace_handlers.erase(handler)


func engine_tracing() -> bool:
	return not _engine_trace_handlers.is_empty()


## `turn_stamp` is the box clock the event happened on, where the caller knows
## it - the same stamp the flow's own log carries. Unity and Unreal passed it
## from the start; JS and Godot dropped it, so their examiners printed "[-]" on
## every deal, peek, evict and write line (2026-08-29).
func emit_engine(flow_id: String, event: Dictionary, turn_stamp = null) -> void:
	# Retain first, then notify: the run's log is the record, subscribers are
	# the live view, and a handler that reads log() should see its own event.
	if _log_cap >= 0:
		# Shallow, as the flow's own log copies: the entry gets its own keys, and
		# the event's nested parts (a deal's card list) are shared, never written.
		var entry: Dictionary = event.duplicate()
		entry["flow"] = flow_id
		entry["seq"] = _engine_seq
		if turn_stamp != null:
			entry["turn"] = turn_stamp
		_engine_seq += 1
		_engine_log = _append_capped(_engine_log, entry, _log_cap)
	# Over a COPY, and skipping anything freed. Two failures this prevents,
	# both found by the pre-release audit (2026-08-29):
	#
	#   A handler bound to a node that has since been queue_free()d - a scene
	#   change, an entity despawn - is an "attempt to call function on a
	#   previously freed instance" error once per trace event, for every event
	#   after. Only an explicit detach() unhooks, and StoryletLiveLink has no
	#   _exit_tree, so freeing the node is not an exit path that releases this.
	#
	#   A handler that unsubscribes from inside its own call mutates the array
	#   mid-iteration and the next handler is skipped. Unreal copies before
	#   dispatch and Unity calls .ToArray(); JS iterates a Set, where deletion
	#   during iteration is defined. Godot was the outlier.
	for handler in _engine_trace_handlers.duplicate():
		if handler.is_valid():
			handler.call(flow_id, event)


# --- persistence (schema 4) -------------------------------------------------------

func _partition_values(p: Dictionary) -> Dictionary:
	var out := {"story": (p["story"] as StoryletPropertyBag).save(), "box": {}, "deck": {}, "hand": {}, "value": {}}
	for kind in OWNED_KINDS:
		for id in p[kind]:
			out[kind][id] = (p[kind][id] as StoryletPropertyBag).save()
	return out


## Live bundle refresh: rebuild on an edited bundle with the whole run carried
## over. Returns {"ok": true, "engine": the replacement, "report": the
## LoadReport its load produced}, or {"ok": false, "error": message} with
## push_error.
##
## Standalone, that is a save and a load into a new engine, and this one is
## left untouched (discard it). With the game's registry the two cannot both
## hold the same keys, so this engine is spent afterwards (its flows closed,
## the replacement holding everything on the same registry): it carries its
## own values into the snapshot, steps out of the registry, and the
## replacement loads them the way a standalone save loads, so the report
## covers the properties the edit dropped, defaulted, or retyped, and a
## dropped property is dropped rather than kept. Values the game loaded that
## were still waiting for a flow of this engine carry across as they were,
## and nothing belonging to any other engine is touched. A bundle for another
## project is refused before anything moves; if the rebuild fails for any
## other reason, this engine takes its registrations back and is left exactly
## as it was.
##
## `opts` override the options this engine was built with (seed, log, world,
## on_replaced_flow); the registry is always this engine's.
func hot_swap(bundle: Dictionary, opts: Dictionary = {}) -> Dictionary:
	var r := _swap(bundle, opts)
	if not r["ok"]:
		# The project refusal already names itself ("hotSwap: the bundle is for
		# project ...", the text all four runtimes share), so it is not prefixed twice.
		var message := str(r["error"])
		push_error(message if message.begins_with("hotSwap:") else "StoryletEngine.hot_swap: " + message)
	return r


## @internal - hot_swap without the push_error, for StoryletLiveLink, which
## hands a refusal back to the game and never push_errors one.
func _swap(bundle: Dictionary, opts: Dictionary = {}) -> Dictionary:
	var checked := StoryletBundle.load_from_dict(bundle)
	if not checked["ok"]:
		return _swap_refused(str(checked["error"]))
	if _init_error != "":
		return _swap_refused("this engine was refused its registration (%s)" % _init_error)
	if str(bundle["content"]["project"]) != str(_bundle["content"]["project"]):
		# Names the BUNDLE: there is no save in a hot swap, so the load's own "save
		# is for project" wording pointed the reader at the wrong thing.
		return _swap_refused('hotSwap: the bundle is for project "%s", this engine runs "%s"' % [str(bundle["content"]["project"]), str(_bundle["content"]["project"])])
	var options := _creation_options.duplicate()
	options.merge(opts, true)
	options.erase("registry")
	var bad := _options_error(options)
	if bad != "":
		return _swap_refused(bad)
	var snapshot := save_game()
	if _owns_registry:
		# Its own registry: a save and a load into a new engine, as it always
		# was, and this engine is left untouched.
		var alone := StoryletEngine.new(bundle, options)
		if alone._init_error != "":
			return _swap_refused(alone._init_error)
		var own_report := alone.load_game(snapshot)
		if own_report.is_empty():
			return _swap_refused("the replacement refused this engine's save")
		return {"ok": true, "engine": alone, "report": own_report}
	var reg = _registry
	# This engine's own values, registered or still waiting for a flow.
	var mine := {}
	var saved: Dictionary = reg.save()
	for key in saved:
		if key == "story" or str(key).begins_with("storylets/"):
			mine[key] = saved[key]
	var registered := {}
	for m in _shared_mounts:
		registered[m["key"]] = true
	for flow in _flows.values():
		for key in (flow as StoryletFlow).registered_keys():
			registered[key] = true
	var waiting := {}
	for key in mine:
		if not registered.has(key):
			waiting[key] = mine[key]
	# Step out of the registry. The bags keep their values, so stepping back in
	# is exact.
	for m in _shared_mounts:
		if reg.has(m["key"]):
			reg.remove(m["key"])
	for flow in _flows.values():
		(flow as StoryletFlow).release_bags(false)
	options["registry"] = reg
	var next := StoryletEngine.new(bundle, options)
	var error := next._init_error
	if error == "":
		var carried := snapshot.duplicate()
		carried["registry"] = mine
		var report := next.load_game(carried)
		if not report.is_empty():
			# Values that were waiting for a flow wait on, for the replacement's
			# flow of that name.
			var still := {}
			for key in waiting:
				if not reg.has(key):
					still[key] = waiting[key]
			if not still.is_empty():
				reg.load(still, {"keep_parked": true})
			_drop_run(null)
			return {"ok": true, "engine": next, "report": report}
		error = "the replacement refused this engine's save"
	# Back as it was. The replacement's registrations go; a constructor that
	# failed part way parked what it had claimed, so this engine's keys are
	# cleared of anything waiting, registered again, and its own values laid
	# back over them (the waiting ones parked again).
	next._drop_run(null)
	for m in next._shared_mounts:
		if reg.has(m["key"]):
			reg.remove(m["key"])
	reg.discard_parked("storylets/")
	for m in _shared_mounts:
		_register_mount(m)
	for flow in _flows.values():
		(flow as StoryletFlow).mount_bags()
	# `story` may have claimed what the failed replacement parked there: back to
	# its declarations, then this engine's own values over it.
	_reseed_shared()
	reg.load(mine, {"keep_parked": true})
	return _swap_refused(error)


static func _swap_refused(message: String) -> Dictionary:
	return {"ok": false, "error": message}


## The whole engine's NON-property state, one envelope ("storylets/save@2"):
## the spent cards once, then every live flow (board, clocks, cooldowns, PRNG,
## play log) keyed by its id. The property values are the registry's: a
## standalone engine (one that made its own registry) carries them here under
## "registry", self-backed @world included; a game that passed a registry
## saves it once itself, beside each engine's envelope.
func save_game() -> Dictionary:
	var out_flows := {}
	for id in js_key_order(_flows.keys()):
		out_flows[id] = (_flows[id] as StoryletFlow).snapshot(false)
	var out := {
		"schema": StoryletBundle.SAVE_SCHEMA,
		"content": (_bundle["content"] as Dictionary).duplicate(true),
	}
	if _owns_registry:
		out["registry"] = _registry_section()
	out["shared"] = {"spent": _spent_ids()}
	out["flows"] = out_flows
	return out


## The registry's values in CANONICAL order, the order a load rebuilds them in:
## the engine-wide keys as the constructor registered them, then each flow's
## keys in flows() order (each flow's own registration order), then anything
## else the registry holds (values still waiting for a key), as the registry
## lists it. The registry itself lists keys in registration order, and a flow
## replaced in place (open_flow keeps its slot in _flows) re-registers its keys
## at the END, so open_flow("a"); open_flow("b"); open_flow("a") saved b's keys
## before a's while a load rebuilt a's first: the same run, different
## .storyletsave bytes, and a save loaded and saved again no longer equal to
## itself. Order does not matter on READ, so a save written in the old order
## loads as before (2026-10-01).
func _registry_section() -> Dictionary:
	var all: Dictionary = _registry.save()
	var out := {}
	var keys: Array = []
	for m in _shared_mounts:
		keys.append(m["key"])
	# In the order the save lists the flows, which is JS object order (ruling E):
	# a flow id that looks like an integer comes first, and a load reopens the
	# flows in that order, so flows() order would save "main" before "7" here
	# and the loaded engine "7" first.
	for id in js_key_order(_flows.keys()):
		keys.append_array((_flows[id] as StoryletFlow).registered_keys())
	keys.append_array(all.keys())
	for key in keys:
		if all.has(key) and not out.has(key):
			out[key] = all[key]
	return out


## ONE flow's blob, to park a visit that is walking away: the shape the
## envelope carries per flow, plus the flow's property values ("props"), and
## the same shape open_flow's "restore" option takes back
## (design/engine-server.md 4.1). Parked whole, properties included: a parked
## flow's bags leave the registry when it closes, so its values have to travel
## with it. Saving the whole envelope to park one of four hundred players is
## wrong in cost and in meaning. A name that is not open is an error: returns
## {} with push_error, since a closed flow has nothing left to save.
func save_flow(id: String) -> Dictionary:
	var flow = _flows.get(id)
	if flow == null:
		push_error('StoryletEngine.save_flow: unknown flow "%s"' % id)
		return {}
	return (flow as StoryletFlow).snapshot(true)


## The engine's DURABLE HALF, the installation's memory (ruling H): every shared
## `durable` property's value by its address, and every shared durable one-shot
## that has been spent, by card gameId. What a new run starts from, through
## load_durable; a flow's own half is flow.save_durable().
##
## {"schema": "storylets/durable@1", "content": the bundle's content block,
## "values": {address: value}, keys sorted, "spent": [gameId], sorted}: plain
## data, keyed as everything host-facing is (an address exactly as
## list_properties() prints it, a card by its gameId), so it crosses builds and
## a person can read it. A copy: changing it changes nothing here. Write it with
## StoryletSave.to_json, which writes a whole number as JS does (3, not 3.0).
func save_durable() -> Dictionary:
	var spent: Array = []
	for entry in _durable["shared_cards"]:
		if _spent.has(entry["card"]["id"]):
			spent.append(StoryletBundle.effective_game_id(entry["card"]))
	spent.sort()
	return {
		"schema": StoryletBundle.DURABLE_SCHEMA,
		"content": (_bundle["content"] as Dictionary).duplicate(true),
		"values": _durable_values(_shared, _durable["shared"]),
		"spent": spent,
	}


## Write the engine's durable half into this engine, a fresh one at the top of a
## new run (ruling H). Every shared durable property takes the memory's value,
## or its default where the memory carries none that fits, and every spend the
## memory lists is taken out of the world. Nothing else is touched: not a
## run-scoped value, not a flow, not a spend the memory does not name. The writes
## are the host's: silent, and past a `writable: false`, which is the story's
## promise and not the game's.
##
## Returns the report load_game would give, for this half: an address this build
## does not declare durable and shared is dropped, a value its declaration no
## longer takes is retyped, a durable declaration the memory lacks is defaulted,
## and a spend for a card that is no longer a shared durable one-shot is a
## dropped spent card. Another project's memory, or an unknown schema, is
## refused before anything moves: {} with push_error.
func load_durable(memory) -> Dictionary:
	var refused := _durable_refusal(memory)
	if refused != "":
		push_error("StoryletEngine.load_durable: " + refused)
		return {}
	var draft := _empty_draft()
	var plan := _plan_durable(_durable["shared"], _durable["shared_cards"], memory, null, draft)
	var planned: Dictionary = plan["values"]
	for prop in _durable["shared"]:
		var value = planned[prop["address"]]["value"] if planned.has(prop["address"]) \
			else StoryletPropertyBag.default_for(prop["decl"])
		_put_durable(_durable_bag(_shared, prop), str(prop["decl"]["name"]), value)
	for card_id in plan["cards"]:
		_spent[card_id] = true
	return _finish_report(_bundle["content"], memory["content"], [], draft)


## What load_game(envelope) would do that is not a plain restore, without doing
## any of it (design/engine-server.md 4.9). Pure: nothing on this engine moves.
## A project mismatch is refused here exactly as load_game refuses it - it is
## the one thing neither call will tolerate - and returns {} with push_error.
func preview_load(envelope: Dictionary) -> Dictionary:
	var refusal := _project_mismatch(envelope)
	if refusal == "":
		refusal = _schema_mismatch(envelope)
	if refusal != "":
		push_error("StoryletEngine.preview_load: " + refusal)
		return {}
	return (_plan_load(envelope)["report"] as Dictionary)


## What open_flow(id, {"restore": saved}) would do to a flow of that name,
## without doing it: the same report shape, since a visit parked under one
## build and resumed under the next raises the same questions. Pure.
func preview_flow_restore(id: String, saved: Dictionary) -> Dictionary:
	var draft := _empty_draft()
	_plan_flow_restore(id, saved, shared_claims(id), draft)
	return _finish_report(_bundle["content"], _bundle["content"], [id], draft)


## Restore: shared state once, then every flow REBUILT from its blob.
## Handles held from before the load are closed and inert; take fresh ones
## from get_flow()/flows(). Takes "storylets/save@2" and "storylets/save@1".
##
## Property values come from the registry. An envelope that carries them (a
## standalone engine's, or a version 1 envelope) has them walked, cleaned, and
## moved into the registry here, over fresh defaults. Otherwise the game loads
## its registry itself, before or after this call: each flow's bags are handed
## back to the registry with their values, and the restored flows claim them.
## The report then covers only what this envelope holds; the registry's own
## load rule applies to the values.
##
## Returns the LoadReport preview_load would have given for this envelope: the
## drift tolerance that makes a load forgiving is what hides its cost, so the
## cost comes back with the load whether or not anybody looked first. A foreign
## save (wrong project, or a schema this runtime does not read) is refused: {}
## with push_error, and nothing is touched. So is any load of content that names
## another engine's scope nothing on this registry registered.
func load_game(envelope: Dictionary) -> Dictionary:
	var refusal := _project_mismatch(envelope)
	if refusal == "":
		refusal = _external_scope_refusal()
	if refusal == "":
		refusal = _schema_mismatch(envelope)
	if refusal != "":
		push_error("StoryletEngine.load_game: " + refusal)
		return {}
	var plan := _plan_load(envelope.duplicate(true))
	if plan.has("sections"):
		# The envelope carries the values: every bag of this engine back to its
		# defaults, then the cleaned values over them.
		reset()
		# The engine's own registry takes the save wholesale. A game's registry may
		# hold values the game loaded for other engines, still waiting: add to
		# those, never replace them.
		if _owns_registry:
			_registry.load(plan["sections"])
		else:
			_registry.load(plan["sections"], {"keep_parked": true})
	else:
		var keep := {}
		for id in (plan["flows"] as Dictionary):
			keep[id] = true
		_drop_run(keep)
	for id in (plan["spent"] as Array):
		_spent[str(id)] = true
	var flows_clean: Dictionary = plan["flows"]
	# Other engines' scopes were checked before anything moved, so no _open
	# here refuses.
	for id in flows_clean:
		_open(str(id), {}, true).restore(flows_clean[id])
	return plan["report"]


## "" when the save is for this project, else the refusal message.
func _project_mismatch(envelope: Dictionary) -> String:
	var content = envelope.get("content", {})
	if str(content.get("project")) != str(_bundle["content"]["project"]):
		return 'save is for project "%s", bundle is "%s"' % [str(content.get("project")), str(_bundle["content"]["project"])]
	return ""


## "" when this runtime reads the envelope's schema (version 2, or version 1
## from before the registry held the properties), else the refusal message.
static func _schema_mismatch(envelope: Dictionary) -> String:
	var schema = envelope.get("schema")
	if schema == StoryletBundle.SAVE_SCHEMA or schema == StoryletBundle.SAVE_SCHEMA_V1:
		return ""
	return "unsupported save schema: %s" % str(schema)


# --- the load report (design/engine-server.md 4.9) ---------------------------------
#
# One walk, two entry points. preview_load runs it and returns the report;
# load_game runs it, returns the same report and then applies the CLEANED blob
# the walk produced. Two implementations of "what does this save cost" would
# drift the first time one of them was fixed, so there is one, and the apply
# half consumes its output rather than repeating its decisions.
#
# A reported property's "path" is the engine's property address, spelled exactly
# as list_properties() prints it and exactly as get_property and set_property
# accept it: "story.name" for the story scope, "scope.owner.name" for the box,
# deck, hand and tag scopes. No "@", which belongs to the expression language and
# not to an address. The owner segment is the entity's gameId, the name it is
# called by everywhere else (design change 4.4), so an operator reading a
# hot-swap report can paste the address straight back in. An owner the build no
# longer has keeps the id the save arrived with: there is no gameId left to give
# it, which is the rule the report's evictions have always used.

## The report under construction: unsorted, until _finish_report orders it.
static func _empty_draft() -> Dictionary:
	return {
		"evicted": [], "droppedCooldowns": [], "droppedSpent": [],
		"droppedProperties": [], "defaultedProperties": [], "retypedProperties": [],
	}


## Does a saved value still fit its declaration?
##
## The type first, then the declaration's own vocabulary: an enum value or a
## quality stage the edit struck out is still a string of the right type and
## still no longer a legal value. A declaration with no vocabulary constrains
## nothing, so anything of the right type fits.
static func _value_fits(decl: Dictionary, value) -> bool:
	match str(decl.get("type", "")):
		"boolean":
			return value is bool
		"number":
			return (value is int or value is float) and not (value is bool)
		"string":
			return value is String
		"enum":
			return value is String and (not decl.has("values") or (decl["values"] as Array).has(value))
		"quality":
			return value is String and (not decl.has("stages") or (decl["stages"] as Array).has(value))
		"flags":
			if not (value is Array):
				return false
			if not decl.has("values"):
				return true
			for f in (value as Array):
				if not (decl["values"] as Array).has(f):
					return false
			return true
		_:
			return true


## Walk one bag's worth of saved values against one bag's worth of
## declarations: report the orphans, the newcomers and the misfits, and return
## the values that survive.
static func _walk_scope(decls: Array, saved: Dictionary, prefix: String, flow, draft: Dictionary) -> Dictionary:
	var by_name := {}
	for d in decls:
		by_name[str(d["name"])] = d
	var clean := {}
	for name in saved:
		var entry := {"path": prefix + str(name)}
		if flow != null:
			entry["flow"] = flow
		if not by_name.has(name):
			(draft["droppedProperties"] as Array).append(entry)
			continue
		if not _value_fits(by_name[name], saved[name]):
			(draft["retypedProperties"] as Array).append(entry)
			continue
		clean[name] = saved[name]
	for d in decls:
		var dname := str(d["name"])
		if not saved.has(dname):
			var missing := {"path": prefix + dname}
			if flow != null:
				missing["flow"] = flow
			(draft["defaultedProperties"] as Array).append(missing)
	return clean


## The same walk over all five scopes of one partition. An owner the save
## carries and the build no longer has drops whole (its bag is gone, so its
## values have nowhere to land); an owner the build has and the save lacks
## keeps every default.
func _walk_partition(decls: Dictionary, values: Dictionary, flow, draft: Dictionary) -> Dictionary:
	var out := {"story": _walk_scope(decls["story"], values.get("story", {}), "story.", flow, draft),
		"box": {}, "deck": {}, "hand": {}, "value": {}}
	for kind in OWNED_KINDS:
		var decl_kind: Dictionary = decls[kind]
		var saved_kind: Dictionary = values.get(kind, {})
		var ids := {}
		for id in decl_kind:
			ids[id] = true
		for id in saved_kind:
			ids[id] = true
		var ordered: Array = ids.keys()
		ordered.sort()
		for id in ordered:
			# The report's "path" is exactly what list_properties() prints and
			# what set_property takes: one grammar, so an operator reading a
			# hot-swap report can paste the address straight back in (4.4).
			out[kind][id] = _walk_scope(decl_kind.get(id, []), saved_kind.get(id, {}),
				address_of(kind, id) + ".", flow, draft)
	return out


static func _empty_partition() -> Dictionary:
	return {"story": {}, "box": {}, "deck": {}, "hand": {}, "value": {}}


static var _shared_key_re := RegEx.create_from_string("^storylets/(box|deck|hand|value)/([^/]+)$")
static var _flow_story_re := RegEx.create_from_string("^storylets/flow/([^/]+)/story$")
static var _flow_key_re := RegEx.create_from_string("^storylets/flow/([^/]+)/(box|deck|hand|value)/([^/]+)$")


## Sort a registry save's sections back into partitions, for the load walk: the
## shared ones, each flow's (only the flows the save restores; the rest are
## dropped), and everything that is not this engine's, passed through.
## {"shared": partition, "flows": {flow id: partition}, "rest": sections}.
static func _partitions_from_sections(sections: Dictionary, flow_ids: Dictionary) -> Dictionary:
	var shared := _empty_partition()
	var flows := {}
	var rest := {}
	var flow_of := func(escaped: String) -> Variant:
		var id := _unesc(escaped)
		if not flow_ids.has(id):
			return null
		if not flows.has(id):
			flows[id] = _empty_partition()
		return flows[id]
	for key in sections:
		var k := str(key)
		var values: Dictionary = sections[key]
		var m: RegExMatch
		if k == "story":
			shared["story"] = values
			continue
		m = _shared_key_re.search(k)
		if m != null:
			shared[m.get_string(1)][_unesc(m.get_string(2))] = values
			continue
		m = _flow_story_re.search(k)
		if m != null:
			var p = flow_of.call(m.get_string(1))
			if p != null:
				p["story"] = values
			continue
		m = _flow_key_re.search(k)
		if m != null:
			var p = flow_of.call(m.get_string(1))
			if p != null:
				p[m.get_string(2)][_unesc(m.get_string(3))] = values
			continue
		if not k.begins_with("storylets/"):
			rest[k] = values
	return {"shared": shared, "flows": flows, "rest": rest}


## A cleaned partition as registry sections, keyed the way its bags register:
## `flow_id` null for the shared side. Empty sections are left out: they would
## load nothing, and a section for a bag that never registers would wait in the
## registry for ever.
static func _sections_of(p: Dictionary, flow_id, out: Dictionary) -> void:
	if not (p["story"] as Dictionary).is_empty():
		out["story" if flow_id == null else flow_key(flow_id, "story")] = p["story"]
	for kind in OWNED_KINDS:
		for id in p[kind]:
			if not (p[kind][id] as Dictionary).is_empty():
				out[shared_key(kind, id) if flow_id == null else flow_key(flow_id, kind, id)] = p[kind][id]


## The whole-envelope walk: the report, and the cleaned state the apply half
## writes. Nothing here touches the engine, which is what lets preview_load and
## load_game share it. "sections" (the cleaned property values to move into the
## registry) is present only when the envelope carries values: a version 1
## envelope's partitions, or a standalone engine's registry sections.
func _plan_load(envelope: Dictionary) -> Dictionary:
	var draft := _empty_draft()
	var shared_half: Dictionary = envelope.get("shared", {})
	var saved_flows: Dictionary = envelope.get("flows", {})
	var flow_ids := {}
	for id in saved_flows:
		flow_ids[str(id)] = true
	# Where the property values are, if this envelope has them.
	var moved = null
	if envelope.get("schema") == StoryletBundle.SAVE_SCHEMA_V1:
		var v1_flows := {}
		for id in saved_flows:
			v1_flows[str(id)] = (saved_flows[id] as Dictionary).get("props", _empty_partition())
		moved = {"shared": shared_half.get("props", _empty_partition()), "flows": v1_flows, "rest": {}}
	elif envelope.get("registry") is Dictionary:
		moved = _partitions_from_sections(envelope["registry"], flow_ids)
	var shared_clean = null
	if moved != null:
		shared_clean = _walk_partition(_shared_decls, moved["shared"], null, draft)
	var spent: Array = []
	for card_id in shared_half.get("spent", []):
		if _cards_by_id.has(str(card_id)):
			spent.append(str(card_id))
		else:
			(draft["droppedSpent"] as Array).append(str(card_id))
	var sections = null
	if moved != null:
		sections = (moved["rest"] as Dictionary).duplicate()
		_sections_of(shared_clean, null, sections)
	var flows_clean := {}
	var ids: Array = []
	# The flows reopen in the order JS reads the envelope's object in (ruling E),
	# whatever order this Dictionary was built or parsed in.
	for id in js_key_order(saved_flows.keys()):
		var fid := str(id)
		ids.append(fid)
		var with_props: Dictionary = (saved_flows[id] as Dictionary).duplicate()
		if moved != null:
			with_props["props"] = (moved["flows"] as Dictionary).get(fid, _empty_partition())
		var clean := _plan_flow_restore(fid, with_props, null, draft)
		if sections != null and clean.has("props"):
			# The flow's values go into the registry, where its bags claim them; the
			# restored flow itself carries none.
			_sections_of(clean["props"], fid, sections)
			clean.erase("props")
		flows_clean[fid] = clean
	var out := {
		"report": _finish_report(_bundle["content"], envelope.get("content", {}), ids, draft),
		"spent": spent, "flows": flows_clean,
	}
	if sections != null:
		out["sections"] = sections
	return out


## One flow's walk. other_claims is the rest of the world's shared ledger and is
## present only for a SINGLE-flow restore into a live engine: a whole-envelope
## load rebuilds every flow from one consistent moment, so there is nobody else
## to compete with.
func _plan_flow_restore(id: String, saved: Dictionary, other_claims, draft: Dictionary) -> Dictionary:
	var clean := {}
	# A flow blob without properties (a version 2 envelope's: the registry has
	# them) has nothing to walk.
	if saved.has("props"):
		clean["props"] = _walk_partition(_flow_decls, saved["props"], id, draft)
	clean.merge({
		"turns": (saved.get("turns", {}) as Dictionary).duplicate(true),
		"prng": int(saved.get("prng", 0)),
		"cooldowns": {},
		"board": {},
		"playLog": (saved.get("playLog", []) as Array).duplicate(true),
	})
	for card_id in saved.get("cooldowns", {}):
		if _cards_by_id.has(str(card_id)):
			clean["cooldowns"][str(card_id)] = saved["cooldowns"][card_id]
		else:
			(draft["droppedCooldowns"] as Array).append({"flow": id, "card": str(card_id)})
	var restored := {}
	for hand_id in saved.get("board", {}):
		var known = _hands_by_id.get(str(hand_id))
		if known == null:
			# A deleted entity has no gameId left, so it is named by the id the
			# save carries; everything the build still knows keeps its gameId.
			for card_id in saved["board"][hand_id]:
				(draft["evicted"] as Array).append({"flow": id, "hand": str(hand_id),
					"card": _card_report_name(str(card_id)), "reason": "hand-vanished"})
			continue
		var hand_name := StoryletBundle.effective_game_id(known["hand"])
		var kept: Array = []
		for card_id in saved["board"][hand_id]:
			var entry = _cards_by_id.get(str(card_id))
			if entry == null:
				(draft["evicted"] as Array).append({"flow": id, "hand": hand_name,
					"card": str(card_id), "reason": "vanished"})
				continue
			if other_claims != null and StoryletFlow._card_is_shared(entry["card"], bool(entry["deck"].get("shared", false))):
				var elsewhere := float((other_claims as Dictionary).get(str(card_id), 0))
				var here := float(restored.get(str(card_id), 0))
				if elsewhere + here >= StoryletFlow._shared_cap(entry["card"]):
					(draft["evicted"] as Array).append({"flow": id, "hand": hand_name,
						"card": StoryletBundle.effective_game_id(entry["card"]), "reason": "claimed-elsewhere"})
					continue
				restored[str(card_id)] = here + 1.0
			kept.append(str(card_id))
		clean["board"][str(hand_id)] = kept
	return clean


func _card_report_name(card_id: String) -> String:
	var entry = _cards_by_id.get(card_id)
	return StoryletBundle.effective_game_id(entry["card"]) if entry != null else card_id


static func _sort_by_key(list: Array, fields: Array) -> Array:
	var keyed: Array = []
	for entry in list:
		var parts: Array = []
		for f in fields:
			parts.append(str((entry as Dictionary).get(f, "")))
		keyed.append({"k": REPORT_SEP.join(parts), "v": entry})
	keyed.sort_custom(func(a, b): return str(a["k"]) < str(b["k"]))
	var out: Array = []
	for e in keyed:
		out.append(e["v"])
	return out


## Order the draft and answer the identity questions. `saved` is the content
## block the save carries; for a single-flow restore there is none, so the
## caller passes the bundle's own and no drift is reported.
static func _finish_report(bundle_content: Dictionary, saved_content: Dictionary, flows_in_order: Array, draft: Dictionary) -> Dictionary:
	var evicted := _sort_by_key(draft["evicted"], ["flow", "hand", "card", "reason"])
	var dropped_cooldowns := _sort_by_key(draft["droppedCooldowns"], ["flow", "card"])
	var dropped_spent: Array = (draft["droppedSpent"] as Array).duplicate()
	dropped_spent.sort()
	var dropped_props := _sort_by_key(draft["droppedProperties"], ["flow", "path"])
	var defaulted_props := _sort_by_key(draft["defaultedProperties"], ["flow", "path"])
	var retyped_props := _sort_by_key(draft["retypedProperties"], ["flow", "path"])
	var saved_version := str(saved_content.get("version", ""))
	var saved_hash := str(saved_content.get("hash", ""))
	var bundle_version := str(bundle_content.get("version", ""))
	var bundle_hash := str(bundle_content.get("hash", ""))
	var drift := saved_version != bundle_version or saved_hash != bundle_hash
	return {
		# "flows" is what the load restores, not something it had to change, so
		# it never makes a report inexact.
		"exact": not drift and evicted.is_empty() and dropped_cooldowns.is_empty()
			and dropped_spent.is_empty() and dropped_props.is_empty()
			and defaulted_props.is_empty() and retyped_props.is_empty(),
		"project": str(bundle_content.get("project", "")),
		"version": {"saved": saved_version, "bundle": bundle_version},
		"hash": {"saved": saved_hash, "bundle": bundle_hash},
		"flows": flows_in_order,
		"evicted": evicted,
		"droppedCooldowns": dropped_cooldowns,
		"droppedSpent": dropped_spent,
		"droppedProperties": dropped_props,
		"defaultedProperties": defaulted_props,
		"retypedProperties": retyped_props,
	}


# --- durable halves (ruling H, 2026-10-06) -----------------------------------------
#
# A durable half is what outlives a run: the engine's (the installation's memory)
# and a flow's (the player's pocket), one shape. Which declarations and cards
# belong to which half is decided by both flags at once: `durable` says whether,
# `shared` says which half. A save keys by internal id so it survives a rename;
# a durable half keys by name (the property address, the card's gameId) so a
# person can read it, and a rename shows up in the report instead.

## A card whose spend outlives the run: `redraw: "never"`, with `durable` on the
## card or, failing that, its deck, the same fall-through `shared` has. Only
## `never` can cross a run boundary: a finite cooldown is an absolute turn of a
## clock that restarts with the run.
static func _card_is_durable(card: Dictionary, deck: Dictionary) -> bool:
	var redraw = card.get("redraw", "always")
	if not (redraw is String and redraw == "never"):
		return false
	var durable = card.get("durable")
	if durable == null:
		durable = deck.get("durable")
	return durable is bool and durable


## A boolean flag that is present and true, as JS's `=== true` asks.
static func _flag_set(d: Dictionary, key: String) -> bool:
	var v = d.get(key)
	return v is bool and v


## Every durable declaration in one side's declaration set, in bundle order,
## with the address a durable half keys it by. Where two owners print the same
## address (two groups in one box naming a tag alike, the residual the compiler
## is closing) the first answers, which is the rule resolve_owner keeps for the
## same address.
func _durable_props(decls: Dictionary) -> Array:
	var out: Array = []
	var seen := {}
	for decl in decls["story"]:
		if _flag_set(decl, "durable"):
			var address := "story." + str(decl["name"])
			if not seen.has(address):
				seen[address] = true
				out.append({"address": address, "kind": "story", "decl": decl})
	for kind in OWNED_KINDS:
		for owner_id in decls[kind]:
			for decl in decls[kind][owner_id]:
				if not _flag_set(decl, "durable"):
					continue
				var address := "%s.%s" % [address_of(kind, owner_id), str(decl["name"])]
				if seen.has(address):
					continue
				seen[address] = true
				out.append({"address": address, "kind": kind, "owner": owner_id, "decl": decl})
	return out


## Where one durable prop's bag is in a partition (the engine's _shared, or a
## flow's stores); null when that owner has no bag there.
static func _durable_bag(p: Dictionary, prop: Dictionary) -> StoryletPropertyBag:
	if prop["kind"] == "story":
		return p["story"]
	return (p[prop["kind"]] as Dictionary).get(prop["owner"])


## One half's values, keys in byte order so the same state writes the same text.
## An address never looks like an integer (it has a dot in it), so the
## Dictionary keeps that order in JS too (ruling E). Deep-copied.
static func _durable_values(p: Dictionary, props: Array) -> Dictionary:
	var found := {}
	for prop in props:
		var bag := _durable_bag(p, prop)
		if bag == null:
			continue
		var name := str(prop["decl"]["name"])
		if bag.values.has(name):
			var value = bag.values[name]
			found[prop["address"]] = (value as Array).duplicate() if value is Array else value
	var keys: Array = found.keys()
	keys.sort()
	var out := {}
	for address in keys:
		out[address] = found[address]
	return out


## "" when a durable half may be loaded here, else the refusal: a shape this
## runtime does not know, or another project's state. The two refusals every
## durable load shares, made before anything moves.
func _durable_refusal(save) -> String:
	var schema = save.get("schema") if save is Dictionary else null
	if not (schema is String and schema == StoryletBundle.DURABLE_SCHEMA):
		var said: String = _js_text(schema) if save is Dictionary and (save as Dictionary).has("schema") else "undefined"
		return "unsupported durable schema: %s" % said
	var content = save.get("content")
	var saved_project = content.get("project") if content is Dictionary else null
	var project := str(_bundle["content"]["project"])
	if not (saved_project is String and saved_project == project):
		var said: String = _js_text(saved_project) if content is Dictionary and (content as Dictionary).has("project") else "undefined"
		return 'durable state is for project "%s", bundle is "%s"' % [said, project]
	return ""


## A value as JavaScript's String() prints it: the text the reference's durable
## refusals quote for a schema or project that is not a string (an absent one is
## "undefined", which the caller says, since a Dictionary cannot tell absent from
## null by value). str() would print null as "<null>" and 42.0 as "42.0".
static func _js_text(value) -> String:
	if value == null:
		return "null"
	if value is bool:
		return "true" if value else "false"
	if value is int or value is float:
		return StoryletValues.js_number(float(value))
	if value is String:
		return value
	if value is Array:
		# Array.prototype.join: a null item is empty.
		var parts: Array = []
		for item in (value as Array):
			parts.append("" if item == null else _js_text(item))
		return ",".join(PackedStringArray(parts))
	return "[object Object]"


## A value a property can hold, as a durable half carries it: anything but an
## array of something other than strings. A null and a Dictionary fit no
## declaration anyway; an array of numbers would fit an unconstrained flags
## declaration and put numbers in a flags bag, so it is held to fit nothing,
## as the Unreal and Unity ports hold it.
static func _durable_readable(value) -> bool:
	if not (value is Array):
		return true
	for item in (value as Array):
		if not (item is String):
			return false
	return true


## Walk one durable half against this build's durable declarations and durable
## cards on one side (`flow` names the flow for a pocket; null, it is the
## engine's memory), filing what does not fit in the load report's own fields.
## Pure: the caller writes the plan, {"values": {address: {"prop", "value"}},
## "cards": [internal card id]}.
##
## A value lands only at an address this build declares DURABLE ON THIS SIDE: a
## renamed property, one no longer durable, and one that moved to the other side
## of `shared` are all dropped, since this half would never have carried them. A
## value its declaration no longer takes is retyped and takes the default; a
## durable declaration the half does not carry is defaulted. A spend lands only
## on a card that is still a durable one-shot on this side, and is otherwise a
## dropped cooldown (a pocket's spends are cooldowns) or a dropped spent card (a
## memory's are the engine's spent set), named by the gameId the half carried.
func _plan_durable(props: Array, cards: Array, save: Dictionary, flow, draft: Dictionary) -> Dictionary:
	var at := func(path: String) -> Dictionary:
		var entry := {"path": path}
		if flow != null:
			entry["flow"] = flow
		return entry
	var by_address := {}
	for prop in props:
		by_address[prop["address"]] = prop
	var carried = save.get("values")
	if not (carried is Dictionary):
		carried = {}
	var values := {}
	for address in carried:
		var prop = by_address.get(str(address))
		if prop == null:
			(draft["droppedProperties"] as Array).append(at.call(str(address)))
			continue
		if not (_durable_readable(carried[address]) and _value_fits(prop["decl"], carried[address])):
			(draft["retypedProperties"] as Array).append(at.call(str(address)))
			continue
		values[str(address)] = {"prop": prop, "value": carried[address]}
	for prop in props:
		if not (carried as Dictionary).has(prop["address"]):
			(draft["defaultedProperties"] as Array).append(at.call(str(prop["address"])))
	var eligible := {}
	for entry in cards:
		eligible[entry["card"]["id"]] = true
	var spend: Array = []
	var spent = save.get("spent")
	for game_id in (spent if spent is Array else []):
		var entry = _cards_by_game_id.get(str(game_id))
		if entry != null and eligible.has(entry["card"]["id"]):
			spend.append(str(entry["card"]["id"]))
		elif flow != null:
			(draft["droppedCooldowns"] as Array).append({"flow": flow, "card": str(game_id)})
		else:
			(draft["droppedSpent"] as Array).append(str(game_id))
	return {"values": values, "cards": spend}


## A host write of one durable value: silent, as every host write is, and past a
## `writable: false`, which is the story's promise and not the game's.
static func _put_durable(bag: StoryletPropertyBag, name: String, value) -> void:
	if bag != null:
		bag.set_value(name, StoryletValues.to_value(value), {"silent": true, "reason": "host durable", "host": true})
