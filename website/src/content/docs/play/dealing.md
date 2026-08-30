---
title: How a deal is decided
description: What happens when your game deals a hand - the checks every card goes through, in order, how the survivors are ranked, how copies and claims work, turns and cooldowns, and what the @hand scope is made of.
sidebar:
  label: How a deal is decided
---

[Core concepts](/concepts/) gives you the words. This page is the mechanics behind `deal`
and `peek`: exactly which cards are considered, in what order, and why a card that looks
right sometimes doesn't come up. It's the page to read when the Board's **Not listed · why**
fold names a reason and you want to know what that reason means.

## The stock

At any moment, each box has a **stock**: every card that could be dealt right now, in ranking
order. It isn't stored anywhere; the engine works it out whenever you ask, and it changes as
state changes. A `peek` shows you the top of the stock; a `deal` takes cards from it into a
hand.

## The checks, in order

When your game deals a hand, the **hand's own condition** is checked first, once. If it
fails, nothing is dealt and no card is looked at, so the trace for that deal is empty rather
than a list of refusals. (A peek has no hand condition.)

Every card in the box then goes through the same checks, in this order, and stops at the
first one it fails:

1. **Deck gate**: the card's deck has a condition and it's false.
2. **Cooldown**: the card was played recently and its redraw policy says not yet.
3. **Tags**: the card's tags don't match what the hand asked for.
4. **Condition**: the card's own condition is false.
5. **Claims**: every copy of the card is already sitting in some hand.

<svg viewBox="0 0 720 210" role="img" aria-labelledby="sy-avail-title" style="width:100%;height:auto;font-family:var(--sl-font,sans-serif)">
  <title id="sy-avail-title">A deal first checks the hand's condition once; if it passes, every card goes through five checks in order - deck gate, cooldown, tags, its own condition, and claims - and stops at the first one it fails. Whatever survives is ranked, and the top of that is the stock.</title>
  <defs>
    <marker id="sy-a-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="var(--sl-color-gray-3)"/></marker>
  </defs>
  <rect x="8" y="14" width="150" height="40" rx="8" fill="color-mix(in oklab, var(--sy-amber,#c8902f) 14%, var(--sl-color-bg-sidebar))" stroke="var(--sy-amber,#c8902f)"/>
  <text x="83" y="32" text-anchor="middle" fill="var(--sl-color-white)" font-size="13">hand condition</text>
  <text x="83" y="47" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10.5">once, for the whole deal</text>
  <line x1="158" y1="34" x2="196" y2="34" stroke="var(--sl-color-gray-3)" marker-end="url(#sy-a-arrow)"/>
  <text x="177" y="26" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10">fails</text>
  <text x="177" y="52" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="10">passes</text>
  <text x="205" y="38" fill="var(--sl-color-gray-3)" font-size="11.5">nothing is dealt</text>
  <text x="8" y="92" fill="var(--sl-color-gray-2)" font-size="11.5">every card, in order:</text>
  <g font-size="12" text-anchor="middle">
    <rect x="8" y="104" width="118" height="34" rx="7" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
    <text x="67" y="126" fill="var(--sl-color-white)">deck gate</text>
    <rect x="140" y="104" width="106" height="34" rx="7" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
    <text x="193" y="126" fill="var(--sl-color-white)">cooldown</text>
    <rect x="260" y="104" width="84" height="34" rx="7" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
    <text x="302" y="126" fill="var(--sl-color-white)">tags</text>
    <rect x="358" y="104" width="106" height="34" rx="7" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
    <text x="411" y="126" fill="var(--sl-color-white)">condition</text>
    <rect x="478" y="104" width="92" height="34" rx="7" fill="var(--sl-color-bg-sidebar)" stroke="var(--sl-color-gray-5)"/>
    <text x="524" y="126" fill="var(--sl-color-white)">claims</text>
    <rect x="584" y="104" width="128" height="34" rx="7" fill="color-mix(in oklab, var(--sy-plum-tint,#9a89b5) 16%, var(--sl-color-bg-sidebar))" stroke="var(--sy-plum-tint,#9a89b5)"/>
    <text x="648" y="126" fill="var(--sl-color-white)">ranked: the stock</text>
  </g>
  <g stroke="var(--sl-color-gray-3)" marker-end="url(#sy-a-arrow)">
    <line x1="126" y1="121" x2="136" y2="121"/><line x1="246" y1="121" x2="256" y2="121"/>
    <line x1="344" y1="121" x2="354" y2="121"/><line x1="464" y1="121" x2="474" y2="121"/>
    <line x1="570" y1="121" x2="580" y2="121"/>
  </g>
  <g stroke="var(--sl-color-gray-4)" stroke-dasharray="3 3">
    <line x1="67" y1="138" x2="67" y2="170"/><line x1="193" y1="138" x2="193" y2="170"/>
    <line x1="302" y1="138" x2="302" y2="170"/><line x1="411" y1="138" x2="411" y2="170"/>
    <line x1="524" y1="138" x2="524" y2="170"/>
  </g>
  <text x="290" y="188" text-anchor="middle" fill="var(--sl-color-gray-3)" font-size="11.5">a card stops at the first check it fails, and the trace names that one</text>
</svg>

The order matters when you're debugging. The trace reports the **first** check a card
failed, so a card that's both outside its deck's gate and on cooldown is reported as
`deck-gate`, and fixing the cooldown won't make it appear.

If a condition can't be evaluated at all (it reads a property that doesn't exist, say), the
card is treated as unavailable and the reason is recorded. It never quietly passes.

