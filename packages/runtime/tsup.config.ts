import { defineConfig } from "tsup";

// Three artifacts from one source, the same shape as Patter's runtime:
//
//   1. The npm library (dist/) - ESM + CJS + types, dependencies left EXTERNAL,
//      so npm resolves them. `@wildwinter/scoperegistry` above all: it is a peer
//      dependency, a game holds ONE registry that every engine in it shares, and
//      a runtime carrying its own copy would not be on it.
//   2. The zip library (dist-zip/) - the same modules with every dependency
//      INLINED, for the release zip. play/javascript.md tells the reader to copy
//      the zip's folders into their project and import from them, with no npm
//      behind it, so anything they cannot resolve has to be inside. It carries its
//      own registry as a result, which the docs say.
//   3. The browser drop-in (storyletengine.min.js), built by play-helpers, the one
//      package that depends on the runtime AND the helpers it carries.
//
// Until 2026-09-27 there was one library build, inlined for the zip and published
// to npm as well, so npm users ran a private registry fixed at build time.
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
    noExternal: [/^@storylet-studio\//, /^@wildwinter\//],
  },
]);
