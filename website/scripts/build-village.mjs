// Build the playable Village client and place it in the site, at /village/.
//
// Two deliveries from one build (village-client.md section 7): the same `dist/`
// is what the release zip carries and what this site serves. Playing it is then
// a link, which is how most people will first meet it.
//
// This runs as the site's `prebuild`, so `npm run build` in website/ produces a
// complete site with the client in it, locally and in CI alike.
//
// It FAILS rather than skipping when it cannot do its job. A prebuild that
// quietly no-ops produces a site whose /village/ link 404s, and the first person
// to find out is a visitor - the same shape of bug as the Windows icon
// generator that skipped on the wrong machine and failed a release minutes later
// somewhere else.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = dirname(WEBSITE);
const CLIENT = join(REPO, "packages", "village-client");
const OUT = join(WEBSITE, "public", "village");

if (!existsSync(join(CLIENT, "package.json"))) {
  console.error(
    "build-village: cannot find packages/village-client.\n" +
      "  The site serves the playable Village at /village/, built from the monorepo.\n" +
      "  This needs the whole repo checked out and `npm ci` run at its root, not just website/.",
  );
  process.exit(1);
}

console.log("build-village: building the client…");
execFileSync("npm", ["run", "build", "-w", "@storylet-studio/village-client"], {
  cwd: REPO,
  stdio: "inherit",
});

const dist = join(CLIENT, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error(`build-village: the client build produced no index.html in ${dist}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(dist, OUT, { recursive: true });
console.log(`build-village: the Village is at /village/ (from ${dist})`);
