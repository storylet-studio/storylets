// previewLoad and previewFlowRestore are PURE, and this is where that is held.
//
// The corpus pins what a report SAYS, in four runtimes. What it cannot pin
// cheaply is the negative claim underneath the feature: that asking the
// question costs nothing. A preview walks the same code the load walks, so the
// day somebody moves a write across the dryRun branch by accident, the corpus
// still passes - the report is right, the engine is quietly different. So:
// serialise the engine, ask, serialise again, compare the bytes.
//
// The real Hamlet bundle, because a fixture with one box and no state cannot
// tell a pure walk from a lucky one.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/index.js";

const bundle = () => JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../packages/play-helpers/demo/the-hamlet.storyletsc", import.meta.url)), "utf8"));

/** An engine mid-play: a dealt hand, a played card, a second flow. */
const playing = (): Engine => {
  const engine = new Engine(bundle(), { seed: 7 });
  const main = engine.openFlow("main");
  const dealt = main.deal("the-inn");
  const outcome = main.outcomes(dealt[0]!.gameId, "the-inn").find((o) => o.available);
  if (outcome) main.play(dealt[0]!.gameId, outcome.gameId, "the-inn");
  engine.openFlow("second").deal("the-inn");
  return engine;
};

describe("previewLoad", () => {
  it("leaves the engine byte-identical", () => {
    const source = playing();
    const envelope = source.saveGame();

    const target = playing();
    const before = JSON.stringify(target.saveGame());
    const report = target.previewLoad(envelope);
    expect(JSON.stringify(target.saveGame())).toBe(before);
    // And it really did answer: the flows it would restore are the save's.
    expect(report.flows).toEqual(["main", "second"]);
  });

  it("refuses a foreign project, exactly as loadGame refuses it", () => {
    const engine = new Engine(bundle(), { seed: 7 });
    const envelope = engine.saveGame();
    envelope.content = { ...envelope.content, project: "somebody-else" };
    expect(() => engine.previewLoad(envelope)).toThrow(/somebody-else/);
    expect(() => engine.loadGame(envelope)).toThrow(/somebody-else/);
  });

  it("says the same thing loadGame goes on to do", () => {
    const envelope = playing().saveGame();
    const target = playing();
    const preview = target.previewLoad(envelope);
    expect(target.loadGame(envelope)).toEqual(preview);
  });
});

describe("previewFlowRestore", () => {
  it("leaves the engine byte-identical", () => {
    const engine = playing();
    const parked = engine.saveFlow("main");
    const before = JSON.stringify(engine.saveGame());
    engine.previewFlowRestore("main", parked);
    expect(JSON.stringify(engine.saveGame())).toBe(before);
  });

  it("says the same thing the restore goes on to do", () => {
    const engine = playing();
    const parked = engine.saveFlow("main");
    engine.closeFlow("main");
    const preview = engine.previewFlowRestore("main", parked);
    let applied: unknown;
    engine.openFlow("main", { restore: parked, onRestoreReport: (r) => { applied = r; } });
    expect(applied).toEqual(preview);
  });
});

describe("saveFlow", () => {
  it("refuses a name that is not open", () => {
    const engine = playing();
    expect(() => engine.saveFlow("nobody")).toThrow(/unknown flow "nobody"/);
    engine.closeFlow("main");
    expect(() => engine.saveFlow("main")).toThrow(/unknown flow "main"/);
  });

  it("hands back a copy: playing on does not edit the parked blob", () => {
    const engine = playing();
    const parked = engine.saveFlow("main");
    const boardBefore = JSON.stringify(parked.board);
    engine.getFlow("main")!.deal("the-inn");
    expect(JSON.stringify(engine.saveFlow("main").board)).not.toBe("");
    expect(JSON.stringify(parked.board)).toBe(boardBefore);
  });
});
