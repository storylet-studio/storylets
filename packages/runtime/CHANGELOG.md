# Changelog

The **JS reference runtime**, one of the four Storylet Engine runtimes. All four carry the
same version and are released together, bumped by `npm run bump:play` and shipped by their
`play-<engine>-vX.Y.Z` tags. The JS one's release workflow reads the section for the tagged
version out of this file and uses it as the release notes, and refuses a tag with no dated
section for it.

## [Unreleased]

## [0.4.1] - 2026-09-04

### Changed

- **Lockstep with the Godot addon's 0.4.1**, which could not open a project. No change of its own: one version number means one runtime behaviour across all four.

## [0.4.0] - 2026-09-04

### Changed

- **`@storylet-studio/play-helpers` is on npm** from this release, at the runtime's version and bumped with it (the JS member of the lockstep is two packages), so the drop-in is one CDN line away: `https://unpkg.com/@storylet-studio/play-helpers/dist/storyletengine.min.js`. The zip is unchanged.
- **`storyletengine.min.js` carries the helpers.** The browser drop-in now defines the runtime AND `@storylet-studio/play-helpers` on the `StoryletEngine` global, so a plain page saves and loads the family's `.storyletsave` text from two script tags with no build step; it used to carry the runtime alone. Built by the helpers package now, the one that depends on both; the release zip still ships it at its root.

### Added

- **A read-only `@world` property is refused at runtime too.** `play()` of an outcome that writes a property declared `writable: false` throws `'@world.x' is read-only` and changes nothing; the host's own `setProperty` is not bound. The compiler already refused it; the runtime now keeps the promise for hand-built bundles, and so that an integrator running Patter beside this sees one behaviour, since Patter's runtime refuses the same write through the shared kernel. Corpus case first, in all four runtimes.

- **`onReplacedFlow`**, an opt-in diagnostics hook on `EngineOptions`, fired when
  `openFlow` replaces a flow that still had cards dealt, with the flow id and the
  count. Behaviour is unchanged: replacing is deliberate, and the same in Patter.
  What it makes observable is a host calling `openFlow` straight after `loadGame`
  to "re-take" its handle, which silently discards the hand the save restored and
  surfaces later as `play()` refusing a card as not dealt. `getFlow` is the call,
  and `deserializeState`'s doc and the JavaScript page now say so in as many
  words. Found building the joint Storylets + Patter demo, where the sample was
  written with the Village client open and fell into the trap that file names.
  Zero cost when unset; leave it unset in shipped games.

## [0.3.0] - 2026-09-02

### Changed

- **BREAKING: `PropertyView` is gone; `listProperties()` returns `PropertyRow`.** It was the
  shared row plus a `path`, and `path` is on the shared row now, so the name was a second name
  for one type - and Patterplay had forked the same row, for the same reason, in its own
  runtimes. `PropertyRow` is re-exported from `@storylet-studio/runtime`, so naming a row needs
  no dependency on `@wildwinter/scoperegistry`.
- **Requires `@wildwinter/scoperegistry` ^0.4.0**, which is where the row's `path` lives.
- **A property bag composes its rows' addresses.** Each bag is built knowing the path it answers
  to (`story.`, `box.<id>.`, `deck.<id>.`, `hand.<id>.`, `value.<id>.`, `world.`), so a row
  arrives addressed instead of having a prefix pasted onto it by each caller. **The addresses are
  unchanged** - this is where they are composed, not what they are.

### Fixed

- **A quality row carries its ladder.** `stages` was on the examiner row so an editor could
  offer the stages instead of a free-text box, and the shared code that builds rows never filled
  it in - on this runtime and two others. Every quality row came out without one.

- **`@world` rows report `writable`.** They are built by hand rather than by a bag (a host
  resolver backs them) and were pushed through a cast that hid the missing field, which the row
  type has always required. They now say whether the resolver can be written at all - the shared
  registry's own rule for a foreign scope.

## [0.2.0] - 2026-09-01

### Changed

- **BREAKING: a bare non-boolean condition now passes when it is non-empty.** A
  condition resolving to a string or a flag list previously always failed; it now
  passes when the string is non-empty or the list has members. Booleans and
  numbers are unaffected. This aligns with Patterplay, which the two engines
  sharing a property registry makes necessary: the same value read from the same
  registry answered a condition differently depending on which engine asked.

- **Flags compare as a SET.** `==` and `!=` on a flags value now ignore order,
  as multisets so a duplicate still counts. `set_flags` still sorts its result,
  now purely so a save is byte-reproducible rather than to make equality work.

- The PRNG is now re-exported from `@wildwinter/expr` rather than implemented
  here. Same algorithm, same draws, same `makePrng` and `shuffleInPlace` on this
  package's surface. `toUint32` is deliberately NOT re-exported: it is the seed
  coercion a port has to reproduce, not something a game author calls.


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
