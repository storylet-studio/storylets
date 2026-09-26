---
title: Working with Patter
description: Pair a Storyletter project with the Patter project that holds its dialogue, and let Storyletter check that every card and its scene agree.
sidebar:
  label: Working with Patter
---

A common shape for a game is storylets choosing the beat and [Patter](https://patterkit.dev)
performing it: the game deals a card, plays the Patter scene named after it, and plays the
outcome the scene ends on. The two projects stay separate, one for Storyletter and one for
Patterpad, and they're joined by names you already write.

This page covers what Storyletter does to help. How the game wires the two engines together is
in [Storylets with Patter](/play/with-patter/).

## The names that join them

- **A card's gameId is its scene's name.** The card `the-moneylenders-men` plays the Patter
  scene `the-moneylenders-men`.
- **An outcome's gameId is what the scene names.** Label a choice option with the outcome's
  gameId in its Game Data, and taking that option reaches that outcome. A `gameEvent` naming
  an outcome wins over the label, which is how dialogue *after* a choice can decide the result.
- **A card with one outcome needs neither.** Reaching the end of the scene reaches it.

## Starting a project with Patter

**File ▸ New Project…** offers **Starter project with Patter**: the starter project, and a Patter
project beside it with the same name. They're paired already, the starter box is performed by
Patter, and each card has a stub scene waiting in Patterpad. Write the scenes, publish them from
Patterpad, and press Play.

## Pairing the projects

Open **Project Settings ▸ General**, and under **Patter project** choose the `.patter` folder
(or type its path). It's saved in the project as a path relative to it, so everyone who checks
out the game gets the same pairing, and so does your build.

Nothing about the pairing goes into the bundle your game loads.

## What Storyletter checks

Once the projects are paired, Storyletter reads the Patter project's **published** bundle, from
wherever Patterpad's **Publish Bundle** writes it, and checks every card that has a scene of its
name. What it finds goes in the problems bar, and `storyletengine validate` finds the same
things, so CI does too.

Errors, because the game would get it wrong:

- The scene names an outcome the card doesn't have.
- The card has several outcomes, and a branch of its scene doesn't say which one it reached:
  an option with no label and no `gameEvent`, or a scene with neither at all.

Warnings, because something can't be reached yet:

- An outcome that no option and no `gameEvent` in the scene ever names.
- A scene that matches no card, so nothing will ever deal it.

If the Patter project hasn't been published yet, or the folder isn't where the path says, that's
a warning and the check waits. Publish from Patterpad and it picks up the new bundle straight
away.

### Boxes Patter performs

Some boxes have dialogue and some don't. On a box's **Dealing** tab, tick **Performed by Patter**
for each box whose cards play Patter scenes (the option appears once the projects are paired).
Then the check covers only those boxes, and a card in one with no scene of its name is an error,
since the game will try to play a scene that isn't there. With no box ticked, every card that
happens to have a scene is checked, and none is required to have one.

When a card in a box Patter performs has no scene, the problem comes with a fix: **Create the
scene in Patter**. It writes a stub scene into the Patter project, named after the card, with the
card's purpose as its first line and one option per outcome (none for a card with one outcome),
then opens it in Patterpad for you to write. Once you publish it from Patterpad, the check and the
Board pick it up.

The same setting tells the [Board](#playing-scenes-on-the-board) which cards to perform. It's
saved in the project, and it never goes into the bundle: your game still decides for itself
which boxes it plays through Patter.

### Adding the outcome a scene names

When a scene names an outcome the card doesn't have, the problem comes with a fix:
**Add outcome "…"**. It gives the card an outcome with exactly that gameId, titled from it
(`slip-away` becomes "Slip away"), and opens it so you can write its purpose and changes. The
gameId is pinned, so retitling the outcome won't break the link.

## Seeing how a scene reaches each outcome

Open a card's **Outcomes** tab and expand an outcome. When its scene reaches it, an **In Patter**
section says how, in the scene's own words:

- *Option "Walk away; it isn't your fight"*: the player picks that option.
- *A gameEvent after option "…"*, or *A gameEvent in the scene*.
- *The scene ending*: the card has one outcome, and the scene just finishes.

It's read from the published bundle, so it tells you what the game will do, not what you've
typed in Patterpad since you last published.

## Opening the scene in Patterpad

With a card open, **Edit ▸ Edit Scene in Patterpad** opens Patterpad at that card's scene. If
Patterpad is already open on the project it jumps there. The menu item only appears once the
projects are paired.

The first time, if Storyletter can't find Patterpad, it asks you to point to it and remembers
where it is. That's kept on your machine, not in the project, since everyone installs apps in
different places.

Going the other way, Patterpad's **Edit ▸ Show Card in Storyletter** opens the card the scene
you're writing belongs to.

## Keeping names steady

A gameId follows its title until the item is first published, and **Publish Bundle** pins it
then. Patterpad does the same for scenes. So you can rename freely while you draft, and once a
card has gone out, retitling it won't quietly break the scene named after it. To rename a
pinned gameId on purpose, edit it with the gameId chip, and rename the scene to match.

## Playing scenes on the Board

Open a card from a box Patter performs on the [Board](/storyletter/board/) and, instead of its
outcome buttons, you get its scene: the lines, then the choices, then the outcome the scene
reached, with **Continue** to play it. An option is greyed when Patter's condition on it fails,
or when the outcome it leads to is shut on the card, the same two gates your game has. Both
engines run on one set of properties, so a line that sets `@world` or `@story` shows up in the
next deal, and a card can deal on what a scene set.

The Board plays the Patter project's published bundle. To have it follow your edits as you make
them, turn on **Live Link** in Patterpad: the Board connects to it like a game, each save in
Patterpad updates the scenes it plays, and Patterpad's playhead follows the line the Board is on.

If a card has no scene, or its scene ends without saying which outcome it reached, the Board
says so and gives you the outcome buttons instead, so you can carry on playing.

## A playable page with the dialogue

**Publish ▸ Publish Playable HTML…** on a paired project with boxes Patter performs makes a page
that plays those cards' scenes too, the same way the Board does, from the Patter project's
published bundle. It's still one file that opens in any browser, so you can send the whole
story, dialogue and all, to someone who has neither app.
