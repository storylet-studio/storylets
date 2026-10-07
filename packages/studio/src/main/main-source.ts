// ---------------------------------------------------------------------------
// The main process's source, as text, for the tests that hold wiring which
// cannot run outside Electron by reading it (index-wiring.test.ts,
// dialog-copy.test.ts). Every module under main/, tests excluded, each with
// its path, so a check that moves to another file still finds what it holds.
// Used by tests only; nothing in the app imports it.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = fileURLToPath(new URL(".", import.meta.url));

/** Every main module's path (relative to main/) and text, in a stable order. */
export function mainFiles(): { path: string; text: string }[] {
  return readdirSync(MAIN, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts") && path !== "main-source.ts")
    .sort()
    .map((path) => ({ path, text: readFileSync(join(MAIN, path), "utf8") }));
}

/** All of it, one module after another. */
export function mainSource(): string {
  return mainFiles().map((f) => f.text).join("\n");
}
