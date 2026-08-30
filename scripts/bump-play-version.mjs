// Bump the four Storylet Engine runtimes (JS / Unity / Unreal / Godot) to a new
// version, in lockstep.
//
//   npm run bump:play -- 0.2.0
//
// One version number always spans the whole runtime set: they play the same
// bundle and are held to the same corpus, so a version that meant something
// different in each would be a version that meant nothing. This script:
//
//   1. writes the version into every runtime manifest
//        packages/runtime/package.json                       "version"
//        ports/unity/StoryletEngine/package.json             "version"
//        ports/unreal/StoryletEngine/StoryletEngine.uplugin  "VersionName" (+ "Version"++)
//        ports/godot/addons/storyletengine/plugin.cfg        version=
//   2. stamps today's date into each runtime CHANGELOG.md: the "## [Unreleased]"
//      section becomes "## [<version>] - <date>" and a fresh empty
//      "## [Unreleased]" goes in above it
//   3. prints the four tag commands that trigger the release pipelines
//
// The release workflows refuse a tag whose version does not match its manifest,
// AND refuse one whose changelog has no dated section, so this script is the one
// route to a release rather than a convenience over four hand edits.
//
// (Patter's bump-play-version.mjs, carried across. Ours has no Changesets note
// because we publish nothing to npm yet: public-split step 6a.)

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: npm run bump:play -- <x.y.z>");
  process.exit(2);
}

const at = (p) => resolve(ROOT, p);
const read = (p) => readFileSync(at(p), "utf8");
const write = (p, s) => { writeFileSync(at(p), s); console.log("  wrote", p); };

// --- 1. the manifests ------------------------------------------------------

// Idempotent on purpose. A bump that has to be re-run - because a pin was missed,
// or a tag failed and the fix is in - should carry on rather than throw halfway
// through and leave the tree half-bumped.
const bumpJsonVersion = (p) => {
  const s = read(p);
  const out = s.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
  if (out === s) {
    if (!s.includes(`"version": "${version}"`)) throw new Error(`${p}: no "version" field to change`);
    console.log("  skip ", p, `(already ${version})`);
    return;
  }
  write(p, out);
};

bumpJsonVersion("packages/runtime/package.json");
bumpJsonVersion("ports/unity/StoryletEngine/package.json");

// The JS runtime is a WORKSPACE package that its siblings depend on by EXACT
// version, so bumping it without refreshing those pins leaves them asking for a
// version no longer in the tree. npm then concludes the dependency must be on a
// registry, and `npm ci` dies with
//   404 '@storylet-studio/runtime@0.0.0' is not in this registry
// on a scope where we publish nothing. That failure landed in a release run
// rather than locally, because an existing node_modules keeps working and only a
// clean install re-resolves. Patter's script refreshes these pins for the same
// reason; ours did not, for exactly one release.
{
  const pinned = "packages/runtime/package.json";
  const name = JSON.parse(read(pinned)).name;
  for (const p of ["packages/ops/package.json", "packages/play-helpers/package.json",
                   "packages/studio/package.json"]) {
    const s = read(p);
    const re = new RegExp(`("${name.replace("/", "\\/")}":\\s*")[^"]*(")`);
    if (!re.test(s)) continue;
    const out = s.replace(re, `$1${version}$2`);
    if (out !== s) write(p, out);
  }
}

// Unreal carries two: VersionName is the human one the tag is checked against,
// Version is an integer Epic wants incremented on every release.
{
  const p = "ports/unreal/StoryletEngine/StoryletEngine.uplugin";
  const s = read(p);
  const current = JSON.parse(s);
  if (current.VersionName === version) {
    console.log("  skip ", p, `(already ${version})`);
  } else {
    const out = s
      .replace(/"VersionName":\s*"[^"]*"/, `"VersionName": "${version}"`)
      .replace(/"Version":\s*\d+/, `"Version": ${Number(current.Version) + 1}`);
    if (out === s) throw new Error(`${p}: nothing changed`);
    write(p, out);
  }
}

// Godot's plugin.cfg is ini, not JSON.
{
  const p = "ports/godot/addons/storyletengine/plugin.cfg";
  const s = read(p);
  const out = s.replace(/^version=".*"$/m, `version="${version}"`);
  if (out === s) {
    if (!s.includes(`version="${version}"`)) throw new Error(`${p}: no version= line to change`);
    console.log("  skip ", p, `(already ${version})`);
  } else write(p, out);
}

// --- 2. the changelogs -----------------------------------------------------

// Date in the repo's timezone, not UTC: the heading is read by people, and a
// release cut in the evening should not be dated tomorrow.
const today = new Date().toLocaleDateString("en-CA");   // YYYY-MM-DD

const CHANGELOGS = [
  "packages/runtime/CHANGELOG.md",
  "ports/unity/StoryletEngine/CHANGELOG.md",
  "ports/unreal/StoryletEngine/CHANGELOG.md",
  "ports/godot/addons/storyletengine/CHANGELOG.md",
];

for (const p of CHANGELOGS) {
  const s = read(p);
  if (s.includes(`## [${version}]`)) { console.log("  skip ", p, `(already has ${version})`); continue; }
  if (!s.includes("## [Unreleased]")) throw new Error(`${p}: no "## [Unreleased]" heading to date`);
  write(p, s.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] - ${today}`));
}

// --- 3. what to do next ----------------------------------------------------

console.log(`\nBumped the runtime set to ${version}. Commit, then tag:\n`);
for (const engine of ["js", "unity", "unreal", "godot"]) {
  console.log(`  git tag play-${engine}-v${version} && git push origin play-${engine}-v${version}`);
}
console.log("\nEach tag is checked against its manifest AND its changelog, so a half-done bump fails at the tag rather than shipping.");
