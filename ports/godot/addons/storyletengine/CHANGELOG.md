# Changelog

All notable changes to Storylet Engine for Godot are documented here. The
Storylet Engine runtimes (JS, Unity, Unreal, Godot) are versioned in lockstep:
the same version number always means the same runtime behaviour.

## [Unreleased]

### Added

- **Hand positions carried in a bundle's `maps` block** (2026-09-05). A map may carry `sites`, a list of `{hand, x, y}` saying where each placed hand stands, and `describe_bundle` counts it beside the zones and the pictures (design/engine-server.md 4.3). The parsed Dictionary IS the bundle here, so a host reads the positions straight off it. Still INERT PAYLOAD: nothing in the engine reads any of it. The bundle view counts it on the map's line. No corpus change: a position is not a behaviour.

- **`durable` carried on declarations, decks and cards** (2026-09-05). The durability axis (design/engine-server.md 4.2): `durable` says whether a value, or a `redraw: "never"` spend, survives the end of a RUN, where `shared` says whose it is within one. INERT in the engine, which partitions by `shared` alone and never reads the flag; a server lifts and restores durable values across a run boundary through `get_property` / `set_property`, and durable spends through `open_flow(id, {"restore": blob})` and `mark_taken`. The bundle carries it through, `describe_bundle` marks a durable declaration with `"durable": true` and counts a box's durable cards as `"durableCards"`, and the addon's bundle view shows "(durable)" on the property row and "durable cards N" on the box's counts line. No corpus change: nothing about play is different.

- **A box that counts in time: `turn: { seconds: N }`** (2026-09-05). A box may declare that its turns are TIME rather than plays. In such a box `play` advances the clock by 0 by default instead of `settings.playAdvancesTurns`; a call passing `advance_turns` still gets what it asked for, and `advance_turns` is unchanged, because the host is what ticks a timed box. `redraw: N` on its cards then reads as N x `seconds`, which the tools say and the engine does not act on. `describe_bundle` reports it as `turn: {"seconds"}` on the box summary, and the addon's bundle view shows `turn = 60s` on the box's counts line. Parity with the JS runtime, corpus-pinned (corpus version 5).

- **A hole filled from a property: the hand that moves** (2026-09-05). A hand's `chosen` value (or a standalone hand's rule binding) may be a property reference (`"@hand.zone"`, `"@story.where"`, `"@world.place"`) rather than a tag id; the engine resolves it at ask time and binds the hole to the tag it names, so moving a hand is `set_property` and the next deal follows. Parity with the JS runtime, corpus-pinned. A value naming no tag leaves the hole unbound (a wildcard) with a diagnostic, never a silently empty hand. `StoryletBundleInspector.describe_bundle` reports the holes as a hand row's `"movable"`, and the bundle view shows them on the hand's own line.

- **`engine.save_flow(id)` and `engine.open_flow(id, {"restore": blob})`: park one flow, and open it as it was** (2026-09-05). Parity with the JS runtime's `saveFlow` / `openFlow(restore)`, corpus-pinned. Closing a parked flow releases its shared claims; on the way back, a shared card the world has since given out is dropped as `claimed-elsewhere` rather than double-claimed. `{"on_restore_report": Callable}` hands out what the restore did.

- **`engine.preview_load(envelope)` and `engine.preview_flow_restore(id, blob)`.** What a save load would drop, default or reset, and whether its build is this one - answered before the load. Both change nothing.

### Changed

- **BREAKING: `load_game` returns the load report Dictionary, not an error String.** It answers with the same report `preview_load` gives, and refuses a save for another project the way the rest of the addon refuses things: `{}` and a `push_error`. `StoryletSave.load_state` and `StoryletLiveLink.apply_live_bundle` still report a foreign project by message, asked for by name before the load.

- **A load now prunes what it reports**: a property the build no longer declares, a cooldown or spent entry for a deleted card, and a saved value that no longer fits its declaration (a struck-out enum value, an edited quality ladder) are dropped rather than carried, and named in the report.

## [0.4.1] - 2026-09-04

### Fixed

- **The Board demo would not parse, so a project carrying this addon failed to open.** `board_demo.gd` held a statement at column 0 inside `_on_bundle_pushed`, which GDScript reads as an identifier in the class body: `Unexpected identifier "StoryletDebug" in class body`. Godot parses every script in a project when it opens, so this broke the whole project for anyone who dropped the addon in, and it has shipped that way since 2026-08-29. The headless suites run named scripts and never touched the demo, so nothing caught it; CI now parses every script in the addon.
- The same botched edit had added `StoryletDebug.unregister_link(_link)` to the live-refresh path, where it would have dropped the Live Link from the state panel for good: the link object survives a refresh and nothing re-registers it. Removed; the old engine is still unregistered, as it was before.


## [0.4.0] - 2026-09-04

### Added

- **Read-only `@world` refused at runtime**: an outcome writing a `writable: false` property is refused with `'@world.x' is read-only`. Parity with the JS runtime and with Patterplay, corpus-pinned.

- **`on_replaced_flow`** create option, a `Callable(id: String, dealt: int)`:
  fired when `open_flow` replaces a flow that still held dealt cards. Parity with
  the JS runtime's `onReplacedFlow`, added the same day, and for the same reason:
  a host calling `open_flow` instead of `get_flow` after `load_game` silently
  discards the restored hand. Zero cost when unset.

## [0.3.0] - 2026-09-02

