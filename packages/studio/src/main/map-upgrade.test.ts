// The in-app upgrade from before the project map (map-upgrade.ts): the Village
// pushed back to the shape it had before, then upgraded through the same path
// the prompt and the problems bar's "Upgrade the project…" take. One undo step
// puts every shard back; a refusal writes nothing.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@storylet-studio/compiler";
import { backgroundsOf } from "@storylet-studio/model";
import type { TagGroup } from "@storylet-studio/model";
import { openProject } from "./project.js";
import { redo, undo } from "./mutate.js";
import { planMapUpgrade, upgradeProjectMap } from "./map-upgrade.js";

const example = fileURLToPath(new URL("../../../../examples/the-village.storylets", import.meta.url));
const read = (path: string): Record<string, unknown> => parseSource(readFileSync(path, "utf8")) as Record<string, unknown>;
const write = (path: string, value: unknown): void => writeFileSync(path, canonicalStringify(value));

/** The shards of a project, path -> text: what "every shard back" compares. */
function shards(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) { if (name !== "assets") walk(path); } else if (/\.storylet\w+$/.test(name)) out.set(path, readFileSync(path, "utf8"));
    }
  };
  walk(dir);
  return out;
}

/** The Village as it was before the project map: its map a group in its one box. */
function oldVillage(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "map-upgrade-")), "the-village.storylets");
  cpSync(example, dir, { recursive: true });
  const map = read(join(dir, "map.storyletmap")) as { group: TagGroup };
  const tagsPath = join(dir, "village", "tags.storylettags");
  const tags = read(tagsPath) as { groups: unknown[] };
  write(tagsPath, { ...tags, groups: [map.group, ...tags.groups] });
  const boxPath = join(dir, "village", "box.storyletbox");
  const box = read(boxPath) as { box: Record<string, unknown> };
  delete box.box["usesMap"];
  write(boxPath, box);
  mkdirSync(join(dir, "village", "assets"), { recursive: true });
  for (const bg of backgroundsOf(map.group)) renameSync(join(dir, "assets", bg.file), join(dir, "village", "assets", bg.file));
  rmSync(join(dir, "map.storyletmap"));
  // As it was: no assets folder at the root at all, which the upgrade has to make.
  if (readdirSync(join(dir, "assets")).length === 0) rmSync(join(dir, "assets"), { recursive: true });
  return dir;
}

const open = (dir: string) => {
  const opened = openProject(dir);
  if ("error" in opened) throw new Error(opened.error);
  return opened;
};

describe("upgrading a project from before the project map, in the app", () => {
  it("says what it will do, then does it in one undo step", () => {
    const dir = oldVillage();
    const { session, problems } = open(dir);
    expect(problems.find((p) => p.severity === "error")?.fix).toEqual({ kind: "upgrade-project" });

    const plan = planMapUpgrade(session)!;
    expect(plan.refusals).toEqual([]);
    expect(plan.report[0]).toBe('the map of "village" is the project map ("zone", 5 zones)');
    expect(plan.report).toContain("picture moved to assets/village.jpg");

    const before = shards(dir);
    const result = upgradeProjectMap(session);
    if (!("project" in result)) throw new Error(JSON.stringify(result));
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(result.project.map).toBeDefined();
    expect(existsSync(join(dir, "map.storyletmap"))).toBe(true);
    expect(existsSync(join(dir, "assets", "village.jpg"))).toBe(true);
    // Copied, not moved: the old map still finds its pictures after an undo.
    expect(existsSync(join(dir, "village", "assets", "village.jpg"))).toBe(true);
    expect(planMapUpgrade(session)).toBeUndefined();

    const undone = undo(session)!;
    expect(shards(dir)).toEqual(before);
    expect(undone.problems.find((p) => p.severity === "error")?.fix).toEqual({ kind: "upgrade-project" });
    expect(undo(session)).toBeNull();

    const redone = redo(session)!;
    expect(redone.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(existsSync(join(dir, "map.storyletmap"))).toBe(true);
  });

  it("refuses with the planner's sentence and writes nothing", () => {
    const dir = oldVillage();
    const tagsPath = join(dir, "village", "tags.storylettags");
    const tags = read(tagsPath) as { groups: unknown[] };
    write(tagsPath, { ...tags, groups: [...tags.groups, { id: "d_x_area", gameId: "area", tags: [{ id: "v_x_forest", gameId: "forest" }] }] });
    const { session } = open(dir);
    const before = shards(dir);
    const refusal = 'box "village" has a tag "forest" in its group "area", and "forest" is a zone of the map, whose name will mean one thing across the project;'
      + ' rename the tag in "village", then run format again';
    expect(planMapUpgrade(session)!.refusals).toEqual([refusal]);
    expect(upgradeProjectMap(session)).toEqual({ refused: [refusal] });
    expect(shards(dir)).toEqual(before);
    expect(existsSync(join(dir, "assets"))).toBe(false);
    expect(undo(session)).toBeNull();
  });

  it("asks nothing of a project already on the project map", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "map-upgrade-")), "the-village.storylets");
    cpSync(example, dir, { recursive: true });
    expect(planMapUpgrade(open(dir).session)).toBeUndefined();
  });
});
