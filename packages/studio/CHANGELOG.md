# Changelog

All notable changes to **Storyletter**, the Storylets desktop editor, are documented here.
Storyletter is released by tagging `vX.Y.Z`, which drives `.github/workflows/storyletter.yml`:
its own pipeline, separate from the CLI's `cli-v*` tags and from the engine ports.

The release job reads the section for the tagged version out of this file and uses it as the
GitHub Release notes, and it FAILS if there is no dated section matching the tag. So a heading
here is part of shipping, not a courtesy.

## [Unreleased]

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
