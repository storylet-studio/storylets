---
title: Core concepts
description: The shared vocabulary of a Storylet Studio project on one page - box, deck, card, outcome, tags, hand, the Board, peek, deal and play, turns, the five scopes, and the engine and flow at runtime - with links to the detail.
sidebar:
  label: Core concepts
---

The whole model is a card game, and the words are the card game's words. Learn them once and
the editor, the files, the runtime API and the CLI all read the same way.

> A **box** holds **decks** of **cards**. Cards carry **tags** saying what they're about. A
> **hand** is a named place on the **board** that your game deals cards to. **Deal** a hand
> and the engine fills it with the cards that fit right now, best first. **Play** a card and
> the world remembers the **outcome** that was picked.

## Projects and files

A project is a folder of plain text files that you own and keep in version control: one file
per deck, a few per box, one for the project. There's no database and no server, so you can
diff it, merge it, zip it and send it. Storyletter and the CLI both respect your version
control's locks. &rarr; [The format](/format/overview/)

## Boxes, decks and cards

A **box** is a set of cards of one shape, with its own tags, hands, and ranking rules. A game with random encounters and chapter interludes gives each its own box, because they're dealt
differently.

A **deck** is a group of cards inside a box, one file each. The order of cards in a deck means
nothing: a deck is a pool, and which card comes up is decided when you deal. How you group decks is up
to you, but it might be a deck for a storyline, or a particular NPC, or a release batch (for example, our Hallowe'en
encounters).

A **card** is the unit of content. It carries a title and a purpose (for you and your team), a
**condition**, a **priority**, a **redraw** policy, its **tags**, **fields** for your
game, and its **outcomes**.

When you define the card shape for a box, you define
a list of **custom game fields** that will be attached to every card. 
So each card will carry whatever internal game data you want - a scene id, an
animation reference, a key into your own localisation. 

