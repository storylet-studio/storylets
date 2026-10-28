# Changelog

The **JS reference runtime**, one of the four Storylet Engine runtimes. All four carry the
same version and are released together, bumped by `npm run bump:play` and shipped by their
`play-<engine>-vX.Y.Z` tags. The JS one's release workflow reads the section for the tagged
version out of this file and uses it as the release notes, and refuses a tag with no dated
section for it.

## [Unreleased]

### Added

- **`onRefit`: the game hears what a refitting load put back.** A game that loads its own registry with
  `{ refit: true }` has a saved value that no longer fits its declaration (a stage, an enum value or a flag deleted
  since the save, or a value of another type) put back to its default. `EngineOptions.onRefit(misfits)` hears this
  engine's share of those, each a `LoadMisfit` (`scope`, `name`, and the `value` the save held, the type now exported
  from the package), as the engine's bags claim them: as the engine is made, as a flow opens, and after `loadGame`.
  Only this engine's keys (`story`, `storylets/...` and the host scopes it backs itself): another engine on the same
  registry takes its own. With no handler, a console warning per value, so a drifted save is never silent.
  Patterplay's `onRefit`, the same shape.
- **Property paths in Patter's form too.** `getProperty` and `setProperty`, on the engine and on a flow take a leading `@`, as Patter's do: `@story.gold` is
  `story.gold`, `@world.clock` is `world.clock`, and a bare `@gold` is the story's, as it is in an expression. The
  plain form is unchanged. Corpus 25 pins it in every runtime.
- **Any game scope, not only `@world`.** A project can declare its own scopes beside `@world` (`@player`, say),
  in Patter's shape: a token, a scope-level `writable`, and declarations, or none for an opaque scope that takes any
  name. The bundle carries them as `scopeRegistry`, and an engine on its own backs each one from its defaults,
  stores it, saves it and reseeds it on a reset, as it did `@world`. Every `@world` path works for any of them:
  `getProperty` and `setProperty` on `player.hp`, `listProperties` rows, the host-write check, a story write
  refused on a read-only name, and coverage drivers on `@player.hp`. `describeBundle` lists each (`scope: "host"`,
  the token as `owner`). The conformance corpus (version 23) checks it in every runtime.
- **`PlayError.kind` "setup".** `onError` hears how the engine was set up as the constructor ends: a host scope the
  bundle doesn't declare (naming the declared spelling when only the case differs, since a token is case-sensitive)
  and an option it doesn't take. Patterplay's report, word for word.

- **`discard(card, hand)`.** Takes a card out of a hand without playing it, when the player turns it down or the
  game wants the room: no outcome, no move of the clock, nothing in the play log. Its Redraw starts as a play's
  would, so the next deal doesn't hand it straight back. A `discard` trace event says so.
- **Weights, In one hand, and Across hands, in place of copies.** A card's `weight` (default 1) orders a run of
  cards of equal rank: weight 2 comes up ahead twice as often as weight 1, and a run whose weights are all equal
  shuffles exactly as before. `inOneHand: N` lets a card fill up to N slots of one hand. `acrossHands: "any"` lets
  any number of hands hold it at once; the default `"one"` keeps a one-off in one place. A bundle that still says
  `copies` deals as it did.
- **A box whose clock the game moves.** A box with `turn` and no `seconds` advances nothing on a play, as a timed
  box doesn't: a calendar, ticked by the game.

- **`onError`: the game hears about a condition that failed.** A condition the engine can't evaluate (a division by
  zero, a value of the wrong type from a resolver) still counts as false, and now also reaches `EngineOptions.onError`
  as a `PlayError` (`flow`, `kind`, `node`, `source`, `message`), whether or not anything is tracing. With no handler
  it's a console warning. It used to reach only a trace, so with tracing off a typo looked like a card that never
  came up. The same option and shape as Patterplay's.
- **`Bundle`, `SaveEnvelope` and `LoadReport` are exported**, so a game can type what it hands the engine and what a
  load hands back without depending on the model package.

### Changed

- **The `world` option has gone: bind your game's scopes through `hostScopes`.** One map of token to resolver,
  `new Engine(bundle, { hostScopes: { world: { get, set } } })`, binds `@world` and any other scope the bundle
  declares, named and shaped as Patterplay's option (`HostScope` is the resolver's type). A scope you leave out is
  backed by the engine as before. Passing `world` is reported (`the engine option "world" has gone: bind the scope
  as hostScopes: { world }`) and binds nothing.
