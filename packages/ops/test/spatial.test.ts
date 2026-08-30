// ---------------------------------------------------------------------------
// The spatial template's validation. Expectations hand-written from what the
// design promises (design/graphical-views.md section 2, Reboot 6):
//
//   - geometry never blocks a release, because it never reaches a game
//   - but a zone that will not draw has to SAY so, or an author hunts for why
//   - core validates only what it knows; a template checks its own bags
//
// Authoring-side, so it is pinned here rather than in the conformance corpus,
// which is the cross-runtime contract (view.test.ts and influence.test.ts say
// the same).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { SourceBox, SourceProject } from "@storylet-studio/compiler";
import type { TagGroup } from "@storylet-studio/model";
import { runValidate } from "../src/validate.js";
import type { LoadedProject } from "../src/load.js";

const SQUARE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

const box = (groups: TagGroup[]): SourceBox => ({
  path: "village",
  box: {
    schema: "storylets/box@0",
    box: { id: "b_1", gameId: "village", ranking: { specificity: true }, fields: [], properties: [] },
  },
  tags: { schema: "storylets/tags@0", groups },
  hands: { schema: "storylets/hands@0", templates: [], hands: [] },
  decks: [],
});

const project = (groups: TagGroup[]): SourceProject => ({
  path: "p.storyletproj",
  project: {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    settings: { playAdvancesTurns: 1 },
    world: { properties: [] },
    story: { properties: [] },
    templates: {},
    export: { bundle: "d.storyletsc", metadata: "full" },
  },
  boxes: [box(groups)],
});

/** Validate a project made of these tag groups, with the bundle gate off (there
 *  is no bundle on disk here; the studio editor runs it this way too). */
const check = (groups: TagGroup[]): { ok: boolean; issues: { severity: string; where?: string; message: string }[] } => {
  const loaded = {
    dir: "/p", files: [], sidecars: [], issues: [], source: project(groups),
  } as unknown as LoadedProject;
  const result = runValidate(loaded, { checkBundle: false });
  return { ok: result.ok, issues: result.issues };
};

const zone = (polygon: unknown): TagGroup => ({
  id: "d_zone", gameId: "zone",
  templates: { spatial: { map: true } },
  tags: [{ id: "v_docks", gameId: "docks", templates: { spatial: { polygon } } }],
});

describe("a zone outline that will not draw", () => {
  it("says nothing about a good one", () => {
    const { ok, issues } = check([zone(SQUARE)]);
    expect(ok).toBe(true);
    expect(issues).toEqual([]);
  });

  it("says nothing about a spatial group whose zones are simply undrawn", () => {
    // A group marked spatial before any zone is traced is the normal starting
    // state, not a problem to report.
    const { issues } = check([{
      id: "d_zone", gameId: "zone", templates: { spatial: { map: true } },
      tags: [{ id: "v_docks", gameId: "docks" }],
    }]);
    expect(issues).toEqual([]);
  });

  it("warns, rather than errors, about a broken outline", () => {
    // The load-bearing half: geometry cannot break a game, so it cannot block a
    // release either. It still has to be said.
    const { ok, issues } = check([zone("nonsense")]);
    expect(ok).toBe(true);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.where).toBe("zone.docks");
    expect(issues[0]!.message).toContain("not a list of {x, y} numbers");
  });

  it("counts the points when there are too few", () => {
    // Naming the number is the difference between "fix this" and "what is wrong?".
    const { issues } = check([zone([{ x: 0, y: 0 }, { x: 5, y: 5 }])]);
    expect(issues.map((i) => i.message)).toEqual(["zone outline needs at least 3 points, not 2"]);
  });

  it("flags a zone whose group is not a map", () => {
    // Almost always a marker lost in a merge: the geometry is intact and nothing
    // will ever show it.
    const { ok, issues } = check([{
      id: "d_zone", gameId: "zone",
      tags: [{ id: "v_docks", gameId: "docks", templates: { spatial: { polygon: SQUARE } } }],
    }]);
    expect(ok).toBe(true);
    expect(issues.map((i) => i.message)).toEqual([
      'has a zone outline but "zone" is not a spatial group, so no map will show it',
    ]);
  });

  it("reports both faults on one tag", () => {
    const { issues } = check([{
      id: "d_zone", gameId: "zone",
      tags: [{ id: "v_docks", gameId: "docks", templates: { spatial: { polygon: [] } } }],
    }]);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.where === "zone.docks")).toBe(true);
  });
});

describe("a background that will not appear", () => {
  // Warnings, never errors, on the same reasoning as a zone that will not draw:
  // no picture can break a game, so a missing one must not block a release, but
  // an author who cannot see their site plan needs to be told why.
  const rect = { x: 0, y: 0, width: 800, height: 600 };
  const mapWith = (backgrounds: unknown): TagGroup => ({
    id: "d_zone", gameId: "zone",
    templates: { spatial: { map: true, backgrounds } },
    tags: [{ id: "v_docks", gameId: "docks", templates: { spatial: { polygon: SQUARE } } }],
  });

  it("warns that a file is not there, naming it, and does not block a release", () => {
    // The case that will actually happen: assets are opt-in on a pack, so a
    // project can arrive with somebody's placement and none of their pictures.
    const { ok, issues } = check([mapWith([{ id: "g_1", file: "site-plan.png", ...rect }])]);
    expect(ok).toBe(true);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", where: "zone" });
    expect(issues[0]!.message).toContain("site-plan.png");
    expect(issues[0]!.message).toContain("assets");
  });

  it("warns about an entry missing what it needs, by position", () => {
    const { ok, issues } = check([mapWith([{ id: "g_1", file: "no-size.png", x: 0, y: 0, width: 0, height: 10 }])]);
    expect(ok).toBe(true);
    expect(issues[0]!.message).toContain("background 1");
    expect(issues[0]!.message).toContain("rectangle with size");
  });

  it("warns about two pictures sharing an id, since only one can win", () => {
    const { issues } = check([mapWith([
      { id: "g_1", file: "a.png", ...rect },
      { id: "g_1", file: "b.png", ...rect },
    ])]);
    expect(issues.some((i) => i.message.includes('share the id "g_1"'))).toBe(true);
  });

  it("refuses a name that is not a plain file name, and says so", () => {
    // A shard field is untrusted input: a pack, a merge or a hand edit can put
    // anything here, and this is the message rather than a traversal.
    for (const file of ["../../../.ssh/id_rsa", "/etc/passwd", "sub/dir.png", ".hidden.png"]) {
      const { ok, issues } = check([mapWith([{ id: "g_1", file, ...rect }])]);
      expect(ok).toBe(true);
      expect(issues.some((i) => i.message.includes("plain file name"))).toBe(true);
    }
  });

  it("says nothing about backgrounds on a group that is not a map", () => {
    // No map, no picture: the group's own "not spatial" warning covers it.
    const { issues } = check([{
      id: "d_zone", gameId: "zone",
      templates: { spatial: { backgrounds: [{ id: "g_1", file: "a.png", ...rect }] } },
      tags: [],
    }]);
    expect(issues).toEqual([]);
  });

  it("warns once when the list is not a list at all", () => {
    const { issues } = check([mapWith("a string")]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("not a list");
  });
});
