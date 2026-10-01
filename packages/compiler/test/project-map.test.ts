// ---------------------------------------------------------------------------
// The project map in the compiler (design/project-map-contract.md 1 and 4.1):
// the root shard, the per-box opt-in, the bundle it compiles to, and every
// diagnostic the contract names (E1 to E8, W1 to W3). Synthetic projects, one
// rule each, so a failure names the rule that moved.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { canonicalStringify, compileProject, contentAboveRung, parseProjectFiles, projectHash } from "../src/index.js";
import type { Issue, SourceFile, SourceProject } from "../src/index.js";
import { Engine } from "@storylet-studio/runtime";

const file = (path: string, value: unknown): SourceFile => ({ path, text: canonicalStringify(value) });

const errors = (issues: Issue[]): string[] =>
  issues.filter((i) => i.severity === "error").map((i) => i.message);
const warnings = (issues: Issue[]): string[] =>
  issues.filter((i) => i.severity === "warning").map((i) => i.message);

/** The zone group the project scaffold of the corpus uses: two zones, a
 *  per-flow `danger` and a shared `alarm`, declared once on the group. */
const DISTRICT = {
  id: "d_district", gameId: "district",
  properties: [
    { name: "danger", type: "number", default: 0 },
    { name: "alarm", type: "number", default: 0, shared: true },
  ],
  tags: [
    { id: "v_quay", gameId: "quay", values: { danger: 2 } },
    { id: "v_hill", gameId: "hill" },
  ],
  templates: { spatial: { map: true } },
};

interface BoxSpec {
  folder: string;
  id: string;
  usesMap?: true;
  groups?: unknown[];
  cards?: unknown[];
  templates?: unknown[];
  hands?: unknown[];
  map?: unknown;
}

const project = (opts: {
  map?: unknown;
  boxes: BoxSpec[];
  story?: unknown[];
  play?: string;
}): SourceFile[] => [
  file("p.storyletproj", {
    schema: "storylets/project@0",
    project: { id: "p", name: "P", version: "0.0.1" },
    settings: { playAdvancesTurns: 1, ...(opts.play !== undefined ? { play: opts.play } : {}) },
    world: { properties: [] },
    story: { properties: opts.story ?? [] },
    templates: {},
    export: { bundle: "dist/p.storyletsc", metadata: "full" },
  }),
  ...(opts.map !== undefined ? [file("map.storyletmap", opts.map)] : []),
  ...opts.boxes.flatMap((b) => [
    file(`${b.folder}/box.storyletbox`, {
      schema: "storylets/box@0",
      box: {
        fields: [], gameId: b.folder, id: b.id, properties: [], ranking: { specificity: true },
        ...(b.usesMap ? { usesMap: true } : {}),
      },
    }),
    file(`${b.folder}/tags.storylettags`, { schema: "storylets/tags@0", groups: b.groups ?? [] }),
    file(`${b.folder}/hands.storylethands`, { schema: "storylets/hands@0", templates: b.templates ?? [], hands: b.hands ?? [] }),
    file(`${b.folder}/decks/main.storyletdeck`, {
      schema: "storylets/deck@0",
      deck: { id: `k_${b.folder}`, gameId: "main", properties: [] },
      cards: b.cards ?? [],
    }),
    ...(b.map !== undefined ? [file(`${b.folder}/map.storyletmap`, b.map)] : []),
  ]),
];

const projectMap = (group: unknown = DISTRICT, extra: Record<string, unknown> = {}): unknown =>
  ({ schema: "storylets/projectmap@0", group, ...extra });

const parse = (files: SourceFile[]): SourceProject => {
  const { project: source, issues } = parseProjectFiles(files);
  expect(errors(issues)).toEqual([]);
  return source!;
};
const compile = (files: SourceFile[]) => compileProject(parse(files));

const card = (id: string, extra: Record<string, unknown> = {}): unknown =>
  ({ id, gameId: id.replace(/^c_/, ""), outcomes: [], ...extra });

