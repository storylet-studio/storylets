---
title: Property types
description: The six kinds of state a project can hold - boolean, number, string, enum, flags and quality - what each one is for, and how to tell the close pairs apart.
sidebar:
  label: Property types
---

Every property you declare has a type. Six of them cover everything a story
needs to remember, and most of the work is knowing which one a piece of state
actually is. Two pairs are easy to mix up, so they get most of this page:
**enum against flags** (one of these, or any of these) and **flags against
quality** (facts against stages).

Types are declared per scope, and where you declare something matters as much
as what type it is. See [Your game's state](/play/world-state/) for the scopes
themselves.

## The six types

| Type | Holds | Example |
|---|---|---|
| `boolean` | true or false | `has_lantern` |
| `number` | any number | `reputation`, `gold` |
| `string` | free text | `chosen_name` |
| `enum` | exactly one of a fixed list | `weather`: clear, rain, storm |
| `flags` | any number of named facts, in any combination | `rel_mira`: met, warm, trusts_player |
| `quality` | exactly one stage of an ordered ladder | `debt`: quiet, troubled, confronted |

## Boolean, number, string

Reach for these when the answer is obvious. A boolean is one fact that is
either true or not: `has_lantern`, `door_open`. A number counts or measures:
`reputation`, `coins`, `nights_survived`. A string holds text the player or
the game supplied, like a name.

The trap is the number that isn't really a number. If nothing ever does
arithmetic on it, and its gates are all comparisons against the same two or
three landmarks, it wants to be a quality. More on that below.

## Enum: one of these

An enum is a property whose value is exactly one of a list you fix in advance.
The weather is clear or raining or storming, never two at once and never
"drizzle" unless you added drizzle. In the Properties list you'd declare it as
`weather`, pick **enum**, and add the values `clear`, `rain` and `storm` as
chips; the default is picked from that same list.

Why bother, when a string would hold the same word? Because the list is
checked. Write `@world.weather == "rein"` and the project refuses to compile,
naming the typo. A string would have accepted it and quietly never matched,
which is the kind of bug that survives to release, because a condition that is
merely never true looks exactly like content nobody reached yet.

Use an enum when the states are **mutually exclusive and unordered**: weather,
a chosen faction, which of three endings a scene took.

## Flags: any of these

A flags property holds a set of named facts, any number of them at once, in any
combination: declare `rel_mira`, pick **flags**, and name the flags as chips,
say `met`, `warm`, `trusts_player` and `reported`. Every flag starts unset.

You test them with `check_flags(@story.rel_mira, +warm)` and set them with
`set_flags(@story.rel_mira, +trusts_player)`. Nothing is implied about order:
you can be `warm` without being `met` if your story allows it, and a card can
ask about one flag while ignoring the rest.

Use flags when the facts **accumulate independently**. Relationships are the
classic case: met, warm, owes you a favour, saw you lie. So is a set of clues,
or a list of places visited. In the Village example, Forging a Legend needs
mountain iron and crystal shards, gathered in either order, so those are two
flags and not two stages.

**Enum or flags?** Ask whether two of them can be true at once. If yes, flags.
If the property can only ever be one of them, enum.

## Quality: the stage of a story

A quality is an **ordered ladder of named stages**, and its value is always
exactly one of them. Declare `debt`, pick **quality**, and add the stages in
story order: `quiet`, then `troubled`, then `confronted`. The order you give
them IS the ladder, which is why the stage chips can be reordered and the
other lists can't, and the default is the first stage unless you pick another.

The order is the point, so conditions can ask about position rather than
listing names:

- `@deck.debt == "troubled"` means exactly there
- `@deck.debt >= "troubled"` means at that stage or past it
- `@deck.debt < "confronted"` means not that far yet

and an outcome moves it with `advance(@deck.debt)`, one rung, without naming
where it lands.

That last detail is what makes a quality safe to edit later. Because no outcome
names its destination, you can insert a stage into the middle of the ladder in
production and every existing card still works: play routes through whatever
the ladder now says comes next, and saved games carry on, because a quality is
stored as its stage **name**, not as a position.

Use a quality for the spine of an arc: the thing that only moves forwards,
one step at a time.

A quality can be declared in any scope, including on a tag. A tag ladder is
worth knowing about: `@hand` is assembled fresh for each deal from whichever
tags that hand binds, so a quality declared on a tag group gives every place
its own copy of the same ladder. One card can then say
`@hand.haunting >= "screaming"` and mean "wherever I am, if it's got that bad",
and an outcome's `advance(@hand.haunting)` moves the stage of the place the
hand belongs to, leaving every other place alone.

### Why not just a number?

This is the most common shape a quality replaces, and the Village example
shipped with a real one. A curse was a number, and its cards were gated like
this:

```
@deck.curse_intensity >= 2
@deck.curse_intensity < 2
```

Two. Nothing on that line says what two means, so to change anything you first
read every outcome in the deck to work out what counts and how high it goes.
The same gates as a quality:

```
@deck.curse >= "spreading"
@deck.curse < "spreading"
```

Same behaviour, but the condition now says what the story is doing, a stage
name that does not exist is a compile error where a wrong number never could
be, and `advance()` replaces `+ 1`, so nobody has to remember the ceiling.

### Why not just an enum?

An enum can hold the same three words. What it can't do is compare them. With
an enum, "at the confrontation or past it" has to be written out as
`@deck.debt == "confronted" || @deck.debt == "resolved"`, and every time you
add a stage you must find and extend every one of those lists. A quality asks
`>= "confronted"` and keeps working.

So: **enum for a state, quality for a stage.** If asking "or past it" makes
sense, it's a quality.

## Facts are flags, stages are a quality

The rule of thumb that settles most cases:

> A flag records **that something happened**. A quality records **how far
> along a story is**.

Both examples ship with the two side by side, on purpose. In the Hamlet,
Gareth's Debt runs on a `debt` quality, with a plain `helped` boolean next to
it recording which ending you chose. Mira's Secret, whose beats can land in
any order, stays entirely on flags.

Two warnings from doing this at scale on the Village:

**Don't build one big quality.** A project wants many small ladders, one per
arc, not a single `game_progress` with forty stages. The moment two things can
be true at once, or two threads advance independently, a single ladder starts
lying about your story.

**Not everything that looks sequential is.** In the Village, The Haunted Miners
reads like a spine until you notice you can reach the middle of it two ways,
without the beat that appears to come first. A deck with two entrances to the
same middle has no single order to name, so it stays on flags. The test isn't
whether the beats have a natural order in your head; it's whether play can
only ever visit them in that order.

## Choosing, in one pass

1. Is it just true or false? **boolean**.
2. Do you do arithmetic on it, or show the number to the player? **number**.
3. Is it text you didn't choose in advance? **string**.
4. Can several be true at once? **flags**.
5. Is it one of a fixed set, where "or past it" is meaningless? **enum**.
6. Is it one of a fixed set that only moves forwards, where "or past it" is
   exactly what you want to ask? **quality**.

The Properties list offers all six wherever state is declared, and every
declaration's row expands to hold a **purpose**: one line saying what the
property is for, which becomes the hover tip on its pills wherever a condition
or outcome names it. The file shape behind a declaration is in
[The shards](/format/shards/) if you're working with the files directly. The compiler checks whatever you pick: unknown stage names, unknown enum values and unknown flag names are
all errors before you ever run the project. Anything it can't catch statically,
like a stage that nothing ever advances, comes back from
[Coverage](/production/coverage-testing/).
