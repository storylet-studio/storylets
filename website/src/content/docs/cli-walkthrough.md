---
title: The same loop from the command line
description: Set a project up, write a card, watch it come up, find the beat that never does, and build the file your game loads, all from a terminal.
sidebar:
  label: A walkthrough
---

Everything Storyletter does, the command line does too, because both run the same code.
This is [the getting-started walkthrough](/getting-started/) again with a terminal instead
of the editor: what you want for a build server, for scripting, or simply if that's how you
prefer to work.

Setting a project up is a one-off. After that the work is a short loop:

* Design some cards and say when they should come up.
* Deal a hand to test which cards appear and when.
* Run coverage to make sure every card can land.
* Publish the bundle for your game.

This page walks all of it in one sitting. Every command and every output below is real.

## The tool

`storyletengine` is the command line. Get it from the [Download page](/download/) as a
standalone binary from the [Download page](/download/). Every command is on [the
CLI page](/cli/).

## 1. Make a project

```
$ storyletengine init tavern --name "The Tavern"
initialised "The Tavern" in .../tavern.storylets
next: storyletengine export .../tavern.storylets
```

You get a `tavern.storylets` folder: a macOS package, a plain folder everywhere else. Inside
are plain text files, one per kind of thing, each with its own extension.

```
tavern.storylets/
  the-tavern.storyletproj    project settings, @world / @story declarations
  main/                      one folder per box
    box.storyletbox          the card template and the ranking toggle
    tags.storylettags        tag groups (empty for now)
    hands.storylethands      hand templates and hands
    decks/
      starter.storyletdeck   the cards
  .editorconfig  .gitattributes  .gitignore  .vscode/  vcs-setup.md
```

The small files at the bottom are worth keeping. The shards are JSON5 under their own
extensions, so `.vscode/settings.json` tells your editor to colour them properly, and
`.gitattributes` pins the line endings and points git at the merge driver that understands
them. `vcs-setup.md` has the one-time `git config` lines.

## 2. See what the starter box already does

The starter box has one hand, `whats-next`, and two cards. A hand is a place on the board,
and it holds whatever it's dealt. `deal` refills it by name:

```
$ storyletengine deal whats-next tavern.storylets
1. welcome  "Welcome"
```

Only one card? The second is gated on `@story.started`, which is still false. `deal` takes
`--set` so you can try out any state without changing a file:

```
$ storyletengine deal whats-next tavern.storylets --set story.started=true
1. welcome  "Welcome"
2. what-now  "What now?"
```

That's the whole loop in one command. Dealing a hand fills it with the cards that could
happen right now, best first, and your game decides what to do with them.

There's one other way to look: `peek <box>` lists what a box could deal without dealing
anything. A card you've only peeked at is still in the deck, so it isn't yours to play.

## 3. Design a card

Open `main/decks/starter.storyletdeck` and add a card to the `cards` list. In the editor
this is a button; by hand you pick the ids yourself. Keep them unique and never change them.

```json5
{
  condition: "@world.market_day",
  gameId: "market-rumours",
  id: "c_rumours01",
  outcomes: [
    { changes: {}, gameId: "listen", id: "o_rumours01", title: "Listen in" },
  ],
  priority: 2,
  redraw: "always",
  title: "Market-day rumours",
},
```

Run `format` to put your hand edit back into the standard layout, which keeps the files
identical from machine to machine and merges clean. Then validate:

```
$ storyletengine format tavern.storylets
formatted 1 shard(s)
$ storyletengine validate tavern.storylets
error: main/decks/starter.storyletdeck [market-rumours]: condition:
  unresolved world property reference '@world.market_day'
```

The check caught it: a card can't read a property nothing has declared. Add the declaration
to `the-tavern.storyletproj`:

```json5
world: {
  properties: [
    { default: false, name: "market_day", type: "boolean" },
  ],
  registry: {},
},
```

Now `validate` says `ok`, and the card deals when the world says so:

```
$ storyletengine deal whats-next tavern.storylets --set world.market_day=true
1. market-rumours  "Market-day rumours"
2. welcome  "Welcome"
```