- **Bundles are `storylets/bundle@2`.** The game's scopes are `scopeRegistry`, and the `world` block is gone. `@1`
  and `@0` bundles still load, their `world.properties` read as the scope `world`; an older runtime refuses an `@2`
  bundle by its schema rather than misreading it.

- **A deal makes the hand right.** A deal ranks everything eligible, including what the hand holds, and the hand
  becomes the top of that ranking, full or not. A better card that has become eligible takes the place of a worse
  one, which goes back to the stock (`evict`, reason `outranked`); a held card wins a tie, so an equal card never
  swaps in. A hand used to keep every card it held while it stayed eligible, so a newly eligible better card waited
  for a free slot.
- **A load drops a held card that no longer qualifies.** A save made before a content edit could put back a card
  whose condition the edit made false, and nothing said so. A load now checks every held card as a deal would, with
  the values the save carries, and drops what no longer qualifies, listed in the report's `evicted` with the deal's
  reason (`condition`, `deck-gate` and so on); `previewLoad` says the same. When the game loads its own registry,
  the values aren't there yet, and the next deal does it.
- **Saves name cards by Game ID.** A save (now `storylets/save@3`) keys a flow's board, cooldowns and box clocks, and
  the spent shared cards, by Game ID, as its play log always did. A card deleted and made again under the same Game
  ID keeps its place, its cooldown and its play count, where it used to keep only the count. Older saves still load,
  and a load report names a card the build no longer has by the key the save carries.

### Fixed

- **A load checks the hand against the saved world, not the old one.** `loadState` and `deserializeState` take
  `{ world }`, the host's @world container (`createWorldContainer`, or anything with `values` and `load`), and put
  the file's @world values into it before the engine loads, so a held card gated on @world isn't dropped for a
  world the save no longer has. A refused load leaves the container as it was. Without the option the values are
  only returned, as before, and a game should apply them before loading.
- **A refitting load keeps "none chosen".** When a game loads the shared registry itself with refit on
  (`registry.load(blob, { refit: true })`), as a game that also runs Patterplay may, a saved `""` on an enum whose own
  default is `""` (none chosen) now comes back as saved, instead of being reported as a misfit that never happened.
  It's the rule a host write already follows. That covers every Storylet Engine declaration in the registry: `@world`
  and any other game scope, `@story`, and each box's, deck's, hand's and value's own properties. Any other enum still
  refits `""`. The engine's own loads don't refit, so a game on the Storylet Engine alone sees no change. The registry
  corpus checks it in every runtime. On `@wildwinter/scoperegistry` 0.9.1.

- **A host write must fit what the content declared.** `setProperty` refuses a string for a number, a value an enum
  or a quality doesn't list, a flag a flags property doesn't, and a `@world` name the content never declared, saying
  what the property takes. It's the rule a load already checks a save with. An enum whose own default is "" (none
  chosen) takes "" back, so a game can put its default back.
- **A broken bundle or save is refused by what's wrong with it.** `new Engine(null)`, a bundle missing its boxes, or
  a save with the wrong schema used to fail as a raw TypeError; each now says what it got and what's missing.

- **What a game is handed is its own.** A dealt card's fields, an outcome's, and a field's structured default are
  copies: a game that changed one used to change it in the bundle for every later deal, in every engine on that
  bundle. Extension values are the exception, as in Patter: they're the extension's own data, handed out uncopied and
  read-only by contract, because they can be large and a copy per deal would cost every game. The conformance
  corpus checks it in every runtime.

## [0.14.0] - 2026-10-21

### Removed

- **Storylet extension settings.** `extensionSettings(bundle, extension)` goes, with the bundle's `extensions[id].settings`: extensions no
  longer have settings, which only named the host field a claim presented, and claims are gone too. A bundle
  that still carries settings loads as before and they're ignored. An extension that wants a value on a card or
  an outcome declares a field of its own.

## [0.13.0] - 2026-10-18

### Added

- **Storylet extension values**: a bundle can carry the values a Storylet extension gives each node, and every
  runtime hands them over where it hands over fields: `extensions` on a dealt card, an outcome and a box from
  `listBoxes()`, by extension id, raw as the bundle wrote them (any JSON: records, maps and lists as well as
  the seven field types). `extensionDecls(bundle, extension, kind)` gives an extension's declarations for a
  node kind, every default resolved, so `effectiveFields(extensionDecls(...), card.extensions?.[id])` fills in
  what a node leaves out. `extensionsOf(bundle, kind, address)` reads the values of a node no view carries:
  the project, a deck, a hand, a hand template, a tag group or a tag. `extensionSettings(bundle, extension)`
  reads an extension's settings as the project resolved them (which host field each claim presents). The same
  on all four runtimes, with Blueprint taking structured values as JSON text. Bundles without extensions are
  unchanged.

