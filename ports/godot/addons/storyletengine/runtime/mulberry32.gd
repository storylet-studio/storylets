@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# mulberry32 - the contractual session PRNG (schema 3.3): expression random(),
# ranking tie shuffles and the batch deal's hand-order shuffle all draw from the
# one stream, bit-for-bit identical to the JS reference (packages/runtime/src/
# prng.ts). Worked in unsigned 32-bit by masking with & 0xffffffff at every
# step, matching JavaScript's `>>> 0` / Math.imul; GDScript ints are 64-bit, so
# the masks keep us in range. Default seed 0; the state is a plain uint32
# persisted in the save envelope.
class_name StoryletMulberry32
extends RefCounted

var _s: int


func _init(seed_value: int = 0) -> void:
	_s = seed_value & 0xffffffff


## One draw in [0, 1); advances the state.
func next() -> float:
	_s = (_s + 0x6d2b79f5) & 0xffffffff
	var t := _imul(_s ^ (_s >> 15), 1 | _s)
	t = (((t + _imul(t ^ (t >> 7), 61 | t)) & 0xffffffff) ^ t) & 0xffffffff
	return float((t ^ (t >> 14)) & 0xffffffff) / 4294967296.0


## The persisted state (a uint32; feed back into _init to restore).
func state() -> int:
	return _s


## The contractual shuffle: Fisher-Yates, descending (schema 3.3). Runs of one
## element consume no draws (the loop never executes for size < 2).
static func shuffle_in_place(arr: Array, prng: StoryletMulberry32) -> void:
	for i in range(arr.size() - 1, 0, -1):
		var j := int(floor(prng.next() * float(i + 1)))
		var tmp = arr[i]
		arr[i] = arr[j]
		arr[j] = tmp


# Math.imul: the low 32 bits of x*y. Computed via 16-bit halves so the
# intermediate product never overflows GDScript's signed 64-bit int (a full
# 32x32 multiply would reach ~2^64).
static func _imul(x: int, y: int) -> int:
	x = x & 0xffffffff
	y = y & 0xffffffff
	var xl := x & 0xffff
	var xh := (x >> 16) & 0xffff
	return (xl * y + (((xh * y) & 0xffff) << 16)) & 0xffffffff
