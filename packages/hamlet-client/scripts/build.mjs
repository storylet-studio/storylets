// Build the Hamlet client, which is nothing but COPYING: there is no bundler
// and no compiler here. dist/ gets the page, its stylesheet, the three plain
// scripts from src/, the two runtimes' browser files, and the two PUBLISHED
// bundles. The one check is that the two bundles line up (pairing.mjs).
//
// The bundles are static files, published by Storyletter and Patterpad to each
// editor's default place beside its project (examples/storylet-dist/the-hamlet
// .storyletsc, examples/patter-dist/the_hamlet.patterc) and committed. Edit a
// shard and forget to Publish, and the demo shows the old content, exactly as
// a game would.
//
// The runtimes: ours is the drop-in the play-helpers package builds
// (storyletengine.min.js, the runtime AND its helpers on one global); Patter's
// is patterplay.min.js from its PINNED release, fetched once into vendor/,
// never from a checkout of ../patter (on a runner that resolves to something
// other than what shipped).
import { mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { checkPairing, checkWorld } from "./pairing.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const root = resolve(pkg, "../..");
export const published = {
  storylets: join(root, "examples/storylet-dist/the-hamlet.storyletsc"),
  patter: join(root, "examples/patter-dist/the_hamlet.patterc"),
};
export const sources = ["world.js", "performance.js", "main.js"].map((f) => [f, join(pkg, "src", f)]);
const out = join(pkg, "dist");

const PATTER_JS_VERSION = "0.12.0";
const patterMinUrl = `https://github.com/patterkit/patter/releases/download/play-js-v${PATTER_JS_VERSION}/patterplay.min.js`;
const ourMin = join(root, "packages/play-helpers/dist/storyletengine.min.js");
const patterMin = join(pkg, "vendor", `patterplay-${PATTER_JS_VERSION}.min.js`);

/** The box this host performs through Patter. The host's decision, never the project's. */
const PATTER_BACKED = ["village"];

class BuildError extends Error {}
const die = (msg) => { throw new BuildError(`hamlet-client build: ${msg}`); };

/** Read both published bundles and check they line up. Throws BuildError. */
export function loadPublished() {
  for (const [name, path] of Object.entries(published)) {
    if (!existsSync(path)) die(`no published ${name} bundle at ${path}: publish it from ${name === "storylets" ? "Storyletter" : "Patterpad"} (Project Settings > Project > Publish)`);
  }
  const bundle = JSON.parse(readFileSync(published.storylets, "utf8"));
  const patterBundle = JSON.parse(readFileSync(published.patter, "utf8"));
  const problems = [...checkPairing(bundle, patterBundle, PATTER_BACKED), ...checkWorld(bundle, patterBundle)];
  if (problems.length) die(`the two published bundles do not line up:\n  ${problems.join("\n  ")}`);
  return { bundle, patterBundle };
}

/** Patter's browser file from its pinned release, fetched once. */
export async function ensurePatterMin() {
  if (existsSync(patterMin)) return patterMin;
  mkdirSync(dirname(patterMin), { recursive: true });
  const res = await fetch(patterMinUrl);
  if (!res.ok) die(`could not fetch Patter's browser file ${PATTER_JS_VERSION} (${res.status}) from ${patterMinUrl}`);
  writeFileSync(patterMin, Buffer.from(await res.arrayBuffer()));
  return patterMin;
}

export async function buildHamlet() {
  const { bundle, patterBundle } = loadPublished();
  if (!existsSync(ourMin)) die(`no ${ourMin}: run \`npm run build\` at the repo root once (the play-helpers package builds the drop-in)`);
  await ensurePatterMin();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyFileSync(published.storylets, join(out, "hamlet.storyletsc"));
  copyFileSync(published.patter, join(out, "hamlet.patterc"));
  copyFileSync(ourMin, join(out, "storyletengine.min.js"));
  copyFileSync(patterMin, join(out, "patterplay.min.js"));
  copyFileSync(join(pkg, "index.html"), join(out, "index.html"));
  copyFileSync(join(pkg, "hamlet.css"), join(out, "hamlet.css"));
  for (const [name, path] of sources) copyFileSync(path, join(out, name));
  const cards = bundle.boxes.flatMap((b) => b.decks).flatMap((d) => d.cards).length;
  console.log(`hamlet-client: ${cards} card(s) paired with ${Object.keys(patterBundle.scenes ?? {}).length} scene(s); copied, not built -> ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await buildHamlet(); }
  catch (e) { console.error(e instanceof BuildError ? e.message : e); process.exit(1); }
}
