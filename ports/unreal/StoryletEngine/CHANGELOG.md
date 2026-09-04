# Changelog

## [Unreleased]

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
