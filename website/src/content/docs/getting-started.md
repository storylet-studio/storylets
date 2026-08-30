---
title: Getting started
description: Get Storyletter, open the example project, design your first card, watch it come up, find the beat that never does, publish the bundle and deal a hand inside your own game.
sidebar:
  label: Getting started
---

Storylet Studio has two halves: you **design** in Storyletter, and your game **plays** what you
design with a Storylet Engine runtime. This is the path from nothing to a hand of cards dealt
inside your own game. You don't need to write any code until the last step, and you don't need
a game to try everything before it.

Setting a project up is a one-off. After that the work is a short loop: design a card and say
when it should come up, play to see whether it does, run coverage to find what never does, and
publish when your game needs it.

:::tip[Prefer the terminal?]
The same walkthrough exists [for the command line](/cli-walkthrough/). Both run the same code,
so neither is the poor relation.
:::

## 1. Get Storyletter

Storyletter is the editor: the desktop app where you design.
**[Download it for your platform &rarr;](/download/)**: macOS, Windows or Linux, one
self-contained installer, nothing else needed. (The same page has the runtimes and the CLI.)

## 2. Open something

Storyletter opens on a welcome screen with three groups: **Start**, **Learn from a
finished project**, and **Recent**.

Three example projects ship with the app, each copied somewhere you choose so you can pull
it apart without worrying. **The Hamlet** is the small worked project - places, hands and
decks to deal from - and the place to start: the idea is much easier to read than to
describe. **The Village** is the full demo, thirteen decks over a drawn map. **Port
Meridian** shows the engine standing beside an action game: five boxes driving contracts,
street encounters, found items, a codex and city news screens. **File ▸ Close Project**
brings you back to this screen whenever you want another one.

**New project…** starts a project of your own, asking for a name and a **game kit**. It isn't empty: you get one box,
one hand called **What's next?**, and two sample cards that show the loop working. The first
flips a piece of story state when you play it, and the second is waiting for exactly that, so
you can press Play straight away and watch one card open the way to another. Once something's
already open, **File ▸ New Project…** (`Cmd+N`) does the same.

**Open Project…** (`Cmd+O`) opens one you already have. Recent projects are listed underneath.

A project is a folder on disk (a package on macOS, so it opens with a double-click). There's
no server, no account and no import step, and your version control sees plain text files.

## 3. Find your way around

There are three parts to the window:

- **The navigator**, down the left, is the tree of your content: the project, the boxes in
  it, and the decks inside those. `Cmd+1` shows and hides it.
- **The centre** is whatever you're looking at, one thing at a time.
- **The top bar** carries the trail of where you are, and the **▶ Play** button.

Click a deck and it opens on its **node view**: the cards laid out as if on a whiteboard, with
arrows showing which card opens the way to which. You never draw those arrows. Storyletter
works them out from the cards themselves, and redraws them when you change a card. The switch
at the top right gives you two other ways to look at the same deck: **Cards**, laid out like
index cards, and **Table**, the same information in columns.

Have a look around before you change anything. Open a card, look at its condition and its
outcomes, then look at the hands the box declares.

## 4. Design a card

Open a deck and click the faded **+ New card** at the end of the list. **File ▸ New Card**
(`Shift+Cmd+N`) does the same thing.

Give it a **title**, and a **purpose**: one line for you and your team saying what happens in
this beat. (A card carries no text for the player. What your game gets from a card is its
fields: a scene to play, an animation, a key into your own text. Putting those words on screen
is your game's job.)

Then the **Dealing** tab, which is everything about when this card comes up:

- **When** is the condition. Type it into the expression editor, which knows the properties
  your project has declared, so you pick from a list rather than remembering names.
- **Priority** is how it ranks against the other cards that also fit. Higher goes first.
- **Redraw** is whether it can come back after it's been played: always, never, or after a
  number of turns.

If the property you want doesn't exist yet: click **Story** at the top of the navigator and
add it there if the story owns it - and give it a purpose while you're at it, one line that
becomes the hover tip wherever the property appears. If your **game** owns it, `Cmd+,` opens
**Project Settings** and it goes under **World**. The difference matters later, and
[Core concepts](/concepts/) explains it.

There's no save button to hunt for: your edits are written to the files as you make them, and
the top bar shows where that's got to. `Cmd+S` flushes anything still pending.

## 5. Play it

Press **▶ Play**, or `Cmd+T`. **The Board** opens beside the editor.

This isn't a preview. It's the same engine your game will ship with, so if a card comes up
here, it'll come up in your build.

Deal, click a card, and choose an outcome. You read what the outcome will change before you
commit to it. The journal down the right-hand side records everything that happened, and you
can copy it straight into a bug report.

The interesting part is one tab over. The rail on the right pairs the journal with a
**State** tab: press **Peek** there and **Not listed · why** tells you, for every card the
deal passed over, exactly which rule stopped it. That's the answer to "why isn't my card
showing up?", and it's the reason the Board exists.

Edit the project and the Board notices and offers you a restart. It won't swap the story out
from under a run in progress.

## 6. Find what never comes up

Playing walks one route. **Review ▸ Coverage** (`Shift+Cmd+C`) walks hundreds: it plays the
project over and over, taking different turnings each time, and reports what actually came up.

Set how many runs you want and press **Run coverage**. You can keep working while it goes,
and cancelling still reports as far as it got.

What comes back:

- **Never dealt**: cards nothing ever reached, with a reason where one is known.
- **Dealt but never played**: cards that come up and are never chosen. Usually an outcome's
  condition is too tight.
- **Outcomes never played**: the same question one level down.
- **By hand**: how much of what each hand could hold it actually held.

Every row is a way back into the project: click it and the editor opens that card.

Anything gated on your game's own state can't be reached by a test run unless you say how
that state changes, so coverage tells you that rather than calling the card dead. When it can,
it offers an **Add coverage drivers** button that writes a range of values for the test runs
to try.

## 7. Publish the bundle

**Publish ▸ Publish Bundle** (`Shift+Cmd+B`) writes a single `.storyletsc` file. That's the
only thing your game loads, on Unity, Unreal, Godot or the web.

Turn on **Auto Rebuild** and it re-publishes quietly a moment after your edits settle, so the
file your programmer is loading never falls behind what you wrote.

## 8. Play it in your game

A bundle plays the same way on every Storylet Engine runtime, so a project behaves
identically whatever engine picks it up. Before you deal, tell the flow what's true in your
game, then ask for a hand:

```js
import { Engine } from "@storylet-studio/runtime";

const flow = new Engine(bundle, { seed: 7 }).openFlow("main");
flow.setProperty("world.is_night", true);      // any property you declared under World

const cards = flow.deal("whats-next");         // the cards that fit right now, best first
```

Your game reads each card's **fields** (a scene id, an animation, a text key) and does
whatever it does with them; when the player picks an outcome, `play` it and the world
remembers.

- **Web / JavaScript / TypeScript**: [JavaScript &rarr;](/play/javascript/)
- **Unity (C#)** · **Unreal (C++ / Blueprint)** · **Godot (GDScript)**: native plugins with the
  same API. [Playing in your game &rarr;](/play/overview/)

## Where to go next

- [Core concepts](/concepts/) is the vocabulary on one page: box, deck, card, hand, the Board,
  turns, and the five scopes.
- [Designing in Storyletter](/storyletter/overview/) is the editor in full, surface by surface.
- [Coverage testing](/production/coverage-testing/) has more on finding the gaps.
- [The same loop from the command line](/cli-walkthrough/), if you want it scripted.
- [Playing in your game](/play/overview/) is how the bundle gets into your engine.
