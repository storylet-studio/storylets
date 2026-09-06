---
"@storylet-studio/model": minor
---

`valueAddresses(bundle)`: the owner segment of a tag's property address, box-qualified where it has to be (design/engine-server.md 4.4).

Every other owned scope names its owner with a gameId that is unique across the bundle. A TAG's is unique only within its group, and a group's only within its box, so a harbour box and a cellar box may each have a `docks`, and `value.docks.danger` named two stores at once. The rule now: `value.<boxGameId>/<tagGameId>.<name>` wherever a tag gameId repeats in the bundle, with the slash INSIDE the owner segment so an address still splits into three on the dot and every parser keeps its shape; the qualified form is accepted always, the short form only while one tag carries that gameId, and refused rather than guessed at when more do.

`valueAddresses` returns the three answers that rule needs: `print` (tag id to the segment an address shows), `accept` (every segment an address takes, back to the tag id) and `repeated` (a gameId more than one box uses, to its candidates). `ambiguousValueAddressMessage` is the refusal's wording, candidates and all, because "that names two tags" without them leaves a host reading a bundle it did not write to find out which boxes.

It is here rather than in the runtime because two programs answer the same question from different sides: the engine builds its owner index once from the bundle it was given, and the Board draws the same addresses straight off the bundle to label its state strip. Two implementations would drift, and the drift shows up as an address the editor prints and the engine refuses, which is the fault the whole gameId pass exists to remove. The three native runtimes mirror it, held by the corpus.

The compiler refuses a `/` anywhere in an effective address. A pinned gameId could never contain one (the address grammar has always refused it) and `gameIdify` cannot produce one; an entity with neither a gameId nor a title takes its own id, and an id is not shape-checked, which was the one route a slash could reach a bundle by and split an owner segment in two.
