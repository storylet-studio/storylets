@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# The expression AST: deserialise the compiled bundle's tagged-tuple form
# (JSON arrays, opcode at index 0) into the in-memory node Dictionaries the
# evaluator walks. Port of @wildwinter/expr's ast.ts. Expressions arrive
# pre-compiled in the bundle; no port ships a parser.
#
# Node shapes (kind field discriminates, mirroring ExprNode):
#   {"kind": "bool",      "value": bool}
#   {"kind": "number",    "value": float}
#   {"kind": "string",    "value": String}
#   {"kind": "scopedvar", "scope": String, "name": String}
#   {"kind": "call",      "name": String, "args": Array}
#   {"kind": "unary",     "op": "not"|"neg", "operand": node}
#   {"kind": "binary",    "op": String, "left": node, "right": node}
#   {"kind": "flagdelta", "sign": "+"|"-", "name": String}
class_name StoryletAst


## Tagged-tuple array -> node Dictionary; null (with push_error) on a malformed
## node. Numbers are normalised to float at this boundary.
static func deserialise(node) -> Variant:
	if not (node is Array) or (node as Array).is_empty():
		push_error("StoryletAst: malformed AST node: %s" % str(node))
		return null
	var arr: Array = node
	match str(arr[0]):
		"b":
			return {"kind": "bool", "value": bool(arr[1])}
		"n":
			return {"kind": "number", "value": float(arr[1])}
		"s":
			return {"kind": "string", "value": str(arr[1])}
		"sv":
			return {"kind": "scopedvar", "scope": str(arr[1]), "name": str(arr[2])}
		"u":
			var operand = deserialise(arr[2])
			if operand == null:
				return null
			return {"kind": "unary", "op": str(arr[1]), "operand": operand}
		"bin":
			var left = deserialise(arr[2])
			var right = deserialise(arr[3])
			if left == null or right == null:
				return null
			return {"kind": "binary", "op": str(arr[1]), "left": left, "right": right}
		"call":
			var args: Array = []
			for i in range(2, arr.size()):
				var child = deserialise(arr[i])
				if child == null:
					return null
				args.append(child)
			return {"kind": "call", "name": str(arr[1]), "args": args}
		"fd":
			return {"kind": "flagdelta", "sign": str(arr[1]), "name": str(arr[2])}
	push_error("StoryletAst: unknown AST opcode: %s" % str(arr[0]))
	return null
