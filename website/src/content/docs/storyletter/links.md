---
title: The Links window
description: One card's immediate neighbourhood, drawn. What can turn this card on or off, what this card turns on or off, across every deck and box, worked out from conditions and outcomes without playing anything.
sidebar:
  label: Links
---

**Review ▸ Links…** opens a lens on the card you are looking at: what can turn it on or off to
the left, what it turns on or off to the right. It follows the editor's selection, so it is
cheap to leave open in a corner and cheap to ignore.

It answers the question you cannot answer by reading one card: **what breaks if I delete this?**

## What it draws

The focus card sits in the middle, its neighbours either side. Cards wear the same faces and
the links the same four inks as [the node canvas](/storyletter/node-canvas/), so learning one
teaches you the other.

Neighbours are found **across every deck and box**, not just the current deck. That is
deliberate: a card in one deck can perfectly well be the only thing that opens a card in
another, and "what breaks if I delete this" does not respect deck boundaries.

## The four kinds of link

Each link is classified, and the window words it as a sentence rather than a field:

| Kind | Reads as | Means |
|---|---|---|
| enable | *The Glowing Tree **opens** The Tree Blooms* | playing the first can make the second available |
| disable | *The Glowing Tree **shuts** The Tree Blooms* | playing the first can take the second away |
| influence | *… **changes what is true for** …* | it writes state the other card reads, without deciding it either way |
| reference | *… **shares state with** …* | neither writes it; both read it |

A reference is not directional. Neither card acts on the other, they merely both care about the
same property, so it is phrased as a state of affairs rather than as an effect.

Select a link and the window explains it: a lead naming both cards and what one does to the
other, then a row per contributing property, in the mono voice (`@story.world_events`) with the
outcome that writes it named.

## Focus, and following the editor

The window follows the editor. Click a different card in the editor and the lens moves with it.

You can also walk away from that: **Centre on this card** re-focuses on a neighbour, and the
window then shows a **Follow the editor** button to get back. Walking away is a state worth
showing, because otherwise a window that has stopped tracking just looks stuck.

**Open in the editor** takes you to the card you are looking at.

## Why nothing here is draggable

Unlike the node canvas, nothing in this window is arranged by you. The layout is generated from
the graph every time the focus moves, so there is nothing to persist and nothing to drag.

**The arrangement is the answer.** It is a reading of the project as it stands, not a diagram
you maintain.

## One hop, on purpose

The window shows the focus card's **immediate** neighbours and stops there. It does not walk
the chain outward.

A whole-project graph is a hairball. The previous generation of this tool drew one and learned
that it looks impressive and tells you nothing; one hop across the project stays readable, and
you get the chain by walking it a card at a time with **Centre on this card**.

## What it cannot see

This is static analysis. It reads conditions and outcomes and works out what could affect what.
**It never plays anything**, so it describes what is *possible*, not what actually happens in a
run. For that, use [Coverage](/production/coverage-testing/), which really does deal hands.

It tells you where it is blind rather than leaving you to assume it is complete:

- **Links through `@hand`** are not included. A hand is composed at the deal, so what it
  contains is not knowable in advance. The window says so in as many words.
- **Computed values.** A change it cannot read statically is reported rather than guessed at.
- **Unrecognised functions**, likewise.

Each of these appears as a warning against the card it was raised on, so a missing link has a
reason attached to it rather than being silently absent.

## From the command line

The same analysis, without the editor:

```sh
storyletengine links the-hamlet.storylets
links: 17 card(s), 19 edge(s) - 18 enable, 1 disable, 0 influence, 0 reference
```

`--deck`, `--box` and `--card` narrow it, `--refs` includes reference edges, and `--json` gives
the graph for something else to read. → [The CLI reference](/cli/#links)

## When to reach for it

- **Before deleting or rewriting a card**, to see what depended on it.
- **When a card never comes up** and you want to know what was supposed to open it. Coverage
  tells you it was never dealt; Links tells you what the route in was meant to be.
- **When a thread feels disconnected**, to see whether it actually joins the rest of the story
  or merely sits next to it.
