---
title: The CLI
description: storyletengine - init, new box, validate, format, export, export-html, export-xlsx, peek, deal, resolve, merge, links, coverage, pack and unpack. Everything the editor does, from a terminal.
sidebar:
  label: The CLI
---

`storyletengine` is the command line. It runs the same operations the editor does, so a CI
gate sees exactly what the editor sees. Use it to gate a pull request, run a build, or
script a hand-off.

## Getting it

Download a standalone binary for your platform from the [Download page](/download/): one
file, no Node installation needed, and nothing else to install alongside it.

```sh
chmod +x ./storyletengine-macos-arm64
./storyletengine-macos-arm64 validate ./my-project.storylets
```

The binaries are the distribution. The packages are not published to npm, so put the binary
somewhere on your `PATH` and call it `storyletengine` if you want the short form.

The CLI package is public on npm. The runtimes aren't: they ship as zips on the Download
page.

Every command writes through your version control (checking a file out first, adding new
files), so a locked or read-only file fails the write instead of being overwritten. **Exit
codes** are consistent: **0** success, **1** the operation found problems or failed, **2** a
usage error. `fmt` is an alias for `format`.

Most commands take a project path as their last positional argument, defaulting to the
current directory. You can point at the `.storylets` folder or anywhere inside it.

## Everything at a glance

```
storyletengine init [dir] [--name X]
storyletengine new box [path] [--kit blank|rpg|dialogue]
storyletengine validate [path]
storyletengine format [path] [--check]            (alias: fmt)
storyletengine export [path] [-o file] [--map|--no-map]
storyletengine export-html [path] [-o file]
storyletengine export-xlsx [path] -o FILE
storyletengine peek <box> [path] [--where group=tag ...] [--n N] [--set path=value ...] [--seed N] [--deal-all]
storyletengine deal <hand> [path] [--set path=value ...] [--seed N] [--deal-all]
storyletengine resolve <query> [path]
storyletengine contract show [installation] [path]
storyletengine merge BASE OURS THEIRS [-o out] [--json] [--path realfile]
storyletengine links [path] [--deck X | --box X | --card X] [--refs] [--json]
storyletengine coverage [path] [--runs N] [--max-turns M] [--seed S] [--json] [--fail-on-gap] [--propose]
storyletengine pack [path] -o FILE [--assets|--no-assets]
storyletengine unpack FILE -o DIR [--merge --base SENT.storyletpack]
```

## init

Scaffold a new project.

```
$ storyletengine init tavern --name "The Tavern"
initialised "The Tavern" in .../tavern.storylets
next: storyletengine export .../tavern.storylets
```