## [0.12.0] - 2026-10-18

### Added

- **Field read helpers**: `fieldDecls(bundle, box)` and `outcomeFieldDecls(bundle, box)` find a
  box's declarations, `fieldValue(decls, values, name)` reads one field, and
  `effectiveFields(decls, values)` fills in every declared default a card or outcome leaves out.
  A card's `fields` stay exactly as the bundle wrote them. The same four on every runtime, as
  Patter's game-data helpers.
- **`compareStages`, `stageIndex` and `nextStage`**, the shared kernel's ladder helpers,
  re-exported: they order a quality field's stages (or a property's) outside a condition, from
  a ladder or the declaration carrying one.

### Changed

- **A saved value the build no longer takes is put back by the kernel's one check.** A stage or a
  flag deleted since the save (as an enum value already was) is reported as retyped and takes its
  default, by the shared kernel's value check, which Patterplay's loads use too.
- **Every declaration in a bundle carries its default**, which the compiler now writes in when the
  source leaves it out. The engine reads one through the kernel's `defaultFor` either way, so a
  bundle from an older compiler plays as it did.

## [0.11.2] - 2026-10-10

### Changed

- **No change in this runtime.** 0.11.2 is the Unreal plugin's fix for building on Unreal 5.8, released in lockstep, as every runtime version is.

## [0.11.1] - 2026-10-06

### Fixed

- **A closed flow lets go of its trace handlers**, as on the other three runtimes. It never emits again, so nothing changes here; in Godot and C++ a handler holding its own flow kept that flow alive for good.

## [0.11.0] - 2026-10-06

### Added

- **Durable state is a feature.** `engine.saveDurable()` returns the installation's memory (every shared `durable` property's value, and every shared durable one-shot that has been spent) and `flow.saveDurable()` one player's pocket (the same for the per-flow half), in one shape: `{ schema: "storylets/durable@1", content, values, spent }`, values keyed by property address and spends by card gameId. `engine.loadDurable(memory)` writes a memory into the next run's engine and `openFlow(id, { durable: pocket })` opens a flow with its pocket in. Both report what no longer fits the build (an address no longer declared durable on that side, a value its declaration no longer takes, a card that is gone) as a `LoadReport`, returned by `loadDurable` and handed to `onRestoreReport` by `openFlow`. `durable` and `restore` together are refused, as are another project's state and an unknown schema. `DURABLE_SCHEMA` and the `DurableSave` type are exported.
- **`engine.registry`**: the engine's scope registry, read-only, whether the game passed it in or the engine made its own.

### Changed

- **`markTaken`, `Flow.snapshot` and `Flow.restore` are internal** and no longer in the published types. Carry spends across a run with `saveDurable` and `loadDurable`, and resume a flow with `openFlow(id, { restore })`.
- **A flags value must hold strings.** A save or durable half whose flags value holds anything else (`[1]`, say) is reported as retyped and the property keeps its default, as on the other three runtimes, instead of landing in the bag.

## [0.10.0] - 2026-10-06

### Added

- **`StoryletError`** is exported, and every refusal the engine makes throws it, so a host can tell the engine's errors apart with `instanceof`. The messages are unchanged.
- **The load report is never thrown away.** `applyLiveBundle`'s success result carries the swap's `report`, and `loadState` and `deserializeState` take an optional `{ onReport }`.
- **`LiveLink.state`**: `"connecting"`, `"connected"` or `"closed"`, as on every other runtime.

### Changed

- **A peek consumes no random draws.** It ranks on a copy of the flow's generator, so looking at the stock, any number of times, no longer changes what the next deal gives.
- **A play is all-or-nothing.** Every change target is checked before any write lands, and a refusal only the landing can meet puts back what had already landed; a refused play changes nothing. Write events now fire after every write has landed. A bag property declared `writable: false` is refused as `'<name>' is read-only`.
- **A taken card is evicted.** A shared, never-redraw card that another playthrough has taken is evicted from this one's hand at its next deal, with the new evict reason `taken`.
- **A card whose deck now sits in another box is evicted as `vanished`** at the next deal, after a load, resume or hot swap that moved it.
- **Flow ids and hand ids that look like integers come first**, ascending, in a save's flows and registry section, in the order flows reopen after a load, and in `dealMany` and `board()` results: the order a JS object gives, so every runtime writes the same save bytes.
- **A priority that evaluates to NaN is not dealt**: it gets the verdict `priority`, as a priority that is not a number does.
- **A trace handler fires once each, from a snapshot.** Subscribing the same handler twice registers it once, and a handler added or removed during an event takes effect from the next one.
- A hot swap's wrong-project refusal reads `hotSwap: the bundle is for project "<new>", this engine runs "<old>"`.
- **Members marked internal are no longer in the published types**, so a host cannot reach, for example, the `Flow` constructor. `markTaken`, `Flow.snapshot` and `Flow.restore` stay, because the Storylet Server uses them.

