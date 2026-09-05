# @storylet-studio/model

## 0.3.0

### Minor Changes

- f1a4744: Hand positions in the bundle's `maps` block (design/engine-server.md 4.3).
  
  `BundleMap.sites` carries where each placed hand stands, by hand gameId, under the same `export.map` opt-in as the zones and the background pictures. It is sorted by gameId so the bytes do not move when somebody reorders a shard, absent entirely on a map nobody has placed a hand on, and it never repeats the zone a hand binds: the hand's own binding is what the runtime deals from, and a second copy could only go on to disagree with it.
  
  **This reverses a ruling.** `BundleMap`'s doc comment used to say sites were deliberately not there, because a position was where an author parked a hand while working. That held for a game, where a hand's zone is its only real-world meaning. It does not hold for a physical experience, where the position IS content: it is where the kiosk stands, and a producer's map is wrong without it. The alternative was a second file beside the bundle, which would cost a format the four inspectors do not read and would put the view sidecar into the shipping path by the back door.
  
  Derived in `compileMaps`, from the view sidecar the compiler has always parsed (`SourceBox.view`), so nothing had to be threaded through to reach it. Per box rather than per group, which is where the positions live: a box with two spatial groups ships the same sites on both, exactly as the editor and the playable page already draw them.
  
  `describeBundle`'s `MapSummary` gains `sites`, and the four bundle inspectors count it beside the zones and the pictures. The three native runtimes parse it and hand it over; the Unreal inspector gains the Maps section the other three already had. No runtime behaviour, no corpus case, no `CORPUS_VERSION` bump: the block is inert payload and stays inert.
  
  `playableMaps` still derives its own sites from the sidecar, because the playable page needs a label and the bound zone beside each position and the block carries neither.
- f1a4744: The play ladder: one project setting that decides how much of the editor you see (design/engine-server.md 4.10).
  
  `ProjectShard.settings.play` is `"solo"`, `"shared"` or `"venue"`, absent meaning `"solo"`. Storyletter offers TWO of those: `solo` and `shared`, which are about simplifying the editor and are the author's to pick. `venue` is the third, written by a licensed Storylet Server into the projects it seeds and hands back; the model keeps it a valid value and the editor honours a project that carries it, but no surface offers it. A timed box and a hole filled from a property are governed by no rung at all: they are engine features any game may want.
  
  **The engine and the bundle never see it.** `BundleSettings` is unchanged and the compiler still emits exactly `playAdvancesTurns`; the rung stays in the project shard beside `coverage` and `export`, which the model already marks as authoring config. A solo project plays on the same `Engine` as a venue one.
  
  `contentAboveRung(source, rung)` is the one implementation of "what does this project contain that the rung would hide", and `summariseLadder` phrases the answer ("3 declarations are shared, 1 deck is durable"). It counts the two flags and nothing else: `shared` content above `solo`, `durable` content above either. The compiler calls it to raise a validate WARNING per item; Storyletter calls the same function to REFUSE a move down the ladder. Two copies of that rule would let the editor and the file disagree in silence, which is the thing the setting exists to prevent.
  
  The warning names a way out that Storyletter can actually take. Shared content above `solo` may move the rung or drop the flag, and the message says both. Durable content says only "Remove the flag": setting `venue` is the server's, so naming it would send an author to a control that is not there.
  
  `runInit` lands the starter project on `"solo"`, written rather than left absent: a shard that names its rung is one an author can read.
