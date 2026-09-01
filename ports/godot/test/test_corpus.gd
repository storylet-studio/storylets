# The corpus TestHost: load corpus.json and replay every family through the
# GDScript Storylet Engine runtime, asserting the results the JS reference
# produces - the port's half of the parity contract. The four runner
# obligations are documented in packages/conformance/src/runner.ts and
# re-implemented here exactly.
#
#   godot --headless --path ports/godot --script res://test/test_corpus.gd \
#       [-- <abs path to corpus.json>]
#
# (import the project once first: godot --headless --path ports/godot --import)
#
# Families: expressions (evaluator + dialect), specificity (matched-constraint
# scorer), peek (bundle + one ask, asked TWICE - a peek registers nothing),
# scripted (deals, plays, turns, save/load incl. into the edited bundle B).
# Prints per-family counts then ALL PASS (exit 0) or N FAILED (exit 1).
extends SceneTree

var _fails := 0
var _dialect: Dictionary = StoryletDialect.dialect()


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var path: String
	if args.size() > 0:
		path = args[0]
	else:
		path = ProjectSettings.globalize_path("res://").path_join("../../packages/conformance/corpus.json")
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		push_error("corpus not found: " + path)
		quit(2)
		return
	var root = JSON.parse_string(text)
	if not (root is Dictionary):
		push_error("corpus is not valid JSON")
		quit(2)
		return

	var expressions: Array = root["expressions"]
	var specificity: Array = root["specificity"]
	var peek: Array = root["peek"]
	var scripted: Array = root["scripted"]

	var e := _run_expressions(expressions)
	var sp := _run_specificity(specificity)
	var p := _run_peek(peek)
	var s := _run_scripted(scripted)

	print("corpus version %d" % int(root["version"]))
	print("expressions: %d/%d  specificity: %d/%d  peek: %d/%d  scripted: %d/%d" % [
		e, expressions.size(), sp, specificity.size(), p, peek.size(), s, scripted.size()])
	# The expr parity corpus sits beside ours, vendored from ../expr. Absent is a
	# FAILURE, not a skip: a parity gate that quietly does nothing when its fixture
	# is missing is the shape of check this codebase has been bitten by.
	var expr_path := path.get_base_dir().path_join("expr-corpus.json")
	var expr_text := FileAccess.get_file_as_string(expr_path)
	if expr_text == "":
		push_error("expr parity corpus not found: " + expr_path)
		quit(2)
		return
	var expr_root = JSON.parse_string(expr_text)
	if not (expr_root is Dictionary):
		push_error("expr parity corpus is not valid JSON")
		quit(2)
		return
	var x_prng: Array = expr_root["prng"]
	var x_expr: Array = expr_root["expressions"]
	var xp := _run_expr_prng(x_prng)
	var xe := _run_expressions(x_expr)
	print("expr corpus v%d - prng: %d/%d  expressions: %d/%d" % [
		int(expr_root["version"]), xp, x_prng.size(), xe, x_expr.size()])

	print("ALL PASS" if _fails == 0 else "%d FAILED" % _fails)
	quit(0 if _fails == 0 else 1)


func _fail(family: String, name: String, detail: String) -> void:
	_fails += 1
	printerr("  FAIL [%s] %s: %s" % [family, name, detail])


# -- shared plumbing -------------------------------------------------------------

# Scope bags for expression/specificity cases, values normalised.
static func _scopes_of(c: Dictionary) -> Dictionary:
	var scopes := {}
	for token in c.get("scopes", {}):
		var bag := {}
		for prop in c["scopes"][token]:
			bag[prop] = StoryletValues.to_value(c["scopes"][token][prop])
		scopes[token] = bag
	return scopes


static func _ids(cards: Array) -> Array:
	var out: Array = []
	for card in cards:
		out.append(card["id"])
	return out


static func _same_list(a: Array, b: Array) -> bool:
	if a.size() != b.size():
		return false
	for i in a.size():
		if str(a[i]) != str(b[i]):
			return false
	return true


static func _show_list(list: Array) -> String:
	var parts: Array = []
	for s in list:
		parts.append("\"%s\"" % str(s))
	return "[" + ",".join(parts) + "]"


# Direct store writes for setup and setState: story/world are single bags;
# box/deck/hand/value are keyed by immutable id (runner.ts applyState).
static func _apply_state(session: StoryletFlow, selector: Dictionary) -> void:
	for scope in ["story", "world"]:
		for prop_name in selector.get(scope, {}):
			session.set_property("%s.%s" % [scope, prop_name], StoryletValues.to_value(selector[scope][prop_name]))
	for kind in ["box", "deck", "hand", "value"]:
		for id in selector.get(kind, {}):
			for prop_name in selector[kind][id]:
				session.set_property("%s.%s.%s" % [kind, id, prop_name], StoryletValues.to_value(selector[kind][id][prop_name]))