Putting content such as text on the screen is not the card's job, it's your game's
job (or [Patter](https://patterkit.dev)'s), so there's no localisation table to keep in
step. &rarr; [Designing cards](/storyletter/cards/)

## Outcomes

An **outcome** is a choice on a card. Playing it writes the outcome's changes into the state.
An outcome can have its own **condition**, and whether it's available is checked at the moment you ask,
not when the card was dealt.

## Hands, hand templates and the Board

A **hand** is a named place your game deals to for your game: "the inn", "encounters in the forest", "what's
next". It says which tags it wants (for example, `zone = forest` might mean "deal encounters in the forest to this
hand") and how many cards it holds (for example, a maximum of five things can be available at the same time in the forest). A **hand template** is a kind of hand you define once and reuse, choosing the tags per hand. Your game
asks the engine what's in a specific hand.

The **board** is everything currently dealt, across every hand. Hands change only when your
game deals them; nothing re-deals by itself when state changes. In Storyletter, [the
Board](/storyletter/board/) is the window where you play the project yourself.

## Tags and tag groups

A **tag group** is a named axis for sorting cards: zone, npc, trigger, act. Its **tags** are
declared values, so a typo is an error in the editor rather than a card that quietly never
comes up. A card that leaves a group blank matches any value of it.

Every box has a built-in **place** group whose tags are the box's hands, so a card tagged
`place: the-inn` comes up only there. That is the direct answer to "where does this card come
up?"; tagging it with a region instead says "anywhere in there".

## Peek, deal, play

Three calls from your game, and the difference between them matters:

- **`deal(hand)`** refreshes a hand and returns its cards. A dealt card is claimed: the same
  card can't sit in two hands at once, so a rumour can't be offered in two places.
- **`peek(box, tags)`** looks at what a box could deal for some tags, without dealing anything.
  Asking twice changes nothing.
- **`play(card, outcome, hand)`** applies an outcome. The card leaves its hand, the state is
  written, the cooldown starts and the clock advances.

What you do with a dealt hand is your call: show it as a menu, take the top card, pick one at
random. The engine has no opinion.

## Ranking

When more than one card fits, the engine puts them in order by:

1. **Priority**, a number you set. Higher goes first.
2. **How specific the card is**: a card whose condition asks for more beats one that asks for
   less, so the special case wins over the general one. On by default, switchable per box.
3. **Chance**, for anything still tied. Runs are seeded, so the same seed always gives the
   same order, in every runtime.

A hand with a slot limit takes the top few. &rarr; [How a deal is decided](/play/dealing/)

## Turns and redraw

Each box has its own **turn** counter, advanced by your game, so a combat box can tick at
combat pace while a chapter box ticks at story pace. A card's **redraw** policy says when it can
come back after being played: `always`, `never`, or after a number of that box's turns.

## The five scopes

State lives in exactly five places:

| Scope | What it holds |
|---|---|
| `@world` | Your game's own state, declared on the project. If you also run Patter, this is the state the two share. |
| `@story` | The story's internal global state - so cards in any box can share information with other cards. |
| `@box` | Properties declared on a box - so cards about encounters can share encounter information. |
| `@deck` | Properties declared on a deck - so if a deck is a storyline, it could have its own local properties. |
| `@hand` | The context of the current deal: the hand's own properties and the properties of the tags it binds. |

A bare `@name` in a condition means `@story.name`, like a global variable. Reading across scopes is always explicit:
`@world.gold`. &rarr; [Your game's state](/play/world-state/), and
[How a deal is decided](/play/dealing/#the-hand-scope) for what `@hand` is made of.

### Property types, and the one rule of thumb

A property is a **boolean**, a **number**, a **string**, an **enum** (one of a
fixed set), a **flags** set (any number of named facts), or a **quality**. The
rule of thumb that picks between the last two:

> **Facts are flags, stages are a quality.**

A **flags** property is a bag of *facts*. For example, you could store a flags
property called `@machine` with flag names `switched_on`, `plugged_in`, `settings_correct` 
and set and test those independently. So you could call `check_flags` to say
*do this thing if and only if the machine is switched on and plugged in, but the settings are not correct*.

A **quality** is the stage of one story, as an ordered ladder. A treasure hunt
might declare `treasure` with the stages `no_idea`, `heard_of`, `found_map`,
`found_x` and `dug_it_up`, in that order, and the order is the meaning.

Its value is always exactly one stage, gates can ask about position
(`@deck.treasure >= "found_map"` means at that stage or past it,
`@deck.treasure == "no_idea"` means not started), and an outcome moves it with
`advance(@deck.treasure)`, one rung at a time. That
is what makes inserting a new stage safe later: the outcomes never name their
destination, so play routes through whatever the ladder now says is next.

A project usually wants many small qualities, not one big one. Anything that
is not genuinely a sequence should stay a flag. The **Hamlet** example shows the
pair side by side: **Gareth's Debt** runs on a `debt` quality with a `helped`
fact next to it, and **Mira's Secret**, whose beats can land in any order, stays
on flags. &rarr; [Property types](/format/property-types/) takes all six in
turn, with the enum-or-flags and flags-or-quality questions worked through.

## Bundles and saves

A build compiles the whole project into a **bundle**, one `.storyletsc` file, and that's the
only thing you ship.

A whole run saves its state to a `.storyletsave` file: every property, every turn
counter, what's on the table and what's been played. Load it back and the run carries on
exactly where it was, in any runtime. Very useful for debugging. &rarr; [The bundle and the save](/format/bundle/)

## The runtime family

A bundle is played by a **Storylet Engine** runtime. There's one per engine: JavaScript,
Unity, Unreal and Godot. Every runtime plays a bundle the same way, down to the random draws,
and a [shared test suite](/compatibility/) keeps them honest.
&rarr; [Playing in your game](/play/overview/)

## Engine and flow

At runtime there are two objects. The **engine** holds the bundle, `@world` and the state
every playthrough shares. A **flow** is one playthrough across it, opened by name, and every
deal, peek and play happens on a flow. A single-player game opens one and forgets about it.
An experience with many participants opens one flow each, all over the same shared world, and
a property's declaration says which side of that line it falls on.
&rarr; [Your game's state](/play/world-state/#shared-or-per-flow)
