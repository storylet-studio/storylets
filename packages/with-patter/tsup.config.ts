import { defineConfig } from "tsup";

// The Patter runtime stays external: this package drives a LIVE engine the host already made,
// on the host's registry, so bundling a private copy would give the game two.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [/^@patterkit\//],
});
