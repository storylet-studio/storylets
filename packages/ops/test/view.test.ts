// ---------------------------------------------------------------------------
// The arrangement layer. Expectations hand-written from what
// design/graphical-views.md section 1.2 PROMISES an author and a merge, not read
// off the implementation:
//
//   - sparse: no entry means "lay out by default"
//   - forgiving: an entry for a deleted card is inert, and survives
//   - id-keyed: two designers arranging different things do not collide
//   - source-only: the sidecar never reaches the compiled bundle
//   - quiet: nothing to save means no write, so git stays clean
//
// Authoring-side, so it is pinned here in ops rather than in the conformance
// corpus, which is the cross-RUNTIME contract (the influence tests say the same).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { compileProject } from "@storylet-studio/compiler";
import type { SourceBox, SourceProject } from "@storylet-studio/compiler";
import { NOTES_SCHEMA, VIEW_SCHEMA, commentsOf, markOf, marksOn, openThreadCounts, threadsFor } from "@storylet-studio/model";
import type { Comment, NotesShard, ViewPoint, ViewShard } from "@storylet-studio/model";
import { parseSource } from "@storylet-studio/compiler";
import { planComments } from "../src/comments.js";
import type { PlannedWrite } from "../src/write.js";
import { canvasFurniture, cardPositions, mapSites, planCanvasFurniture, planCardPositions, planForgetCanvas, planForgetSites, planMapSites, viewPath } from "../src/view.js";

const box = (view?: ViewShard): SourceBox => ({
  path: "village",
  box: {
    schema: "storylets/box@0",
    box: { id: "b_1", gameId: "village", ranking: { specificity: true }, fields: [], properties: [] },
  },
  tags: { schema: "storylets/tags@0", groups: [] },
  hands: {
    schema: "storylets/hands@0", templates: [],
    hands: [{ id: "h_all", gameId: "all", rule: { bindings: {}, slots: "unbounded" } }],
  },
  decks: [{
    path: "village/decks/arrival.storyletdeck",
    shard: {
      schema: "storylets/deck@0",
      deck: { id: "k_arrival", gameId: "arrival", properties: [] },
      cards: [
        { id: "c_gate", gameId: "gate", priority: 0, redraw: "always", outcomes: [] },
        { id: "c_inn", gameId: "inn", priority: 0, redraw: "always", outcomes: [] },
      ],
    },
  }],
  ...(view ? { view } : {}),
});

const project = (b: SourceBox): SourceProject => ({
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
  boxes: [b],
  contracts: [],
});

/** The shard a planned write would land, parsed back. */
const written = (write: { content: string } | undefined): ViewShard =>
  parseSource(write!.content) as ViewShard;

describe("reading an arrangement", () => {
  it("reports nothing for a box that has no sidecar", () => {
    // The normal state of a project: no file, no positions, and no complaint.
    // Every card lays out by default.
    expect(cardPositions(box(), "k_arrival")).toEqual({});
  });

  it("reports nothing for a deck nobody has arranged", () => {
    const view: ViewShard = { schema: VIEW_SCHEMA, canvases: { k_other: { cards: { c_x: { x: 0, y: 0 } } } } };
    expect(cardPositions(box(view), "k_arrival")).toEqual({});
  });

  it("reports the positions it holds", () => {
    const view: ViewShard = { schema: VIEW_SCHEMA, canvases: { k_arrival: { cards: { c_gate: { x: 20, y: 40 } } } } };
    expect(cardPositions(box(view), "k_arrival")).toEqual({ c_gate: { x: 20, y: 40 } });
  });
});