describe("the project map shard", () => {
  it("is read from the project root, beside the project shard", () => {
    const source = parse(project({ map: projectMap(), boxes: [{ folder: "news", id: "b_news", usesMap: true }] }));
    expect(source.map!.group.id).toBe("d_district");
    expect(source.boxes.map((b) => b.path)).toEqual(["news"]);
  });

  it("E1: refuses a root map shard whose schema tag is not the project map's", () => {
    const { issues } = parseProjectFiles(project({
      map: { schema: "storylets/map@0", map: { sites: {} } },
      boxes: [{ folder: "news", id: "b_news" }],
    }));
    expect(errors(issues)).toEqual(['schema tag "storylets/map@0" is not "storylets/projectmap@0"']);
    expect(issues[0]!.path).toBe("map.storyletmap");
  });

  it("refuses a project map with no zone group", () => {
    const { issues } = compile(project({ map: { schema: "storylets/projectmap@0" }, boxes: [{ folder: "news", id: "b_news" }] }));
    expect(errors(issues)).toEqual(["the project map has no zone group: it needs a `group` with an id and a list of tags"]);
  });

  it("changes the content hash when the zones change, and not when its frames do", () => {
    const base = parse(project({ map: projectMap(), boxes: [{ folder: "news", id: "b_news", usesMap: true }] }));
    const framed = parse(project({
      map: projectMap(DISTRICT, { frames: [{ id: "f_1", x: 0, y: 0, w: 10, h: 10 }] }),
      boxes: [{ folder: "news", id: "b_news", usesMap: true }],
    }));
    const moved = parse(project({
      map: projectMap({ ...DISTRICT, tags: [...DISTRICT.tags, { id: "v_mill", gameId: "mill" }] }),
      boxes: [{ folder: "news", id: "b_news", usesMap: true }],
    }));
    expect(projectHash(framed)).toBe(projectHash(base));
    expect(projectHash(moved)).not.toBe(projectHash(base));
  });
});

describe("the bundle a project map compiles to", () => {
  const files = project({
    map: projectMap(),
    boxes: [
      {
        folder: "contracts", id: "b_con", usesMap: true,
        cards: [card("c_job", { tags: { d_district: ["v_quay"] } })],
        hands: [{ id: "h_board", gameId: "board", rule: { bindings: { d_district: "v_quay" } } }],
      },
      { folder: "codex", id: "b_codex", cards: [card("c_entry")] },
    ],
  });

  it("carries the zone group once, flattened, in no box, with @1 and the opt-in", () => {
    const { bundle, issues } = compile(files);
    expect(errors(issues)).toEqual([]);
    expect(bundle!.schema).toBe("storylets/bundle@1");
    expect(bundle!.map).toEqual({
      group: {
        id: "d_district", gameId: "district",
        tags: [
          { id: "v_hill", gameId: "hill", properties: [
            { name: "danger", type: "number", default: 0 },
            { name: "alarm", type: "number", default: 0, shared: true },
          ] },
          { id: "v_quay", gameId: "quay", properties: [
            { name: "danger", type: "number", default: 2 },
            { name: "alarm", type: "number", default: 0, shared: true },
          ] },
        ],
      },
    });
    const byGameId = Object.fromEntries(bundle!.boxes.map((b) => [b.gameId, b]));
    expect(byGameId["contracts"]!.usesMap).toBe(true);
    expect(byGameId["codex"]!.usesMap).toBeUndefined();
    expect(bundle!.boxes.flatMap((b) => b.tagGroups)).toEqual([]);
    // No geometry without `export.map`: a shipping build carries no shapes.
    expect(JSON.stringify(bundle)).not.toContain("geometry");
  });

  it("plays: an opted-in box's hand deals the card tagged with the zone, and the zone's value is unqualified", () => {
    const { bundle } = compile(files);
    const flow = new Engine(bundle!, { seed: 0 }).openFlow("main");
    expect(flow.deal("board").map((c) => c.gameId)).toEqual(["job"]);
    expect(flow.getProperty("value.quay.danger")).toBe(2);
  });

  it("writes @1 on a project with no map too, and nothing else changes", () => {
    const { bundle } = compile(project({ boxes: [{ folder: "codex", id: "b_codex", cards: [card("c_entry")] }] }));
    expect(bundle!.schema).toBe("storylets/bundle@1");
    expect(bundle!.map).toBeUndefined();
    expect(bundle!.boxes[0]!.usesMap).toBeUndefined();
  });
});

