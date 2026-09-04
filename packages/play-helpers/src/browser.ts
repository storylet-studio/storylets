// The browser drop-in: ONE classic script, no build step, defining the
// `StoryletEngine` global with the runtime AND these helpers on it, so a plain
// page can build an engine, deal, play, and save and load the family's
// .storyletsave text, all from two script tags (this and Patterplay's).
//
// Built by this package rather than the runtime because this is the one
// package that depends on both: the runtime cannot bundle the helpers without
// bundling itself twice. The export names of the two do not overlap (checked
// 2026-09-04), so `export *` from each is exact.
export * from "@storylet-studio/runtime";
export * from "./index.js";
