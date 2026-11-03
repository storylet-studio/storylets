// Verify the four Storylet Engine runtimes share ONE version (the lockstep invariant).
//
// `bump:play` moves all four together, but a hand edit, a half-run bump or a Changesets cascade on the JS
// runtime can move one alone, and a game team then finds out on a version mismatch. This guard catches the
// divergence first. Run in CI (`npm run lockstep`) and by `npm test` (scripts/runtime-lockstep.test.ts).
//
// It also holds each runtime's version constant (STORYLET_ENGINE_VERSION and its ports' spellings) to the
// manifests: game code reads that constant to check the Storylet Engine it's running on, so it must never say
// another version. (Patter's check-runtime-lockstep.mjs, carried across.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { lockstepVersions } from "./lib/storylet-engine-version-constants.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versions = lockstepVersions((rel) => readFileSync(resolve(root, rel), "utf8"));

const distinct = [...new Set(Object.values(versions))];
if (distinct.length !== 1 || !distinct[0]) {
  console.error("The four Storylet Engine runtimes are OUT OF LOCKSTEP:\n");
  for (const [file, v] of Object.entries(versions)) console.error(`  ${v ?? "(unreadable)"}\t${file}`);
  console.error("\nAll four, and their version constants, must carry one version. Realign them with `npm run bump:play -- <version>`.");
  process.exit(1);
}
console.log(`Storylet Engine runtimes in lockstep at ${distinct[0]}`);
