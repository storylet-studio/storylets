// ---------------------------------------------------------------------------
// The Live Link client against a fake socket (design/live-link.md, "The
// protocol, exactly"): hello first, frames queue until the socket opens, a
// board snapshot after the hello and after every board-moving trace event,
// setBuild re-hellos, only a well-formed bundle frame reaches onBundle, no
// WebSocket at all is a no-op, and nothing ever throws into the game.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "@storylet-studio/runtime";
import { expandBundle } from "@storylet-studio/conformance";
import { boardFrame, createLiveLink } from "../src/index.js";
import { FakeSocket } from "./fake-socket.js";

const bundle = expandBundle({
  story: [{ name: "gold", type: "number", default: 0 }],
  cards: [
    { id: "c_a", priority: 2, tags: { zone: ["docks"] }, outcomes: [{ id: "o_go", changes: { "@story.gold": "7" } }] },
    { id: "c_b", priority: 1, tags: { zone: ["docks"] }, outcomes: [{ id: "o_go" }] },
  ],
  hands: [{ id: "h_seat", rule: { bindings: { zone: "docks" } }, slots: 1 }],
});

const WS = FakeSocket as unknown as new (url: string) => FakeSocket;
const link = (extra: Partial<Parameters<typeof createLiveLink>[0]> = {}) =>
  createLiveLink({ build: "B1", project: "Test", WebSocket: WS, ...extra });

beforeEach(() => FakeSocket.reset());

