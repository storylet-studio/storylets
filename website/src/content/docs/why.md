---
title: Why Storylet Studio
description: What a storylet system is for, what Storylet Studio gives you over rolling your own, how it sits beside Ink, Yarn Spinner and Patter, and when it isn't the right call.
sidebar:
  label: Why Storylet Studio (and how it compares)
---

This page is for the person deciding whether to bring Storylet Studio to their team: what it's
for, what it gives you that a pile of `if` statements doesn't, and where it sits beside the
tools you've probably already got.

The short version: Storylet Studio is **indie-first, but team-ready**. Your content is plain
files you own, your designers work in an editor that needs no code and no wiring, and one
small compiled file plays in the engine you ship on (JavaScript, Unity, Unreal or Godot)
exactly as it played in the editor. It leans on your existing version control rather than a
server, and because the format is built around the merge, it scales from one designer to a
team on git or Perforce. And it's open source, MIT-licensed and free.

## The question

Your game reaches a moment and needs to ask: **given everything that's happened, what should
happen here, now?**

You could answer that with a branching script (and perhaps <a href="https://patterkit.dev" target="_blank">for a conversation you should</a>). But some
content isn't a branch. It's a pool: encounters on a road, rumours in a tavern, quest offers
at a noticeboard, interludes between chapters. Dozens of small self-contained beats, each
with its own conditions, each competing to be the one that fires.

Wire that as branches and you get a complicated tree that spirals and is hard to debug and expand. Wire
it as `if` statements in your game code and the designers can't touch it. A storylet system
is the third answer: the beats are data with attached conditions, the question is one call, and the answer comes back
ranked.

## What you'd decide with it

Different games will need different features, and storylets can help in different places. 
Each of these is the same call into the same engine, and a team usually ships several of them at once, one box each:

- **Which scene of your story should play now.** The spine of a chaptered game: dramatic
  scenes, interludes, pay-offs, each a card that says when the story's ready for it. A new
  scene is a new card with a rule, not a rewire of what's already there.
- **Which conversation topics an NPC should offer.** A deck per character, a card per topic,
  each gated on what the player knows and has done. A topic that's been raised stays raised;
  a standing offer keeps coming back until the player takes it.
- **Which encounters should spawn in a particular location.** Every place on your map deals
  its own hand from a shared pool, so the roadside ambush turns up on roads, once, and never
  in two places on the same night.
- **Which items should spawn to be picked up.** There's one copy of a unique reward, so it
  can't be found twice; common pickups say how many of them exist. What's already been taken
  stays taken, without an inventory of flags.
- **Which quests or jobs should be offered to your player.** The noticeboard, the guild
  ledger, the stranger with a proposition: offers gated on reputation and progress, each one
  claimed once, and the ones that went untaken still there next visit.
- **Which characters you can meet in the town.** Who's around follows the state of the story:
  the moneylender turns up once the debt's overdue, the ranger only after you've heard the
  rumour, and either can carry their own topics deck when they do.
