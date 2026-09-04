# Changelog

## [Unreleased]

## [0.4.1] - 2026-09-04

### Changed

- **Lockstep with the Godot addon's 0.4.1**, which could not open a project. No change of its own: one version number means one runtime behaviour across all four.

## [0.4.0] - 2026-09-04

### Added

- **Read-only `@world` refused at runtime**: an outcome writing a `writable: false` property throws `'@world.x' is read-only`; the loader now reads the flag. Parity with the JS runtime and with Patterplay, corpus-pinned.

- **`EngineOptions.OnReplacedFlow`** (`Action<string, int>`): fired when `OpenFlow`
  replaces a flow that still held dealt cards, naming the flow and the count.
  Parity with the JS runtime's `onReplacedFlow`, added the same day, and for the
  same reason: a host calling `OpenFlow` instead of `GetFlow` after `LoadGame`
  silently discards the restored hand. Zero cost when unset.

## [0.3.0] - 2026-09-02

### Changed

- **BREAKING: `PropertyView` is gone; `ListProperties()` returns `List<PropertyRow>`.** It was
  `PropertyRow` plus a `Path`, and `Path` is on the shared row now. C# has no type alias to keep
  the old name alive with, and an empty subclass would be a type a bag's own row could never
  satisfy. `ScopePropertyRow` (which adds the scope token) is unaffected.
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
  `JsNumber` cast to `long`, so `1e20` printed as `9223372036854775807`.
- **The PRNG seed is coerced the way JavaScript coerces it** (ECMA-262 ToUint32)
  in every runtime, so all four land on the same first draw for every seed.

### Changed

- `StoryletValue`, `StoryletKind`, `Mulberry32` and `Specificity` moved to
  `Runtime/Expr/`, generated from a single shared source also used by
  Patterplay. The types, namespace and members are unchanged; only the files
  moved.


## [0.1.0] - 2026-08-30

### Added

- Shared scarcity (design/shared-scarcity.md): `Shared` on `Deck` and `Card` plus
  `SharedCopies`, so a pile (or one card) is scarce across flows rather than
  one each per participant. Claims count every live flow's board; a shared
  `redraw: never` is spent for everyone on the first play; a finite `redraw`
  stays personal, because a cooldown is an absolute turn of a per-flow clock.
  Two new trace verdicts, `ClaimedElsewhere` and `Taken`, because "claimed"
  and "cooldown" would point a participant at their own board and their own
  clock, neither of which has anything to do with it.
- `Engine.Log()` / `ClearLog()`: the RUN's log, every flow's events in one
  order with each entry naming its `Flow`. A flow's own log cannot show a
  story action in another flow moving shared state. The Runtime State window
  draws it under the engine's name, above the per-flow sections.
- The save's shared half is now `{ props, spent }` rather than a bare
  `PropsPartition`, carrying what a shared one-shot took out of the world.
- Flows (design/flows.md): `Engine` owns the bundle, the shared state and
  `@world`; a `Flow` is one playthrough across it, and every play verb lives
  there. `OpenFlow` / `GetFlow` / `Flows` / `CloseFlow` / `Reset` manage them,
  re-opening a name replaces that flow, and a closed handle is inert. Named
  after Patter's `Engine` / `Flow` so a project running both engines reads the
  same. `StoryletBundleAsset.CreateSession` is now `CreateEngine`, and
  `StoryletDebug` keys on the ENGINE (`Register(engine, label)`): the Runtime
  State window asks each engine for its open flows, so a flow opened or closed
  later appears and disappears without a registry call.
  This REPLACES the `session` of the entries below, which was engine and
  single flow in one object: everything they say about a "session" is now
  split between the two, with the play verbs on the flow and the bundle,
  shared state and save on the engine.
