---
title: The node canvas
description: See a deck's cards as nodes, with the arrows between them worked out from their conditions and outcomes, arranged by you and remembered.
sidebar:
  label: The node canvas
---

A deck has three views on the switch at the top right of its page, Card view, Table
view and Node view. Node view is a deck's default view, and it answers the question the other two can't.
What does this card do to the others?

It's an ordinary view, not a mode. The same deck, the same cards, the same clicks. One
click selects a card, two clicks open it.

<figure class="doc-shot">
  <img src="/doc-images/NodeCanvas.png" alt="The node canvas for the Gareth's Debt deck: three cards laid out left to right, Gareth Looks Troubled, The Moneylender's Men and Gareth's Gratitude, with a two-headed amber arrow between the first two and a green arrow from The Moneylender's Men to Gareth's Gratitude. The strip below has Frame, Comment, Key and Arrange all by links." />
  <figcaption>Gareth's Debt as nodes: the green arrow is an outcome that opens the next card, and the amber one is state each card changes for the other. Nobody drew them.</figcaption>
</figure>

## What the arrows mean

Storyletter reads every card's condition and every outcome's changes, and draws an arrow
when one card's outcome moves state that another card's condition reads:

| Arrow | Means |
|---|---|
| **opens** (green) | playing it can make the other card available |
| **shuts** (red) | playing it can take the other card away |
| **changes what is true for** (amber) | it writes state the other card reads, either way |
| **shares state with** (grey, dashed) | neither writes it; both read it |

**Key**, in the strip, shows these with their colours. Hover an arrow to see why it's there.

The last kind finds a whole class of mistake: a group of cards all gated on a property
nothing ever writes is content that can never appear, and the grey dashed arrows make
it visible.

You never draw an arrow yourself. Change a condition and the arrows change with it.

## Arranging

Drag a card and it stays where you put it. Nothing moves your arrangement on its own: not
a save, not an undo, not switching to Cards and back. **Arrange all by links** lays
the cards out by their dependencies. With two or more cards selected, it arranges just those, and the button reads
**Arrange by links**.
The story's flow reads left to right, following the enabling links first; cards nothing
links to wrap into rows below it. Cards that enable each other in a loop share a column
and the strip says so.

Positions live in `view.storyletview`, the
[arrangement shard](/format/shards/#the-two-arrangement-shards), which holds card
positions and never content. Delete it and you lose a layout, never a card. Where hands
stand on the project map isn't in there; that has
[files of its own](/storyletter/maps/#where-the-map-is-stored).

Where you were looking is remembered per deck and restored when you come back.

## The rest of the canvas

The tools the [project map](/storyletter/maps/) has for frames and comments are here too. Right-click
for **New card here**. **Frame** draws a titled frame behind a group of cards, and **Comment**
drops a [comment marker](/storyletter/reviewing/) on the canvas or on a card. The zoom and
fit controls sit at the top left of the canvas. `Home` fits everything and `F` fits the selection. The full key
list is on [Keyboard shortcuts](/storyletter/shortcuts/#on-a-canvas).

If you've run a coverage test, **View ▸ Coverage Overlay** tints each card by how much play
reached it. See [Coverage testing](/production/coverage-testing/).

## When to use which view

- **Node view** is for seeing structure, what leads to what and what nothing leads to.
- **Card view** is for reading and writing the faces.
- **Table view** is for comparing, with the same columns down a long deck, for tags, priorities,
  and redraw.

The switch is remembered, and every deck opens in the view you last chose.