It ranks first because priority 2 beats priority 1.

## 4. Build the file your game loads

```
$ storyletengine export tavern.storylets
exported .../tavern.storylets/dist/the-tavern.storyletsc
$ storyletengine validate tavern.storylets
ok: .../tavern.storylets
```

The `.storyletsc` bundle is the single file every runtime loads. It carries a fingerprint of
the files it was built from, so the moment you edit one, `validate` refuses until you export
again. An out-of-date bundle can't ship unnoticed:

```
$ storyletengine validate tavern.storylets     # after editing a card
error: dist/the-tavern.storyletsc: bundle is stale (content hash does not
  match the shards); run: storyletengine export
```

## 5. Let coverage find the gap

Coverage plays your project over and over, taking different turnings each time, and reports
what actually came up.

```
$ storyletengine coverage tavern.storylets --runs 20 --seed 1
coverage: 20 run(s), seed 1, max 100 turns/run, 2000 turns, 2000 plays
no input drivers: content gated on @world reads as never dealt
cards dealt 2/3, played 2/3; outcomes played 2/3
hand whats-next: held 2/3 cards over 2000 deal(s)
never dealt: market-rumours  ? gated on @world.market_day - nothing writes
  or drives it (add a coverage driver?)
never played: market-rumours/listen
```

Exactly right. `@world` belongs to your game, and nothing in the content sets `market_day`,
so coverage can't reach the card. It says so instead of calling the card dead. The fix is a
driver, and the tool proposes one:

```
$ storyletengine coverage tavern.storylets --propose
{
  coverage: {
    drivers: {
      "@world.market_day": {
        cadence: "sometimes",
        kind: "recurring",
        values: [
          false,
          true,
        ],
      },
    },
  },
}
```

Paste that block into `the-tavern.storyletproj` before `export:`, then run it again:

```
$ storyletengine coverage tavern.storylets --runs 20 --seed 1 --fail-on-gap
coverage: 20 run(s), seed 1, max 100 turns/run, 21 turns, 21 plays
inputs driven: @world.market_day
cards dealt 3/3, played 3/3; outcomes played 3/3
hand whats-next: held 3/3 cards over 24 deal(s)
```

Full coverage. Notice the turn count dropping from 2000 to 21: once every card has been
dealt and every card that only plays once has been played, there's nothing left to do and
the run stops early. `--fail-on-gap` exits 1 on any never-dealt card - and on any warning
the runs raise, or any `@hand` read some asking hand never composes - which makes this a
CI gate, and the same seed always reproduces the same run.

## 6. Add a box from a kit

A new box starts from a **kit**: a copied starting point that's yours the moment it lands.
It's fully editable and leaves no kit reference behind. `blank` is the empty box; the others
are narrated starters where every piece carries a note explaining itself.

```
$ storyletengine new box tavern.storylets --kit rpg
added box "new-box" (rpg kit) in .../tavern.storylets
```

The RPG kit gives you an `area` tag group (tavern, market), a reusable `encounters-at` hand
template that leaves the place for each hand to choose, one hand that chooses the tavern,
and a sample deck. The market has no hand yet, and the template's own note says so: adding
one is the first edit the kit invites you to make. It deals straight away:

```
$ storyletengine export tavern.storylets
$ storyletengine deal tavern-encounters tavern.storylets
1. a-strangers-wager  "A stranger's wager"
```

And `peek` is the looking half again: ask what the box could deal for a given tag, without
dealing anything.

```
$ storyletengine peek new-box tavern.storylets --where area=tavern
1. a-strangers-wager  "A stranger's wager"
```

Storyletter's New Box picker offers the same kits and produces exactly the same box.

## Where to go next

- [Concepts](/concepts/) is the vocabulary: box, deck, card, hand, the board, peek and deal
  and play, turns, copies, the five scopes.
- [The format](/format/overview/) is what all of that looks like on disk.
- [Playing in your game](/play/overview/) is how the compiled bundle gets into Unity, Unreal,
  Godot or the web.
- [The CLI](/cli/) is every command in full.
- [Version control](/setup/version-control/) is how a team edits one project without
  colliding.
