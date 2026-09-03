// ---------------------------------------------------------------------------
// Compiles the example project (examples/saltmarsh.storylets) end to end:
// canonical byte round-trip, deterministic bundle output, the staleness
// gate, metadata stripping, publish-gate validation errors, and a runtime
// smoke play-through of the compiled bundle (source -> compiler -> bundle ->
// session, the whole pipeline in one test file).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  bundleIsFresh, canonicalCollections, canonicalStringify, compileProject, loadProjectFiles,
  parseProjectFiles, parseSource, serialiseBundle,
} from "../src/index.js";
import type { Issue, SourceFile, SourceProject } from "../src/index.js";
import { Engine } from "@storylet-studio/runtime";

const exampleDir = fileURLToPath(new URL("../../../examples/saltmarsh.storylets", import.meta.url));
const files = loadProjectFiles(exampleDir);

const parseOk = (input: SourceFile[]): SourceProject => {
  const { project, issues } = parseProjectFiles(input);
  expect(issues).toEqual([]);
  expect(project).toBeDefined();
  return project!;
};

const errors = (issues: Issue[]): string[] =>
  issues.filter((i) => i.severity === "error").map((i) => i.message);

describe("example project", () => {
  const source = parseOk(files);
  const { bundle, issues } = compileProject(source);

  it("compiles with no issues", () => {
    expect(issues).toEqual([]);
    expect(bundle).toBeDefined();
  });

  it("every shard is byte-canonical (the serialisation contract)", () => {
    for (const file of files) {
      expect(canonicalStringify(parseSource(file.text)), file.path).toBe(file.text);
    }
  });

  it("the bundle is deterministic", () => {
    const again = compileProject(parseOk(loadProjectFiles(exampleDir)));
    expect(serialiseBundle(again.bundle)).toBe(serialiseBundle(bundle));
  });

  it("collections are sorted by id and expressions are envelopes", () => {
    const box = bundle!.boxes[0]!;
    const deckIds = box.decks.map((d) => d.id);
    expect(deckIds).toEqual([...deckIds].sort());
    const docks = box.decks.find((d) => d.gameId === "docks")!;
    expect(box.handTemplates.map((t) => t.gameId)).toEqual(["street-hands"]);
    expect(box.hands.map((h) => h.gameId)).toEqual(["docks-street"]);
    const ambush = docks.cards.find((c) => c.gameId === "ambush-at-the-ford")!;
    expect(ambush.condition).toMatchObject({ src: "@hand.danger >= 2" });
    expect(Array.isArray(ambush.condition!.ast)).toBe(true);
    expect(bundle!.content).toMatchObject({ project: "proj_salt", version: "0.1.0" });
    expect(bundle!.content.hash).toMatch(/^[0-9a-z]{7}$/);
  });

  it("drops the authored `order` field from the bundle (but it perturbs the hash)", () => {
    const withOrder = structuredClone(source);
    const ambush = withOrder.boxes[0]!.decks[0]!.shard.cards.find((c) => c.gameId === "ambush-at-the-ford")!;
    ambush.order = -1;
    const out = compileProject(withOrder);
    expect(out.issues).toEqual([]);
    const cards = out.bundle!.boxes[0]!.decks.find((d) => d.gameId === "docks")!.cards;
    expect(cards.every((c) => !("order" in c))).toBe(true);           // inert at runtime
    expect(out.bundle!.content.hash).not.toBe(bundle!.content.hash);   // but a real source change
  });

  it("the staleness gate trips when a shard changes", () => {
    expect(bundleIsFresh(bundle!, source)).toBe(true);
    const edited = structuredClone(source);
    edited.boxes[0]!.decks[0]!.shard.cards[0]!.priority = 99;
    expect(bundleIsFresh(bundle!, edited)).toBe(false);
  });

  it("metadata: 'stripped' removes titles and purposes", () => {
    const stripped = structuredClone(source);
    stripped.project.export.metadata = "stripped";
    const result = compileProject(stripped);
    expect(errors(result.issues)).toEqual([]);
    expect(result.bundle!.metadata).toBe("stripped");
    const cards = result.bundle!.boxes[0]!.decks.flatMap((d) => d.cards);
    expect(cards.every((c) => c.title === undefined && c.purpose === undefined)).toBe(true);
    // The export setting lives in the project shard, so the hash moves with
    // it and the staleness gate stays coherent for the stripped source.
    expect(result.bundle!.content.hash).not.toBe(bundle!.content.hash);
    expect(bundleIsFresh(result.bundle!, stripped)).toBe(true);
    expect(bundleIsFresh(result.bundle!, source)).toBe(false);
  });

  it("the compiled bundle plays: deal, claims, peek, play, write-back", () => {
    const session = new Engine(bundle!, { seed: 0 }).openFlow("main");

    // Docks street (a street-hands instance, 2 slots): ambush needs
    // danger >= 2, pickpocket is market-tagged; rat-job (p1) and the
    // wildcard stranger (p0) seat.
    let docksStreet = session.deal("docks-street").map((c) => c.gameId);
    expect(docksStreet).toEqual(["rat-job", "mysterious-stranger"]);

    // The docks heat up: a raw-criteria peek respects the claims (the
    // seated cards have no free copy) and shows only the ambush.
    session.setProperty("value.v_docks.danger", 3);
    const list = session.peek("encounters", { area: "docks" });
    expect(list.cards.map((c) => c.gameId)).toEqual(["ambush-at-the-ford"]);
    expect(list.cards[0]!.fields).toEqual({ "patter-scene": "scn_ambush" });

    // Playing needs a seat (you never play a card from inside the deck):
    // take the rat job, freeing a slot, and re-deal - the ambush (p2) seats.
    session.play("c_rat_job", "accepted", "docks-street");
    expect(session.getProperty("story.visited")).toEqual(["docks"]);
    docksStreet = session.deal("docks-street").map((c) => c.gameId);
    expect(docksStreet).toEqual(["mysterious-stranger", "ambush-at-the-ford"]);

    // Outcome gates read current truth; the fight is open at reputation 0.
    // The ORDER is the author's, not the ids': the shard writes flee first, and
    // that is what a game offering these as a menu now gets. It used to be
    // id order (o_fight before o_flee), which nobody chose.
    expect(session.outcomes("c_ambush", "docks-street").map((o) => [o.gameId, o.available])).toEqual([
      ["flee", true],
      ["stand-and-fight", true],
    ]);

    // Fighting raises reputation and calms the docks (@hand write-back).
    session.play("c_ambush", "stand-and-fight", "docks-street");
    expect(session.getProperty("story.reputation")).toBe(1);
    expect(session.getProperty("value.v_docks.danger")).toBe(2);
    expect(session.board()["docks-street"]!.map((c) => c.gameId)).toEqual(["mysterious-stranger"]);
  });
});

