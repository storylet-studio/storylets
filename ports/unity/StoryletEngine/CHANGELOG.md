# Changelog

## [Unreleased]

### Added

- **Hand positions carried in a bundle's `maps` block** (2026-09-05). `BundleMap.Sites` is a list of `MapSite` (a hand gameId and a point), parsed and handed over like the zones and the pictures beside it, and reported as `MapSummary.Sites` (design/engine-server.md 4.3). Still INERT PAYLOAD: nothing in the engine reads any of it. The bundle inspector counts it on the map's line ("village - zone: zones 1, pictures 1, sites 2"). No corpus change: a position is not a behaviour.

- **`Durable` carried on declarations, decks and cards** (2026-09-05). The durability axis (design/engine-server.md 4.2): `Durable` says whether a value, or a `redraw: "never"` spend, survives the end of a RUN, where `Shared` says whose it is within one. INERT in the engine, which partitions by `Shared` alone and never reads the flag; a server lifts and restores durable values across a run boundary through `GetProperty` / `SetProperty`, and durable spends through `OpenFlow(id, restore)` and `MarkTaken`. `BundleLoader` carries it, `DescribeBundle` marks a durable declaration on `PropertySummary.Durable` and counts a box's durable cards on `BoxSummary.DurableCards`, and the asset Inspector shows "(durable)" on the property row and "durable cards N" on the box's counts line. No corpus change: nothing about play is different.

- **A box that counts in time: `turn: { seconds: N }`** (2026-09-05). A box may declare that its turns are TIME rather than plays, and `Box.Turn` carries the unit. In such a box `Play` advances the clock by 0 by default instead of `Settings.PlayAdvancesTurns`; a call that sets `PlayOptions.AdvanceTurns` still gets what it asked for, and `AdvanceTurns` is unchanged, because the host is what ticks a timed box. `redraw: N` on its cards then reads as N x `seconds`, which the tools say and the engine does not act on. `DescribeBundle` reports it as `BoxSummary.TurnSeconds`, and the bundle inspector shows `turn = 60s` on the box's counts line. Parity with the JS runtime, corpus-pinned (corpus version 5).

- **A hole filled from a property: the hand that moves** (2026-09-05). A hand's `Chosen` value (or a standalone hand's rule binding) may be a property reference (`"@hand.zone"`, `"@story.where"`, `"@world.place"`) rather than a tag id; the engine resolves it at ask time and binds the hole to the tag it names, so moving a hand is `SetProperty` and the next deal follows. Parity with the JS runtime, corpus-pinned. A value naming no tag leaves the hole unbound (a wildcard) with a diagnostic, never a silently empty hand. `DescribeBundle` reports the holes as `HandSummary.Movable`, and the bundle inspector shows them on the hand's own line.

- **`SaveFlow(id)` and `OpenFlow(id, new OpenFlowOptions { Restore = blob })`: park one flow, and open it as it was** (2026-09-05). Parity with the JS runtime's `saveFlow` / `openFlow(restore)`, corpus-pinned. Closing a parked flow releases its shared claims; on the way back, a shared card the world has since given out is dropped as `claimed-elsewhere` rather than double-claimed. `OnRestoreReport` hands out what the restore did.

- **`PreviewLoad(envelope)`, `PreviewFlowRestore(id, blob)`, and a `LoadReport` returned by `LoadGame`.** What a save load would drop, default or reset, and whether its build is this one - answered before the load as well as by it. The previews change nothing; a project mismatch is still the one refusal.

### Changed

- **A load now prunes what it reports**: a property the build no longer declares, a cooldown or spent entry for a deleted card, and a saved value that no longer fits its declaration (a struck-out enum value, an edited quality ladder) are dropped rather than carried, and named in the report.

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