describe("the project map's errors", () => {
  it("E2: a box group carrying the map marker names the command that moves it", () => {
    const { issues, bundle } = compile(project({
      boxes: [{ folder: "news", id: "b_news", groups: [{ ...DISTRICT }] }],
    }));
    expect(bundle).toBeUndefined();
    expect(errors(issues)).toEqual([
      'tag group "district" in box "news" is a map: a map belongs to the project now; run `storyletengine format` to move it',
    ]);
    expect(issues[0]!.path).toBe("news/tags");
  });

  it("E3: a box group may not take the project group's name, in any box", () => {
    const { issues } = compile(project({
      map: projectMap(),
      boxes: [
        { folder: "news", id: "b_news", usesMap: true },
        // Not on the map, and still refused: opting in later must never turn
        // into a compile error (D9).
        { folder: "codex", id: "b_codex", groups: [{ id: "d_x", gameId: "district", tags: [{ id: "v_lane", gameId: "lane" }] }] },
      ],
    }));
    expect(errors(issues)).toEqual([
      'tag group "district" in box "codex" has the name of the project map\'s zone group; a group name means one thing across the project, so rename one of them',
    ]);
  });

  it("E4: a box tag may not take a zone's name, in any box", () => {
    const { issues } = compile(project({
      map: projectMap(),
      boxes: [
        { folder: "news", id: "b_news", usesMap: true },
        { folder: "codex", id: "b_codex", groups: [{ id: "d_x", gameId: "topic", tags: [{ id: "v_q", gameId: "quay" }] }] },
      ],
    }));
    expect(errors(issues)).toEqual([
      'tag "quay" in box "codex" has the name of a zone of the project map, so "value.quay.<property>" would name both; rename one of them',
    ]);
  });

  it("E5: the project group may not be called place", () => {
    const { issues } = compile(project({
      map: projectMap({ ...DISTRICT, gameId: "place" }),
      boxes: [{ folder: "news", id: "b_news", usesMap: true }],
    }));
    expect(errors(issues)).toEqual(['"place" is the reserved tag group and cannot be declared']);
    expect(issues.find((i) => i.severity === "error")!.path).toBe("map");
  });

  it("E6: a box not on the map may not tag a card, bind a hand, choose or fill a hole with a zone", () => {
    const { issues } = compile(project({
      map: projectMap(),
      boxes: [
        { folder: "contracts", id: "b_con", usesMap: true },
        {
          folder: "news", id: "b_news",
          cards: [card("c_story", { tags: { d_district: ["v_quay"] } })],
          templates: [{ id: "t_screen", gameId: "screen", chooses: ["d_district"], slots: 1 }],
          hands: [
            { id: "h_screen", gameId: "dock-screen", template: "t_screen", chosen: { d_district: "v_quay" } },
            { id: "h_wall", gameId: "wall", rule: { bindings: { d_district: "v_hill" } } },
          ],
        },
      ],
    }));
    const said = 'box "news" is not on the project map, so it cannot use the zone group "district"; turn on "Uses the project map" or remove the reference';
    // Once per reference: the card's tag, the template's choice, the rule's
    // binding. The instance's `chosen` is not said again: its template is
    // where the hole is declared, and one message there names the fix.
    expect(errors(issues)).toEqual([said, said, said]);
    expect(issues.filter((i) => i.severity === "error").map((i) => i.where)).toEqual(["story", "screen", "wall"]);
  });

  it("E7: a box that uses the map needs a project that has one", () => {
    const { issues } = compile(project({ boxes: [{ folder: "news", id: "b_news", usesMap: true }] }));
    expect(errors(issues)).toEqual([
      'box "news" uses the project map, and the project has none; draw one, or turn "Uses the project map" off',
    ]);
    expect(issues[0]!.field).toBe("usesMap");
  });

  it("E8: the project group gets every check a box group gets", () => {
    const { issues } = compile(project({
      map: projectMap({
        id: "d_district", gameId: "district",
        boundBy: "@story.nowhere",
        properties: [{ name: "danger", type: "number", default: 0 }],
        tags: [
          { id: "v_quay", gameId: "quay", values: { danger: "high", mood: 1 } },
          { id: "v_hill", gameId: "hill", properties: [{ name: "danger", type: "number", default: 0 }] },
          { id: "v_hill2", gameId: "hill" },
        ],
      }),
      boxes: [{ folder: "news", id: "b_news", usesMap: true }],
    }));
    expect(errors(issues)).toEqual([
      'duplicate tag (group "district") gameId "hill" (also in map)',
      'boundBy "@story.nowhere" is not a declared story property',
      '"danger" is declared both on the group "district" and on its tag "hill"; declare it once, on the group if every tag has it',
      '"danger" is number on the group, so "high" is not a value it can start at',
      '"mood" has a value here but the group "district" declares no such property; a tag sets values, its group declares them',
    ]);
  });

  it("an id the project map uses is project-wide, as every other id is", () => {
    const { issues } = compile(project({
      map: projectMap(),
      boxes: [{ folder: "news", id: "b_news", usesMap: true, groups: [{ id: "v_quay", gameId: "topic", tags: [] }] }],
    }));
    expect(errors(issues)).toEqual(['duplicate id "v_quay" (also in map)']);
  });
});

