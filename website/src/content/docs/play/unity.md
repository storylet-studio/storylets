---
title: Unity
description: Play a .storyletsc bundle in Unity with the native C# runtime, from installing the package to dealing, saving, and watching live state.
sidebar:
  label: Unity
---

<p><img class="sy-engine" src="/plugin-unity.svg" alt="" width="48" height="48" />The native C# runtime. No web view, no JavaScript, no IPC. It loads a <code>.storyletsc</code> bundle and deals from it directly, held to the same <a href="/compatibility/">shared test suite</a> as every other engine.</p>

> Needs Unity 2021.3 or later, and `com.unity.nuget.newtonsoft-json` (MIT), which the
> package declares as a dependency. Some C# is expected, because this is the game-developer side.

## Install

Download the Unity zip from the [download page](/download/). It holds two folders side by
side. **`StoryletEngine/`** is the package (`com.storylet-studio.storyletengine`), and
**`StoryletEngineDemo/`** is a ready-to-open demo project that finds the package in the
sibling folder.

Install the package **as a package**, any of:

- **From disk**, with *Package Manager ▸ Install package from disk…* and
  `StoryletEngine/package.json`.
- **Embedded**, by copying `StoryletEngine/` into your project's `Packages/` folder with your
  file browser.
- **By path**, pointing your `Packages/manifest.json` at the folder
  (`"com.storylet-studio.storyletengine": "file:../path/to/StoryletEngine"`).

Don't drag the folder into the Unity **Project window**. Unity imports it into `Assets/` as
loose scripts, the package manifest is ignored, and the Newtonsoft dependency never installs.

## Import a bundle

Drop a `.storyletsc` into your project. A ScriptedImporter turns it into a
**`StoryletBundleAsset`**, which holds the raw JSON and rebuilds the compiled bundle on load.
A broken bundle still imports, with the error readable on the asset as `LoadError`, so a bad
file is something you can look at, not something that breaks your project.

## Create an engine and a flow

```csharp
using UnityEngine;
using StoryletStudio.StoryletEngine;

public sealed class StoryRunner : MonoBehaviour
{
    public StoryletBundleAsset Bundle;   // assign the imported asset

    private Engine _engine;
    private Flow _flow;

    void Start()
    {
        _engine = new Engine(Bundle.Bundle, new EngineOptions { Seed = 7, Log = true });
        _flow = _engine.OpenFlow("main");
        StoryletDebug.Register(_engine, "main");   // optional: lets the state window watch it
    }
}
```

The engine is the world. Every play call lives on a **flow** (one playthrough), opened by
name. A single-player game opens `"main"` and never thinks about it again. Several flows run
parallel playthroughs over the same shared state ([the sharing rules](/play/world-state/)).
`Bundle.CreateEngine(seed)` is the one-line form. The same seed always deals the same cards.
`Log = true` keeps the event logs so the state window can show them. `flow.Log()` is that
flow's own, and `engine.Log()` is the RUN's, every flow's events in one order with each entry
naming its `Flow` (capped at 1000 entries, and `LogCap` sets your own).

## Deal, peek, outcomes, play

```csharp
foreach (var pair in _flow.DealMany())      // every hand; what was dealt, keyed by hand
{
    string hand = pair.Key;
    List<DealtCard> cards = pair.Value;
}

List<DealtCard> inn = _flow.Deal("the-inn");                  // one hand
OrderedMap<string, List<DealtCard>> board = _flow.Board();    // what's out right now
OrderedMap<string, List<DealtCard>> barks = _flow.Board("barks");

RankedList looks = _flow.Peek("village",                      // look, don't deal
    new OrderedMap<string, string> { { "area", "forest" } }, 3);

foreach (var o in _flow.Outcomes(card.Id, "the-inn"))         // ask when you show them
    if (o.Available) _flow.Play(card.Id, o.GameId, "the-inn");
```

A `DealtCard` carries `Id`, `GameId`, `Title`, `Purpose`, and the card's fields; render it in
your own UI. An `OutcomeView` carries the same identity, `Available`, and the outcome's own
`Fields` when the box declares outcome fields. `Play` throws before changing anything if the
outcome is gated shut or the card isn't in that hand. A card with no outcomes is played with
`""` as the outcome.

## Your game's state

