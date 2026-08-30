---
title: Dev tools
description: The four development surfaces every Storylet Engine runtime carries - the property examiner, the bundle inspector, the state logger and the Board demo.
sidebar:
  label: Dev tools
---

Every runtime carries the same four development surfaces, each in its own engine's idiom. If
one runtime has a surface, they all do: see [Compatibility](/compatibility/).

## The property examiner

A live view of a running flow's state, editable in place.

One widget per engine: the **Runtime State** window in Unity, the **Runtime State** panel in
Unreal, the in-game `StoryletStatePanel` in Godot, and `createPropertyInspector` in
JavaScript. All four show the same thing:

- one row per declared property from `listProperties()`, path-addressed;
- **type-aware editors**: boolean toggle, number field, string field, enum picker, flags,
  quality stage picker;
- per-row **reset to default**, disabled while the value is already at its default;
- refresh a few times a second, skipping whichever control has focus so a half-typed value
  survives;
- the per-box **turn clocks** and the current **board**;
- the retained log, and **Save State… / Load State…** buttons.

There are **two logs**, and the difference matters once a run has more than one
flow. Each flow's section carries its own log: what that participant did. The
engine carries the **run log**, every flow's events in one order with each line
naming the flow that caused it. You need both, because a story action in one
flow can move state another flow reads, and the second flow's own log would say
nothing about it: their value simply changes. The run log is where a run is
legible.

In the three native runtimes your game finds the panel through a small static registry,
**`StoryletDebug`**: register your **engine** under a label and the panel picks it up. You
register the engine, not each flow, so the panel puts Save/Load and the shared state under the
engine's name and then draws a section per open flow, and a flow you open later shows up on
its own with nothing to remember. The registry holds engines weakly, and in Unreal it compiles
to no-ops in Shipping builds.

JavaScript runs in-process and needs no registry: hand `createPropertyInspector` the engine
and the flow you want to watch. It draws that one flow's merged view (its own properties plus
the shared ones and `@world`), so a game running several flows mounts one panel per flow
rather than getting the sections for free.

Edits commit through `setProperty`, the same call your game uses, so the logger sees them
too.

## The bundle inspector

The examiner needs a live flow. This one doesn't.

It answers the integrator's question: **"I dropped a `.storyletsc` into my project. What can
my game code call?"** From the imported asset alone, without running the game or opening
Storyletter. It shows:

- **identity**: schema, project name, version, content hash, and whether metadata is full or
  stripped;
- **hands**: gameId, title, box, slots, template. This is what you can `deal()`;
- **boxes, tag groups and tags**, by gameId, plus each box's ranking policy. This is what you
  can `peek()`;
- **declared properties** per scope with their types: what conditions read and what your game
  may set;
- **counts** of decks, cards and templates, for orientation. Not card lists: cards are the
  engine's business.

The runtime half is `describeBundle(bundle)`, a bundle-level function in all four languages.
The view sits on the imported asset, read-only, where each engine makes it natural: Unity's
Inspector, Unreal's Details panel, Godot's Inspector, and `createBundleInspector` in
play-helpers. The sections and their names are the same in all four.

It serves everyone. An integrator reads the callable names. A designer debugging "why can't I
deal that hand" sees that the name they typed isn't in the list.

## The state logger

Each flow keeps a trace of everything it does, and the engine keeps the interleaved stream of
all of them. The logger turns them into something you read.

Every write arrives as it happens, whether the engine or your own code made it, carrying the
previous value and a reason, alongside the events that aren't property writes: deals, peeks,
plays, turns, cooldowns and the board.

Every engine's examiner renders the retained log with per-kind filters, Autoscroll, Copy and
Clear. Peek entries file under the Deal filter.

To retain the log, create the engine with logging on. Without a subscriber and without a
retained log, a flow does no trace work at all, so leaving it off costs nothing.

## The Board demo

The whole play loop as one clickable board, shipped with all four runtimes: same content, same
control labels in the same order, same transcript, one idiom each.

- Every hand from `board()` is a labelled group of card buttons. An empty hand says
  `(nothing here right now)`.
- Clicking a card reveals its outcomes beneath it. Available outcomes are clickable;
  unavailable ones are still shown, disabled and labelled `(locked)`. Only one card is open at
  a time.
- Three controls: **Deal all hands**, **Next turn**, **Restart**.
- A transcript records one line per action, newest last.
- The engine is created with the log on and the ENGINE registered with `StoryletDebug`, so the
  examiner fills as you play.

Every Board demo uses seed 7 over the same compiled Hamlet bundle, so all four runtimes deal
the same cards in the same order. You can watch cross-runtime determinism instead of taking it
on trust.

If you want the smallest possible integration, each demo's source has a few lines that load
the bundle, open a flow, deal and read `board()`. Everything else is UI.

## The editor, joined

The in-engine surfaces above are how you inspect a running game from inside it. To watch it
from Storyletter instead, and to push saves into it without a restart, connect the
[Live Link](/play/live-link/).
