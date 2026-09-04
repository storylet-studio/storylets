# Storylet Engine for Unreal

The native C++ runtime for Storyletter, packaged as an Unreal Engine plugin:
loads a compiled `.storyletsc` bundle and deals, peeks and plays storylets
directly in Unreal. Every Storylet Engine runtime (JS, Unity, Unreal, Godot)
plays the same bundle with the same behaviour, held to the shared conformance
corpus.

## Layering

Two layers, the Patterplay split applied verbatim:

- `Source/StoryletEngineRuntime/Public/Storylets/` - the pure engine core:
  std-only, header-implemented C++17 with **no Unreal types or includes
  anywhere**. The value type (`StoryletValue`), the mulberry32 PRNG, the
  insertion-ordered map (JS `Map` semantics: re-set keeps position), the
  state kernel (`PropertyBag`, `ScopeRegistry`), the expression AST +
  evaluator + storylets dialect + specificity scorer, the neutral `JsonValue`
  tree the core consumes instead of a JSON library, the bundle model +
  loader + save envelope, and the play surface (`Engine`: the bundle, the
  shared state, the run log and the flow manager; `Flow`: deal / peek / play /
  outcomes / board / turns / trace / property access).
- The UE wrapper layer (the rest of `Source/StoryletEngineRuntime` plus
  `Source/StoryletEngineEditor`): everything Unreal-flavoured, over the core
  via `TPimplPtr`. Exceptions from the core are caught at this boundary and
  surfaced as error strings and logs; Blueprint never sees a C++ exception.

The transliteration discipline: the C++ sources keep the file split and
member names of the TS reference runtime (`packages/runtime`,
`packages/dialect`, `packages/model`, and the expr monorepo's `expr` /
`expr-specificity` / `scoperegistry`), so a TS diff maps mechanically onto
the port. The Unity port (`ports/unity/StoryletEngine`) is the same
transliteration in C#; the three stay in lockstep.

## Using it

- **Import a bundle**: drag a compiled `.storyletsc` into the Content
  Browser; the factory builds a `UStoryletBundle` (a `UDataAsset` holding the
  raw JSON verbatim, compiled in `PostLoad`). A broken bundle still imports,
  with the error readable on the asset (`LoadError`). Right-click > Reimport
  refreshes from the tracked source file. For DLC or downloaded content, the
  BP-callable side door `UStoryletBundle::LoadFromJsonString` compiles a
  transient bundle at runtime.
- **Shared scarcity**: a deck (or a single card) marked `shared` is scarce
  across flows, not just the state it reads: one goblin in the world, and a
  shared `redraw: never` spent for everyone the moment anyone plays it.
  `sharedCopies` is the world cap and defaults to `copies`.
- **Play**: `UStoryletEngine::Create(Bundle, Seed, bRetainLog, World)` (`World` optional: a `UStoryletWorld`, the game's `@world` container, read and written by every flow, with `SetReadOnly` for the game's own policy) then
  `Engine->OpenFlow("main")` for a flow to play on (open one per parallel
  playthrough; `GetFlow` / `Flows` / `CloseFlow` manage them). On the flow:
  `Deal` /
  `DealMany` / `DealAllHands`, `Peek`, `Board`, `Outcomes`, `Play` (or
  `PlayAdvancing` with an explicit turn advance), `AdvanceTurns`, `GetTurn`,
  `ListBoxes` - all Blueprint-callable, all views converted to BP structs
  (`FStoryletDealtCard`, `FStoryletOutcomeView`, `FStoryletBoxView`, ...) at
  the boundary.
- **Properties**: typed accessors only cross the Blueprint boundary
  (`GetPropertyNumber/String/Bool/Flags` + setters, path-addressed:
  `"story.gold"`, `"box.b_x.heat"`); no generic value struct on a BP pin.
  `ListProperties` returns examiner rows (type, stringified value/default,
  enum options, `bIsDefault` for reset buttons).
- **Save/load**: `UStoryletSave::SaveStateToJson` / `LoadStateFromJson` -
  the `.storyletsave` string boundary (schema `storylets/savefile@1`: the
  engine's envelope with every live flow in it, plus the `@world` values) in
  the runtime module, never editor-only. A foreign or malformed blob returns
  false and leaves the engine untouched. Flow objects the game is holding
  re-bind by name across the load.
- **Live Link**: `FStoryletLiveLink` connects a running game to Storyletter
  (`ws://127.0.0.1:4472`): `Create(Bundle->GetBuildId(), Project)` then
  `Attach(Engine)` streams every flow's trace and board snapshots, each
  frame naming its `flow`, so the editor's Board shows the game's run. The
  ENGINE, not a flow: the link discovers flows itself and announces them as
  they open and close; `OnBundle` (game thread) delivers the
  bundle a save pushes, `FStoryletLiveLink::ApplyLiveBundle` /
  `UStoryletEngine::ApplyLiveBundle` swap it in IN PLACE with the run
  carried across, then `SetBuild`. Compiles to no-ops in Shipping (the
  WebSockets dependency is dropped there). The frames it sends are held to
  the shared fixture `packages/conformance/live-link/` by the TestHost. See
  [Live Link](https://storylet.studio/play/live-link/).
- **The examiner**: Window > Storylet Engine Runtime State (a nomad tab).
  Register engines with `RegisterForDebug("label")` (or
  `FStoryletDebug::Register`); the panel shows each live engine's shared
  properties, Save State... / Load State... buttons and the run log
  (`GetRunLog`: every flow's events in one order, each naming its flow), then
  each open flow with its own properties (type-aware editors behind a search
  filter, per-row reset-to-default), per-box turns (title-or-gameId), board
  and its own log. It refreshes at ~4 Hz, rebuilding only on
  structural change, and attaches/detaches across PIE automatically (the
  registry holds weak pointers). The registry compiles to no-ops in Shipping.

The sample project beside the plugin
(`../StoryletEngineDemo/StoryletEngineDemo.uproject`) opens ready to play;
its demo actor is the smallest integration to read first. A UObject-boundary
smoke test (`StoryletEngine.Smoke`, in the runtime module) covers the wrapper
seams; the conformance corpus below stays the behaviour gate.

## Verifying the port (the TestHost)

`../TestHost` is a plain clang build (never ships) that compiles the core
headers directly - no Unreal - and replays the whole conformance corpus:

```sh
bash ports/unreal/TestHost/build.sh
```

It loads `packages/conformance/corpus.json` (path overridable as the first
argument to the built binary), runs the four case families (expressions,
specificity, peek, scripted) exactly as documented in
`packages/conformance/src/runner.ts`, replays the Live Link fixture beside
the corpus (`live-link/script.json` through the std-only client against a
recording sink, every frame compared byte for byte with `frames.json`),
prints a per-family summary and exits non-zero on any divergence from the
reference expectations.

## Licence

MIT (see LICENSE).
