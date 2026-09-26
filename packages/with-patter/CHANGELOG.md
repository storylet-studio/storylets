# @storylet-studio/with-patter

## 0.2.0

### Minor Changes

- e198ce0: `Performer.resume(saved, outcomes)` picks a performance back up after a load, reading the pending choice off the restored flow (and re-resolving the outcome of one that had ended). A card with no outcomes is played with none: the scene resolves to `""`. A greyed option says why (`why`: "not available here" when Patter's condition fails, "requirements not met" when the outcome is shut). `checkPairing(storyletBundle, patterBundle, boxes?)`, with `optionsOf` and `outcomesReported`, checks two published bundles line up at build time. A browser drop-in, `@storylet-studio/with-patter/with-patter.min.js`, puts it all under a `StoryletsWithPatter` global for a page with no bundler.