## Ranking the survivors

The cards that pass every check are put in order by:

1. **Priority**: a number you set on the card, or an expression that works one out. Higher
   goes first.
2. **Specificity**: a card whose condition asks for more beats one that asks for less, so
   the special case wins over the general one. It's on by default and you can switch it off
   per box, in which case priority decides outright.
3. **Chance**, for anything still tied. The random numbers are seeded, so the same seed
   gives the same order every time, in every runtime.

A hand with a slot limit takes the top few. With no state change between two deals, you get
the same cards.

## Copies and claims

There's one copy of every card unless the card says `copies: N`. A dealt card is **claimed**
by the hand holding it, so a card sits in at most one hand at a time (and at most once in any
one hand), exactly as a physical card can't be in two places at once.

You don't configure this. `deal` claims; `peek` only respects the claims that exist. Playing a
card removes it from its hand and releases its claim; the slot stays empty until that hand is
next dealt.

This is what makes the "one rumour, offered wherever the player goes first" pattern free:
write one card, and whichever hand deals it first has it.

Claims live on the **flow**, so "at most one hand at a time" means at most one hand in that
playthrough. Run [several flows](/play/world-state/#shared-or-per-flow) and a `copies: 1` card
is on two participants' boards at once, because each of them is playing their own copy of the
deck.

**Unless you say otherwise.** Mark a deck (or a single card) **`shared`** and its claims count
across every flow instead: one goblin in the whole world, held by whoever was dealt it first,
and nobody else can be dealt it until they play it or it leaves their board. `sharedCopies`
sets how many may be out anywhere, defaulting to `copies`, so `copies: 1, sharedCopies: 5` is
five golden tickets with one to a customer. A card refused because somebody else holds it says
so: the trace verdict is `claimed-elsewhere`, not `claimed`, because your own board has room.

A single-flow game never sees any of this: with one playthrough open, a shared claim and a
per-flow one are the same thing.

## Turns and cooldowns

The clock is the **turn**, and each box has its own. Your game advances a box's turns; a
`play` also advances the played card's box by the project's configured amount (one by default,
and you can override it per call). Nothing here runs off a frame: a turn is whatever your
game says it is.

A card's `redraw` policy is its cooldown, measured in its own box's turns: `always` (no
cooldown), `never` (a one-shot), or a number N (unavailable for N of that box's turns after
it's played). Cooldowns start when a card is played, not when it's dealt, and a peek never
touches any clock.

Clocks and cooldowns are per flow as well: advancing a box in one flow moves nothing in
another, and a one-shot spent by one participant is still there for the next.

On a **shared** card, `redraw: never` is the exception: the first participant to play it takes
it out of the world for everyone, permanently, and the others are told `taken` rather than
`cooldown` (they have no cooldown; it simply is not there any more). A *finite* `redraw` stays
personal even on a shared card, and that combination is a good rule rather than a gap: the
goblin goes straight back in the pool for whoever is next, while the participant who just
fought it waits their own three turns. There is no shared clock to count anything else
against, so a world-wide timer belongs in `@world`, where your game already keeps the time
(`@world.now >= @world.goblin_returns_at`).

## Hand templates

A hand template is a kind of hand you define once: "NPCs you can talk to" fixes some tags,
leaves others for each hand to choose, and carries one condition that's written once and
evaluated for each hand against that hand's own `@hand`. Edit the template and every hand
that uses it follows. A hand can override only its slot count. A hand can also stand alone,
with its own tags, condition and slots written directly on it.

Your game never names a template; it deals hands.

## The `@hand` scope

`@hand` is put together fresh for each deal, from three sources, later ones overriding
earlier ones where names collide:

1. **The properties of every tag the hand binds.** These are usually declared on the tag
   group, so every tag in it has them, and each tag sets only its own starting value; a
   single tag can also declare its own. Either way, a hand bound to `zone = forest` sees
   `@hand.peril`.
2. **The hand's own properties**, declared on the hand or its template.
3. **What the deal or peek asked for**, by group name: `peek("village", { npc: "elder" })`
   makes `@hand.npc` read `elder`. A hand that pins a group itself reads the same way.

Every name remembers where it came from, so a write goes back to the right place:
`@hand.peril = @hand.peril + 1` raises the peril of the zone the card was dealt into. That's
how place-like state works without a separate scope for places. A [quality](/format/property-types/#quality-the-stage-of-a-story)
works the same way, so each place can sit at its own stage of one shared ladder, and
`advance(@hand.haunting)` moves only the place the hand belongs to.

`@hand` names are checked when you publish, the same as any other scope: a misspelt
`@hand.perl` is an error rather than a card that quietly never comes up, and a comparison
against the wrong type or a stage that isn't on the ladder is caught too. What can't be
worked out ahead of time is which hand will be asking, so the
[Links window](/storyletter/workspace/#links) and `storyletengine links` still leave
`@hand` relationships out rather than guess. One name is read-only: a group's own name is
what the hand asked for, so writing `@hand.zone` is refused.

## Reading the trace

Every deal and peek emits a trace event listing each card the engine considered and the
reason it was kept or dropped: `dealt`, `capped` (ranked but outside the hand's slots),
`cooldown`, `deck-gate`, `tags`, `condition`, `priority`, `claimed`,
`claimed-elsewhere` (another playthrough holds the world's copies) and `taken` (a shared
one-shot spent, by anyone, for everyone). The Board's **Not
listed · why** fold shows it; in your game, `subscribeTrace` streams it and a retained log
keeps it. &rarr; [Dev tools](/play/dev-tools/)
