// ---------------------------------------------------------------------------
// The geometry opt-in: what a bundle carries, and only when it was asked.
//
// The default is the thing worth pinning hardest. Geometry is authoring data and
// the runtime deals in tag names, so a bundle that grew a map by accident would
// be a silent regression in every shipping build - which is why the first test
// here is that turning the flag off leaves the bundle byte-for-byte unchanged.
//
// The map is the PROJECT's (design/project-map-contract.md): its group is in the
// root `map.storyletmap`, its pictures in the root `assets/`, and a box joins it
// with `usesMap`. The zone group itself always ships (`bundle.map.group`), since
// the runtime deals from it; what the flag adds is `bundle.map.geometry`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource, serialiseBundle } from "@storylet-studio/compiler";
import type { Bundle } from "@storylet-studio/model";
import { runExport } from "../src/export.js";
import { loadProject } from "../src/load.js";

const exampleDir = fileURLToPath(new URL("../../../examples/saltmarsh.storylets", import.meta.url));

/** A 1x1 PNG. Real bytes, so a copy that mangled them would show. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000a49444154789c6300010000050001" +
  "0d0a2db40000000049454e44ae426082", "hex");

function scratch(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "export-")), "copy.storylets");
  cpSync(exampleDir, dir, { recursive: true });
  return dir;
}

type Group = { id: string; gameId?: string; tags: { id: string; gameId?: string; templates?: Record<string, unknown> }[]; templates?: Record<string, unknown> };

/** Make the box's first tag group the PROJECT map, and put the box on it, with
 *  nothing drawn yet: the shape a project has before anybody traces a zone. */
function liftMap(dir: string): void {
  const tags = join(dir, "encounters", "tags.storylettags");
  const shard = parseSource(readFileSync(tags, "utf8")) as { groups: Group[] };
  const group = shard.groups.shift()!;
  group.templates = { ...group.templates, spatial: { map: true } };
  writeFileSync(tags, canonicalStringify(shard));
  writeFileSync(join(dir, "map.storyletmap"), canonicalStringify({ schema: "storylets/projectmap@0", group }));

  const boxFile = join(dir, "encounters", "box.storyletbox");
  const box = parseSource(readFileSync(boxFile, "utf8")) as { box: Record<string, unknown> };
  box.box["usesMap"] = true;
  writeFileSync(boxFile, canonicalStringify(box));
}