### Changed
- **A property bag composes its rows' addresses.** Each bag is built knowing the path it answers
  to (`story.`, `box.<id>.`, `deck.<id>.`, `hand.<id>.`, `value.<id>.`, `world.`), so a row
  arrives addressed instead of having a prefix pasted onto it by each caller. **The addresses are
  unchanged** - this is where they are composed, not what they are.

### Fixed

- **A quality row carries its ladder.** `stages` was on the examiner row so an editor could
  offer the stages instead of a free-text box, and the shared code that builds rows never filled
  it in - on this runtime and two others. Every quality row came out without one.

## [0.2.0] - 2026-09-01

### Removed

- **BREAKING: the `StoryletAst` class is gone.** The evaluator now walks the
  tagged-tuple form a bundle already carries, so there is no deserialisation step
  and nothing to expose. It was an internal detail and is not referenced anywhere
  in the addon; if you called `StoryletAst.deserialise`, the compiled `ast` array
  is now what the evaluator takes directly.

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
  `js_number` used a 1e15 cutoff and `String.num`'s 14-decimal default, so
  `0.1 + 0.2` showed as `0.3`, `1e16` as `10000000000000000.0` with a trailing
  `.0`, and `1/3` lost two digits.
- **The PRNG seed is coerced the way JavaScript coerces it** (ECMA-262 ToUint32).
  `StoryletMulberry32` took an `int`, so seeds outside 64-bit integer range
  (`1e19`, `Infinity`) both answered `4294967295` rather than `2313682944` and
  `0`. The other three runtimes were already correct, which is why nothing
  noticed.

### Changed

- The evaluator, the specificity scorer, the value helpers, the PRNG and both
  bundle plugins moved to `runtime/expr/`, generated from a single shared source
  also used by Patterplay. `StoryletExpression`, `StoryletValues`,
  `StoryletMulberry32` and `StoryletSpecificity` are unchanged as names and
  members; they are now thin wrappers over that source.


## [0.1.0] - 2026-08-30

### Added
- Shared scarcity (design/shared-scarcity.md): `shared` on a deck (or a card,
  overriding its deck) plus `sharedCopies`, so a pile is scarce across flows
  rather than one each per participant. Claims count every live flow's board;
  a shared `redraw: "never"` is spent for everyone on the first play; a finite
  `redraw` stays personal, because a cooldown is an absolute turn of a per-flow
  clock. Two new trace verdicts, `claimed-elsewhere` and `taken`.
- `engine.log()` / `clear_log()`: the RUN's log, every flow's events in one
  order with each entry naming its `flow`. The state panel draws it under the
  engine's name, above the per-flow sections.
- The save's shared half is now `{props, spent}`, carrying what a shared
  one-shot took out of the world.
- Flows (design/flows.md): `StoryletEngine` owns the bundle, the shared state
  and `@world`; a `StoryletFlow` is one playthrough across it, and every play
  verb lives there. `open_flow` / `get_flow` / `flows` / `close_flow` /
  `reset` manage them, re-opening a name replaces that flow, and a closed
  handle is inert. Named after Patter's engine / flow so a project running
  both engines reads the same. `StoryletDebug` keys on the ENGINE
  (`register(engine, "label")`): the Runtime State panel asks each engine for
  its open flows, so a flow opened or closed later appears and disappears
  without a registry call. Covered headlessly by `test/test_state_panel.gd`.
  This REPLACES the `session` of the entries below, which was engine and
  single flow in one object: everything they say about a "session" is now
  split between the two, with the play verbs on the flow and the bundle,
  shared state and save on the engine.
- The pure GDScript runtime: bundle loading (`.storyletsc`), sessions
  (deal / peek / play / outcomes / board / per-box turns / cooldowns /
  claims and copies / templates and the composed `@hand`), the storylets
  expression dialect, matched-constraint specificity ranking, the mulberry32
  per-flow PRNG, and the save envelope with the `.storyletsave`
  string boundary (`StoryletSave`).
- The shared state kernel pieces: `StoryletPropertyBag` (typed declared
  properties, the firing rule, audit hook, one clone door) and
  `StoryletScopeRegistry` (owned / foreign scopes, save fragments).
- The `.storyletsc` EditorImportPlugin and `StoryletBundleResource` (raw JSON
  held verbatim, lazily parsed; a broken bundle still imports with its error
  readable on the asset).
- `StoryletStatePanel`, the in-game property examiner / editor with per-box
  turns, board contents and Save/Load state, plus the `StoryletDebug`
  session registry it reads.
- The Hamlet demo scene and the headless corpus / smoke TestHosts
  (maintainers; not shipped).
- Live Link went to protocol **v2** (design/live-link.md): a client now
  attaches to the **ENGINE**, not to one flow. `hello` carries `flows`, new
  `flowOpen` / `flowClose` frames announce participants joining and leaving,
  and every `trace` and `board` frame names its `flow`. The client discovers
  flows itself by diffing the engine's list before each forwarded event, so a
  multi-participant run needs nothing extra from the host. The editor's Board
  follows one flow at a time and remembers the last board per flow. Held to
  the shared fixture in `packages/conformance/live-link/`, which now scripts a
  second participant opening, playing and closing.
- Live Link: `StoryletLiveLink` streams the attached engine's trace and
  board snapshots to Storyletter (`storyletengine/debug@1`) and takes edited
  bundles back into the running game (`bundle_pushed` then
  `StoryletLiveLink.apply_live_bundle`, the run carried across). Debug
  builds only. Trace events now fire after the state they report has landed,
  so a handler reading the session inside one sees the effect.