describe("recording a move", () => {
  it("creates the sidecar for a box that had none", () => {
    const write = planCardPositions("/p", box(), "k_arrival", [{ id: "c_gate", x: 60, y: 80 }]);
    expect(write?.path).toBe(viewPath("/p", box()));
    expect(written(write)).toEqual({
      schema: VIEW_SCHEMA,
      canvases: { k_arrival: { cards: { c_gate: { x: 60, y: 80 } } } },
    });
  });

  it("leaves the cards it was not told about alone", () => {
    // A drag moves one card; the other nineteen on the canvas must not be
    // rewritten, or every save would touch every line and the merge engine would
    // have nothing to work with.
    const view: ViewShard = {
      schema: VIEW_SCHEMA,
      canvases: { k_arrival: { cards: { c_gate: { x: 20, y: 40 }, c_inn: { x: 220, y: 40 } } } },
    };
    const write = planCardPositions("/p", box(view), "k_arrival", [{ id: "c_inn", x: 220, y: 160 }]);
    expect(written(write).canvases?.["k_arrival"]?.cards).toEqual({
      c_gate: { x: 20, y: 40 },
      c_inn: { x: 220, y: 160 },
    });
  });

  it("keeps other decks, the map and anything else the file holds", () => {
    // A save by this version must not amputate what another view, or a NEWER
    // version of the app, put in the same file.
    const view = {
      schema: VIEW_SCHEMA,
      canvases: {
        k_other: { cards: { c_z: { x: 1, y: 2 } }, notes: [{ id: "n_1", x: 0, y: 0, w: 10, h: 10, text: "hi" }] },
      },
      map: { sites: { h_all: { x: 5, y: 6, zone: "v_docks" } } },
      somethingNewer: { keep: true },
    } as unknown as ViewShard;
    const shard = written(planCardPositions("/p", box(view), "k_arrival", [{ id: "c_gate", x: 0, y: 0 }]));
    expect(shard.canvases?.["k_other"]).toEqual(view.canvases!["k_other"]);
    expect(shard.map).toEqual({ sites: { h_all: { x: 5, y: 6, zone: "v_docks" } } });
    expect((shard as unknown as { somethingNewer: unknown }).somethingNewer).toEqual({ keep: true });
  });

  it("keeps an entry for a card that no longer exists", () => {
    // Inert, not invalid. Pruning would look tidy and would fight a colleague who
    // is adding that card back on another branch.
    const view: ViewShard = {
      schema: VIEW_SCHEMA,
      canvases: { k_arrival: { cards: { c_deleted: { x: 700, y: 700 } } } },
    };
    const shard = written(planCardPositions("/p", box(view), "k_arrival", [{ id: "c_gate", x: 0, y: 0 }]));
    expect(shard.canvases?.["k_arrival"]?.cards?.["c_deleted"]).toEqual({ x: 700, y: 700 });
  });

  it("plans no write when nothing moved", () => {
    // A click that ends where it started, or a drag the author undid by hand: the
    // file is not touched, so the project does not look dirty.
    const view: ViewShard = { schema: VIEW_SCHEMA, canvases: { k_arrival: { cards: { c_gate: { x: 20, y: 40 } } } } };
    expect(planCardPositions("/p", box(view), "k_arrival", [{ id: "c_gate", x: 20, y: 40 }])).toBeUndefined();
  });

  it("rounds to whole numbers", () => {
    // A coordinate differing in its eleventh decimal place is a diff, and later a
    // conflict, for nobody's benefit.
    const shard = written(planCardPositions("/p", box(), "k_arrival", [{ id: "c_gate", x: 19.6, y: 40.2 }]));
    expect(shard.canvases?.["k_arrival"]?.cards?.["c_gate"]).toEqual({ x: 20, y: 40 });
  });
});

