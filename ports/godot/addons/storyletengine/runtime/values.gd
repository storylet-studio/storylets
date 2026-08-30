@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# Storylet scalar-value helpers. Values are native GDScript Variants: bool /
# float / String / Array of String (flags). All numbers are normalised to float
# so value equality matches the JS runtime (true == 1 is false; 8 == 8.0 is
# true; GDScript float IS a double). Mirrors StoryletValue in the C# port and
# @wildwinter/expr's ScalarValue.
#
# The storylets PropertyType set is boolean / number / string / enum / flags;
# an enum value is a string at runtime, so four kinds carry all five types.
class_name StoryletValues


## Normalise a JSON-parsed (or host-supplied) value: ints become floats, arrays
## become string arrays, bool / float / String pass through.
static func to_value(v) -> Variant:
	match typeof(v):
		TYPE_INT:
			return float(v)
		TYPE_FLOAT:
			return v
		TYPE_BOOL:
			return v
		TYPE_STRING, TYPE_STRING_NAME:
			return str(v)
		TYPE_ARRAY:
			var out: Array = []
			for x in v:
				out.append(str(x))
			return out
	return v


## `==` / `!=` semantics (the evaluator's valueEquals): primitives by value;
## flags element-wise, in order; mixed kinds unequal. Booleans are never
## numbers (true != 1, matching JS ===); int and float are one numeric kind.
static func value_equals(a, b) -> bool:
	var ta := typeof(a)
	var tb := typeof(b)
	if ta == TYPE_ARRAY or tb == TYPE_ARRAY:
		if ta != TYPE_ARRAY or tb != TYPE_ARRAY:
			return false
		if a.size() != b.size():
			return false
		for i in a.size():
			if a[i] != b[i]:
				return false
		return true
	var a_num := ta == TYPE_INT or ta == TYPE_FLOAT
	var b_num := tb == TYPE_INT or tb == TYPE_FLOAT
	if a_num and b_num:
		return float(a) == float(b)
	if ta != tb:
		return false
	return a == b


## The storylets condition coercion (schema 3.1): booleans as themselves,
## numbers pass when non-zero, everything else fails.
static func condition_passes(v) -> bool:
	match typeof(v):
		TYPE_BOOL:
			return v
		TYPE_FLOAT:
			return v != 0.0
		TYPE_INT:
			return v != 0
	return false


## True when the value is numeric (int or float). Session values are always
## floats; this guards host-supplied ints too.
static func is_number(v) -> bool:
	var t := typeof(v)
	return t == TYPE_FLOAT or t == TYPE_INT


## The evaluator's error-message type names (mirrors JS typeof for the four
## value kinds; flags arrays read as "flags" rather than JS's "object").
static func type_name(v) -> String:
	match typeof(v):
		TYPE_BOOL:
			return "boolean"
		TYPE_FLOAT, TYPE_INT:
			return "number"
		TYPE_STRING, TYPE_STRING_NAME:
			return "string"
		TYPE_ARRAY:
			return "flags"
	return "unknown"


## Format a number the way JavaScript's String(n) does (the cross-runtime
## diagnostic-rendering contract): integral doubles print with no decimal point.
static func js_number(n: float) -> String:
	if is_nan(n):
		return "NaN"
	if is_inf(n):
		return "Infinity" if n > 0.0 else "-Infinity"
	if n == floor(n) and absf(n) < 1e15:
		return str(int(n))
	return String.num(n)


## A compact JSON-ish rendering for diagnostics and failure reports (the shape
## JSON.stringify gives the JS runner).
static func show(v) -> String:
	match typeof(v):
		TYPE_BOOL:
			return "true" if v else "false"
		TYPE_FLOAT:
			return js_number(v)
		TYPE_INT:
			return js_number(float(v))
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(v))
		TYPE_ARRAY:
			var parts: Array = []
			for x in v:
				parts.append(show(x))
			return "[" + ",".join(parts) + "]"
	return str(v)
