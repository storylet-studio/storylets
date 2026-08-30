// The Live Link server against a fake game: nothing is honoured before a hello,
// the hello's build is judged against the project's hash (match / stale /
// unknown), one game at a time, pushBundle is gated on the build the game
// reported, frames reach the Board, and the status walks off -> listening ->
// connected -> listening -> off.

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createLiveLinkServer } from "./live-link.js";
import type { LiveLinkServer } from "./live-link.js";
import type { LiveLinkFrame, LiveLinkStatus } from "../shared/api.js";

/** A port per test, high and random, so parallel files do not collide. */
const freePort = (): number => 40000 + Math.floor(Math.random() * 20000);

interface Harness {
  server: LiveLinkServer;
  port: number;
  statuses: LiveLinkStatus[];
  frames: LiveLinkFrame[];
  hash: string | null;
  setHash(h: string | null): void;
  /** Wait until the status list satisfies `pred` (or fail after a while). */
  until(pred: () => boolean): Promise<void>;
}

function harness(hash: string | null = "h1"): Harness {
  const port = freePort();
  const statuses: LiveLinkStatus[] = [];
  const frames: LiveLinkFrame[] = [];
  const h: Harness = {
    port, statuses, frames, hash,
    server: undefined as unknown as LiveLinkServer,
    setHash(next) { h.hash = next; },
    until: (pred) => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = (): void => {
        if (pred()) { resolve(); return; }
        if (Date.now() - started > 3000) { reject(new Error("timed out waiting")); return; }
        setTimeout(tick, 10);
      };
      tick();
    }),
  };
  h.server = createLiveLinkServer({
    currentBuildHash: () => h.hash,
    onFrame: (f) => frames.push(f),
    onStatus: (s) => statuses.push(s),
    port,
  });
  return h;
}

/** A fake game: a ws client with the messages it received. */
function game(port: number): Promise<{ ws: WebSocket; received: string[]; send(o: unknown): void; close(): void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const received: string[] = [];
    ws.on("message", (d) => received.push(d.toString()));
    ws.on("open", () => resolve({ ws, received, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() }));
    ws.on("error", reject);
  });
}

const last = <T>(xs: T[]): T => xs[xs.length - 1]!;

