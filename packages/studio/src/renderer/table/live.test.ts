// The Board's Live mode, fed a fixed set of Live Link frames: the hands and
// clocks come from `board` snapshots, the journal and "Not listed · why" from
// the game's own trace events, a hello clears the table for a new run, and the
// frame a deal or play names is reported so Follow in the editor can open it.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadProjectFiles, parseProjectFiles, compileProject } from "@storylet-studio/compiler";
import type { Bundle } from "@storylet-studio/model";
import type { LiveLinkFrame } from "../../shared/api.js";
import { Table } from "./model.js";
import { createLiveRun } from "./live.js";

const exampleDir = fileURLToPath(new URL("../../../../../examples/the-hamlet.storylets", import.meta.url));

function villageBundle(): Bundle {
  const { project } = parseProjectFiles(loadProjectFiles(exampleDir));
  const { bundle } = compileProject(project!);
  if (!bundle) throw new Error("example did not compile");
  return bundle;
}

/** A run wired to the Hamlet bundle's labels, as the Board wires it. */
function villageRun(): { run: ReturnType<typeof createLiveRun>; table: Table } {
  const table = new Table(villageBundle(), 0);
  const run = createLiveRun({
    handBox: (hand) => table.hands().find((h) => h.gameId === hand)?.box,
    label: (id) => table.label(id),
  });
  return { run, table };
}

/** Two real card ids from the village, so the labels resolve. */
function twoCards(table: Table): [string, string] {
  const ids = table.bundle.boxes.flatMap((b) => b.decks.flatMap((d) => d.cards.map((c) => c.id)));
  return [ids[0]!, ids[1]!];
}

describe("the Board's Live mode", () => {
  it("takes hands and clocks from the board snapshot", () => {
    const { run } = villageRun();
    run.apply({ t: "hello", build: "match", project: "The Hamlet" });
    run.apply({ t: "board", flow: "main", hands: { "the-inn": ["arrive-at-the-village-gate"], "the-forge": [] }, turns: { village: 3 } });
    expect(run.hands).toEqual({ "the-inn": ["arrive-at-the-village-gate"], "the-forge": [] });
    expect(run.turns).toEqual({ village: 3 });
    expect(run.project).toBe("The Hamlet");
  });

  it("builds the journal from trace events, stamped with the box's clock", () => {
    const { run, table } = villageRun();
    const [a, b] = twoCards(table);
    const hand = table.hands()[0]!;
    run.apply({ t: "board", flow: "main", hands: {}, turns: { [hand.box]: 2 } });
    const applied = run.apply({ t: "trace", flow: "main", event: { type: "deal", hand: hand.gameId, cards: [
      { id: a, verdict: "dealt", priority: 1 }, { id: b, verdict: "cooldown" },
    ] } });
    expect(applied.dealt).toEqual([a]);
    run.apply({ t: "trace", flow: "main", event: { type: "play", card: a, outcome: "go", turn: 3 } });
    run.apply({ t: "trace", flow: "main", event: { type: "write", target: "@story.act", path: "story.act", value: "act-1", prev: "arrival" } });
    run.apply({ t: "trace", flow: "main", event: { type: "turns", box: hand.box, turn: 4 } });
    expect(run.log.map((e) => [e.type, e.turn, e.seq])).toEqual([
      ["deal", 2, 0], ["play", 3, 1], ["write", 3, 2], ["turns", 4, 3],
    ]);
  });

  it("answers Not listed · why for each hand from its latest deal", () => {
    const { run, table } = villageRun();
    const [a, b] = twoCards(table);
    const hand = table.hands()[0]!.gameId;
    run.apply({ t: "trace", flow: "main", event: { type: "deal", hand, cards: [{ id: a, verdict: "dealt" }, { id: b, verdict: "condition" }] } });
    expect(run.notDealt[hand]).toEqual([{ gameId: table.label(b).gameId, ...(table.label(b).title !== undefined ? { title: table.label(b).title } : {}), reason: "condition not met" }]);
    // A second deal of the same hand replaces the first's reasons.
    run.apply({ t: "trace", flow: "main", event: { type: "deal", hand, cards: [{ id: a, verdict: "capped" }, { id: b, verdict: "dealt" }] } });
    expect(run.notDealt[hand]!.map((n) => n.reason)).toEqual(["hand full (lower priority)"]);
  });

  it("reports the played card, and a hello clears the run", () => {
    const { run, table } = villageRun();
    const [a] = twoCards(table);
    run.apply({ t: "board", flow: "main", hands: { x: [a] }, turns: {} });
    expect(run.apply({ t: "trace", flow: "main", event: { type: "play", card: a, outcome: "go", turn: 1 } }).played).toBe(a);
    expect(run.log).toHaveLength(1);
    const again = run.apply({ t: "hello", build: "stale" });
    expect(again.reset).toBe(true);
    expect(run.log).toHaveLength(0);
    expect(run.hands).toEqual({});
  });

  it("ignores frames it cannot place without breaking", () => {
    const { run } = villageRun();
    const frame = { t: "trace", flow: "main", event: { type: "deal", hand: "nowhere", cards: [{ id: "ghost", verdict: "tags" }] } } as LiveLinkFrame;
    run.apply(frame);
    expect(run.log[0]!.turn).toBeUndefined();
    expect(run.notDealt["nowhere"]).toEqual([{ gameId: "ghost", reason: "its tags don't match this slice" }]);
  });

  it("names a card face by gameId for a snapshot, known or not", () => {
    const { table } = villageRun();
    const [a] = twoCards(table);
    const known = table.faceByGameId(table.label(a).gameId, "the-inn");
    expect(known.id).toBe(a);
    expect(known.from).toBe("the-inn");
    const unknown = table.faceByGameId("not-in-this-build", "the-inn");
    expect(unknown).toEqual({ id: "not-in-this-build", gameId: "not-in-this-build", from: "the-inn" });
  });
});

