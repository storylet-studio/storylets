import { defineConfig } from "tsup";

// `qrcode` stays EXTERNAL. It is the one real dependency in the family's
// front-end stack, it has a browser build of its own that a bundler picks
// correctly, and inlining it here would mean a page that also uses it ships
// two copies of a Reed-Solomon encoder.
//
// The @storylet-studio packages are inlined for the same reason the client
// inlines the wire: what they contribute at runtime is a handful of string
// constants, and a consumer should not need a second install to use a part.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  noExternal: [/^@storylet-studio\//],
});
