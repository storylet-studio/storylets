---
title: Unreal
description: Play a .storyletsc bundle in Unreal Engine with the native C++ Storylet Engine plugin. Download the zip, drop it into Plugins/, import a bundle, drive a flow from C++ or Blueprint, save, and watch live state in the Runtime State panel.
sidebar:
  label: Unreal
---

<div class="sy-badge">
  <img src="/plugin-unreal.svg" alt="" width="56" height="56" />
  <p>The native C++ runtime, wrapped in a Blueprint- and C++-friendly plugin. It loads a <code>.storyletsc</code> bundle and deals from it directly, held to the same <a href="/compatibility/">shared test suite</a> as every other engine.</p>
</div>

> Built and verified against Unreal Engine 5.7, for editor and game targets. The plugin ships
> source-only, so your project needs a C++ toolchain even if you drive it from Blueprint.

## Install

Download the Unreal zip from the [download page](/download/). It holds two folders side by
side: **`StoryletEngine/`**, the plugin, and **`StoryletEngineDemo/`**, a ready-to-open
sample project that finds the plugin in the sibling folder.

To try it first, open `StoryletEngineDemo/StoryletEngineDemo.uproject` where it sits and
confirm the build prompt; there's nothing to copy. To use it in your game, copy
`StoryletEngine/` into your project's `Plugins/` folder, restart the editor and enable it.
The engine core is header-only standard C++, so it compiles inside your project with no extra
dependencies.

## Import a bundle

Drag a `.storyletsc` into the Content Browser. The plugin's factory builds a
**`UStoryletBundle`** asset holding the raw JSON, compiled when it loads. A broken bundle
still imports, with the error readable on the asset as `LoadError`. Right-click ▸ Reimport
refreshes it from the source file.

For DLC or downloaded content, `UStoryletBundle::LoadFromJsonString` (Blueprint-callable)
compiles a bundle from a string at runtime.

## Create an engine and a flow

```cpp
UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, /*Seed=*/7, /*bRetainLog=*/true);
UStoryletFlow*   Flow   = Engine->OpenFlow(TEXT("main"));
Engine->RegisterForDebug(TEXT("main"));   // optional: lets the state panel watch it
```

The **engine** owns the bundle, the shared state and `@world`. A **flow** is one playthrough
across it, and all the dealing and playing happens on a flow, so a single-player game opens
one, calls it what it likes, and never thinks about it again. The same seed always deals the
same cards; `bRetainLog` keeps the event logs so the state panel, or a Blueprint polling
`Log()`, can read them. There are two: `Flow->Log()` is that flow's own, and
`Engine->GetRunLog()` is the RUN's, every flow's events in one order with each entry naming
its `Flow` - which is the only place a story action in another flow moving shared state is
visible.

