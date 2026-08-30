@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The scope registry / runtime state container - port of
# @wildwinter/scoperegistry's ScopeRegistry, the shared state kernel
# (design/engine-runtimes.md 3). It owns the world state as a set of named
# scopes: each either OWNED (a StoryletPropertyBag this registry stores and
# saves) or FOREIGN (host- or other-engine-resolved at runtime, never stored
# here), and produces the eval context StoryletExpression consumes. `@world`
# is typically host-owned and foreign to both products.
#
# Foreign resolvers are Dictionaries: {"get": Callable(name) -> value | null,
# "set"?: Callable(name, value)} (omit "set" for a read-only scope).
class_name StoryletScopeRegistry
extends RefCounted

## The versioned owned-state fragment both product save envelopes embed (one
## serialisation shape for bags).
const SAVE_FRAGMENT_VERSION := 1

## The scopeRegistrySpec versions this build understands.
const SUPPORTED_SPEC_VERSIONS: Array[int] = [1]

var _scopes: Dictionary = {}   # token -> {"kind": "owned"|"foreign", ...}


## Extract + validate a `scopeRegistrySpec` from any parsed JSON value.
## Returns {"ok": true, "spec": Dictionary | null} (null when the key is
## absent, so callers can probe arbitrary files) or {"ok": false, "error"}.
static func read_scope_registry_spec(source) -> Dictionary:
	if not (source is Dictionary):
		return {"ok": true, "spec": null}
	if not source.has("scopeRegistrySpec"):
		return {"ok": true, "spec": null}
	var raw = source["scopeRegistrySpec"]
	if not (raw is Dictionary):
		return {"ok": false, "error": "scopeRegistrySpec must be an object"}
	if not StoryletValues.is_number(raw.get("version")):
		return {"ok": false, "error": "scopeRegistrySpec.version must be a number"}
	if not SUPPORTED_SPEC_VERSIONS.has(int(raw["version"])):
		return {"ok": false, "error": "unsupported scopeRegistrySpec version %d (supported: 1)" % int(raw["version"])}
	if not (raw.get("scopes") is Array):
		return {"ok": false, "error": "scopeRegistrySpec.scopes must be an array"}
	for s in raw["scopes"]:
		if not (s is Dictionary) or not (s.get("token") is String):
			return {"ok": false, "error": "each scopeRegistrySpec scope needs a string token"}
	return {"ok": true, "spec": raw}


## Register a scope this registry owns and stores, seeded from declarations.
func define_owned(token: String, declarations: Array) -> StoryletScopeRegistry:
	return mount_owned(token, StoryletPropertyBag.new(declarations))


## Attach an EXISTING bag as an owned scope - the shared-container move: a
## host (or the other product) holds the bag; this registry reads, writes and
## lists it like its own, but the holder saves it.
func mount_owned(token: String, bag: StoryletPropertyBag) -> StoryletScopeRegistry:
	if not _assert_free(token):
		return self
	_scopes[token] = {"kind": "owned", "bag": bag}
	return self


## An owned scope's bag (subscribe, audit, rows live there); null (with
## push_error) when the token is not an owned scope.
func owned_bag(token: String) -> StoryletPropertyBag:
	var e = _scopes.get(token)
	if e == null or e["kind"] != "owned":
		push_error("StoryletScopeRegistry: '@%s' is not an owned scope" % token)
		return null
	return e["bag"]


## Re-initialise an existing owned scope's bag from new declarations, in place
## (an eval context already built from this registry stays valid).
func reseed_owned(token: String, declarations: Array) -> StoryletScopeRegistry:
	var bag := owned_bag(token)
	if bag != null:
		bag.reseed(declarations)
	return self


## Register a FOREIGN scope backed by a host resolver. The values live in the
## host / other engine and are never stored or saved here. `declarations`
## (optional, e.g. imported from a scopeRegistrySpec) are used only for
## listing / writability; omit them for an opaque scope.
func define_foreign(token: String, resolver: Dictionary, declarations: Array = [], scope_writable: bool = true) -> StoryletScopeRegistry:
	if not _assert_free(token):
		return self
	var decls := {}
	for d in declarations:
		decls[str(d["name"]).to_lower()] = d
	_scopes[token] = {"kind": "foreign", "resolver": resolver, "decls": decls, "scope_writable": scope_writable}
	return self


func has(token: String) -> bool:
	return _scopes.has(token)


## Read a property; null if the scope or property is not present.
## (Named get_value / set_value because Object already owns get / set.)
func get_value(scope: String, name: String) -> Variant:
	var e = _scopes.get(scope)
	if e == null:
		return null
	if e["kind"] == "owned":
		return (e["bag"] as StoryletPropertyBag).get_value(name)
	return (e["resolver"]["get"] as Callable).call(name.to_lower())


## Write a property (an ENGINE write: the bag's subscribers fire; use the bag
## directly for silent host writes). Returns "" or an error message (with
## push_error) on an unknown or read-only scope/property.
func set_value(scope: String, name: String, value) -> String:
	var e = _scopes.get(scope)
	if e == null:
		var msg := "unknown scope '@%s'" % scope
		push_error("StoryletScopeRegistry: " + msg)
		return msg
	if e["kind"] == "owned":
		var change: Dictionary = (e["bag"] as StoryletPropertyBag).set_value(name, value)
		if change.has("error"):
			return "'@%s.%s' is read-only" % [scope, name]
		return ""
	var n := name.to_lower()
	if not _foreign_writable(e, n):
		var msg := "'@%s.%s' is read-only" % [scope, name]
		push_error("StoryletScopeRegistry: " + msg)
		return msg
	(e["resolver"]["set"] as Callable).call(n, value)
	return ""