```csharp
_flow.SetProperty("world.time_of_day", ExprValue.Str("night"));   // write before you deal
ExprValue gold = _flow.GetProperty("world.gold");
List<PropertyRow> rows = _flow.ListProperties();

_flow.AdvanceTurns("village", 1);
double turn = _flow.Turn("village");
List<BoxView> boxes = _flow.ListBoxes();      // id, gameId, title, turn
```

The paths, and when to write them, are on [Your game's state](/play/world-state/). `ExprValue`,
the value type, is in the `Wildwinter.Expr` namespace (`using Wildwinter.Expr;`), with the
registry and the rest of the shared expression kernel.

`@world` is your game's. Hand the engine a resolver, an `IScopeResolver` with `Get`, `CanSet`,
and `Set`, and conditions read your live game state directly:

```csharp
_engine = new Engine(Bundle.Bundle, new EngineOptions { Seed = 7, World = new MyWorld() });
```

Your game keeps those values, so the engine never saves them. Hand it nothing, and the engine
backs `@world` itself from the declared defaults, as a property it saves with the rest.

## One registry per game

Every property value lives in a **registry**, a `ScopeRegistry`, one per game. An engine you
build on its own makes its own registry and acts as its own game, so a game with one engine
never has to think about it. A game running more than one engine, [Patter](/play/with-patter/)
say, makes one registry, registers `@world` in it, and hands it to each engine:

```csharp
var registry = new ScopeRegistry()
    .DefineOwned("world", Bundle.Bundle.World.Properties,
        new OwnedScopeOptions { Owner = "Game" });              // stored and saved with the rest
_engine = new Engine(Bundle.Bundle, new EngineOptions { Seed = 7, Registry = registry });
```

The engine registers `@story` under `story`, and every other bag that declares something under
a key starting `storylets/`, which no expression can name. Given your registry, it registers
nothing for `@world`: that's yours. `DefineOwned` has the registry store and save it;
`DefineForeign("world", resolver, declarations)` keeps it in your game, and nothing saves it.
Passing both `Registry` and `World` registers your resolver in your registry for you.

Every expression reads every scope in the registry, so a card's condition can read
`@patter.gold`, and `GetProperty("patter.gold")` and `SetProperty("patter.gold", value)` reach
another engine's values from your code. A token is taken once: building an engine that wants a
token another already holds throws at once, naming the holder, and leaves the registry as it was.

The registry is one type to every engine because the expression kernel is shared: the
`Wildwinter.Expr` namespace, in its own assembly. Patterplay carries the same kernel, and with
both packages installed it compiles once, in Patterplay's `Patterplay.Expr`; on its own, this
package compiles its copy, `StoryletEngine.Expr`. So beside Patterplay, the Storylet Engine
needs Patterplay 0.14.0 or newer, and stops the compile with an error saying so if it finds an
older one. If your scripts have their own assembly definition, reference `StoryletEngine.Expr`
and `Patterplay.Expr` beside `StoryletEngine.Runtime`: Unity ignores whichever is not installed.
The engine's own errors are still `StoryletError` and `EvalError`; a call you make straight to
the registry throws the kernel's `RegistryError`.

## Save and load

```csharp
SaveEnvelope env = _engine.SaveGame();
LoadReport report = _engine.LoadGame(env);   // rebuilds every flow...
_flow = _engine.GetFlow("main");             // ...so re-take your handles
```

The envelope is `storylets/save@2`. It holds what isn't a property: boards, clocks, cooldowns,
random streams, play logs, and spent cards. An engine built on its own also carries its
registry's values on `env.Registry`, a self-backed `@world` included, so those two lines are the
whole run. A game that passed its own registry saves that once, beside each engine's envelope,
and `env.Registry` is null:

```csharp
JObject registryJson = StoryletSave.SaveRegistry(registry);            // every property, once
JObject storyletsJson = StoryletSave.ToJson(_engine.SaveGame());      // everything else

// Loading, into a freshly built registry and engine, in either order:
StoryletSave.LoadRegistry(registry, registryJson);
_engine.LoadGame(StoryletSave.FromJson(storyletsJson));
_flow = _engine.GetFlow("main");
```

A value for a flow that hasn't been restored yet waits in the registry until the flow claims it.
A flow you open fresh with `OpenFlow` never picks up a value a load left for its name, and
`Reset()` drops only the Storylet Engine's waiting values, never another engine's. Envelopes
saved as `storylets/save@1`, before the registry held the values, still load: their values move
into the registry as they do.

A load is forgiving. A card your edit deleted drops off the board, a property you added takes
its default, and a save from an older build goes in without a word. `PreviewLoad(env)` says
what that would cost before you spend it and changes nothing. `LoadGame` returns the same
`LoadReport` once it has. `report.Exact` is true when the save goes back exactly as it was;
otherwise `Evicted`, `DroppedProperties`, `DefaultedProperties`, `RetypedProperties`, and the
`Version` / `Hash` pairs say what moved.

`SaveFlow(id)` takes ONE flow's state, its property values included, for a playthrough
stepping away, and `OpenFlow(id, new OpenFlowOptions { Restore = saved })` puts it back. Closing
the flow in between is what releases the cards it was holding, and takes its values out of the
registry. On the way back, a shared card another flow
now holds is dropped and reported (`PreviewFlowRestore(id, saved)` asks in advance).

For files, `StoryletSave` is the string boundary. `SerializeState(engine, worldValues)` gives
you the `.storyletsave` text, and `DeserializeState(engine, text)` reads one back, either
envelope version, and hands you the file's values for a `@world` you bind to apply
([why the engine never saves those](/play/world-state/#saving-it)). A foreign or malformed
blob throws, so a bad file can't corrupt a run.

## The Runtime State window

**Window ▸ Storylet Engine ▸ Runtime State** lists every engine registered with
`StoryletDebug`, with **Save State… / Load State…** (the whole run as a `.storyletsave` file)
under its name, then a section per open flow. One registration covers every flow. The window
reads them off the engine, so a flow you open later appears on its own.

Each flow's section starts with **Properties**, one row per declared property, with
type-aware editors (toggle, number, text, enum popup, flags) and a per-row Reset. Values
refresh a few times a second, and the field you're typing in keeps what you've typed. The
per-box **turn clocks** and the current **board** come next. **The log** is that flow's
retained event log, with per-kind filters, Autoscroll, Copy, and Clear. The **run log**
(every flow's events in one order) sits under the engine's name, above the flow sections.

It's an editor window, so it never ships in a player build.

## The bundle inspector

Select an imported bundle asset and its Inspector shows what the bundle offers your code:
hands, boxes, tags, declared properties. Nothing running needed. See
[the bundle inspector](/play/dev-tools/#the-bundle-inspector).

## Live Link to Storyletter

`StoryletLiveLink` connects a running game to Storyletter. The editor's Board shows your game's
run, and saving in the editor pushes the new bundle into the game without a restart. Wire it
behind `#if UNITY_EDITOR || DEVELOPMENT_BUILD`, and a release build strips it. The wiring, and
what the link carries, are on [Live Link](/play/live-link/#wire-the-client).

## The demo project

Open `StoryletEngineDemo/` from the zip and press **Play**. There's nothing to install and no
sample to import, because its `Packages/manifest.json` points at the sibling package folder.
It runs the **Board demo** over the Hamlet bundle: every hand a labelled group, every dealt
card a button, every outcome beneath its card, with a transcript of each deal, play, and turn. Open
the Runtime State window beside it to watch the run live.

The smallest part to read first is `Start()` plus `DealAllHands()` in `Assets/Demo/BoardDemo.cs`:
load the bundle, build an engine, open a flow, deal, read `Board()`. Everything else in that file is UI.

**The Hamlet on Unity** is the second demo, the same project with [Patter](https://patterkit.dev)
performing each card's dialogue, two engines in one game. It ships as a project zip on the
[download page](/download/#the-hamlet-two-engines-in-one-game); `Assets/Hamlet/HamletGame.cs` is the whole
integration, and [Running it with Patter](/play/with-patter/) explains the handoff.

## How it's built

The package is four assemblies, so the boundaries are enforced by the compiler.
`StoryletEngine.Runtime` is pure C#, with no `UnityEngine` and no JSON library (the engine, the
flow, and everything under it). `StoryletEngine.Runtime.Json` is the Newtonsoft layer
(`BundleLoader` and `StoryletSave`). `StoryletEngine.Runtime.Unity` holds `StoryletBundleAsset`
and `StoryletDebug`, and `StoryletEngine.Editor` holds the importer, the bundle inspector, and
the state window. The C# keeps the structure of the JavaScript reference runtime, so the two
stay in step.

## Next

- [Dev tools](/play/dev-tools/) covers what every runtime shares.
- [Compatibility & conformance](/compatibility/) explains why it matches the other engines
  exactly.
