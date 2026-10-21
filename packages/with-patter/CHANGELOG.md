# @storylet-studio/with-patter

## 0.4.0

### Minor Changes

- cd4230c: Takes Patterplay 0.34.0 or later (`@patterkit/runtime` `>=0.34.0 <1.0.0`), where `extensionSettings` is gone with extension settings.

### Patch Changes

- Updated dependencies [431356a]
  - @storylet-studio/model@0.13.0

## 0.3.0

### Minor Changes

- 6323137: A card finds its Patter scene by Patter's own rule, `resolveSceneRef` from `@patterkit/runtime` (the scene's address first, then its internal id), in `sceneIdFor` and `checkPairing`, and both functions are re-exported. They tried the internal id first, so where one scene's id was another's address they picked a different scene from the one the game opens. The Performer also names a speaker by Patter's speaker label first, so an off-screen or voice-over line reads "Tam (O.S.)" as in Patter's own playable page. Needs `@patterkit/runtime` 0.32.0 or later.

### Patch Changes

- Updated dependencies [2c197e7]
  - @storylet-studio/model@0.12.0

## 0.2.1

### Patch Changes

- 6a0c9c1: Each package now carries the MIT licence text (LICENSE) in its own folder, so the licence travels with every install.
- Updated dependencies [abe401f]
- Updated dependencies [c520d2b]
- Updated dependencies [6a0c9c1]
  - @storylet-studio/model@0.10.0

## 0.2.0

### Minor Changes

- e198ce0: `Performer.resume(saved, outcomes)` picks a performance back up after a load, reading the pending choice off the restored flow (and re-resolving the outcome of one that had ended). A card with no outcomes is played with none: the scene resolves to `""`. A greyed option says why (`why`: "not available here" when Patter's condition fails, "requirements not met" when the outcome is shut). `checkPairing(storyletBundle, patterBundle, boxes?)`, with `optionsOf` and `outcomesReported`, checks two published bundles line up at build time. A browser drop-in, `@storylet-studio/with-patter/with-patter.min.js`, puts it all under a `StoryletsWithPatter` global for a page with no bundler.