- f1a4744: A box that counts in time: `turn: { seconds: N }` (design/engine-server.md 4.8).
  
  A box may declare that its turns are TIME rather than plays. `Box.turn` is the declaration, written in `box.storyletbox` and compiled into the bundle unchanged, and a box that carries it is a timed box.
  
  One branch in `play` is the whole of it in the engine: a play in a timed box defaults to advancing 0 rather than `settings.playAdvancesTurns`, so a designer cannot declare the convention and then forget to switch play-advance off. A call that names `advanceTurns` still gets what it asked for, in either kind of box, because the call says otherwise. The host ticks a timed box with `advanceTurns` exactly as it always could: the runtime has no clock and gains none here, and the seconds are never read by it.
  
  What does change is what the tools SAY. `redraw: N` on a card in a timed box means N x `seconds`, so `redraw: 30` in a sixty-second box is half an hour: the card editor labels the field in the box's unit and converts as the designer types, the box page's new Turns section states the consequence in plain words, and the Board shows the unit beside the counter with advance buttons scaled to it. `describeBundle` reports the unit on `BoxSummary`, and the four bundle inspectors show `turn = 60s` on a timed box and nothing at all on an ordinary one. The coverage report reads its turn budget as time when every box in the project agrees on a unit, and the sweep ticks a timed box itself, since the harness is the host.
  
  The compiler refuses a `seconds` that is not a positive integer, and warns about a timed box whose every card says `redraw: "always"`, since nothing in it then rests and being timed buys the box nothing. `turnSpan` in `model` is the one conversion the four surfaces quote.
  
  Corpus first, as ever: six cases and corpus version 5, passing in all four runtimes.
- f1a4744: The installation contract: what an author may not break (design/engine-server.md 4.11, net 1).
  
  A new shard kind, `contracts/<installation>.storyletcontract`, JSON5 and canonical like every other. A venue is provisioned against NAMES - the hands its stations deal, the boxes its scheduler ticks, the properties its clocks drive, the fields its crew and its bridges read - and a rename that reaches the venue is a dark kiosk on the night. So the venue's server writes those names down, one file per installation, in its own folder because its owner is the venue and not the author, and `validate` refuses a build that breaks one.
  
  `ContractShard` in `model`, `SourceProject.contracts` in the compiler, and `contractIssues` in ops, which raises an ERROR for each break: a contracted hand gameId that no longer exists, a contracted box whose turn is no longer that many seconds (or is no longer timed at all), a contracted property that has gone or whose type changed, a contracted card field no box declares any more, and two files claiming the same installation. Every message names the dependency and the venue, because a refusal that does not say who cares is one that gets worked around. Each is anchored to the shard that would fix it wherever the entity is still there to be fixed, and to the contract when the name has gone entirely.
  
  Property paths use the engine's own address grammar with no `@` ("world.time_wall", "story.visits"), which is how `listProperties()` prints them, and the owner segment is accepted as either the gameId or the internal id. A property may be written as a bare path or as `{ path, type }`; only the second form can catch a type change, which is the break that costs a producer most.
  
  **The contract never compiles.** It is project-side config like `coverage` and `export`: the server does not need its own contract back, it needs the bundle to still honour it. It merges as one atomic file, because the server rewrites it whole from provisioning and interleaving two halves would synthesise a contract no venue was ever provisioned against.
  
  `contractNotes` is the one derivation of "what depends on this entity", so `storyletengine contract show`, the editor's quiet line and the errors cannot come to disagree. The server that writes these does not exist yet: a project either has none, which is the normal state and changes nothing, or one written by hand.
  
  A box may still be CALLED contracts - Port Meridian's is - so the registry is recognised by extension inside that folder, not by the folder alone.
- f1a4744: Park one flow, and price a load before you take it (design/engine-server.md 4.1 and 4.9).
  
  `Engine.saveFlow(id)` takes one flow's state and `openFlow(id, { restore })` opens that name as it was. An option on `openFlow` rather than a `restore` verb, because restoring INTO a running flow is the trap replace semantics set. Closing a parked flow releases its shared claims, so a card it held can be dealt elsewhere while it is away; on the way back, a shared card the world has since given out is dropped as `claimed-elsewhere` rather than double-claimed.
  
  `previewLoad(envelope)` and `previewFlowRestore(id, save)` say what a restore would change without changing it, and `loadGame` now returns the same `LoadReport` (new, in `model`): cards evicted and why, cooldowns and spent entries for cards the build no longer has, properties dropped, defaulted or retyped, and `version` / `hash` drift, which used to load in silence. A save for another project is still the one refusal.
  
  A load also prunes what it reports now: an undeclared property, a cooldown for a deleted card, and a saved value that no longer fits its declaration are dropped rather than carried into the next save.
