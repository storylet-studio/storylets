// @storylet-studio/with-patter: perform a dealt storylet card as the Patter scene named after it,
// and check, at build time, that the cards and the scenes line up.
export { Performer, sceneIdFor } from "./performer.js";
export type { Beat, CardOutcome, Performance, PerformerLink, SceneOption } from "./performer.js";
export { checkPairing, optionsOf, outcomesReported } from "./pairing.js";
export type { BundleOption } from "./pairing.js";
