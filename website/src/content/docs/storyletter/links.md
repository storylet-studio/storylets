---
title: The Links window
description: See one card's immediate neighbourhood, what can turn it on or off and what it turns on or off, worked out from conditions and outcomes.
sidebar:
  label: Links
---

Review ▸ Links… opens a lens on the card you're looking at, with what can turn it on or off
to the left and what it turns on or off to the right. It follows the editor's selection, so you
can leave it open beside you.

It answers the question you cannot answer by reading one card: **what breaks if I delete this?**

## What it draws

The focus card sits in the middle, its neighbours either side. Cards wear the same faces and
the links the same four inks as [the node canvas](/storyletter/node-canvas/), so learning one
teaches you the other.

Neighbours are found **across every deck and box**, not just the current deck, because a
card in one deck can be the only thing that opens a card in another.

## The four kinds of link

Each link is classified, and the window words it as a sentence rather than a field:

| Kind | Reads as | Means |
|---|---|---|
| enable | *The Glowing Tree **opens** The Tree Blooms* | playing the first can make the second available |
| disable | *The Glowing Tree **shuts** The Tree Blooms* | playing the first can take the second away |
| influence | *… **changes what is true for** …* | it writes state the other card reads, without deciding it either way |
| reference | *… **shares state with** …* | neither writes it; both read it |

A reference has no direction: neither card acts on the other, they both read the same
property.

Select a neighbouring card and the window explains its link: a lead naming both cards and what one does to the
other, then a row per contributing property, in the mono voice (`@story.world_events`) with the
outcome that writes it named.

## Focus, and following the editor

The window follows the editor. Click a different card in the editor and the lens moves with it.

Right-click a neighbour for **Centre on this card**, which re-focuses the window on it, and
the window then shows a **Follow the editor** button to get back. The same menu has **Open
in the editor**, and double-clicking a card opens it too.

## Arranging

The window lays the cards out for you each time the focus moves, so nothing in it can be
dragged.

## One step at a time

The window shows the focus card's immediate neighbours and stops there. To follow a chain,
walk it a card at a time with **Centre on this card**.

## What it cannot see

This is static analysis. It reads conditions and outcomes and works out what could affect what.
**It never plays anything**, so it describes what is *possible*, not what actually happens in a
run. For that, use [Coverage](/production/coverage-testing/), which really does deal hands.

It tells you where it is blind rather than leaving you to assume it is complete:

- **Links through `@hand`** are not included. A hand is composed at the deal, so what it
  contains is not knowable in advance. The window says so in as many words.
- Computed values, where a change can't be read statically, are reported rather than
  guessed at.
- **Unrecognised functions** are reported the same way.

Each of these appears as a warning against the card it was raised on, so a missing link has a
reason attached to it rather than being silently absent.

## From the command line

The same analysis, without the editor:

```sh
storyletengine links the-hamlet.storylets
links: 17 card(s), 19 edge(s) - 18 enable, 1 disable, 0 influence, 0 reference
```

`--deck`, `--box`, and `--card` narrow it, `--refs` includes reference edges, and `--json`
gives the graph for something else to read. Every flag is on [the CLI reference](/cli/#links).

## When to reach for it

- Before deleting or rewriting a card, it shows what depended on it.
- When a card never comes up, it shows what was supposed to open it. Coverage tells you it was
  never dealt, and Links tells you what the route in was meant to be.
- When a thread feels disconnected, it shows whether the thread actually joins the rest of the
  story or merely sits next to it.
