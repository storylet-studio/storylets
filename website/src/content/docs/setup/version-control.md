---
title: Version control
description: How a Storylet Studio project lives in git, Perforce, Plastic or SVN - why the everyday edits merge on their own, the structured merge driver for the rest, conflict files, and validate as the safety net.
sidebar:
  label: Version control
---

A Storylet Studio project is **plain text files** in a folder, so it lives in whatever version
control your team already uses. Nothing needs a database or a server, and there's no export
step to get your work back out.

Both Storyletter and the CLI write through your version control: a file under Perforce,
Plastic or SVN is checked out before it's written, and a new file is added. The system is
detected from the folder, so there's nothing to configure.

## How merges work

A project isn't one big file. It's split into [small pieces](/format/overview/): one file per
deck, one folder per box, and a separate file for positions on a canvas. Because of [the way
those files are written](/format/overview/#the-rules-that-make-it-merge), the everyday
cases merge cleanly under any version control system's ordinary text merge, with nothing
extra installed:

- two designers in **different decks**: different files;
- two designers on **different cards in one deck**: different regions of one file, kept apart
  by full expansion and one field per line;
- two designers on **different fields of one card**: the same, one line each;
- two designers **each adding a card**: records are stored sorted by id, so the two adds land
  at different places in the file instead of both at the end.

That last one is where most merge conflicts usually come from. Nothing in a Storylet Studio file
depends on the order things appear in (a deck is a pool, and ranking happens when you deal),
so the files can be sorted by their permanent id, and two people adding a card aren't both
adding it to the same spot.

### The structured merge driver

Two people adding a card to one deck can still land on the same line. That's what the driver
is for.

```
storyletengine merge BASE OURS THEIRS -o OUT --path REALFILE
```

It's an id-keyed three-way merge, entity by entity and field by field. Two people adding
different cards both keep them. Editing different fields of the same card combines cleanly. A
real clash is flagged, never guessed at. There are four kinds:

| Kind | Means |
|---|---|
| `both-changed` | Both sides changed the same value, differently. |
| `delete-vs-edit` | One side deleted an entity, the other edited it. Never a silent resurrection, never a silent drop. |
| `added-both` | The same id added on both sides with different content. |
| `structural` | A post-merge structural failure, such as a duplicate id. |

**Output is always parseable canonical source.** Where the two sides clash, your side is
kept, and a **`.storyletconflict`** file is written beside the real shard with the full
record of every conflict: id, path, base, ours, theirs, kind. `--path` is how the driver
knows where the real shard is, because your version control system hands it temporary
filenames.

A leftover `.storyletconflict` is a **`validate` error**, so an unresolved merge can't reach
CI, can't export, and can't ship. Resolve it the way you would any conflict, then delete the
file.

## Registering the driver

`storyletengine init` writes the `.gitattributes` entries. The `git config` lines are per
clone, so they can't be tracked in the repository; your new project's `vcs-setup.md` holds
them:

```sh
git config merge.storylets.name "Storylet Studio structured merge"
git config merge.storylets.driver "storyletengine merge %O %A %B -o %A --path %P"
git config merge.ours.driver true
```

`.gitattributes` pins every shard extension to UTF-8 and LF, points them at the `storylets`
merge driver, and marks the compiled bundle `merge=ours`:

```
*.storyletdeck    text eol=lf
*.storyletdeck    merge=storylets
*.storyletsc      text eol=lf merge=ours
```

Where the driver isn't registered, git falls back to a normal text merge. That's safe,
because the everyday cases merge as plain text anyway; the driver is for the ones that
don't.

On Perforce, Plastic or SVN, point the system's merge tool at the same command for the shard
extensions. It exits 2 on input it can't parse, so a tool can fall back to its own behaviour.

## The compiled bundle

The default is to **commit the bundle**, marked `merge=ours`. Merging two compiled files is
meaningless, so on a conflict git keeps yours and you rebuild.

The safety net is the content hash: `validate` errors on a bundle that doesn't match the
shards, so a stale one can't land without being noticed. If you'd rather not commit the
bundle, add it to `.gitignore`.

## Validate after every merge

Some breakage is invisible to any merge, because both sides are individually valid and the
problem is only in the combination:

- a card using a field that the other branch renamed in the card template;
- a reference to a tag the other branch deleted;
- a deck gate referring to a property that no longer exists.

No three-way merge can see these, because they cross shard boundaries. `validate` catches
them. Run it after every merge; a post-merge validation failure is a conflict you haven't
finished resolving.

## Renames are API breaks

Hand names and tag names cross the boundary into your game code: `deal("the-inn")` and
`peek("village", { area: "forest" })` are both written in game source that no merge tool can
see.

So a hand or tag rename gets its own warning. The merge driver flags it and `validate` flags
it. It isn't an error, because renaming is legitimate; it's a warning, because someone needs
to go and change the other side of the contract.

The [bundle inspector](/play/dev-tools/#the-bundle-inspector) is the other half of this: it
shows an integrator every callable name in a shipped bundle, so "the name I typed isn't in
the list" is something you can see.

## A pre-commit hook

```sh
#!/bin/sh
storyletengine validate || exit 1
```

`vcs-setup.md` suggests it. It catches stale bundles, leftover conflict files and
cross-shard breakage before any of them reach the branch.

## Someone who isn't on your version control

A freelance writer, an outside narrative designer, a friend giving you an afternoon: not
everyone who touches the story is going to be on your Perforce server.

For them, use the [send envelope](/format/overview/#the-send-envelope-storyletpack). Pack the
project into one `.storyletpack`, send it, and keep your copy of that pack. They unpack it,
work normally, pack it back, and you merge their version in against the one you sent:

```sh
storyletengine pack . -o outbox/village.storyletpack
# ...they send back village-returned.storyletpack
storyletengine unpack village-returned.storyletpack -o . \
  --merge --base outbox/village.storyletpack
```

The merge is the same id-keyed one described above, so the same rules apply: different
fields of the same card both survive, and a genuine collision writes your version with a
`.storyletconflict` file beside it. Storyletter has the same three moves in its File menu.

:::caution[Keep the pack you sent]
`unpack --merge` is a three-way merge, so it needs the pack you sent as the common ancestor.
Keep every pack you hand out, in an outbox folder or in the repo. Without it there's nothing
to merge against, only their file replacing yours.
:::