describe("placing a hand on the map", () => {
  it("reads nothing for a box whose hands have never been placed", () => {
    expect(mapSites(box())).toEqual({});
  });

  it("records a site as a POSITION and nothing else", () => {
    // Which zone it is in is the hand's own business (its `chosen`), not a second
    // opinion kept here that could go on to disagree with it.
    const shard = written(planMapSites("/p", box(), [{ id: "h_all", x: 40, y: 60 }]));
    expect(shard.map?.sites).toEqual({ h_all: { x: 40, y: 60 } });
  });

  it("keeps a deck's canvas when the map changes", () => {
    // One sidecar, several concerns: arranging cards and moving sites must not
    // overwrite each other.
    const view: ViewShard = { schema: VIEW_SCHEMA, canvases: { k_arrival: { cards: { c_gate: { x: 1, y: 2 } } } } };
    const shard = written(planMapSites("/p", box(view), [{ id: "h_all", x: 3, y: 4 }]));
    expect(shard.canvases).toEqual({ k_arrival: { cards: { c_gate: { x: 1, y: 2 } } } });
    expect(shard.map?.sites?.["h_all"]).toEqual({ x: 3, y: 4 });
  });

  // NOT legacy handling, which was removed with the heal: this is the narrowing
  // read doing its job. Whatever else a sidecar carries beside x and y - an older
  // shape's `zone`, or a key a NEWER version of the app writes - is not this
  // function's business, and it projects the two it knows.
  it("reads a site as a position and ignores anything else beside it", () => {
    const view: ViewShard = {
      schema: VIEW_SCHEMA,
      map: { sites: { h_all: { x: 0, y: 0, zone: "v_docks" } as ViewPoint } },
    };
    expect(mapSites(box(view))).toEqual({ h_all: { x: 0, y: 0 } });
  });

  it("plans no write when a site lands back where it was", () => {
    const view: ViewShard = { schema: VIEW_SCHEMA, map: { sites: { h_all: { x: 8, y: 9 } } } };
    expect(planMapSites("/p", box(view), [{ id: "h_all", x: 8, y: 9 }])).toBeUndefined();
  });

  it("rounds to whole numbers", () => {
    const shard = written(planMapSites("/p", box(), [{ id: "h_all", x: 19.6, y: 40.2 }]));
    expect(shard.map?.sites?.["h_all"]).toEqual({ x: 20, y: 40 });
  });
});

describe("taking a hand off the map", () => {
  it("removes the site rather than emptying it", () => {
    const view: ViewShard = {
      schema: VIEW_SCHEMA,
      map: { sites: { h_all: { x: 1, y: 2 }, h_other: { x: 3, y: 4 } } },
    };
    const shard = written(planForgetSites("/p", box(view), ["h_all"]));
    expect(shard.map?.sites).toEqual({ h_other: { x: 3, y: 4 } });
  });

  it("drops the map block entirely when that was the last site", () => {
    // No husks: "no entry" already means "not placed" everywhere in this sidecar.
    const view: ViewShard = { schema: VIEW_SCHEMA, map: { sites: { h_all: { x: 1, y: 2 } } } };
    expect(written(planForgetSites("/p", box(view), ["h_all"]))).toEqual({ schema: VIEW_SCHEMA });
  });

  it("keeps the deck canvases beside it", () => {
    const view: ViewShard = {
      schema: VIEW_SCHEMA,
      canvases: { k_arrival: { cards: { c_gate: { x: 1, y: 2 } } } },
      map: { sites: { h_all: { x: 1, y: 2 } } },
    };
    const shard = written(planForgetSites("/p", box(view), ["h_all"]));
    expect(shard.canvases).toEqual({ k_arrival: { cards: { c_gate: { x: 1, y: 2 } } } });
  });

  it("plans no write for a hand that was never sitened", () => {
    const view: ViewShard = { schema: VIEW_SCHEMA, map: { sites: { h_all: { x: 1, y: 2 } } } };
    expect(planForgetSites("/p", box(view), ["h_nobody"])).toBeUndefined();
  });
});

describe("forgetting an arrangement", () => {
  it("removes the deck's canvas rather than emptying it", () => {
    const view: ViewShard = {
      schema: VIEW_SCHEMA,
      canvases: { k_arrival: { cards: { c_gate: { x: 20, y: 40 } } }, k_other: { cards: { c_z: { x: 0, y: 0 } } } },
    };
    const shard = written(planForgetCanvas("/p", box(view), "k_arrival"));
    expect(shard.canvases).toEqual({ k_other: { cards: { c_z: { x: 0, y: 0 } } } });
  });

  it("drops the canvases key entirely when that was the last one", () => {
    const view: ViewShard = { schema: VIEW_SCHEMA, canvases: { k_arrival: { cards: { c_gate: { x: 1, y: 1 } } } } };
    expect(written(planForgetCanvas("/p", box(view), "k_arrival"))).toEqual({ schema: VIEW_SCHEMA });
  });

  it("plans no write when there was nothing to forget", () => {
    expect(planForgetCanvas("/p", box(), "k_arrival")).toBeUndefined();
  });
});

