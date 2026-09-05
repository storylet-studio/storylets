---
"@storylet-studio/model": minor
---

Hand positions in the bundle's `maps` block (design/engine-server.md 4.3).

`BundleMap.sites` carries where each placed hand stands, by hand gameId, under the same `export.map` opt-in as the zones and the background pictures. It is sorted by gameId so the bytes do not move when somebody reorders a shard, absent entirely on a map nobody has placed a hand on, and it never repeats the zone a hand binds: the hand's own binding is what the runtime deals from, and a second copy could only go on to disagree with it.

**This reverses a ruling.** `BundleMap`'s doc comment used to say sites were deliberately not there, because a position was where an author parked a hand while working. That held for a game, where a hand's zone is its only real-world meaning. It does not hold for a physical experience, where the position IS content: it is where the kiosk stands, and a producer's map is wrong without it. The alternative was a second file beside the bundle, which would cost a format the four inspectors do not read and would put the view sidecar into the shipping path by the back door.

Derived in `compileMaps`, from the view sidecar the compiler has always parsed (`SourceBox.view`), so nothing had to be threaded through to reach it. Per box rather than per group, which is where the positions live: a box with two spatial groups ships the same sites on both, exactly as the editor and the playable page already draw them.

`describeBundle`'s `MapSummary` gains `sites`, and the four bundle inspectors count it beside the zones and the pictures. The three native runtimes parse it and hand it over; the Unreal inspector gains the Maps section the other three already had. No runtime behaviour, no corpus case, no `CORPUS_VERSION` bump: the block is inert payload and stays inert.

`playableMaps` still derives its own sites from the sidecar, because the playable page needs a label and the bound zone beside each position and the block carries neither.