func _foreign_writable(e: Dictionary, name: String) -> bool:
	if not (e["resolver"].get("set") is Callable):
		return false   # no setter => read-only scope
	var d = e["decls"].get(name)
	if d != null and d.has("writable"):
		return bool(d["writable"])
	return bool(e["scope_writable"])


## Examiner rows across every scope with a declared surface: owned bags first
## per registration order, then declared foreign scopes (values read through,
## writability reflecting the resolver). Opaque foreign scopes are not listed.
## Row shape: {"scope"} + the bag row shape.
func list_properties() -> Array:
	var out: Array = []
	for token in _scopes:
		var e: Dictionary = _scopes[token]
		if e["kind"] == "owned":
			for row in (e["bag"] as StoryletPropertyBag).rows():
				var r: Dictionary = row.duplicate()
				r["scope"] = token
				out.append(r)
		else:
			for name in e["decls"]:
				var d: Dictionary = e["decls"][name]
				var r := {
					"scope": token,
					"name": name,
					"type": str(d.get("type", "")),
					"value": (e["resolver"]["get"] as Callable).call(name),
					"default": StoryletValues.to_value(d.get("default", StoryletPropertyBag.default_for(d))),
					"writable": _foreign_writable(e, name),
				}
				if d.has("values"):
					r["values"] = d["values"]
				out.append(r)
	return out


## Build the eval context StoryletExpression.evaluate consumes: owned scopes
## as their live value Dictionaries, foreign scopes as get-Callables. `host`
## carries dialect-function callbacks and is passed through untouched.
func to_eval_context(host = null) -> Dictionary:
	var scopes := {}
	for token in _scopes:
		var e: Dictionary = _scopes[token]
		if e["kind"] == "owned":
			scopes[token] = (e["bag"] as StoryletPropertyBag).values
		else:
			scopes[token] = e["resolver"]["get"]
	var ctx := {"scopes": scopes}
	if host != null:
		ctx["host"] = host
	# The quality channel (quality.md): declared here once, so a host that
	# registers a quality gets ordering comparisons and advance() with no
	# further wiring. Only added when a quality exists, so contexts stay
	# identical for products that declare none. The JS kernel has had this
	# since qualities landed and all three ports returned scopes and host
	# alone, so a host driving the registry DIRECTLY (the engine builds its own
	# context and is unaffected) silently lost every ladder (2026-08-29).
	var qualities := _quality_ladders()
	if not qualities.is_empty():
		ctx["qualities"] = func(scope: String, name: String):
			var m = qualities.get(scope)
			return null if m == null else m.get(name.to_lower())
	return ctx


## Every quality declaration's ladder, keyed scope token then lower-cased name.
func _quality_ladders() -> Dictionary:
	var out := {}
	for token in _scopes:
		var e: Dictionary = _scopes[token]
		var decls: Array = []
		if e["kind"] == "owned":
			decls = (e["bag"] as StoryletPropertyBag).declarations()
		else:
			for name in e["decls"]:
				decls.append(e["decls"][name])
		for d in decls:
			if d.get("type") != "quality" or d.get("stages") == null:
				continue
			if not out.has(token):
				out[token] = {}
			out[token][String(d["name"]).to_lower()] = d["stages"]
	return out


## Serialise OWNED scopes only (foreign scopes are host-owned, host-saved) as
## bare bags. A product embedding the versioned cross-product shape uses
## save_fragment.
func save() -> Dictionary:
	var out := {}
	for token in _scopes:
		var e: Dictionary = _scopes[token]
		if e["kind"] == "owned":
			out[token] = (e["bag"] as StoryletPropertyBag).save()
	return out


## Restore owned-scope values from a save() blob. Unknown / foreign scopes are
## ignored.
func load(blob: Dictionary) -> void:
	for token in blob:
		var e = _scopes.get(token)
		if e != null and e["kind"] == "owned":
			(e["bag"] as StoryletPropertyBag).load(blob[token])


## The versioned owned-state fragment (the one serialisation shape both
## product families' save envelopes embed): save() with a version stamp.
func save_fragment() -> Dictionary:
	return {"version": SAVE_FRAGMENT_VERSION, "scopes": save()}


## Restore from a versioned fragment; an unsupported version is refused with
## an error message ("" = ok).
func load_fragment(fragment: Dictionary) -> String:
	if int(fragment.get("version", -1)) != SAVE_FRAGMENT_VERSION:
		var msg := "unsupported owned-state fragment version %s (supported: %d)" % [str(fragment.get("version")), SAVE_FRAGMENT_VERSION]
		push_error("StoryletScopeRegistry: " + msg)
		return msg
	load(fragment.get("scopes", {}))
	return ""


func _assert_free(token: String) -> bool:
	if _scopes.has(token):
		push_error("StoryletScopeRegistry: scope '@%s' is already registered" % token)
		return false
	return true
