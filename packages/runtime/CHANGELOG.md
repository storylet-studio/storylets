# Changelog

The **JS reference runtime**, one of the four Storylet Engine runtimes. All four carry the
same version and are released together, bumped by `npm run bump:play` and shipped by their
`play-<engine>-vX.Y.Z` tags. The JS one's release workflow reads the section for the tagged
version out of this file and uses it as the release notes, and refuses a tag with no dated
section for it.

## [Unreleased]

### Added

- **A box that counts in time: `turn: { seconds: N }`** (2026-09-05; design/engine-server.md 4.8). A box may declare that its turns are TIME rather than plays. One branch in `play` is the whole of it in the engine: in a timed box the default advance is 0 instead of `settings.playAdvancesTurns`, so a designer cannot declare the convention and then forget to switch play-advance off; a call that names `advanceTurns` still gets what it asked for. The host ticks the box as it always could - the runtime has no clock and gains none - and `redraw: N` on its cards reads as N x `seconds`, which is what every surface now SAYS rather than anything the engine does differently. `describeBundle` reports the unit on `BoxSummary` and the four bundle inspectors show `turn = 60s`, so an integrator reading a bundle knows which boxes their host must tick. The compiler refuses a `seconds` that is not a positive integer, and warns about a timed box whose every card says `redraw: "always"`, since nothing in it then rests. Corpus first: six cases, corpus version 5.

- **A hole filled from a property: the hand that moves** (2026-09-05; design/engine-server.md 4.6). A hand's `chosen` value (or a standalone hand's rule binding) may be a property reference (`"@hand.zone"`, `"@story.where"`, `"@world.place"`) rather than a tag. The engine resolves it at ask time and binds the hole to the tag the value names, so moving the Elder to the forest is `setProperty("hand.the-elder.zone", "forest")` and the next deal follows: forest-tagged cards become available at his hand, village-tagged ones are evicted with reason `tags` by the eviction pass that already existed. No new verb, no new save shape, no new trace kind. The semantics are `boundBy`'s word for word, applied per hole: an explicit tag beats nothing (the reference IS the fill), and a value naming no tag leaves the hole UNBOUND, which is a wildcard, with a `diagnostic` rather than a silently empty hand. `@hand` is the added scope, read from the flow's merged view before tag composition, so a `shared: true` declaration moves the hole for every flow and a per-flow one moves it for that flow alone, and a movable hole can never depend on the tags it is choosing.

- **`describeBundle` reports a hand's movable holes**, as `movable: [{ group, from }]` on `HandSummary`, absent when there are none. It is the one thing about a hand its name cannot say, so an integrator reading the asset alone can see which hands move and which property moves them; the four bundle inspectors show it on the hand's own line.

- **`saveFlow(id)` and `openFlow(id, { restore })`: park one flow, and open it as it was** (2026-09-05; design/engine-server.md 4.1). `Flow.snapshot` / `Flow.restore` have always existed as internals; this is the public pair, and it is an option on `openFlow` rather than a `restore` verb because restoring INTO a running flow is the trap that replace semantics set. Closing a parked flow releases its shared claims, so a card it was holding can be dealt elsewhere while it is away; on the way back, a shared card the world has since given out is dropped with an `evict` of reason `claimed-elsewhere` rather than double-claimed. `onRestoreReport` hands out what the restore did.

- **`previewLoad(envelope)`, `previewFlowRestore(id, save)`, and a `LoadReport` returned by `loadGame`** (2026-09-05; design/engine-server.md 4.9). A load is forgiving about content that moved underneath a save - which is what lets a save survive an edit, and also what hid the cost of one. The report itemises it: cards evicted (and why), cooldowns and spent entries for cards the build no longer has, properties dropped, defaulted or retyped, and `version` / `hash` drift, which used to load in silence. The previews are pure; a project mismatch is still the one refusal. One walk computes the report and the cleaned state the load applies, so the two can never disagree.

### Changed

- **A load now prunes what it reports.** A property the build no longer declares used to stay in the bag as a stray value and ride the next save; a cooldown or spent entry for a deleted card did the same; a saved value that no longer fits its declaration (a struck-out enum value, an edited quality ladder) used to load anyway. All three are dropped now, and named in the report.

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
