---
title: The project on disk
description: What a .storylets project is - a folder of small JSON5 files, always written the same way and sorted by id, so a team's edits combine instead of colliding.
sidebar:
  label: Overview
---

A Storylet Studio project is a folder of plain text files that you own and keep in version
control. There's no database, no server and no export step to get your data back out. Diff
it, merge it, zip it, send it. This page walks through the on-disk shape; [The
shards](/format/shards/) has every file in detail, and [The bundle and the
save](/format/bundle/) covers what the compiler writes.

## The shape

```
saltmarsh.storylets/
  saltmarsh.storyletproj     settings, @world and @story declarations
  encounters/                one folder per box
    box.storyletbox          the card template and the ranking toggle
    tags.storylettags        tag groups: tags and their properties
    hands.storylethands      hand templates and hands
    decks/
      docks.storyletdeck     one file per deck: the cards
      market.storyletdeck
```

The project folder is `<name>.storylets`. On macOS it's registered as a package, so Finder
shows one openable document. Everywhere else, and to your version control, it's a plain
folder of files.

A box is a folder, not one file, because its parts change at different rates and often have
different owners. A day of moving map geometry about in `tags.storylettags` can't collide
with the card template in `box.storyletbox` or the hands in `hands.storylethands`.

A deck is one file, and its cards live inside it. When two people's changes meet, they meet
in a deck file, so that's the file the merge tooling is built around.

## The rules that make it merge

Six rules govern how the files are written. Between them they mean that the everyday cases
(two designers in different decks, two designers on different cards in one deck, two designers
on different fields of one card, two designers each adding a card) merge cleanly under any
version control system's ordinary text merge, with nothing extra installed.

- **Canonical serialisation.** The editor and the CLI always write the same bytes for the
  same content: sorted keys, one field per line, fully expanded, trailing commas, two-space
  indent, UTF-8 with LF and a final newline. `storyletengine format` puts a hand edit back
  into that form, and `format --check` makes it a CI gate.
- **Everything sorted by id.** Nothing in a source file depends on the order things appear
  in: a deck is a pool, and ranking happens when you deal. Every list you can arrange (cards,
  places, outcomes, hand templates, tag groups and their tags) is stored sorted by id, so two
  people adding one at the same time land at different places in the file instead of both at
  the end, and that conflict never arises. The order you arranged rides alongside in an
  `order` field, so it survives the sort. Any order you see in the editor is presentation,
  not source data.

  The one exception is on purpose: **a card's outcomes reach your game in the order you put
  them in**, not id order. The compiled bundle isn't merged by anybody, and the order options
  are offered in is the player's menu.
- **Immutable ids under renameable names.** Every entity has an opaque `id` that never
  changes and an author-facing `gameId` you can rename. The id is the merge identity, the
  sort key and the state key, and references between shards store the id.
- **The directory is the registry.** A box exists because its folder exists; a deck exists
  because its file exists. There's no central list of decks to conflict on. Folder and file
  names follow the entity's name and the editor keeps them in step; the name inside the file
  is the one that counts, and `validate` warns when the two disagree.
- **No derived data in source.** If it can be recomputed, it isn't in a shard. Conditions
  and changes are stored as expression text, never as syntax trees.
- **JSON5, with trailing commas.** Every element carries a comma, so adding one at the end
  of a list touches one line. Only the compiled bundle is strict JSON.

## When plain text isn't enough

Two people adding a card to the same deck can still land on the same line. For that,
`storyletengine merge BASE OURS THEIRS` does an id-keyed three-way merge, entity by entity
and field by field. It always writes parseable canonical source, keeps your side where the
two genuinely clash, and records the clash in a `.storyletconflict` file beside the real
shard. A leftover `.storyletconflict` is a `validate` error, so an unresolved merge can't
reach CI or a build.

`storyletengine init` writes the `.gitattributes` entries, and `vcs-setup.md` in your new
project holds the one-time `git config` lines that register the driver. See [Version
control](/setup/version-control/).

## What's generated

- **`.storyletsc`** is the [compiled bundle](/format/bundle/): strict JSON, the only file
  your game loads. The default is to commit it, marked `merge=ours`. `validate` checks its
  content hash against the shards, so a stale bundle fails validation instead of shipping.
- **`.storyletsave`** is a saved run, written by a game or by Storyletter's Board.

Neither is hand-edited.

## The send envelope (`.storyletpack`)

To hand a project to someone who isn't on your version control, `storyletengine pack`
writes a single **`.storyletpack`** file (a zip, like a `.docx`). It's a complete copy of
the shards in one file: something to send, not a second place to edit.

They unpack it, work in Storyletter or a text editor as normal, and pack it back.
`storyletengine unpack --merge` then folds their edits into your project by id, so the two
of you can have touched the same card without one overwriting the other.

The merge needs a common ancestor, and that's the pack you sent, so keep it. With the sent
pack, the round trip is self-contained: neither end needs access to the other's version
control.

```sh
storyletengine pack . -o outbox/village.storyletpack        # send this
# ...they edit, and send back village-returned.storyletpack
storyletengine unpack village-returned.storyletpack -o . \
  --merge --base outbox/village.storyletpack
```

Storyletter has the same three moves in its File menu: **Export as Storyletpack…**, **Open
Storyletpack…** and **Merge Returned Storyletpack…**.

Packing an unchanged project twice produces identical bytes, so a pack can be hashed and
diffed like anything else. Conflicts behave exactly as they do in a [version-control
merge](/setup/version-control/): the shard is written with your version and a
`.storyletconflict` file lands beside it.

## Editor associations

`storyletengine init` also writes `.editorconfig` and `.vscode/settings.json`, registering
the six shard extensions as JSON5 so that syntax highlighting and validation work in a plain
text editor. Shards are meant to be hand-editable; run `format` and `validate` afterwards
to check the edit.
