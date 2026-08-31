---
title: What are storylets?
description: Storylets as a way of building interactive stories, before any tool or engine. A chunk of story with a condition on the front, dealt only when it fits, and what that buys you.
sidebar:
  label: What are storylets?
---

New to the idea? Start here. This page is about storylets as a *way of building interactive
stories*: no tool, no engine, just the idea. Once it clicks, [Core concepts](/concepts/) shows
how Storylet Studio puts it to work.

You have probably played storylet games without knowing the word. *Fallen London*, *King of
Dragon Pass*, *Wildermyth*, *Reigns*, *80 Days*: none of them run off a single fixed script.
They tell their story in small, rearrangeable pieces, handed to the player when the moment is
right.

## A chunk of story with a condition on the front

A storylet is a small, self-contained piece of narrative, a scene or an encounter or a moment,
with a rule stuck on the front saying when it is allowed to appear. The rule is really just an
*if*: show this when such-and-such is true.

Think of a deck of cards. Every storylet you write is a card in the deck. When the game wants
some story, it does not shuffle the lot and hope: it deals a hand of only the cards that are
valid right now. You play one, and the next hand might look completely different.

<svg viewBox="0 0 640 280" role="img" aria-labelledby="sy-deal-title" style="width:100%;height:auto;font-family:var(--sl-font-sans,system-ui)">
  <title id="sy-deal-title">A deck of storylet cards on the left, each carrying a condition. Only the cards whose condition currently holds are dealt into a hand on the right. The rest wait in the deck until the world changes in their favour.</title>
  <g font-size="12">
    <text x="8" y="18" fill="var(--sl-color-white)" font-size="13" font-weight="600">The deck</text>
    <text x="8" y="34" fill="var(--sl-color-gray-3)">every storylet you have written</text>
    <rect x="8" y="46" width="196" height="42" rx="6" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 14%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <text x="20" y="64" fill="var(--sl-color-white)">if met the blacksmith</text>
    <text x="20" y="80" fill="var(--sl-color-gray-3)">The Forge at Night</text>
    <rect x="8" y="96" width="196" height="42" rx="6" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 14%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <text x="20" y="114" fill="var(--sl-color-white)">if gold &gt;= 50</text>
    <text x="20" y="130" fill="var(--sl-color-gray-3)">Pay the Toll</text>
    <rect x="8" y="146" width="196" height="42" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-4)" stroke-dasharray="4 3"/>
    <text x="20" y="164" fill="var(--sl-color-gray-3)">if winter</text>
    <text x="20" y="180" fill="var(--sl-color-gray-3)">The Frozen Pass</text>
    <rect x="8" y="196" width="196" height="42" rx="6" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-4)" stroke-dasharray="4 3"/>
    <text x="20" y="214" fill="var(--sl-color-gray-3)">if dragon woken</text>
    <text x="20" y="230" fill="var(--sl-color-gray-3)">The Reckoning</text>
    <text x="8" y="262" fill="var(--sl-color-gray-3)" font-size="11">dashed: waiting for the world to change</text>
    <g stroke="var(--sy-amber,#c8902f)" fill="none" stroke-width="1.5">
      <path d="M216 120 H 292" marker-end="url(#sy-arrow)"/>
    </g>
    <text x="222" y="110" fill="var(--sy-amber,#c8902f)" font-size="11">deal a hand</text>
    <text x="222" y="140" fill="var(--sl-color-gray-3)" font-size="11">only what holds</text>
    <text x="308" y="18" fill="var(--sl-color-white)" font-size="13" font-weight="600">Your hand</text>
    <text x="308" y="34" fill="var(--sl-color-gray-3)">what is playable right now</text>
    <rect x="308" y="46" width="200" height="42" rx="6" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 16%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <text x="320" y="64" fill="var(--sl-color-white)">The Forge at Night</text>
    <text x="320" y="80" fill="var(--sy-amber,#c8902f)" font-size="11">condition met</text>
    <rect x="308" y="96" width="200" height="42" rx="6" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 16%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <text x="320" y="114" fill="var(--sl-color-white)">Pay the Toll</text>
    <text x="320" y="130" fill="var(--sy-amber,#c8902f)" font-size="11">condition met</text>
    <text x="308" y="166" fill="var(--sl-color-gray-3)" font-size="11">play one, the world shifts,</text>
    <text x="308" y="182" fill="var(--sl-color-gray-3)" font-size="11">and the next hand is dealt</text>
    <text x="308" y="198" fill="var(--sl-color-gray-3)" font-size="11">against what is true then</text>
  </g>
  <defs>
    <marker id="sy-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--sy-amber,#c8902f)"/>
    </marker>
  </defs>
</svg>

That is the whole trick: a chunk of story with a condition on it, dealt only when it fits.

## The world keeps score

The conditions are checked against the *state of the world*: the facts your story keeps track
of. Has the player met the blacksmith? How much gold are they carrying? Is it winter? Is the
gate open? You decide what is worth tracking, and you give each fact a name.

Most storylets change those facts when they play. Win the duel, a flag flips. Pay the toll, the
gold drops. Since the next hand is dealt against the new state, the story always keeps up with
what just happened. Deal, play, the world shifts, deal again. That is the loop.

