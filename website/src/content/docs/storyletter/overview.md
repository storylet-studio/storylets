---
title: Storyletter
description: A tour of Storyletter, the desktop editor for Storylet Studio projects, where you design cards and decks, set up the boxes they live in, and deal a real hand whenever you want one.
sidebar:
  label: Overview
---

**Storyletter** is the desktop app where you design Storylet Studio projects. You design cards, deck by
deck, set up the box they live in, and declare the hands your game will deal. The
real runtime, the same one your game ships with, runs inside the editor, so **"would this
card come up here?"** is always one keystroke away, and "why did *Arrive at the Village
Gate* get dealt?" has a line-by-line answer.

Storyletter runs on macOS, Windows and Linux. Get it from the [Download](/download/) page.

This section is a full tour of the editor. If you only read one other page, make it
[Designing cards](/storyletter/cards/).

## First run

The first time you launch, Storyletter asks once for your **name**. That's all. Your name
signs your review comments, and you can skip the prompt. Change it at any time from
**User Information…** (in the Storyletter app menu on macOS, or the File menu on Windows
and Linux).

From there you land on the **welcome screen**, where you can:

- under **Start**, **Open a project…** to open one you already have, or **New project…**
  to make one (it asks for a name and a starting kit);
- under **Learn from a finished project**, pick one of the three worked examples - *The
  Hamlet* (small: places, hands and a deck to deal), *The Village* (the full demo) or *Port
  Meridian* (the engine beside an action game). Each is copied somewhere you choose, so you
  can take it apart;
- pick from your **Recent** projects.

The example project is the quickest way to learn the model: open it, press **▶ Play**, and
watch it deal.

### Creating a project

