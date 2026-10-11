import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

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
  "@storylet-studio/with-patter",
  "@wildwinter/expr",
  "@wildwinter/toolkit",
  "@wildwinter/expr-specificity",
  "@wildwinter/expr-editor",
  // Bundled, as it was when it arrived only through the runtime: the scopes entry point
  // (shared game scopes) is imported here directly now, which made it a dependency.
  "@wildwinter/scoperegistry",
];

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const expr = (pkg: string, entry = "index"): string | undefined => {
  const src = here(`../../../expr/packages/${pkg}/src/${entry}.ts`);
  return existsSync(src) ? src : undefined;
};

const aliases = {
  "@storylet-studio/model": here("../model/src/index.ts"),
  "@storylet-studio/dialect": here("../dialect/src/index.ts"),
  "@storylet-studio/compiler": here("../compiler/src/index.ts"),
  "@storylet-studio/runtime": here("../runtime/src/index.ts"),
  // The subpath before the package, since an alias matches as a prefix: the one
  // file of ops a renderer loads (coverage's reading rules, which the Coverage
  // window shares with the CLI). The rest of ops is Node code, for main only.
  "@storylet-studio/ops/coverage-order": here("../ops/src/coverage-order.ts"),
  "@storylet-studio/ops": here("../ops/src/index.ts"),
  "@storylet-studio/with-patter": here("../with-patter/src/index.ts"),
  ...(expr("expr") ? { "@wildwinter/expr": expr("expr")! } : {}),
  ...(expr("expr-specificity") ? { "@wildwinter/expr-specificity": expr("expr-specificity")! } : {}),
  // The subpath before the package, since an alias matches as a prefix. One copy of the
  // registry for the runtime and the Board's stand-ins, from the sibling source like expr.
  ...(expr("scoperegistry", "scopes") ? { "@wildwinter/scoperegistry/scopes": expr("scoperegistry", "scopes")! } : {}),
  ...(expr("scoperegistry") ? { "@wildwinter/scoperegistry": expr("scoperegistry")! } : {}),
  // expr-editor is consumed from its published package (JS + styles.css); its
  // own @wildwinter/expr imports still hit the source alias above.
};

// The app ships only the font files it uses, never whole font packages (patterkit's design/fonts.md).
// Vite bundles the faces fonts.css names into the renderer; this copies the licence of every font package
// it names into dist-electron/fonts, which the OFL requires to travel with the fonts, and package.json's
// `build.files` leaves the font packages themselves out of node_modules. (Patterpad's does the same, and
// also copies the files its PDF export reads at run time; Storyletter has no PDF export.)
function fontLicences(): Plugin {
  return {
    name: "storyletter-font-licences",
    writeBundle() {
      const req = createRequire(here("package.json"));
      const out = here("dist-electron/fonts");
      rmSync(out, { recursive: true, force: true });
      const fontsCss = readFileSync(here("src/renderer/src/fonts.css"), "utf8");
      const packages = new Set([...fontsCss.matchAll(/"(@(?:fontsource|ibm)\/[a-z0-9-]+)\//g)].map((m) => m[1]!));
      for (const pkg of packages) {
        const dir = (req.resolve.paths(pkg) ?? []).map((p) => join(p, pkg)).find((d) => existsSync(d));
        const licence = dir && readdirSync(dir).find((f) => /^(licen[cs]e|ofl)/i.test(f));
        if (!dir || !licence) throw new Error(`storyletter-font-licences: no licence file for ${pkg}`);
        mkdirSync(join(out, pkg), { recursive: true });
        copyFileSync(join(dir, licence), join(out, pkg, licence));
      }
    },
  };
}

// The open-source libraries bundled into each part of the app (main, preload, renderer) carry their
// licences with them: MIT, ISC, BSD and Apache-2.0 all ask for the notice to travel with every copy, and a
// bundle keeps none of their files. So each build lists the files it bundled (every chunk's moduleIds) and
// writes their packages' licence and copyright notices to dist-electron/licences/<part>.txt, with the
// shared scripts/third-party-notices.mjs (vendored from expr/tooling, the collector the standalone CLI
// uses). The libraries main leaves external ship in node_modules with their own files. The Storylet
// Engine's own packages are covered by its LICENSE, copied in beside them. (Patterpad's does the same.)
type NoticesModule = { collectNoticesFromFiles(files: Iterable<string>, opts: { exclude: string[] }): { text: string; packages: unknown[] } };
function bundledNotices(part: string): Plugin {
  const ids = new Set<string>();
  return {
    name: "storyletter-bundled-notices",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) if (chunk.type === "chunk") for (const id of chunk.moduleIds) ids.add(id);
    },
    async writeBundle() {
      const { collectNoticesFromFiles } = (await import(pathToFileURL(here("../../scripts/third-party-notices.mjs")).href)) as NoticesModule;
      const { text, packages } = collectNoticesFromFiles(ids, { exclude: ["@storylet-studio/"] });
      const out = here("dist-electron/licences");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${part}.txt`), `Open-source libraries bundled into Storyletter (${part}), and their licences. ${packages.length} packages.\n\n${text}`);
      copyFileSync(here("../../LICENSE"), join(out, "LICENSE"));
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias: aliases },
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs }), bundledNotices("main")],
    build: { outDir: "dist-electron/main", rollupOptions: { input: here("src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bundledNotices("preload")],
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
    plugins: [fontLicences(), bundledNotices("renderer")],
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
