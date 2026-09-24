# @storylet-studio/runtime

The Storylet Engine **JS reference runtime**: the Engine and Flow surface of
[the bundle format](https://storylet.studio/format/bundle/) section 5 -
the engine (`openFlow` / `getFlow` / `flows` / `closeFlow` / `reset` /
`saveGame` / `loadGame` / `saveFlow` / `previewLoad` / `previewFlowRestore` /
`subscribeTrace` / `log` / `clearLog` /
`getProperty` / `setProperty` / `listProperties` / `listBags` /
`sharedClaims`) and the flow it hands back
(`peek` / `deal` / `dealMany` / `board` / `outcomes` / `play` /
`advanceTurns` / `listBoxes` / `listProperties` / `listBags` / `log` /
`subscribeTrace`), implementing the dealing semantics of section 3 exactly.

Held to the conformance corpus (`@storylet-studio/conformance`): every
behaviour here is pinned by a case with hand-written expectations, and the
native ports must reproduce this runtime's results bit-for-bit where the
PRNG is involved (mulberry32, `src/prng.ts`).

## One registry per game

Every property value lives in a `ScopeRegistry` (`@wildwinter/scoperegistry`), one per
game. Pass the game's as `new Engine(bundle, { registry })` to share it with any other engine
(Patter, say): the engine registers `@story` under `story` and every other bag under a key
starting `storylets/`, `@world` is the game's to register, and `saveGame()` leaves the values
to the game, which saves the registry once. Without one the engine makes its own registry, self-backs
`@world`, and `saveGame()` carries every value, so one call is still the whole run. Version 1
envelopes still load. See [Running it with Patter](https://storylet.studio/play/with-patter/#one-registry).
