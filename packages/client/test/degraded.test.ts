// ---------------------------------------------------------------------------
// Degraded mode (spec 17 item 2), which is a rule every reference front-end
// must meet and therefore a property of the LAYER BENEATH them all.
//
// The venue case, in one line: the wifi drops between pressing a card and the
// server hearing about it. What must be true afterwards is that the party's
// screen still shows what it showed, that the play lands exactly once, and
// that nobody had to know any of it was happening.
//
// Also here: the stream's own life. A ticket, a reconnect that resumes from
// `Last-Event-ID`, and `replay-lost`, which is the server saying "whatever you
// hold is now a guess" and the client answering by re-reading the board.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";
import type { ConnectionState, Visit } from "../src/index.js";
import { createFakeServer, manualTimers } from "./fake-server.js";
import type { FakeServer, ManualTimers } from "./fake-server.js";

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

async function room(opts: Parameters<typeof createFakeServer>[0] = {}): Promise<{
  server: FakeServer;
  timers: ManualTimers;
  station: ReturnType<ReturnType<typeof createClient>["connectStation"]>;
  visit: Visit;
  states: ConnectionState[];
}> {
  const server = createFakeServer(opts);
  const timers = manualTimers();
  const client = createClient({
    base: "http://venue.local",
    fetch: server.fetch,
    EventSource: server.EventSource,
    timers,
  });
  const station = client.connectStation("station-key");
  const states: ConnectionState[] = [];
  station.subscribe((state) => states.push(state));
  const minted = await station.mintParty({ installation: "the-caretaker" });
  const { visit } = await station.handshake({ credential: "token", token: minted.token });
  await visit.deal();
  await settle();
  return { server, timers, station, visit, states };
}

describe("the stream", () => {
  it("mints a ticket first, because an EventSource cannot set a header", async () => {
    const { server, station } = await room();
    const first = server.requests.find((r) => r.path === "/v1/stream-ticket");
    expect(first).toBeTruthy();
    expect(first?.bearer).toBe("station");
    expect(station.connection).toBe("live");
    station.close();
  });

  it("renders a board event without a read", async () => {
    const { server, station, visit } = await room();
    const before = visit.state;
    server.emit({
      type: "board",
      flow: visit.state.party!,
      visit: visit.id,
      board: { "at-the-door": [] },
      turns: { room: 9 },
    } as never);
    await settle();
    expect(visit.state).not.toBe(before);
    expect(visit.board["at-the-door"]).toEqual([]);
    expect(visit.turns["room"]).toBe(9);
    station.close();
  });

  it("never renders another party's board, even on a stream that carries one", async () => {
    const { server, station, visit } = await room();
    const held = visit.board;
    server.emit({
      type: "board",
      flow: "party-999",
      visit: "visit-999",
      board: { "at-the-door": [] },
    } as never);
    await settle();
    expect(visit.board).toBe(held);
    station.close();
  });
});

describe("a drop, and coming back", () => {
  it("holds the last board, says so, then resumes from the last event id", async () => {
    const { server, timers, station, visit, states } = await room();
    const held = visit.board;
    expect(visit.state.held).toBe(false);

    server.emit({ type: "world", path: "world.time_phase", value: "evening", actor: { kind: "producer" } } as never);
    await settle();

    server.drop();
    await settle();
    // DEGRADED MODE: the board is still there, and the client says it is being
    // held rather than confirmed.
    expect(station.connection).toBe("held");
    expect(station.held).toBe(true);
    expect(station.heldReason).toBeTruthy();
    expect(visit.board).toBe(held);
    expect(visit.state.held).toBe(true);

    timers.advance(1000);
    await settle();
    await settle();
    expect(station.connection).toBe("live");
    expect(states).toContain("held");
    expect(states).toContain("replaying");

    // The reconnect carried the resume value, since a fresh EventSource has no
    // Last-Event-ID header of its own to send.
    const streamOpens = server.requests.filter((r) => r.path === "/v1/stream-ticket");
    expect(streamOpens.length).toBe(2);
    station.close();
  });

  it("re-reads the board on a reconnect, because it may have missed anything", async () => {
    const { server, timers, station, visit } = await room();
    server.drop();
    await settle();
    const reads = server.requests.filter((r) => r.path.endsWith("/board")).length;
    timers.advance(1000);
    await settle();
    await settle();
    expect(server.requests.filter((r) => r.path.endsWith("/board")).length).toBe(reads + 1);
    expect(visit.state.connection).toBe("live");
    station.close();
  });

  it("answers replay-lost by re-reading rather than carrying on", async () => {
    const { server, timers, station } = await room();
    server.drop();
    // The world moved on while the client was away, and then the ring buffer
    // rolled past the cursor it would have resumed from.
    server.emit({ type: "world", path: "world.time_phase", value: "night", actor: { kind: "producer" } } as never);
    server.forgetHistory();
    await settle();

    const reads = server.requests.filter((r) => r.path.endsWith("/board")).length;
    const seen: string[] = [];
    station.on((e) => seen.push(e.type));
    timers.advance(1000);
    await settle();
    await settle();
    expect(seen).toContain("replay-lost");
    expect(server.requests.filter((r) => r.path.endsWith("/board")).length).toBeGreaterThan(reads);
    station.close();
  });
});

