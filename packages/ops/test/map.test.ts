// ---------------------------------------------------------------------------
// The box map: the DESIGNER's half of what used to be one arrangement shard
// (design/engine-server.md 9.1 point 5, ruled 2026-09-06).
//
// What the split promises, and what is pinned here:
//
//   - a site lands in `map.storyletmap`, never in the view shard again
//   - a map left in the view shard by a project from before the split is not
//     read since 1.0.0
//   - everything the old sidecar promised a site still holds: sparse, whole
//     numbers, position and nothing else, no husks, and quiet when nothing moved
//   - the bundle does not change, because the block it compiles from did not
//   - the map's furniture is the PROJECT map's (design/project-map-contract.md
//     1.1): one map, so one set of frames, in the root `map.storyletmap`
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { parseSource } from "@storylet-studio/compiler";
import type { SourceBox, SourceProject } from "@storylet-studio/compiler";
import { MAP_SCHEMA, PROJECTMAP_SCHEMA, VIEW_SCHEMA } from "@storylet-studio/model";
import type { MapShard, ProjectMapShard, TagGroup, ViewPoint, ViewShard } from "@storylet-studio/model";
import type { PlannedWrite } from "../src/write.js";
import { canvasFurniture, planCanvasFurniture } from "../src/view.js";
import {
  mapPath, mapSites, planForgetSites, planMapSites, projectMapPath,
} from "../src/map.js";

const box = (shards: { view?: ViewShard; map?: MapShard } = {}): SourceBox => ({
  path: "village",
  box: {
    schema: "storylets/box@0",
    box: { id: "b_1", gameId: "village", ranking: { specificity: true }, fields: [], properties: [] },
  },
  tags: { schema: "storylets/tags@0", groups: [] },
  hands: {
    schema: "storylets/hands@0", templates: [],
    hands: [
      { id: "h_all", gameId: "all", rule: { bindings: {}, slots: "unbounded" } },
      { id: "h_other", gameId: "other", rule: { bindings: {}, slots: "unbounded" } },
    ],
  },
  decks: [{
    path: "village/decks/arrival.storyletdeck",
    shard: {
      schema: "storylets/deck@0",
      deck: { id: "k_arrival", gameId: "arrival", properties: [] },
      cards: [{ id: "c_gate", gameId: "gate", priority: 0, redraw: "always", outcomes: [] }],
    },
  }],
  ...(shards.view ? { view: shards.view } : {}),
  ...(shards.map ? { map: shards.map } : {}),
});

/** The map shard a plan would land, parsed back. */
const mapOf = (writes: PlannedWrite[]): MapShard => {
  const write = writes.find((w) => w.path.endsWith(".storyletmap"));
  return parseSource(write!.content) as MapShard;
};
/** The view shard a plan would land, parsed back; undefined when it leaves the
 *  view shard alone, which is the case for every project written after the split. */
const viewOf = (writes: PlannedWrite[]): ViewShard | undefined => {
  const write = writes.find((w) => w.path.endsWith(".storyletview"));
  return write ? parseSource(write.content) as ViewShard : undefined;
};

/** The project map shard a plan would land, parsed back. */
const projectMapOf = (writes: PlannedWrite[]): ProjectMapShard => {
  const write = writes.find((w) => w.path === projectMapPath("/p"));
  return parseSource(write!.content) as ProjectMapShard;
};

/** The project round one box, with a map when given one. */
const ZONES: TagGroup = {
  id: "d_zone", gameId: "zone", templates: { spatial: { map: true } },
  tags: [{ id: "t_docks", gameId: "docks" }],
} as TagGroup;
const project = (b: SourceBox, map?: ProjectMapShard): SourceProject => ({
  path: "project.storyletproject",
  boxes: [b],
  ...(map ? { map } : {}),
} as unknown as SourceProject);
const zoned = (frames?: ProjectMapShard["frames"]): ProjectMapShard => ({
  schema: PROJECTMAP_SCHEMA, group: ZONES, ...(frames ? { frames } : {}),
});

const placed = (sites: Record<string, ViewPoint>): MapShard => ({ schema: MAP_SCHEMA, map: { sites } });

describe("placing a hand on the map", () => {
  it("reads nothing for a box whose hands have never been placed", () => {
    expect(mapSites(box())).toEqual({});
  });

  it("writes the map shard, beside the view shard and not inside it", () => {
    const writes = planMapSites("/p", box(), [{ id: "h_all", x: 40, y: 60 }]);
    expect(writes.map((w) => w.path)).toEqual([mapPath("/p", box())]);
    // Which zone it is in is the hand's own business (its `chosen`), not a second
    // opinion kept here that could go on to disagree with it.
    expect(mapOf(writes)).toEqual({ schema: MAP_SCHEMA, map: { sites: { h_all: { x: 40, y: 60 } } } });
  });

  it("leaves the sites it was not told about alone", () => {
    const writes = planMapSites("/p", box({ map: placed({ h_all: { x: 1, y: 2 } }) }),
      [{ id: "h_other", x: 3, y: 4 }]);
    expect(mapOf(writes).map.sites).toEqual({ h_all: { x: 1, y: 2 }, h_other: { x: 3, y: 4 } });
  });

  it("reads a site as a position and ignores anything else beside it", () => {
    // The narrowing read doing its job: an older shape's `zone`, or a key a NEWER
    // version of the app writes, is not this function's business.
    const map = { schema: MAP_SCHEMA, map: { sites: { h_all: { x: 0, y: 0, zone: "v_docks" } } } } as unknown as MapShard;
    expect(mapSites(box({ map }))).toEqual({ h_all: { x: 0, y: 0 } });
  });

  it("plans no write when a site lands back where it was", () => {
    expect(planMapSites("/p", box({ map: placed({ h_all: { x: 8, y: 9 } }) }),
      [{ id: "h_all", x: 8, y: 9 }])).toEqual([]);
  });

  it("rounds to whole numbers", () => {
    const writes = planMapSites("/p", box(), [{ id: "h_all", x: 19.6, y: 40.2 }]);
    expect(mapOf(writes).map.sites?.["h_all"]).toEqual({ x: 20, y: 40 });
  });
});

