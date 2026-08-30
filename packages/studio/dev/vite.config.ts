// The labs' own vite config (the dev root is this folder, so vite finds it here).
//
// It exists for one reason: the labs import APP modules, and app modules import
// workspace packages by name. Without an alias those resolve through node_modules
// to each package's built `dist`, which is a gitignored artifact that may be
// months stale - the map lab's first run failed on a `labelPoint` that existed in
// source and not in dist. The app itself builds from source
// (electron.vite.config.ts), and the test suite runs from source
// (vitest.config.ts); this is the same arrangement for the third way in.

import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@storylet-studio/model": here("../../model/src/index.ts"),
      "@storylet-studio/dialect": here("../../dialect/src/index.ts"),
      "@storylet-studio/compiler": here("../../compiler/src/index.ts"),
      "@storylet-studio/runtime": here("../../runtime/src/index.ts"),
      "@storylet-studio/ops": here("../../ops/src/index.ts"),
    },
  },
});