describe("the Live Link server", () => {
  let open: Harness[] = [];
  afterEach(() => { for (const h of open) h.server.stop(); open = []; });
  const up = async (hash: string | null = "h1"): Promise<Harness> => {
    const h = harness(hash);
    open.push(h);
    h.server.start();
    await h.until(() => h.statuses.some((s) => s.state === "listening"));
    return h;
  };

  it("is off until started, then listening on its port, then off again", async () => {
    const h = harness();
    expect(h.server.status()).toEqual({ state: "off" });
    expect(h.server.isOn()).toBe(false);
    h.server.start();
    await h.until(() => h.statuses.length > 0);
    expect(last(h.statuses)).toEqual({ state: "listening", port: h.port });
    expect(h.server.isOn()).toBe(true);
    h.server.stop();
    expect(last(h.statuses)).toEqual({ state: "off" });
    expect(h.server.isOn()).toBe(false);
  });

  it("honours nothing before a hello, then judges the build: match", async () => {
    const h = await up("h1");
    const g = await game(h.port);
    g.send({ t: "board", flow: "main", hands: { a: ["x"] }, turns: { b: 1 } });
    g.send({ t: "trace", flow: "main", event: { type: "turns", box: "b", turn: 1 } });
    // A connection alone is "listening" still: no hello, no game.
    await h.until(() => h.statuses.length >= 2);
    expect(last(h.statuses).state).toBe("listening");
    expect(h.frames).toEqual([]);
    g.send({ t: "hello", v: 2, build: "h1", project: "The Hamlet", boxes: ["village"], flows: ["main"] });
    await h.until(() => last(h.statuses).state === "connected");
    expect(last(h.statuses)).toEqual({ state: "connected", port: h.port, project: "The Hamlet", build: "match", boxes: ["village"], flows: ["main"], following: "main" });
    expect(h.frames).toEqual([{ t: "hello", build: "match", project: "The Hamlet" }]);
    g.close();
    await h.until(() => last(h.statuses).state === "listening");
  });

  it("judges a different build stale, and no project hash unknown", async () => {
    const h = await up("h1");
    const g = await game(h.port);
    g.send({ t: "hello", v: 2, build: "old", flows: ["main"] });
    await h.until(() => last(h.statuses).state === "connected");
    expect(last(h.statuses)).toMatchObject({ state: "connected", build: "stale", boxes: [] });
    expect(last(h.statuses)).not.toHaveProperty("project");
    h.setHash(null);
    g.send({ t: "hello", v: 2, build: "old", flows: ["main"] });
    await h.until(() => h.statuses.filter((s) => s.state === "connected").length >= 2);
    expect(last(h.statuses)).toMatchObject({ state: "connected", build: "unknown" });
    g.close();
  });

  it("forwards board and trace frames after the hello, and keeps a snapshot for a late Board", async () => {
    const h = await up("h1");
    const g = await game(h.port);
    g.send({ t: "hello", v: 2, build: "h1", flows: ["main"] });
    g.send({ t: "board", flow: "main", hands: { "the-inn": ["gate"] }, turns: { village: 0 } });
    g.send({ t: "trace", flow: "main", event: { type: "deal", hand: "the-inn", cards: [{ id: "c1", verdict: "dealt" }] } });
    g.send({ t: "trace", flow: "main", event: { type: "play", card: "c1", outcome: "go", turn: 1 } });
    g.send({ t: "board", flow: "main", hands: { "the-inn": [] }, turns: { village: 1 } });
    g.send({ t: "trace", flow: "main", event: "not an object" });            // ignored
    g.send({ t: "board", flow: "main", hands: "nope", turns: { village: "x" } });   // malformed maps read as empty
    await h.until(() => h.frames.length >= 6);
    expect(h.frames.map((f) => f.t)).toEqual(["hello", "board", "trace", "trace", "board", "board"]);
    expect(h.frames[1]).toEqual({ t: "board", flow: "main", hands: { "the-inn": ["gate"] }, turns: { village: 0 } });
    expect(h.frames[5]).toEqual({ t: "board", flow: "main", hands: {}, turns: {} });
    const snap = h.server.snapshot();
    expect(snap.status.state).toBe("connected");
    expect(snap.boards).toEqual({ main: { hands: {}, turns: {} } });
    expect(snap.trace.map((f) => f.event.type)).toEqual(["deal", "play"]);
    g.close();
    await h.until(() => last(h.statuses).state === "listening");
    expect(h.server.snapshot()).toEqual({ status: { state: "listening", port: h.port }, boards: {}, trace: [] });
  });

  it("takes one game at a time: a new connection replaces the old", async () => {
    const h = await up("h1");
    const first = await game(h.port);
    first.send({ t: "hello", v: 1, build: "h1", project: "one" });
    await h.until(() => last(h.statuses).state === "connected");
    const second = await game(h.port);
    await new Promise<void>((resolve) => first.ws.once("close", () => resolve()));
    // The newcomer has not said hello: listening again until it does.
    await h.until(() => last(h.statuses).state === "listening");
    second.send({ t: "hello", v: 1, build: "h1", project: "two" });
    await h.until(() => last(h.statuses).state === "connected");
    expect(last(h.statuses)).toMatchObject({ project: "two" });
    second.close();
  });

  it("pushes a bundle only to a handshaken game on a different build, and marks it stale until it re-hellos", async () => {
    const h = await up("h1");
    h.server.pushBundle("h2", "{}");   // nobody connected: nothing happens
    const g = await game(h.port);
    h.server.pushBundle("h2", "{}");   // connected, no hello yet: still nothing
    g.send({ t: "hello", v: 2, build: "h1", flows: ["main"] });
    await h.until(() => last(h.statuses).state === "connected");
    h.server.pushBundle("h1", "{}");   // the game already runs this build
    await new Promise((r) => setTimeout(r, 50));
    expect(g.received).toEqual([]);
    h.setHash("h2");
    h.server.pushBundle("h2", "{\"a\":1}");
    await h.until(() => g.received.length === 1);
    expect(JSON.parse(g.received[0]!)).toEqual({ t: "bundle", v: 1, build: "h2", data: "{\"a\":1}" });
    expect(last(h.statuses)).toMatchObject({ state: "connected", build: "stale" });
    g.send({ t: "hello", v: 1, build: "h2" });
    await h.until(() => last(h.statuses).state === "connected" && (last(h.statuses) as { build?: string }).build === "match");
    h.server.pushBundle("h2", "{}");   // now in sync: not pushed again
    await new Promise((r) => setTimeout(r, 50));
    expect(g.received).toHaveLength(1);
    g.close();
  });

  it("reports an error and stays off when the port is taken", async () => {
    const a = await up("h1");
    const b = harness("h1");
    open.push(b);
    b.server = createLiveLinkServer({ currentBuildHash: () => "h1", onFrame: (f) => b.frames.push(f), onStatus: (s) => b.statuses.push(s), port: a.port });
    b.server.start();
    await b.until(() => b.statuses.some((s) => s.state === "error"));
    expect(b.server.isOn()).toBe(false);
    expect(b.server.status()).toEqual({ state: "off" });
  });
});
