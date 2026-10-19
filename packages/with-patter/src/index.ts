// @storylet-studio/with-patter: perform a dealt storylet card as the Patter scene named after it,
// and check, at build time, that the cards and the scenes line up.
export { Performer, sceneIdFor } from "./performer.js";
export type { Beat, CardOutcome, Performance, PerformerLink, SceneOption } from "./performer.js";
export { checkPairing, optionsOf, outcomesReported } from "./pairing.js";
// Patter's rule for a scene reference, passed on for the tools that pair cards with scenes (ops' Patter
// link) so they take the one function rather than a copy.
export { resolveSceneRef, sceneAddressIndex } from "@patterkit/runtime";
export type { BundleOption } from "./pairing.js";
