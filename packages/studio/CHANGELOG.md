# Changelog

All notable changes to **Storyletter**, the Storylets desktop editor, are documented here.
Storyletter is released by tagging `vX.Y.Z`, which drives `.github/workflows/storyletter.yml`:
its own pipeline, separate from the CLI's `cli-v*` tags and from the engine ports.

The release job reads the section for the tagged version out of this file and uses it as the
GitHub Release notes, and it FAILS if there is no dated section matching the tag. So a heading
here is part of shipping, not a courtesy.

## [Unreleased]

### Added

- **A venue's claim on an entity, said once and quietly** (design/engine-server.md 4.11). When a project carries an installation contract - the file a Storylet Server writes to record what a venue depends on - the hand or box it names says so in its page header: "Bound at the-park: a station deals this hand", "Ticked at the-park every 60s", one line per installation. The game id field beside it is marked and carries the same sentence as its hint; it is not refused, because the refusal is the server's on push, and a rename field that simply would not type would leave a designer with no way to see why. A project with no contract - which is every project, until a server exists to write one - shows nothing at all. Breaking a contract is an ERROR in the problems bar like any other, naming the venue.

- **Play, in Project Settings > General**: one setting that decides how much of the app a project shows (design/engine-server.md 4.10). Two rungs are offered. **Solo** is one player and one playthrough, and hides every sharing control; **Shared world** adds Shared on declarations and decks, and the Shared choice and In the world on cards. Hidden means ABSENT, not greyed out: a solo author has no Shared checkbox to read past, and the Play field's own note is where the ladder is explained. Moving DOWN a rung is refused while the project uses what the rung would hide, with the list of what is in the way ("3 declarations are shared"), counted by the same compiler check that raises the matching validate warning. New projects land on Solo.

  A THIRD RUNG EXISTS AND IS NOT OFFERED. A project seeded by a Storylet Server carries `play: "venue"`, and Storyletter honours it: the field shows it, reading "Venue (set by a Storylet Server)", the note says the server set it, and an author may move down from it under the same refusal. It cannot be chosen from Solo or Shared world, and nothing else in the app names it.

  A timed box and a hole filled from a property are NOT governed by any of this. They are engine features any game may want, so the box page's Turns section and the hole picker's "from a property" show in every project, Solo included.

- **Durable, beside Shared**: a declaration editor gains a Durable checkbox, the deck page gains one on its Dealing tab, and the card page gains the same three-state control Shared has (design/engine-server.md 4.2). On a card it is offered only when Redraw is **never**, since nothing else can survive a run. Shown only on a project a Storylet Server set to venue, since the run boundary that lifts and restores durable state is the server's; a durable flag in a project below that rung is a validation warning saying to remove it, and the control it is removed with is drawn wherever the flag already exists, whatever the rung.

- **Shared, on a declaration**: the checkbox the flag never had, on every declaration list except `@world`'s, where the flag is a compile error. Shared-world projects and above.

- **The Board's New run and Forget everyone**, replacing Restart on a project a Storylet Server set to venue. **New run** is the next day: everything run-scoped resets - state, boards, cooldowns, clocks and the journal - and everything durable stays, so a designer can play a party who have been here before. **Forget everyone** is the restart, under the name that says what it costs, and asks first. Neither touches `@world`, which is the game's.

### Fixed

- **A declaration edited in the app no longer loses its `shared` flag.** The flag was not on the editor's declaration DTO at all, and a property list saves whole, so opening any list that held a shared declaration and saving it deleted the flag from the shard.

## [0.5.0] - 2026-09-04

### Added

