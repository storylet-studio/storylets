import { defineConfig } from "tsup";

// Two artifacts from one source, Patter's runtime shape carried whole:
//
//   1. The library - ESM + CJS + types, dependencies left external, for anyone
//      with a bundler or a Node process.
//   2. The browser DROP-IN - a single self-contained minified IIFE with every
//      dependency inlined, exposing `window.StoryletEngine`, for a plain HTML
//      page with no build step at all.
//
// The second is not a nicety: play/javascript.md tells the reader the zip
// carries "a browser drop-in for a plain HTML page with no build step", and
// until this config existed that sentence described something the build could
// not produce.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    // Dependencies are INLINED, which is where our npm decision reaches into the
    // build. Patter can leave these external because `@patterkit/runtime` is
    // published and `npm i` fetches its dependencies. Ours is not published: the
    // release zip IS the distribution, and play/javascript.md tells the reader to
    // copy the folders into their project and import from them. With externals
    // left in, doing exactly that fails with ERR_MODULE_NOT_FOUND on
    // `@wildwinter/expr` - the dependency is neither in the zip nor on any
    // registry. Inlining is what makes the documented instruction true.
    noExternal: [/^@storylet-studio\//, /^@wildwinter\//],
  },
  {
    entry: { storyletengine: "src/index.ts" },
    format: ["iife"],
    globalName: "StoryletEngine",
    platform: "browser",
    minify: true,
    sourcemap: true,
    // Inline EVERYTHING - the workspace packages and the @wildwinter/* ones -
    // so the script needs no loader, no import map and no network beyond itself.
    noExternal: [/.*/],
    outExtension: () => ({ js: ".min.js" }),
  },
]);
