// The Table model driven against the real example project, compiled: peek a
// box's stock with criteria, read ranking keys from the trace, deal the
// board's hands, play an outcome from a hand and watch state + trace change.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadProjectFiles, parseProjectFiles, compileProject } from "@storylet-studio/compiler";
import type { Bundle } from "@storylet-studio/model";
import { Table, coerceStateInput } from "./model.js";

const exampleDir = fileURLToPath(new URL("../../../../../examples/saltmarsh.storylets", import.meta.url));

function exampleBundle(): Bundle {
  const { project } = parseProjectFiles(loadProjectFiles(exampleDir));
  const { bundle } = compileProject(project!);
  if (!bundle) throw new Error("example did not compile");
  return bundle;
}

describe("the Board model", () => {
  it("lists boxes with their tag groups, for the peek criteria pickers", () => {
    const table = new Table(exampleBundle(), 0);
    const enc = table.boxes().find((b) => b.gameId === "encounters")!;
    expect(enc.groups).toEqual([{ gameId: "area", values: ["docks", "market"] }]);
  });

  it("lists the hands the bundle declares, before anything is dealt", () => {
    const table = new Table(exampleBundle(), 0);
    const hands = table.hands();
    const docks = hands.find((h) => h.gameId === "docks-street")!;
    expect(docks).toBeDefined();
    expect(docks.template).toBe("street-hands");
    expect(docks.chosen).toEqual(["area = docks"]);
    expect(docks.slots).toBe(2);
    expect(docks.box).toBe("encounters");
  });

  it("peeks the stock with criteria and annotates the list with ranking keys", () => {
    const table = new Table(exampleBundle(), 0);
    table.session.setProperty("value.v_docks.danger", 3);
    const { dealt } = table.peek("encounters", { area: "docks" });
    const ambush = dealt.find((c) => c.gameId === "ambush-at-the-ford")!;
    expect(ambush).toBeDefined();
    expect(ambush.priority).toBe(2);
    expect(ambush.specificity).toBe(1);
    // Peeked, not dealt: nothing carries a `from` hand (the look/use rule).
    expect(dealt.every((c) => c.from === undefined)).toBe(true);
  });

  it("reports considered-but-not-listed cards with a plain reason", () => {
    const table = new Table(exampleBundle(), 0);
    // A card gated on danger: with danger low, a docks card fails its condition
    // rather than being listed, and shows up in notDealt with a reason.
    table.session.setProperty("value.v_docks.danger", 0);
    const { notDealt } = table.peek("encounters", { area: "docks" });
    expect(notDealt.length).toBeGreaterThan(0);
    for (const n of notDealt) {
      expect(typeof n.gameId).toBe("string");
      expect(n.reason.length).toBeGreaterThan(0);
    }
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
    expect(table.turn("encounters")).toBe(1);
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
    expect(rows.find((r) => r.path === "value.v_docks.danger")).toBeDefined();
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
    expect(rows.find((r) => r.path === `deck.${deck.id}.arc`))
      .toMatchObject({ label: `${deck.gameId}.arc`, stages: ["opening", "closing"], value: "opening" });
    // ...but a deck's ordinary latches stay out of the strip.
    expect(rows.find((r) => r.path === `deck.${deck.id}.seen`)).toBeUndefined();
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