- The pure C# runtime layer, transliterated from the TS reference runtime:
  `StoryletValue`, `Mulberry32` (+ the contractual shuffle), the state kernel
  (`PropertyBag`, `ScopeRegistry`), expression AST + evaluator + storylets
  dialect + matched-constraint specificity, the compiled bundle model and
  save envelope, and the full `Session` (deal / dealMany with the dealt
  slice, peek, play, outcomes, board, per-box turns, cooldowns, claims and
  copies, the home group, hand templates with holes and the composed @hand
  environment with write-back routing, ranking with stable sorts and seeded
  tie shuffles, save/load with the drifted-content contract, retained log +
  trace events, property rows and path-addressed get/set).
- The Newtonsoft JSON layer (`StoryletEngine.Runtime.Json`): compiled-bundle
  loading into the pure model.
- The dotnet TestHost (repo-side, never ships): replays the whole
  conformance corpus (expressions, specificity, peek, scripted) through the
  C# runtime.
- `StoryletSave` in the Json layer: the `.storyletsave` string boundary over
  the runtime's own save envelope (`SerializeState` /
  `DeserializeState` / `LoadState`; foreign or malformed blobs throw),
  mirroring the play-helpers save API.
- The UnityEngine-touching runtime layer (`StoryletEngine.Runtime.Unity`):
  `StoryletBundleAsset` (raw `.storyletsc` JSON persisted verbatim, compiled
  bundle rebuilt lazily, parse failures readable on `LoadError`,
  `CreateSession(seed)`), and the `StoryletDebug` session registry (weakly
  held, `OnChanged` event) the examiner reads.
- The editor layer (`StoryletEngine.Editor`): `StoryletBundleImporter`
  (ScriptedImporter for `.storyletsc`; a broken bundle still imports with
  the error readable on the asset) and the Runtime State window
  (Window > Storylet Engine > Runtime State): per-session Save/Load of
  `.storyletsave` files, the type-aware property examiner / editor with
  per-row reset and a ~4 Hz refresh that spares the focused control, and
  read-only per-box turns + board contents.
- The Board demo, as a committed Unity project beside this package
  (`../StoryletEngineDemo`): open it and press Play, no package install and no
  sample import, because its manifest references this folder by relative path.
  The exported Hamlet bundle dealt onto a playable board (hands as groups,
  cards as buttons, outcomes beneath their card, a transcript of every deal,
  play and turn), registered with `StoryletDebug`. The same demo ships for
  Godot, Unreal and JavaScript. It replaces the `Samples~/BoardDemo` UPM
  sample, which is retired: one home for the demo, so the two copies cannot
  drift.
- `.meta` files for every shipped file and folder (generated by Unity
  6000.4.6f1 against an embedded checkout of this package).
- Live Link went to protocol **v2** (design/live-link.md): a client now
  attaches to the **ENGINE**, not to one flow. `hello` carries `flows`, new
  `flowOpen` / `flowClose` frames announce participants joining and leaving,
  and every `trace` and `board` frame names its `flow`. The client discovers
  flows itself by diffing the engine's list before each forwarded event, so a
  multi-participant run needs nothing extra from the host. The editor's Board
  follows one flow at a time and remembers the last board per flow. Held to
  the shared fixture in `packages/conformance/live-link/`, which now scripts a
  second participant opening, playing and closing.
- Live Link: `StoryletLiveLink` (Runtime) joins a running game to
  Storyletter over a loopback WebSocket on a worker thread: `Attach(engine)`
  streams the session's trace and board snapshots to the editor's Board,
  `TryReceive` (drained from `Update()`) hands back pushed bundles, which
  `StoryletLiveBundle.TryParsePush` + `Apply` (Json layer) swap in under the
  run, state kept; `SetBuild` re-hellos. `StoryletDebug.RegisterLink` lets
  the Runtime State window show the link's state. The demo wires it behind
  `#if UNITY_EDITOR || DEVELOPMENT_BUILD`; the TestHost replays the shared
  fixture (`packages/conformance/live-link/`) against it. Trace events now
  fire after the state they report has landed (deal, evict, play, turns), as
  the reference runtime does.
