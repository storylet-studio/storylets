// ---------------------------------------------------------------------------
// The format op, and the one migration it carries: a box map still living in
// its view shard is moved into `map.storyletmap` (design/engine-server.md 9.1
// point 5, ruled 2026-09-06).
//
// `storyletengine format` is what the compiler's warning tells an author to run,
// so it has to actually do the move - and do it without touching a byte of what
// the author owns next door.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import type { MapShard, ViewShard } from "@storylet-studio/model";
import { loadProject } from "../src/load.js";
import { runFormat } from "../src/format.js";

const exampleDir = fileURLToPath(new URL("../../../examples/saltmarsh.storylets", import.meta.url));

/** A throwaway copy of the example project. */
function scratch(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "format-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  return dir;
}

const viewFile = (dir: string): string => join(dir, "encounters", "view.storyletview");
const mapFile = (dir: string): string => join(dir, "encounters", "map.storyletmap");

/** Put a map back where a pre-split project kept it, beside a canvas so the
 *  test can watch the author's half survive the move. */
function legacyView(dir: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(viewFile(dir), canonicalStringify({
    schema: "storylets/view@0",
    map: { sites: { h_1: { x: 5, y: 6 } } },
    ...extra,
  }));
}

/** Apply what a format planned, the way the CLI does: the writes, then the
 *  deletions. */
function apply(dir: string): void {
  const result = runFormat(loadProject(dir));
  expect(result.issues).toEqual([]);
  for (const write of result.changed) writeFileSync(write.path, write.content);
  for (const path of result.removed) rmSync(path);
}

describe("format leaves a canonical project alone", () => {
  it("plans nothing for the shipped example", () => {
    const result = runFormat(loadProject(exampleDir));
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.issues).toEqual([]);
  });
});

describe("format moves a map out of a view shard", () => {
  it("writes the map shard and takes the block out of the view shard", () => {
    const dir = scratch();
    legacyView(dir, { canvases: { k_1: { cards: { c_1: { x: 1, y: 2 } } } } });

    const result = runFormat(loadProject(dir));
    expect(result.issues).toEqual([]);
    const paths = result.changed.map((w) => w.path);
    expect(paths).toContain(mapFile(dir));
    expect(paths).toContain(viewFile(dir));

    const map = parseSource(result.changed.find((w) => w.path === mapFile(dir))!.content) as MapShard;
    expect(map).toEqual({ schema: "storylets/map@0", map: { sites: { h_1: { x: 5, y: 6 } } } });

    const view = parseSource(result.changed.find((w) => w.path === viewFile(dir))!.content) as ViewShard;
    expect(view.map).toBeUndefined();
    // The author's canvases are untouched by the designer's migration.
    expect(view.canvases).toEqual({ k_1: { cards: { c_1: { x: 1, y: 2 } } } });
  });

  it("deletes a view shard that held nothing but the map", () => {
    // No husks. A file whose whole content is a schema tag is a file saying
    // nothing, and the project format's rule is that a shard exists because it
    // has something in it.
    const dir = scratch();
    legacyView(dir);
    const result = runFormat(loadProject(dir));
    expect(result.removed).toEqual([viewFile(dir)]);
    expect(result.changed.map((w) => w.path)).toEqual([mapFile(dir)]);
  });

  it("is quiet the second time, which is what makes it the migration", () => {
    const dir = scratch();
    legacyView(dir, { canvases: { k_1: { cards: { c_1: { x: 1, y: 2 } } } } });
    apply(dir);
    const again = runFormat(loadProject(dir));
    expect(again.changed).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(existsSync(mapFile(dir))).toBe(true);
  });

  it("removes the ignored copy when a box has both, and does not overwrite the winner", () => {
    const dir = scratch();
    legacyView(dir);
    writeFileSync(mapFile(dir), canonicalStringify({
      schema: "storylets/map@0", map: { sites: { h_1: { x: 99, y: 99 } } },
    }));
    const before = readFileSync(mapFile(dir), "utf8");

    const result = runFormat(loadProject(dir));
    expect(result.removed).toEqual([viewFile(dir)]);
    expect(result.changed).toEqual([]);
    expect(readFileSync(mapFile(dir), "utf8")).toBe(before);
  });
});
