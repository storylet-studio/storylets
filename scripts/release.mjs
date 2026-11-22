// Ported from Patter's scripts/release.mjs (2026-11-22), CLI target only. Patter's also wraps its
// app and runtime bumps (release:pad, release:play); here those stay `bump:app` and `bump:play`,
// which print the tag commands to run.
//
//   npm run release:cli  [-- 1.2.0]  standalone CLI  (no bump; tag cli-v<ver>, defaulting
//                                                     to packages/cli/package.json)
//
// The CLI's version comes from Changesets, so the order is: the Version Packages PR publishes
// @storylet-studio/cli to npm, THEN this tags `cli-v<that version>` and cli.yml builds the
// standalone binaries from it. `ship:cli` runs the whole chain; this is its last step on its own,
// for when npm already serves the version (after `ship:npm` or `release:npm`, say).
//
// Guard rails:
//   - must be on main, with a CLEAN tree
//   - refuses a tag that already exists locally or on origin
//   - pushes the tag on its own: GitHub creates no push events at all when more than three
//     tags arrive in a single push

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const die = (msg) => { console.error(`release.mjs: ${msg}`); process.exit(1); };

const target = process.argv[2];
let version = process.argv[3];
if (target !== "cli") {
  die("usage: node scripts/release.mjs cli [version]  (via npm run release:cli -- <version>)");
}

// ---- preflight -------------------------------------------------------------
if (out("git rev-parse --abbrev-ref HEAD") !== "main") die("not on main");
if (out("git status --porcelain")) die("working tree not clean - commit or stash first");
run("git fetch -q origin main");
const behind = out("git rev-list --count HEAD..origin/main");
if (behind !== "0") die(`main is ${behind} commit(s) behind origin - pull first`);

const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
if (!version) {
  version = JSON.parse(readFileSync(resolve(root, "packages/cli/package.json"), "utf8")).version;
  console.log(`release.mjs: no version given - using @storylet-studio/cli's ${version}`);
}
if (!semver.test(version)) die("version must be plain semver, e.g. 1.2.0");

const tags = [`cli-v${version}`];
for (const t of tags) {
  if (out(`git tag -l "${t}"`)) die(`tag ${t} already exists locally`);
  if (out(`git ls-remote --tags origin "refs/tags/${t}"`)) die(`tag ${t} already exists on origin`);
}

// cli: no bump - the standalone binaries are built from HEAD at the tag; the version rides the tag name.

// ---- tag + push ------------------------------------------------------------
for (const t of tags) run(`git tag ${t}`);
run("git push origin main");
for (const t of tags) run(`git push origin refs/tags/${t}`); // one per push (see header)

console.log(`\nrelease.mjs: done - pushed ${tags.join(", ")}.`);
console.log("Watch the pipeline: https://github.com/storylet-studio/storylets/actions/workflows/cli.yml");
