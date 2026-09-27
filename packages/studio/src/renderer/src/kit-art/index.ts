// The kit gallery's pictures (CREDITS.md beside this file says where each comes from). Imported, so
// Vite fingerprints and bundles them in both the dev server and the release build.
import boxBlank from "./box-blank.png";
import boxEncounters from "./box-encounters.png";
import boxConversation from "./box-conversation.png";
import projectStarter from "./project-starter.png";
import projectWithPatter from "./project-with-patter.png";
import exampleHamlet from "./example-hamlet.png";
import exampleVillage from "./example-village.png";
import examplePortMeridian from "./example-port-meridian.png";

export const KIT_ART = {
  boxBlank, boxEncounters, boxConversation, projectStarter, projectWithPatter,
  exampleHamlet, exampleVillage, examplePortMeridian,
} as const;

/** A shipped example's picture, by its folder name under `examples/`. */
export const EXAMPLE_ART: Readonly<Record<string, string>> = {
  "the-hamlet.storylets": exampleHamlet,
  "the-village.storylets": exampleVillage,
  "port-meridian.storylets": examplePortMeridian,
};