## Same pieces, different shapes

Because every storylet carries its own condition, the same pile of cards can make very
different stories:

- **Linear**: a straight chain, each beat unlocking the next.
- **Parallel**: several threads at once, so the player nudges a romance, a feud and a
  missing-person case along a bit at a time.
- **Interwoven**: those threads talking to each other, so a choice in one opens or closes a beat
  in another.

<svg viewBox="0 0 640 210" role="img" aria-labelledby="sy-shapes-title" style="width:100%;height:auto;font-family:var(--sl-font-sans,system-ui)">
  <title id="sy-shapes-title">Three story shapes built from the same storylets: a linear chain where each beat unlocks the next; parallel threads the player advances independently; and interwoven threads where a beat in one unlocks a beat in another.</title>
  <g font-size="12" fill="var(--sl-color-white)">
    <text x="8" y="16" font-weight="600">Linear</text>
    <text x="8" y="32" fill="var(--sl-color-gray-3)" font-size="11">each beat unlocks the next</text>
    <circle cx="20" cy="56" r="9" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <circle cx="80" cy="56" r="9" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <circle cx="140" cy="56" r="9" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <circle cx="200" cy="56" r="9" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <g stroke="var(--sl-color-gray-4)" fill="none">
      <path d="M29 56 H 71"/><path d="M89 56 H 131"/><path d="M149 56 H 191"/>
    </g>
    <text x="8" y="106" font-weight="600">Parallel threads</text>
    <text x="8" y="122" fill="var(--sl-color-gray-3)" font-size="11">advanced independently</text>
    <circle cx="20" cy="146" r="8" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 34%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <circle cx="76" cy="146" r="8" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 34%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <circle cx="132" cy="146" r="8" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 34%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <circle cx="20" cy="180" r="8" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <circle cx="76" cy="180" r="8" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <circle cx="132" cy="180" r="8" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <g stroke="var(--sl-color-gray-4)" fill="none">
      <path d="M28 146 H 68"/><path d="M84 146 H 124"/>
      <path d="M28 180 H 68"/><path d="M84 180 H 124"/>
    </g>
    <text x="350" y="16" font-weight="600">Interwoven</text>
    <text x="350" y="32" fill="var(--sl-color-gray-3)" font-size="11">a beat in one opens a beat in another</text>
    <circle cx="362" cy="70" r="8" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 34%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <circle cx="438" cy="70" r="8" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 34%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <circle cx="514" cy="70" r="8" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 34%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <circle cx="362" cy="150" r="8" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <circle cx="438" cy="150" r="8" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <circle cx="514" cy="150" r="8" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 30%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
    <g stroke="var(--sl-color-gray-4)" fill="none">
      <path d="M370 70 H 430"/><path d="M446 70 H 506"/>
      <path d="M370 150 H 430"/><path d="M446 150 H 506"/>
    </g>
    <g stroke="var(--sy-amber,#c8902f)" fill="none" stroke-dasharray="4 3">
      <path d="M438 78 V 142"/><path d="M514 142 V 78"/>
    </g>
    <text x="350" y="190" fill="var(--sl-color-gray-3)" font-size="11">dashed: one thread changing what the other can reach</text>
  </g>
</svg>

The craft is in the conditions: write them so that however the player wanders through, it still
reads like a story and not a heap of scenes.

## Cards that stick around, or do not

A beat should not always behave the same once it has been played. In Storylet Studio this is a
card's **redraw** setting:

- **One-shot** (`never`): plays once and it is gone. Your big plot turns.
- **Repeating** (`always`): comes back whenever its condition holds again. Ambient flavour,
  recurring faces.
- **Cooldown** (a number of turns): available again, but only after a while, so it can recur
  without hogging every hand.

## Priority

When more cards are eligible than there is room for, priority sets the running order. Give the
big moment, the dragon finally turning up, a high priority and it pushes to the front the
instant its condition is met, ahead of the everyday stuff.

Storylet Studio also breaks ties by how *specific* a card is, so the special case wins over the
general one without you having to number everything.
&rarr; [How a deal is decided](/play/dealing/)

## Content that fits the player

Conditions do not just gate the plot, they tailor it. The same moment can land differently for
a warrior than a thief, in winter than in summer, for a player who has been generous than one
who has been a menace. You write storylets whose conditions key off those facts, and everyone
gets the version that fits.

## Why build it this way

A few things come for free:

- **It grows cleanly.** New content is just new cards with the right condition on the front: a
  seasonal event, a new character class, a whole new region, dropped in without disturbing what
  is already there.
- **You can test it in pieces.** Each thread stands on its own.
- **It stays honest.** Eligibility is explicit, so the game only ever offers something that
  makes sense right now.

Open, reactive, ever-growing stories that still hang together. That is the appeal.

## Where to next

- [Core concepts](/concepts/): how Storylet Studio puts this to work, with the vocabulary the
  rest of the documentation uses.
- [Getting started](/getting-started/): install it and open a worked example.
- [The Village](/village/): a complete storylet project, playable in your browser.
- [Why Storylet Studio](/why/): whether this is the right tool for what you are building.
