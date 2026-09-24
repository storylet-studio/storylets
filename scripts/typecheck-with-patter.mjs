#!/usr/bin/env node
// Typecheck the combined Patter + Storylet Engine proof (packages/runtime/test/with-patter)
// when a sibling ../patter checkout exists, and say plainly that it was skipped when not.
// The root tsconfig leaves that folder out because it imports Patter's source, which a plain
// clone of this repo does not have; vitest runs it under the same condition.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packages = ["model", "core", "dialect", "compiler", "runtime"];
const present = packages.every((p) => existsSync(new URL(`../../patter/packages/${p}/src/index.ts`, import.meta.url)));
if (!present) {
  console.log("typecheck-with-patter: no ../patter checkout, so the combined Patter proof is skipped.");
  process.exit(0);
}
const r = spawnSync("npx", ["tsc", "--noEmit", "-p", "packages/runtime/test/with-patter/tsconfig.json"], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