describe("the project map's warnings", () => {
  it("W1: a project map no box uses", () => {
    const { issues, bundle } = compile(project({ map: projectMap(), boxes: [{ folder: "news", id: "b_news" }] }));
    expect(bundle).toBeDefined();
    expect(warnings(issues)).toEqual([
      'no box uses the project map, so nothing is ever dealt to its zones; turn on "Uses the project map" on the boxes that belong on it',
    ]);
  });

  it("W2: sites in a box that is not on the map, which do not ship", () => {
    const { issues } = compile(project({
      map: projectMap(), play: "shared",
      boxes: [
        { folder: "contracts", id: "b_con", usesMap: true },
        {
          folder: "news", id: "b_news",
          hands: [{ id: "h_wall", gameId: "wall", rule: {} }],
          map: { schema: "storylets/map@0", map: { sites: { h_wall: { x: 1, y: 2 } } } },
        },
      ],
    }));
    expect(warnings(issues)).toEqual([
      '1 hand is placed on the map, but box "news" is not on the project map, so no site of it ships; turn on "Uses the project map" or take them off the map',
    ]);
    expect(issues[0]!.path).toBe("news/map");
  });

  it("W3: frames still in a box's map shard are ignored, naming format", () => {
    const { issues } = compile(project({
      map: projectMap(), play: "shared",
      boxes: [{
        folder: "news", id: "b_news", usesMap: true,
        map: { schema: "storylets/map@0", map: { frames: [{ id: "f_1", x: 0, y: 0, w: 5, h: 5 }] } },
      }],
    }));
    expect(warnings(issues)).toEqual([
      "the map's frames belong to the project map now, and these are ignored; run `storyletengine format` to move them",
    ]);
  });
});

describe("the project map in an opted-in box's @hand", () => {
  it("types a zone property and the group's name, as if the group were the box's own", () => {
    const { issues } = compile(project({
      map: projectMap(),
      boxes: [{
        folder: "news", id: "b_news", usesMap: true,
        cards: [
          card("c_ok", { condition: '@hand.danger >= 1 and @hand.district == "quay"' }),
          card("c_typo", { condition: '@hand.district == "qauy"' }),
        ],
      }],
    }));
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]).toContain("qauy");
  });

  it("refuses a write to the zone group's name, which is the chosen tag", () => {
    const { issues } = compile(project({
      map: projectMap(),
      boxes: [{
        folder: "news", id: "b_news", usesMap: true,
        cards: [card("c_move", { outcomes: [{ id: "o_go", gameId: "go", changes: { "@hand.district": '"hill"' } }] })],
      }],
    }));
    expect(errors(issues)).toEqual([
      'change target "@hand.district" is the chosen tag of group "district", which cannot be written: it is what the hand asked for, not state it carries',
    ]);
  });

  it("a box not on the map does not see the zone's names", () => {
    const { issues } = compile(project({
      map: projectMap(),
      boxes: [
        { folder: "contracts", id: "b_con", usesMap: true },
        { folder: "codex", id: "b_codex", cards: [card("c_peek", { condition: "@hand.danger >= 1" })] },
      ],
    }));
    expect(errors(issues).join("\n")).toContain("danger");
  });

  it("a zone property and a box tag property of one name must agree in type", () => {
    const { issues } = compile(project({
      map: projectMap(),
      boxes: [{
        folder: "news", id: "b_news", usesMap: true,
        groups: [{ id: "d_mood", gameId: "mood", tags: [{ id: "v_grim", gameId: "grim", properties: [{ name: "danger", type: "string", default: "" }] }] }],
      }],
    }));
    expect(errors(issues)).toEqual([
      "@hand.danger is declared as string on mood/grim and as number on group district; @hand composes them into one name, so they must agree",
    ]);
  });
});

describe("the play ladder and the project map", () => {
  it("counts a zone's shared property only when a box is on the map", () => {
    const on = parse(project({ map: projectMap(), boxes: [{ folder: "news", id: "b_news", usesMap: true }] }));
    const off = parse(project({ map: projectMap(), boxes: [{ folder: "news", id: "b_news" }] }));
    expect(contentAboveRung(on, "solo").map((i) => i.what)).toEqual(["@hand.alarm is shared"]);
    expect(contentAboveRung(off, "solo")).toEqual([]);
  });
});
