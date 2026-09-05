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
