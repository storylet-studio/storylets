# Storylet Engine for Unity

The native C# runtime for Storyletter: loads a compiled `.storyletsc` bundle
and deals, peeks and plays storylets directly in Unity. Every Storylet Engine
runtime (JS, Unity, Unreal, Godot) plays the same bundle with the same
behaviour, held to the shared conformance corpus.

## Layering

Four assemblies, the Patterplay split applied verbatim:

- `Runtime/` (`StoryletEngine.Runtime`) - pure C#, no UnityEngine, no JSON
  library. The value type (`StoryletValue`), the mulberry32 PRNG, the state
  kernel (`PropertyBag`, `ScopeRegistry`), the expression AST + evaluator +
  storylets dialect + specificity scorer, the bundle model, and the play
  surface (`Engine`: the bundle, the shared state, `@world`, the run log and
  the flow manager; `Flow`: deal / peek / play / outcomes / board / turns / trace /
  property access), and `StoryletLiveLink`, the game-side Live Link
  client (a worker-thread `ClientWebSocket`; see below).
- `Runtime/Json/` (`StoryletEngine.Runtime.Json`, `noEngineReferences`) - the
  Newtonsoft-touching layer: `BundleLoader` parses a compiled bundle's JSON
  into the pure model, and `StoryletSave` is the save-file string boundary
  (`SerializeState` / `DeserializeState` / `LoadState` over the runtime's
  own `storylets/save@1` envelope inside the host's `storylets/savefile@1`
  file, the `.storyletsave` format; a foreign or
  malformed blob throws), and `StoryletLiveBundle` applies a bundle the
  editor pushed over the Live Link (`TryParsePush` / `Apply`). In Unity it
  rides `com.unity.nuget.newtonsoft-json`.
- `Runtime/Unity/` (`StoryletEngine.Runtime.Unity`) - the UnityEngine-touching
  runtime bits: `StoryletBundleAsset` (a ScriptableObject holding the raw
  `.storyletsc` JSON verbatim, the compiled bundle rebuilt lazily, any parse
  failure readable on `LoadError`, plus `CreateEngine(seed)`), and
  `StoryletDebug`, the static ENGINE registry the state window reads
  (`Register(engine, label)` / `Unregister` / `List`, weakly held, with an
  `OnChanged` event, plus `RegisterLink` / `UnregisterLink` for the game's
  Live Link, so the window can show where it is).
- `Editor/` (`StoryletEngine.Editor`, editor-only) - `StoryletBundleImporter`,
  a ScriptedImporter for `.storyletsc` (a broken bundle still imports, the
  error logged at import time and readable on the asset), and the state
  window.

## The state window

**Window > Storylet Engine > Runtime State** shows every engine registered
with `StoryletDebug`, with its shared state, Save/Load and the **run log**
(every flow's events in one order, each naming its flow), and under it a
section per open flow (the window reads
the flows off the engine, so one registration covers all of them, and a flow
opened later appears on its own):

- **Save State... / Load State...** - the whole run as a `.storyletsave`
  file via `StoryletSave` (Save/Load lives in every examiner, the parity
  rule).
- **Properties** - the property examiner / editor: one row per declared
  property from `Flow.ListProperties()`, path-addressed, with type-aware
  editors (boolean toggle, number field, string field, enum popup, flags as
  comma-separated text) and a per-row Reset disabled while the value is at
  its default. Values refresh at ~4 Hz; the focused control keeps its
  half-typed buffer. Edits commit through `Flow.SetProperty` (a silent
  host write under the firing rule).
- **Read-only state** - the per-box turn clocks and the current board
  (each hand's dealt cards, by title).

## Live Link to Storyletter

`StoryletLiveLink` is the game-side client of the editor's Live Link (the
`storyletengine/debug@1` protocol, `ws://127.0.0.1:4472`): `Attach(engine)`
forwards every trace event ANY of its flows emits, each frame naming its
`flow`, and a board snapshot after each deal, play, eviction and turn, so the
editor's Board shows the game's run. You attach the engine, not a flow: the
link discovers flows itself and announces them as they open and close, so a
multi-participant run needs nothing extra from the host.
`TryReceive` (drained from `Update()`) hands back a bundle the editor pushed
after a save, which `StoryletLiveBundle.TryParsePush` + `Apply` swap in under
the run (a new engine loaded from the old one's save), then `Attach` the
new engine and `SetBuild` to re-hello. The socket runs on a worker thread,
nothing in it throws into the game, and a missing editor is a silent no-op;
wire it behind `#if UNITY_EDITOR || DEVELOPMENT_BUILD` all the same, as the
demo does. The shared fixture `packages/conformance/live-link/` holds the
frames it must send; the TestHost replays it.

## The demo project

`../StoryletEngineDemo` is a ready-to-open Unity project sitting beside this
package: open it and press **Play**. Nothing to install and no sample to
import, because its `Packages/manifest.json` points straight back here
(`"com.storylet-studio.storyletengine": "file:../../StoryletEngine"`).

It runs the **Board demo**: the Hamlet bundle (`the-hamlet.storyletsc`,
exported from the repo's `examples/the-hamlet.storylets`) dealt onto a board
you can play. Every hand is a labelled group, every dealt card a button, every
outcome beneath its card, with a transcript of each deal, play and turn. It
registers the engine with `StoryletDebug` so the state window can watch it,
and the same Board demo ships for Godot, Unreal and JavaScript, beat for beat.
See [its README](../StoryletEngineDemo/README.md).

The transliteration discipline: the C# sources keep the file split and member
names of the TS reference runtime (`packages/runtime`, `packages/dialect`,
`packages/model`, and the expr monorepo's `expr` / `expr-specificity` /
`scoperegistry`), so a TS diff maps mechanically onto the port.

## Verifying the port (the TestHost)

`../TestHost` is a plain dotnet console (never ships) that compiles these
Runtime sources directly and replays the whole conformance corpus:

```sh
dotnet run --project ports/unity/TestHost
```

It loads `packages/conformance/corpus.json`, runs the four case families
(expressions, specificity, peek, scripted) exactly as documented in
`packages/conformance/src/runner.ts`, replays the Live Link fixture
(`packages/conformance/live-link/`) through `StoryletLiveLink` over a fake
socket and compares the frames byte for byte, prints a per-family summary
and exits non-zero on any divergence from the reference expectations.
`dotnet run --project ports/unity/TestHost -- --live-link-connect` runs the
same script over a real socket against a listening Storyletter, for a
pairing check by hand.

The TestHost is the RUNTIME's gate and runs in CI (`.github/workflows/ports.yml`),
because it is pure C# and needs no editor. It cannot compile the **demo**, which
talks to UnityEngine - and the demo is where the 2026-08-29 audit found three
`CS1503` errors that had made the scene unable to enter Play mode. So:

```sh
npm run check:unity-demo
```

compiles the demo scripts headlessly with the Unity you already have, and fails
on the first `error CS`. No licence secret is involved: an installed, activated
editor compiles from the command line. (The `UNITY_LICENSE` secret in the CI
workflow is only for a GitHub-HOSTED runner, which has no Unity on it at all.)

## Licence

MIT (see LICENSE).