### Fixed

- `@hand.constructor` and the like read as missing, not as a built-in function, so a condition that names one is unavailable rather than passing.
- The state logger reads one flow's save instead of cloning the whole game's on every capture, and a deal builds one evaluation context per deck when it evicts.

## [0.9.1] - 2026-10-02

### Changed

- **The bundle inspector counts hands on the map**, where it said "sites", in line with the editor.

## [0.9.0] - 2026-10-02

### Changed

- **Breaking: the project map** (2026-10-01). A project has at most one map, above the boxes:
  `bundle.map` is a `ProjectMap` whose `group` is the zone tag group (read by the engine) and whose
  `geometry` is the inert drawing (zones, pictures, and sites keyed by box gameId), present only when
  the build asked for it. `bundle.maps` is gone. A box that opts in has `usesMap: true`; it sees the
  map's group name beside its own groups, and its hands and cards reference the zones by id as with
  any group. Each zone is one value bag whichever boxes use it, addressed `value.<zone>.<name>`; a
  box-qualified address naming a zone is refused, naming the short form. Play history
  (`count_played_in`, `turns_since_played_in`) stays box-specific. `describeBundle` gains
  `usesMap` on each box and `map` (replacing `maps`), lists each zone's properties once with no box,
  and resolves a movable hole that names a zone. Bundle schema `storylets/bundle@1`; `@0` is still
  read.
- **The engine refuses an unreadable bundle at construction**: a schema other than
  `storylets/bundle@0` or `@1`, or a bundle that breaks the project map's rules (a box off the map
  referencing its group, a box on it with no map or with a group of the map's name, a zone sharing a
  box tag's name, a map group called `place`). One error starting `bundle refused: ` names every
  problem. Corpus version 10.
- **Upgrading a project**: run `storyletengine format` once. It folds per-box copies of a map into
  the project map and refuses copies that disagree, saying how.

### Fixed

- **A save no longer depends on the road taken to it** (2026-10-01). A standalone engine's
  `saveGame()` wrote its `registry` section in the order the keys were registered, and a flow
  replaced in place (`openFlow` on an open id, with or without `restore`) re-registered its keys
  last, while a load rebuilds them in `flows()` order. So the same run saved different bytes, and a
  save loaded and saved again was not equal to itself. The section is now written in that canonical
  order: the engine-wide keys, then each flow's in `flows()` order, then anything still waiting. A
  save written in the old order loads exactly as before. Corpus version 11.

## [0.8.2] - 2026-09-27

### Changed

- **From npm, the runtime shares your game's registry.** It used to carry its own copy of
  `@wildwinter/scoperegistry` inside it, built for the release zip and published to npm as well, so a
  game installing from npm ran a registry fixed at the version this runtime was built with. The npm
  package now takes `@wildwinter/scoperegistry` as a peer dependency: one copy in your install, for
  your game and every engine in it. npm installs it for you; with a package manager that doesn't
  install peer dependencies, add it yourself. The zip keeps a build with everything inside it, so
  copying its folders into a project still needs nothing else.

## [0.8.1] - 2026-09-27

### Fixed

- **One copy of `@wildwinter/scoperegistry` in a game that also runs Patter.** 0.8.0 asked for
  `^0.7.0`, while Patter's packages ask for 0.8, so a game running both engines held two copies, and a
  `ScopeRegistry` the game made was not the one this runtime used. The runtime and the play helpers
  now accept any version from 0.7.0 up to 1.0, so they share whichever copy the rest of the install
  has, and a later registry release cannot split it again. The runtime's behaviour is unchanged.

## [0.8.0] - 2026-09-24

### Added