/** Draw the project map: two zones and a picture. */
function drawMap(dir: string, opts: { hiddenPicture?: boolean } = {}): void {
  liftMap(dir);
  const file = join(dir, "map.storyletmap");
  const shard = parseSource(readFileSync(file, "utf8")) as { group: Group };
  const group = shard.group;
  group.templates = {
    ...group.templates,
    spatial: {
      map: true,
      backgrounds: [
        { id: "g_1", file: "site-plan.png", x: 10, y: 20, width: 300, height: 200, opacity: 0.6 },
        ...(opts.hiddenPicture === true
          ? [{ id: "g_2", file: "put-away.png", x: 0, y: 0, width: 10, height: 10, hidden: true }]
          : []),
      ],
    },
  };
  // The first tag gets a shape; the second deliberately does not, so "a tag
  // that is not a place yet" has a case.
  group.tags[0]!.templates = {
    spatial: { polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
  };
  writeFileSync(file, canonicalStringify(shard));
}

function askForMaps(dir: string): void {
  const projFile = join(dir, readdirSync(dir).find((f) => f.endsWith(".storyletproj"))!);
  const text = readFileSync(projFile, "utf8");
  writeFileSync(projFile, text.replace(/export: \{/, "export: {\n    map: true,"));
}

/** Put the box's one hand on the map, in the box's map shard where a drag
 *  records it. `docks-street` is `h_docks` in the example. */
function placeHand(dir: string, sites: Record<string, { x: number; y: number }> = { h_docks: { x: 12, y: 34 } }): void {
  writeFileSync(join(dir, "encounters", "map.storyletmap"),
    canonicalStringify({ schema: "storylets/map@0", map: { sites } }));
}

function withPicture(dir: string, name = "site-plan.png"): void {
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", name), PNG);
}

/** What the flag adds: the map's geometry, or undefined when none shipped. */
const geometryOf = (bundle: Bundle | undefined) => bundle?.map?.geometry;

describe("a bundle that was not asked for a map", () => {
  it("carries none, and is unchanged by geometry existing", () => {
    // Both on the project map; only one of them DRAWN. The zone group ships in
    // both, because the runtime deals from it; what must not ship is the drawing.
    const plain = scratch();
    liftMap(plain);
    const drawn = scratch();
    drawMap(drawn);
    withPicture(drawn);

    const before = runExport(loadProject(plain), "-");
    const after = runExport(loadProject(drawn), "-");

    expect(after.bundle!.map?.group.gameId).toBe("area");
    expect(geometryOf(after.bundle)).toBeUndefined();
    // Not just "no geometry key": the whole payload is the same. Drawing a map
    // must not perturb a shipping build in any way.
    //
    // Except the content HASH, which is right to differ and is asserted so
    // separately rather than waved away: the hash covers the source shards, the
    // geometry lives in one, so drawing a zone does make a built bundle stale.
    // Conservative in the correct direction - with the flag ON that bundle
    // really is out of date, and the alternative is a hash that lies once
    // somebody ticks the box.
    expect(after.bundle!.content.hash).not.toBe(before.bundle!.content.hash);
    const ignoringHash = (bundle: typeof before.bundle): string =>
      serialiseBundle({ ...bundle!, content: { ...bundle!.content, hash: "" } });
    expect(ignoringHash(after.bundle)).toBe(ignoringHash(before.bundle));
  });

  it("writes no pictures", () => {
    const dir = scratch();
    drawMap(dir);
    withPicture(dir);
    expect(runExport(loadProject(dir)).assets).toEqual([]);
  });
});

describe("a bundle that was", () => {
  it("carries the geometry by gameId, with no internal ids", () => {
    const dir = scratch();
    drawMap(dir);
    withPicture(dir);
    askForMaps(dir);

    const bundle = runExport(loadProject(dir), "-").bundle!;
    expect(bundle.boxes.find((b) => b.gameId === "encounters")!.usesMap).toBe(true);
    const map = geometryOf(bundle)!;
    // One zone, not two: the tag with no polygon is not a place yet.
    expect(map.zones).toHaveLength(1);
    expect(map.zones[0]!.tag).toBe("docks");
    expect(map.zones[0]!.polygon).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(JSON.stringify(map)).not.toContain("d_");    // no group/tag ids
    expect(JSON.stringify(map)).not.toContain("v_");
  });

  it("names its pictures relative to the bundle and copies them there", () => {
    const dir = scratch();
    drawMap(dir);
    withPicture(dir);
    askForMaps(dir);

    const result = runExport(loadProject(dir));
    const background = geometryOf(result.bundle)!.backgrounds![0]!;
    expect(background.file).toBe("assets/site-plan.png");
    expect(background).toMatchObject({ x: 10, y: 20, width: 300, height: 200, opacity: 0.6 });

    expect(result.assets).toHaveLength(1);
    // Beside the bundle, at exactly the path the bundle names.
    expect(result.assets[0]!.path).toBe(join(dir, "..", "storylet-dist", "assets", "site-plan.png"));   // beside the bundle, beside the project
    expect(Buffer.from(result.assets[0]!.bytes)).toEqual(PNG);
  });

  it("leaves authoring state at home", () => {
    const dir = scratch();
    drawMap(dir, { hiddenPicture: true });
    withPicture(dir);
    withPicture(dir, "put-away.png");
    askForMaps(dir);

    const result = runExport(loadProject(dir));
    // A hidden picture is one the author put away: not shipped, not copied.
    expect(geometryOf(result.bundle)!.backgrounds).toHaveLength(1);
    expect(result.assets).toHaveLength(1);
    // And no lock/hide/stacking survives into the bundle.
    const text = JSON.stringify(geometryOf(result.bundle));
    for (const key of ["locked", "hidden", "\"z\"", "\"id\""]) expect(text).not.toContain(key);
  });

  it("ships the placement of a picture whose file has gone missing, but copies nothing", () => {
    const dir = scratch();
    drawMap(dir);            // references site-plan.png
    askForMaps(dir);         // ...which was never put on disk
    const result = runExport(loadProject(dir));
    expect(geometryOf(result.bundle)!.backgrounds).toHaveLength(1);
    expect(result.assets).toEqual([]);
  });

  it("carries where the hands stand, by gameId (design/engine-server.md 4.3)", () => {
    const dir = scratch();
    drawMap(dir);
    withPicture(dir);
    placeHand(dir);
    askForMaps(dir);

    const map = geometryOf(runExport(loadProject(dir), "-").bundle)!;
    // Keyed by the box's gameId: one map, so each box's hands under its own name.
    expect(map.sites).toEqual({ encounters: [{ hand: "docks-street", x: 12, y: 34 }] });
    // The site's ZONE is not repeated here: the hand's own binding is what the
    // runtime deals from, and a second copy could only go on to disagree.
    expect(JSON.stringify(map.sites)).not.toContain("v_docks");
  });

  it("carries no sites key when nobody has been placed", () => {
    const dir = scratch();
    drawMap(dir);
    withPicture(dir);
    askForMaps(dir);
    expect(geometryOf(runExport(loadProject(dir), "-").bundle)!.sites).toBeUndefined();
  });

  it("says nothing at all when the map was never drawn", () => {
    const dir = scratch();
    askForMaps(dir);
    expect(runExport(loadProject(dir), "-").bundle!.map).toBeUndefined();
  });
});

describe("the per-export override", () => {
  it("adds a map to a project that does not normally ship one", () => {
    const dir = scratch();
    drawMap(dir);
    withPicture(dir);
    expect(geometryOf(runExport(loadProject(dir), "-", { map: true }).bundle)?.zones).toHaveLength(1);
  });

  it("takes one away from a project that does", () => {
    const dir = scratch();
    drawMap(dir);
    withPicture(dir);
    askForMaps(dir);
    const result = runExport(loadProject(dir), undefined, { map: false });
    expect(geometryOf(result.bundle)).toBeUndefined();
    expect(result.assets).toEqual([]);
  });
});

describe("stdout", () => {
  it("writes no pictures, since there is nowhere to put them", () => {
    const dir = scratch();
    drawMap(dir);
    withPicture(dir);
    askForMaps(dir);
    const result = runExport(loadProject(dir), "-");
    expect(result.assets).toEqual([]);
    expect(result.write).toBeUndefined();
    expect(existsSync(join(dir, "..", "storylet-dist"))).toBe(false);   // stdout: nothing lands beside the project either
  });
});
