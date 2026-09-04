// Build the playable Hamlet client and place it in the site, at /hamlet/.
//
// The Village's prebuild, cloned. Same rule: FAIL rather than skip, or the site ships a
// /hamlet/ link that 404s and a visitor finds out first.
//
// Two deliveries from one build (hamlet-client.md section 7): the same `dist/`
// is what the release zip carries and what this site serves. Playing it is then
// a link, which is how most people will first meet it.
//
// This runs as the site's `prebuild`, so `npm run build` in website/ produces a
// complete site with the client in it, locally and in CI alike.
//
// It FAILS rather than skipping when it cannot do its job. A prebuild that
// quietly no-ops produces a site whose /hamlet/ link 404s, and the first person
// to find out is a visitor - the same shape of bug as the Windows icon
// generator that skipped on the wrong machine and failed a release minutes later
// somewhere else.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = dirname(WEBSITE);
// THE GATE. The Hamlet's words are being written; until hamlet-v0.1.0 ships, the
// site builds no /hamlet/ route. This is a deliberate, dated switch, printed
// loudly on every build, not the quiet no-op the rule above forbids: flip it to
// true in the same commit as the release. The download page's play button is
// gated on its own, by the release existing.
const HAMLET_RELEASED = true;
if (!HAMLET_RELEASED) {
  console.log("build-hamlet: GATED (HAMLET_RELEASED = false): no /hamlet/ route until hamlet-v0.1.0 ships.");
  process.exit(0);
}

const CLIENT = join(REPO, "packages", "hamlet-client");
const OUT = join(WEBSITE, "public", "hamlet");

if (!existsSync(join(CLIENT, "package.json"))) {
  console.error(
    "build-hamlet: cannot find packages/hamlet-client.\n" +
      "  The site serves the playable Hamlet at /hamlet/, built from the monorepo.\n" +
      "  This needs the whole repo checked out and `npm ci` run at its root, not just website/.",
  );
  process.exit(1);
}

console.log("build-hamlet: building the client…");
execFileSync("npm", ["run", "build", "-w", "@storylet-studio/hamlet-client"], {
  cwd: REPO,
  stdio: "inherit",
});

const dist = join(CLIENT, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error(`build-hamlet: the client build produced no index.html in ${dist}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(dist, OUT, { recursive: true });
console.log(`build-hamlet: the Hamlet is at /hamlet/ (from ${dist})`);