- **What bark line should play right now.** You can do this with storylets, 
  but [Patter](https://patterkit.dev) is built for performed dialogue: if you run both, 
  it's the better home for them, and the two share one picture of the world.
- **What lore should appear in your player's codex.** Unlock rules as conditions: the codex
  fills itself in as the player earns each entry, and coverage testing tells you which entries
  nothing in the game can ever unlock.

And none of it assumes a screen. The runtime is a small library that runs wherever your
show runs, so an immersive or interactive event can ask the same question from a stage
manager's laptop or an operator's tablet:

- **What topic your actor should raise with this visitor, right now.** Each visitor is a
  run of their own, so what they've seen and done gates what an actor takes to them next,
  and a revelation that's been delivered stays delivered.
- **Where to send your visitor next.** Rooms and stations as places, each dealing from the
  pool of what's ready: nobody's sent to a scene that's already claimed, and the quiet room
  gets the visitor the busy one can't take.

If your version of the question isn't listed, the shape to check for is the same: a pool of
self-contained possibilities, each with a rule for when it applies, and one moment where
someone, or something, has to pick. If that's what you have, it fits.

Storyletter ships this list made concrete: **Port Meridian**, a mini action-game demo
where contracts, street encounters, found items, a codex and city news screens are five
boxes of one project, driven by one shared spine of story state. The game it assumes
carries all the actual gameplay; the storylets only ever answer "what belongs here, now?"

## What you get

**One question, not a tree.** Ask what could happen here, and you get back the beats that
fit, best first. Adding a new beat means designing one more card and saying when it applies.
You never rewire anything.

**Cards in any order, from any number of people.** A deck is a pool, not a running order, so
where a card sits in the file means nothing. Two designers can add cards to the same deck at the
same time without their work colliding, which is the thing that usually makes shared story
files painful.

**Nothing repeats unless you say so.** There's one copy of every card, so the same rumour
can't be offered in two places at once, and a card that's been played stays away for as long
as you said. You get that without setting a flag.

**An order you can predict.** The most important card first, then whichever one's conditions
are the most specific, then chance. Start from the same seed and you get the same run every
time, in every engine.

**An answer to "why didn't that happen?"** Every time you ask, the engine records what it
looked at and why each card was passed over. When a beat doesn't show up, it tells you which
rule stopped it, in the editor and in your game's log.

**Dead content found before players find it.** [Coverage testing](/production/coverage-testing/)
plays the project hundreds of times and lists every card nothing ever reached and every outcome
nobody ever took. It runs from the command line too, so you can fail a build on it.

**Files you own, in your version control.** A project is a folder of plain text files, one
per deck, in git or Perforce or whatever you already use. No database, no server, no export
step to get your work out.

## What it leaves to you

**The player never reads a card.** A card says when a beat applies, how it ranks and what it
changes. The presentation of your beat belong to your game, or to Patter. So there's no translation
system here to work around and no second list of strings to keep in step.

**It doesn't choose for you.** You get a list back, in order. Whether you show it as a menu,
take the top one, or pick at random is your call.

**It doesn't change its mind behind your back.** What's on the table changes when you ask for
a new hand, and at no other time.

**The map is up to you.** You can tag cards to belong to notional places on a map, and Storyletter can give
you a way to visualise it - but that could be a physical space, or a timeline, or a series of concepts; the
geography of this is entirely up to you.

## How it compares

Nothing else in the usual toolbox is built for storylets first, so the honest comparison is
with the two things teams actually do instead.

**Rolling your own.** Most games start here: a `switch`, then a list of conditions, then a
spreadsheet a designer edits and a programmer imports. It works until the content outgrows
the people who can read the code. Storylet Studio gives you the same loop as data your
designers own, with the ranking, exclusivity, cooldowns, saves and the "why didn't it fire?"
answer already written and tested, and a place to edit it that isn't a spreadsheet.

**Branching it instead.** Ink, Yarn Spinner, articy and Patter are all excellent at the
branching conversation, and you can bend any of them into a pool of beats (Ink with lists and
a hub knot; Yarn Spinner 3 with node groups and saliency). If your pool is small and already
lives in your script, stay where you are. If choosing the next beat from a pool is the spine
of your game, a tree whose only job is to re-ask the same question is the wrong shape, and
this is the tool for it.

**Alongside Patter.** [Patter](https://patterkit.dev) is the sibling project: branching,
performed dialogue with a stable id per line. **You don't need it.** Storylet Studio knows
nothing about Patter and nothing in a card refers to it unless you put something there
yourself. What the two share is your game's state: both read and write the same `@world`
values, so a conversation running in Patter and a beat chosen here work from one picture of
the world. If you run both, the division that works is that Storylet Studio decides which
beat happens and Patter performs it. Barks are the clearest case: you can write them as cards
here, but if you already have Patter it's the better home for them.

## When it's not the right call

- You're writing a **conversation**: a scene with lines, choices and a shape. That's a
  branching tool's job, and [Patter](https://patterkit.dev), Ink or Yarn Spinner will feel right.
- Your beats carry **the words themselves** and you need them localised and voiced. Cards
  hold no text; pair this with [Patter](https://patterkit.dev), or keep the text in your own system and 
  put its key on the card.
- You need live, Google-Docs-style **co-editing** of one deck. Storylet Studio leans on your
  version control (with a structured merge that combines edits rather than colliding), which
  scales to a big team but is check-out-and-merge, not simultaneous.

## Where to start

- [Getting started](/getting-started/) is the path from download to a hand dealt in your game.
- [Core concepts](/concepts/) is the vocabulary on one page.
- Evaluating for a team? Skim [Playing in your game](/play/overview/) for the integration
  story on your engine, and [Version control](/setup/version-control/) for how a team shares
  a project.