describe("the sidecar never reaches the bundle", () => {
  it("compiles a project with an arrangement to the same bytes as one without", () => {
    // Source-only, exactly as `order` is. The runtime must not be able to tell
    // whether anybody has ever opened a canvas.
    const view: ViewShard = {
      schema: VIEW_SCHEMA,
      canvases: { k_arrival: { cards: { c_gate: { x: 20, y: 40 }, c_inn: { x: 220, y: 40 } } } },
      map: { sites: { h_all: { x: 5, y: 6 } } },
    };
    const plain = compileProject(project(box()));
    const arranged = compileProject(project(box(view)));
    expect(arranged.issues).toEqual(plain.issues);
    expect(JSON.stringify(arranged.bundle)).toBe(JSON.stringify(plain.bundle));
  });
});

// --- canvas furniture ------------------------------------------------------------
//
// What the design promises here is different from the rest of this sidecar, and
// the difference is the thing worth pinning: card positions are a sparse record
// keyed by content that moves underneath, while furniture is a short list of
// things somebody DREW. So it is written whole, and an empty canvas leaves no
// husk behind (graphical-views 3, "Frames and sites").

const REGION = { id: "r_1", x: 10, y: 20, w: 100, h: 80, title: "Act two" };

describe("canvas furniture", () => {
  it("reads back what was written, on a deck canvas", () => {
    const write = planCanvasFurniture("/p", box(), { kind: "deck", deck: "k_arrival" },
      { frames: [REGION] })!;
    const shard = parseSource(write.content) as ViewShard;
    expect(shard.canvases!["k_arrival"]!.frames).toEqual([REGION]);
    expect(canvasFurniture(box(shard), { kind: "deck", deck: "k_arrival" })).toEqual({
      frames: [REGION],
    });
  });

  it("reads back what was written, on the map", () => {
    const write = planCanvasFurniture("/p", box(), { kind: "map" }, { frames: [REGION] })!;
    const shard = parseSource(write.content) as ViewShard;
    expect(shard.map!.frames).toEqual([REGION]);
  });

  it("leaves the other canvas, the sites and the cards alone", () => {
    const before: ViewShard = {
      schema: VIEW_SCHEMA,
      canvases: { k_arrival: { cards: { c_gate: { x: 1, y: 2 } } } },
      map: { sites: { h_all: { x: 3, y: 4 } } },
    };
    const write = planCanvasFurniture("/p", box(before), { kind: "map" }, { frames: [REGION] })!;
    const shard = parseSource(write.content) as ViewShard;
    expect(shard.canvases!["k_arrival"]!.cards).toEqual({ c_gate: { x: 1, y: 2 } });
    expect(shard.map!.sites).toEqual({ h_all: { x: 3, y: 4 } });
    expect(shard.map!.frames).toEqual([REGION]);
  });

  it("writes nothing when nothing changed", () => {
    const drawn = parseSource(
      planCanvasFurniture("/p", box(), { kind: "map" }, { frames: [REGION] })!.content,
    ) as ViewShard;
    expect(planCanvasFurniture("/p", box(drawn), { kind: "map" },
      { frames: [REGION] })).toBeUndefined();
  });

  it("clearing a canvas leaves no husk", () => {
    const drawn = parseSource(
      planCanvasFurniture("/p", box(), { kind: "map" }, { frames: [REGION] })!.content,
    ) as ViewShard;
    const cleared = parseSource(
      planCanvasFurniture("/p", box(drawn), { kind: "map" }, { frames: [] })!.content,
    ) as ViewShard;
    expect(cleared.map).toBeUndefined();
  });

  it("rounds coordinates and keeps a title exactly as typed", () => {
    const write = planCanvasFurniture("/p", box(), { kind: "map" }, {
      frames: [{ ...REGION, x: 10.4, y: 19.6, w: 99.5, h: 80.2, title: "  Act two  " }],
    })!;
    const shard = parseSource(write.content) as ViewShard;
    expect(shard.map!.frames![0]).toMatchObject({ x: 10, y: 20, w: 100, h: 80 });
    expect(shard.map!.frames![0]!.title).toBe("  Act two  ");
  });

  it("drops a malformed entry rather than throwing inside a canvas", () => {
    const wonky = {
      schema: VIEW_SCHEMA,
      map: { frames: [REGION, { id: "r_bad" }, { id: "r_flat", x: 0, y: 0, w: 0, h: 10 }, "nonsense"] },
    } as unknown as ViewShard;
    expect(canvasFurniture(box(wonky), { kind: "map" }).frames).toEqual([REGION]);
  });

  it("draws back to front, and a restacked entry keeps its place", () => {
    const wonky: ViewShard = {
      schema: VIEW_SCHEMA,
      map: { frames: [{ ...REGION, id: "r_front", z: 5 }, { ...REGION, id: "r_back", z: -1 }] },
    };
    expect(canvasFurniture(box(wonky), { kind: "map" }).frames!.map((r) => r.id))
      .toEqual(["r_back", "r_front"]);
  });
});