# "turn.<boxId>" reads that box's clock (schema 3.4); everything else is a
# property path.
static func _read_state(session: StoryletFlow, path: String) -> Variant:
	if path.begins_with("turn."):
		return session.turn(path.substr(5))
	return session.get_property(path)


# Hand id -> gameId (the board keys by gameId; scripts speak ids).
static func _hand_game_ids(bundle: Dictionary) -> Dictionary:
	var names := {}
	for box in bundle["boxes"]:
		for hand in box["hands"]:
			names[hand["id"]] = StoryletBundle.effective_game_id(hand)
	return names



# -- the @wildwinter/expr parity corpus -------------------------------------------
#
# A SECOND corpus, authored in ../expr and vendored here, holding the primitives
# both product families share and neither family's own corpus tests: seed
# coercion, the PRNG draw and state sequence, operator typing, short-circuiting,
# value equality and the comparison rules. The evaluator is exercised only
# incidentally by the storylet corpus (through dealing), so a divergence in expr
# itself failed nothing anywhere until this existed.
#
# Its `expressions` section has the same shape as ours and reuses
# _run_expressions; only the PRNG section is new.


# JSON has no literal for the non-finite doubles, and they are exactly the
# interesting coercion cases, so the corpus carries them as strings.
static func _expr_seed(v: Variant) -> float:
	if typeof(v) == TYPE_STRING:
		match v:
			"NaN": return NAN
			"Infinity": return INF
			"-Infinity": return -INF
	return float(v)


func _run_expr_prng(cases: Array) -> int:
	var pass_count := 0
	for c in cases:
		var name: String = c["name"]
		var prng := StoryletMulberry32.new(_expr_seed(c["seed"]))

		var want_seed := int(c["expectSeedState"])
		if prng.state() != want_seed:
			_fail("expr/prng", name, "seed state %d, expected %d" % [prng.state(), want_seed])
			continue

		var states: Array = c["expectStates"]
		var draws: Array = c["expectDraws"]
		var ok := true
		for i in states.size():
			var d := prng.next()
			# The corpus pins the draw's NUMERATOR, an exact uint32, so no port is
			# held to another language's float printing.
			var got_draw := int(round(d * 4294967296.0))
			if got_draw != int(draws[i]):
				_fail("expr/prng", name, "draw %d is %d, expected %d" % [i + 1, got_draw, int(draws[i])])
				ok = false
				break
			if prng.state() != int(states[i]):
				_fail("expr/prng", name, "state after draw %d is %d, expected %d" % [i + 1, prng.state(), int(states[i])])
				ok = false
				break
			if d < 0.0 or d >= 1.0:
				_fail("expr/prng", name, "draw %d is %f, outside [0, 1)" % [i + 1, d])
				ok = false
				break
		if ok:
			pass_count += 1
	return pass_count


# -- expressions ------------------------------------------------------------------

func _run_expressions(cases: Array) -> int:
	var pass_count := 0
	for c in cases:
		var name: String = c["name"]
		# The compiled `ast` IS the node: the evaluator walks the tagged-tuple
		# form the corpus carries, with no deserialise pass.
		var node = c["ast"]
		if not (node is Array):
			_fail("expressions", name, "malformed AST")
			continue
		# The reference runner always supplies a PRNG (seed ?? 0).
		var prng := StoryletMulberry32.new(int(c.get("seed", 0)))
		var ctx := {
			"scopes": _scopes_of(c),
			"host": {"next_random": func() -> float: return prng.next()},
		}
		var actual = StoryletExpression.evaluate(node, ctx, _dialect)
		if c.get("expectError", false):
			if StoryletExpression.is_error(actual):
				pass_count += 1
			else:
				_fail("expressions", name, "expected an eval error, got %s" % StoryletValues.show(actual))
		elif StoryletExpression.is_error(actual):
			_fail("expressions", name, "unexpected error: %s" % actual.message)
		else:
			var expected = StoryletValues.to_value(c.get("expected"))
			if StoryletValues.value_equals(actual, expected):
				pass_count += 1
			else:
				_fail("expressions", name, "expected %s, got %s" % [StoryletValues.show(expected), StoryletValues.show(actual)])
	return pass_count


# -- specificity ------------------------------------------------------------------

