---
title: Getting started
description: Get Storyletter, open an example project, design a card, watch it come up, find the beats that never do, and deal a hand inside your own game.
sidebar:
  label: Getting started
---

Press Play in Storyletter and a hand is dealt in front of you. A few cards come up, ranked,
each one there because its condition is true right now, and one tab over the editor can tell
you why every other card in the deck was passed over. Pick a card, choose an outcome, and the
next deal is different, because the world remembers. That loop is the whole product. This page
walks you from a download to the same loop running inside your own game, and you don't need
to write any code until the last step.

New here? [What are storylets?](/what-are-storylets/) has the idea itself, and
[Storylet Studio: A Toolkit for Storylet-Driven Games](https://wildwinter.medium.com/storylet-studio-a-toolkit-for-storylet-driven-games-17603c9358ac)
introduces the project, where it came from, what is in it, and why it works this way.

You design in Storyletter, and your game plays what you design with a Storylet Engine runtime.
Setting a project up is a one-off. After that the work is a short loop. Design a card and say
when it should come up, play to see whether it does, run coverage to find what never does, and
publish when your game needs it.

:::tip[Prefer the terminal?]
The same walkthrough exists [for the command line](/cli-walkthrough/). Both run the same code,
so neither is the poor relation.
:::

## 1. Get Storyletter

Storyletter is the editor, the desktop app where you design.
[Download it for your platform](/download/) for macOS, Windows, or Linux. It's one
self-contained installer, nothing else needed. (The same page has the runtimes and the CLI.)

## 2. Open something

Storyletter opens on a welcome screen with three groups: **Start from a kit**, **Learn from
a finished project**, and **Recent**. Click a kit or an example to see what it holds and
what pressing Play shows, before anything is made.

Four example projects ship with the app, each copied somewhere you choose so you can pull
it apart without worrying. **The Hamlet** is the small worked project, with a map, hands,
and decks to deal from, and the place to start, because the idea is much easier to read than
to describe. **The Village** is the full demo, thirteen decks over a drawn map. **Port
Meridian** shows the engine standing beside an action game, with five boxes driving
contracts, street encounters, found items, a codex, and city news screens. **The Hamlet
(Patter Version)** is for later, if you write dialogue in [Patter](/storyletter/patter/).
**Help ▸ Open an Example** opens another one from inside a project, and **File ▸ Close Project** brings you
back to this screen.

**New project…** starts a project of your own, asking for a name and a **game kit**. Pick
**Starter project** and you get one box, one hand called **What's next?**, and two sample cards
that show the loop working. The first flips a piece of story state when you play it, and the
second is waiting for exactly that, so you can press Play straight away and watch one card open
the way to another. **Starter project with Patter** is the same with a Patter project beside it
for the dialogue, and the other kits start you on a story told across a map, or on the story
side of an action game. Once something's already open, **File ▸ New Project…** (`Cmd+N`) does
the same.

**Open a project…** opens one you already have (**File ▸ Open Project…**, `Cmd+O`, from inside a
project). Recent projects are listed underneath.

A project is a folder on disk (a package on macOS, so it opens with a double-click). There's
no server, no account, and no import step, and your version control sees plain text files.

## 3. Find your way around

There are three parts to the window. **The navigator**, down the left, is the tree of your
content: the project, the boxes in it, and the decks inside those. `Cmd+1` shows and hides
it. **The centre** is whatever you're looking at, one thing at a time. **The top bar** carries
the trail of where you are, and the **▶ Play** button.

Click a deck and it opens on its **node view**, the cards laid out as if on a whiteboard, with
arrows showing which card opens the way to which. You never draw those arrows. Storyletter
works them out from the cards themselves, and redraws them when you change a card. The switch
at the top right gives you two other ways to look at the same deck. **Cards** lays them out
like index cards, and **Table** is the same information in columns.

Have a look around before you change anything. Open a card, look at its condition and its
outcomes, then look at the hands the box declares.

## 4. Design a card

Open a deck and click the faded **+ New card** at the end of the cards, or, in the node view,
right-click the canvas and choose **New card here**. **File ▸ New Card** (`Shift+Cmd+N`) does
the same thing.

Give it a **title**, and a **purpose**, which is one line for you and your team saying what
happens in this beat. (A card carries no text for the player. What your game gets from a card
is its fields, such as a scene to play, an animation, or a key into your own text. Putting
those words on screen is your game's job.)

Then the **Dealing** tab, which is everything about when this card comes up. In a box whose
hands are bound to a place, such as the map's zones or the people you can talk to, it opens
with one sentence saying where the card **Comes up**, which you can change from there.

- The When row is the condition. Type it into the expression editor, which knows the
  properties your project has declared, so you pick from a list rather than remembering names.
- **Priority** is how it ranks against the other cards that also fit. Higher goes first.
- **Redraw** is whether it can come back after it's been played. It can be always, never, or
  after a number of turns.

If the property you want doesn't exist yet, decide who owns it.

- If your **game** owns it (the time of day, the player's gold), `Cmd+,` opens **Project
  Settings** and it goes under **World**.
- If the **story** owns it (the act, what the player has learned), click **Story** at the top
  of the navigator and add it there.
- If it belongs to one part of the story, add it on that box's, deck's or hand's
  **Properties** tab instead.

Give it a purpose while you're at it, one line that becomes the hover tip wherever the
property appears. [Core concepts](/concepts/#the-five-scopes) explains the scopes.

On a project with more than one player at once (**Play** set to **Shared world** in Project
Settings), every property row also says whose the value is. A story property reads **One value
for every guest.** by default, which is right for a fact about the world, such as a gate
being opened. It's wrong for something one player carries, such as a key they found. Left
that way, one player finding the key opens the door for everyone. Expand the row and untick
**Shared**, and it reads **Each guest has their own.** Box and deck properties start that way.
A hand's or a tag's property starts as one value per hand or per tag, each guest with their
own, and a zone's is one value for every box. A solo project has one player and nothing to
choose.

There's no save button to hunt for. Your edits are written to the files as you make them, and
the top bar shows where that's got to. `Cmd+S` flushes anything still pending.

## 5. Play it

Press **▶ Play**, or `Cmd+P`. **The Board** opens beside the editor.

This isn't a preview. It's the same engine your game will ship with, so if a card comes up
here, it'll come up in your build.

Deal, click a card, and choose an outcome. You read what the outcome will change before you
commit to it. The journal down the right-hand side records everything that happened, and you
can copy it straight into a bug report.

The interesting part is two tabs over. The rail on the right pairs the journal with
**State** and **Why not?**. Click a hand's name, and **Why not?** tells you, for every card
that could have come up there and didn't, exactly which rule stopped it. That's the answer
to "why isn't my card showing up?", and it's the reason the Board exists.

Edit the project and the Board notices and offers you a restart. It won't swap the story out
from under a run in progress.

## 6. Find what never comes up

Playing walks one route. **Review ▸ Coverage Test…** (`Shift+Cmd+C`) walks hundreds. It plays the
project over and over, taking different turnings each time, and reports what actually came
up.

Set how many runs you want and press **Run coverage**. You can keep working while it goes,
and cancelling still reports as far as it got.

The report opens with how many cards were dealt, and counts of those **Never dealt**,
**Rarely dealt**, and **Dealt, never played** (which usually means an outcome's condition is
too tight). Under it, a table of every card shows how often each came up, least reached first,
and a card that was never dealt carries its reason where one is known. **Outcomes never
played** asks the same question one level down. **Cards seen in each hand**, folded away, shows
how much of what each hand could hold it actually held.

Every row is a way back into the project. Click it and the editor opens that card.

Anything gated on your game's own state can't be reached by a test run unless you say how
that state changes, so coverage tells you that rather than calling the card dead. When it
can, it offers an **Add coverage drivers** button that writes a range of values for the test
runs to try.

## 7. Publish the bundle

**Publish ▸ Publish Bundle** (`Shift+Cmd+B`) writes a single `.storyletsc` file. That's the
only thing your game loads, on Unity, Unreal, Godot, or the web.

Turn on **Auto Rebuild** and it re-publishes quietly a moment after your edits settle, so the
file your programmer is loading never falls behind what you wrote.

## 8. Play it in your game

A bundle plays the same way on every Storylet Engine runtime, so a project behaves
identically whatever engine picks it up. Before you deal, tell the flow what's true in your
game, then ask for a hand.

```js
import { Engine } from "@storylet-studio/runtime";

const flow = new Engine(bundle, { seed: 7 }).openFlow("main");
flow.setProperty("world.is_night", true);      // any property you declared under World

const cards = flow.deal("whats-next");         // the cards that fit right now, best first
```

Your game reads each card's **fields** (a scene id, an animation, a text key) and does
whatever it does with them. When the player picks an outcome, `play` it and the world
remembers.

For the web, JavaScript, or TypeScript, start with [JavaScript](/play/javascript/). Unity
(C#), Unreal (C++ / Blueprint), and Godot (GDScript) are native plugins with the same API,
and [Playing in your game](/play/overview/) is where each one starts.

## Where to go next

[Core concepts](/concepts/) is the vocabulary on one page: box, deck, card, hand, the Board,
turns, and the five scopes. [Designing in Storyletter](/storyletter/overview/) is the editor
in full, surface by surface, and [Coverage testing](/production/coverage-testing/) has more
on finding the gaps. If you want it scripted,
[the same loop runs from the command line](/cli-walkthrough/).
[Playing in your game](/play/overview/) is how the bundle gets into your engine.