describe("taking a hand off the map", () => {
  it("removes the site rather than emptying it", () => {
    const map = placed({ h_all: { x: 1, y: 2 }, h_other: { x: 3, y: 4 } });
    expect(mapOf(planForgetSites("/p", box({ map }), ["h_all"])).map.sites)
      .toEqual({ h_other: { x: 3, y: 4 } });
  });

  it("empties the shard to its schema when that was the last site", () => {
    // No husks: "no entry" already means "not placed" everywhere here.
    const map = placed({ h_all: { x: 1, y: 2 } });
    expect(mapOf(planForgetSites("/p", box({ map }), ["h_all"]))).toEqual({ schema: MAP_SCHEMA, map: {} });
  });

  it("plans no write for a hand that was never placed", () => {
    expect(planForgetSites("/p", box({ map: placed({ h_all: { x: 1, y: 2 } }) }), ["h_nobody"]))
      .toEqual([]);
  });
});

describe("the map's furniture", () => {
  const REGION = { id: "r_1", x: 10, y: 20, w: 100, h: 80, title: "Act two" };

  it("goes to the PROJECT map shard, and comes back from it", () => {
    const b = box();
    const writes = planCanvasFurniture("/p", b, { kind: "map" }, { frames: [REGION] }, project(b, zoned()));
    expect(writes.map((w) => w.path)).toEqual([projectMapPath("/p")]);
    const shard = projectMapOf(writes);
    expect(shard.frames).toEqual([REGION]);
    expect(canvasFurniture(b, { kind: "map" }, shard)).toEqual({ frames: [REGION] });
  });

  it("leaves the zone group beside it alone, and the box's sites untouched", () => {
    const b = box({ map: placed({ h_all: { x: 3, y: 4 } }) });
    const writes = planCanvasFurniture("/p", b, { kind: "map" }, { frames: [REGION] }, project(b, zoned()));
    expect(writes.some((w) => w.path === mapPath("/p", b))).toBe(false);
    const shard = projectMapOf(writes);
    expect(shard.group).toEqual(ZONES);
    expect(shard.frames).toEqual([REGION]);
  });

  it("writes nothing when nothing changed", () => {
    const b = box();
    const drawn = projectMapOf(planCanvasFurniture("/p", b, { kind: "map" }, { frames: [REGION] }, project(b, zoned())));
    expect(planCanvasFurniture("/p", b, { kind: "map" }, { frames: [REGION] }, project(b, drawn)))
      .toEqual([]);
  });

  it("clearing the map leaves no husk", () => {
    const b = box();
    const drawn = projectMapOf(planCanvasFurniture("/p", b, { kind: "map" }, { frames: [REGION] }, project(b, zoned())));
    const cleared = projectMapOf(planCanvasFurniture("/p", b, { kind: "map" }, { frames: [] }, project(b, drawn)));
    expect(cleared).toEqual({ schema: PROJECTMAP_SCHEMA, group: ZONES });
  });

  it("has nowhere to go in a project with no map", () => {
    const b = box();
    expect(planCanvasFurniture("/p", b, { kind: "map" }, { frames: [REGION] }, project(b))).toEqual([]);
  });
});

// --- the old address ----------------------------------------------------------
//
// A project written before 2026-09-06 kept its map under `map` in the view
// shard. Since 1.0.0 that address is not read: the parser drops it, and a site
// edit neither reads it nor writes the view shard.

describe("a map left in the view shard", () => {
  const legacy = {
    schema: VIEW_SCHEMA,
    canvases: { k_arrival: { cards: { c_gate: { x: 1, y: 2 } } } },
    map: { sites: { h_all: { x: 5, y: 6 } } },
  } as ViewShard;

  it("is not read", () => {
    expect(mapSites(box({ view: legacy }))).toEqual({});
  });

  it("is not touched by a site edit, which writes only the map shard", () => {
    const writes = planMapSites("/p", box({ view: legacy }), [{ id: "h_other", x: 7, y: 8 }]);
    expect(mapOf(writes).map.sites).toEqual({ h_other: { x: 7, y: 8 } });
    expect(viewOf(writes)).toBeUndefined();
  });
});