describe("following one participant", () => {
  it("ignores the flows it is not following, and keeps their frames out of the journal", () => {
    const run = createLiveRun({ handBox: () => "village", label: (id) => ({ gameId: id }) });
    run.follow("alice");
    run.apply({ t: "board", flow: "alice", hands: { "the-inn": ["gate"] }, turns: { village: 0 } });
    run.apply({ t: "board", flow: "bob", hands: { "the-inn": ["something-else"] }, turns: { village: 9 } });
    run.apply({ t: "trace", flow: "bob", event: { type: "turns", box: "village", turn: 9 } });

    expect(run.following).toBe("alice");
    expect(run.hands).toEqual({ "the-inn": ["gate"] });
    expect(run.turns).toEqual({ village: 0 });
    expect(run.log).toHaveLength(0);
  });

  it("follows the first flow it hears from when nobody has chosen", () => {
    const run = createLiveRun({ handBox: () => "village", label: (id) => ({ gameId: id }) });
    run.apply({ t: "trace", flow: "bob", event: { type: "turns", box: "village", turn: 1 } });
    expect(run.following).toBe("bob");
    // ...and now alice is somebody else's story.
    run.apply({ t: "trace", flow: "alice", event: { type: "turns", box: "village", turn: 5 } });
    expect(run.log).toHaveLength(1);
  });

  it("switching seeds from that flow's last board rather than showing nothing", () => {
    const run = createLiveRun({ handBox: () => "village", label: (id) => ({ gameId: id }) });
    run.follow("alice");
    run.apply({ t: "board", flow: "alice", hands: { "the-inn": ["gate"] }, turns: { village: 0 } });
    run.follow("bob", { hands: { "the-forge": ["anvil"] }, turns: { village: 4 } });

    expect(run.following).toBe("bob");
    expect(run.hands).toEqual({ "the-forge": ["anvil"] });
    expect(run.turns).toEqual({ village: 4 });
    // Alice's journal was hers; bob's starts empty rather than inheriting it.
    expect(run.log).toHaveLength(0);
  });

  it("a hello drops the follow: a new run names its own flows", () => {
    const run = createLiveRun({ handBox: () => "village", label: (id) => ({ gameId: id }) });
    run.follow("alice");
    run.apply({ t: "hello", build: "match", project: "The Hamlet" });
    expect(run.following).toBeNull();
    expect(run.project).toBe("The Hamlet");
  });
});
