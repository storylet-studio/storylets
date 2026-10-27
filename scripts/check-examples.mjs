// Verify every project under examples/ validates with nothing to say: no error,
// no warning, no stale bundle.
//
// Why this exists:
//
//   The examples are what we SHIP. The Hamlet's release zips carry its projects
//   so a player can open them in Storyletter and Patterpad, and the first thing
//   either app does is validate. The Hamlet 0.9.0 went out with a warning on
//   one (a canvas point for a card that had left its deck, there since the first
//   commit) and its Patter bundle stale against Patter's 19 October compiler,
//   so `patter validate` failed on the project we handed people. Nothing
//   noticed, because nothing validated the examples: the CLI exits 0 on a
//   warning, by design, since a warning must never block an author's export.
//
//   A sample is held to a higher bar than an author's project. A warning there
//   is the first thing a newcomer sees, so here every warning is a failure.
//
// The Patter projects are validated by the PUBLISHED Patter CLI, the latest
// release, not the sibling source checkout: a player opens them in the released
// Patterpad, and Patter's main can change its compiler's output before anyone
// releases it. A Patter release that changes the output reds this until the
// bundle is re-exported with it (`npx @patterkit/cli export examples/<name>.patter`),
// which is the moment to do it.
//
// Needs the built CLI (`npm run build`) and network access for npx.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examples = join(root, "examples");
const cli = join(root, "packages/cli/dist/cli.js");

const projects = readdirSync(examples).sort();
const failures = [];

function run(label, command, args) {
  // Both streams: the storylets CLI prints its warnings on stderr and still exits 0.
  const { status, stdout, stderr, error } = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  const out = `${stdout ?? ""}${stderr ?? ""}${error ? String(error) : ""}`;
  const noisy = out.split("\n").filter((line) => /^\s*(warning|error)\b|^\s*\[[a-z-]+\]/i.test(line));
  if (status !== 0 || noisy.length > 0) failures.push({ label, out: out.trim() });
  else console.log(`ok: ${label}`);
}

for (const name of projects.filter((p) => p.endsWith(".storylets"))) {
  run(name, process.execPath, [cli, "validate", join(examples, name)]);
}
for (const name of projects.filter((p) => p.endsWith(".patter"))) {
  run(name, "npx", ["--yes", "@patterkit/cli@latest", "validate", join(examples, name)]);
}

if (failures.length > 0) {
  for (const { label, out } of failures) console.error(`\nFAIL: ${label}\n${out}`);
  console.error(`\n${failures.length} example project(s) do not validate clean. A shipped sample may carry no warning.`);
  process.exit(1);
}