// --- threaded comments -------------------------------------------------------------
//
// A third sidecar, and its reasons are its own: comments live apart from the
// content because they have a different AUTHOR (a reviewer annotating and a
// writer rewriting are two people at once), not because they churn. What is
// pinned here is what follows from that.

describe("threaded comments", () => {
  const withNotes = (shard?: NotesShard): SourceBox => {
    const b = box();
    return shard ? { ...b, notes: shard } : b;
  };
  const thread = (id: string, anchor: string, body: string): Comment =>
    ({ id, anchor, messages: [{ author: "Ada", ts: "2026-08-09T10:00:00.000Z", body }] });

  it("writes a thread against its anchor", () => {
    const write = planComments("/p", withNotes(), [thread("cmt_1", "c_gate", "Lands too early?")]);
    const shard = parseSource(write!.content) as NotesShard;
    expect(shard.comments).toHaveLength(1);
    expect(shard.comments![0]!.messages[0]!.author).toBe("Ada");
  });

  it("drops a thread with no messages rather than storing an empty one", () => {
    const write = planComments("/p", withNotes(), [{ id: "cmt_x", anchor: "c_gate", messages: [] }]);
    expect(write).toBeUndefined();       // nothing to write: it was the only one
  });

  // --- markers on a canvas (design/annotation.md 3) --------------------------
  //
  // A thread dropped on a canvas carries a `mark`. Which of the two kinds it is
  // follows from ONE comparison - is the subject the canvas, or something on it -
  // rather than from a second stored field that could disagree with the first.

  it("tells a canvas marker from one that follows an item", () => {
    const onCanvas = { ...thread("cmt_1", "k_arrival", "this corner is empty"), mark: { canvas: "k_arrival", x: 40, y: 60 } };
    const onCard = { ...thread("cmt_2", "c_gate", "lands too early"), mark: { canvas: "k_arrival", x: 12, y: -8 } };
    expect(markOf(onCanvas)).toEqual({ canvas: "k_arrival", x: 40, y: 60 });
    expect(markOf(onCard)).toEqual({ canvas: "k_arrival", x: 12, y: -8, item: "c_gate" });
  });

  it("has no mark for a thread opened from an editor", () => {
    expect(markOf(thread("cmt_1", "c_gate", "why is this here?"))).toBeUndefined();
  });

  it("survives a round trip through the shard, both kinds", () => {
    const marks = [
      { ...thread("cmt_1", "k_arrival", "empty here"), mark: { canvas: "k_arrival", x: 40, y: 60 } },
      { ...thread("cmt_2", "c_gate", "too early"), mark: { canvas: "k_arrival", x: 12, y: -8 } },
    ];
    const shard = parseSource(planComments("/p", withNotes(), marks)!.content) as NotesShard;
    const read = commentsOf(shard);
    expect(read.map((c) => markOf(c))).toEqual([
      { canvas: "k_arrival", x: 40, y: 60 },
      { canvas: "k_arrival", x: 12, y: -8, item: "c_gate" },
    ]);
  });

  it("rounds a marker's coordinates", () => {
    const marks = [{ ...thread("cmt_1", "k_arrival", "here"), mark: { canvas: "k_arrival", x: 39.6, y: 60.2 } }];
    const shard = parseSource(planComments("/p", withNotes(), marks)!.content) as NotesShard;
    expect(shard.comments![0]!.mark).toEqual({ canvas: "k_arrival", x: 40, y: 60 });
  });

  it("plans no write when a marker has not moved", () => {
    const marks = [{ ...thread("cmt_1", "k_arrival", "here"), mark: { canvas: "k_arrival", x: 40, y: 60 } }];
    const shard = parseSource(planComments("/p", withNotes(), marks)!.content) as NotesShard;
    expect(planComments("/p", withNotes(shard), marks)).toBeUndefined();
  });

  it("lists only the markers on the canvas asked for", () => {
    const shard: NotesShard = {
      schema: NOTES_SCHEMA,
      comments: [
        { ...thread("cmt_1", "k_arrival", "here"), mark: { canvas: "k_arrival", x: 0, y: 0 } },
        { ...thread("cmt_2", "map:b_1", "and here"), mark: { canvas: "map:b_1", x: 0, y: 0 } },
        thread("cmt_3", "c_gate", "no marker at all"),
      ],
    };
    expect(marksOn(shard, "k_arrival").map((c) => c.id)).toEqual(["cmt_1"]);
    expect(marksOn(shard, "map:b_1").map((c) => c.id)).toEqual(["cmt_2"]);
    expect(marksOn(shard, "k_other")).toEqual([]);
  });

  it("keeps the conversation when a mark is malformed, and drops only the place", () => {
    // Losing where a comment sat is a nuisance; losing what it said is not
    // acceptable. It stays readable from its subject's editor.
    const shard = {
      schema: NOTES_SCHEMA,
      comments: [
        { ...thread("cmt_1", "c_gate", "still here"), mark: { canvas: "k_arrival", x: "over there" } },
        { ...thread("cmt_2", "c_gate", "also here"), mark: { x: 1, y: 2 } },
      ],
    } as unknown as NotesShard;
    const read = commentsOf(shard);
    expect(read).toHaveLength(2);
    expect(read.map((c) => c.messages[0]!.body)).toEqual(["still here", "also here"]);
    expect(read.every((c) => c.mark === undefined)).toBe(true);
  });

  it("counts only the OPEN threads, so a badge can reach zero", () => {
    const shard: NotesShard = {
      schema: NOTES_SCHEMA,
      comments: [
        thread("cmt_1", "c_gate", "one"),
        { ...thread("cmt_2", "c_gate", "two"), resolved: true },
        thread("cmt_3", "c_inn", "three"),
      ],
    };
    expect(openThreadCounts(shard)).toEqual({ c_gate: 1, c_inn: 1 });
    expect(threadsFor(shard, "c_gate")).toHaveLength(2);   // reading shows both
  });

  it("drops a mangled thread rather than throwing", () => {
    const wonky = {
      schema: NOTES_SCHEMA,
      comments: [thread("cmt_1", "c_gate", "good"), { id: "cmt_2" }, "nonsense",
        { id: "cmt_3", anchor: "c_gate", messages: [{ body: "  " }] }],
    } as unknown as NotesShard;
    expect(commentsOf(wonky).map((c) => c.id)).toEqual(["cmt_1"]);
  });

  it("writes nothing when the threads have not changed", () => {
    const first = parseSource(planComments("/p", withNotes(), [thread("cmt_1", "c_gate", "same")])!.content) as NotesShard;
    expect(planComments("/p", withNotes(first), [thread("cmt_1", "c_gate", "same")])).toBeUndefined();
  });
});