- **Other engines' scopes, with no setting.** A card can name another engine's game-wide scope from the family's shared list (`@patter.visits` in a condition, `@patter.gold` in an outcome's changes). The compiler lets it through unchecked and records it in the bundle (`externalScopes`); an outcome writes it through the game's registry under that engine's rules; a name that does not exist fails when the card is first evaluated. Content that names one runs only where that engine is on the same registry: without it, `openFlow` and `loadGame` refuse before anything changes (`this content names @patter, which no engine on this registry registered: give every engine the game's one registry`).
- **`Engine.hotSwap(bundle, opts?)`**, live bundle refresh as an engine method, returning the replacement and its load report. On the game's registry the old engine hands its keys over: it carries its own values into the snapshot, so the report covers property drift and a dropped property is dropped, and nothing belonging to another engine is touched; a failed rebuild puts everything back. `@storylet-studio/play-helpers`' `applyLiveBundle` now calls it, so a Live Link refresh works when the game owns the registry, where it used to be refused.

### Changed

- **One registry per game.** Every property bag now lives in a `ScopeRegistry` (`@wildwinter/scoperegistry` 0.7.0) instead of standing alone: the shared `@story` under `story`, and every other bag that declares something under a key starting `storylets/` (`storylets/deck/<id>`, `storylets/flow/<flow>/story`, and so on, keyed by internal id). A new `registry` option takes the game's own registry, shared with any other engine in the game, Patter included; without one the engine makes its own and acts as its own game, so a single-engine game needs no change.
- **The save is `storylets/save@2`.** The envelope holds what is not a property (boards, clocks, cooldowns, PRNGs, play logs, spent cards). An engine built without a registry also carries that registry's values under `registry`, so one call is still the whole run, and the load report still walks them; an engine given the game's registry leaves them to the game, which saves the registry once. `storylets/save@1` envelopes still load, their values moving into the registry. `saveFlow` still carries the parked flow's properties.
- **A self-backed `@world` is saved.** When the game binds no resolver, `@world` is a property the engine's registry stores, so a save and load keeps it where it used to fall back to its defaults. A resolver the game binds is still external and never saved. Given the game's registry, the engine self-backs nothing: `@world` is the game's to register there.
- **Every expression reads every registered scope**, and `getProperty` / `setProperty` take another engine's game-wide path (`patter.gold`). A token two engines both want fails as the second is built, naming the first.
- `@storylet-studio/play-helpers`, which ships at this version: `loadState` and `deserializeState` accept a `.storyletsave` whose envelope is either version.

## [0.7.0] - 2026-09-14

### Added

- **A card with no outcomes is played with none** (2026-09-14; the no-outcome-play brief). A masthead, a notice, a codex entry: a card whose play means "shown". `play(card, "", hand)` does everything a play does except the writes: the play log and the history functions (`count_played`, `turns_since_played` and the `_in` pair) count it, the played card's box turn advances by the usual rule (nothing for a timed box, and an explicit `advanceTurns` still wins), its redraw rests it, and it leaves its hand. The `play` trace event and the play record carry `outcome: ""`, so a save's shape does not depend on the card. `""` is the one spelling in all four runtimes, because a Blueprint pin cannot be absent. Only the empty-for-empty case is new: `""` on a card that has outcomes is refused (`card "x" has outcomes (a, b); name the one played`), and a named outcome on a card with none is refused as before. `outcomes()` still answers an empty list for such a card. Corpus first: three cases, the scripted `play` op's `outcome` is optional and a play with none traces as `play <card>`, corpus version 9.

## [0.6.0] - 2026-09-13

### Added

- **Outcome fields** (2026-09-13; design/outcome-fields-brief.md). A box may declare `outcomeFields` beside its card template, and an outcome fills them in `fields` exactly as a card fills the card template: the one line a press shows ("The notice is in your pocket") without spending a card on it. `OutcomeView.fields` hands them to the host with the outcome, as the bundle wrote them, and the engine never reads them; a stripped bundle keeps them, since they are game data and not author metadata. The compiler holds them to the card template's rule, so an unknown or mistyped field fails at publish and names the outcome. A bundle from a project that declares none is byte for byte what it was. Corpus first: one case and a new `assertOutcomeFields` op, corpus version 8.

## [0.5.0] - 2026-09-06

### Added

- **A box that counts in time: `turn: { seconds: N }`** (2026-09-05; design/engine-server.md 4.8). A box may declare that its turns are TIME rather than plays. One branch in `play` is the whole of it in the engine: in a timed box the default advance is 0 instead of `settings.playAdvancesTurns`, so a designer cannot declare the convention and then forget to switch play-advance off; a call that names `advanceTurns` still gets what it asked for. The host ticks the box as it always could - the runtime has no clock and gains none - and `redraw: N` on its cards reads as N x `seconds`, which is what every surface now SAYS rather than anything the engine does differently. `describeBundle` reports the unit on `BoxSummary` and the four bundle inspectors show `turn = 60s`, so an integrator reading a bundle knows which boxes their host must tick. The compiler refuses a `seconds` that is not a positive integer, and warns about a timed box whose every card says `redraw: "always"`, since nothing in it then rests. Corpus first: six cases, corpus version 5.

