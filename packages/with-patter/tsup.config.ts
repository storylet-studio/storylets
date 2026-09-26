import { defineConfig } from "tsup";

export default defineConfig([
  {
    // The library. The Patter runtime stays external: this package drives a LIVE engine the host
    // already made, on the host's registry, so bundling a private copy would give the game two.
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    external: [/^@patterkit\//],
  },
  {
    // The browser drop-in, for a page with no bundler (the Hamlet's): everything under one global,
    // `StoryletsWithPatter`, beside the two engines' own drop-ins. It needs nothing of Patter's at
    // run time (only its types), so nothing is left out.
    entry: { "with-patter": "src/index.ts" },
    format: ["iife"],
    globalName: "StoryletsWithPatter",
    platform: "browser",
    minify: true,
    sourcemap: true,
    outExtension: () => ({ js: ".min.js" }),
  },
]);
