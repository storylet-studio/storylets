// ---------------------------------------------------------------------------
// The shared Live Link fixture (packages/conformance/live-link/): the script
// replayed through the JS client against a fake socket, and the frames it
// sends file-snapshotted as frames.json. The JS client is the reference, so
// the fixture is GENERATED here (it cannot drift from the client) and the
// committed file must match what this run produces: regenerate with
//   npx vitest run packages/play-helpers/test/live-link-fixture.test.ts -u
// and review the diff. Each port's test host replays the same script and
// must send the same frames, compact JSON, key order and all.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Bundle } from "@storylet-studio/model";
import { Engine } from "@storylet-studio/runtime";
import type { Flow } from "@storylet-studio/runtime";
import { createLiveLink } from "../src/index.js";
import { FakeSocket } from "./fake-socket.js";

const ROOT = new URL("../../../", import.meta.url);
const FIXTURE_DIR = new URL("packages/conformance/live-link/", ROOT);

/** `flow` names which participant runs the step; absent means "main", so the
 *  single-flow half of the script reads exactly as it always did. */
type Step =
  | { op: "attach" } | { op: "open" }
  | { op: "openFlow"; flow: string } | { op: "closeFlow"; flow: string }
  | { op: "dealMany"; flow?: string; hands?: string[] }
  | { op: "deal"; flow?: string; hand: string }
  | { op: "play"; flow?: string; card: string; outcome: string; hand: string }
  | { op: "advanceTurns"; flow?: string; box: string; n?: number }
  | { op: "peek"; flow?: string; box: string; criteria?: Record<string, string>; n?: number };

interface Script {
  schema: "storylets/live-link-fixture@1";
  bundle: string;
  build: string;
  project?: string;
  seed: number;
  steps: Step[];
}

const script = JSON.parse(readFileSync(new URL("script.json", FIXTURE_DIR), "utf8")) as Script;
const bundle = JSON.parse(readFileSync(new URL(script.bundle, ROOT), "utf8")) as Bundle;

/** Replay the script: the frames the client sent, as the strings it sent them. */
function replay(): string[] {
  FakeSocket.reset();
  const link = createLiveLink({
    build: script.build,
    ...(script.project !== undefined ? { project: script.project } : {}),
    WebSocket: FakeSocket as unknown as new (url: string) => FakeSocket,
  });
  const sock = FakeSocket.last();
  const engine = new Engine(bundle, { seed: script.seed });
  engine.openFlow("main");
  const on = (step: { flow?: string }): Flow => {
    const f = engine.getFlow(step.flow ?? "main");
    if (!f) throw new Error(`the script names a closed flow "${step.flow}"`);
    return f;
  };
  for (const step of script.steps) {
    switch (step.op) {
      case "attach": link.attach(engine); break;
      case "open": sock.open(); break;
      case "openFlow": engine.openFlow(step.flow); break;
      case "closeFlow": engine.closeFlow(step.flow); break;
      case "dealMany": on(step).dealMany(step.hands); break;
      case "deal": on(step).deal(step.hand); break;
      case "play": on(step).play(step.card, step.outcome, step.hand); break;
      case "advanceTurns": on(step).advanceTurns(step.box, step.n); break;
      case "peek": on(step).peek(step.box, step.criteria, step.n); break;
    }
  }
  link.close();
  return sock.sent;
}

describe("live-link fixture", () => {
  it("the bundle the script names is the build it claims", () => {
    expect(script.schema).toBe("storylets/live-link-fixture@1");
    expect(bundle.content.hash).toBe(script.build);
  });

  it("frames.json is what the JS client sends for script.json (regenerate with -u and review)", async () => {
    const frames = replay().map((s) => JSON.parse(s) as unknown);
    await expect(JSON.stringify(frames, null, 2) + "\n")
      .toMatchFileSnapshot(fileURLToPath(new URL("frames.json", FIXTURE_DIR)));
  });

  it("each committed frame, compacted, is byte for byte what the client sent", () => {
    const committed = JSON.parse(readFileSync(new URL("frames.json", FIXTURE_DIR), "utf8")) as unknown[];
    const sent = replay();
    expect(committed.length).toBe(sent.length);
    committed.forEach((frame, i) => expect(JSON.stringify(frame)).toBe(sent[i]));
  });

  it("opens with hello then board, and every board-moving event is followed by a board", () => {
    const frames = replay().map((s) => JSON.parse(s) as { t: string; event?: { type: string } });
    expect(frames[0]?.t).toBe("hello");
    expect(frames[1]?.t).toBe("board");
    frames.forEach((f, i) => {
      if (f.t !== "trace") return;
      const moves = ["deal", "play", "evict", "turns"].includes(f.event!.type);
      expect(frames[i + 1]?.t === "board", `frame ${i} (${f.event!.type})`).toBe(moves);
    });
  });
});