func _run_specificity(cases: Array) -> int:
	var pass_count := 0
	for c in cases:
		var name: String = c["name"]
		# The compiled `ast` IS the node: the evaluator walks the tagged-tuple
		# form the corpus carries, with no deserialise pass.
		var node = c["ast"]
		if not (node is Array):
			_fail("specificity", name, "malformed AST")
			continue
		var ctx := {"scopes": _scopes_of(c)}
		var truthy := func(n: Array) -> bool:
			var r = StoryletExpression.evaluate(n, ctx, _dialect)
			if StoryletExpression.is_error(r):
				return false
			return StoryletValues.condition_passes(r)
		var actual := StoryletSpecificity.matched_specificity(node, truthy)
		var expected := int(c["expected"])
		if actual == expected:
			pass_count += 1
		else:
			_fail("specificity", name, "expected %d, got %d" % [expected, actual])
	return pass_count


# -- peek ---------------------------------------------------------------------------

# Build a session, apply setup, peek, check the ordered list - then peek AGAIN
# and require the identical list: a peek registers nothing and asking twice is
# free (schema 3.5).
func _run_peek(cases: Array) -> int:
	var pass_count := 0
	for c in cases:
		var name: String = c["name"]
		var engine := StoryletEngine.create(c["bundle"], {"seed": int(c.get("seed", 0))})
		if engine == null:
			_fail("peek", name, "engine refused its options")
			continue
		var session := engine.open_flow("main")
		if c.has("setup"):
			_apply_state(session, c["setup"])
		var box: String = c["box"]
		var criteria: Dictionary = c.get("criteria", {})
		var n = c.get("n")
		var expect: Array = c["expect"]

		var ok := true
		var first_result := session.peek(box, criteria, n)
		if first_result.has("error"):
			_fail("peek", name, "peek errored: %s" % first_result["error"])
			continue
		var first := _ids(first_result["cards"])
		if not _same_list(first, expect):
			_fail("peek", name, "peek: expected %s, got %s" % [_show_list(expect), _show_list(first)])
			ok = false
		var second := _ids(session.peek(box, criteria, n)["cards"])
		if not _same_list(second, first):
			_fail("peek", name, "second peek diverged (a peek must register nothing): %s then %s" % [_show_list(first), _show_list(second)])
			ok = false
		if ok:
			pass_count += 1
	return pass_count


# -- scripted -------------------------------------------------------------------------

func _run_scripted(cases: Array) -> int:
	var pass_count := 0
	for c in cases:
		var failures := _run_scripted_case(c)
		if failures.is_empty():
			pass_count += 1
		else:
			for f in failures:
				_fail("scripted", c["name"], f)
	return pass_count