**File ▸ New Project…** (`Cmd+N` / `Ctrl+N`) asks for a name, then where to put the folder.
A new project isn't empty: it lands one box, one place to deal to, and two cards that
already work together, so it plays straight away. Add kits to it as you go (see
[Setting up a box](/storyletter/box-setup/#starting-a-box-from-a-box-kit)).

A Storylet Studio project is a real folder of files (see [the format](/format/overview/)). Keep
it in whatever version control you use for your game, alongside your game files. You won't
ship the project itself, only the `.storyletsc` bundle it publishes.

## Opening a project

**Open Project…** (`Cmd+O`), click a recent project on the welcome screen, or use
**File ▸ Open Recent**. Recent projects are listed by the name they call themselves,
with the folder path beside it. Double-click a `.storylets` folder, or run
`storyletter <path>` from a shell, and it opens where you left off.

### Opening at a particular item

Launching from a shell, `--at` opens the project straight at an item instead of
where you left off:

```sh
storyletter my-game.storylets --at arrive-at-the-gate   # a card, by its gameId
storyletter my-game.storylets --at c_arrive             # anything, by its id
storyletter my-game.storylets --at "The Inn"            # anything, by its title
storyletter --at arrive-at-the-gate                     # no path: reopen the last project there
```

`--at=<where>` works too. `<where>` takes the same query as
[`storyletengine resolve`](/cli/#resolve): it tries an exact gameId first, then an id,
then a title, then a partial match. So a gameId copied out of your game code or a
runtime log pastes in and lands on the card it names, which is the quickest way to
answer "a tester reported a problem with *this* card".

It can name a box, a deck, a card, a hand, a hand template or a tag group, and opens
that item's document. An outcome opens its card with that outcome expanded. If nothing
in the project matches, Storyletter prints that on the terminal and opens the project
as it normally would, so a stale id in a bug report can't stop you getting in. If
Storyletter is already running, the same command jumps the open window rather than
starting a second copy.

`storyletter` here is the app's own executable: on macOS that's
`Storyletter.app/Contents/MacOS/Storyletter`, on Windows `Storyletter.exe` in the
install folder, and on Linux the AppImage.

## Sending a project (Storyletpack)

A project folder is perfect for version control but awkward to email or drop in a chat. A
**Storyletpack** is the project squeezed into one file you can hand to someone.

- **File ▸ Export as Storyletpack…** writes the pack.
- **File ▸ Open Storyletpack…** unpacks one into a fresh project folder and opens it.
- **File ▸ Merge Returned Storyletpack…** takes a pack someone sends back and folds their
  edits into your project.

See [the send envelope](/format/overview/#the-send-envelope-storyletpack) for what travels
and what doesn't.

## Publishing

Everything under the **Publish** menu turns your project into something you hand to others.
**Publish Bundle** (`Shift+Cmd+B`) is the everyday one: it compiles the `.storyletsc` your
game loads, to the path in your project settings. The other two are for people: a page
anyone can play, and a workbook anyone can read.

### A playable page: one file, plays anywhere

You don't need a game, an engine or a programmer to put your project in front of people.
**Publish ▸ Publish Playable HTML…** writes a single `.html` file containing the whole
project and the same engine a shipped game would use. It needs nothing else: no internet,
no install, no server. Anyone you give it to double-clicks it and plays, on a laptop or a
phone. It asks where to save, suggesting `<project name>.html` beside the project folder.

The page is the Board, the same one in the editor and in every runtime's demo: each hand
is a labelled group of cards, clicking a card shows its outcomes, clicking an outcome plays
it and the board moves. Three controls, **Deal all hands**, **Next turn** and **Restart**,
and a transcript of what happened. Titles and purposes always show - the page is for
people - and the player's place is saved in that browser, so closing the tab isn't
losing the game. Restart clears it.

A project with [maps](/storyletter/maps/) carries them into the page, pictures included,
and the map takes the left of the screen with the cards in a column beside it - the same
arrangement as the Board's Map view. Zones are tinted, every placed hand is a pin wearing
its live card count, and you can zoom with the wheel or the buttons and drag to pan. Tap
a pin and the column jumps to that hand's cards. On a phone the map sits on top with the
cards below. The pictures ride inside the file as data - the Village and its five
paintings publish to a single 5MB page that still opens from disk with no internet. A
multi-box project gets a heading per box, so you can watch one box's play light another
box's pin.

Ways to get it to people:

- **Send it.** Email it, drop it in a shared folder, attach it to a message. It's one file.
- **Put it on itch.io.** Name the file `index.html`, zip it, and upload the zip as an HTML
  game.
- **Host it anywhere that serves files.** Upload the file and share the link.

The same page from the command line is [`storyletengine export-html`](/cli/#export-html).

### A spreadsheet of the whole project

**Publish ▸ Publish Spreadsheet…** writes the project as an Excel workbook (`.xlsx`): the
thing a lead reads in a review meeting, and a producer sorts and filters. It asks where to
save, suggesting `<project name>.xlsx` beside the project folder.

One sheet per deck, a row per card: title, gameId, When, priority, redraw, copies, a column
per tag group, a column per card field, purpose, and the outcomes with their changes. After
the decks come an **Outcomes** sheet (one row per outcome), **Hands** (template, When, tags,
slots) and **Tag groups** (every tag with its properties), with an **Overview** sheet in front
carrying the project's name, version, content hash and counts. It's read from the files, so
any unsaved edit is saved first.

The same workbook from the command line is
[`storyletengine export-xlsx`](/cli/#export-xlsx).

## The same engine as your game

Every operation Storyletter performs is the same one [the CLI](/cli/) makes: load,
validate, export, deal, coverage, merge. A CI gate and a designer's Save see the same
project, and what plays in the editor plays in your build.

Your edits are written straight back to the project files, in a fixed layout, with your
version control's locks respected. There's no private database, and editing a file by
hand in a text editor is a supported way to work.

The link runs both ways when you want it to. With [Live Link](/play/live-link/) connected,
saving pushes the fresh bundle into your running game, and the game streams its run back so
the Board watches what it deals and plays.

## Not yet in the editor

Two things you might go looking for aren't there yet:

- **A merge conflict view.** Conflicts land as a `.storyletconflict` sidecar and
  `validate` refuses to ignore them, but reading one and picking sides is a command-line
  and text-editor job today.
- **Writing status.** Comments and the review walk exist, but there's no per-card
  "draft / needs review / final" state to filter or report on.

## Where to go next

- [The workspace](/storyletter/workspace/): the navigator, the document and its tabs, the
  problems bar, Find, the menus and the themes.
- [Designing cards](/storyletter/cards/): the deck, the card document, conditions, priority,
  tags and outcomes.
- [The node canvas](/storyletter/node-canvas/): a deck's cards as nodes, with the arrows
  worked out for you.
- [Setting up a box](/storyletter/box-setup/): the card template, hand templates, tags,
  hands, and starting a box from a kit.
- [Maps](/storyletter/maps/): draw a tag group as zones and pin hands inside them.
- [The Board](/storyletter/board/): play the project on the real runtime, and see why a
  card was or wasn't dealt.
- [Reviewing](/storyletter/reviewing/): comments on any item, markers on a canvas, and the
  walk through open feedback.
- [Keyboard shortcuts](/storyletter/shortcuts/): the full reference.
- [Coverage testing](/production/coverage-testing/): the coverage window is in the editor
  too, and it's documented with the rest of the production workflow.
