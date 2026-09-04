# Changelog

The Hamlet client is released by tagging `hamlet-vX.Y.Z`, which builds it and
attaches one zip to the matching GitHub Release, with `make_latest: false` so
it never takes Storyletter's Latest badge from electron-updater. The release
job reads the section for the tagged version out of this file.

## [Unreleased]

### Changed

- **Plain JavaScript, no build step.** The page is `index.html`, two script tags for the runtimes' browser files (`storyletengine.min.js`, `patterplay.min.js` from Patterplay 0.12.0, both carrying their save helpers) and three plain scripts, `world.js`, `performance.js`, `main.js`. `npm run build` only copies; esbuild and the bundled `hamlet.js` are gone.
- **The demo reads published bundles, not shards.** `examples/storylet-dist/the-hamlet.storyletsc` (Storyletter, Project Settings > Project > Publish) and `examples/patter-dist/the_hamlet.patterc` (Patterpad, the same) are committed, each at its editor's default place beside the project; the build copies them in and checks the pairing on them, and the three engine demos copy the same pair with no node step. Nothing compiles a project any more, which is how a game consumes a bundle, and the client lost its compilers, its source-level check and a short-lived watcher for it. `npm run serve` reads the two files fresh on every request: Publish, then refresh.

- **One Patter flow per performed box, never re-opened.** The host opened a fresh `performance` flow for every card, which restarted Patter's seeded random sequence and forgot its visit counts: Market Bustle showed the same shuffle entry every visit. The flow is now opened once, named after the box (`village`), found again with `getFlow` after a load, and each card is a `goto` on it. Same on all four hosts; the cross-host fixtures were regenerated with the new flow name.
- **The clock is no longer read-only**: `time_of_day` lost its `writable: false` in both projects, so a scene or a card may move time, and the four hosts no longer hold it read-only on the game's side either. The scene ends with a **Continue** button: the outcome plays, and the hands refresh, when the player has read what the scene said, instead of the instant it ended (which took a one-outcome scene's whole text with it).
- **Patter 0.11.0** (`@patterkit/runtime` ^0.11.0, `@patterkit/play-helpers` ^0.5.1): Patter's save now crosses engines, so the two cross-host fixtures this client writes for the Godot, Unity and Unreal demos were regenerated in the shared `patter/save@0` shape, and every host's mid-scene assertion now holds.


### Added

- **The joint demo.** The Storylet Engine choosing the beat, Patter performing
  it, one host, one `@world` resolver handed to both, one save that restores
  both engines and a scene paused mid-choice. The handoff is by name and
  validated in the build. Seventeen cards, seventeen stub scenes.