describe("createLiveLink", () => {
  it("connects to ws://127.0.0.1:4472 by default", () => {
    link();
    expect(FakeSocket.last().url).toBe("ws://127.0.0.1:4472");
    link({ url: "ws://127.0.0.1:9999" });
    expect(FakeSocket.last().url).toBe("ws://127.0.0.1:9999");
  });

  it("sends hello first, then the board queued by attach, once the socket opens", () => {
    const l = link();
    const sock = FakeSocket.last();
    const sessionEngine = new Engine(bundle, { seed: 0 });
    const session = sessionEngine.openFlow("main");
    l.attach(sessionEngine);
    session.deal("seat");                 // a trace event before the socket is open: queued
    expect(sock.sent).toEqual([]);

    sock.open();
    expect(sock.kinds()).toEqual(["hello", "board", "trace", "board"]);
    expect(sock.frames()[0]).toEqual({ t: "hello", v: 2, build: "B1", flows: ["main"], project: "Test", boxes: ["box"] });
    expect(sock.frames()[1]).toEqual({ t: "board", flow: "main", hands: { seat: [] }, turns: { box: 0 } });
    expect(sock.frames()[3]).toEqual({ t: "board", flow: "main", hands: { seat: ["a"] }, turns: { box: 0 } });
  });

  it("hello omits project and boxes when it has neither", () => {
    createLiveLink({ build: "B1", WebSocket: WS });
    FakeSocket.last().open();
    expect(FakeSocket.last().sent).toEqual([JSON.stringify({ t: "hello", v: 2, build: "B1", flows: [] })]);
  });

  it("attach after open sends the board straight away; hello went at open", () => {
    const l = link();
    const sock = FakeSocket.last();
    sock.open();
    expect(sock.kinds()).toEqual(["hello"]);
    const e = new Engine(bundle, { seed: 0 });
    e.openFlow("main");
    l.attach(e);
    expect(sock.kinds()).toEqual(["hello", "board"]);
  });

  it("forwards every trace event verbatim and follows deal / play / evict / turns with a board", () => {
    const l = link();
    const sock = FakeSocket.last();
    sock.open();
    const sessionEngine = new Engine(bundle, { seed: 0 });
    const session = sessionEngine.openFlow("main");
    const seen: unknown[] = [];
    session.subscribeTrace((e) => seen.push(e));
    l.attach(sessionEngine);
    sock.sent.length = 0;

    session.deal("seat");                 // deal -> board
    session.play("c_a", "go", "seat");    // write (no board), play -> board
    session.advanceTurns("box");          // turns -> board
    session.peek("box", { zone: "docks" }); // peek: trace only

    expect(sock.kinds()).toEqual(["trace", "board", "trace", "trace", "board", "trace", "board", "trace"]);
    const traces = sock.frames().filter((f) => f.t === "trace").map((f) => f.event);
    expect(traces).toEqual(seen);
    expect(seen.map((e) => (e as { type: string }).type)).toEqual(["deal", "write", "play", "turns", "peek"]);
    // The snapshot after the play: the card left the hand, the clock moved.
    expect(sock.frames()[4]).toEqual({ t: "board", flow: "main", hands: { seat: [] }, turns: { box: 1 } });
    // And each trace frame is the event's JSON, byte for byte.
    expect(sock.sent[0]).toBe(JSON.stringify({ t: "trace", flow: "main", event: seen[0] }));
  });

  it("detach stops forwarding; attach swaps sessions", () => {
    const l = link();
    const sock = FakeSocket.last();
    sock.open();
    const aEngine = new Engine(bundle, { seed: 0 });
    const a = aEngine.openFlow("main");
    const bEngine = new Engine(bundle, { seed: 0 });
    const b = bEngine.openFlow("main");
    const cEngine = new Engine(bundle, { seed: 0 });
    const c = cEngine.openFlow("main");
    l.attach(aEngine);
    l.detach();
    sock.sent.length = 0;
    a.deal("seat");
    expect(sock.sent).toEqual([]);

    l.attach(bEngine);
    l.attach(cEngine);                          // replaces b: b's events no longer forward
    sock.sent.length = 0;
    b.deal("seat");
    expect(sock.sent).toEqual([]);
    c.deal("seat");
    expect(sock.kinds()).toEqual(["trace", "board"]);
  });

  it("setBuild re-hellos with the new build and a fresh board; the same build is a no-op", () => {
    const l = link();
    const sock = FakeSocket.last();
    sock.open();
    const e = new Engine(bundle, { seed: 0 });
    e.openFlow("main");
    l.attach(e);
    sock.sent.length = 0;
    l.setBuild("B1");
    expect(sock.sent).toEqual([]);
    l.setBuild("B2");
    expect(sock.kinds()).toEqual(["hello", "board"]);
    expect(sock.frames()[0]).toMatchObject({ t: "hello", build: "B2", boxes: ["box"] });
  });

  it("setBuild before open changes the build the hello will carry", () => {
    const l = link();
    const sock = FakeSocket.last();
    l.setBuild("B2");
    sock.open();
    expect(sock.frames()[0]).toMatchObject({ t: "hello", build: "B2" });
  });

  it("hands only a well-formed bundle frame to onBundle", () => {
    const onBundle = vi.fn();
    link({ onBundle });
    const sock = FakeSocket.last();
    sock.open();
    sock.receive("not json");
    sock.receive(JSON.stringify({ t: "bundle", v: 1, build: "B2" }));            // no data
    sock.receive(JSON.stringify({ t: "bundle", v: 1, build: 7, data: "{}" }));   // build not a string
    sock.receive(JSON.stringify({ t: "bundle", v: 1, build: "B2", data: {} }));  // data not a string
    sock.receive(JSON.stringify({ t: "hello", v: 1, build: "B2" }));             // not a bundle
    sock.receive(new Uint8Array([1, 2, 3]));                                      // not text
    expect(onBundle).not.toHaveBeenCalled();
    sock.receive(JSON.stringify({ t: "bundle", v: 1, build: "B2", data: "{\"x\":1}", extra: true }));
    expect(onBundle).toHaveBeenCalledTimes(1);
    expect(onBundle).toHaveBeenCalledWith({ build: "B2", data: "{\"x\":1}" });
  });

  it("ignores editor messages when there is no onBundle", () => {
    link();
    const sock = FakeSocket.last();
    sock.open();
    expect(() => sock.receive(JSON.stringify({ t: "bundle", v: 1, build: "B2", data: "{}" }))).not.toThrow();
  });

  it("is a silent no-op when the editor is not listening, and after close", () => {
    const l = link();
    const sock = FakeSocket.last();
    sock.fail();                          // connection refused
    const sessionEngine = new Engine(bundle, { seed: 0 });
    const session = sessionEngine.openFlow("main");
    l.attach(sessionEngine);
    expect(() => session.deal("seat")).not.toThrow();
    expect(sock.sent).toEqual([]);

    l.close();
    l.attach(sessionEngine);
    l.setBuild("B9");
    expect(() => session.deal("seat")).not.toThrow();
    expect(sock.sent).toEqual([]);
  });

  it("close closes an open socket", () => {
    const l = link();
    const sock = FakeSocket.last();
    sock.open();
    l.close();
    expect(sock.closed).toBe(true);
  });

  it("close detaches: the old session's events go nowhere even if a socket reappears", () => {
    const l = link();
    const sock = FakeSocket.last();
    sock.open();
    const sessionEngine = new Engine(bundle, { seed: 0 });
    const session = sessionEngine.openFlow("main");
    l.attach(sessionEngine);
    l.close();
    sock.sent.length = 0;
    sock.readyState = 1;                  // a socket that refuses to die
    session.deal("seat");
    expect(sock.sent).toEqual([]);
  });

  it("is a no-op link when no WebSocket implementation exists", () => {
    const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
    try {
      const l = createLiveLink({ build: "B1" });
      const sessionEngine = new Engine(bundle, { seed: 0 });
    const session = sessionEngine.openFlow("main");
      expect(() => { l.attach(sessionEngine); session.deal("seat"); l.setBuild("B2"); l.detach(); l.close(); }).not.toThrow();
      expect(FakeSocket.instances).toEqual([]);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = saved;
    }
  });

  it("never throws into the game when the socket constructor or send blows up", () => {
    class Exploding { constructor() { throw new Error("no"); } }
    const l = createLiveLink({ build: "B1", WebSocket: Exploding as unknown as new (url: string) => FakeSocket });
    const sessionEngine = new Engine(bundle, { seed: 0 });
    const session = sessionEngine.openFlow("main");
    l.attach(sessionEngine);
    expect(() => session.deal("seat")).not.toThrow();

    const l2 = link();
    const sock = FakeSocket.last();
    sock.open();
    sock.send = () => { throw new Error("gone"); };
    l2.attach(sessionEngine);
    expect(() => session.deal("seat")).not.toThrow();
  });
});

describe("boardFrame", () => {
  it("keys hands and boxes by gameId, cards in dealt order", () => {
    const sessionEngine = new Engine(bundle, { seed: 0 });
    const session = sessionEngine.openFlow("main");
    session.deal("seat");
    session.advanceTurns("box", 3);
    expect(boardFrame(session)).toEqual({ t: "board", flow: "main", hands: { seat: ["a"] }, turns: { box: 3 } });
  });
});
