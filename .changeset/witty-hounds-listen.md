---
"@storylet-studio/model": minor
---

A hole filled from a property: the hand that moves (design/engine-server.md 4.6).

A hand's `chosen` value, or a standalone hand's `rule.bindings` value, may be a property reference (`"@hand.zone"`, `"@story.where"`, `"@world.place"`) instead of a tag. The engine resolves it at ask time and binds the hole to the tag the value names, so moving the Elder to the forest is `setProperty("hand.the-elder.zone", "forest")` and the next deal follows: forest-tagged cards become available at his hand, village-tagged ones are evicted with reason `tags`. No new verb, no new save shape, no new trace kind, and the on-disk form is still a plain string, so the canonical serialiser and the shard merge are untouched.

The semantics are `boundBy`'s, word for word, applied per hole rather than per group: a value naming no tag leaves the hole UNBOUND, which is a wildcard, with a `diagnostic` rather than a silently empty hand. The added scope is `@hand`, the asking hand's own declared state, read from the flow's merged view BEFORE tag composition, so a movable hole can never depend on the tags it is choosing; `shared: true` on the declaration moves the hole for every flow and a per-flow one moves it for that flow alone.

The compiler validates the reference as it validates `boundBy`: it must name a property this hand or its template declares (or a declared `@story` / `@world` one), of type string or enum, and an enum whose values can never name a tag is an error while one that may hold a stray value is a warning. `place` cannot be filled this way (it is the hand's own name), and neither can a hand template's own bindings, which are the same for every instance.

`describeBundle` reports a hand's movable holes as `movable: [{ group, from }]` on `HandSummary`, and `parseHoleRef` / `isHoleRef` in `model` are how the string is read.
