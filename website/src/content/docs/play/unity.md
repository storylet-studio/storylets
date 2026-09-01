---
title: Unity
description: Play a .storyletsc bundle in Unity with the native C# Storylet Engine runtime. Download the package zip, drop it into Packages/, import a bundle, build an engine, open a flow, deal, play, save, and watch live state in the Runtime State window.
sidebar:
  label: Unity
---

<div class="sy-badge">
  <img src="/plugin-unity.svg" alt="" width="56" height="56" />
  <p>The native C# runtime. No web view, no JavaScript, no IPC: it loads a <code>.storyletsc</code> bundle and deals from it directly, held to the same <a href="/compatibility/">shared test suite</a> as every other engine.</p>
</div>

> Needs Unity 2021.3 or later, and `com.unity.nuget.newtonsoft-json` (MIT), which the
> package declares as a dependency. Some C# is expected: this is the game-developer side.

## Install

Download the Unity zip from the [download page](/download/). It holds two folders side by
side: **`StoryletEngine/`**, the package (`com.storylet-studio.storyletengine`), and
**`StoryletEngineDemo/`**, a ready-to-open demo project that finds the package in the sibling
folder.

Install the package **as a package**, any of:

- **From disk**: *Package Manager ▸ Install package from disk…* and pick
  `StoryletEngine/package.json`.
- **Embedded**: copy `StoryletEngine/` into your project's `Packages/` folder with your file
  browser.
- **By path**: point your `Packages/manifest.json` at the folder
  (`"com.storylet-studio.storyletengine": "file:../path/to/StoryletEngine"`).

Don't drag the folder into the Unity **Project window**: Unity imports it into `Assets/` as
loose scripts, the package manifest is ignored and the Newtonsoft dependency never installs.

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

The engine is the world; every play call lives on a **flow** - one playthrough - opened by
name. A single-player game opens `"main"` and never thinks about it again; several flows run
parallel playthroughs over the same shared state ([the sharing rules](/play/world-state/)).
`Bundle.CreateEngine(seed)` is the one-line form. The same seed always deals the same cards.
`Log = true` keeps the event logs so the state window can show them: `flow.Log()` is that
flow's own and `engine.Log()` is the RUN's, every flow's events in one order with each entry
naming its `Flow` (capped at 1000
entries; `LogCap` sets your own).

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

A `DealtCard` carries `Id`, `GameId`, `Title`, `Purpose` and the card's fields; render it in
your own UI. `Play` throws before changing anything if the outcome is gated shut or the card
isn't in that hand.

## Your game's state

```csharp
_flow.SetProperty("world.time_of_day", StoryletValue.Str("night"));   // write before you deal
StoryletValue gold = _flow.GetProperty("world.gold");
List<PropertyRow> rows = _flow.ListProperties();

_flow.AdvanceTurns("village", 1);
double turn = _flow.Turn("village");
List<BoxView> boxes = _flow.ListBoxes();      // id, gameId, title, turn
```

The paths, and when to write them: [Your game's state](/play/world-state/).

## Save and load

```csharp
SaveEnvelope env = _engine.SaveGame();
_engine.LoadGame(env);                    // rebuilds every flow...
_flow = _engine.GetFlow("main");          // ...so re-take your handles
```

For files, `StoryletSave` is the string boundary: `SerializeState(engine, worldValues)` gives
you the `.storyletsave` text, `LoadState(engine, text)` reads one back and hands you the
file's `@world` values to apply
([why the engine never saves them](/play/world-state/#saving-it)). A foreign or malformed
blob throws, so a bad file can't corrupt a run.

## The Runtime State window

**Window ▸ Storylet Engine ▸ Runtime State** lists every engine registered with
`StoryletDebug`, with **Save State… / Load State…** (the whole run as a `.storyletsave` file)
under its name, then a section per open flow. One registration covers every flow: the window
reads them off the engine, so a flow you open later appears on its own. Per flow:

- **Properties**: one row per declared property, with type-aware editors (toggle, number,
  text, enum popup, flags) and a per-row Reset. Values refresh a few times a second, and the
  field you're typing in keeps what you've typed.
- The per-box **turn clocks** and the current **board**.
- **The log**: that flow's retained event log with per-kind filters, Autoscroll, Copy and
  Clear. The **run log**, every flow's events in one order, sits under the engine's name
  above the flow sections.

It's an editor window, so it never ships in a player build.

## The bundle inspector

Select an imported bundle asset and its Inspector shows what the bundle offers your code:
hands, boxes, tags, declared properties. Nothing running needed. See
[the bundle inspector](/play/dev-tools/#the-bundle-inspector).

## Live Link to Storyletter

`StoryletLiveLink` connects a running game to Storyletter: the editor's Board shows your game's
run, and saving in the editor pushes the new bundle into the game without a restart. Wire it
behind `#if UNITY_EDITOR || DEVELOPMENT_BUILD`; a release build strips it. The wiring, and what
the link carries: [Live Link](/play/live-link/#wire-the-client).

## The demo project

Open `StoryletEngineDemo/` from the zip and press **Play**: nothing to install and no sample
to import, because its `Packages/manifest.json` points at the sibling package folder. It runs
the **Board demo** over the Hamlet bundle: every hand a labelled group, every dealt card a
button, every outcome beneath its card, with a transcript of each deal, play and turn. Open
the Runtime State window beside it to watch the run live.

The smallest part to read first is `Start()` plus `DealAllHands()` in `Assets/Demo/BoardDemo.cs`:
load the bundle, build an engine, open a flow, deal, read `Board()`. Everything else in that file is UI.

## How it's built

The package is four assemblies, so the boundaries are enforced by the compiler:
`StoryletEngine.Runtime` (pure C#, no `UnityEngine`, no JSON library: the engine, the flow and
everything under it), `StoryletEngine.Runtime.Json` (the Newtonsoft layer: `BundleLoader` and
`StoryletSave`), `StoryletEngine.Runtime.Unity` (`StoryletBundleAsset` and `StoryletDebug`)
and `StoryletEngine.Editor` (the importer, the bundle inspector and the state window). The
C# keeps the structure of the JavaScript reference runtime, so the two stay in step.

## Next

- What every runtime shares: [Dev tools](/play/dev-tools/).
- Why it matches the other engines exactly:
  [Compatibility & conformance](/compatibility/).
