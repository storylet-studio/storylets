// Bump one of the tag-released apps to a new version.
//
//   npm run bump:app -- 0.4.0     # Storyletter (the desktop app)
//   npm run bump:cli -- 0.3.0     # the standalone `storyletengine` CLI
//
// Each has its own tag-driven pipeline, separate from the runtimes' lockstep
// `bump:play`: Storyletter ships on a bare `v*` tag (bare v* is Storyletter's
// alone, because electron-builder and electron-updater can only target plain
// semver tags), the CLI on `cli-v*`. Both pipelines REFUSE a tag whose version
// disagrees with the manifest, and both refuse one with no dated changelog
// section, so this script is the one route to a release.
//
// One script with a table rather than two near-identical files: the pair
// differ only in which manifest and changelog they touch and what they print,
// and a second copy is how the two would drift.
//
// It:
//   1. writes the version into the app's package.json
//   2. stamps today's date into its CHANGELOG.md: an existing
//        "## [<version>] - Unreleased" heading is dated in place; otherwise the
//        "## [Unreleased]" section (which must have content) becomes
//        "## [<version>] - <date>" and a fresh empty "## [Unreleased]" goes above it
//   3. prints the tag command that triggers the pipeline
//
// Modelled on Patterplay's scripts/bump-patterpad-version.mjs. The two families
// solved this once; the second should not solve it again differently.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TARGETS = {
  app: {
    label: "Storyletter",
    dir: "packages/studio",
    tag: (v) => `v${v}`,
    note: "builds + signs mac/win/linux, publishes the installers\n"
        + "                                         # + the electron-updater feeds to the GitHub Release",
  },
  cli: {
    label: "CLI",
    dir: "packages/cli",
    tag: (v) => `cli-v${v}`,
    note: "builds the standalone executables (mac signed,\n"
        + "                                         # linux + windows cross-compiled) as release assets",
  },
};

const which = process.argv[2];
const version = process.argv[3];
const target = TARGETS[which ?? ""];
if (!target || !version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`usage: npm run bump:<${Object.keys(TARGETS).join(" | ")}> -- <semver>   e.g. npm run bump:app -- 0.4.0`);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date().toISOString().slice(0, 10);
const pending = []; // computed first, written only when EVERY file transformed cleanly

function edit(rel, fn) {
  const path = resolve(root, rel);
  const before = readFileSync(path, "utf8");
  const after = fn(before, rel);
  if (after !== before) pending.push({ path, rel, after });
}

// --- 1. the manifest ---------------------------------------------------------

// Line-targeted replace (not a JSON rewrite) to keep the file's formatting.
edit(`${target.dir}/package.json`, (s, rel) => {
  if (!/^  "version": "[^"]+",$/m.test(s)) throw new Error(`${rel}: no version line found`);
  return s.replace(/^  "version": "[^"]+",$/m, `  "version": "${version}",`);
});

// --- 2. the changelog --------------------------------------------------------

edit(`${target.dir}/CHANGELOG.md`, (s, rel) => {
  if (s.includes(`## [${version}] - Unreleased`)) {
    // The pending section already carries this version: just date it.
    return s.replace(`## [${version}] - Unreleased`, `## [${version}] - ${today}`);
  }
  if (new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}`, "m").test(s)) {
    throw new Error(`${rel}: ${version} is already released`);
  }
  const m = s.match(/^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[|\s*$(?![\s\S]))/m);
  if (!m) throw new Error(`${rel}: no "## [Unreleased]" section to promote`);
  if (!m[1].trim()) {
    throw new Error(`${rel}: the Unreleased section is empty - write the changelog first`);
  }
  return s.replace(/^## \[Unreleased\]/m, `## [Unreleased]\n\n## [${version}] - ${today}`);
});

// --- 3. write + report (all-or-nothing: nothing was written before this point) ---

console.log(`${target.label} -> ${version}\n`);
for (const { path, rel, after } of pending) {
  writeFileSync(path, after);
  console.log(`  updated ${rel}`);
}

// ONE tag, pushed BY NAME. Never `git push --tags`: that pushes every local tag
// GitHub has not seen, and GitHub creates no workflow run at all for tags pushed
// together beyond the first few. Patterplay lost a whole release to it on
// 2026-09-01 - four correct tags on the remote, no pipelines, and a tag ruleset
// forbidding the delete that would let them be pushed again.
console.log(`
Next steps (review the diffs first):
  git add ${target.dir}/package.json ${target.dir}/CHANGELOG.md
  git commit -m "${target.label} ${version}"
  git push
  git tag ${target.tag(version)} && git push origin ${target.tag(version)}
                                         # the tag triggers the pipeline
                                         # (${target.note})
`);