- **A hole filled from a property: the hand that moves** (2026-09-05; design/engine-server.md 4.6). A hand's `chosen` value (or a standalone hand's rule binding) may be a property reference (`"@hand.zone"`, `"@story.where"`, `"@world.place"`) rather than a tag. The engine resolves it at ask time and binds the hole to the tag the value names, so moving the Elder to the forest is `setProperty("hand.the-elder.zone", "forest")` and the next deal follows: forest-tagged cards become available at his hand, village-tagged ones are evicted with reason `tags` by the eviction pass that already existed. No new verb, no new save shape, no new trace kind. The semantics are `boundBy`'s word for word, applied per hole: an explicit tag beats nothing (the reference IS the fill), and a value naming no tag leaves the hole UNBOUND, which is a wildcard, with a `diagnostic` rather than a silently empty hand. `@hand` is the added scope, read from the flow's merged view before tag composition, so a `shared: true` declaration moves the hole for every flow and a per-flow one moves it for that flow alone, and a movable hole can never depend on the tags it is choosing.

- **`describeBundle` reports a hand's movable holes**, as `movable: [{ group, from }]` on `HandSummary`, absent when there are none. It is the one thing about a hand its name cannot say, so an integrator reading the asset alone can see which hands move and which property moves them; the four bundle inspectors show it on the hand's own line.

- **`saveFlow(id)` and `openFlow(id, { restore })`: park one flow, and open it as it was** (2026-09-05; design/engine-server.md 4.1). `Flow.snapshot` / `Flow.restore` have always existed as internals; this is the public pair, and it is an option on `openFlow` rather than a `restore` verb because restoring INTO a running flow is the trap that replace semantics set. Closing a parked flow releases its shared claims, so a card it was holding can be dealt elsewhere while it is away; on the way back, a shared card the world has since given out is dropped with an `evict` of reason `claimed-elsewhere` rather than double-claimed. `onRestoreReport` hands out what the restore did.

- **`previewLoad(envelope)`, `previewFlowRestore(id, save)`, and a `LoadReport` returned by `loadGame`** (2026-09-05; design/engine-server.md 4.9). A load is forgiving about content that moved underneath a save - which is what lets a save survive an edit, and also what hid the cost of one. The report itemises it: cards evicted (and why), cooldowns and spent entries for cards the build no longer has, properties dropped, defaulted or retyped, and `version` / `hash` drift, which used to load in silence. The previews are pure; a project mismatch is still the one refusal. One walk computes the report and the cleaned state the load applies, so the two can never disagree.

### Changed

- **A tag two boxes both name is addressed by its box: `value.<boxGameId>/<tagGameId>.<name>`** (2026-09-06; design/engine-server.md 4.4). The one hole the change above left. Box, deck, hand and card gameIds are unique across a bundle, so their owner segment names exactly one thing; a TAG's is unique only within its group, and a group's only within its box, so a harbour box and a cellar box may each have a `docks`, and `value.docks.danger` then named two stores. It resolved to the first in bundle order, silently, which is the bug this removes. The qualified form carries the box, with the slash INSIDE the owner segment so an address still splits into three on the dot and no parser changes shape, and it is accepted whether or not it is needed - a tool that always writes it is not made wrong by an author deleting the second box. The short form resolves while exactly one tag in the bundle carries that gameId and is REFUSED when more do, through the channel an unknown owner segment already uses, naming every candidate: `"value.docks.danger" names a tag in 2 boxes; write "value.harbour/docks.danger" or "value.cellar/docks.danger"`. What the engine PRINTS - `listProperties()`, a `write` event's `path`, a `LoadReport`'s paths, `listBags`'s prefixes, the state logger, the examiners, the Board's state strip - is qualified ONLY for a repeated gameId, so a project whose tag names happen to be unique sees no change at all. The value scope's internal-id form is therefore on the same timetable as the other three now rather than exempt from it, refused after the next lockstep release, and its diagnostic names the qualified address wherever that is the one that works. `valueAddresses` in `@storylet-studio/model` is the single definition of the rule, so the Board (which reads the bundle) and the engine (which reads its own index) cannot print different addresses for one tag, and the compiler refuses a `/` anywhere in an address, since one inside a name would split an owner segment in two. Corpus first: four cases, a `write <target> <path>` line for `expectTrace` and an `expectRefused` on `setState`, corpus version 7.

