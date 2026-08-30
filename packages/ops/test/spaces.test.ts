// The shared-space detector (design/playable-maps.md, the author's ruling):
// boxes that carry the SAME spatial group - same group gameId, same zone tag
// gameIds, identical polygons - are one place seen by several systems, and
// both play surfaces should draw that place once. Detection is strict: any
// difference keeps the maps separate, so nothing merges by accident.
import { describe, expect, it } from "vitest";
import type { SourceProject } from "@storylet-studio/compiler";
import { sharedSpaces } from "../src/spaces.js";

const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const OTHER = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }];

const boxWith = (gameId: string, groupGameId: string, zones: { tag: string; polygon: { x: number; y: number }[] }[]) => ({
  path: gameId,
  box: { schema: "storylets/box@0", box: { id: `b_${gameId}`, gameId, ranking: {}, fields: [], properties: [] } },
  tags: { schema: "storylets/tags@0", groups: [{
    id: `d_${gameId}_${groupGameId}`, gameId: groupGameId,
    // A group is spatial when its own templates.spatial says map: true; each
    // tag's polygon rides the tag's spatial bag (the shard shape).
    templates: { spatial: { map: true } },
    tags: zones.map((z, i) => ({ id: `v_${gameId}_${i}`, gameId: z.tag, templates: { spatial: { polygon: z.polygon } } })),
  }] },
  hands: { schema: "storylets/hands@0", templates: [], hands: [] },
  decks: [],
});

const project = (boxes: ReturnType<typeof boxWith>[]): SourceProject => ({
  path: "p.storyletproj",
  project: {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    settings: { playAdvancesTurns: 1 },
    world: { properties: [] }, story: { properties: [] }, templates: {},
    export: { bundle: "dist/p.storyletsc", metadata: "full" },
  },
  boxes,
}) as unknown as SourceProject;

describe("sharedSpaces", () => {
  it("groups boxes whose spatial groups are identical, in project order", () => {
    const source = project([
      boxWith("contracts", "district", [{ tag: "docks", polygon: SQUARE }]),
      boxWith("news", "district", [{ tag: "docks", polygon: SQUARE }]),
      boxWith("items", "district", [{ tag: "docks", polygon: SQUARE }]),
    ]);
    expect(sharedSpaces(source)).toEqual([{ group: "district", boxes: ["contracts", "news", "items"] }]);
  });

  it("any difference keeps them separate: polygon, zone set, or group name", () => {
    const source = project([
      boxWith("a", "district", [{ tag: "docks", polygon: SQUARE }]),
      boxWith("b", "district", [{ tag: "docks", polygon: OTHER }]),      // different shape
      boxWith("c", "district", [{ tag: "harbour", polygon: SQUARE }]),   // different zone
      boxWith("d", "zone", [{ tag: "docks", polygon: SQUARE }]),         // different group
    ]);
    expect(sharedSpaces(source)).toEqual([]);
  });

  it("a lone map is not a space, and zone ORDER does not split a genuine one", () => {
    const source = project([
      boxWith("a", "district", [{ tag: "docks", polygon: SQUARE }, { tag: "strip", polygon: OTHER }]),
      boxWith("b", "district", [{ tag: "strip", polygon: OTHER }, { tag: "docks", polygon: SQUARE }]),
      boxWith("c", "elsewhere", [{ tag: "moon", polygon: SQUARE }]),
    ]);
    expect(sharedSpaces(source)).toEqual([{ group: "district", boxes: ["a", "b"] }]);
  });
});
