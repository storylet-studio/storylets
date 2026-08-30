import { defineConfig } from "tsup";

// The CLI ships SELF-CONTAINED: every workspace package and runtime
// dependency is bundled into dist/cli.js, so `node dist/cli.js` works with
// no node_modules at all. (Node built-ins stay external, as always.) The
// true single-binary step - no Node either - is `build:standalone`
// (Bun --compile) over this same entry. (Patter's CLI shipping shape,
// carried whole.)
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  splitting: false, // ONE file - dynamic imports inline (still lazily executed)
  platform: "node",
  clean: true,
  // exceljs and jszip named as Patter's config names them: "every runtime
  // dependency" has to include the two that are not workspace packages, or
  // export-xlsx and pack are the commands that need a node_modules after all.
  noExternal: [/^@storylet-studio\//, /^@wildwinter\//, "json5", "exceljs", "jszip"],
  // A real `require` for any inlined CJS dependency that resolves node
  // builtins dynamically (exceljs does: require('crypto') and friends).
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
