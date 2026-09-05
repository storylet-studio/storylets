// ---------------------------------------------------------------------------
// The verbs, over the fake server: every route in wire 6.4 that a station or a
// party may call, and the shapes that come back.
//
// The point is not that the fake answers; it is that the client and the fake
// agree without either of them re-declaring a wire type. If a field moves in
// `@storylet-studio/wire`, one of these two ends stops compiling, which is
// exactly the failure mode the wire package exists to create.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { ClientError, createClient } from "../src/index.js";
import type { Client, StationConnection } from "../src/index.js";
import { createFakeServer, manualTimers } from "./fake-server.js";
import type { FakeServer } from "./fake-server.js";

/** Let every microtask (the stream's open, its first frames) settle. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function bench(opts: Parameters<typeof createFakeServer>[0] = {}): {
  server: FakeServer;
  client: Client;
  station: StationConnection;
} {
  const server = createFakeServer(opts);
  const client = createClient({
    base: opts.base ?? "http://venue.local",
    fetch: server.fetch,
    EventSource: server.EventSource,
    timers: manualTimers(),
  });
  return { server, client, station: client.connectStation(opts.stationKey ?? "station-key") };
}

describe("hello", () => {
  it("is anonymous, and names the venue, the open stories and the protocol", async () => {
    const { client } = bench();
    const hello = await client.hello();
    expect(hello.wire).toBe("storyletengine/wire@1");
    expect(hello.venue.venue).toBe("this-room");
    expect(hello.installations.map((i) => i.installation)).toEqual(["the-caretaker"]);
    expect(hello.station).toBeUndefined();
  });

  it("tells a station key what device it is and where it stands", async () => {
    const { station } = bench();
    const hello = await station.hello();
    expect(hello.station?.station).toBe("kiosk-1");
    expect(hello.station?.location).toBe("the-table");
    station.close();
  });
});

describe("the station's verbs", () => {
  it("mints a walk-up party, attaches it, and deals its hands", async () => {
    const { station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker", callSign: true, attach: true });
    expect(minted.partyId).toMatch(/^party-/);
    expect(minted.callSign).toBeTruthy();

    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    const dealt = await visit.deal();
    expect(Object.keys(dealt.board).sort()).toEqual(["at-the-door", "at-the-table", "at-the-window"]);
    expect(dealt.board["at-the-door"]?.map((c) => c.id)).toEqual(["who-let-you-in", "the-key-under-the-mat"]);
    station.close();
  });

  it("refuses a call sign from a phone and takes one from a station", async () => {
    const { server, client, station } = bench();
    const party = server.seedParty({ callSign: "quiet otter" });
    const phone = client.connectParty(party.token);

    // A phone HOLDS; a station VOUCHES (spec 7.1). The client says so in its
    // TYPES: a party connection has no `handshake` at all, so a companion page
    // cannot present someone else's call sign even by mistake.
    expect("handshake" in phone).toBe(false);
    const shook = await station.handshake({ credential: "callsign", callSign: "quiet otter" });
    expect(shook.response.partyId).toBe(party.id);
    expect(shook.response.returning).toBe(true);
    phone.close();
    station.close();
  });

  it("plays a card, and the same card twice is not_dealt", async () => {
    const { station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    await visit.deal();

    const outcomes = await visit.outcomes("who-let-you-in", "at-the-door");
    expect(outcomes.map((o) => o.id)).toEqual(["say-nothing", "give-a-name", "show-the-key"]);
    // Gated outcomes are DISABLED, never hidden, so the client hands them all
    // over and the kit greys the unavailable ones (spec 12).
    expect(outcomes.find((o) => o.id === "show-the-key")?.available).toBe(false);

    const played = await visit.play("who-let-you-in", "say-nothing", "at-the-door");
    expect(played.board["at-the-door"]?.map((c) => c.id)).toEqual(["the-key-under-the-mat"]);

    await expect(visit.play("who-let-you-in", "say-nothing", "at-the-door")).rejects.toMatchObject({
      code: "not_dealt",
      status: 409,
    });
    station.close();
  });

  it("surfaces every wire error as a typed ClientError", async () => {
    const { station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    await visit.deal();
    const err = await visit.play("who-let-you-in", "show-the-key", "at-the-door").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err).toMatchObject({ code: "gated", status: 409 });
    expect((err as ClientError).message).toContain("show-the-key");
    expect((err as ClientError).offline).toBe(false);
    station.close();
  });

  it("peeks without claiming, reports presence, and detaches", async () => {
    const { station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    await visit.deal();

    const peeked = await visit.peek("room", { mood: "wary" }, 1);
    expect(peeked.cards).toHaveLength(1);
    // A peek never claims: the board is untouched.
    expect(visit.board["at-the-door"]).toHaveLength(2);

    const presence = await station.setPresence({ location: "the-window" });
    expect(presence.presence.location).toBe("the-window");

    const detached = await visit.detach();
    expect(detached.stations).toEqual([]);
    expect(visit.state.closed).toBe(true);
    station.close();
  });

  it("claims a party and issues a second credential for the rest of the group", async () => {
    const { station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const claimed = await station.claim(minted.partyId, { kind: "token" });
    expect(claimed.claimed).toBe(true);
    expect(claimed.qr).toContain("/p/");

    const wristband = await station.issueCredential(minted.partyId, { kind: "external", externalRef: "band-04" });
    expect(wristband.credential.kind).toBe("external");
    const back = await station.handshake({ credential: "external", externalRef: "band-04" });
    expect(back.response.partyId).toBe(minted.partyId);
    station.close();
  });

  it("carries an Idempotency-Key on every mutation and none on a read", async () => {
    const { server, station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    await visit.deal();
    await visit.outcomes("who-let-you-in", "at-the-door");

    const mutations = server.requests.filter((r) => r.method !== "GET" && r.path !== "/v1/stream-ticket");
    expect(mutations.length).toBeGreaterThan(0);
    for (const m of mutations) expect(m.idempotencyKey, m.path).toBeTruthy();
    // Every key is its own: one command, one key.
    const keys = mutations.map((m) => m.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of server.requests.filter((r) => r.method === "GET")) {
      expect(r.idempotencyKey, r.path).toBeUndefined();
    }
    station.close();
  });
});

describe("the party's verbs", () => {
  it("scans a placard and is routed into the one open story", async () => {
    const { server, client } = bench();
    const party = server.seedParty({});
    const phone = client.connectParty(party.token);
    const res = await phone.atLocation("this-room", "the-door");
    expect(res.outcome).toBe("attached");
    if (res.outcome !== "attached") throw new Error("unreachable");
    expect(res.installation).toBe("the-caretaker");
    expect(phone.visit?.board["at-the-door"]).toHaveLength(2);
    phone.close();
  });

  it("is offered a chooser when several stories are open, and the choice mints", async () => {
    const server = createFakeServer({ twoStories: true });
    const client = createClient({
      base: "http://venue.local",
      fetch: server.fetch,
      EventSource: server.EventSource,
      timers: manualTimers(),
    });
    // No credential at all, which is the walk-up case: the phone holds nothing,
    // so it connects as a party with an empty token and gets the chooser.
    const phone = client.connectParty("");
    const res = await phone.atLocation("this-room", "the-door");
    expect(res.outcome).toBe("choose");
    if (res.outcome !== "choose") throw new Error("unreachable");
    expect(res.installations.map((i) => i.installation)).toEqual(["the-caretaker", "after-dark"]);

    const chosen = await phone.chooseInstallation("this-room", "the-door", "after-dark");
    expect(chosen.response.installation).toBe("after-dark");
    expect(chosen.visit.board["the-locked-door"]?.map((c) => c.id)).toEqual(["not-tonight"]);
    phone.close();
  });

  it("refuses a placard this venue has never printed", async () => {
    const { server, client } = bench();
    const party = server.seedParty({});
    const phone = client.connectParty(party.token);
    await expect(phone.atLocation("this-room", "the-cellar")).rejects.toMatchObject({
      code: "unknown_location",
    });
    phone.close();
  });
});

describe("messages", () => {
  it("lists, sends and acks, and a pushed message reaches the desk", async () => {
    const { server, station } = bench();
    await settle();

    const sent = await station.messages.send({
      body: "help at the door",
      priority: "urgent",
      audience: { to: "producers" },
      ackRequired: true,
    });
    expect(sent.message.priority).toBe("urgent");
    await settle();
    // Delivery rides the stream, so the desk already has it without a list.
    expect(station.messages.all.map((m) => m.body)).toEqual(["help at the door"]);

    const acked = await station.messages.ack(sent.message.id);
    expect(acked).toEqual({ id: sent.message.id, acked: 1, of: 1 });

    const listed = await station.messages.list();
    expect(listed).toHaveLength(1);
    station.close();
  });
});

describe("the visit as a state machine", () => {
  it("hands a subscriber the current snapshot at once, and a new one per change", async () => {
    const { station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });

    const cards = (board: Record<string, unknown[]>): number =>
      Object.values(board).reduce((n, held) => n + held.length, 0);
    const seen: number[] = [];
    const stop = visit.subscribe((s) => seen.push(cards(s.board)));
    // The handshake's board is the first snapshot, so a subscriber never has
    // to ask for one: three hands bound here, nothing dealt into them yet.
    expect(seen).toEqual([0]);
    await visit.deal();
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(4);

    // The snapshot is replaced, never mutated: a renderer may hold the old one.
    const before = visit.state;
    await visit.play("who-let-you-in", "say-nothing", "at-the-door");
    expect(visit.state).not.toBe(before);
    expect(before.board["at-the-door"]).toHaveLength(2);
    stop();
    station.close();
  });

  it("keeps the property view current from a play's writes, with no second read", async () => {
    const { server, station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    await visit.deal();
    await visit.refreshProperties();
    expect(visit.properties.find((p) => p.path === "story.visits")?.value).toBe(1);

    const reads = server.requests.filter((r) => r.path.endsWith("/properties")).length;
    await visit.play("who-let-you-in", "say-nothing", "at-the-door");
    expect(visit.properties.find((p) => p.path === "story.visits")?.value).toBe(2);
    expect(server.requests.filter((r) => r.path.endsWith("/properties"))).toHaveLength(reads);
    station.close();
  });

  it("never lets a listener that throws stop the client", async () => {
    const { station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    visit.subscribe(() => { throw new Error("a renderer blew up"); });
    const good: number[] = [];
    visit.subscribe((s) => good.push(Object.values(s.board).reduce((n, held) => n + held.length, 0)));
    await expect(visit.deal()).resolves.toBeTruthy();
    expect(good.at(-1)).toBe(4);
    station.close();
  });

  it("parks, and the visit says so", async () => {
    const { station } = bench();
    const minted = await station.mintParty({ installation: "the-caretaker" });
    const { visit } = await station.handshake({ credential: "token", token: minted.token });
    const parked = await visit.park();
    expect(parked.visit).toBe(visit.id);
    expect(visit.state.closed).toBe(true);
    station.close();
  });
});
