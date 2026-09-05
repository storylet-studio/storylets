// ---------------------------------------------------------------------------
// The shared wire fixture (packages/conformance/wire/), spec 6.1 and 13.
//
// The same idiom as `packages/conformance/live-link/`, one product up: a
// SCRIPT of client actions, committed by hand, and the FRAMES that script
// produces, generated here and committed beside it. The JS client is the
// reference, so the fixture cannot drift from it; the server's own suite
// replays the script and must accept exactly these requests and produce
// exactly these events, and a divergence fails on the first byte.
//
// Regenerate with
//   npx vitest run packages/client/test/wire-fixture.test.ts -u
// and review the diff, exactly as the Live Link's fixture is regenerated.
//
// Determinism, since a snapshot demands it: the `Idempotency-Key` minter is
// injected (a counter), the fake server's ids and tickets are counters, and
// its clock is one fixed instant. Nothing in a frame is random, and the
// BEARER is recorded by kind rather than by value, so a fixture can never
// carry a real key. A credential inside a request BODY stays, because the
// shape of `handshake` is part of what this pins; the value is the fake
// server's own invention.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { WireEvent } from "@storylet-studio/wire";
import { createClient } from "../src/index.js";
import type { EventSourceCtor, EventSourceLike, FetchLike } from "../src/index.js";
import { createFakeServer, manualTimers } from "./fake-server.js";

const FIXTURE_DIR = new URL("../../conformance/wire/", import.meta.url);

type Step =
  | { op: "hello" }
  | { op: "mint"; installation: string; callSign?: boolean }
  | { op: "handshake" }
  | { op: "deal"; hands?: string[] }
  | { op: "emit"; event: Record<string, unknown> }
  | { op: "play"; card: string; outcome: string; hand: string }
  | { op: "drop" }
  | { op: "reconnect" };

interface Script {
  schema: "storylets/wire-fixture@1";
  wire: string;
  base: string;
  stationKey: string;
  note?: string;
  steps: Step[];
}

/** One frame: `out` is a request the client made, `in` an event it consumed. */
type Frame =
  | { out: { method: string; path: string; bearer: string; idempotencyKey?: string; body?: unknown } }
  | { in: WireEvent };

const script = JSON.parse(readFileSync(new URL("script.json", FIXTURE_DIR), "utf8")) as Script;

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** Run the script, recording every frame in the order it crossed the wire. */
async function replay(): Promise<Frame[]> {
  const server = createFakeServer({ base: script.base, stationKey: script.stationKey });
  const timers = manualTimers();
  const frames: Frame[] = [];

  const bearerKind = (auth: string | undefined): string => {
    if (auth === undefined) return "none";
    return auth === `Bearer ${script.stationKey}` ? "station" : "party";
  };

  // Requests are recorded HERE rather than read off the fake server, so the
  // fixture describes what the client sent and not what a server chose to
  // remember about it.
  const recording: FetchLike = (url, init) => {
    const idem = init.headers["Idempotency-Key"];
    frames.push({
      out: {
        method: init.method,
        path: url.startsWith(script.base) ? url.slice(script.base.length) : url,
        bearer: bearerKind(init.headers["Authorization"]),
        ...(idem !== undefined ? { idempotencyKey: idem } : {}),
        ...(init.body !== undefined ? { body: JSON.parse(init.body) as unknown } : {}),
      },
    });
    return server.fetch(url, init);
  };

  // The stream is a GET the client opens itself, so it is a frame too: the
  // ticket in the query is the whole of 6.2, and `last` is the resume.
  const Recorded: EventSourceCtor = class implements EventSourceLike {
    private readonly inner: EventSourceLike;
    constructor(url: string) {
      frames.push({
        out: {
          method: "GET",
          path: url.startsWith(script.base) ? url.slice(script.base.length) : url,
          bearer: "ticket",
        },
      });
      this.inner = new server.EventSource(url);
    }
    addEventListener(type: "open" | "error", listener: () => void): void;
    addEventListener(type: "message", listener: (ev: { data: unknown; lastEventId?: string }) => void): void;
    addEventListener(type: string, listener: (arg: never) => void): void {
      (this.inner.addEventListener as (t: string, l: (arg: never) => void) => void)(type, listener);
    }
    close(): void { this.inner.close(); }
  };

  const client = createClient({
    base: script.base,
    fetch: recording,
    EventSource: Recorded,
    timers,
    newIdempotencyKey: (() => { let n = 0; return () => `key-${++n}`; })(),
  });
  const station = client.connectStation(script.stationKey);
  station.on((event) => frames.push({ in: event }));

  let token = "";
  for (const step of script.steps) {
    switch (step.op) {
      case "hello":
        await station.hello();
        break;
      case "mint": {
        const minted = await station.mintParty({
          installation: step.installation,
          ...(step.callSign === true ? { callSign: true } : {}),
        });
        token = minted.token;
        break;
      }
      case "handshake":
        await station.handshake({ credential: "token", token });
        break;
      case "deal":
        await station.visit?.deal(step.hands);
        break;
      case "emit":
        server.emit(step.event as never);
        break;
      case "play":
        await station.visit?.play(step.card, step.outcome, step.hand);
        break;
      case "drop":
        server.drop();
        break;
      case "reconnect":
        timers.advance(1000);
        await settle();
        await settle();
        break;
    }
    await settle();
  }
  station.close();
  return frames;
}

describe("the wire fixture", () => {
  it("the script is the schema it claims, and the protocol this package speaks", () => {
    expect(script.schema).toBe("storylets/wire-fixture@1");
    expect(script.wire).toBe("storyletengine/wire@1");
  });

  it("frames.json is what the client sends and consumes for script.json (regenerate with -u)", async () => {
    const frames = await replay();
    await expect(JSON.stringify(frames, null, 2) + "\n")
      .toMatchFileSnapshot(fileURLToPath(new URL("frames.json", FIXTURE_DIR)));
  });

  it("records the bearer by kind, so no key can ever reach the fixture", async () => {
    const frames = await replay();
    const text = JSON.stringify(frames);
    expect(text).not.toContain(script.stationKey);
    expect(text).not.toContain("Bearer ");
  });

  it("every mutation carries a key, and the resume carries the last event id", async () => {
    const frames = await replay();
    const out = frames.flatMap((f) => ("out" in f ? [f.out] : []));
    // `hello` and `stream-ticket` are POSTs that change nothing, so neither is
    // a mutation and neither carries a key. Everything else does.
    const readOnlyPosts = new Set(["/v1/hello", "/v1/stream-ticket"]);
    for (const call of out) {
      if (call.method === "GET" || readOnlyPosts.has(call.path)) continue;
      expect(call.idempotencyKey, call.path).toBeTruthy();
    }
    const streams = out.filter((c) => c.path.startsWith("/v1/events"));
    expect(streams).toHaveLength(2);
    expect(streams[0]?.path).not.toContain("last=");
    // The reconnect resumes: a fresh EventSource has no Last-Event-ID header
    // of its own to send, so the client carries the value in the query.
    expect(streams[1]?.path).toContain("last=");
  });

  it("is small enough to read, which is what makes it a contract", async () => {
    const frames = await replay();
    expect(frames.length).toBeLessThan(40);
  });
});
