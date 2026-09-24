---
title: Unreal
description: Play a .storyletsc bundle in Unreal Engine with the native C++ plugin, from installing it to driving a flow from C++ or Blueprint and saving.
sidebar:
  label: Unreal
---

<p><img class="sy-engine" src="/plugin-unreal.svg" alt="" width="48" height="48" />The native C++ runtime, wrapped in a Blueprint- and C++-friendly plugin. It loads a <code>.storyletsc</code> bundle and deals from it directly, held to the same <a href="/compatibility/">shared test suite</a> as every other engine.</p>

> Built and verified against Unreal Engine 5.7, for editor and game targets. The plugin ships
> source-only, so your project needs a C++ toolchain even if you drive it from Blueprint.

## Install

Download the Unreal zip from the [download page](/download/). It holds two folders side by
side. **`StoryletEngine/`** is the plugin, and **`StoryletEngineDemo/`** is a ready-to-open
sample project that finds the plugin in the sibling folder.

To try it first, open `StoryletEngineDemo/StoryletEngineDemo.uproject` where it sits and
confirm the build prompt. There's nothing to copy. To use it in your game, copy
`StoryletEngine/` into your project's `Plugins/` folder, restart the editor, and enable it.
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

The **engine** owns the bundle, the shared state, and `@world`. A **flow** is one playthrough
across it, and all the dealing and playing happens on a flow, so a single-player game opens
one, calls it what it likes, and never thinks about it again. The same seed always deals the
same cards. `bRetainLog` keeps the event logs so the state panel, or a Blueprint polling
`Log()`, can read them. There are two. `Flow->Log()` is that flow's own, and
`Engine->GetRunLog()` is the RUN's, every flow's events in one order with each entry naming
its `Flow`. The run log is the only place a story action in another flow moving shared state
is visible.

Open as many flows as you have parallel plays. `OpenFlow` / `GetFlow` / `Flows` / `CloseFlow`
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
designer can deal and play from a widget without C++. An `FStoryletOutcomeView` carries the
outcome's own `Fields` as `FStoryletDealtCard` carries the card's, when the box declares
outcome fields. `BoardForBox(BoxRef)` sits beside
`Board()` and `PlayAdvancing` beside `Play` because Blueprint pins take no optional arguments.
`Play` returns false and fills `Error` if the outcome is gated shut or the card isn't in that
hand. Nothing changes in that case. A card with no outcomes is played with an empty
`OutcomeGameId`.

## Your game's state

Give the engine your `@world` values in a `UStoryletWorld` when you create it. The engine
reads them through it before every deal, outcomes write back into it, and anything else you
bind to the same object sees the same values:

```cpp
UStoryletWorld* World = NewObject<UStoryletWorld>(this);
World->SetString(TEXT("time_of_day"), TEXT("night"));
World->SetReadOnly(TEXT("time_of_day"), true);   // yours alone: a story write is refused
UStoryletEngine* Engine = UStoryletEngine::Create(Bundle, 0, false, World);

bool Known = World->GetBool(TEXT("knows_road"));   // what the story has told you
World->OnChanged.AddDynamic(this, &AMyGame::OnWorldChanged);   // (Name, Value, bFromStory)
```

`SetReadOnly` is your policy. A story write to that name makes `Play` return false with
`@world.x is the game's alone`. It is distinct from `writable: false` on the property's
declaration, which is the story's own promise, checked when the project compiles and refused
by every runtime. Your own `Set*` calls and a load are never refused by either. Your game keeps
a bound world's values, so the engine never saves them. Leave the world out and the engine
self-backs `@world` from the declared defaults, written through the path accessors below, and
saves it with everything else.

The other properties cross the Blueprint boundary through typed accessors, path-addressed:

```cpp
Flow->SetPropertyNumber(TEXT("story.gold"), 5);
double Gold = Flow->GetPropertyNumber(TEXT("story.gold"));
// Also GetPropertyBool / GetPropertyString / GetPropertyFlags and their setters.

Flow->AdvanceTurns(TEXT("village"), 1);
double Turn = Flow->GetTurn(TEXT("village"));
TArray<FStoryletBoxView> Boxes = Flow->ListBoxes();
```

