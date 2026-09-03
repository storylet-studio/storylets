// Build the Hamlet client: the storylet project AND the Patter project, both
// compiled from their shards on every build.
//
// Same anti-drift rule as the Village client (design/village-client.md 5) and
// the same reason, doubled: this sample's whole claim is that two engines agree
// about one world, so a hand-copied bundle on either side would let it claim
// that while being false. A compile error in either project fails the build.
//
// Output is dist/: index.html, hamlet.js, hamlet.storyletsc, hamlet.patterc.
// Nothing in dist/ is committed.

import { mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const need = async (name) => {
  try {
    return await import(name);
  } catch {
    console.error(`hamlet-client build: ${name} has not been built yet.\n`
      + "  Run `npm run build` at the repo root once, then try again.");
    process.exit(1);
  }
};
const { loadProject } = await need("@storylet-studio/ops");
const { compileProject, serialiseBundle } = await need("@storylet-studio/compiler");
// Patter's half comes from npm, NOT a file: link into ../patter. A file: link
// resolves to the older PUBLISHED version on a runner, silently, which this
// project has been caught by before.
const patterOps = await need("@patterkit/ops");

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const root = resolve(pkg, "../..");
const storyletProject = join(root, "examples/the-hamlet.storylets");
const patterProject = join(root, "examples/the-hamlet.patter");
const out = join(pkg, "dist");

const die = (msg) => { console.error(`hamlet-client build: ${msg}`); process.exit(1); };

// --- 1. the storylet half ---------------------------------------------------
const loaded = loadProject(storyletProject);
if (!loaded.source) die(`could not load ${storyletProject}`);
// `full` metadata because a client shows a player TITLES, not game ids.
const source = {
  ...loaded.source,
  project: { ...loaded.source.project, export: { ...loaded.source.project.export, metadata: "full" } },
};
const { bundle, issues } = compileProject(source);
const errors = issues.filter((i) => i.severity === "error");
if (errors.length || !bundle) {
  die(`the Hamlet does not compile:\n  ${errors.map((e) => e.message).join("\n  ")}`);
}
for (const w of issues.filter((i) => i.severity === "warning")) console.warn(`  warning: ${w.message}`);

// --- 2. the Patter half -----------------------------------------------------
const patterLoaded = patterOps.loadProject(patterProject);
const patterBundle = patterOps.runExportFull(patterLoaded);
if (!patterBundle) die(`the Hamlet's Patter project does not compile (${patterProject})`);

// --- 3. the cross-check, which is the point of the naming convention --------
// A card's gameId IS its scene id and an outcome's gameId IS the id the scene
// reports (Reboot.md 10). Nothing declares that, so nothing validates it, so
// this does - AT BUILD TIME, because the failure it prevents is a card that
// plays no dialogue and looks exactly like a card that meant to.
// The boxes this host performs through Patter. The opt-in is the HOST'S, not
// the project's: no Patter concept belongs in a storylet bundle, so it is named
// here, beside the host, and never in a shard. The Hamlet has one box, so this
// changes nothing today; it is passed so the parameter is exercised rather than
// being untested surface waiting for a second box.
const PATTER_BACKED = ["village"];
const { checkPairing, checkWorld, checkPinnedGameIds } = await import("./pairing.mjs");
const problems = [
  ...checkPairing(bundle, patterBundle, PATTER_BACKED),
  ...checkWorld(bundle, patterBundle),
  ...checkPinnedGameIds(loaded.source, PATTER_BACKED),
];
if (problems.length) {
  die(`the two projects do not line up:\n  ${problems.join("\n  ")}`);
}

// --- 4. the page ------------------------------------------------------------
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "hamlet.storyletsc"), serialiseBundle(bundle));
writeFileSync(join(out, "hamlet.patterc"), JSON.stringify(patterBundle));
copyFileSync(join(pkg, "index.html"), join(out, "index.html"));
copyFileSync(join(pkg, "hamlet.css"), join(out, "hamlet.css"));

const result = await build({
  entryPoints: [join(pkg, "src/main.ts")],
  outfile: join(out, "hamlet.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
  // The root tsconfig aliases @storylet-studio/* to package SOURCE, so an API
  // change breaks THIS build rather than a later download.
  tsconfig: join(root, "tsconfig.json"),
  logLevel: "silent",
});
if (result.errors.length) die(result.errors.map((e) => e.text).join("\n"));

const js = readFileSync(join(out, "hamlet.js"), "utf8");
const cards = bundle.boxes.flatMap((b) => b.decks).flatMap((d) => d.cards).length;
console.log(`hamlet-client: ${cards} card(s) paired with ${Object.keys(patterBundle.scenes ?? {}).length} scene(s), `
  + `${Math.round(js.length / 1024)} kB of script -> ${out}`);