- f1a4744: The durability axis: `durable` on a declaration, a deck and a card (design/engine-server.md 4.2).
  
  `shared` says whose a value is WITHIN a run. `durable` says whether it survives the run at all, and the two are independent: shared and durable is the installation's memory (trolls defeated since it opened), per-flow and durable is the player's pocket (visits, allegiance, what they earned).
  
  `PropertyDecl.durable` is valid wherever `shared` is, and is a compile error on a `@world` declaration for the reason `shared` is: `@world` is the game's own state, and how long the game keeps it is the game's business.
  
  `Deck.durable` and `Card.durable` mean one thing: the card's `redraw: "never"` spend survives the run. A card takes its deck's flag unless it sets its own, exactly as `shared` already works between the two. Only `"never"` can cross a run boundary, for the reason only `"never"` crosses the flow boundary in shared-scarcity 9.3.2 - a finite cooldown is an absolute turn of a box clock, and the clock resets with the run - so `durable` on any other redraw is a compile warning, said on the card that set it, and a durable deck with nothing spent for good in it is warned about once, on the deck.
  
  **The runtime is INERT.** The engine partitions by `shared` alone and never reads the flag. Durability is what a server does at a run boundary, entirely on the public surface: read the declarations, lift the values with `getProperty` and the spends out of `saveGame`, then put them back with `setProperty`, `openFlow(id, { restore })` and `markTaken`. No corpus case, because nothing about play is different.
  
  The four bundle parsers carry the flag so the four inspectors can report it: `describeBundle` marks a durable declaration with `durable: true` on `PropertySummary` and counts a box's durable cards as `BoxSummary.durableCards`, and each inspector shows "(durable)" on the property row and "durable cards N" on the box's counts line.
- f1a4744: A hole filled from a property: the hand that moves (design/engine-server.md 4.6).
  
  A hand's `chosen` value, or a standalone hand's `rule.bindings` value, may be a property reference (`"@hand.zone"`, `"@story.where"`, `"@world.place"`) instead of a tag. The engine resolves it at ask time and binds the hole to the tag the value names, so moving the Elder to the forest is `setProperty("hand.the-elder.zone", "forest")` and the next deal follows: forest-tagged cards become available at his hand, village-tagged ones are evicted with reason `tags`. No new verb, no new save shape, no new trace kind, and the on-disk form is still a plain string, so the canonical serialiser and the shard merge are untouched.
  
  The semantics are `boundBy`'s, word for word, applied per hole rather than per group: a value naming no tag leaves the hole UNBOUND, which is a wildcard, with a `diagnostic` rather than a silently empty hand. The added scope is `@hand`, the asking hand's own declared state, read from the flow's merged view BEFORE tag composition, so a movable hole can never depend on the tags it is choosing; `shared: true` on the declaration moves the hole for every flow and a per-flow one moves it for that flow alone.
  
  The compiler validates the reference as it validates `boundBy`: it must name a property this hand or its template declares (or a declared `@story` / `@world` one), of type string or enum, and an enum whose values can never name a tag is an error while one that may hold a stray value is a warning. `place` cannot be filled this way (it is the hand's own name), and neither can a hand template's own bindings, which are the same for every instance.
  
  `describeBundle` reports a hand's movable holes as `movable: [{ group, from }]` on `HandSummary`, and `parseHoleRef` / `isHoleRef` in `model` are how the string is read.

## 0.2.0

### Minor Changes

- d7e55c9: `@world` declarations carry an optional `writable` flag (`writable: false` is the story's promise that only the game moves the value), name for name with Patter's `HostScopeDecl.writable`. The compiler refuses a card that writes such a property and every runtime refuses one at run time; Storyletter shows it as the Read-only switch.
