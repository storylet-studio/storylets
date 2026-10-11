import { defineConfig } from "tsup";

// dist/cli.js is THIN, as Patter's is: only the CLI's own code, with its dependencies (ops and theirs)
// resolved from node_modules beside it. Running with no node_modules at all is the standalone binaries'
// job: `build:standalone` (Bun --compile) bundles src/cli.ts and every dependency, with their licence
// notices.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  splitting: false,
  platform: "node",
  clean: true,
});
