---
"@storylet-studio/model": minor
---

The play ladder: one project setting that decides how much of the editor you see (design/engine-server.md 4.10).

`ProjectShard.settings.play` is `"solo"`, `"shared"` or `"venue"`, absent meaning `"solo"`. Storyletter offers TWO of those: `solo` and `shared`, which are about simplifying the editor and are the author's to pick. `venue` is the third, written by a licensed Storylet Server into the projects it seeds and hands back; the model keeps it a valid value and the editor honours a project that carries it, but no surface offers it. A timed box and a hole filled from a property are governed by no rung at all: they are engine features any game may want.

**The engine and the bundle never see it.** `BundleSettings` is unchanged and the compiler still emits exactly `playAdvancesTurns`; the rung stays in the project shard beside `coverage` and `export`, which the model already marks as authoring config. A solo project plays on the same `Engine` as a venue one.

`contentAboveRung(source, rung)` is the one implementation of "what does this project contain that the rung would hide", and `summariseLadder` phrases the answer ("3 declarations are shared, 1 deck is durable"). It counts the two flags and nothing else: `shared` content above `solo`, `durable` content above either. The compiler calls it to raise a validate WARNING per item; Storyletter calls the same function to REFUSE a move down the ladder. Two copies of that rule would let the editor and the file disagree in silence, which is the thing the setting exists to prevent.

The warning names a way out that Storyletter can actually take. Shared content above `solo` may move the rung or drop the flag, and the message says both. Durable content says only "Remove the flag": setting `venue` is the server's, so naming it would send an author to a control that is not there.

`runInit` lands the starter project on `"solo"`, written rather than left absent: a shard that names its rung is one an author can read.
