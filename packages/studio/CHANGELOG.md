# Changelog

All notable changes to **Storyletter**, the Storylets desktop editor, are documented here.
Storyletter is released by tagging `vX.Y.Z`, which drives `.github/workflows/storyletter.yml`:
its own pipeline, separate from the CLI's `cli-v*` tags and from the engine ports.

The release job reads the section for the tagged version out of this file and uses it as the
GitHub Release notes, and it FAILS if there is no dated section matching the tag. So a heading
here is part of shipping, not a courtesy.

## [Unreleased]

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