- **Identity by gameId: trace events and property addresses** (2026-09-06; design/engine-server.md 4.4). One vocabulary, in two places that used to have two. On the TRACE, `evict.hand`, `evict.card`, `play.card` and every `cards[].id` on a `deal` or a `peek` are gameIds, joining `deal.hand` and `peek.box`, which always were: a refresh used to report the hand it filled by name and the cards it dropped by internal id, in the same breath, so every consumer outside the engine (the Board, the four examiners, the Live Link, a wire a kiosk reads) kept a translation table of its own. A card the build no longer has is the one exception, named by the id the board carried, because there is no gameId left to give it. On an ADDRESS, `listProperties()` prints `box.<boxGameId>.heat`, `deck.<deckGameId>.x`, `hand.<handGameId>.x` and `value.<tagGameId>.x`, and `getProperty`, `setProperty`, `Engine.getProperty`, the `@hand` composition's write-back, the `write` trace event's `path`, the coverage harness, the CLI's `--set` and a `LoadReport`'s paths all speak that form: the documented `setProperty("hand.the-elder.zone", "forest")` used to answer `no hand store "the-elder"`, and two content authors hit it in a day. **The internal-id form is still accepted on input for this release**, resolving as before and raising a `diagnostic` naming the address to move to, so a host can find its old ones by running once with the trace on; it is refused after the next lockstep release. Saves are untouched: a `FlowSave` keys by internal id and stays so, because a save has to survive a rename, and the report's `path` is the only thing about a load that moved. Corpus first: every `expectVerdicts` and `assertState` path rewritten by hand, four new cases and two new assertions (`expectTrace` on a deal or a play, `expectDiagnostic` on a `setState`), corpus version 6. One scope needed a second pass: a tag's gameId is unique only within its group, and a group's only within its box, so two boxes may each name a tag "docks", and `value.docks` named the first in bundle order. The entry below settles that and puts the value scope back on the same timetable as the other three.

- **Read-only `@world` properties honour the game's own writes** (2026-09-05). `writable: false` on a `@world` declaration is the STORY's promise not to write that value, so it binds an outcome and nobody else: `Engine.setProperty` and `Flow.setProperty`, the coverage harness's drivers and the CLI's `deal --set` / `peek --set` now say so with the shared kernel's `{ host: true }` (`@wildwinter/scoperegistry` 0.6.0, in every scope, not just `@world`) and are never refused. An outcome still is, against the engine's own read-only table, which is asked before the write reaches a bag or a bound resolver. A coverage run whose driver moves a read-only clock finishes now instead of dying on the first sweep. The examiner keeps saying what the declaration says: a `world.*` row reports `writable: false` whether or not the game has just written it, which is what a state panel wants the flag for.

- **A load now prunes what it reports.** A property the build no longer declares used to stay in the bag as a stray value and ride the next save; a cooldown or spent entry for a deleted card did the same; a saved value that no longer fits its declaration (a struck-out enum value, an edited quality ladder) used to load anyway. All three are dropped now, and named in the report.

## [0.4.1] - 2026-09-04

### Changed

- **Lockstep with the Godot addon's 0.4.1**, which could not open a project. No change of its own: one version number means one runtime behaviour across all four.

## [0.4.0] - 2026-09-04

### Changed

- **`@storylet-studio/play-helpers` is on npm** from this release, at the runtime's version and bumped with it (the JS member of the lockstep is two packages), so the drop-in is one CDN line away: `https://unpkg.com/@storylet-studio/play-helpers/dist/storyletengine.min.js`. The zip is unchanged.
- **`storyletengine.min.js` carries the helpers.** The browser drop-in now defines the runtime AND `@storylet-studio/play-helpers` on the `StoryletEngine` global, so a plain page saves and loads the family's `.storyletsave` text from two script tags with no build step; it used to carry the runtime alone. Built by the helpers package now, the one that depends on both; the release zip still ships it at its root.

### Added

- **A read-only `@world` property is refused at runtime too.** `play()` of an outcome that writes a property declared `writable: false` throws `'@world.x' is read-only` and changes nothing; the host's own `setProperty` is not bound. The compiler already refused it; the runtime now keeps the promise for hand-built bundles, and so that an integrator running Patter beside this sees one behaviour, since Patter's runtime refuses the same write through the shared kernel. Corpus case first, in all four runtimes.

