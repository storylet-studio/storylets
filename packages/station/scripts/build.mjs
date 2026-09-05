// Build the five reference stations: one folder per station kind, each a page,
// a script and a `station.json` a venue edits.
//
// esbuild, and the tsconfig at the repo root, which is what makes an API change
// in the client or the kit break THIS build rather than a venue's download.
// (The Village client's own arrangement, and its reason, verbatim.)
//
// Output is dist/<kind>/{index.html, app.js, station.json}. Nothing in dist/ is
// committed. Each folder is self-contained: copy it onto a device, edit one
// file, and that device is provisioned.

import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const root = resolve(pkg, "../..");
const out = join(pkg, "dist");

/** The five apps. `kind` is what `station.json` must say, and the build stamps
 *  it into the example config so a copied folder starts consistent. */
// `fields` is the card face a venue edits: `body` is the field holding the
// story, `show` the others, in order. The author-facing switches are not here
// and cannot be: the card's purpose and the outcomes' purposes are the KIND's,
// and only a crew handset shows them (design/engine-server.md 5.7).
const APPS = [
  { dir: "kiosk", entry: "kiosk", kind: "fixed", title: "The table", extra: { idleMinutes: 4, installation: "the-caretaker", fields: { body: "text" } } },
  { dir: "crew", entry: "crew", kind: "crew", title: "The Caretaker", extra: { fields: { body: "", show: [{ field: "prompt" }, { field: "cue", label: "Cue" }] } } },
  { dir: "companion", entry: "companion", kind: "companion", title: "This Room", extra: { stationKey: undefined, fields: { body: "text" } } },
  { dir: "sign-in", entry: "sign-in", kind: "sign-in", title: "Sign in", extra: { installation: "the-caretaker" } },
  { dir: "house", entry: "house", kind: "house", title: "The house", extra: { fields: { body: "text", show: [{ field: "cue", label: "Cue" }] } } },
];

const page = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
</head>
<body>
  <!-- Everything is drawn by the script: the kit's stylesheet and the app's
       own are injected at boot, so this page is a shell and a venue that
       restyles it never has to edit two files that must agree. -->
  <div id="app"></div>
  <script src="app.js"></script>
</body>
</html>
`;

rmSync(out, { recursive: true, force: true });

let bytes = 0;
for (const app of APPS) {
  const dir = join(out, app.dir);
  mkdirSync(dir, { recursive: true });

  const result = await build({
    entryPoints: [join(pkg, `src/entries/${app.entry}.ts`)],
    outfile: join(dir, "app.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    sourcemap: true,
    tsconfig: join(root, "tsconfig.json"),
    logLevel: "silent",
  });
  if (result.errors.length) {
    console.error(`station build: ${result.errors.map((e) => e.text).join("\n")}`);
    process.exit(1);
  }
  bytes += readFileSync(join(dir, "app.js"), "utf8").length;

  writeFileSync(join(dir, "index.html"), page(app.title));
  // The example config. A venue edits this one file and the device is
  // provisioned: no build step, no environment variables, no rebuild to move a
  // kiosk from the rehearsal server to the show server.
  const config = {
    kind: app.kind,
    title: app.title,
    base: "http://venue.local:4470",
    venue: "this-room",
    stationKey: "paste-the-key-the-console-showed-you",
    ...app.extra,
  };
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) delete config[key];
  }
  writeFileSync(join(dir, "station.json"), `${JSON.stringify(config, null, 2)}\n`);
}

console.log(`station: ${APPS.length} apps, ${Math.round(bytes / 1024)} kB of script -> ${out}`);
