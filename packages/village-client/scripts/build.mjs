// Build the Village client: its CONTENT out of the example project, and its
// script out of TypeScript.
//
// Nothing here is hand-copied, which is the whole anti-drift argument
// (design/village-client.md section 5). The bundle is compiled from
// `examples/the-village.storylets` shards on every build, the map geometry is
// derived by the same op the playable page uses, and the pictures are copied
// from the box's own `assets/`. So the client cannot describe a Village that
// is not the Village, and a compile error here fails the build rather than
// shipping a sample that does not run.
//
// Output is dist/: index.html, village.js, village.storyletsc, assets/.
// Nothing in dist/ is committed.

import { mkdirSync, rmSync, readdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

// The two packages this reads the project through are consumed as BUILT
// modules (their `dist/` is gitignored), so on a fresh clone they may not be
// there yet. Imported dynamically for one reason: a missing dependency should
// say what to run, not throw ERR_MODULE_NOT_FOUND at somebody trying the
// sample for the first time.
const need = async (name) => {
  try {
    return await import(name);
  } catch {
    console.error(`village-client build: ${name} has not been built yet.\n`
      + "  Run `npm run build` at the repo root once, then try again.");
    process.exit(1);
  }
};
const { loadProject, playableMaps } = await need("@storylet-studio/ops");
const { compileProject, serialiseBundle } = await need("@storylet-studio/compiler");

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const root = resolve(pkg, "../..");
const project = join(root, "examples/the-village.storylets");
const out = join(pkg, "dist");

const die = (msg) => { console.error(`village-client build: ${msg}`); process.exit(1); };

// --- 1. the project, from its shards ----------------------------------------
const loaded = loadProject(project);
if (!loaded.source) die(`could not load ${project}`);

// --- 2. the bundle, compiled with full metadata -----------------------------
// `full` because a client shows TITLES and PURPOSES to a player; a stripped
// bundle is for shipping, and would leave the sample rendering game ids.
const source = {
  ...loaded.source,
  project: { ...loaded.source.project, export: { ...loaded.source.project.export, metadata: "full" } },
};
const { bundle, issues } = compileProject(source);
const errors = issues.filter((i) => i.severity === "error");
if (errors.length || !bundle) {
  die(`the Village does not compile, so there is no sample to ship:\n  ${errors.map((e) => e.message).join("\n  ")}`);
}
for (const w of issues.filter((i) => i.severity === "warning")) console.warn(`  warning: ${w.message}`);

// --- 3. the maps, derived (not authored twice) ------------------------------
const mapIssues = [];
const maps = playableMaps(loaded, mapIssues, { pictures: "byName" });
for (const i of mapIssues) console.warn(`  map: ${i.message}`);
if (maps.length === 0) die("the Village has no drawn map, and the client is a map game");

// --- 4. the pictures --------------------------------------------------------
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
let pictures = 0;
for (const box of loaded.source.boxes) {
  const assets = join(project, box.path, "assets");
  if (!existsSync(assets)) continue;
  for (const name of readdirSync(assets)) {
    copyFileSync(join(assets, name), join(out, "assets", name));
    pictures++;
  }
}

// --- 5. the page ------------------------------------------------------------
writeFileSync(join(out, "village.storyletsc"), serialiseBundle(bundle));
writeFileSync(join(out, "maps.json"), JSON.stringify(maps));
copyFileSync(join(pkg, "index.html"), join(out, "index.html"));
copyFileSync(join(pkg, "village.css"), join(out, "village.css"));

const result = await build({
  entryPoints: [join(pkg, "src/main.ts")],
  outfile: join(out, "village.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
  // The root tsconfig aliases @storylet-studio/* to package SOURCE, which is
  // what makes an API change break THIS build rather than a later download.
  tsconfig: join(root, "tsconfig.json"),
  logLevel: "silent",
});
if (result.errors.length) die(result.errors.map((e) => e.text).join("\n"));

const js = readFileSync(join(out, "village.js"), "utf8");
console.log(`village-client: ${bundle.boxes.length} box(es), ${maps.length} map(s), `
  + `${pictures} picture(s), ${Math.round(js.length / 1024)} kB of script -> ${out}`);
