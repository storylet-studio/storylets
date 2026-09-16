---
title: Property types
description: Pick the right type for each piece of state, from boolean and number to enum, flags, and quality, and tell the close pairs apart.
sidebar:
  label: Property types
---

Every property you declare has a type, and six of them cover everything a project needs to
remember. Most of the work is deciding which one a piece of state actually is. Two pairs
are easy to mix up, and they take most of this page. An enum against flags is "one of
these" against "any of these", and flags against a quality is facts against stages.

Types are declared per scope, and where you declare something matters as much as what type
it is. [Your game's state](/play/world-state/) covers the scopes themselves.

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

These three are the ones you reach for when the answer is obvious. A boolean is a single
fact that is either true or not, like `has_lantern` or `door_open`. A number counts or
measures, like `reputation`, `coins`, or `nights_survived`. A string holds text that the
player or the game supplied, such as a name.

The trap is the number that isn't really a number. If no outcome ever does arithmetic on
it, and every card that gates on it compares it against the same two or three landmarks,
it wants to be a quality. That case has a section of its own below.

## Enum: one of these

An enum holds exactly one value from a list you fix in advance. The weather is clear, or
raining, or storming, and never two at once. It's never "drizzle" either, unless you added
drizzle. In the Properties list you declare `weather`, pick **enum**, and add the values
`clear`, `rain`, and `storm` as chips. The default is picked from that same list.

A string would hold the same word, so the reason to bother is that the list is checked.
Write `@world.weather == "rein"` on a card and the project refuses to compile, naming the
typo. A string would have accepted it, and the condition would quietly never have matched.
That is the kind of bug that survives to release, because a card whose condition is merely
never true looks exactly like a card nobody has reached yet.

Use an enum when the states are **mutually exclusive and unordered**. The weather, a chosen
faction, and which of three endings a scene took are all enums.

## Flags: any of these

A flags property holds a set of named facts, any number of them at once, in any
combination. Declare `rel_mira`, pick **flags**, and name the flags as chips, say `met`,
`warm`, `trusts_player`, and `reported`. Every flag starts unset.

A card tests them with `check_flags(@story.rel_mira, +warm)` and an outcome sets them with
`set_flags(@story.rel_mira, +trusts_player)`. Nothing is implied about order. You can be
`warm` without being `met` if your story allows it, and a card can ask about one flag while
ignoring the rest.

Use flags when the facts **accumulate independently**. A relationship is the classic case,
with met, warm, owes you a favour, and saw you lie all able to hold at once. A set of clues
is another, and so is a list of places visited. In the Village example, Forging a Legend
needs mountain iron and crystal shards, gathered in either order, so those are two flags
and not two stages.

To choose between enum and flags, ask whether two of the values can be true at once. If
yes, flags. If the property can only ever be one of them, enum.

## Quality: the stage of a story

A quality is an **ordered ladder of named stages**, and its value is always exactly one of
them. Declare `debt`, pick **quality**, and add the stages in story order, `quiet`, then
`troubled`, then `confronted`. The order you give them IS the ladder. That is why the stage
chips can be reordered and the other lists can't, and the default is the first stage unless
you pick another.

The order is the point, so a card's condition can ask about position rather than listing
names.

- `@deck.debt == "troubled"` means exactly there
- `@deck.debt >= "troubled"` means at that stage or past it
- `@deck.debt < "confronted"` means not that far yet

An outcome moves it with `advance(@deck.debt)`, one rung, without naming where it lands.

That last detail is what makes a quality safe to edit later. No outcome names its
destination, so you can insert a stage into the middle of the ladder in production and
every existing card still works. Play routes through whatever the ladder now says comes
next, and saved games carry on, because a quality is stored as its stage **name** rather
than as a position.

Use a quality for the spine of an arc, the thing that only moves forwards, one step at a
time.

A quality can be declared in any scope, including on a tag, and a tag ladder is worth
knowing about. `@hand` is assembled fresh for each deal from whichever tags that hand
binds, so a quality declared on a tag group gives every place its own copy of the same
ladder. One card can then say `@hand.haunting >= "screaming"` and mean "wherever I am, if
it's got that bad", and an outcome's `advance(@hand.haunting)` moves the stage of the place
the hand belongs to, leaving every other place alone.

### Why not just a number?

A number is the most common shape a quality replaces, and the Village example shipped with
a real one. A curse was a number, and its cards were gated like this:

```
@deck.curse_intensity >= 2
@deck.curse_intensity < 2
```

Two. Nothing on that line says what two means, so before you change anything you first
read every outcome in the deck to work out what counts and how high it goes. Here are the
same gates as a quality:

```
@deck.curse >= "spreading"
@deck.curse < "spreading"
```

The behaviour is the same, but the condition now says what the story is doing. A stage name
that doesn't exist is a compile error where a wrong number never could be, and
`advance()` replaces `+ 1`, so nobody has to remember the ceiling.

### Why not just an enum?

An enum can hold the same three words. What it can't do is compare them. With an enum, "at
the confrontation or past it" has to be written out as
`@deck.debt == "confronted" || @deck.debt == "resolved"`, and every time you add a stage
you must find and extend every one of those lists. A quality asks `>= "confronted"` and
keeps working.

So the rule is **enum for a state, quality for a stage**. If asking "or past it" makes
sense, it's a quality.

## Facts are flags, stages are a quality

The rule of thumb that settles most cases:

> A flag records **that something happened**. A quality records **how far
> along a story is**.

Both example projects ship with the two side by side, on purpose. In the Hamlet, Gareth's
Debt runs on a `debt` quality, with a plain `helped` boolean next to it recording which
ending you chose. Mira's Secret, whose beats can land in any order, stays entirely on
flags.

Doing this at scale on the Village taught two lessons.

Don't build one big quality. A project wants many small ladders, one per arc, and never a
single `game_progress` with forty stages. The moment two things can be true at once, or two
threads advance independently, a single ladder starts lying about your story.

Not everything that looks sequential is. In the Village, The Haunted Miners reads like a
spine until you notice you can reach the middle of it two ways, without the beat that
appears to come first. A deck with two entrances to the same middle has no single order to
name, so it stays on flags. The test isn't whether the beats have a natural order in your
head. It's whether play can only ever visit them in that order.

## Choosing, in one pass

1. Is it just true or false? **boolean**.
2. Do you do arithmetic on it, or show the number to the player? **number**.
3. Is it text you didn't choose in advance? **string**.
4. Can several be true at once? **flags**.
5. Is it one of a fixed set, where "or past it" is meaningless? **enum**.
6. Is it one of a fixed set that only moves forwards, where "or past it" is
   exactly what you want to ask? **quality**.

The Properties list offers all six wherever state is declared, and every declaration's row
expands to hold a **purpose**, one line saying what the property is for, which becomes the
hover tip on its pills wherever a condition or outcome names it. The file shape behind a
declaration is in [The shards](/format/shards/) if you're working with the files directly.
The compiler checks whatever you pick. Unknown stage names, unknown enum values, and
unknown flag names are all errors before you ever run the project. Anything it can't catch
statically, like a stage that nothing ever advances, comes back from
[Coverage](/production/coverage-testing/).
