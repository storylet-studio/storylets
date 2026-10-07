// The Table model driven against the real example project, compiled: deal the
// board's hands, read a hand's latest deal back as Why not?, play an outcome
// from a hand and watch state + trace change.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { canonicalStringify, loadProjectFiles, parseProjectFiles, parseSource, compileProject } from "@storylet-studio/compiler";
import type { Bundle } from "@storylet-studio/model";
import { Table, boardRefusal, boardRegistry, coerceStateInput, loadReportNote } from "./model.js";
import type { LoadReport } from "@storylet-studio/model";
import type { BoardScopesDto } from "../../shared/api.js";

const exampleDir = fileURLToPath(new URL("../../../../../examples/saltmarsh.storylets", import.meta.url));

function exampleBundle(): Bundle {
  const { project } = parseProjectFiles(loadProjectFiles(exampleDir));
  const { bundle } = compileProject(project!);
  if (!bundle) throw new Error("example did not compile");
  return bundle;
}

describe("the Board model", () => {
  it("lists boxes with their tag groups, for the filter bar", () => {
    const table = new Table(exampleBundle(), 0);
    const enc = table.boxes().find((b) => b.gameId === "encounters")!;
    expect(enc.groups).toEqual([{ gameId: "area", values: ["docks", "market"] }]);
  });

  it("lists the hands the bundle declares, before anything is dealt", () => {
    const table = new Table(exampleBundle(), 0);
    const hands = table.hands();
    const docks = hands.find((h) => h.gameId === "docks-street")!;
    expect(docks).toBeDefined();
    // The whole slice by name: the board's filter key.
    expect(docks.tags["area"]).toBe("docks");
    expect(docks.box).toBe("encounters");
  });

  it("answers Why not? for a hand from its latest deal, the near misses apart from the cards never meant for it", () => {
    const table = new Table(exampleBundle(), 0);
    // Nothing dealt yet: there is no deal to explain.
    expect(table.whyNot("docks-street")).toBeUndefined();
    const board = table.dealAll();
    const why = table.whyNot("docks-street")!;
    const held = board.find((b) => b.hand === "docks-street")!.cards;
    expect(why.here).toBe(held.length);
    expect(why.looked).toBeGreaterThan(0);
    // The hand's own cards are neither a miss nor a mismatch.
    const listedIds = new Set([...why.couldHave, ...why.notHere].map((n) => n.gameId));
    expect(held.some((c) => listedIds.has(c.gameId))).toBe(false);
    // The market's cards were never candidates for a docks hand: set apart, never a near miss.
    expect(why.notHere.length).toBeGreaterThan(0);
    expect(why.notHere.every((n) => n.reason === "its tags don't match this slice")).toBe(true);
    expect(why.couldHave.every((n) => n.reason !== "its tags don't match this slice" && n.reason !== "dealt")).toBe(true);
    // Every card the box holds is accounted for exactly once.
    const listed = [...why.couldHave, ...why.notHere].map((n) => n.gameId);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("puts a full hand's eligible cards first among the near misses", () => {
    const table = new Table(exampleBundle(), 0);
    table.session.setProperty("value.v_docks.danger", 3); // the danger-gated docks cards open too
    table.dealAll();
    const why = table.whyNot("docks-street")!;
    const reasons = why.couldHave.map((n) => n.reason);
    const firstOther = reasons.findIndex((r) => r !== "hand full (lower priority)");
    const lastFull = reasons.lastIndexOf("hand full (lower priority)");
    expect(lastFull).toBeGreaterThanOrEqual(0); // the hand does overflow here, or this test proves nothing
    if (firstOther >= 0) expect(lastFull).toBeLessThan(firstOther);
  });

  it("deals every hand and reads the board's contents", () => {
    const table = new Table(exampleBundle(), 0);
    const board = table.dealAll();
    const docks = board.find((h) => h.hand === "docks-street")!;
    expect(docks.cards.length).toBeGreaterThan(0);
    expect(docks.cards.every((c) => c.from === "docks-street")).toBe(true);
  });

  it("playing an outcome from a hand advances the box's turn, writes state, and logs the trace", () => {
    const table = new Table(exampleBundle(), 0);
    table.session.setProperty("value.v_docks.danger", 3);
    table.dealAll();
    const outcomes = table.outcomes("c_ambush", "docks-street");
    expect(outcomes.find((o) => o.gameId === "stand-and-fight")!.available).toBe(true);

    table.session.play("c_ambush", "stand-and-fight", "docks-street");
    expect(table.clocks().find((c) => c.box === "encounters")!.turn).toBe(1);
    expect(table.session.getProperty("story.reputation")).toBe(1);
    expect(table.session.getProperty("value.v_docks.danger")).toBe(2);   // @hand write-back
    expect(table.log.some((e) => e.type === "play")).toBe(true);
    expect(table.log.some((e) => e.type === "write")).toBe(true);
  });

  it("exposes editable @world / @story / tag state rows", () => {
    const table = new Table(exampleBundle(), 0);
    const rows = table.stateRows();
    expect(rows.find((r) => r.path === "story.reputation")).toMatchObject({ scope: "story", value: 0, editable: true });
    expect(rows.find((r) => r.path === "world.danger")).toBeDefined();
    expect(rows.find((r) => r.path === "value.docks.danger")).toBeDefined();
  });

  // A tag's gameId is unique only within its group, and a group's only within
  // its box, so two boxes may each name a tag "docks" and the short address
  // names two stores. The strip then shows the box-qualified address the
  // engine takes (4.4), in the label as well as the path: two rows called
  // "docks.danger" would leave a designer poking one and watching the other.
  it("qualifies a tag two boxes name the same, in the path and on the label", () => {
    const bundle = exampleBundle();
    const first = bundle.boxes[0]!;
    const second = {
      ...first, id: "b_cellar", gameId: "cellar", title: "The cellar",
      properties: [], decks: [], handTemplates: [], hands: [],
      tagGroups: first.tagGroups.map((g) => ({
        ...g, id: `${g.id}_cellar`,
        tags: g.tags.map((t) => ({ ...t, id: `${t.id}_cellar` })),
      })),
    };
    const table = new Table({ ...bundle, boxes: [...bundle.boxes, second] }, 0);
    const rows = table.stateRows();
    expect(rows.find((r) => r.path === "value.docks.danger")).toBeUndefined();
    expect(rows.find((r) => r.path === "value.encounters/docks.danger"))
      .toMatchObject({ label: "encounters/docks.danger" });
    expect(rows.find((r) => r.path === "value.cellar/docks.danger"))
      .toMatchObject({ label: "cellar/docks.danger" });
    // And the address the strip shows is one the engine takes: the two rows
    // are two stores, which is the whole reason they are told apart.
    table.session.setProperty("value.cellar/docks.danger", 7);
    expect(table.session.getProperty("value.encounters/docks.danger")).toBe(0);
    expect(table.session.getProperty("value.cellar/docks.danger")).toBe(7);
  });

  // The raw-state fold shows a quality as its LADDER with the current rung
  // marked (design/quality.md section 4), so the row has to carry the stages.
  // Deck qualities join the strip: a spine is exactly the state a tester
  // jumps around ("what do the late cards look like?"), where a deck's
  // booleans are latches play sets, and listing all of those would bury the
  // strip. Expectations written before the model change.
  it("a quality row carries its ladder, and deck spines join the strip", () => {
    const bundle = exampleBundle();
    bundle.story.properties.push({ name: "mood", type: "quality", default: "low", stages: ["low", "high"] });
    const deck = bundle.boxes[0]!.decks[0]!;
    deck.properties = [
      { name: "arc", type: "quality", default: "opening", stages: ["opening", "closing"] },
      { name: "seen", type: "boolean", default: false },
    ];
    const table = new Table(bundle, 0);
    const rows = table.stateRows();
    expect(rows.find((r) => r.path === "story.mood")).toMatchObject({ stages: ["low", "high"], value: "low", editable: true });
    expect(rows.find((r) => r.path === `deck.${deck.gameId}.arc`))
      .toMatchObject({ label: `${deck.gameId}.arc`, stages: ["opening", "closing"], value: "opening" });
    // ...but a deck's ordinary latches stay out of the strip.
    expect(rows.find((r) => r.path === `deck.${deck.gameId}.seen`)).toBeUndefined();
    // a non-quality row has no stages field at all
    expect(rows.find((r) => r.path === "story.reputation")?.stages).toBeUndefined();
  });

  it("hands carry their bound tags, the board's filter key", () => {
    const table = new Table(exampleBundle(), 0);
    const docks = table.hands().find((h) => h.gameId === "docks-street")!;
    expect(docks.tags).toEqual({ area: "docks" });
  });

  it("the turn dial: nextTurn advances every box's clock together", () => {
    const table = new Table(exampleBundle(), 0);
    expect(table.clocks()).toEqual([{ box: "encounters", turn: 0 }]);
    table.nextTurn();
    expect(table.clocks()).toEqual([{ box: "encounters", turn: 1 }]);
    // The session log records the passage of time (a journal row).
    expect(table.log.some((e) => e.type === "turns" && e.turn === 1)).toBe(true);
  });

  // A NEW RUN (design/engine-server.md 4.2): the world restarts and the durable
  // half comes with it. Written against the model rather than the window
  // because this is where the act lives; the Board's button only calls it.
  const durableBundle = (): Bundle => {
    const bundle = exampleBundle();
    // Two pockets and one run-scoped value, all on @story so one setProperty
    // reaches each: "reputation" is already there and is not durable.
    bundle.story.properties.push(
      { name: "visits", type: "number", default: 0, shared: false, durable: true },
      { name: "trolls", type: "number", default: 0, shared: true, durable: true },
    );
    // Every card spent for good, and one of them durable: exactly the table in
    // 4.2, where only a `never` spend crosses the run boundary and `durable`
    // is what decides whether this one does.
    for (const box of bundle.boxes) {
      for (const deck of box.decks) {
        for (const card of deck.cards) {
          card.redraw = "never";
          if (card.gameId === "rat-job") card.durable = true;
        }
      }
    }
    return bundle;
  };
  /** Play out the whole hand, and say which card ids went. */
  const playOut = (table: Table, hand: string): string[] => {
    const played: string[] = [];
    for (;;) {
      const card = table.dealAll().find((h) => h.hand === hand)?.cards[0];
      if (card === undefined) break;
      table.play(card.id, table.outcomes(card.id, hand)[0]!.gameId, hand);
      played.push(card.id);
    }
    return played;
  };
  const idOf = (bundle: Bundle, gameId: string): string =>
    bundle.boxes.flatMap((b) => b.decks).flatMap((d) => d.cards).find((c) => c.gameId === gameId)!.id;

  it("a new run keeps the durable values and resets the rest", () => {
    const table = new Table(durableBundle(), 0);
    table.session.setProperty("story.reputation", 4);
    table.session.setProperty("story.visits", 7);
    table.session.setProperty("story.trolls", 2);
    table.nextTurn();

    table.newRun();

    expect(table.session.getProperty("story.visits")).toBe(7);    // the pocket
    expect(table.session.getProperty("story.trolls")).toBe(2);    // the installation's memory
    expect(table.session.getProperty("story.reputation")).toBe(0);   // run-scoped: back to its default
    expect(table.clocks().every((c) => c.turn === 0)).toBe(true);
    expect(table.log).toEqual([]);
  });

  it("a new run carries a durable never-spend and forgets an ordinary one", () => {
    const bundle = durableBundle();
    const durable = idOf(bundle, "rat-job");
    const table = new Table(bundle, 0);
    const played = playOut(table, "docks-street");
    expect(played).toContain(durable);
    expect(played.length).toBeGreaterThan(1);   // or there is nothing to forget

    table.newRun();
    expect(Object.keys(table.saveFile().engine.flows["main"]!.cooldowns)).toEqual([durable]);

    // And the board deals afresh from what is left: the durable card stays
    // played, the ordinary ones come back.
    const dealt = new Set(table.dealAll().flatMap((h) => h.cards.map((c) => c.id)));
    expect(dealt.has(durable)).toBe(false);
    expect([...dealt].some((id) => played.includes(id))).toBe(true);
  });

  it("@world is the host's: neither a new run nor a restart is the engine's business", () => {
    const table = new Table(durableBundle(), 0);
    table.session.setProperty("world.danger", 3);
    table.newRun();
    expect(table.session.getProperty("world.danger")).toBe(3);
  });

  it("coerces poked state values", () => {
    expect(coerceStateInput("3")).toBe(3);
    expect(coerceStateInput("true")).toBe(true);
    expect(coerceStateInput("elder")).toBe("elder");
  });
});

describe("a project that names another engine's scope", () => {
  it("is refused as the Board opens it, and the Board explains why in its own terms", () => {
    const bundle = { ...exampleBundle(), externalScopes: ["patter"] };
    let message = "";
    try { new Table(bundle, 0); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/^this content names @patter, /);
    const shown = boardRefusal(message);
    expect(shown.startsWith("This project names @patter, which another engine provides.")).toBe(true);
    expect(shown.endsWith(message)).toBe(true);
  });

  it("leaves any other failure in the engine's own words", () => {
    expect(boardRefusal("unknown box \"x\"")).toBe("unknown box \"x\"");
  });
});

// The game's shared scopes folder (patterkit design/shared-scopes.md, decision 4): where the
// game shares its scopes, the Board stands the other engines in from their declared defaults,
// so content naming `@patter` plays. The engine then sits on a registry of the Board's, which
// keeps every property value out of `saveGame()`, so Save state has to carry them itself.
describe("standing the other engines in", () => {
  /** The example, with the rat job gated on Patter's visits and its outcome counting one. */
  function patterBundle(): Bundle {
    const files = loadProjectFiles(exampleDir).map((f) => {
      if (!f.path.endsWith("docks.storyletdeck")) return f;
      const v = parseSource(f.text) as { cards: { id: string; condition?: string; outcomes: { changes?: Record<string, string> }[] }[] };
      const card = v.cards.find((c) => c.id === "c_rat_job")!;
      card.condition = "@patter.visits >= 1";
      card.outcomes[0]!.changes = { ...card.outcomes[0]!.changes, "@patter.visits": "@patter.visits + 1" };
      return { ...f, text: canonicalStringify(v) };
    });
    const { bundle, issues } = compileProject(parseProjectFiles(files).project!);
    if (!bundle) throw new Error(issues.map((i) => i.message).join("; "));
    return bundle;
  }
  const scopes: BoardScopesDto = {
    spec: { version: 1, scopes: [{ token: "patter", declarations: [{ name: "visits", type: "number", default: 1 }] }] },
    owners: { patter: { owner: "Patter", fileName: "patter.scopes.json" } },
  };

  it("plays content naming @patter, from Patter's declared defaults, with @world from the bundle", () => {
    const table = new Table(patterBundle(), 0, scopes);
    expect(table.registry!.get("patter", "visits")).toBe(1);
    expect(table.registry!.get("world", "danger")).toBe(0);
    const docks = table.dealAll().find((h) => h.hand === "docks-street")!;
    expect(docks.cards.map((c) => c.gameId)).toContain("rat-job");
    table.play("c_rat_job", "accepted", "docks-street");
    expect(table.registry!.get("patter", "visits")).toBe(2);
  });

  it("the State tab lists the stood-in properties, and a poke moves them", () => {
    const table = new Table(patterBundle(), 0, scopes);
    const row = table.stateRows().find((r) => r.path === "patter.visits")!;
    expect(row).toMatchObject({ label: "visits", scope: "patter", value: 1, editable: true });
    table.session.setProperty("patter.visits", 0);
    expect(table.stateRows().find((r) => r.path === "patter.visits")!.value).toBe(0);
    expect(table.dealAll().find((h) => h.hand === "docks-street")!.cards.map((c) => c.gameId)).not.toContain("rat-job");
  });

  it("Save state and Restore carry the registry's values, which saveGame leaves out", () => {
    const table = new Table(patterBundle(), 0, scopes);
    table.dealAll();
    table.play("c_rat_job", "accepted", "docks-street");
    table.session.setProperty("world.danger", 3);
    const file = table.saveFile();
    expect(file.registry!["patter"]).toEqual({ visits: 2 });

    const again = new Table(patterBundle(), 0, scopes);
    again.loadFile(JSON.parse(JSON.stringify(file)));
    expect(again.registry!.get("patter", "visits")).toBe(2);
    expect(again.session.getProperty("story.visited")).toEqual(["docks"]);
    expect(again.session.getProperty("world.danger")).toBe(3);
  });

  it("a project that names no other engine runs alone, as it always has", () => {
    const table = new Table(exampleBundle(), 0, scopes);
    expect(table.registry).toBeUndefined();
    expect(boardRegistry(exampleBundle(), scopes)).toBeUndefined();
    expect("registry" in table.saveFile()).toBe(false);
  });

  it("without the folder it is refused, and the Board says how to share scopes", () => {
    let message = "";
    try { new Table(patterBundle(), 0); } catch (e) { message = (e as Error).message; }
    const shown = boardRefusal(message);
    expect(shown).toMatch(/File > Share Scopes with Other Tools makes a game-scopes folder\. Once that holds patter\.scopes\.json, which Patterpad and the patter CLI write when they save, the Board stands @patter in/);
    expect(shown.endsWith(message)).toBe(true);
  });

  it("with a folder that declares nobody's @patter, it names the file that should", () => {
    const empty: BoardScopesDto = { spec: { version: 1, scopes: [{ token: "player" }] }, owners: { player: { owner: "Game", fileName: "game.scopes.json" } } };
    let message = "";
    try { new Table(patterBundle(), 0, empty); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/^this content names @patter, /);
    expect(boardRefusal(message, empty)).toMatch(/^This project names @patter, which another engine provides\. The Board stands other engines in from the game's shared scopes, but no file in game-scopes declares @patter\. It belongs in patter\.scopes\.json/);
    const game = boardRefusal("this content names @player, which no engine on this registry registered: give every engine the game's one registry", empty);
    expect(game).toMatch(/It belongs in game\.scopes\.json, the game's own scopes/);
  });
});

describe("a restore's cost (the Board's toast after a restore)", () => {
  const exact: LoadReport = {
    exact: true, project: "p", version: { saved: "1", bundle: "1" }, hash: { saved: "a", bundle: "a" }, flows: ["main"],
    evicted: [], droppedCooldowns: [], droppedSpent: [], droppedProperties: [], defaultedProperties: [], retypedProperties: [],
  };

  it("says nothing when the save went back as it was, or only its build differs", () => {
    expect(loadReportNote(exact)).toBeUndefined();
    expect(loadReportNote({ ...exact, exact: false, hash: { saved: "a", bundle: "b" } })).toBeUndefined();
  });

  it("names what was dropped, defaulted and reset, and counts the cards that left", () => {
    expect(loadReportNote({
      ...exact, exact: false,
      evicted: [{ flow: "main", hand: "docks-street", card: "ambush", reason: "vanished" }],
      droppedProperties: [{ path: "story.gold" }],
      defaultedProperties: [{ path: "story.heat" }, { path: "world.rain" }],
    })).toBe("The save didn't fit this build exactly. 1 card left its hand, @story.gold was dropped, and @story.heat and @world.rain took their defaults.");
  });

  it("counts properties when there are many", () => {
    const many = ["a", "b", "c", "d"].map((n) => ({ path: `story.${n}` }));
    expect(loadReportNote({ ...exact, exact: false, retypedProperties: many }))
      .toBe("The save didn't fit this build exactly. 4 properties no longer fit and were reset.");
  });

  it("is what Restore hands back: a save from the same build restores exactly", () => {
    const table = new Table(exampleBundle(), 0);
    table.dealAll();
    const report = new Table(exampleBundle(), 0).loadFile(JSON.parse(JSON.stringify(table.saveFile())));
    expect(report.exact).toBe(true);
    expect(loadReportNote(report)).toBeUndefined();
  });
});

describe("a game's card by its gameId (Live mode)", () => {
  it("finds the bundle's card, and still gives an unknown one a face", () => {
    const table = new Table(exampleBundle(), 0);
    const gameId = table.label("c_ambush").gameId;
    expect(gameId).not.toBe("c_ambush");   // the hop under test is a real one
    expect(table.faceByGameId(gameId, "docks-street")).toMatchObject({ id: "c_ambush", gameId, from: "docks-street" });
    expect(table.faceByGameId("not-in-this-build", "docks-street")).toEqual({ id: "not-in-this-build", gameId: "not-in-this-build", from: "docks-street" });
  });
});
