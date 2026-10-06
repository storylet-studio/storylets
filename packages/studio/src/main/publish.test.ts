// Publish Bundle and Live Link against a project that did not wholly load, and
// the plan each commits (the CLI review, October 2026: ruling M and item 14).
//
// The loader drops a shard it cannot read and carries on, so one unparseable
// deck used to publish a bundle without its cards, and Live Link pushed the
// same gutted build into a running game. Both refuse now, saying which shard.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { compileForLivePush, exportBundle, openProject, refusal } from "./project.js";
import type { ProjectSession } from "./project.js";
import { spreadsheetExport } from "./spreadsheet.js";

const exampleDir = fileURLToPath(new URL("../../../../examples/saltmarsh.storylets", import.meta.url));
const villageDir = fileURLToPath(new URL("../../../../examples/the-village.storylets", import.meta.url));

/** A copy of the example, opened, with the bundle published into the scratch folder. */
function scratch(): { root: string; dir: string; bundle: string; session: ProjectSession } {
  const root = mkdtempSync(join(tmpdir(), "studio-publish-"));
  const dir = join(root, "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  const proj = join(dir, "saltmarsh.storyletproj");
  const shard = parseSource(readFileSync(proj, "utf8")) as { export?: Record<string, unknown> };
  shard.export = { ...shard.export, bundle: "../out/copy.storyletsc" };
  writeFileSync(proj, canonicalStringify(shard));
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return { root, dir, bundle: join(root, "out", "copy.storyletsc"), session: opened.session };
}

/** One deck that no longer parses: the project still loads, without it. */
const breakDeck = (dir: string): void => writeFileSync(join(dir, "encounters", "decks", "market.storyletdeck"), "{ not json");

describe("a project with a load error", () => {
  it("Publish Bundle refuses, naming the shard, and writes nothing", () => {
    const { dir, bundle, session } = scratch();
    breakDeck(dir);
    const r = exportBundle(session);
    expect("error" in r && r.error).toMatch(/^encounters\/decks\/market\.storyletdeck: unparseable JSON5/);
    expect(existsSync(bundle)).toBe(false);
  });

  it("Live Link pushes nothing, and says why", () => {
    const { dir, session } = scratch();
    expect("json" in compileForLivePush(session)).toBe(true);   // the healthy project pushes
    breakDeck(dir);
    const r = compileForLivePush(session);
    expect("json" in r).toBe(false);
    expect("error" in r && r.error).toContain("encounters/decks/market.storyletdeck: unparseable JSON5");
  });
});

describe("Publish Bundle commits the export's plan", () => {
  it("creates the bundle's folder, and lands the map pictures beside it", () => {
    // The Village, asked to ship its map: five pictures and the bundle that names them.
    const root = mkdtempSync(join(tmpdir(), "studio-publish-map-"));
    const dir = join(root, "the-village.storylets");
    cpSync(villageDir, dir, { recursive: true });
    const proj = join(dir, "the-village.storyletproj");
    const shard = parseSource(readFileSync(proj, "utf8")) as { export: Record<string, unknown> };
    shard.export = { ...shard.export, bundle: "../out/village.storyletsc", map: true };
    writeFileSync(proj, canonicalStringify(shard));
    const opened = openProject(dir);
    if ("error" in opened) throw new Error(opened.error);
    const r = exportBundle(opened.session);
    if ("error" in r) throw new Error(r.error);
    expect(r.path).toBe(join(root, "out", "village.storyletsc"));
    expect(existsSync(r.path)).toBe(true);
    expect(readdirSync(join(root, "out", "assets")).sort()).toEqual(readdirSync(join(dir, "assets")).sort());
  });
});

describe("refusal", () => {
  it("says the errors with their shards, else every issue, else the fallback", () => {
    expect(refusal([
      { severity: "warning", path: "a", message: "w" },
      { severity: "error", path: "b", where: "c", message: "e1" },
      { severity: "error", path: "d", message: "e2" },
    ], "fallback")).toBe("b [c]: e1; d: e2");
    expect(refusal([{ severity: "warning", path: "a", message: "w" }], "fallback")).toBe("a: w");
    expect(refusal([], "fallback")).toBe("fallback");
  });

  it("is what the spreadsheet says for a folder with no project", async () => {
    const { session } = scratch();
    session.loaded = { ...session.loaded, dir: mkdtempSync(join(tmpdir(), "studio-none-")) };
    const r = await spreadsheetExport(session);
    expect("error" in r && r.error).toContain("no .storylets project");
  });
});
