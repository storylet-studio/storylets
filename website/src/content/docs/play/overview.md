---
title: Playing in your game
description: Storylet Engine is the runtime family that plays a compiled .storyletsc bundle in your game, one native runtime per engine (JavaScript, Unity, Unreal, Godot), all checked against the same shared test suite. Pick your engine and go.
sidebar:
  label: Overview
---

**Storylet Engine** is how your designers' cards reach the player. You publish the project to
one `.storyletsc` [bundle](/format/bundle/), drop it into your engine, and a Storylet Engine
runtime loads it and deals from it: your game asks for a hand, gets back ranked cards, shows
them however it likes, and plays the outcome the player picks.

There's **one runtime per engine**: the JavaScript reference runtime and native ports for
Unity, Unreal and Godot. Every one is checked against the same [test suite](/compatibility/),
so the same bundle deals the same cards everywhere, right down to the random draws. All four
ship today.

## Pick your engine

| Engine | Language | What you get | Quickstart |
|---|---|---|---|
| **JavaScript / Web** | TS/JS | A release zip with the runtime build, the play-helpers build and a browser drop-in | [JavaScript →](/play/javascript/) |
| **Unity** | C# | A package folder for `Packages/`, with a `.storyletsc` importer, the Runtime State window and a demo project | [Unity →](/play/unity/) |
| **Unreal** | C++ / Blueprint | A source plugin for `Plugins/`, with a `.storyletsc` factory, an editor state panel and a demo project | [Unreal →](/play/unreal/) |
| **Godot** | GDScript | An addon for `addons/`, with a `.storyletsc` importer, an in-game state panel and a demo scene | [Godot →](/play/godot/) |