describe("templates of play are source-only", () => {
  // The claim the whole spatial design rests on: a zone is an ordinary tag that
  // happens to carry a polygon, and the runtime never learns the map exists
  // (Reboot 6, design/graphical-views.md section 2). The compiler keeps an
  // explicit field list, so this test is what stops a future convenience spread
  // ({ ...tag }) from quietly shipping map geometry to every game that loads a
  // bundle.
  const withGeometry = (input: SourceFile[]): SourceFile[] => input.map((file) => {
    if (!file.path.endsWith("tags.storylettags")) return file;
    const shard = parseSource(file.text) as {
      groups: { templates?: unknown; tags: { templates?: unknown }[] }[];
    };
    const group = shard.groups[0]!;
    group.templates = { spatial: { map: true } };
    group.tags[0]!.templates = { spatial: { polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] } };
    return { path: file.path, text: canonicalStringify(shard) };
  });

  it("compiles a spatial group without complaint and without its geometry", () => {
    const source = parseOk(withGeometry(files));
    // The fixture has to have actually carried geometry in, or this proves nothing.
    expect(JSON.stringify(source)).toContain("polygon");

    const { bundle, issues } = compileProject(source);
    expect(errors(issues)).toEqual([]);
    expect(bundle).toBeDefined();

    const json = JSON.stringify(bundle);
    expect(json).not.toContain("polygon");
    expect(json).not.toContain("spatial");
    expect(json).not.toContain("templates");
  });
});

