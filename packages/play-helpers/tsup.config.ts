import { defineConfig } from "tsup";

// Same reasoning as the runtime's config: the release zip is the distribution,
// so anything a consumer cannot resolve has to be inlined.
//
// The ONE deliberate exception is `@storylet-studio/runtime`, which stays
// external because the zip ships it as a sibling folder. That is not a size
// optimisation: play-helpers wraps a LIVE engine, so bundling its own private
// copy would give the host two runtimes and a save written by one that the other
// has never heard of.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    noExternal: [/^@storylet-studio\/(?!runtime)/, /^@wildwinter\//],
  },
  {
    // The browser drop-in (src/browser.ts): runtime + helpers under one global.
    // Inline EVERYTHING so the script needs no loader, no import map and no
    // network beyond itself. Lives here, not in the runtime, because this is
    // the one package that depends on both.
    entry: { storyletengine: "src/browser.ts" },
    format: ["iife"],
    globalName: "StoryletEngine",
    platform: "browser",
    minify: true,
    sourcemap: true,
    noExternal: [/.*/],
    outExtension: () => ({ js: ".min.js" }),
  },
]);
