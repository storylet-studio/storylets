// ---------------------------------------------------------------------------
// Build standalone `storyletengine` binaries: one self-contained executable
// per platform, no Node required. Bun --compile bundles src/cli.ts (every
// workspace + sibling dep inlined) and emits a native binary; Bun
// cross-compiles every target from any host, so CI builds the whole set from
// two runners (only macOS can sign macOS).
//
//   node scripts/build-standalone.mjs                 # the host's native target
//   node scripts/build-standalone.mjs --targets=linux-x64,windows-x64,...
//   STORYLETS_TARGETS=darwin-arm64,darwin-x64 node scripts/build-standalone.mjs
//
// macOS binaries are codesigned (hardened runtime + JIT entitlements, so they
// stay notarization-ready) when built ON macOS with a Developer ID identity
// in the keychain, or STORYLETS_SIGN_IDENTITY. No identity (contributors /
// keychain-less CI) - the binary is still produced, ad-hoc signed, with a
// note. We do not notarize a CLI. Windows ships unsigned by policy; Linux
// needs no signature. (Patter's build-standalone, carried whole.)
//
// The binary carries the code of about a hundred npm packages, whose licences ask to travel with it. So
// Bun compiles a generated entry that embeds the Storylet Engine's LICENSE and the notices of every
// library it contains (collected from a Bun metafile by the shared scripts/third-party-notices.mjs),
// hands their paths over, then runs src/cli.ts. The host's own binary is then run once to scaffold and
// validate a project and list the licences, so a binary that cannot do either stops the build. (Patter's
// also embeds its PDF fonts; this CLI has none.)
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collectNotices } from "../../../scripts/third-party-notices.mjs";

const pkgDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDir = join(pkgDir, "dist");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: pkgDir, stdio: "inherit" });
const probe = (cmd, args) => execFileSync(cmd, args, { cwd: pkgDir, encoding: "utf8" });

// Bun --target -> the download asset basename (Bun appends `.exe` for
// windows). Keep these stable: release assets and any download page key on
// them.
const TARGETS = {
  "darwin-arm64": "storyletengine-macos-arm64",
  "darwin-x64": "storyletengine-macos-x64",
  "linux-x64": "storyletengine-linux-x64",
  "linux-arm64": "storyletengine-linux-arm64",
  "windows-x64": "storyletengine-windows-x64",
};

const hostTarget = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
const requested = process.argv.find((a) => a.startsWith("--targets="))?.slice("--targets=".length) ?? process.env.STORYLETS_TARGETS;
const targets = (requested ? requested.split(",") : [hostTarget]).map((t) => t.trim()).filter(Boolean);

// Resolve a macOS signing identity once (only consulted for darwin targets on macOS).
let identity = process.env.STORYLETS_SIGN_IDENTITY;
if (!identity && process.platform === "darwin") {
  try {
    identity = probe("security", ["find-identity", "-v", "-p", "codesigning"])
      .match(/"(Developer ID Application: [^"]+)"/)?.[1];
  } catch {
    // `security` exits non-zero on a keychain-less runner: take the unsigned path.
  }
}

// The libraries the binary contains: bundle src/cli.ts once (not compiled) for its metafile, then collect
// every third-party package's licence files. The Storylet Engine's own packages are covered by its LICENSE.
const scratch = mkdtempSync(join(tmpdir(), "storyletengine-notices-"));
run("bun", ["build", "src/cli.ts", "--target=bun", "--outdir", join(scratch, "out"), `--metafile=${join(scratch, "meta.json")}`]);
const notices = collectNotices(join(scratch, "meta.json"), { cwd: pkgDir, exclude: ["@storylet-studio/"] });
rmSync(scratch, { recursive: true, force: true });
const noticesFile = join(distDir, "third-party-notices.txt");
const entry = join(distDir, "standalone-entry.mjs");
mkdirSync(distDir, { recursive: true });
writeFileSync(noticesFile, notices.text);
console.log(`notices: ${notices.packages.length} libraries`);
writeFileSync(entry, [
  `import { useEmbeddedNotices } from "../src/notices.ts";`,
  `import licence from "../LICENSE" with { type: "file" };`,
  `import libraries from "./third-party-notices.txt" with { type: "file" };`,
  `useEmbeddedNotices({ licence, libraries });`,
  `await import("../src/cli.ts");`,
  "",
].join("\n"));

// Run a freshly built binary as a user would, from somewhere else: scaffold a project, validate it, and
// list the licences.
function smoke(out) {
  const dir = mkdtempSync(join(tmpdir(), "storyletengine-standalone-"));
  try {
    execFileSync(out, ["init", "smoke.storylets", "--name", "Smoke"], { cwd: dir, stdio: "pipe" });
    execFileSync(out, ["validate", "smoke.storylets"], { cwd: dir, stdio: "pipe" });
    const listed = execFileSync(out, ["licences"], { cwd: dir, encoding: "utf8" });
    if ((listed.match(/^=== /gm) ?? []).length !== notices.packages.length || !/^MIT License/m.test(listed)) {
      throw new Error("licences missing");
    }
    console.log(`smoke: ${out} scaffolded and validated a project and listed its licence and ${notices.packages.length} library notices`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const target of targets) {
  const base = TARGETS[target];
  if (!base) {
    console.error(`unknown target '${target}': expected one of: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(2);
  }
  const outBase = join(distDir, base);
  run("bun", ["build", entry, "--compile", `--target=bun-${target}`, "--outfile", outBase]);
  const out = target.startsWith("windows") ? `${outBase}.exe` : outBase;
  if (target === hostTarget) smoke(out);

  if (!target.startsWith("darwin")) continue; // only macOS binaries are signed
  if (process.platform !== "darwin") {
    console.log(`(${base}: cross-built off macOS, cannot codesign here; left ad-hoc)`);
    continue;
  }
  if (!identity) {
    console.log(`(${base}: no Developer ID identity in the keychain, left ad-hoc signed)`);
    continue;
  }
  run("codesign", [
    "--force", "--timestamp", "--options", "runtime",
    "--entitlements", join(pkgDir, "entitlements.plist"),
    "--sign", identity, out,
  ]);
  run("codesign", ["--verify", "--strict", "--verbose=2", out]);
  console.log(`signed: ${base} (${identity})`);
}

rmSync(entry); // dist/ is what a release uploads from: never leave the generated files in it
rmSync(noticesFile);
