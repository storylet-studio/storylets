// ---------------------------------------------------------------------------
// The resolve op. Expectations hand-written from what `storyletengine resolve`
// and Storyletter's `--at` promise: a gameId wins, then an id, then a title,
// then a partial match, and an exact hit never drowns in fuzzy ones. Every item
// with a document in the editor is findable, and an outcome names its card.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { SourceBox, SourceProject } from "@storylet-studio/compiler";
import type { LoadedProject } from "../src/load.js";
import { loadProject } from "../src/load.js";
import { indexProject, runResolve } from "../src/resolve.js";

const box: SourceBox = {
  path: "village",
  box: {
    schema: "storylets/box@0",
    box: { id: "b_1", gameId: "village", title: "Village", ranking: { specificity: true }, fields: [], properties: [] },
  },
  tags: {
    schema: "storylets/tags@0",
    groups: [{ id: "d_zone", gameId: "zone", tags: [{ id: "v_village", gameId: "village" }] }],
  },
  hands: {
    schema: "storylets/hands@0",
    templates: [{ id: "t_what", gameId: "whats-happening", chooses: ["d_zone"], slots: 3, properties: [] }],
    hands: [{ id: "h_inn", gameId: "the-inn", title: "The Inn", template: "t_what", chosen: { d_zone: "v_village" } }],
  },
  decks: [
    {
      path: "village/decks/arrival.storyletdeck",
      shard: {
        schema: "storylets/deck@0",
        deck: { id: "k_arrival", gameId: "arrival", title: "Arrival", properties: [] },
        cards: [
          {
            id: "c_gate", gameId: "gate", title: "Arrive at the Gate", priority: 0, redraw: "always",
            outcomes: [{ id: "o_step", gameId: "step-through", title: "Step through", changes: {} }],
          },
          // No pinned gameId: the effective one derives from the title ("the-inn"),
          // which is also the hand's pinned gameId above.
          { id: "c_inn", title: "The Inn", priority: 0, redraw: "always", outcomes: [] },
          // An id that reads like a name, so the gameId-before-id order can be pinned.
          { id: "forge", title: "At the Forge", priority: 0, redraw: "always", outcomes: [] },
        ],
      },
    },
    {
      path: "village/decks/forge.storyletdeck",
      shard: {
        schema: "storylets/deck@0",
        deck: { id: "k_forge", gameId: "forge", title: "The Forge", properties: [] },
        cards: [],
      },
    },
  ],
};

const source: SourceProject = {
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
  boxes: [box],
};

const loaded: LoadedProject = { dir: "/p", files: [], source, issues: [], sidecars: [] };

describe("runResolve", () => {
  it("an exact gameId resolves to the item, with its kind, trail and shard", () => {
    expect(runResolve(loaded, "gate")).toEqual([{
      id: "c_gate", kind: "card", gameId: "gate", title: "Arrive at the Gate",
      location: ["Village", "Arrival"], box: "b_1", deck: "k_arrival", card: "c_gate",
      file: "village/decks/arrival.storyletdeck",
    }]);
  });

  it("an exact id is found when nothing carries it as a gameId", () => {
    const hits = runResolve(loaded, "h_inn");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "hand", gameId: "the-inn", box: "b_1", file: "village/hands.storylethands" });
  });

  it("a gameId match outranks an id match for the same query", () => {
    const hits = runResolve(loaded, "forge");
    expect(hits.map((h) => h.id)).toEqual(["k_forge"]);
  });

  it("a title resolves, case-insensitively, when no gameId or id matches", () => {
    const hits = runResolve(loaded, "arrive at the gate");
    expect(hits.map((h) => h.id)).toEqual(["c_gate"]);
  });

  it("falls back to a partial match when nothing matches exactly", () => {
    const ids = runResolve(loaded, "arriv").map((h) => h.id);
    expect(ids).toContain("k_arrival");
    expect(ids).toContain("c_gate");
  });

  it("an exact hit never drowns in partial ones, and every exact hit is kept", () => {
    // "the-inn" is the card's derived gameId and the hand's pinned one; "inn"
    // would also be a substring of both, but those tiers are never reached.
    const hits = runResolve(loaded, "the-inn");
    expect(hits.map((h) => `${h.kind}:${h.id}`).sort()).toEqual(["card:c_inn", "hand:h_inn"]);
  });

  it("an outcome resolves to its card, carrying the ids that open it", () => {
    const [hit] = runResolve(loaded, "step-through");
    expect(hit).toMatchObject({ kind: "outcome", id: "o_step", box: "b_1", deck: "k_arrival", card: "c_gate", location: ["Village", "Arrival", "Arrive at the Gate"] });
  });

  it("boxes, templates and tag groups are findable too", () => {
    expect(runResolve(loaded, "village")[0]).toMatchObject({ kind: "box", id: "b_1", location: [], file: "village/box.storyletbox" });
    expect(runResolve(loaded, "whats-happening")[0]).toMatchObject({ kind: "template", id: "t_what", location: ["Village"] });
    expect(runResolve(loaded, "zone")[0]).toMatchObject({ kind: "tagGroup", id: "d_zone", location: ["Village"], file: "village/tags.storylettags" });
  });

  it("returns nothing for an unknown or blank query", () => {
    expect(runResolve(loaded, "no_such_thing_xyz")).toEqual([]);
    expect(runResolve(loaded, "   ")).toEqual([]);
  });

  it("a project that does not load has nothing to resolve", () => {
    expect(runResolve({ dir: "/p", files: [], issues: [], sidecars: [] }, "gate")).toEqual([]);
  });

  it("indexes every item once, in project order", () => {
    expect(indexProject(loaded).map((e) => e.id)).toEqual([
      "b_1", "k_arrival", "c_gate", "o_step", "c_inn", "forge", "k_forge", "t_what", "h_inn", "d_zone",
    ]);
  });

  it("resolves against a real project on disk", () => {
    const village = loadProject(fileURLToPath(new URL("./fixtures/the-hamlet.storylets", import.meta.url)));
    const [hit] = runResolve(village, "arrive-at-the-gate");
    expect(hit).toMatchObject({ kind: "card", id: "c_arrive", location: ["Village", "Arrival"], file: "village/decks/arrival.storyletdeck" });
  });
});