- **Read-only switch on the World list** (Project Settings > World, behind the row's expander), as Patterpad has it: ticked writes `writable: false` on the declaration, the story's promise that only the game moves the value; the compiler refuses a card that writes it and every runtime refuses one at run time. Unticked deletes the key.

### Fixed

- **Publish defaults beside the project, never inside it.** A new project's bundle path is `../storylet-dist/<name>.storyletsc`, and a project that pins none publishes there too; it was `dist/` inside the `.storylets` folder, which is the document. Patterpad's `../patter-dist/<name>.patterc`, name for name. The shipped examples now say the same.
- **The Read-only flag survives a save.** 0.4.0 did not know the key, so saving Project Settings on a project whose file declared `writable: false` silently dropped it; the flag now rides shard to dialog and back, pinned by a round-trip test.
- **The Purpose field behind a property's expander fills its line** instead of the browser's default twenty characters.

### Changed

- **Project Settings: Export is now Publish, under Project**, where Patterpad has it (Project Settings > Project > Publish), so the two apps read the same. The project file's `export` block is unchanged.
- **The toast is the shell's** (`@wildwinter/app-shell` 0.37.0): one drawing for Patterpad and Storyletter, bottom-right, with an `ok` kind; `flash` and `flashError` are unchanged for callers.


## [0.4.0] - 2026-09-01

### Changed

- **A bare condition now passes on a non-empty string or flag list**, not only on a boolean or a
  number. `@story.mood` where mood is `"tense"` used to be false; it is true. The engine had
  admitted only booleans and numbers while Patterplay admitted all four, and the two share a
  property registry, so the same value read from the same place answered the same condition
  differently depending on which engine asked. A condition of yours that quietly never fired may
  start firing, which is the answer it should always have given.

- **A condition comparing flags no longer depends on the order they were added.**
  `@f == [red, blue]` matches a value built as `+blue` then `+red`. A flags value is a set; its
  stored order was an artefact of the order somebody happened to write the outcomes in, which
  Storyletter never showed you.

- **Numbers render as the language says everywhere.** Large and fractional values printed
  differently in the editor and in the four runtimes; they now follow one rule, pinned by a shared
  conformance corpus that all four are tested against.

- The expression engine is now `@wildwinter/expr`, one implementation shared with Patterplay
  rather than a copy per project, so a fix lands once instead of twice.


## [0.3.2] - 2026-08-31

### Fixed

- **The shipped examples tracked the story's act as plain text.** The Village
  declared `act` as a string and The Hamlet as an enum, when an act is an ordered
  ladder and both are unordered types. Neither project was broken by it, which is
  the problem: an example is a teaching surface, and these two taught the wrong
  shape for the most obvious quality a story has. Both now declare `act` as a
  **quality** with its acts as stages.
- **Every act gate had to name an exact act.** Because the old types could not
  express "at or past", thirteen conditions in The Village read
  `@story.act == "act-2"`, which would silently stop firing the day an act-3 was
  added, and The Hamlet said `@act != "arrival"` for "after you have arrived".
  They now read `>= "act-2"` and `>= "act-1"`, and outcomes advance the ladder with
  `advance(@story.act)` rather than naming where they land, so inserting an act
  routes existing play through it.
- **A condition that could never do anything.** The Village's ambients deck was
  gated on `(@story.act == "act-2") && (@story.act != "act-1")`, where the second
  clause cannot change the answer. It is a single `>=` now.
- **The Hamlet's elder could summon you before you arrived.** Answering Bryna's
  summons was gated only on having met the innkeeper and the blacksmith, and both
  of those cards are ungated, so the whole of act 1 could be skipped. It now also
  requires that you have come through the gate.

## [0.3.1] - 2026-08-31

### Fixed

- **About said Storyletter was part of PatterKit**, and linked to that project's
  website. Both lines were carried over from the sibling app when this one was
  started and never changed. It now says Storylet Studio and links to
  [storylet.studio](https://storylet.studio). Nothing else was affected: the Help
  menu's own documentation links were correct already.

## [0.3.0] - 2026-08-31

### Changed

- **Maps are findable.** The Maps tab used to appear only after you had made a map,
  so the word was nowhere in the editor until you already knew that maps live inside
  tag groups. The tab is always there now, and a box with no map yet shows what one
  is and offers to make it.
- **`+ New map`** sits beside `+ New tag group`, and makes the group and marks it a
  map in one step. A box that has maps names them in its Contents list.
- **The switch on a tag group reads "A map"**, where it read "A place". Two things
  were wrong with the old word: the group was called a place while its tags are
  zones, so the Village was "a place" and the forest a "zone"; and it said geography
  when a map does not have to be geographic.

### Added

- **A map does not have to be a map of anywhere.** Any two-dimensional layout of a
  tag group works: act structure with the beats available in each act, a cast and who
  is close to whom, a tech tree. The engine never knows the difference, because a
  zone is a tag whichever way you drew it, so an act map and a village map compile to
  exactly the same thing. Said now in the editor and on
  [the Maps page](https://storylet.studio/storyletter/maps/).

Nothing about the format changed. Existing projects open unaltered, and a map still
adds nothing a runtime reads.

## [0.2.0] - 2026-08-31

### Added

- **Check for Updates now works.** The Help menu item has been present and greyed
  since the shell's menu spine landed, on the rule that a disabled item says "not yet
  here" where an absence says "does not do that". It was waiting on a release feed,
  and 0.1.0 published one. Storyletter checks shortly after launch and every six
  hours, downloads on your say-so rather than behind your back, shows progress in a
  themed dialog rather than a system one, and asks before restarting if you have
  unsaved work.

  **If you are on 0.1.0 you will not be offered this one**, because 0.1.0 has no
  updater to offer it. Download 0.2.0 once by hand and it updates itself from then on.

### Fixed

- **Two false "this card can never be dealt" warnings.** The reachability check
  argues that one latch can only become true after another, which is only sound when
  becoming true requires something to have written it. It was making that argument
  about state that needs no writer at all: a property whose declared default already
  holds it, a property written somewhere in a shape the check cannot read, and a
  `@world` ref the game owns and can change in either direction whenever it likes.
  All three could report a perfectly playable card as impossible, which is the one
  mistake this check must never make.

## [0.1.0] - 2026-08-30

The first public release.

### Added

- The Storyletter editor: design storylets as cards in decks, set up the box they live in,
  declare the hands your game deals, and edit it all directly on the plain files on disk.
- Structure and logic: boxes, decks and cards, tag groups, hand templates and hands, a guided
  condition editor over the five scopes (`@world`, `@story`, `@box`, `@deck`, `@hand`), outcomes
  with effects, and qualities as ordered ladders of named stages.
- The Board: deal a real hand from the same runtime your game ships with, see the ranked result
  with a line-by-line trace answering "why this hand?", play outcomes, peek the stock, poke state
  and advance turns. Live Link streams a running game's state into the editor.
- Two canvases: a node canvas per deck showing how cards reach each other, and a map view where
  zones are drawn outlines, hands stand where they stand in the world, and background pictures sit
  behind them. Frames and stickies on both.
- Coverage testing: seeded playthroughs reporting what your content can actually reach, per hand,
  with never-dealt and never-played called out, an overlay that puts the last run on the canvases,
  and a quick-fix for content gated on state nothing writes.
- Review and documentation: threaded comments anchored anywhere, a Review Feedback walk over every
  thread in the project, and per-class documentation notes.
- Publishing: compile the `.storyletsc` bundle your game loads; publish a single-file playable HTML
  page that needs no server, install or programmer; export the project as a readable workbook; and
  send a whole project as one `.storyletpack`.
- Project plumbing: version-control awareness (git, Perforce, Plastic, SVN) with lock-aware saves,
  file associations, go-to-anything search, and undo across every edit.
- **Packaging.** electron-builder configuration, the macOS and Windows icon pipelines, hardened
  runtime entitlements, and a tag-driven release workflow, all following Patterpad's shape.
  macOS builds are signed and notarised; Windows is deliberately unsigned, because a signed
  Windows build writes its publisher into `app-update.yml` and every auto-update then fails
  verification.
- **File associations.** On macOS a `.storylets` project is a PACKAGE, so Finder opens it as one
  document rather than a folder to wander into; `.storyletsc` and `.storyletpack` get their own
  document icons. On Windows and Linux, where there is no package concept, the `.storyletproj`
  file inside the folder is associated instead, along with the shard types.