- **`onReplacedFlow`**, an opt-in diagnostics hook on `EngineOptions`, fired when
  `openFlow` replaces a flow that still had cards dealt, with the flow id and the
  count. Behaviour is unchanged: replacing is deliberate, and the same in Patter.
  What it makes observable is a host calling `openFlow` straight after `loadGame`
  to "re-take" its handle, which silently discards the hand the save restored and
  surfaces later as `play()` refusing a card as not dealt. `getFlow` is the call,
  and `deserializeState`'s doc and the JavaScript page now say so in as many
  words. Found building the joint Storylets + Patter demo, where the sample was
  written with the Village client open and fell into the trap that file names.
  Zero cost when unset; leave it unset in shipped games.

## [0.3.0] - 2026-09-02

### Changed

- **BREAKING: `PropertyView` is gone; `listProperties()` returns `PropertyRow`.** It was the
  shared row plus a `path`, and `path` is on the shared row now, so the name was a second name
  for one type - and Patterplay had forked the same row, for the same reason, in its own
  runtimes. `PropertyRow` is re-exported from `@storylet-studio/runtime`, so naming a row needs
  no dependency on `@wildwinter/scoperegistry`.
- **Requires `@wildwinter/scoperegistry` ^0.4.0**, which is where the row's `path` lives.
- **A property bag composes its rows' addresses.** Each bag is built knowing the path it answers
  to (`story.`, `box.<id>.`, `deck.<id>.`, `hand.<id>.`, `value.<id>.`, `world.`), so a row
  arrives addressed instead of having a prefix pasted onto it by each caller. **The addresses are
  unchanged** - this is where they are composed, not what they are.

### Fixed

- **A quality row carries its ladder.** `stages` was on the examiner row so an editor could
  offer the stages instead of a free-text box, and the shared code that builds rows never filled
  it in - on this runtime and two others. Every quality row came out without one.

- **`@world` rows report `writable`.** They are built by hand rather than by a bag (a host
  resolver backs them) and were pushed through a cast that hid the missing field, which the row
  type has always required. They now say whether the resolver can be written at all - the shared
  registry's own rule for a foreign scope.

## [0.2.0] - 2026-09-01

### Changed

- **BREAKING: a bare non-boolean condition now passes when it is non-empty.** A
  condition resolving to a string or a flag list previously always failed; it now
  passes when the string is non-empty or the list has members. Booleans and
  numbers are unaffected. This aligns with Patterplay, which the two engines
  sharing a property registry makes necessary: the same value read from the same
  registry answered a condition differently depending on which engine asked.

- **Flags compare as a SET.** `==` and `!=` on a flags value now ignore order,
  as multisets so a duplicate still counts. `set_flags` still sorts its result,
  now purely so a save is byte-reproducible rather than to make equality work.

- The PRNG is now re-exported from `@wildwinter/expr` rather than implemented
  here. Same algorithm, same draws, same `makePrng` and `shuffleInPlace` on this
  package's surface. `toUint32` is deliberately NOT re-exported: it is the seed
  coercion a port has to reproduce, not something a game author calls.


## [0.1.0] - 2026-08-30

The first public release, shipping alongside the Unity, Unreal and Godot runtimes on the same
version. All four play the same `.storyletsc` bundle with the same behaviour, held to the
shared conformance corpus.

### Added

- **The engine**: load a compiled bundle, hold the shared state (`@world` and `@story`), open
  and close flows, save and load a game, subscribe to the trace and read the run log.
- **The flow**: one playthrough. `peek` the stock, `deal` a hand, read the ranked result with
  the trace that says why each card is there, list `outcomes`, `play` one, and advance turns.
- **Qualities, scarcity and cooldowns**, as the corpus pins them: ordered stage ladders,
  `shared` decks and cards claimed across flows, and per-flow redraw clocks.
- **`describeBundle`**, which reports what a bundle offers without playing it.
- **The seeded PRNG** (`makePrng`, `shuffleInPlace`): mulberry32, the algorithm every runtime
  implements identically, so the same seed deals the same hand in all four.

### The download

The release zip carries `@storylet-studio/runtime` and `@storylet-studio/play-helpers` as
folders you copy into a project, plus **`storyletengine.min.js`**, a single self-contained
browser drop-in exposing `window.StoryletEngine` for a plain HTML page with no build step.

Both packages ship with their dependencies **inlined**, deliberately: nothing here is on npm,
so the zip has to stand on its own. The one exception is that `play-helpers` still imports
`@storylet-studio/runtime` from its sibling folder, because it wraps a live engine and a
private copy would leave the host with two of them.
