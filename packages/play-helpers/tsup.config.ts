import { defineConfig } from "tsup";

// Same reasoning as the runtime's config: the release zip is the distribution,
// so anything a consumer cannot resolve has to be inlined.
//
// The ONE deliberate exception is `@storylet-studio/runtime`, which stays
// external because the zip ships it as a sibling folder. That is not a size
// optimisation: play-helpers wraps a LIVE engine, so bundling its own private
// copy would give the host two runtimes and a save written by one that the other
// has never heard of.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  noExternal: [/^@storylet-studio\/(?!runtime)/, /^@wildwinter\//],
});
