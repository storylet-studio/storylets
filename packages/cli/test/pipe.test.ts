// ---------------------------------------------------------------------------
// The CLI as a real process with its stdout on a pipe: the one thing run()
// with a captured Io cannot see. `process.exit` ends the process at once, and
// on macOS a pipe is written asynchronously, so whatever had not drained was
// lost: `export -o -` of the Village stopped at exactly 128 KB, mid-JSON
// (CLI review, October 2026, item 2). On Linux a pipe is written
// synchronously, so CI passes either way; this test is for the platform the
// fault lives on.
//
// The entry is bundled here, from source, rather than read from dist/: the
// suite runs before the build, and a test of a stale dist proves nothing.
// Workspace packages resolve to their source, as vitest's own aliases do; the
// sibling libraries come from node_modules, as the shipped build takes them.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadProject, runExport } from "@storylet-studio/ops";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const WORKSPACE = ["model", "dialect", "compiler", "runtime", "play-helpers", "with-patter", "ops"];

let tmp: string;
let entry: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "storyletengine-pipe-"));
  entry = join(tmp, "cli.mjs");
  await build({
    entryPoints: [join(root, "packages", "cli", "src", "cli.ts")],
    outfile: entry,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    // tsup's banner, for the CommonJS dependencies that `require` node builtins.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    plugins: [{
      name: "workspace-source",
      setup(b) {
        b.onResolve({ filter: /^@storylet-studio\/[a-z-]+$/ }, (args) => {
          const name = args.path.slice("@storylet-studio/".length);
          return WORKSPACE.includes(name) ? { path: join(root, "packages", name, "src", "index.ts") } : undefined;
        });
      },
    }],
  });
}, 120_000);

afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

/** Run the bundled CLI with stdout on a pipe, and collect every byte it wrote. */
const piped = (argv: string[]): Promise<{ code: number | null; stdout: Buffer }> => new Promise((done, fail) => {
  const child = spawn(process.execPath, [entry, ...argv], { stdio: ["ignore", "pipe", "ignore"] });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => chunks.push(c));
  child.on("error", fail);
  child.on("close", (code) => done({ code, stdout: Buffer.concat(chunks) }));
});

describe("stdout on a pipe", () => {
  it("export -o - of a bundle over 128 KB arrives whole, and exactly as serialised", async () => {
    const village = join(root, "examples", "the-village.storylets");
    const expected = runExport(loadProject(village), "-").text!;
    expect(Buffer.byteLength(expected), "the fixture has to be bigger than the pipe's buffer").toBeGreaterThan(256 * 1024);
    const r = await piped(["export", village, "-o", "-"]);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBe(Buffer.byteLength(expected));
    // Raw: what the serialiser wrote, with nothing added after it.
    expect(r.stdout.toString("utf8")).toBe(expected);
    expect(() => JSON.parse(r.stdout.toString("utf8"))).not.toThrow();
  }, 60_000);

  it("--json arrives whole: links --json of the Village", async () => {
    const r = await piped(["links", join(root, "examples", "the-village.storylets"), "--json"]);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(128 * 1024);
    expect(() => JSON.parse(r.stdout.toString("utf8"))).not.toThrow();
  }, 60_000);
});
