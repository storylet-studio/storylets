---
title: Your game's state
description: How your game feeds its own state into the story - declaring @world, writing it before you deal, and the property paths every runtime shares.
sidebar:
  label: Your game's state
---

The story asks questions about your game: is it night, does the player have the key, how
much gold. **`@world`** is where those answers live. It's the set of properties your game
owns and the story's conditions read, and it's usually the first thing you wire up after
loading a bundle.

Everything on this page is the same in all four runtimes. Only the spelling changes.

## Declaring it

`@world` properties are declared on the **project**, in Project Settings, with a name, a type
and a default. Declaring is the designer's half: it tells the editor which names exist, so a
condition can be checked as it's written and a typo is caught when the bundle is published,
not in your game.

Your game doesn't declare anything. It fills in what's already declared.

```
@world.is_night   boolean  default false
@world.gold       number   default 0
@world.chapter    string   default "one"
```

A name that isn't declared can't be referenced: the compiler refuses `@world.isNight` if
nothing declares `isNight`. Property names are lower case (see [the format](/format/shards/)).

## Binding it

`@world` lives on the **engine**, and every flow sees the same values - it's the game's own
state, and the game is one thing however many playthroughs run over it. You can hand the
engine a resolver when you build it (`new Engine(bundle, { world: { get, set } })`), so
conditions read your live game state directly; or hand it nothing, and the engine backs
`@world` itself from the declared defaults, which is fine for most games.

## Writing it from your game

Before you deal, tell the flow what's true:

```js
flow.setProperty("world.is_night", true);
flow.setProperty("world.gold", 120);

const dealt = flow.deal("tavern-encounters");
```

Note the path form: **`world.is_night`, not `@world.is_night`.** The `@` belongs to the
expression language a designer writes in; the API takes a plain path. The paths are:

| Path | Reaches |
|---|---|
| `world.<name>` | your game's state |
| `story.<name>` | the story's own global state |
| `box.<id>.<name>` | a box's properties |
| `deck.<id>.<name>` | a deck's properties |
| `hand.<id>.<name>` | a hand's properties |
| `value.<tagId>.<name>` | a tag's own properties |

`getProperty` reads the same paths, and `listProperties()` returns every declared property
with its path, type, current value and default. That list is what the in-engine
[examiners](/play/dev-tools/#the-property-examiner) are built from.

## When to write it

**Write before you deal.** A card's condition is evaluated at the moment you deal or peek,
against the state as it stands then. Set `@world.is_night` after dealing and the hand you
already have won't change; the next deal will.

For the same reason, a dealt card doesn't carry its outcomes' availability. Ask
`outcomes(card, hand)` when you're about to show them and you get the current answer. A card
can sit in a hand for many turns while your game moves underneath it.

## Which way state flows

`@world` is yours, and the story reads it. An outcome can write it too: "playing this card
makes the player poorer" is a normal thing to want. So treat `@world` as shared, and read it
back after a `play` if your game holds its own copy.

If you'd rather the story never touched a value, keep it in your own code and push it in with
`setProperty`. Nothing forces you to declare state you don't want written.

## Shared or per flow

Every property is either **shared** - one value across every flow - or a **copy per flow**,
set on the declaration with a `shared` flag, never by a different name. The defaults follow
the scopes:

| Scope | Default |
|---|---|
| `@world` | always shared - the game owns it, not the player |
| `@story` | shared |
| box, deck, hand and tag properties | a copy per flow |

A single-flow game never notices any of this. With several flows, the narrow scopes are where
personal experience lives - *this* participant's danger in the docks - while `@story` and any
property flagged `shared` is the world every flow moves together. Flows meet only through
shared state: there's no message-passing between them, and no flow can read another's copies.

**Cards can be shared too.** The same word on a deck (or a single card) makes the cards
themselves scarce across flows rather than the state they read: one goblin in the whole world,
to whoever finds it first. That's [How a deal is decided](/play/dealing/#copies-and-claims).

## Saving it

`saveGame()` returns the whole run: the shared state once (with anything a shared one-shot has
taken out of the world), then every flow's own state, turn counters, cooldowns, board contents
and random stream position. `loadGame(envelope)` restores it, rebuilding every flow.

**`@world` is deliberately not in the envelope.** It's your game's state - the engine only
borrows it - so your game saves it, next to the envelope. That's also what makes a game that
runs Patter and the Storylet Engine side by side safe: both engines exclude `@world` from
their own saves, your game saves its one world once, and nothing is written twice. The
`.storyletsave` file format already carries both halves, and `play-helpers` ships a
ready-made container for games with no world state of their own (see
[JavaScript, Save and load](/play/javascript/#save-and-load)).

## Next

- [The API, in one table](/play/overview/#the-api-in-one-table): every call, in one place.
- Your engine: [JavaScript](/play/javascript/), [Unity](/play/unity/),
  [Unreal](/play/unreal/), [Godot](/play/godot/).
- [Dev tools](/play/dev-tools/): the examiner that shows you these properties live while the
  game runs.
