import { defineConfig } from "tsup";

// The same split as the runtime's config: an npm library with dependencies left
// external (dist/), a zip library with them inlined (dist-zip/), and the drop-in.
//
// The zip library's ONE deliberate exception is `@storylet-studio/runtime`, which
// stays external because the zip ships it as a sibling folder. That is not a size
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
  },
  {
    entry: ["src/index.ts"],
    outDir: "dist-zip",
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