It creates `<dir>.storylets` with a starter box (one hand, two cards that show the loop),
plus the files that keep a project tidy in a repo: `.editorconfig`, `.gitattributes`,
`.gitignore`, `.vscode/settings.json` and `vcs-setup.md`. See [the
walkthrough](/cli-walkthrough/#1-make-a-project).

## new box

Add a box, scaffolded from a BOX KIT. A box kit is a starting point you own: fully
editable the moment it lands, with no kit reference left in the files. (The other scale
is a GAME KIT, which starts a whole project; Storyletter's New Project picker offers
those.)

```
$ storyletengine new box tavern.storylets --kit rpg
added box "new-box" (rpg kit) in .../tavern.storylets
```

`--kit` is `blank` (the default), `rpg` or `dialogue`. The two narrated box kits carry
a purpose note on every piece, each teaching one part of the model. Storyletter's New Box
picker offers the same three and scaffolds identically.

## validate

The check to run before you commit or publish.

```
$ storyletengine validate tavern.storylets
ok: .../tavern.storylets
```

It checks for property references nothing declares, tag references that point nowhere, hands
that don't fill in every group their template asks for, card field values against the box's
card template, canonical form, a leftover merge conflict file, and **bundle staleness**: a
committed `.storyletsc` whose content hash no longer matches the shards is an error.

Problems print as `severity: path [where]: message`. Any error exits 1, which makes this the
natural pre-commit hook and CI gate.

## format

Rewrite shards into canonical form: sorted keys, one field per line, trailing commas, LF, a
final newline. Files that are always written the same way are files that merge cleanly.

Every list you can arrange is sorted by id here (cards, places, outcomes, hand templates, tag
groups and their tags), and the order you arranged is written into an `order` field first, so
running this never changes what the editor shows you.

```
$ storyletengine format tavern.storylets
formatted 1 shard(s)
```

`--check` reports what would change and writes nothing, exiting 1 if anything isn't
canonical. That's the CI form. `fmt` is an alias.

## export

Compile to the bundle.

```
$ storyletengine export tavern.storylets
exported .../storylet-dist/the-tavern.storyletsc
```

It writes to the path the project shard declares. `-o file` overrides it; `-o -` writes to
standard output. Export validates first and refuses to write anything on an error.

`--map` carries the maps: the zone shapes and background pictures of every spatial tag
group, with the pictures written to `assets/<box>/` beside the bundle. `--no-map` leaves
them out. Without either, the project's own `export.map` setting decides, and its default is
off: geometry is authoring data, and a shipping build needn't carry anything it doesn't use.
The engine never reads a shipped map; it's there for a host that draws its own.

## export-html

One self-contained, playable `.html`: the runtime, the Board and the compiled bundle
inlined, so it plays offline in any browser with no server and no install. Hand one file to
anyone.

```
$ storyletengine export-html the-hamlet.storylets -o "The Hamlet.html"
wrote The Hamlet.html (78 KB)
```

| Flag | Does |
|---|---|
| `-o FILE` | Where to write the page. Without it, the page lands beside the bundle under the bundle's name (`storylet-dist/the-hamlet.html` for the example). `-o -` writes it to standard output. |

The page is the Board: every hand as a labelled group of cards, outcomes under the open
card, **Deal all hands**, **Next turn**, **Restart**, and a transcript - and the project's
maps, drawn above each box's hands with the background pictures inlined as data, a pin per
placed hand carrying its live card count. The bundle inside it
is compiled with full metadata whatever the project's setting, so titles and purposes show,
and the player's place is saved in that browser. Storyletter's **Publish ▸ Publish Playable
HTML…** writes the same page; there's more about what to do with it in
[the editor tour](/storyletter/overview/#a-playable-page-one-file-plays-anywhere).

## export-xlsx

The whole project as a readable Excel workbook: the thing to hand a lead for a review
meeting, or a producer who wants to sort and filter.

```
$ storyletengine export-xlsx the-hamlet.storylets -o "The Hamlet.xlsx"
wrote The Hamlet.xlsx: 16 card(s) on 5 deck sheet(s), 24 outcome(s), 3 hand(s), 1 tag group(s)
```

| Flag | Does |
|---|---|
| `-o FILE` | Where to write the workbook. Required. |

The workbook opens on an **Overview** sheet (the project's name, version and content hash,
when it was generated, counts, and an index of the deck sheets), then **one sheet per deck**,
named after the deck. Each row is a card: Title, gameId, When, Priority, Redraw, Copies, a
column per tag group, a column per card field, Purpose, and the card's outcomes with their
changes. After the decks come **Outcomes** (one row per outcome, for filtering), **Hands**
(hand, template, When, tags, slots, purpose) and **Tag groups** (every tag with its
properties). With more than one box, every sheet gains a Box column, and a deck title two
boxes share gets the box in its sheet name.

It reads the source files, not the bundle, so titles and purposes are always in it whatever
the project's metadata setting. Storyletter's **Publish ▸ Publish Spreadsheet…** writes the
same workbook.

## peek and deal

Ask the reference runtime a question about your project from the command line. Both compile
the project in memory, stand up an engine and a flow, apply any overrides, and answer.

```
$ storyletengine deal the-inn the-hamlet.storylets
1. arrive-at-the-gate  "Arrive at the Village Gate"
2. settle-at-the-inn  "Get Settled at the Inn"

$ storyletengine peek village the-hamlet.storylets --where area=village
1. arrive-at-the-gate  "Arrive at the Village Gate"
2. settle-at-the-inn  "Get Settled at the Inn"
3. known-at-the-forge  "Make Yourself Known at the Forge"
4. market-bustle  "Market Bustle"
5. ring-of-the-anvil  "The Ring of the Anvil"
```

`deal <hand>` refreshes one hand by name. `peek <box>` lists every card the box could deal
right now, in ranking order, without dealing anything.

| Flag | On | Does |
|---|---|---|
| `--where group=tag` | peek | Filter by tag, one entry per tag group. Repeatable. |
| `--n N` | peek | Cap the list at N. |
| `--set path=value` | both | Set a property before asking. Repeatable. The value is parsed as JSON5 where it parses, and taken as a bare string otherwise. |
| `--seed N` | both | The flow's seed. Defaults to 0. |
| `--deal-all` | both | Deal every hand first, so cards other hands have claimed are already gone. |

`--set` takes the same paths the runtime does: `story.started`, `world.market_day`,
`value.v_docks.danger`, `box.b_x.heat`.

`--deal-all` is how you see exclusivity from the command line: with every other hand dealt
first, the cards they hold don't come up in yours.

## resolve

Find the item a query names, and say where it lives.

```
$ storyletengine resolve arrive-at-the-gate the-hamlet.storylets
c_arrive  [card]  "Arrive at the Village Gate"  arrive-at-the-gate  Village > Arrival  (village/decks/arrival.storyletdeck)

$ storyletengine resolve inn the-hamlet.storylets
c_inn_first  [card]  "Get Settled at the Inn"  settle-at-the-inn  Village > Arrival  (village/decks/arrival.storyletdeck)
c_inn_warm  [outcome]  "Ask warmly about the village's history"  ask-about-history  Village > Arrival > Get Settled at the Inn  (village/decks/arrival.storyletdeck)
c_inn_road  [outcome]  "Ask only about the road north"  ask-about-the-road-north  Village > Arrival > Get Settled at the Inn  (village/decks/arrival.storyletdeck)
h_inn  [hand]  "The Inn"  the-inn  Village  (village/hands.storylethands)
```

The query can be a **gameId** (the name your game code and the runtime's logs use), an
**id** (what a shard or a merge conflict file names), or a **title**. It tries an exact
gameId first, then an id, then a title, then a partial match of any of the three, and
stops at the first of those that finds anything, so an exact match is never buried in
partial ones. Each hit prints `id  [kind]  "title"  gameId  Box > Deck  (shard)`. Boxes,
decks, cards, outcomes, hands, hand templates and tag groups are all findable.

It's the same lookup Storyletter's `--at` uses when you [open a project at a particular
item](/storyletter/overview/#opening-at-a-particular-item), so what the terminal says
and where the editor lands can't disagree. No match prints `no match for '<query>'` and
exits 1.

## contract show

What each [installation contract](/format/shards/#the-installation-contract) in the project
depends on: the hands a venue's stations are bound to, the boxes its scheduler ticks, the
properties its clocks drive, the fields its crew read.

```
$ storyletengine contract show the-park.storylets
the-park  (Storylet Server 0.1.0, revision 12)  (contracts/the-park.storyletcontract)
  hand      the-well   a station deals this hand
  hand      the-forge   a station deals this hand
  box       street   the scheduler ticks it every 60s
  property  world.time_phase
  property  story.visits
  field     prompt   the crew and the bridges read it
```

Name an installation to show only that one. There's no verb for the breaks: `validate`
already reports them, as errors, each one naming the venue that cares. A project with no
contract prints nothing and exits 1.

## merge

The structured merge driver: an id-keyed three-way merge of Storylet Studio source files.

```
storyletengine merge BASE OURS THEIRS -o OUT --path REALFILE
```

Output is always parseable canonical source. Where the two sides genuinely clash, your side
is kept and a `.storyletconflict` file is written beside the real shard. `--path` tells the
driver where that real shard is, because your version control system hands it temporary
filenames.

Without `-o` it prints the merge result as JSON. `--json` prints it as well as writing.
Warnings (including hand and tag renames, which break game code that uses the old name) go
to standard error. It exits 1 when there are conflicts and 2 on unparseable input, so a
version control driver falls back to its own behaviour instead of trusting a guess.

Full detail on [version control](/setup/version-control/).

## pack

Snapshot the project into one portable
[`.storyletpack`](/format/overview/#the-send-envelope-storyletpack), for handing to someone
who isn't on your version control.

```
$ storyletengine pack . -o outbox/village.storyletpack
packed outbox/village.storyletpack
```

| Flag | Does |
|---|---|
| `-o FILE` | Where to write the pack. Required. |
| `--assets` / `--no-assets` | Carry the maps' background pictures too, or leave them out. Without either, the project's `export.packAssets` setting decides (off unless set). |

The pack carries the source shards and a manifest. It doesn't carry the compiled bundle,
which is generated and would only go stale in transit. Packing an unchanged project twice
produces identical bytes.

## unpack

Explode a pack back into shards, or fold a returned one into your project.

```
$ storyletengine unpack village.storyletpack -o ./village
unpacked: village/saltmarsh.storyletproj
unpacked: village/encounters/box.storyletbox
...
9 shard(s) -> ./village
```

| Flag | Does |
|---|---|
| `-o DIR` | Where the shards go, or the project to merge into. Required. |
| `--merge` | Fold a returned pack into the project at `-o` instead of extracting. |
| `--base SENT` | The pack you sent, used as the common ancestor. Required with `--merge`. |

With `--merge`, each shard goes through the same id-keyed three-way merge as
[`merge`](#merge): you and the other author can edit different fields of the same card and
both edits survive. A conflict writes your version plus a `.storyletconflict` file and exits
1.

```
$ storyletengine unpack returned.storyletpack -o . --merge --base outbox/village.storyletpack
merged: encounters/decks/docks.storyletdeck
9 shard(s) -> .; 0 conflict(s), 0 warning(s)
```

`--merge` without `--base` is a usage error: with no ancestor there's no merge to do, only an
overwrite.

A pack may arrive from outside your team, so entry paths are checked before anything is
written. An entry that would land outside `-o` is refused and nothing is written.

## links

Which cards can turn which other cards on and off, worked out from conditions and outcomes
alone. No playthrough, no simulation, nothing written.

```
$ storyletengine links the-hamlet.storylets
links: 17 card(s), 19 edge(s) - 18 enable, 1 disable, 0 influence, 0 reference
  Arrive at the Village Gate enable Gareth Looks Troubled  [@story.act by step-through]
  Arrive at the Village Gate enable Mira Seems Distracted  [@story.act by step-through]
  Answer Bryna's Summons disable Arrive at the Village Gate  [@story.act by keep-your-distance; @story.act by pledge-your-help]
```

| Flag | Does |
|---|---|
| `--deck X` | Only that deck's cards, and only edges between them. |
| `--box X` | Only that box's cards. |
| `--card X` | Analyse everything, centred on that card (what the editor's **Links…** view asks). |
| `--refs` | Also report `reference` edges: two cards read a property nobody writes. |
| `--json` | The whole graph. |

Four kinds of edge:

| Class | Means |
|---|---|
| `enable` | the writer makes the reader's condition more likely to be true |
| `disable` | more likely to be false |
| `influence` | it touches state the reader reads, but the direction can't be worked out statically (a computed value, or a nudge towards an exact number) |
| `reference` | both read a property neither writes. Off unless you ask |

Every edge names **which outcome** does the writing. One card's outcomes often push a
property in opposite directions, so the same pair of cards can legitimately get both an
`enable` and a `disable` edge: "enabled if you stand and fight, disabled if you flee".

`@hand` isn't analysed. A hand's properties are put together at the deal, from its tags,
its own properties and the criteria it was dealt with, so two cards reading `@hand.danger`
may not be talking about the same hand at all. The command says so in a warning and leaves
those edges out.

A deck-scoped run can be empty even when its cards are busy, because the edges may all cross
into other decks. Run it without `--deck` to see those.

## coverage

Seeded playthroughs that report what your content can actually reach.

```
$ storyletengine coverage tavern.storylets --runs 20 --seed 1
coverage: 20 run(s), seed 1, max 100 turns/run, 2000 turns, 2000 plays
no input drivers: content gated on @world reads as never dealt
cards dealt 2/3, played 2/3; outcomes played 2/3
hand whats-next: held 2/3 cards over 2000 deal(s)
never dealt: market-rumours  ? gated on @world.market_day - nothing writes or drives it (add a coverage driver?)
never played: market-rumours/listen
```

The second line names the `@world` properties the run drove, or says that none were. A run
with no drivers reports host-gated content as never dealt, which is true of the run, not of
the content. Never-dealt cards are listed with a hint where one is knowable.

| Flag | Does |
|---|---|
| `--runs N` | How many playthroughs. |
| `--max-turns M` | Cap the turns per run. |
| `--seed S` | The seed. The same seed always reproduces the same run. |
| `--json` | The full report as JSON. |
| `--fail-on-gap` | Exit 1 on any never-dealt card, unprovided `@hand` read, or runtime warning. The CI form. |
| `--propose` | Print a proposed coverage block instead of running. |

`--propose` derives drivers from your conditions (the literals they compare against, plus
declared boolean and enum domains, skipping anything an outcome writes) and prints a block to
paste into the project shard. It's the same derivation behind Storyletter's **Add coverage
drivers** and **Propose from the cards** buttons. See [coverage
testing](/production/coverage-testing/).
