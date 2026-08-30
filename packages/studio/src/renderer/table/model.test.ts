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

  it("coerces poked state values", () => {
    expect(coerceStateInput("3")).toBe(3);
    expect(coerceStateInput("true")).toBe(true);
    expect(coerceStateInput("elder")).toBe("elder");
  });
});
