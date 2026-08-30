// The state logger (design/engine-runtimes.md 3.4): property logging is
// push-based on the PropertyBag audit hook (a write logs the moment it
// lands, engine or host); non-property state (turns / cooldowns / board)
// diffs on capture; snapshots are what a save persists.
import { describe, expect, it } from "vitest";
import { Engine } from "@storylet-studio/runtime";
import { expandBundle } from "@storylet-studio/conformance";
import { createStateLogger, diffState, snapshotState } from "../src/index.js";
import { deserializeState, serializeState } from "../src/index.js";

const bundle = expandBundle({
  story: [{ name: "gold", type: "number", default: 0 }],
  world: [{ name: "season", type: "string", default: "spring" }],
  cards: [
    { id: "c_pay", priority: 5, tags: { zone: ["docks"] },
      outcomes: [{ id: "o_go", changes: { "@story.gold": "@story.gold + 5" } }] },
  ],
  hands: [{ id: "h_seat", rule: { bindings: { zone: "docks" } }, slots: 1 }],
});

describe("snapshotState", () => {
  it("flattens the save envelope: scope paths, turns, board", () => {
    const engine = new Engine(bundle, { seed: 0 });
    const session = engine.openFlow("main");
    session.deal("seat");
    const snap = snapshotState(engine, session);
    expect(snap["story.gold"]).toBe(0);
    // @world is the HOST's container, not the envelope's: no world paths
    // here (design/flows.md - the host mounts and saves it itself).
    expect(snap["world.season"]).toBeUndefined();
    expect(snap["board:h_seat"]).toEqual(["c_pay"]);
    expect(Object.keys(snap).some((k) => k.startsWith("turn:"))).toBe(true);
  });
});

describe("createStateLogger", () => {
  it("captures a play's changes in the from -> to line format, then re-baselines", () => {
    const engine = new Engine(bundle, { seed: 0 });
    const session = engine.openFlow("main");
    session.deal("seat");
    const lines: string[] = [];
    const logger = createStateLogger(engine, session, { sink: (l) => lines.push(l), label: "[t] " });

    session.play("c_pay", "go", "seat");
    const changes = logger.capture();

    expect(changes.some((c) => c.path === "story.gold" && c.from === 0 && c.to === 5)).toBe(true);
    expect(lines).toContain("[t] story.gold: 0 -> 5");
    expect(lines.some((l) => l.startsWith("[t] board:h_seat:"))).toBe(true);   // the card left its hand
    expect(logger.capture()).toEqual([]);   // re-baselined: nothing new
  });

  it("property writes log the moment they land (push-based, the audit hook)", () => {
    const engine = new Engine(bundle, { seed: 0 });
    const session = engine.openFlow("main");
    const lines: string[] = [];
    const logger = createStateLogger(engine, session, { sink: (l) => lines.push(l) });

    // A HOST write (silent under the firing rule) still reaches the audit
    // hook, so it logs - before any capture.
    session.setProperty("story.gold", 9);
    expect(lines).toContain("story.gold: 0 -> 9");

    // Already logged and re-baselined: capture reports it once, not twice.
    const changes = logger.capture();
    expect(changes.filter((c) => c.path === "story.gold")).toEqual([
      { path: "story.gold", from: 0, to: 9 },
    ]);
    expect(lines.filter((l) => l.startsWith("story.gold:"))).toHaveLength(1);
    logger.dispose();
  });

  it("every write logs, even a round trip a diff would coalesce away", () => {
    const engine = new Engine(bundle, { seed: 0 });
    const session = engine.openFlow("main");
    const lines: string[] = [];
    const logger = createStateLogger(engine, session, { sink: (l) => lines.push(l) });
    session.setProperty("story.gold", 5);
    session.setProperty("story.gold", 0);   // back where it started
    expect(lines).toEqual(["story.gold: 0 -> 5", "story.gold: 5 -> 0"]);
    expect(logger.capture()).toHaveLength(2);
    logger.dispose();
  });

  it("dispose unhooks the auditors", () => {
    const engine = new Engine(bundle, { seed: 0 });
    const session = engine.openFlow("main");
    const lines: string[] = [];
    const logger = createStateLogger(engine, session, { sink: (l) => lines.push(l) });
    logger.dispose();
    session.setProperty("story.gold", 3);
    expect(lines).toEqual([]);
  });

  it("a load (which replaces the bags and fires no events) diffs on capture, then stays hooked", () => {
    const donorEngine = new Engine(bundle, { seed: 0 });
    donorEngine.openFlow("main").setProperty("story.gold", 42);
    const saved = serializeState(donorEngine);

    const engine = new Engine(bundle, { seed: 0 });
    const session = engine.openFlow("main");
    const lines: string[] = [];
    const logger = createStateLogger(engine, session, { sink: (l) => lines.push(l) });

    deserializeState(engine, saved);
    const changes = logger.capture();
    expect(changes.some((c) => c.path === "story.gold" && c.from === 0 && c.to === 42)).toBe(true);
    expect(lines).toContain("story.gold: 0 -> 42");

    // capture() re-mounted onto the replacement bags - the REBUILT flow's
    // included (the logger tracks the flow by name): pushes still arrive.
    engine.getFlow("main")!.setProperty("story.gold", 1);
    expect(lines).toContain("story.gold: 42 -> 1");
    logger.dispose();
  });

  it("diffState reports unset transitions with undefined", () => {
    const changes = diffState({ "story.x": 1 }, {});
    expect(changes).toEqual([{ path: "story.x", from: 1, to: undefined }]);
  });
});
