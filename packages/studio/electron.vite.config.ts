import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// Workspace packages are bundled FROM SOURCE (aliased below), so the packaged
// app never depends on built dist/ output - the Patterpad arrangement,
// including the electron-vite 5 gotcha: externalizeDepsPlugin would leave the
// workspace names as bare imports in the output (ERR_MODULE_NOT_FOUND in a
// packaged app), so they are excluded from externalisation explicitly.
const workspacePkgs = [
  "@storylet-studio/model",
  "@storylet-studio/dialect",
  "@storylet-studio/compiler",
  "@storylet-studio/runtime",
  "@storylet-studio/ops",
  "@wildwinter/expr",
  "@wildwinter/toolkit",
  "@wildwinter/expr-specificity",
  "@wildwinter/expr-editor",
];

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const expr = (pkg: string): string | undefined => {
  const src = here(`../../../expr/packages/${pkg}/src/index.ts`);
  return existsSync(src) ? src : undefined;
};

const aliases = {
  "@storylet-studio/model": here("../model/src/index.ts"),
  "@storylet-studio/dialect": here("../dialect/src/index.ts"),
  "@storylet-studio/compiler": here("../compiler/src/index.ts"),
  "@storylet-studio/runtime": here("../runtime/src/index.ts"),
  "@storylet-studio/ops": here("../ops/src/index.ts"),
  ...(expr("expr") ? { "@wildwinter/expr": expr("expr")! } : {}),
  ...(expr("expr-specificity") ? { "@wildwinter/expr-specificity": expr("expr-specificity")! } : {}),
  // expr-editor is consumed from its published package (JS + styles.css); its
  // own @wildwinter/expr imports still hit the source alias above.
};

export default defineConfig({
  main: {
    resolve: { alias: aliases },
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    build: { outDir: "dist-electron/main", rollupOptions: { input: here("src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/preload",
      rollupOptions: {
        input: here("src/preload/index.ts"),
        // The preload is sandboxed: it must be a plain CJS file.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve: { alias: aliases },
    build: {
      outDir: "dist-electron/renderer",
      rollupOptions: {
        // Five windows: the editor shell, the Board, Coverage, Find and Links.
        input: {
          index: here("src/renderer/index.html"),
          table: here("src/renderer/table.html"),
          coverage: here("src/renderer/coverage.html"),
          search: here("src/renderer/search.html"),
          links: here("src/renderer/links.html"),
        },
      },
    },
  },
});
