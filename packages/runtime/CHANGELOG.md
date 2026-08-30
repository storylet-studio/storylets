# Changelog

The **JS reference runtime**, one of the four Storylet Engine runtimes. All four carry the
same version and are released together, bumped by `npm run bump:play` and shipped by their
`play-<engine>-vX.Y.Z` tags. The JS one's release workflow reads the section for the tagged
version out of this file and uses it as the release notes, and refuses a tag with no dated
section for it.

## [Unreleased]

## [0.1.0] - 2026-08-30

The first public release, shipping alongside the Unity, Unreal and Godot runtimes on the same
version. All four play the same `.storyletsc` bundle with the same behaviour, held to the
shared conformance corpus.

### Added

- **The engine**: load a compiled bundle, hold the shared state (`@world` and `@story`), open
  and close flows, save and load a game, subscribe to the trace and read the run log.
- **The flow**: one playthrough. `peek` the stock, `deal` a hand, read the ranked result with
  the trace that says why each card is there, list `outcomes`, `play` one, and advance turns.
- **Qualities, scarcity and cooldowns**, as the corpus pins them: ordered stage ladders,
  `shared` decks and cards claimed across flows, and per-flow redraw clocks.
- **`describeBundle`**, which reports what a bundle offers without playing it.
- **The seeded PRNG** (`makePrng`, `shuffleInPlace`): mulberry32, the algorithm every runtime
  implements identically, so the same seed deals the same hand in all four.

### The download

The release zip carries `@storylet-studio/runtime` and `@storylet-studio/play-helpers` as
folders you copy into a project, plus **`storyletengine.min.js`**, a single self-contained
browser drop-in exposing `window.StoryletEngine` for a plain HTML page with no build step.

Both packages ship with their dependencies **inlined**, deliberately: nothing here is on npm,
so the zip has to stand on its own. The one exception is that `play-helpers` still imports
`@storylet-studio/runtime` from its sibling folder, because it wraps a live engine and a
private copy would leave the host with two of them.
