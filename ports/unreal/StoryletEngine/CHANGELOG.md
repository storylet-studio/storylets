# Changelog

## [Unreleased]

### Added

- **A registry option: one `ScopeRegistry` per game** (patterkit design/one-registry-handover.md, 2026-09-24). `EngineOptions::registry` takes the game's registry as a `std::shared_ptr<storylets::ScopeRegistry>`, shared with any other engine the game runs; `UStoryletEngine::CreateWithRegistry(Bundle, Registry, Seed, bRetainLog, World)` is the same for the UE wrapper, C++ only, because a std object shared by pointer crosses no Blueprint pin. Without one, the engine makes its own registry and acts as its own game, so a single-engine game needs no change. `Engine::registry()`, `Engine::ownsRegistry()` and `UStoryletEngine::GetRegistry()` say which registry an engine is using, and `saveRegistry(registry)` / `loadRegistry(registry, json)` in `Storylets/Save.h` are the registry's text door, for the game's half of a combined save.
- **Other engines' scopes, with no setting.** A card can name another engine's game-wide scope from the family's shared list (`@patter.visits` in a condition, `@patter.gold` in an outcome's changes). The compiler lets it through unchecked and records the tokens a bundle names in `externalScopes`, which the bundle reader now reads (`Bundle::externalScopes`). An outcome change targeting another registered scope writes it through the game's registry, as a story write under that engine's rules (a property it declares read-only is refused with a `StoryletError`), and shows on the trace as a `Write` to `patter.gold`; Content that names a scope no engine on the registry registered cannot run, so `openFlow` (and a load's rebuild) and `loadGame` refuse it before anything changes, checking the bundle's `externalScopes` in order and throwing a `StoryletError` on the first missing one: `this content names @patter, which no engine on this registry registered: give every engine the game's one registry` (the same message on every runtime). `loadGame` checks right after the project check, so a refused load leaves every flow as it was. The UE wrapper reports it the way it reports any refused open or load: `OpenFlow` returns null and `UStoryletSave::LoadStateFromJson` returns false, each logging the message as an error. A write can still meet an unregistered scope when another engine takes its scope away mid-game, and fails naming it (`@patter.gold cannot be written: no engine on this registry registered @patter`); a token the bundle does not list is still a bad change target.
- **`Engine::hotSwap(bundle, change)`**, live bundle refresh on the core, returning the replacement and its load report (`Engine::HotSwapResult`). The replacement is built from a copy of the options this engine was built with (seed, log, `world`, `onReplacedFlow`), which the optional `change` callback (`std::function<void(EngineOptions&)>`) edits first, so only what it changes differs, as the JS `hotSwap(bundle, opts)` merges `opts` over them: `engine.hotSwap(bundle, [](storylets::EngineOptions& o) { o.log = true; })` keeps the seed and the `@world` binding. It always lands on this engine's registry (a `registry` the callback sets is ignored). Standalone it is a save and a load into a new engine, and this one is left untouched. On the game's registry this engine carries its own values (`story` and every `storylets/` key, registered or waiting) into the snapshot, steps out of the registry, and the replacement loads them the way a standalone save loads, so the report covers the properties the edit dropped, defaulted, or retyped, and a dropped property is really dropped rather than left in the registry. Values the game loaded that were still waiting for a flow of this engine carry across as they were, nothing belonging to another engine is touched, and this engine is spent afterwards (its flows closed; destroying it removes nothing of the replacement's). A save for another project is refused before anything moves; a rebuild that fails for any other reason puts this engine and the registry back exactly as they were.

### Changed

- **Every property bag lives in the registry.** The shared `@story` registers under `story`, and every other bag that declares something under a key starting `storylets/`: `storylets/<kind>/<id>` for a shared box, deck, hand, or value bag, and `storylets/flow/<flow>/story` or `storylets/flow/<flow>/<kind>/<id>` for a flow's own, keyed by internal id with `%` and `/` escaped. A bag that declares nothing is not registered. Everything carries the owner label `Storylet Engine`. The five tokens a card reads stay the flow's merged views over its bags; every other scope in the registry reaches the evaluation context too, quality ladders included, and `getProperty` / `setProperty` on the engine and on a flow take another engine's game-wide path (`patter.gold`). A token another engine already holds is refused as the engine is built, naming the holder, and the registry is left as it was.
- **The save is `storylets/save@2`.** The envelope holds what is not a property: boards, clocks, cooldowns, PRNGs, play logs, and spent cards. An engine on its own registry also carries that registry's values under `registry`, so one call is still the whole run, and the load report still walks them. An engine on the game's registry leaves them to the game, which saves the registry once, beside the envelope, and loads it before or after the engine: each flow's bags wait in the registry for the flow that claims them. `storylets/save@1` envelopes still load, on the core, through `loadState` / `deserializeState`, and through `UStoryletSave`, their values moving into the registry, into the game's without disturbing what it already loaded. `saveFlow` still carries the parked flow's properties. `FlowSave::props` and `SharedSave::props` are `std::optional` now, and `SaveEnvelope` has an optional `registry`.
- **A self-backed `@world` is saved.** With no resolver bound, `@world` is a property the engine's own registry stores, so a save and load keeps it where it used to fall back to its defaults. A bound `UStoryletWorld` (or `WorldResolver`) is still the game's, registered as a foreign scope and never saved by the engine. On the game's registry and with no world bound, the engine registers nothing for `@world`: it is the game's to register.
- **`reset()` reseeds in place.** The shared bags keep their identity, so the registry never sees them come and go; each flow's bags leave the registry as the flow closes; and values loaded for this engine's bags and not yet claimed are dropped, where another engine's stay. A fresh `openFlow` drops any values waiting for that flow's name, while a load's flows claim them.
- **An engine that goes away takes its bags with it**: the destructor closes every flow and removes what the engine registered, so a game can build a new engine on the same registry.
- **`ApplyLiveBundle` is the core's `hotSwap`**, so it works on the game's registry as on the engine's own: the new core carries the run across, a property the edit dropped leaves the registry, a new one takes its default, another engine's values are never touched, and a refused or failed swap leaves the engine and the registry as they were.
- **`ScopeRegistry` is the shared one, vendored from expr, and brought up to `@wildwinter/scoperegistry` 0.7** (2026-09-24). The hand-ported `Storylets/ScopeRegistry.h` is gone; include `Storylets/Expr/ScopeRegistry.h`, which Patterplay vendors too and which the registry corpus (`packages/conformance/registry-corpus.json`) now pins on this port, run by the TestHost. The calls it already had keep their forms and their behaviour, `defineForeign(token, resolver, &decls, scopeWritable)` and `set(scope, name, value, host)` included. What is new: `mountOwned` and `defineOwned` take an owner label, and `defineOwned` takes `OwnedScopeOptions` (a path prefix, which defaults to `<token>.`, a name normalisation, and an owner) or a path prefix alone; `defineForeign` takes `ForeignScopeOptions` (writable, normalise, and owner), and a foreign scope's normalisation now applies to its declarations, reads, writes, and ladders, where the old port always lower-cased; `remove(token, keep)` unregisters a scope, parking an owned scope's values for the next registration of the key when `keep` is set; `load(blob, keepParked)` parks the sections for keys nobody has registered yet, hands them over on registration, and keeps them in the next `save()`, where the old port dropped them; `discardParked(prefix)` drops what nobody claimed; `revision()` moves on each registration and removal; `toEvalContext(host, aliases)` points an expression token at a registered key for one context, ladders included; a clash names the owner that got there first; and `listProperties()` rows carry `owner`, `path`, and `stages`, which the old port's rows left out. The spec reader is a template over the JSON node, so it reads a `JsonValue` as before and reads `stages` now too.

- **One kernel type, shared with Patterplay** (2026-09-24). The expression and state kernel vendored as `Storylets/Expr/` (the evaluator, the AST, `OrderedMap`, `PropertyBag`, the state logger core, `ScopeRegistry`) is now `wildwinter::expr`, byte-identical to Patterplay's copy, and a game module that includes both plugins compiles it once. So a C++ game running both makes ONE registry and hands the same `std::shared_ptr` to `UStoryletEngine::CreateWithRegistry` and to `UPatterEngine::CreateWithRegistry`; until now the two plugins' registries were two types. Game code does not change: `storylets::StoryletValue`, `storylets::StoryletKind`, `storylets::ScopeRegistry`, `storylets::PropertyBag` and every other kernel name still resolve, as aliases of the kernel's (`ExprValue`, `ExprKind`, and the rest), declared in `Storylets/StoryletValue.h` and `Storylets/Kernel.h`. **Both plugins must carry the same kernel**: their headers are compiled into your game module, and a game module that includes both built from different kernels stops at a compile error saying so, so update the older plugin; the two products release a kernel change together. **Errors**: the kernel throws its own `wildwinter::expr::ExprError` and `RegistryError`; the engine catches them where it calls the kernel and rethrows its own, as it threw before (an `ExprError` as `storylets::EvalError`, a `RegistryError` as `storylets::StoryletError`, same message), so a `catch (const storylets::StoryletError&)` still catches everything the engine raises and no kernel exception leaves the plugin. A game calling the registry itself sees `RegistryError`. A module that makes a registry includes `Storylets/Kernel.h` and sets `bEnableExceptions = true` in its Build.cs, as the kernel throws; one that only passes a registry along through `StoryletEngine.h` does not. A game that forward-declared `storylets::ScopeRegistry` itself now includes `Storylets/StoryletValue.h` instead, since it is an alias.

### Removed

- **The owned-state fragment** (`saveFragment`, `loadFragment`, `OwnedStateFragment`, `SAVE_FRAGMENT_VERSION`), deprecated in the TypeScript package and not ported: versioning belongs to the save that embeds `save()`. Nothing in this plugin called it. `qualityLadders()` is private now; `toEvalContext` is how a host gets the ladders.

### Fixed

- **`UStoryletEngine::GetFlow` answers with every flow a load restored.** It looked only among the wrappers `OpenFlow` had handed out, so after `UStoryletSave::LoadStateFromJson` into an engine that never opened the flow (a fresh engine, the usual way to load a game) it answered null, and `Flows()` left the flow out. The example on the Unreal page did exactly that. It now wraps a restored flow the first time it is asked for, as the JS `getFlow` answers. With it, a wrapper whose flow was replaced or closed stays closed: a load re-bound every wrapper by name and brought the old one back to life on the restored flow, where `GetFlow` could then hand it out instead of the live one.
- **`writable: false` on a `@story` (or other owned) property is enforced.** `storylets::PropertyDecl` declared its own `writable`, which hid the kernel's `ScopeDeclaration::writable`: the bundle reader filled the copy and the property bag read the other, so a story write to a read-only property went through. The story's write is now refused with a `StoryletError` (`'gold' is read-only`), as in JS and C#, and the game's own `SetProperty` still lands, since the flag is the story's promise, not a lock on the game. `@world` was not affected: the engine checks its declarations itself.

## [0.7.0] - 2026-09-14

### Added

- **A card with no outcomes is played with none** (2026-09-14). A masthead, a notice, a codex entry: a card whose play means "shown" has nothing to choose between, and until now it could not be played at all. `Flow::play(cardId, "", from)` on a card whose `outcomes` is empty now does everything a play does except the writes: it appends a `PlayRecord` whose `outcome` is "", so the play log and the history functions count it, advances the box's turn by the usual rule (nothing in a timed box, `settings.playAdvancesTurns` otherwise, an explicit `PlayOptions::advanceTurns` still honoured), applies the redraw policy (a cooldown, `never` spent, a shared one-shot marked taken), evicts the card from its hand, and emits the `Play` trace event with an empty `outcome`. There is no gate to check and nothing is written. "" is the spelling because it is the one every runtime can express, a Blueprint pin included: `UStoryletFlow::Play` and `PlayAdvancing` take an empty `OutcomeGameId` for it, and the log line reads `play <card>`. Two refusals, both before anything mutates: "" on a card that HAS outcomes (`card "<gameId>" has outcomes (<o1>, <o2>); name the one played`), and a named outcome on a card with none, refused as it always was. The Board demo draws one plain **Done** button where an open card's outcome buttons would be when it has none, and the Hamlet demo plays a scene whose card declares no outcome with "". Parity with the JS runtime, corpus-pinned (corpus version 9).

## [0.6.0] - 2026-09-13

### Added

- **An outcome carries fields, declared by its box** (2026-09-13). A box already declares the card template every card in it fills in; it may now declare an outcome template beside it, `outcomeFields`, and an outcome may fill that in with `fields`. The engine never reads either: `Outcome::fields` is parsed as a card's fields are, `Box::outcomeFields` as the card template is, and `OutcomeView::fields` hands the values to the game with the outcome exactly as the bundle wrote them, the way a title is handed over. Blueprint reads them as `FStoryletOutcomeView::Fields`, the same `FStoryletFieldEntry` rows `FStoryletDealtCard::Fields` already carries. A box that declares no outcome template, and an outcome that fills nothing in, read as empty, so a bundle written before this is unchanged. Parity with the JS runtime, corpus-pinned (corpus version 8). What it is for: the line a phone shows the moment a press lands, without spending a card on it.

## [0.5.0] - 2026-09-06

### Added

- **Hand positions carried in a bundle's `maps` block** (2026-09-05). `BundleMap::sites` is a list of `MapSite` (a hand gameId and a point), parsed and handed over like the zones and the pictures beside it, and reported as `MapSummary::sites` (design/engine-server.md 4.3). Still INERT PAYLOAD: nothing in the engine reads any of it. The asset Inspector gains the **Maps (carried, not read)** section the other three inspectors already had, counting zones, pictures and sites, and `FStoryletBundleDescription` gains `Maps` so Blueprint can read the same. No corpus change: a position is not a behaviour.

- **`durable` carried on declarations, decks and cards** (2026-09-05). The durability axis (design/engine-server.md 4.2): `durable` says whether a value, or a `redraw: "never"` spend, survives the end of a RUN, where `shared` says whose it is within one. INERT in the engine, which partitions by `shared` alone and never reads the flag; a server lifts and restores durable values across a run boundary through `GetProperty` / `SetProperty`, and durable spends through `OpenFlow(Id, Restore)` and `MarkTaken`. The bundle parser carries it, `DescribeBundle` marks a durable declaration on `FStoryletPropertySummary::bDurable` and counts a box's durable cards on `FStoryletBoxSummary::DurableCards`, and the asset Details panel shows "(durable)" on the property row and "durable cards N" on the box's counts line. No corpus change: nothing about play is different.

- **A box that counts in time: `turn: { seconds: N }`** (2026-09-05). A box may declare that its turns are TIME rather than plays, and `Box::turnSeconds` carries the unit. In such a box `play` advances the clock by 0 by default instead of `settings.playAdvancesTurns`; a call that sets `PlayOptions::advanceTurns` still gets what it asked for, and `advanceTurns` is unchanged, because the host is what ticks a timed box. `redraw: N` on its cards then reads as N x `seconds`, which the tools say and the engine does not act on. `DescribeBundle` reports it as `BoxSummary::turnSeconds`, Blueprint reads it as `FStoryletBoxSummary::TurnSeconds` (0 on an untimed box), and the bundle's Details view shows `turn = 60s` on the box's counts line. Parity with the JS runtime, corpus-pinned (corpus version 5).

- **A hole filled from a property: the hand that moves** (2026-09-05). A hand's `chosen` value (or a standalone hand's rule binding) may be a property reference (`"@hand.zone"`, `"@story.where"`, `"@world.place"`) rather than a tag id; the engine resolves it at ask time and binds the hole to the tag it names, so moving a hand is `SetProperty` and the next deal follows. Parity with the JS runtime, corpus-pinned. A value naming no tag leaves the hole unbound (a wildcard) with a diagnostic, never a silently empty hand. `describeBundle` reports the holes as `HandSummary::movable`, surfaced to Blueprint as `FStoryletHandSummary::Movable` and shown on the hand's own line in the bundle details panel. No new verb, so no new Blueprint node.

- **`saveFlow(id)` and `openFlow(id, { .restore })` on the C++ core, `SaveFlowToJson` / `OpenFlowFromJson` / `PreviewFlowRestoreJson` on `UStoryletEngine`** (2026-09-05): park one flow and open it as it was. Parity with the JS runtime's `saveFlow` / `openFlow(restore)`, corpus-pinned. Closing a parked flow releases its shared claims; on the way back, a shared card the world has since given out is dropped as `claimed-elsewhere` rather than double-claimed. Blueprint takes the blob as JSON, as `UStoryletSave` does the envelope: no `FlowSave` struct crosses a pin.

- **`previewLoad(envelope)` and a `LoadReport` returned by `loadGame` on the core; `UStoryletSave::PreviewLoadFromJson` for Blueprint.** What a save load would drop, default or reset, and whether its build is this one - answered before the load as well as by it. The report crosses a pin as JSON (`storylets::reportToJson`, in the pure core, so the clang TestHost exercises it).

### Changed

- **A tag two boxes both name is addressed by its box: `value.<boxGameId>/<tagGameId>.<name>`** (2026-09-06; design/engine-server.md 4.4). The one hole the change above left. Box, deck, hand and card gameIds are unique across a bundle, so their owner segment names exactly one thing; a TAG's is unique only within its group, and a group's only within its box, so a harbour box and a cellar box may each have a `docks`, and `value.docks.danger` then named two stores. It resolved to the first in bundle order, silently, which is the bug this removes. The qualified form carries the box, with the slash INSIDE the owner segment so an address still splits into three on the dot, and it is accepted whether or not it is needed. The short form resolves while exactly one tag in the bundle carries that gameId and is REFUSED when more do, through the channel an unknown owner segment already uses, naming every candidate: `"value.docks.danger" names a tag in 2 boxes; write "value.harbour/docks.danger" or "value.cellar/docks.danger"`. What the engine PRINTS - `listProperties()`, a `BagMount`'s label, the `write` event's `path`, the state logger's snapshot and a `LoadReport`'s paths - is qualified ONLY for a repeated gameId, so a project whose tag names happen to be unique sees no change at all. The value scope's internal-id form is therefore on the same timetable as the other three now rather than exempt from it, refused after the next lockstep release, and its diagnostic names the qualified address wherever that is the one that works. Parity with the JS runtime, corpus-pinned (corpus version 7).

- **Identity on the trace, and a property address, take the owner's gameId** (2026-09-06). Design change 4.4 (design/engine-server.md). Every id a trace event carries is now the gameId the rest of the API already spoke: `TraceEvent::hand` on an evict, `TraceEvent::card` on an evict and on a play, and every `TraceCard::id` on a deal or a peek were the engine's own internal ids until now, so each consumer outside the engine mapped one vocabulary to the other itself. Property addresses move with them, which is why the two are one change: `box.<boxGameId>.`, `deck.<deckGameId>.`, `hand.<handGameId>.` and `value.<tagGameId>.` are what `getProperty` and `setProperty` take, what `listProperties()` prints, what a `write` event's `path` reports (a routed `@hand` write included), what a `BagMount` is labelled with, and what a `LoadReport`'s dropped, defaulted and retyped property paths carry; `story.` and `world.` are unchanged, and an owner this build no longer has keeps the id its save arrived with, because there is no gameId left to give it. The internal-id form still resolves for this release and SAYS SO, raising a `diagnostic` whose `where` is "property address" and whose message names the address to move to, and it IS REFUSED AFTER THE NEXT LOCKSTEP RELEASE; one spelling needed a second pass before it could go on that timetable, a tag gameId being unique only within its group, so `value.docks` named the first such tag in bundle order; the entry below settles that. Saves are unaffected: an envelope keys its property bags, cooldowns, board and turns by internal id and stays that way, because a save has to survive a rename. The state logger's `snapshotState` now reads the BAGS rather than the envelope for the same reason, so its snapshot and the live logger's lines stay in one path space. Parity with the JS runtime, corpus-pinned at corpus version 6.

- **Read-only `@world` properties honour the game's own writes** (2026-09-05). `writable: false` on a `@world` declaration is the STORY's promise not to write that value, so it binds an outcome and nobody else: `Engine::setProperty` and `Flow::setProperty` pass the kernel's host flag (in every scope, not just `@world`) and are never refused, while an outcome is still refused against the engine's read-only table before the write reaches a bag or a bound resolver. `ScopeRegistry::set` takes the same `host` argument, and a `world.*` examiner row reports `writable = false` whether or not the game has just written it. `UStoryletWorld`'s own split is untouched: its Set* calls were never bound by either rule. Parity with the JS runtime.

- **A load now prunes what it reports**: a property the build no longer declares, a cooldown or spent entry for a deleted card, and a saved value that no longer fits its declaration (a struck-out enum value, an edited quality ladder) are dropped rather than carried, and named in the report.

## [0.4.1] - 2026-09-04

### Changed

- **Lockstep with the Godot addon's 0.4.1**, which could not open a project. No change of its own: one version number means one runtime behaviour across all four.

## [0.4.0] - 2026-09-04

### Added

- **`UStoryletWorld`, the game's `@world` container, bound at `UStoryletEngine::Create(Bundle, Seed, bRetainLog, World)`**: Blueprint-callable typed `Set*`/`Get*`, `Names`, an `OnChanged` event (host writes and story writes told apart), and `SetReadOnly` for the GAME's policy (a story write to such a name is refused with `@world.x is the game's alone`, surfacing as `Play` returning false). The engine reads and writes `@world` through it, so the game, the story and anything else bound to the same object (Patterplay's host scope, in the Hamlet demo) share one set of values. `GetBoundWorld()` returns it; the binding survives `ApplyLiveBundle`. Without one the engine self-backs `@world` exactly as before. The last of the four runtimes to gain a host binding; `StoryletEngine.World` is the automation case.
- **A load restores a bound container directly**: `UStoryletSave::LoadStateFromJson` hands the file's `@world` values to the bound `UStoryletWorld` as the host (its read-only policy binds the story, not a load); a self-backed engine is written through `setProperty` as before. Saves already carried the values, read through whichever backing the engine has.

- **Read-only `@world` refused at runtime**: an outcome writing a `writable: false` property throws `'@world.x' is read-only`; the loader now reads the flag. Parity with the JS runtime and with Patterplay, corpus-pinned.

- **`EngineOptions::onReplacedFlow`** (`std::function<void(const std::string&, int)>`):
  fired when `openFlow` replaces a flow that still held dealt cards, naming the
  flow and the count. Parity with the JS runtime's `onReplacedFlow`, added the
  same day, and for the same reason: a host calling `openFlow` instead of
  `getFlow` after `loadGame` silently discards the restored hand. Zero cost when
  unset.

## [0.3.0] - 2026-09-02

### Changed

- **BREAKING: the C++ core's `storylets::PropertyView` is gone; `listProperties()` returns
  `storylets::PropertyRow`.** It was the shared row plus a `path`, and `path` is on the shared
  row now. The Blueprint-facing `FStoryletPropertyView` is unchanged.
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
  condition that resolves to a string or a flag list previously always FAILED;
  it now passes when the string is non-empty or the list has members, which is
  what Patterplay has always done and what JavaScript coerces.

  This is a behaviour change to existing content: a card gated on a bare
  `@story.title` was unreachable and now is not. Booleans and numbers are
  unaffected.

  The two engines share a property registry, so the same value read from the
  same registry answered a condition differently depending on which engine
  asked. That was drift from writing them at different times rather than a
  decision, and this is the side that was wrong.

- **Flags compare as a SET.** `==` and `!=` on a flags value now ignore order.
  They are compared as multisets, so a duplicated flag still counts. The stored
  order was an artefact of the order somebody happened to add things in, and
  `set_flags` sorting its result only held while every producer sorted, which a
  declared default or a host-supplied list does not. `set_flags` still sorts, now
  purely so a save is byte-reproducible.

### Fixed

- **Numbers render the way JavaScript's `String(n)` renders them.** This is
  described as the cross-runtime number-rendering contract and it did not hold.
  The C++ runtime was already correct here, and is what the shared
  implementation now carries for every runtime.
- **A bundle that did not compile now says so in the Inspector, whatever the
  reason.** The details view tested `LoadError` alone, so an asset that never
  parsed and carried an empty one fell through to a default-constructed
  description and showed BLANK fields rather than a fault. Patterplay's
  equivalent already distinguished the two.

### Changed

- `StoryletValue`, `StoryletKind`, `Mulberry32`, the AST node and the evaluator
  moved to `Public/Storylets/Expr/`, generated from a single shared source also
  used by Patterplay. Types, namespace and members are unchanged.
- `Mulberry32` takes a `double` seed rather than an `int64_t`, matching the JS
  API, so the coercion happens once rather than at every call site.


## [0.1.0] - 2026-08-30

### Added

- Shared scarcity (design/shared-scarcity.md): `shared` on a `Deck` and a
  `Card` plus `sharedCopies`, so a pile (or one card) is scarce across flows.
  Claims count every live flow's board; a shared `redraw: never` is spent for
  everyone on the first play; a finite `redraw` stays personal. Two new trace
  verdicts, `ClaimedElsewhere` and `Taken`.
- `UStoryletEngine::GetRunLog()` / `ClearRunLog()` and `storylets::Engine::log()`:
  the RUN's log, every flow's events in one order, each `FStoryletLogEntry`
  carrying the `Flow` it happened in. The Runtime State panel draws it under
  the engine's name, above the per-flow sections.
- The save's shared half is now `{ props, spent }`, carrying what a shared
  one-shot took out of the world.
- Flows (design/flows.md): the plugin is now `UStoryletEngine` (the bundle,
  the shared state, `@world`, and `OpenFlow` / `GetFlow` / `Flows` /
  `CloseFlow` / `Reset`) plus `UStoryletFlow` (one playthrough: the play
  verbs, the merged property view, the log, `Close` / `IsClosed` /
  `GetFlowId`), both Blueprint-callable and both named after Patterplay's
  `UPatterEngine` / `UPatterFlow` so a project running both engines reads
  the same. This REPLACES the `UStoryletSession` of the entries below,
  which was engine and single flow in one object. Flow wrappers the game
  holds re-bind by name across a save load or a live bundle push, so a
  Blueprint variable pointing at a flow survives both.
- `UStoryletSave` (`SaveStateToJson` / `LoadStateFromJson`, Blueprint
  function library, the shape of Patterplay's `UPatterSave`): the
  `.storyletsave` string boundary moved off the session object. The file is
  `storylets/savefile@1` - the engine's envelope, every live flow inside it,
  and the current `@world` values beside it.
- `Storylets/Save.h`: the save/restore code is now pure std C++ in the core,
  with the UE layer a thin FString shim over it, so the clang TestHost
  exercises a real round trip (it could not reach the FString version).
- Live Link went to protocol **v2** (design/live-link.md): a client now
  attaches to the **ENGINE**, not to one flow. `hello` carries `flows`, new
  `flowOpen` / `flowClose` frames announce participants joining and leaving,
  and every `trace` and `board` frame names its `flow`. The client discovers
  flows itself by diffing the engine's list before each forwarded event, so a
  multi-participant run needs nothing extra from the host. The editor's Board
  follows one flow at a time and remembers the last board per flow. Held to
  the shared fixture in `packages/conformance/live-link/`, which now scripts a
  second participant opening, playing and closing.
- Live Link (design/live-link.md): `FStoryletLiveLink` (Create / Attach /
  Detach / SetBuild / Close, `OnBundle` on the game thread, the static
  `ApplyLiveBundle(Engine, Data, Error)` helper), the std-only
  `storylets::LiveLinkClient` and frame builders in `Storylets/LiveLink.h`
  it rides on, `UStoryletFlow::SubscribeTrace` / `UnsubscribeTrace` (C++
  only, held at the wrapper so it survives a swap), `UStoryletEngine::
  ApplyLiveBundle` (in place; Blueprint-callable) and
  `UStoryletBundle::GetBuildId`. The WebSockets dependency is dropped in
  Shipping, where the link compiles to no-ops. The TestHost replays the
  shared fixture `packages/conformance/live-link/` byte for byte.
- The core's `deal`, `evict`, `play` and `turns` trace events now fire AFTER
  the state they report has landed (the reference's reorder, pinned by the
  Live Link fixture: a board read inside a trace handler shows the event's
  effect).
- The UE wrapper layer (stage 2): `UStoryletBundle` (UDataAsset holding the
  raw `.storyletsc` JSON verbatim, compiled behind a Pimpl in PostLoad, with
  `LoadError` readable on a broken asset and the BP-callable
  `LoadFromJsonString` side door), the session object since split into
  `UStoryletEngine` + `UStoryletFlow` above (deal / dealMany /
  dealAllHands / peek / board / outcomes / play / playAdvancing /
  advanceTurns / getTurn / listBoxes / listProperties, typed property
  accessors only across the Blueprint boundary; core exceptions caught here
  and surfaced as error strings/logs), the BP view structs
  (`StoryletTypes.h`),
  `FStoryletDebug` (the live-engine registry, no-ops in Shipping), and the
  one UE-JSON-meets-the-core bridge (`StoryletJsonBridge`).
- The `StoryletEngineEditor` module: the `.storyletsc` UFactory +
  FReimportHandler (a broken bundle still imports, error on the asset), and
  the "Storylet Engine Runtime State" nomad tab (Window > Tools) - per
  registered engine: Save State... / Load State... file dialogs and the
  shared properties, then per open flow the property examiner with
  type-aware editors (toggle / number / text / enum / flags) behind a search
  filter, per-row reset disabled at default, and read-only per-box turns
  (title-or-gameId, from ListBoxes) and board
  sections; ~4 Hz refresh with a signature rebuild gate and PIE
  attach/detach.
- `StoryletEngine.Smoke` (runtime module automation test): the
  UObject-boundary seams headless - JSON -> bundle -> engine -> flow -> deal ->
  outcomes -> play -> typed access -> save/load round trip -> foreign-blob
  rejection.
- The sample project (`../StoryletEngineDemo`): map-free, finds the plugin
  as a sibling via AdditionalPluginDirectories, loads the exported village
  example from `Demos/` and plays a storylet on BeginPlay.
- `Config/FilterPlugin.ini` (LICENSE / README / CHANGELOG ship in the
  packaged plugin).

### Added (stage 1)

- The pure C++ runtime core (`Source/StoryletEngineRuntime/Public/Storylets/`,
  std-only header-implemented C++17, no Unreal types), transliterated from the
  TS reference runtime: `StoryletValue` (+ the port's error types),
  `Mulberry32` (+ the contractual shuffle), the insertion-ordered map (JS Map
  semantics), the state kernel (`PropertyBag`, `ScopeRegistry`), the neutral
  `JsonValue` tree, expression AST + evaluator + storylets dialect +
  matched-constraint specificity, the compiled bundle model + loader + save
  envelope, and the full `Session` (deal / dealMany with the dealt slice,
  peek, play, outcomes, board, listBoxes, per-box turns, cooldowns, claims and
  copies, the home group, hand templates with holes and the composed @hand
  environment with write-back routing, ranking with stable sorts and seeded
  tie shuffles, save/load with the drifted-content contract, retained log +
  trace events, property rows and path-addressed get/set).
- The plugin scaffold: `StoryletEngine.uplugin` (Runtime module only for now;
  the Editor module joins in stage 2 with the Slate examiner and the
  `.storyletsc` factory), `StoryletEngineRuntime.Build.cs` and the minimal
  module pair.
- The clang TestHost (repo-side, `ports/unreal/TestHost/`, never ships):
  replays the whole conformance corpus (expressions, specificity, peek,
  scripted) through the C++ core with its own tiny JSON parser feeding the
  core's neutral `JsonValue`.