`ListProperties()` returns one row per declared property with its type, value, default, and
enum options. The paths, and when to write them, are on [Your game's state](/play/world-state/).

## One registry per game

Every property value lives in a **registry**, a `storylets::ScopeRegistry`, one per game. An
engine you build with `Create` makes its own registry and acts as its own game, so a game with
one engine never has to think about it. A game running more than one engine,
[Patter](/play/with-patter/) say, makes one registry, registers `@world` in it, and hands it to
each engine. From C++:

```cpp
#include "Storylets/Kernel.h"   // storylets::ScopeRegistry: the shared kernel's

// Your @world declarations: a std::vector<storylets::ScopeDeclaration>.
auto Registry = std::make_shared<storylets::ScopeRegistry>();
storylets::OwnedScopeOptions Options;
Options.owner = std::string("Game");
Registry->defineOwned("world", WorldDeclarations, Options);   // stored and saved with the rest

UStoryletEngine* Engine = UStoryletEngine::CreateWithRegistry(Bundle, Registry, /*Seed=*/7);
```

`CreateWithRegistry` is C++ only: the registry is a standard C++ object shared by pointer, and
no Blueprint pin carries one. On the engine core, the same option is `EngineOptions::registry`.

`storylets::ScopeRegistry` is the shared expression kernel's `wildwinter::expr::ScopeRegistry`,
and Patterplay's plugin carries the same kernel, byte for byte: in a game with both,
`storylets::ScopeRegistry` and `patter::ScopeRegistry` are one type, so the same registry goes to
`UPatterEngine::CreateWithRegistry`. Build both plugins from the same kernel: their headers are
compiled into your game module, and if one is older, the module that includes both stops at a
compile error that says so, so update the older plugin. The module that makes the registry
sets `bEnableExceptions = true` in its `Build.cs`, since the registry refuses by throwing; one
that only calls `UStoryletEngine` does not. The engine reports its refusals as it always has, as
`storylets::StoryletError` (an expression's as `storylets::EvalError`); a call you make on the
registry yourself throws the kernel's `wildwinter::expr::RegistryError`.

The engine registers `@story` under `story`, and every other bag that declares something under
a key starting `storylets/`, which no expression can name. Given your registry, it registers
nothing for `@world`: that's yours. `defineOwned` has the registry store and save it, and
`defineForeign("world", Resolver, &Declarations, Options)` keeps it in your game, where nothing
saves it. Passing a `UStoryletWorld` to `CreateWithRegistry` registers that world in your
registry for you.

Every expression reads every scope in the registry, and `GetPropertyNumber(TEXT("patter.gold"))`
and its setters reach another engine's values from your code. A card can name Patter's
game-wide scope directly, with no setting in either project: gate on `@patter.visits`, or change
`@patter.gold` in an outcome, which writes it through your registry under Patter's rules. Only
Patter's shared values are visible this way. If a project names `@patter` and no Patter engine
is on the Storylet Engine's registry, it refuses the content before anything changes: `OpenFlow`
returns null and `UStoryletSave::LoadStateFromJson` returns false, each logging `this content
names @patter, which no engine on this registry registered: give every engine the game's one
registry` as an error. So build every engine on the game's one registry before opening a flow or
loading a save. If Patter's engine goes away mid-game, an outcome writing `@patter` fails naming
the scope.

A token is taken once: an engine that wants a token another already holds is refused as it is
built, `CreateWithRegistry` returns null and logs who holds it, and the registry is left as it
was. When a `UStoryletEngine` goes away, its values leave the registry with it.
`ApplyLiveBundle` works on your registry as on the engine's own: the new engine core carries the
run across, a property the edit dropped leaves the registry, and nothing another engine keeps
there is touched. From C++, the core's `hotSwap(Bundle)` does the same and hands back the load
report too. The replacement keeps the options the engine was built with; to change one, pass a
callback that edits a copy of them, `hotSwap(Bundle, [](storylets::EngineOptions& O) { O.log = true; })`,
and everything it does not touch stays as it was.

## Save and load

`UStoryletSave::SaveStateToJson(Engine)` and `LoadStateFromJson(Engine, Json)` are the
`.storyletsave` string boundary, in the runtime module and Blueprint-callable (the shape of
Patterplay's `UPatterSave`). The file carries the engine's envelope, `storylets/save@2`, with
every live flow inside it, plus the current `@world` values, and a load applies all of it. The
envelope holds what isn't a property: boards, clocks, cooldowns, random streams, play logs, and
spent cards. An engine made with `Create` also carries its registry's values in the envelope, a
self-backed `@world` included, so a round trip preserves the whole run. With a `UStoryletWorld`
bound, the load restores its values as you would, so your read-only names are restored too
([why a world you keep rides beside the envelope](/play/world-state/#saving-it)). A
foreign or malformed blob returns false and leaves the engine untouched. Flow objects your
game is already holding survive the load: they re-bind by name, so a Blueprint variable
pointing at a flow keeps working. Files saved as `storylets/save@1`, before the registry held
the values, still load: their values move into the registry as they do.

An engine on your registry leaves the property values out of its envelope. Your game saves the
registry once, beside each engine's file, and loads it before or after the engines, in either
order:

```cpp
#include "Storylets/Save.h"

const std::string RegistryText = storylets::saveRegistry(*Registry);   // every property, once
const FString StoryletsText = UStoryletSave::SaveStateToJson(Engine);  // everything else

// Loading, into a freshly made registry and engine:
storylets::loadRegistry(*Registry, RegistryText);
UStoryletSave::LoadStateFromJson(Engine, StoryletsText);
UStoryletFlow* Flow = Engine->GetFlow(TEXT("main"));
```

A value for a flow that hasn't been restored yet waits in the registry until the flow claims
it. A flow you open fresh with `OpenFlow` never picks up a value a load left for its name, and
`Reset()` drops only the Storylet Engine's waiting values, never another engine's.

A load is forgiving. A card your edit deleted drops off the board, a property you added takes
its default, and a save from an older build goes in without a word.
`UStoryletSave::PreviewLoadFromJson(Engine, Json)` says what that would cost before you spend
it, and changes nothing. It hands back a report as a JSON string (`exact`, `evicted`,
`droppedProperties`, `defaultedProperties`, `retypedProperties`, and the `version` / `hash`
pairs), because no report struct crosses a Blueprint pin.

To park ONE playthrough rather than the whole run, `SaveFlowToJson(Id)` on the engine takes
that flow's state, its property values included, and `OpenFlowFromJson(Id, Json)` puts it
back. `CloseFlow` in between is what releases the cards it was holding and takes its values out
of the registry, and `PreviewFlowRestoreJson(Id, Json)` says what coming back would cost.

## The Runtime State panel

**Window ▸ Storylet Engine Runtime State** opens the examiner. Register an engine with
`RegisterForDebug("label")` (or `FStoryletDebug::Register` from C++) and the panel shows it
live: the shared properties with type-aware editors behind a search filter and per-row
reset-to-default and the **run log** (every flow's events in one order), then each open flow
with its own properties, per-box turns, board, and retained log, each log behind per-kind
filters, Autoscroll, Copy, and Clear, and **Save State… / Load State…** buttons. It refreshes a few
times a second, attaches and detaches across PIE on its own, and lives in the plugin's editor
module, so it never ships in a packaged game. The registry it reads compiles to no-ops in
Shipping builds.

## Live Link

`FStoryletLiveLink::Create(Bundle->GetBuildId(), TEXT("My Game"))` then `Link->Attach(Engine)`
joins the running game to Storyletter. The editor's Board shows the game's run, and a save in
the editor pushes the new bundle into it, applied in place by `ApplyLiveBundle`, whether the
engine made its own registry or shares yours with Patter. It compiles to no-ops in a Shipping
build. The wiring, and what carries across, are on
[Live Link](/play/live-link/).

## The bundle inspector

Select a `UStoryletBundle` and its Details panel shows what the bundle offers your code:
hands, boxes, tags, declared properties. Nothing running needed. `UStoryletBundle::DescribeBundle()`
is Blueprint-callable too. See [the bundle inspector](/play/dev-tools/#the-bundle-inspector).

## The demo project

Open `StoryletEngineDemo.uproject` and press **Play**. The project's game mode puts the
**Board demo** on screen. It loads the Hamlet bundle from disk, deals every hand, and gives
you a board you can play with the mouse, with a transcript of every action. Open the Runtime
State panel beside it to watch the run live. The smallest part to read first is
`CreateBoardSession()` plus `OnDealAllHandsClicked()` in `UStoryletBoardDemoWidget`, and the
rest is UI.

**The Hamlet on Unreal** is the second demo, the same project with [Patter](https://patterkit.dev)
performing each card's dialogue, two engines in one game. It ships as a project zip on the
[download page](/download/#the-hamlet-two-engines-in-one-game); `Source/HamletDemo/Private/HamletGame.cpp` is the whole
integration, and [Running it with Patter](/play/with-patter/) explains the handoff.

## How it's built

The plugin is two layers. `Source/StoryletEngineRuntime/Public/Storylets/` is the engine core,
header-only standard C++17 with no Unreal types in it, keeping the structure of the JavaScript
reference runtime. Everything else is the Unreal wrapper: `UStoryletBundle`, `UStoryletEngine`,
`UStoryletFlow`, `UStoryletSave`, the Blueprint structs, the factory, and the editor panel. Exceptions from the core are caught
at that boundary and surfaced as error strings and logs, so Blueprint never sees one.

Four things stay C++ only: `SubscribeTrace` (Blueprint polls `Log()` instead), the generic
value type (Blueprint uses the typed accessors above), `ListBags`, and the registry
(`CreateWithRegistry` and `GetRegistry`). Numbers cross the boundary as `double`.

## Next

- [Dev tools](/play/dev-tools/) covers what every runtime shares.
- [Compatibility & conformance](/compatibility/) explains why it matches the other engines
  exactly.
