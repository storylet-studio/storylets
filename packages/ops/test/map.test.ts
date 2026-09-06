// ---------------------------------------------------------------------------
// The box map: the DESIGNER's half of what used to be one arrangement shard
// (design/engine-server.md 9.1 point 5, ruled 2026-09-06).
//
// What the split promises, and what is pinned here:
//
//   - a site lands in `map.storyletmap`, never in the view shard again
//   - a project written before the split is READ where its map actually is,
//     and moves the first time anybody touches it
//   - everything the old sidecar promised a site still holds: sparse, whole
//     numbers, position and nothing else, no husks, and quiet when nothing moved
//   - the bundle does not change, because the block it compiles from did not
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { parseSource } from "@storylet-studio/compiler";
import type { SourceBox } from "@storylet-studio/compiler";
import { MAP_SCHEMA, VIEW_SCHEMA } from "@storylet-studio/model";
import type { MapShard, ViewPoint, ViewShard } from "@storylet-studio/model";
import type { PlannedWrite } from "../src/write.js";
import { canvasFurniture, planCanvasFurniture } from "../src/view.js";
import { mapPath, mapSites, planForgetSites, planMapMigration, planMapSites } from "../src/map.js";

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

  it("goes to the map shard, and comes back from it", () => {
    const writes = planCanvasFurniture("/p", box(), { kind: "map" }, { frames: [REGION] });
    expect(writes.map((w) => w.path)).toEqual([mapPath("/p", box())]);
    const shard = mapOf(writes);
    expect(shard.map.frames).toEqual([REGION]);
    expect(canvasFurniture(box({ map: shard }), { kind: "map" })).toEqual({ frames: [REGION] });
  });

  it("leaves the sites beside it alone", () => {
    const map = placed({ h_all: { x: 3, y: 4 } });
    const shard = mapOf(planCanvasFurniture("/p", box({ map }), { kind: "map" }, { frames: [REGION] }));
    expect(shard.map.sites).toEqual({ h_all: { x: 3, y: 4 } });
    expect(shard.map.frames).toEqual([REGION]);
  });

  it("writes nothing when nothing changed", () => {
    const drawn = mapOf(planCanvasFurniture("/p", box(), { kind: "map" }, { frames: [REGION] }));
    expect(planCanvasFurniture("/p", box({ map: drawn }), { kind: "map" }, { frames: [REGION] }))
      .toEqual([]);
  });

  it("clearing the map leaves no husk", () => {
    const drawn = mapOf(planCanvasFurniture("/p", box(), { kind: "map" }, { frames: [REGION] }));
    const cleared = mapOf(planCanvasFurniture("/p", box({ map: drawn }), { kind: "map" }, { frames: [] }));
    expect(cleared).toEqual({ schema: MAP_SCHEMA, map: {} });
  });
});

// --- the compatibility window ------------------------------------------------
//
// Every project written before 2026-09-06 keeps its map under `map` in the view
// shard. It is read from there for one release and never written back, and the
// first touch moves it. What must never happen is a map written to BOTH places,
// where the two would go on to disagree.

describe("a map that still lives in the view shard", () => {
  const legacy: ViewShard = {
    schema: VIEW_SCHEMA,
    canvases: { k_arrival: { cards: { c_gate: { x: 1, y: 2 } } } },
    map: { sites: { h_all: { x: 5, y: 6 } } },
  };

  it("is read where it is", () => {
    expect(mapSites(box({ view: legacy }))).toEqual({ h_all: { x: 5, y: 6 } });
  });

  it("moves out in the same plan as the edit that touched it", () => {
    const writes = planMapSites("/p", box({ view: legacy }), [{ id: "h_other", x: 7, y: 8 }]);
    expect(mapOf(writes).map.sites).toEqual({ h_all: { x: 5, y: 6 }, h_other: { x: 7, y: 8 } });
    const view = viewOf(writes)!;
    expect(view.map).toBeUndefined();
    // The canvases are the author's and stay exactly where they were.
    expect(view.canvases).toEqual({ k_arrival: { cards: { c_gate: { x: 1, y: 2 } } } });
  });

  it("moves out when a hand comes OFF the map too", () => {
    const view = viewOf(planForgetSites("/p", box({ view: legacy }), ["h_all"]))!;
    expect(view.map).toBeUndefined();
  });

  it("moves out when the map's furniture is drawn", () => {
    const writes = planCanvasFurniture("/p", box({ view: legacy }), { kind: "map" },
      { frames: [{ id: "r_1", x: 0, y: 0, w: 10, h: 10 }] });
    expect(mapOf(writes).map.sites).toEqual({ h_all: { x: 5, y: 6 } });
    expect(viewOf(writes)!.map).toBeUndefined();
  });

  it("migrates on its own, which is what `storyletengine format` runs", () => {
    const writes = planMapMigration("/p", box({ view: legacy }));
    expect(mapOf(writes)).toEqual({ schema: MAP_SCHEMA, map: { sites: { h_all: { x: 5, y: 6 } } } });
    expect(viewOf(writes)!.map).toBeUndefined();
  });

  it("plans nothing for a project that has already moved", () => {
    expect(planMapMigration("/p", box({ map: placed({ h_all: { x: 1, y: 2 } }) }))).toEqual([]);
  });

  it("lets the map shard win when a box somehow has both, and drops the copy", () => {
    const both = box({ view: legacy, map: placed({ h_all: { x: 99, y: 99 } }) });
    expect(mapSites(both)).toEqual({ h_all: { x: 99, y: 99 } });
    const writes = planMapMigration("/p", both);
    // Only the removal: the shard that wins is already correct, so nothing of the
    // ignored copy is allowed to reach it.
    expect(writes.map((w) => w.path.endsWith(".storyletview"))).toEqual([true]);
    expect(viewOf(writes)!.map).toBeUndefined();
  });
});
