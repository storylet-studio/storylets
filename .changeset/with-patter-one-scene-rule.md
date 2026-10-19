---
"@storylet-studio/with-patter": minor
---

A card finds its Patter scene by Patter's own rule, `resolveSceneRef` from `@patterkit/runtime` (the scene's address first, then its internal id), in `sceneIdFor` and `checkPairing`, and both functions are re-exported. They tried the internal id first, so where one scene's id was another's address they picked a different scene from the one the game opens. The Performer also names a speaker by Patter's speaker label first, so an off-screen or voice-over line reads "Tam (O.S.)" as in Patter's own playable page. Needs `@patterkit/runtime` 0.32.0 or later.