describe("a command pressed while the wifi is away", () => {
  it("is held, sent once on the way back, and keeps its key", async () => {
    const { server, timers, station, visit } = await room();
    const held = visit.board;

    server.offline = true;
    server.drop();
    await settle();

    // The performer presses a card. Nothing tells them it failed, because it
    // has not: it is waiting.
    const playing = visit.play("who-let-you-in", "say-nothing", "at-the-door");
    await settle();
    expect(visit.state.held).toBe(true);
    expect(visit.state.queued).toBe(1);
    expect(visit.board).toBe(held);

    const attempts = () => server.requests.filter((r) => r.path.endsWith("/play"));
    server.offline = false;
    timers.advance(1000);
    await settle();
    await settle();
    const played = await playing;
    expect(played.board["at-the-door"]?.map((c) => c.id)).toEqual(["the-key-under-the-mat"]);
    // Sent once on the way back, and once only.
    expect(attempts()).toHaveLength(1);
    expect(visit.state.queued).toBe(0);
    expect(visit.state.held).toBe(false);
    station.close();
  });

  it("keeps the order a performer pressed things in", async () => {
    const { server, timers, station } = await room();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    server.offline = true;
    await settle();

    const first = visit.deal();
    const second = visit.play("who-let-you-in", "say-nothing", "at-the-door");
    await settle();
    expect(visit.state.queued).toBe(2);

    server.offline = false;
    timers.advance(1000);
    await settle();
    await settle();
    await Promise.all([first, second]);
    const order = server.requests
      .filter((r) => r.path.endsWith("/deal") || r.path.endsWith("/play"))
      .map((r) => (r.path.endsWith("/deal") ? "deal" : "play"));
    // A play that overtook its deal would be `not_dealt`, so this is the
    // property the serial queue exists for.
    expect(order).toEqual(["deal", "deal", "play"]);
    station.close();
  });

  it("reuses one key across every retry of one command", async () => {
    const server = createFakeServer();
    const timers = manualTimers();
    // The wifi drops the first two plays on the floor: no answer either way,
    // which is the one case where a client may not know what happened.
    let dropped = 2;
    const seen: (string | undefined)[] = [];
    const flaky: typeof server.fetch = (url, init) => {
      if (url.endsWith("/play")) {
        seen.push(init.headers["Idempotency-Key"]);
        if (dropped > 0) {
          dropped--;
          return Promise.reject(new Error("wifi"));
        }
      }
      return server.fetch(url, init);
    };
    const client = createClient({
      base: "http://venue.local",
      fetch: flaky,
      EventSource: server.EventSource,
      timers,
    });
    const station = client.connectStation("station-key");
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    await visit.deal();

    const playing = visit.play("who-let-you-in", "say-nothing", "at-the-door");
    await settle();
    timers.advance(1000);
    await settle();
    timers.advance(1000);
    await settle();
    await settle();
    await playing;

    // Three attempts, ONE key: had the first two actually landed, the server
    // would have recognised them and answered the first result.
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBeTruthy();
    expect(dropped).toBe(0);
    station.close();
  });

  it("does not retry a refusal: a gated play is decided, not delayed", async () => {
    const { server, station, visit } = await room();
    await expect(visit.play("who-let-you-in", "show-the-key", "at-the-door")).rejects.toMatchObject({
      code: "gated",
    });
    expect(visit.state.queued).toBe(0);
    expect(server.requests.filter((r) => r.path.endsWith("/play"))).toHaveLength(1);
    station.close();
  });

  // THE SECOND DEFECT of 2026-09-05: the refusal above was rendered under a
  // red banner reading "No connection. Come back to this spot in a moment."
  //
  // A refusal is an ANSWER. The server heard the question and said no, and no
  // amount of waiting changes it, so degraded mode - which promises the screen
  // will catch up by itself - is a lie told over the top of the truth. Held is
  // for a transport that failed: status 0, a network error, the stream
  // dropping (spec 17 item 2).
  it("does not hold the screen for a refusal: the server answered", async () => {
    const { server, station, visit } = await room();
    expect(station.connection).toBe("live");
    // Every frame a front-end would draw, not just the last one: a banner that
    // flashes the refusal's own words and then takes them back is the defect
    // arriving and leaving too fast for a test that only looks afterwards.
    const held: { held: boolean; reason?: string }[] = [];
    station.subscribe((_state, isHeld, reason) => held.push({ held: isHeld, ...(reason !== undefined ? { reason } : {}) }));

    // Two commands, the first refused. The second is still waiting, which is
    // the shape that used to turn a refusal's own words into a hold.
    const gated = visit.play("who-let-you-in", "show-the-key", "at-the-door");
    const dealt = visit.deal();
    await expect(gated).rejects.toMatchObject({ code: "gated", status: 409 });
    await dealt;
    await settle();

    expect(held.filter((h) => h.held)).toEqual([]);

    expect(station.connection).toBe("live");
    expect(station.held).toBe(false);
    expect(station.heldReason).toBeUndefined();
    expect(visit.state.held).toBe(false);
    expect(station.refusal).toBeUndefined();

    // And a real blip still raises it, which is the half that must not be
    // lost while fixing the other.
    server.offline = true;
    server.drop();
    await settle();
    expect(station.held).toBe(true);
    expect(station.connection).toBe("held");
    station.close();
  });

  it("stops rather than holds when the stream itself is refused", async () => {
    // The phone at the door: a day pass that died with the run. The ticket is
    // refused, so there is no stream and there will not be one until this
    // client is somebody else - but the page has an answer to show, and the
    // banner must not talk over it with a story about the network.
    const server = createFakeServer();
    const timers = manualTimers();
    const client = createClient({
      base: "http://venue.local",
      fetch: server.fetch,
      EventSource: server.EventSource,
      timers,
    });
    const phone = client.connectParty("token-that-died-with-the-run");
    await settle();
    await settle();

    expect(phone.held).toBe(false);
    expect(phone.connection).not.toBe("held");
    expect(phone.refusal?.code).toBe("unknown_credential");
    // Not retried on a ladder: the server has decided, and fifty phones
    // arguing with it is a denial of service the venue performs on itself.
    const tickets = () => server.requests.filter((r) => r.path === "/v1/stream-ticket").length;
    const asked = tickets();
    expect(asked).toBe(1);
    timers.runAll();
    await settle();
    expect(tickets()).toBe(asked);
    phone.close();
  });

  it("takes the stream back up as whoever it becomes, and forgets the refusal", async () => {
    const server = createFakeServer();
    const client = createClient({
      base: "http://venue.local",
      fetch: server.fetch,
      EventSource: server.EventSource,
      timers: manualTimers(),
    });
    // A phone holding nothing: the ticket is refused, and then the scan mints
    // the party it becomes. Adopting is what re-opens the stream.
    const phone = client.connectParty();
    await settle();
    expect(phone.refusal).toBeTruthy();

    await phone.atLocation("this-room", "the-door");
    await settle();
    await settle();
    expect(phone.connection).toBe("live");
    expect(phone.refusal).toBeUndefined();
    phone.close();
  });

  it("goes inert on close, refusing whatever was still held", async () => {
    const { server, station, visit } = await room();
    server.offline = true;
    server.drop();
    await settle();
    const playing = visit.play("who-let-you-in", "say-nothing", "at-the-door");
    await settle();
    station.close();
    await expect(playing).rejects.toMatchObject({ status: 0 });
    expect(server.streams).toBe(0);
    });
});