Every runtime is a zip on [GitHub Releases](https://github.com/storylet-studio/storylets/releases),
linked from the [download page](/download/). Nothing is published to npm, UPM, Fab or the
Godot Asset Library: each zip carries everything it needs, including its licence, so no package
manager is assumed.

## The shape of an integration

It's the same five steps in all four engines. Learn them once here and each engine page is
mostly install notes and the local spelling.

1. **Load a bundle.** Every engine imports `.storyletsc` files as assets. A broken bundle
   still imports, with the error readable on the asset.
2. **Create an engine** over the bundle, with a seed, and **open a flow** on it by name.
3. **Deal a hand** by name, or **peek** at a box by tag. You get back ranked card views: an
   id, a gameId, a title and purpose (unless the bundle was stripped), and the card's fields.
4. **Read the card's fields** and do whatever your game does with them: play a scene, run an
   animation, put text on screen.
5. **Ask for the outcomes**, offer the available ones, and **play** the one the player picks.
   State writes, the cooldown starts, the clock advances.

Then save and load the whole run through one call.

All of this happens on a **flow** - one playthrough over the engine's world. You open one by
name (`"main"` is the usual name for a single-player game) and every play call lives on it.
One engine can run several flows at once - parallel personal playthroughs over the same
shared state, which is what an interactive experience with many participants needs - but a
game that wants one playthrough just opens one flow and never thinks about it again.

## Your game's state

Before you deal, there's one thing to wire up: **`@world`**, the properties your game owns and
the story's conditions read. It works the same way in all four runtimes, so it has
[a page of its own](/play/world-state/). Read it before you pick an engine.

## The API, in one table

Names follow each language's idiom, but the surface is the same everywhere.

On the **engine** (the world):

| Call | Does |
|---|---|
| `new Engine(bundle, { seed, log, world })` | Build the engine; `world` binds your game's `@world` resolver |
| `openFlow(id, { seed, restore })` | Open (or replace) a named flow - all play happens on the flow it returns; `restore` opens it as it was |
| `getFlow(id)` / `flows()` / `closeFlow(id)` | Find, list and close flows; a closed flow's handle refuses every call |
| `reset()` | Close every flow and reseed shared state |
| `saveGame()` / `loadGame(envelope)` | The whole run - shared state plus every flow - in and out; the load returns a report |
| `saveFlow(id)` | One flow's state on its own, to park a playthrough that is stepping away |
| `previewLoad(envelope)` / `previewFlowRestore(id, save)` | What that load would change, without changing it |
| `getProperty(path)` / `setProperty(path, value)` | Shared state and `@world` only; a per-flow path is refused |
| `subscribeTrace(handler)` | Every flow's events, one stream, tagged with the flow id |
| `log()` / `clearLog()` | The RUN's retained log, if you asked for one: every flow's entries in one order, each naming its flow |
| `listProperties()` / `listBags()` | Every shared property, and the shared bags behind them |
| `sharedClaims()` | How many copies of each card the world's flows are holding (shared scarcity) |

On a **flow** (one playthrough):

| Call | Does |
|---|---|
| `peek(box, criteria, n)` | Look at the top of a box through tag criteria, without dealing anything |
| `deal(hand)` | Refresh one hand; returns its new contents. A refresh evicts cards no longer eligible and fills empty slots; a card that is still eligible stays dealt, so a newly eligible card waits for an empty slot |
| `dealMany(hands?)` | Refresh several or all hands, same rule; returns what was dealt, keyed by hand |
| `board(box?)` | The current contents of every hand, or of one box's hands |
| `outcomes(card, hand)` | This card's outcomes with availability, evaluated against current state |
| `play(card, outcome, hand, { advanceTurns })` | Apply an outcome |
| `advanceTurns(box, n)` | Advance one box's clock |
| `turn(box)` | Read one box's clock |
| `listBoxes()` | Every box: id, gameId, title, current turn |
| `listProperties()` | Every declared property: path, type, value, default, enum values |
| `getProperty(path)` / `setProperty(path, value)` | Read and write state by path (the flow's merged view) |
| `subscribeTrace(handler)` | Stream every deal, peek, evict, play, write, turn and diagnostic |
| `log()` / `clearLog()` | The retained flow log, if you asked for one |

And beside both, a free function rather than a method on either: `describeBundle(bundle)`
tells you what a bundle offers - its boxes, hands, decks and declared properties - without
building an engine or running anything. &rarr; [Dev tools](/play/dev-tools/)

Two things to hold on to:

- **A dealt card doesn't carry outcome availability.** A card can sit on the board for many
  turns while the world moves, so ask `outcomes()` when you're about to show them and you
  get the current answer.
- **You only play cards that are in a hand.** `play` needs the card to be on the board in the
  hand you name. Peeking shows you what a box would deal; it doesn't let you play from it.

## Property paths

`getProperty` and `setProperty` address state by path:

```
world.gold
story.reputation
box.b_village.heat
deck.k_arrival.visits
hand.h_inn.owner
value.v_forest.peril
```

`listProperties()` returns rows carrying these paths, and the in-engine examiners are built on
those rows. The full list is on [Your game's state](/play/world-state/).

## Determinism

The random generator is mulberry32, bit for bit in all four languages, and its position rides
in the save. Same bundle, same seed, same sequence of calls means the same cards, in every
runtime. How that's checked: [Compatibility & conformance](/compatibility/).

## Shared dev tools

Every runtime carries the same four development surfaces: a property examiner and editor, a
bundle inspector, a state logger, and a Board demo. They're documented together on
[Dev tools](/play/dev-tools/), because they're the same everywhere. Every runtime also
carries a [Live Link](/play/live-link/) client: connect your running game to Storyletter,
and saves reach the run without a restart while the Board shows the game's deals as they
happen.

## Where to go next

- **Just want it running?** Jump to your engine's quickstart above.
- **Wiring up your state first?** [Your game's state](/play/world-state/).
- **Want to see the whole loop?** Every runtime ships the Board demo: open it and press Play.
- **Why it matches everywhere:** [Compatibility & conformance](/compatibility/).