describe("publish-gate validation", () => {
  const shard = (path: string, value: unknown): SourceFile =>
    ({ path, text: canonicalStringify(value) });

  const minimal = (deckCards: unknown[], overrides: {
    templates?: unknown[]; hands?: unknown[]; story?: unknown[]; groups?: unknown[];
  } = {}): SourceFile[] => [
    shard("p.storyletproj", {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.0.1" },
      settings: { playAdvancesTurns: 1 },
      world: { properties: [] },
      story: { properties: overrides.story ?? [] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
    }),
    shard("b/box.storyletbox", {
      schema: "storylets/box@0",
      box: { id: "b_1", gameId: "b1", ranking: { specificity: true }, fields: [], properties: [] },
    }),
    shard("b/tags.storylettags", {
      schema: "storylets/tags@0",
      groups: overrides.groups ?? [{ id: "d_1", gameId: "d1", tags: [{ id: "v_1", gameId: "v1" }] }],
    }),
    shard("b/hands.storylethands", {
      schema: "storylets/hands@0",
      templates: overrides.templates ?? [],
      hands: overrides.hands ?? [],
    }),
    shard("b/decks/main.storyletdeck", {
      schema: "storylets/deck@0",
      deck: { id: "k_1", gameId: "main", properties: [] },
      cards: deckCards,
    }),
  ];

  const compileFiles = (input: SourceFile[]) => compileProject(parseOk(input));

  it("flags an undeclared property in a condition", () => {
    const result = compileFiles(minimal([
      { id: "c_1", gameId: "c1", condition: "@story.nope", outcomes: [] },
    ]));
    expect(errors(result.issues).join()).toContain("nope");
    expect(result.bundle).toBeUndefined();
  });

  it("refuses a redraw the engine would silently ignore", () => {
    // `redraw` is "always" | "never" | a NUMBER. A digit string matches
    // neither branch in the engine, so the cooldown is never recorded and the
    // card quietly behaves as `always`. The Village shipped sixteen of these
    // from its port and nothing said a word (2026-08-30).
    const bad = compileFiles(minimal([
      { id: "c_1", gameId: "c1", redraw: "4" as unknown as number, outcomes: [] },
    ])).issues;
    expect(errors(bad).join()).toContain("write it as the number 4");
    expect(bad.find((i) => i.severity === "error")?.field).toBe("redraw");

    // The two words and a real number all pass.
    for (const redraw of ["always", "never", 0, 3] as const) {
      const ok = compileFiles(minimal([
        { id: "c_1", gameId: "c1", redraw: redraw as never, outcomes: [] },
      ]));
      expect(errors(ok.issues)).toEqual([]);
    }

    // ...and a string that is not a number at all says what is allowed.
    const nonsense = compileFiles(minimal([
      { id: "c_1", gameId: "c1", redraw: "sometimes" as unknown as number, outcomes: [] },
    ])).issues;
    expect(errors(nonsense).join()).toContain('must be "always", "never" or a whole number');
  });

  // --- `field`: which part of the card the diagnostic is about ---------------
  //
  // The editor's problems bar jumps to the card AND opens the tab the problem
  // is on. It used to move the tab only for an outcome-scoped problem, so a
  // condition error opened whichever tab was last used - Outcomes, usually,
  // since that is where the work is (the author's report, 2026-08-30). The fix
  // was not to read the tab back out of the message but to have the compiler
  // say which field it means, so this is that contract rather than a detail.
  it("says WHICH field of a card each diagnostic is about", () => {
    const fieldOf = (issues: Issue[], contains: string): string | undefined =>
      issues.find((i) => i.message.includes(contains))?.field;

    const cond = compileFiles(minimal([
      { id: "c_1", gameId: "c1", condition: "@story.nope", outcomes: [] },
    ])).issues;
    expect(fieldOf(cond, "nope")).toBe("condition");

    const copies = compileFiles(minimal([
      { id: "c_1", gameId: "c1", copies: 0, outcomes: [] },
    ])).issues;
    expect(fieldOf(copies, "copies must be an integer")).toBe("copies");

    const fields = compileFiles(minimal([
      { id: "c_1", gameId: "c1", fields: { nosuch: "x" }, outcomes: [] },
    ])).issues;
    expect(fieldOf(fields, "card template")).toBe("fields");

    const changes = compileFiles(minimal([
      { id: "c_1", gameId: "c1", outcomes: [{ id: "o_1", gameId: "o1", changes: { "not-a-ref": "1" } }] },
    ])).issues;
    expect(fieldOf(changes, "change target")).toBe("changes");
  });

  // --- the sharing flag (design/flows.md) -----------------------------------

  it("flags the sharing flag on a @world property: @world is always shared", () => {
    const files = minimal([]);
    files[0] = shard("p.storyletproj", {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.0.1" },
      settings: { playAdvancesTurns: 1 },
      world: { properties: [{ name: "gold", type: "number", default: 0, shared: true }] },
      story: { properties: [] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
    });
    const result = compileFiles(files);
    expect(errors(result.issues).join()).toContain("@world.gold");
    expect(errors(result.issues).join()).toContain("always shared");
    expect(result.bundle).toBeUndefined();
  });

  // --- read-only @world (Reboot.md 10, ruled 2026-09-03) ---------------------
  // The story's promise about a game value: "I read this, I never write it".
  // Mirrors Patter's HostScopeDecl.writable name for name. Contract first.

  const worldProject = (props: object[], cards: object[]) => {
    const files = minimal(cards as never);
    files[0] = shard("p.storyletproj", {
      schema: "storylets/project@0",
      project: { id: "p", name: "P", version: "0.0.1" },
      settings: { playAdvancesTurns: 1 },
      world: { properties: props },
      story: { properties: [] },
      templates: {},
      export: { bundle: "dist/p.storyletsc", metadata: "full" },
    });
    return compileFiles(files);
  };
  const clock = { name: "clock", type: "number", default: 0 };
  const writesClock = [{ id: "c_1", gameId: "c1", outcomes: [{ id: "o_1", gameId: "o1", changes: { "@world.clock": "@world.clock + 1" } }] }];

  it("refuses an outcome that writes a @world property declared writable: false", () => {
    const result = worldProject([{ ...clock, writable: false }], writesClock);
    const msgs = errors(result.issues);
    expect(msgs.join()).toContain("@world.clock");
    expect(msgs.join()).toMatch(/read-only/);
    expect(result.issues.find((i) => i.message.includes("read-only"))?.field).toBe("changes");
    expect(result.bundle).toBeUndefined();
  });

  it("still lets a condition READ a read-only @world property, and carries the flag to the bundle", () => {
    const result = worldProject([{ ...clock, writable: false }],
      [{ id: "c_1", gameId: "c1", condition: "@world.clock > 3", outcomes: [] }]);
    expect(errors(result.issues)).toEqual([]);
    expect(result.bundle!.world.properties[0]).toMatchObject({ name: "clock", writable: false });
  });

  it("treats an absent flag as writable, which is every project written before the flag existed", () => {
    expect(errors(worldProject([clock], writesClock).issues)).toEqual([]);
  });

  it("ignores the flag on scopes the story owns: @story is the story's to write", () => {
    const result = compileFiles(minimal(
      [{ id: "c_1", gameId: "c1", outcomes: [{ id: "o_1", gameId: "o1", changes: { "@story.turns": "@story.turns + 1" } }] }] as never,
      { story: [{ name: "turns", type: "number", default: 0, writable: false }] } as never));
    expect(errors(result.issues)).toEqual([]);
  });

  it("carries the sharing flag through to the bundle on the scopes that take it", () => {
    const result = compileFiles(minimal([], {
      story: [{ name: "turns", type: "number", default: 0, shared: false }],
    }));
    expect(errors(result.issues)).toEqual([]);
    expect(result.bundle!.story.properties[0]).toMatchObject({ name: "turns", shared: false });
  });

  // --- state-bound groups (design/where-and-selectors.md Part B) -------------
  // Caught at publish rather than at runtime on purpose: a group bound to
  // nothing silently wildcards, so every card in the axis becomes available
  // and the fault reads as content rather than as configuration.

  const boundGroup = (boundBy: string, story: unknown[]) => minimal([], {
    story,
    groups: [{ id: "d_act", gameId: "act", boundBy, tags: [{ id: "v_a1", gameId: "act-1" }, { id: "v_a2", gameId: "act-2" }] }],
  });

  it("flags a boundBy that is not a property reference", () => {
    const result = compileFiles(boundGroup("act", [{ name: "act", type: "string", default: "act-1" }]));
    expect(errors(result.issues).join()).toContain("must be a @world or @story property reference");
  });

  it("flags a boundBy naming a property nobody declared", () => {
    const result = compileFiles(boundGroup("@story.chapter", [{ name: "act", type: "string", default: "act-1" }]));
    expect(errors(result.issues).join()).toContain("is not a declared story property");
  });

  it("flags a boundBy on a property that cannot hold a tag name", () => {
    const result = compileFiles(boundGroup("@story.act", [{ name: "act", type: "number", default: 1 }]));
    expect(errors(result.issues).join()).toContain("a state-bound group needs a string or enum");
  });

  it("flags an enum whose values can never name a tag", () => {
    const result = compileFiles(boundGroup("@story.act", [
      { name: "act", type: "enum", default: "one", values: ["one", "two"] },
    ]));
    expect(errors(result.issues).join()).toContain("can never name a tag in this group");
  });

  it("warns about the enum values that name no tag, without failing", () => {
    const result = compileFiles(boundGroup("@story.act", [
      { name: "act", type: "enum", default: "act-1", values: ["act-1", "act-2", "epilogue"] },
    ]));
    expect(errors(result.issues)).toEqual([]);
    expect(result.issues.map((i) => i.message).join()).toContain("epilogue");
    expect(result.bundle).toBeDefined();
  });

  it("carries boundBy and required into the bundle", () => {
    const result = compileFiles(minimal([], {
      story: [{ name: "act", type: "string", default: "act-1" }],
      groups: [{ id: "d_act", gameId: "act", boundBy: "@story.act", required: true, tags: [{ id: "v_a1", gameId: "act-1" }] }],
    }));
    expect(errors(result.issues)).toEqual([]);
    const group = result.bundle!.boxes[0]!.tagGroups.find((g) => g.gameId === "act")!;
    expect(group.boundBy).toBe("@story.act");
    expect(group.required).toBe(true);
  });

  it("flags a tag of an unknown tag id", () => {
    const result = compileFiles(minimal([
      { id: "c_1", gameId: "c1", tags: { d_1: ["v_missing"] }, outcomes: [] },
    ]));
    expect(errors(result.issues).join()).toContain('is not in "d1" (id v_missing)');
  });

  it("flags a place tag naming an unknown hand", () => {
    const result = compileFiles(minimal([
      { id: "c_1", gameId: "c1", tags: { place: ["h_ghost"] }, outcomes: [] },
    ]));
    expect(errors(result.issues).join()).toContain('a hand that is not in this box (id h_ghost)');
  });

  // A group gameId is always addressed through the box that owns it, so it
  // is unique WITHIN a box and boxes namespace it.
  it("flags a duplicate tag group gameId within one box", () => {
    const result = compileFiles(minimal([]).map((f) => (f.path === "b/tags.storylettags"
      ? shard("b/tags.storylettags", {
        schema: "storylets/tags@0",
        groups: [
          { id: "d_1", gameId: "zone", tags: [{ id: "v_1", gameId: "v1" }] },
          { id: "d_2", gameId: "zone", tags: [{ id: "v_2", gameId: "v2" }] },
        ],
      })
      : f)));
    expect(errors(result.issues).join()).toContain('duplicate tag group (box "b1") gameId "zone"');
  });

  it("allows the same tag group gameId in two different boxes", () => {
    const result = compileFiles([
      ...minimal([]),
      shard("c/box.storyletbox", {
        schema: "storylets/box@0",
        box: { id: "b_2", gameId: "b2", ranking: { specificity: true }, fields: [], properties: [] },
      }),
      // Same gameId "d1" as box b1's group, on its own ids.
      shard("c/tags.storylettags", {
        schema: "storylets/tags@0",
        groups: [{ id: "d_2", gameId: "d1", tags: [{ id: "v_2", gameId: "v1" }] }],
      }),
      shard("c/hands.storylethands", { schema: "storylets/hands@0", templates: [], hands: [] }),
      shard("c/decks/main.storyletdeck", {
        schema: "storylets/deck@0",
        deck: { id: "k_2", gameId: "main", properties: [] },
        cards: [],
      }),
    ]);
    expect(errors(result.issues)).toEqual([]);
    expect(result.bundle!.boxes.map((b) => b.tagGroups.map((g) => g.gameId))).toEqual([["d1"], ["d1"]]);
  });

  it("flags a duplicate id across shards", () => {
    const result = compileFiles(minimal([
      { id: "c_1", gameId: "c1", outcomes: [] },
      { id: "c_1", gameId: "c2", outcomes: [] },
    ]));
    expect(errors(result.issues).join()).toContain('duplicate id "c_1"');
  });

  it("flags a field missing from the box's card template", () => {
    const result = compileFiles(minimal([
      { id: "c_1", gameId: "c1", fields: { rogue: 1 }, outcomes: [] },
    ]));
    expect(errors(result.issues).join()).toContain('field "rogue"');
  });

  it("flags a hand pointing at a missing template", () => {
    const result = compileFiles(minimal([], {
      hands: [{ id: "h_1", gameId: "h1", template: "t_missing" }],
    }));
    expect(errors(result.issues).join()).toContain('a hand template that is not in this box (id t_missing)');
  });

  it("flags a hand with neither template nor rule (and one with both)", () => {
    const result = compileFiles(minimal([], {
      hands: [{ id: "h_1", gameId: "h1" }],
    }));
    expect(errors(result.issues).join()).toContain("exactly one of template / rule");
  });

  it("flags a template instance missing a chosen tag for a hole", () => {
    const result = compileFiles(minimal([], {
      templates: [{ id: "t_1", gameId: "t1", chooses: ["d_1"], slots: 1, properties: [] }],
      hands: [{ id: "h_1", gameId: "h1", template: "t_1" }],
    }));
    expect(errors(result.issues).join()).toContain('nothing chosen for the tag group');
  });

  it("flags a change writing to an undeclared property", () => {
    const result = compileFiles(minimal([
      { id: "c_1", gameId: "c1", outcomes: [
        { id: "o_1", gameId: "o1", changes: { "@story.ghost": "1" } },
      ] },
    ]));
    expect(errors(result.issues).join()).toContain('"@story.ghost" is not a declared property');
  });
});

describe("the parse cache", () => {
  // Parsing dominates a load (measured at 3,600 cards: reading the bytes 1.3ms,
  // parsing them 52ms), and the editor re-loads a project it has just written on
  // every save, so shards are cached by path and validated by exact text. The
  // risk that buys is aliasing: the studio EDITS the loaded project in place
  // before writing it, so a cache handing out its own object would be mutated
  // from under itself and would then answer with somebody's unsaved edits.

  it("hands out an independent copy, so a caller's edits cannot poison it", () => {
    const first = parseOk(files);
    const deck = first.boxes[0]!.decks[0]!;
    const wasTitle = deck.shard.cards[0]!.title;
    deck.shard.cards[0]!.title = "MUTATED IN PLACE";
    deck.shard.cards.push({ id: "c_intruder", priority: 0, redraw: "always", outcomes: [] });

    const second = parseOk(files);
    const sameDeck = second.boxes[0]!.decks[0]!;
    expect(sameDeck.shard.cards[0]!.title).toBe(wasTitle);
    expect(sameDeck.shard.cards.some((c) => c.id === "c_intruder")).toBe(false);

    // And again from what is now certainly a cache HIT, because that is the copy
    // somebody optimising this later would be tempted to skip.
    sameDeck.shard.cards[0]!.title = "MUTATED FROM A HIT";
    expect(parseOk(files).boxes[0]!.decks[0]!.shard.cards[0]!.title).toBe(wasTitle);
  });

  it("re-parses when the bytes change, and keeps every other shard's copy", () => {
    parseOk(files);
    const edited = files.map((f) => (f.path.endsWith("docks.storyletdeck")
      ? { ...f, text: f.text.replace('title: "Docks"', 'title: "Docks (edited)"') }
      : f));
    const project = parseOk(edited);
    const docks = project.boxes.flatMap((b) => b.decks).find((d) => d.shard.deck.id === "k_docks")!;
    expect(docks.shard.deck.title).toBe("Docks (edited)");
    // The untouched shards still parse to what they say, from the cache.
    expect(parseOk(files).boxes[0]!.box.box.id).toBe(project.boxes[0]!.box.box.id);
  });
});

// ---------------------------------------------------------------------------
// Property names, on the way in and on the way out (2026-08-18, adopted with
// Patter from one rule: app-shell property-names.ts).
//
// A reader repairs the ONE fault it can repair without guessing - a name legal
// apart from its case, which the parser folds on every reference anyway - and
// leaves everything else for the compiler to report. `is-night` is the reason
// that line is drawn there: it is not an error to expr, it is a SUBTRACTION, and
// picking `is_night` for the author would be inventing what they meant.
// ---------------------------------------------------------------------------

describe("declared property names", () => {
  const withStoryProps = (props: Array<{ name: string; type: string; default?: unknown }>): SourceFile[] =>
    files.map((f) => {
      if (!f.path.endsWith(".storyletproj")) return f;
      const shard = parseSource(f.text) as { story?: { properties?: unknown[] } };
      shard.story = { ...shard.story, properties: [...(shard.story?.properties ?? []), ...props] };
      return { ...f, text: canonicalStringify(shard) };
    });

  it("folds a name that is only wrong in its case, on read", () => {
    const source = parseOk(withStoryProps([{ name: "isNight", type: "boolean", default: false }]));
    const names = source.project.story?.properties?.map((p) => p.name) ?? [];
    expect(names).toContain("isnight");
    expect(names).not.toContain("isNight");
    // and having been repaired, it is not then reported
    expect(errors(compileProject(source).issues)).toEqual([]);
  });

  it("leaves a name that needs more than folding, and reports what it would do", () => {
    const source = parseOk(withStoryProps([{ name: "is-night", type: "boolean", default: false }]));
    expect(source.project.story?.properties?.map((p) => p.name)).toContain("is-night");
    const errs = errors(compileProject(source).issues);
    expect(errs.some((m) => m.includes('property name "is-night" cannot be used'))).toBe(true);
    expect(errs.some((m) => /subtraction/.test(m))).toBe(true);
    expect(errs.some((m) => /Try "is_night"/.test(m))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group-level tag properties (design/hand-typing.md step B).
//
// "Every zone has a haunting level" was five copies of one line, once per tag,
// because a tag's property declaration carries BOTH the schema and the value.
// A group declares now, and a tag carries only its own starting value.
//
// Compiled by FLATTENING onto each tag, so the bundle keeps the per-tag shape
// the runtimes already read: no runtime change, no port change, no bundle
// schema change. Source is DRY, the artefact is explicit.
// ---------------------------------------------------------------------------

describe("properties declared on a tag group", () => {
  /** Put `patch` on the first tag group of the saltmarsh's tags shard. */
  const withGroup = (patch: (g: Record<string, unknown>) => void): SourceFile[] =>
    files.map((f) => {
      if (!f.path.endsWith(".storylettags")) return f;
      const shard = parseSource(f.text) as { groups?: Array<Record<string, unknown>> };
      if (shard.groups?.[0]) patch(shard.groups[0]);
      return { ...f, text: canonicalStringify(shard) };
    });
  const HAUNTING = { name: "haunting", type: "number", default: 0 };
  const bundleOf = (input: SourceFile[]) => compileProject(parseOk(input));
  const tagsOf = (b: ReturnType<typeof bundleOf>) =>
    b.bundle!.boxes[0]!.tagGroups.find((g) => g.gameId === "area")!.tags;

  it("gives every tag in the group the property, at the group's default", () => {
    const r = bundleOf(withGroup((g) => { g.properties = [HAUNTING]; }));
    expect(errors(r.issues)).toEqual([]);
    for (const tag of tagsOf(r)) {
      expect(tag.properties?.find((p) => p.name === "haunting"))
        .toMatchObject({ type: "number", default: 0 });
    }
  });

  it("lets one tag start somewhere else, without restating the type", () => {
    const r = bundleOf(withGroup((g) => {
      g.properties = [HAUNTING];
      const tags = g.tags as Array<Record<string, unknown>>;
      tags.find((t) => t.gameId === "market")!.values = { haunting: 3 };
    }));
    expect(errors(r.issues)).toEqual([]);
    const byName = Object.fromEntries(tagsOf(r).map((t) => [t.gameId, t.properties?.find((p) => p.name === "haunting")?.default]));
    expect(byName["market"]).toBe(3);
    expect(byName["docks"]).toBe(0);
  });

  it("keeps a tag's own declarations alongside a group's", () => {
    const r = bundleOf(withGroup((g) => { g.properties = [HAUNTING]; }));
    // `docks` declares `danger` itself in the fixture; it keeps it and gains haunting.
    const docks = tagsOf(r).find((t) => t.gameId === "docks")!;
    expect(docks.properties?.map((p) => p.name).sort()).toEqual(["danger", "haunting"]);
  });

  it("resolves through @hand, so a card can gate on it", () => {
    const withCard = withGroup((g) => { g.properties = [HAUNTING]; }).map((f) => {
      if (!f.path.endsWith(".storyletdeck")) return f;
      const shard = parseSource(f.text) as { cards?: Array<Record<string, unknown>> };
      if (shard.cards?.[0]) shard.cards[0].condition = "@hand.haunting >= 2";
      return { ...f, text: canonicalStringify(shard) };
    });
    expect(errors(bundleOf(withCard).issues)).toEqual([]);
  });

  it("refuses the same name declared both on the group and on a tag", () => {
    const r = bundleOf(withGroup((g) => { g.properties = [{ name: "danger", type: "number", default: 0 }]; }));
    const e = errors(r.issues);
    expect(e.some((m) => /danger/.test(m) && /both/.test(m))).toBe(true);
  });

  it("refuses a value for a property the group never declared", () => {
    const r = bundleOf(withGroup((g) => {
      const tags = g.tags as Array<Record<string, unknown>>;
      tags[0]!.values = { nonesuch: 1 };
    }));
    expect(errors(r.issues).some((m) => /nonesuch/.test(m))).toBe(true);
  });

  it("refuses a value of the wrong type", () => {
    const r = bundleOf(withGroup((g) => {
      g.properties = [HAUNTING];
      const tags = g.tags as Array<Record<string, unknown>>;
      tags[0]!.values = { haunting: "loud" };
    }));
    expect(errors(r.issues).some((m) => /haunting/.test(m) && /number/.test(m))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The @hand schema, inferred (design/hand-typing.md step A).
//
// @hand is composed per ask, so it was left out of the schema and validated
// permissively, which meant a misspelt @hand name compiled clean and then
// silently never dealt: the Village's five-dead-cards failure with no static
// check able to see it. The schema is now inferred per box from what the box
// already declares, so no project has to say anything new.
//
// The saltmarsh fixture is the useful shape: one `area` group whose `docks`
// tag declares `danger: number` and whose `market` tag declares nothing.
//
// Expectations written before the inference existed.
// ---------------------------------------------------------------------------

describe("the @hand schema, inferred", () => {
  /** Put `condition` on the first card of the first deck. */
  const withCardCondition = (condition: string): SourceFile[] =>
    files.map((f) => {
      if (!f.path.endsWith(".storyletdeck")) return f;
      const shard = parseSource(f.text) as { cards?: Array<Record<string, unknown>> };
      if (shard.cards?.[0]) shard.cards[0].condition = condition;
      return { ...f, text: canonicalStringify(shard) };
    });
  const errsFor = (condition: string) => errors(compileProject(parseOk(withCardCondition(condition))).issues);

  it("resolves a tag property that only some tags declare", () => {
    expect(errsFor("@hand.danger >= 1")).toEqual([]);
  });

  it("reports a misspelt @hand name, the way every other scope already does", () => {
    const e = errsFor("@hand.dangerr >= 1");
    expect(e.length).toBeGreaterThan(0);
    expect(e.join()).toContain("dangerr");
  });

  it("knows a tag property's type, so a comparison that can never match is caught", () => {
    // `>=` already failed permissively ("requires a number"), so equality is
    // the discriminator: unknown == string is silent, number == string is not.
    const e = errsFor('@hand.danger == "high"');
    expect(e.length).toBeGreaterThan(0);
    expect(e.join()).toMatch(/never be equal|number/);
  });

  it("types the group's own name as an enum over its tags", () => {
    expect(errsFor('@hand.area == "docks"')).toEqual([]);
    const e = errsFor('@hand.area == "dokcs"');
    expect(e.length).toBeGreaterThan(0);
    expect(e.join()).toContain("dokcs");
  });

  it("reports two tags that disagree about a name, once, without a second wave at the use sites", () => {
    const disagreeing = files.map((f) => {
      if (!f.path.endsWith(".storylettags")) return f;
      const shard = parseSource(f.text) as { groups?: Array<{ tags?: Array<Record<string, unknown>> }> };
      const market = shard.groups?.[0]?.tags?.find((t) => t.gameId === "market");
      if (!market) throw new Error("the fixture needs its second tag");
      market.properties = [{ name: "danger", type: "string", default: "" }];
      return { ...f, text: canonicalStringify(shard) };
    }).map((f) => {
      // and a card that reads it, to prove the disagreement does not cascade
      if (!f.path.endsWith(".storyletdeck")) return f;
      const shard = parseSource(f.text) as { cards?: Array<Record<string, unknown>> };
      if (shard.cards?.[0]) shard.cards[0].condition = "@hand.danger >= 1";
      return { ...f, text: canonicalStringify(shard) };
    });
    const e = errors(compileProject(parseOk(disagreeing)).issues);
    expect(e.some((m) => /danger/.test(m) && /must agree/.test(m))).toBe(true);
    // one fault, one message: the name keeps its first declaration, so the
    // card reading it is not also reported as an unresolved reference
    expect(e.filter((m) => /danger/.test(m)).length).toBe(1);
  });

  // A group name in @hand is the CHOSEN TAG, which is what the ask asked for,
  // not state. The runtime has always refused the write ("is a chosen tag /
  // criteria name and cannot be written"); now that the schema knows which
  // names those are, publish refuses it first (design/hand-typing.md residues).
  it("refuses a write to a tag group's name, which is the ask and not state", () => {
    const writing = files.map((f) => {
      if (!f.path.endsWith(".storyletdeck")) return f;
      const shard = parseSource(f.text) as { cards?: Array<Record<string, unknown>> };
      const card = shard.cards?.[0] as { outcomes?: Array<Record<string, unknown>> } | undefined;
      if (card?.outcomes?.[0]) card.outcomes[0].changes = { "@hand.area": '"market"' };
      return { ...f, text: canonicalStringify(shard) };
    });
    const e = errors(compileProject(parseOk(writing)).issues);
    expect(e.some((m) => /@hand\.area/.test(m) && /chosen tag|cannot be written/.test(m))).toBe(true);
  });

  it("resolves a hand template's own properties", () => {
    const templated = files.map((f) => {
      if (!f.path.endsWith(".storylethands")) return f;
      const shard = parseSource(f.text) as { templates?: Array<Record<string, unknown>> };
      if (shard.templates?.[0]) {
        shard.templates[0].properties = [{ name: "crowding", type: "number", default: 0 }];
      }
      return { ...f, text: canonicalStringify(shard) };
    }).map((f) => {
      if (!f.path.endsWith(".storyletdeck")) return f;
      const shard = parseSource(f.text) as { cards?: Array<Record<string, unknown>> };
      if (shard.cards?.[0]) shard.cards[0].condition = "@hand.crowding >= 1";
      return { ...f, text: canonicalStringify(shard) };
    });
    expect(errors(compileProject(parseOk(templated)).issues)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Quality declarations. The ladder IS the property, so the three ways of
// declaring one that cannot work are caught at publish, in the same walk every
// declaration takes. The fourth case is scope, and it is a temporary one:
// @hand has no static types (schemaFor leaves it out, because its names are
// composed per ask), so no ordering comparison on @hand can be checked at all
// - an enum on a tag fails the same way. A tag quality would therefore be half
// a feature, `==` passing and `>=` refused, so it is turned down where it can
// be explained. design/hand-typing.md is the thread that would lift this.
// ---------------------------------------------------------------------------

describe("quality declarations", () => {
  const withStoryProps = (props: Array<Record<string, unknown>>): SourceFile[] =>
    files.map((f) => {
      if (!f.path.endsWith(".storyletproj")) return f;
      const shard = parseSource(f.text) as { story?: { properties?: unknown[] } };
      shard.story = { ...shard.story, properties: [...(shard.story?.properties ?? []), ...props] };
      return { ...f, text: canonicalStringify(shard) };
    });
  const errsFor = (props: Array<Record<string, unknown>>) => errors(compileProject(parseOk(withStoryProps(props))).issues);

  it("accepts a well-formed ladder", () => {
    expect(errsFor([{ name: "debt", type: "quality", default: "quiet", stages: ["quiet", "loud"] }])).toEqual([]);
  });

  it("refuses a quality with no stages: a quality is its ladder", () => {
    const e = errsFor([{ name: "debt", type: "quality", default: "quiet" }]);
    expect(e.some((m) => m.includes("declares no stages"))).toBe(true);
  });

  it("refuses a repeated rung, which would make the order ambiguous", () => {
    const e = errsFor([{ name: "debt", type: "quality", default: "quiet", stages: ["quiet", "loud", "quiet"] }]);
    expect(e.some((m) => m.includes('lists stage "quiet" twice'))).toBe(true);
  });

  it("refuses a default that is not on the ladder", () => {
    const e = errsFor([{ name: "debt", type: "quality", default: "silent", stages: ["quiet", "loud"] }]);
    expect(e.some((m) => m.includes("not one of its stages"))).toBe(true);
  });

  // Once @hand is typed and the ladder travels with the composed value
  // (design/hand-typing.md step C), a tag is as good a home for a quality as
  // any other scope. These two used to be refusals.
  it("accepts a quality on a tag, and gates on it through @hand", () => {
    const tagged = files.map((f) => {
      if (!f.path.endsWith(".storylettags")) return f;
      const shard = parseSource(f.text) as { groups?: Array<Record<string, unknown>> };
      const g = shard.groups?.[0];
      if (!g) throw new Error("the example needs a group to hang this on");
      g.properties = [{ name: "peril", type: "quality", default: "calm", stages: ["calm", "tense", "deadly"] }];
      return { ...f, text: canonicalStringify(shard) };
    }).map((f) => {
      if (!f.path.endsWith(".storyletdeck")) return f;
      const shard = parseSource(f.text) as { cards?: Array<Record<string, unknown>> };
      if (shard.cards?.[0]) shard.cards[0].condition = '@hand.peril >= "tense"';
      return { ...f, text: canonicalStringify(shard) };
    });
    expect(errors(compileProject(parseOk(tagged)).issues)).toEqual([]);
  });

  it("still catches a stage name that is not on the tag's ladder", () => {
    const tagged = files.map((f) => {
      if (!f.path.endsWith(".storylettags")) return f;
      const shard = parseSource(f.text) as { groups?: Array<Record<string, unknown>> };
      shard.groups![0]!.properties = [{ name: "peril", type: "quality", default: "calm", stages: ["calm", "tense"] }];
      return { ...f, text: canonicalStringify(shard) };
    }).map((f) => {
      if (!f.path.endsWith(".storyletdeck")) return f;
      const shard = parseSource(f.text) as { cards?: Array<Record<string, unknown>> };
      if (shard.cards?.[0]) shard.cards[0].condition = '@hand.peril >= "tpyo"';
      return { ...f, text: canonicalStringify(shard) };
    });
    expect(errors(compileProject(parseOk(tagged)).issues).join()).toContain("tpyo");
  });
});

// ---------------------------------------------------------------------------
// Rule 6: `cards` and `hands` are stored id-sorted, and a file that arrives in
// authored order with no `order` on any item is stamped from its position
// first, so the sort loses nothing. This is the one place the rule lives:
// format, validate, the editor's saves and the merge all go through
// canonicalStringify, which is what stops the editor and the CLI disagreeing
// about a deck's bytes (found 2026-08-21 when a save rewrote an example deck
// that validate had just called canonical).
// ---------------------------------------------------------------------------

describe("canonical collections (rule 5)", () => {
  const deck = (cards: Array<Record<string, unknown>>) => ({
    schema: "storylets/deck@0",
    deck: { id: "k_d", title: "D" },
    cards,
  });

  it("id-sorts cards and stamps order from file position when none is present", () => {
    const out = canonicalCollections(deck([{ id: "c_b", title: "B" }, { id: "c_a", title: "A" }]));
    expect(out.cards.map((c) => c.id)).toEqual(["c_a", "c_b"]);
    expect(out.cards.map((c) => c.order)).toEqual([1, 0]);
  });

  it("leaves an already sorted list untouched, orders and all", () => {
    const sorted = deck([{ id: "c_a" }, { id: "c_b" }]);
    expect(canonicalCollections(sorted)).toEqual(sorted);
    const text = canonicalStringify(sorted);
    expect(text).not.toContain("order");
  });

  it("keeps an order that is there and stamps the one that is not", () => {
    const out = canonicalCollections(deck([{ id: "c_b", order: 5 }, { id: "c_a" }]));
    expect(out.cards).toEqual([{ id: "c_a", order: 1 }, { id: "c_b", order: 5 }]);
  });

  it("is idempotent: a second pass finds nothing left to stamp", () => {
    const once = canonicalCollections(deck([{ id: "c_b" }, { id: "c_a" }]));
    expect(canonicalCollections(once)).toEqual(once);
  });

  it("reaches every collection the rule names, at any depth", () => {
    // hands AND templates in a hands shard, outcomes nested inside a card,
    // groups in a tags shard AND the tags nested inside each group.
    const hands = { schema: "storylets/hands@0", hands: [{ id: "h_z" }, { id: "h_a" }], templates: [{ id: "t_z" }, { id: "t_a" }] };
    const out = canonicalCollections(hands);
    expect(out.hands.map((h) => h.id)).toEqual(["h_a", "h_z"]);
    expect(out.templates.map((t) => t.id)).toEqual(["t_a", "t_z"]);

    const card = canonicalCollections(deck([{ id: "c_a", outcomes: [{ id: "o_z" }, { id: "o_a" }] }]));
    expect(card.cards[0]!.outcomes).toEqual([{ id: "o_a", order: 1 }, { id: "o_z", order: 0 }]);

    const tags = { schema: "storylets/tags@0", groups: [{ id: "d_z", tags: [{ id: "v_z" }, { id: "v_a" }] as Array<{ id: string; order?: number }> }, { id: "d_a", tags: [] as Array<{ id: string; order?: number }> }] };
    const sortedTags = canonicalCollections(tags);
    expect(sortedTags.groups.map((g) => g.id)).toEqual(["d_a", "d_z"]);
    expect(sortedTags.groups[1]!.tags.map((t) => t.id)).toEqual(["v_a", "v_z"]);
    expect(sortedTags.groups[1]!.tags.map((t) => t.order)).toEqual([1, 0]);
  });

  it("stamps order from position for each of the new collections too", () => {
    const card = canonicalCollections(deck([{ id: "c_a", outcomes: [{ id: "o_c" }, { id: "o_b" }, { id: "o_a" }] }]));
    // authored c, b, a; stored a, b, c; the orders say which was which
    expect(card.cards[0]!.outcomes).toEqual([
      { id: "o_a", order: 2 }, { id: "o_b", order: 1 }, { id: "o_c", order: 0 },
    ]);
  });

  it("stamps only the item that is missing an order, which is what a new one looks like", () => {
    const card = canonicalCollections(deck([{ id: "c_a", outcomes: [{ id: "o_z", order: 3 }, { id: "o_a" }] }]));
    expect(card.cards[0]!.outcomes).toEqual([{ id: "o_a", order: 1 }, { id: "o_z", order: 3 }]);
  });

  it("is what canonicalStringify writes, so format and a save agree", () => {
    const authored = deck([{ id: "c_b", title: "B" }, { id: "c_a", title: "A" }]);
    const text = canonicalStringify(authored);
    const reread = parseSource(text) as { cards: Array<{ id: string; order: number }> };
    expect(reread.cards.map((c) => c.id)).toEqual(["c_a", "c_b"]);
    expect(canonicalStringify(reread)).toBe(text);
  });

  it("never runs over a bundle, so compiled outcomes keep DISPLAY order", () => {
    // The one that would silently undo the compiler: `outcomes` and `tags` name
    // lists in the bundle as well as in a shard, and a bundle's outcomes are in
    // the order the author chose, not id order. serialiseBundle turns the pass
    // off rather than trusting it to be a no-op.
    const bundleish = { boxes: [{ id: "b", decks: [{ id: "k", cards: [{ id: "c_a",
      outcomes: [{ id: "o_stand" }, { id: "o_pay" }, { id: "o_leave" }] }] }] }] };
    const text = serialiseBundle(bundleish);
    expect(text.indexOf("o_stand")).toBeLessThan(text.indexOf("o_pay"));
    expect(text.indexOf("o_pay")).toBeLessThan(text.indexOf("o_leave"));
    expect(text).not.toContain("order");
    // and the sorting pass on its own WOULD have reordered them, which is the
    // reason the flag has to exist
    expect((canonicalCollections(bundleish) as typeof bundleish)
      .boxes[0]!.decks[0]!.cards[0]!.outcomes.map((o) => o.id))
      .toEqual(["o_leave", "o_pay", "o_stand"]);
  });
});