# Execute the ops in order; every expect must match exactly, expectError ops
# must fail without side effects. Returns failures; empty = pass.
func _run_scripted_case(c: Dictionary) -> Array:
	var failures: Array = []
	var bundle: Dictionary = c["bundle"]
	var seed := int(c.get("seed", 0))
	var first_engine := StoryletEngine.create(bundle, {"seed": seed})
	if first_engine == null:
		return ["engine refused its options"]
	# One mutable holder: GDScript lambdas capture by VALUE, so saveLoad's
	# engine swap must go through a reference the flow_of closure shares.
	# handles = flow handles as the SCRIPT knows them: kept across closeFlow
	# so a later op on a closed name exercises the inert handle, never a
	# quiet re-open.
	var rc := {"engine": first_engine, "handles": {}}
	var names := _hand_game_ids(bundle)

	# Verdicts from the deal or peek an op just ran, card id -> verdict, taken
	# from the trace because that is the only place the REASON lives: a board
	# read says a card is absent, never why, and "claimed" against
	# "claimed-elsewhere" is exactly the distinction it cannot make. A deal
	# fires one event per hand, so the sink accumulates across them; subscribing
	# is also what switches tracing on. The sink lives in rc because GDScript
	# lambdas capture by VALUE.
	rc["verdicts"] = {}
	var watch := func(f: StoryletFlow) -> StoryletFlow:
		f.subscribe_trace(func(e: Dictionary) -> void:
			if e["type"] != "deal" and e["type"] != "peek":
				return
			for card in e["cards"]:
				(rc["verdicts"] as Dictionary)[card["id"]] = card["verdict"])
		return f

	var flow_of := func(op: Dictionary) -> StoryletFlow:
		var flow_name: String = str(op.get("flow", "main"))
		var handles: Dictionary = rc["handles"]
		if not handles.has(flow_name):
			handles[flow_name] = watch.call((rc["engine"] as StoryletEngine).open_flow(flow_name))
		return handles[flow_name]

	var check_verdicts := func(at: String, op: Dictionary, out: Array) -> void:
		for card_id in op.get("expectVerdicts", {}):
			var want: String = op["expectVerdicts"][card_id]
			var got = (rc["verdicts"] as Dictionary).get(card_id)
			if got != want:
				out.append('%s: verdict for %s expected "%s", got %s'
					% [at, card_id, want, ('"%s"' % str(got)) if got != null else "no verdict"])

	var script: Array = c["script"]
	for index in script.size():
		var op: Dictionary = script[index]
		var kind: String = op["op"]
		var at := "op %d (%s)" % [index, kind]
		var session: StoryletFlow = flow_of.call(op)
		match kind:
			"setState":
				_apply_state(session, op)

			"peek":
				rc["verdicts"] = {}
				var list := session.peek(op.get("box", "box"), op.get("criteria", {}), op.get("n"))
				check_verdicts.call(at, op, failures)
				var peek_error: String = list.get("error", "")
				var expect_peek_error: bool = op.get("expectError", false)
				var ids := _ids(list["cards"])
				if expect_peek_error and peek_error == "":
					failures.append("%s: expected an error, peek returned %s" % [at, _show_list(ids)])
				if not expect_peek_error and peek_error != "":
					failures.append("%s: unexpected error: %s" % [at, peek_error])
				if op.has("expect") and peek_error == "":
					if not _same_list(ids, op["expect"]):
						failures.append("%s: expected %s, got %s" % [at, _show_list(op["expect"]), _show_list(ids)])

			"deal":
				rc["verdicts"] = {}
				var dealt := session.deal_many(op.get("hands"))
				check_verdicts.call(at, op, failures)
				for hand_id in op.get("expectBoard", {}):
					var the_board := session.board()
					var key: String = names.get(hand_id, hand_id)
					var actual := _ids(the_board.get(key, []))
					var expected: Array = op["expectBoard"][hand_id]
					if not _same_list(actual, expected):
						failures.append("%s: board[%s] expected %s, got %s" % [at, hand_id, _show_list(expected), _show_list(actual)])
				if op.has("expectDealt"):
					# The dealt slice holds exactly the hands this call dealt:
					# the key set must match, not merely include.
					var expected_keys: Array = []
					for hand_id in op["expectDealt"]:
						expected_keys.append(names.get(hand_id, hand_id))
					expected_keys.sort()
					var actual_keys := dealt.keys()
					actual_keys.sort()
					if not _same_list(actual_keys, expected_keys):
						failures.append("%s: dealt hands expected %s, got %s" % [at, _show_list(expected_keys), _show_list(actual_keys)])
					for hand_id in op["expectDealt"]:
						var key: String = names.get(hand_id, hand_id)
						var actual := _ids(dealt.get(key, []))
						var expected: Array = op["expectDealt"][hand_id]
						if not _same_list(actual, expected):
							failures.append("%s: dealt[%s] expected %s, got %s" % [at, hand_id, _show_list(expected), _show_list(actual)])

			"assertBoard":
				# GDScript has no exceptions: an unknown box push_errors and
				# gives back {} (the documented refusal, as deal_many does).
				# Every assertBoard case here expects at least one hand, so an
				# empty dictionary is unambiguously the refusal.
				var box_ref: String = op.get("box", "")
				var the_board := session.board(box_ref) if box_ref != "" else session.board()
				var board_error := session.is_closed() or (box_ref != "" and the_board.is_empty())
				var expect_board_error: bool = op.get("expectError", false)
				if expect_board_error and not board_error:
					failures.append("%s: expected an error, board returned %s" % [at, _show_list(the_board.keys())])
				if not expect_board_error and board_error:
					failures.append('%s: unexpected error: unknown box "%s"' % [at, box_ref])
				if op.has("expect") and not board_error:
					# The filtered board holds exactly the hands of that box:
					# the key set must match, not merely include.
					var expected_keys: Array = []
					for hand_id in op["expect"]:
						expected_keys.append(names.get(hand_id, hand_id))
					expected_keys.sort()
					var actual_keys := the_board.keys()
					actual_keys.sort()
					if not _same_list(actual_keys, expected_keys):
						failures.append("%s: board hands expected %s, got %s" % [at, _show_list(expected_keys), _show_list(actual_keys)])
					for hand_id in op["expect"]:
						var key: String = names.get(hand_id, hand_id)
						var actual := _ids(the_board.get(key, []))
						var expected: Array = op["expect"][hand_id]
						if not _same_list(actual, expected):
							failures.append("%s: board[%s] expected %s, got %s" % [at, hand_id, _show_list(expected), _show_list(actual)])

			"play":
				var opts := {}
				if op.has("advanceTurns"):
					opts["advance_turns"] = float(op["advanceTurns"])
				var error := session.play(op["card"], op["outcome"], op["from"], opts)
				var expect_error: bool = op.get("expectError", false)
				if expect_error and error == "":
					failures.append("%s: expected an error, play succeeded" % at)
				if not expect_error and error != "":
					failures.append("%s: unexpected error: %s" % [at, error])

			"advanceTurns":
				session.advance_turns(op["box"], float(op["n"]))

			"assertOutcomes":
				var views := session.outcomes(op["card"], op["from"])
				for game_id in op["expect"]:
					var actual := false
					for v in views:
						if v["gameId"] == game_id:
							actual = v["available"]
							break
					var expected: bool = op["expect"][game_id]
					if actual != expected:
						failures.append("%s: %s expected %s, got %s" % [at, game_id, str(expected).to_lower(), str(actual).to_lower()])

			"assertOutcomeOrder":
				# The order outcomes come back in: the bundle carries the author's
				# order, not id order, and that order is the player's menu.
				var ordered := session.outcomes(op["card"], op["from"])
				var got: Array = []
				for v in ordered:
					got.append(v["gameId"])
				var want: Array = op["expect"]
				if got != want:
					failures.append("%s: expected [%s], got [%s]" % [at, ", ".join(want), ", ".join(got)])

			"assertState":
				for path in op["expect"]:
					var actual = _read_state(session, path)
					var expected = StoryletValues.to_value(op["expect"][path])
					if actual == null or (actual is float and is_nan(actual)) or not StoryletValues.value_equals(actual, expected):
						failures.append("%s: %s expected %s, got %s" % [at, path, StoryletValues.show(expected), StoryletValues.show(actual)])

			"openFlow":
				var open_opts := {}
				if op.has("seed"):
					open_opts["seed"] = int(op["seed"])
				(rc["handles"] as Dictionary)[str(op["flow"])] = (rc["engine"] as StoryletEngine).open_flow(str(op["flow"]), open_opts)

			"closeFlow":
				(rc["engine"] as StoryletEngine).close_flow(str(op["flow"]))

			"assertFlows":
				# Order is a contract: save_game keys its flows in it, so two
				# runtimes that disagree write different .storyletsave bytes.
				var live_ids: Array = []
				for f in (rc["engine"] as StoryletEngine).flows():
					live_ids.append((f as StoryletFlow).id)
				var want_ids: Array = []
				for v in op["expect"]:
					want_ids.append(str(v))
				if live_ids != want_ids:
					failures.append("%s: flows are %s, expected %s" % [at, str(live_ids), str(want_ids)])

			"assertEngineRead":
				# Engine-level read: world.* and shared refs answer; a per-flow
				# ref must refuse (null return IS the refusal - a declared
				# scalar is never null).
				var engine_value = (rc["engine"] as StoryletEngine).get_property(str(op["path"]))
				var read_errored := engine_value == null
				var expect_read_error: bool = op.get("expectError", false)
				if expect_read_error and not read_errored:
					failures.append("%s: expected an error, engine read of %s returned %s" % [at, op["path"], StoryletValues.show(engine_value)])
				if not expect_read_error and read_errored:
					failures.append("%s: unexpected error reading %s" % [at, op["path"]])
				if op.has("expect") and not read_errored:
					var expected_value = StoryletValues.to_value(op["expect"])
					if not StoryletValues.value_equals(engine_value, expected_value):
						failures.append("%s: %s expected %s, got %s" % [at, op["path"], StoryletValues.show(expected_value), StoryletValues.show(engine_value)])

			"saveLoad":
				# Serialise the WHOLE engine, discard it, restore into a fresh
				# one (semantic parity, not byte parity). into: "B" restores
				# into the case's EDITED bundle: the drifted-content contract.
				# load_game rebuilds every flow, so the handles are re-taken.
				var envelope: Dictionary = (rc["engine"] as StoryletEngine).save_game()
				var into: Dictionary = c["bundleB"] if op.get("into") == "B" else bundle
				var next_engine := StoryletEngine.create(into, {"seed": seed})
				var err := next_engine.load_game(envelope)
				if err != "":
					failures.append("%s: load refused: %s" % [at, err])
				rc["engine"] = next_engine
				var next_handles := {}
				for f in next_engine.flows():
					next_handles[(f as StoryletFlow).id] = f
				rc["handles"] = next_handles

			"reset":
				rc["engine"] = StoryletEngine.create(bundle, {"seed": seed})
				rc["handles"] = {}

			_:
				failures.append("%s: unknown op" % at)
	return failures