Open as many flows as you have parallel plays: `OpenFlow` / `GetFlow` / `Flows` / `CloseFlow`
are all Blueprint-callable, and re-opening a name replaces that flow with a fresh one. What
each flow gets its own copy of, and what they all share, is
[Your game's state](/play/world-state/). This is the same shape as Patterplay's
`UPatterEngine` / `UPatterFlow`, so a project running both reads the same way.

## Deal, peek, outcomes, play

```cpp
const TArray<FStoryletHandContents> Dealt = Flow->DealAllHands();   // every hand
const TArray<FStoryletDealtCard> Inn = Flow->Deal(TEXT("the-inn")); // one hand

for (const FStoryletHandContents& Hand : Flow->Board())             // what's out right now
    for (const FStoryletDealtCard& Card : Hand.Cards)
        for (const FStoryletOutcomeView& Outcome : Flow->Outcomes(Card.GameId, Hand.Hand))
            if (Outcome.bAvailable) { /* offer it */ }

TMap<FString, FString> Criteria;                                       // look, don't deal
Criteria.Add(TEXT("area"), TEXT("forest"));
const TArray<FStoryletDealtCard> Looks = Flow->Peek(TEXT("village"), Criteria, 3);

FString Error;
if (!Flow->Play(CardGameId, OutcomeGameId, HandGameId, Error)) { /* Error says why */ }
```

Everything above is **Blueprint-callable**, with every view converted to a Blueprint struct
(`FStoryletDealtCard`, `FStoryletOutcomeView`, `FStoryletBoxView`, `FStoryletHandContents`), so a
designer can deal and play from a widget without C++. `BoardForBox(BoxRef)` sits beside
`Board()` and `PlayAdvancing` beside `Play` because Blueprint pins take no optional arguments.
`Play` returns false and fills `Error` if the outcome is gated shut or the card isn't in that
hand; nothing changes in that case.

## Your game's state

Properties cross the Blueprint boundary through typed accessors, path-addressed:

```cpp
Flow->SetPropertyString(TEXT("world.time_of_day"), TEXT("night"));   // write before you deal
double Gold = Flow->GetPropertyNumber(TEXT("world.gold"));
// Also GetPropertyBool / GetPropertyFlags and their setters.

Flow->AdvanceTurns(TEXT("village"), 1);
double Turn = Flow->GetTurn(TEXT("village"));
TArray<FStoryletBoxView> Boxes = Flow->ListBoxes();
```

`ListProperties()` returns one row per declared property with its type, value, default and
enum options. The paths, and when to write them: [Your game's state](/play/world-state/).

## Save and load

`UStoryletSave::SaveStateToJson(Engine)` and `LoadStateFromJson(Engine, Json)` are the
`.storyletsave` string boundary, in the runtime module and Blueprint-callable (the shape of
Patterplay's `UPatterSave`). The file carries the engine's envelope, every live flow inside
it, plus the current `@world` values, and a load applies all of it, so a round trip preserves
the whole run ([why `@world` rides beside the envelope](/play/world-state/#saving-it)). A
foreign or malformed blob returns false and leaves the engine untouched. Flow objects your
game is already holding survive the load: they re-bind by name, so a Blueprint variable
pointing at a flow keeps working.

## The Runtime State panel

**Window ▸ Storylet Engine Runtime State** opens the examiner. Register an engine with
`RegisterForDebug("label")` (or `FStoryletDebug::Register` from C++) and the panel shows it
live: the shared properties with type-aware editors behind a search filter and per-row
reset-to-default and the **run log** (every flow's events in one order), then each open flow
with its own properties, per-box turns, board and retained log, each log behind per-kind
filters,
Autoscroll, Copy and Clear, and **Save State… / Load State…** buttons. It refreshes a few
times a second, attaches and detaches across PIE on its own, and lives in the plugin's editor
module, so it never ships in a packaged game. The registry it reads compiles to no-ops in
Shipping builds.

## Live Link

`FStoryletLiveLink::Create(Bundle->GetBuildId(), TEXT("My Game"))` then `Link->Attach(Engine)`
joins the running game to Storyletter: the editor's Board shows the game's run, and a save in
the editor pushes the new bundle into it, applied in place by `ApplyLiveBundle`. It compiles to
no-ops in a Shipping build. The wiring, and what carries across: [Live Link](/play/live-link/).

## The bundle inspector

Select a `UStoryletBundle` and its Details panel shows what the bundle offers your code:
hands, boxes, tags, declared properties. Nothing running needed. `UStoryletBundle::DescribeBundle()`
is Blueprint-callable too. See [the bundle inspector](/play/dev-tools/#the-bundle-inspector).

## The demo project

Open `StoryletEngineDemo.uproject` and press **Play**. The project's game mode puts the
**Board demo** on screen: it loads the Hamlet bundle from disk, deals every hand, and gives
you a board you can play with the mouse, with a transcript of every action. Open the Runtime
State panel beside it to watch the run live. The smallest part to read first is
`CreateBoardSession()` plus `OnDealAllHandsClicked()` in `UStoryletBoardDemoWidget`; the rest
is UI.

## How it's built

The plugin is two layers. `Source/StoryletEngineRuntime/Public/Storylets/` is the engine core:
header-only standard C++17 with no Unreal types in it, keeping the structure of the JavaScript
reference runtime. Everything else is the Unreal wrapper: `UStoryletBundle`, `UStoryletEngine`,
`UStoryletFlow`, `UStoryletSave`,
the Blueprint structs, the factory and the editor panel. Exceptions from the core are caught
at that boundary and surfaced as error strings and logs, so Blueprint never sees one.

Three things stay C++ only: `SubscribeTrace` (Blueprint polls `Log()` instead), the generic
value type (Blueprint uses the typed accessors above) and `ListBags`. Numbers cross the
boundary as `double`.

## Next

- What every runtime shares: [Dev tools](/play/dev-tools/).
- Why it matches the other engines exactly:
  [Compatibility & conformance](/compatibility/).
