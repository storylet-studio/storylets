// ---------------------------------------------------------------------------
// The producer identity, over the fake server: every verb the console API
// declares (wire 6.5, spec 11), the paging, and the monitor stream.
//
// The same rule as client.test.ts, one bearer along: the point is not that the
// fake answers, it is that the client and the fake agree without either of
// them re-declaring a wire type. A field that moves in
// `@storylet-studio/wire` stops one of these two ends compiling.
//
// What is checked here that a type cannot say: the METHOD and the PATH of each
// verb, that every mutation carries an `Idempotency-Key` and the two pure
// POSTs do not, that a list pages, and that a producer's mutation is never
// held.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { CLOCK_PATHS, CLOCK_PHASE, WIRE_CONSOLE_PATH } from "@storylet-studio/wire";
import type { WireEvent } from "@storylet-studio/wire";
import { CLOCK_PREFIX, ClientError, createClient, walkPages } from "../src/index.js";
import type { Client, ProducerConnection } from "../src/index.js";
import { createFakeServer, manualTimers } from "./fake-server.js";
import type { FakeServer, RecordedRequest } from "./fake-server.js";

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function desk(opts: Parameters<typeof createFakeServer>[0] = {}): {
  server: FakeServer;
  client: Client;
  producer: ProducerConnection;
} {
  const server = createFakeServer(opts);
  const client = createClient({
    base: opts.base ?? "http://venue.local",
    fetch: server.fetch,
    EventSource: server.EventSource,
    timers: manualTimers(),
  });
  return { server, client, producer: client.connectProducer(opts.producerKey ?? "producer-key") };
}

/** The last request the client made, which is what every verb below asserts
 *  against: one method, one path, one body. */
const last = (server: FakeServer): RecordedRequest => {
  const call = server.requests.at(-1);
  if (call === undefined) throw new Error("the client made no request at all");
  return call;
};

describe("the producer's shape", () => {
  it("talks the console's own base path, and holds no visit of its own", async () => {
    const { server, producer } = desk();
    await producer.venue.get();
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/venue`);
    expect(last(server).bearer).toBe("producer");
    // A producer drives other people's visits; it never has one. `visit` on a
    // station connection is the thing this deliberately does not have.
    expect("visit" in producer).toBe(false);
    producer.close();
  });

  it("says hello as itself, and the server names the venue and the stories", async () => {
    const { producer } = desk();
    const hello = await producer.hello();
    expect(hello.venue.venue).toBe("this-room");
    expect(hello.installations.map((i) => i.installation)).toEqual(["the-caretaker"]);
    producer.close();
  });

  it("refuses a station key on a console route, and says wrong_role", async () => {
    const { client } = desk();
    const wrong = client.connectProducer("station-key");
    await expect(wrong.venue.get()).rejects.toMatchObject({ code: "wrong_role", status: 403 });
    wrong.close();
  });
});

describe("runs", () => {
  it("starts, holds, resumes and ends one, each with a key", async () => {
    const { server, producer } = desk();
    const started = await producer.runs.start({ installation: "the-caretaker", seed: 7 });
    expect(started.run.state).toBe("live");
    expect(last(server)).toMatchObject({ method: "POST", path: `${WIRE_CONSOLE_PATH}/runs` });
    expect(last(server).idempotencyKey).toBeTruthy();

    const held = await producer.runs.hold(started.run.run);
    expect(held.run.state).toBe("paused");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/runs/${started.run.run}/pause`);

    const back = await producer.runs.resume(started.run.run);
    expect(back.run.state).toBe("live");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/runs/${started.run.run}/resume`);

    const ended = await producer.runs.end(started.run.run);
    expect(ended.run.state).toBe("ended");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/runs/${started.run.run}/end`);
    producer.close();
  });

  it("presses GO, which is a cue without a time rather than a run route", async () => {
    const { server, producer } = desk();
    const fired = await producer.runs.go({ installation: "the-caretaker" });
    expect(fired.cue).toBe("go");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/cues/go/fire`);
    expect(last(server).body).toMatchObject({ installation: "the-caretaker", cue: "go" });
    producer.close();
  });

  it("windows the journal by its filters, and the kinds ride as one parameter", async () => {
    const { server, producer } = desk();
    // A run belongs to one story already, so the journal window does not name
    // one: the run id IS the installation, once removed.
    const journal = await producer.runs.journal({
      run: "run-1",
      kinds: ["play", "set"],
      flow: "house",
      limit: 10,
    });
    expect(journal.items.length).toBeGreaterThan(0);
    expect(journal.items.every((e) => e.command.kind === "play" || e.command.kind === "set")).toBe(true);
    expect(journal.head).toBeGreaterThan(0);
    // Recent-first, which is what the wire says and what the producer's
    // question ("what just happened") asks for. The first page is the newest
    // end of the run, so `seq` descends.
    const seqs = journal.items.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(last(server).path).toContain("kinds=play%2Cset");
    expect(last(server).path).toContain("flow=house");
    producer.close();
  });

  it("windows the journal by hand, which is spec 11's fourth filter", async () => {
    const { server, producer } = desk();
    const onTheHand = await producer.runs.journal({ run: "run-1", hand: "the-house-hand" });
    expect(onTheHand.items.length).toBeGreaterThan(0);
    // Only the commands that NAME the hand: a deal that asked for it, a play
    // on it, an eviction from it.
    expect(onTheHand.items.every((e) => e.command.kind === "play")).toBe(true);
    expect(last(server).path).toContain("hand=the-house-hand");

    const nowhere = await producer.runs.journal({ run: "run-1", hand: "a-hand-nobody-declared" });
    expect(nowhere.items).toEqual([]);
    producer.close();
  });

  it("windows the journal by station, and a detach is what names one", async () => {
    const { server, producer } = desk();
    const seeded = server.seedVisit({});
    // Nothing names a station until something does: presence is never
    // journaled, so a station filter can only ever find an attach or a detach.
    const before = await producer.runs.journal({ run: "run-1", station: "kiosk-1" });
    expect(before.items).toEqual([]);

    await producer.visits.detach({ visit: seeded, station: "kiosk-1" });
    const after = await producer.runs.journal({ run: "run-1", station: "kiosk-1" });
    expect(after.items.map((e) => e.command.kind)).toEqual(["visit.detach"]);
    expect(last(server).path).toContain("station=kiosk-1");
    producer.close();
  });

  it("snapshots and restores from the journal", async () => {
    const { server, producer } = desk();
    const shot = await producer.runs.snapshot("run-1");
    expect(shot.snapshot).toBeTruthy();
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/runs/run-1/snapshot`);

    const restored = await producer.runs.restoreFromJournal({ run: "run-1", toSeq: shot.seq });
    expect(restored.seq).toBe(shot.seq);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/runs/run-1/restore`);
    producer.close();
  });
});

describe("paging", () => {
  it("is `{ cursor, limit }` in and `{ items, next }` out", async () => {
    const { producer } = desk();
    const first = await producer.runs.list({ installation: "the-caretaker", limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.next).toBeTruthy();
    const second = await producer.runs.list({ installation: "the-caretaker", limit: 2, cursor: first.next! });
    expect(second.items[0]?.run).not.toBe(first.items[0]?.run);
  });

  it("walks every page through the helper, and asks for each one once", async () => {
    const { server, producer } = desk();
    const seen: string[] = [];
    for await (const run of walkPages((at) => producer.runs.list({ installation: "the-caretaker", ...at }), { limit: 2 })) {
      seen.push(run.run);
    }
    expect(seen.length).toBeGreaterThan(2);
    expect(new Set(seen).size).toBe(seen.length);
    const pages = server.requests.filter((r) => r.path.startsWith(`${WIRE_CONSOLE_PATH}/runs?`));
    expect(pages).toHaveLength(Math.ceil(seen.length / 2));
    producer.close();
  });

  it("stops rather than spinning when a server hands back a cursor that does not move", async () => {
    let asked = 0;
    const items = [];
    for await (const item of walkPages(() => {
      asked++;
      return Promise.resolve({ items: [asked], next: "stuck" });
    })) {
      items.push(item);
      if (asked > 10) break;
    }
    // Two pages: the first, and the one the repeated cursor asked for. Then it
    // gives up rather than paging for ever.
    expect(asked).toBe(2);
    expect(items).toEqual([1, 2]);
  });
});

describe("visits", () => {
  it("lists the roster, and lenses one flow", async () => {
    const { server, producer } = desk();
    const visit = server.seedVisit();
    const roster = await producer.visits.list({ installation: "the-caretaker" });
    expect(roster.items.some((v) => v.visit === visit)).toBe(true);

    const lens = await producer.visits.lens(visit, 5);
    expect(lens.visit.visit).toBe(visit);
    expect(Object.keys(lens.board)).toContain("at-the-door");
    expect(lens.properties.length).toBeGreaterThan(0);
    expect(lens.entries?.length).toBeGreaterThan(0);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/visits/${visit}/lens?log=5`);
    producer.close();
  });

  it("force-deals, force-plays and evicts", async () => {
    const { server, producer } = desk();
    const visit = server.seedVisit();
    const dealt = await producer.visits.forceDeal({ visit });
    expect(dealt.board["at-the-door"]?.length).toBeGreaterThan(0);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/visits/${visit}/deal`);

    const played = await producer.visits.forcePlay({
      visit, card: "who-let-you-in", outcome: "say-nothing", hand: "at-the-door",
    });
    expect(played.board["at-the-door"]?.map((c) => c.id)).toEqual(["the-key-under-the-mat"]);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/visits/${visit}/play`);

    const after = await producer.visits.evict({ visit, hand: "at-the-door", card: "the-key-under-the-mat" });
    expect(after.board["at-the-door"]).toEqual([]);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/visits/${visit}/evict`);
    producer.close();
  });

  it("advances turns and sets a property on one flow, and on every flow when no visit is named", async () => {
    const { server, producer } = desk();
    const visit = server.seedVisit();
    await producer.visits.advanceTurns({ installation: "the-caretaker", visit, box: "room", turns: 2 });
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/visits/${visit}/turns`);

    // The wire marks the visit segment optional: absent is the cue's own shape
    // (every open flow) reached by hand, and the segment goes with it.
    await producer.visits.advanceTurns({ installation: "the-caretaker", box: "room", turns: 1 });
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/visits/turns`);

    const set = await producer.visits.setProperty({
      installation: "the-caretaker", visit, path: "story.visits", value: 4,
    });
    expect(set.property.value).toBe(4);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/visits/${visit}/properties`);
    producer.close();
  });

  it("detaches somebody else's station, and parks the visit", async () => {
    const { server, producer } = desk();
    const visit = server.seedVisit();
    const left = await producer.visits.detach({ visit, station: "kiosk-1" });
    expect(left.stations).toEqual([]);
    expect(last(server)).toMatchObject({
      method: "DELETE",
      path: `${WIRE_CONSOLE_PATH}/visits/${visit}/stations/kiosk-1`,
    });

    const parked = await producer.visits.park(visit);
    expect(parked.visit).toBe(visit);
    expect(last(server)).toMatchObject({ method: "DELETE", path: `${WIRE_CONSOLE_PATH}/visits/${visit}` });
    producer.close();
  });
});

describe("parties", () => {
  it("lists, details, edits a pocket and forgets", async () => {
    const { server, producer } = desk();
    const party = server.seedParty({ callSign: "quiet otter" });
    const page = await producer.parties.list({ installation: "the-caretaker", claimed: true });
    expect(page.items.some((p) => p.party === party.id)).toBe(true);
    expect(last(server).path).toContain("claimed=true");

    const detail = await producer.parties.detail(party.id);
    expect(detail.party.callSign).toBe("quiet otter");
    expect(detail.party.credentials?.length).toBeGreaterThan(0);

    const edited = await producer.parties.editPocket({ party: party.id, set: { "story.visits": 3 } });
    expect(edited.pocket["story.visits"]).toBe(3);
    expect(last(server)).toMatchObject({
      method: "PATCH",
      path: `${WIRE_CONSOLE_PATH}/parties/${party.id}/pocket`,
    });

    const gone = await producer.parties.forget(party.id);
    expect(gone.party).toBe(party.id);
    expect(last(server)).toMatchObject({ method: "DELETE", path: `${WIRE_CONSOLE_PATH}/parties/${party.id}` });
    producer.close();
  });

  it("claims and issues on the routes the wire names, which are not under /console", async () => {
    const { server, producer } = desk();
    const party = server.seedParty({ claimed: false });
    const claimed = await producer.parties.claim({ partyId: party.id, kind: "callsign" });
    expect(claimed.claimed).toBe(true);
    expect(last(server).path).toBe(`/v1/parties/${party.id}/claim`);

    const issued = await producer.parties.credentials.issue({ partyId: party.id, kind: "token", dayPass: true });
    expect(issued.token).toBeTruthy();
    expect(last(server).path).toBe(`/v1/parties/${party.id}/credentials`);
    producer.close();
  });

  it("revokes a credential and moves one to another party", async () => {
    const { server, producer } = desk();
    const one = server.seedParty();
    const two = server.seedParty();
    const issued = await producer.parties.credentials.issue({ partyId: one.id, kind: "token" });

    const revoked = await producer.parties.credentials.revoke({
      party: one.id, credential: issued.credential.id,
    });
    expect(revoked.credential.revokedAt).toBeTruthy();
    expect(last(server).path)
      .toBe(`${WIRE_CONSOLE_PATH}/parties/${one.id}/credentials/${issued.credential.id}/revoke`);

    const second = await producer.parties.credentials.issue({ partyId: one.id, kind: "token" });
    const moved = await producer.parties.credentials.move({ credential: second.credential.id, to: two.id });
    expect(moved.party).toBe(two.id);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/credentials/${second.credential.id}/move`);
    producer.close();
  });
});

describe("the world, the house and the clocks", () => {
  it("reads and writes @world as the producer, and the write is not gated by writable:false", async () => {
    const { server, producer } = desk();
    const world = await producer.world.read({ installation: "the-caretaker" });
    expect(world.properties.some((p) => p.path === CLOCK_PHASE)).toBe(true);

    // `writable: false` protects a property from OUTCOMES, not from the person
    // running the show (wire 6.5, spec 5.6).
    const written = await producer.world.write({
      installation: "the-caretaker", path: CLOCK_PHASE, value: "evening",
    });
    expect(written.property.value).toBe("evening");
    expect(written.property.writable).toBe(false);
    expect(last(server)).toMatchObject({ method: "POST", path: `${WIRE_CONSOLE_PATH}/world` });
    producer.close();
  });

  it("reads the three clocks as one narrowed read, since there is no clock route", async () => {
    const { server, producer } = desk();
    const clocks = await producer.world.clocks("the-caretaker");
    // Minutes since midnight, local to the venue, not an instant (10.1). It
    // used to coerce the number to the empty string, which read as midnight.
    expect(clocks.time_wall).toBe(14 * 60 + 32);
    expect(clocks.time_show).toBe(120);
    expect(clocks.time_phase).toBe("afternoon");
    expect(last(server).path).toContain(`prefix=${encodeURIComponent(CLOCK_PREFIX)}`);
    producer.close();
  });

  it("the kit's three clock paths all sit under the prefix that read narrows on", () => {
    for (const path of CLOCK_PATHS) expect(path.startsWith(CLOCK_PREFIX)).toBe(true);
  });

  it("reads the house's table without dealing it, which is what a map draws from", async () => {
    const { server, producer } = desk();
    const empty = await producer.house.list({ installation: "the-caretaker" });
    expect(empty.board).toEqual({});
    expect(last(server)).toMatchObject({ method: "GET", path: `${WIRE_CONSOLE_PATH}/house?installation=the-caretaker` });
    // A read that had to deal to answer would be a read that changed the show,
    // so this one carries no key and leaves the table as it found it.
    expect(last(server).idempotencyKey).toBeUndefined();

    await producer.house.deal({ installation: "the-caretaker" });
    const dealt = await producer.house.list({ installation: "the-caretaker" });
    expect(Object.keys(dealt.board)).toContain("the-house-hand");
    producer.close();
  });

  it("deals, plays and advances the house", async () => {
    const { server, producer } = desk();
    const dealt = await producer.house.deal({ installation: "the-caretaker" });
    expect(Object.keys(dealt.board)).toContain("the-house-hand");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/house/deal`);

    await producer.house.play({
      installation: "the-caretaker", card: "the-bell", outcome: "ring-it", hand: "the-house-hand",
    });
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/house/play`);

    const turns = await producer.house.advance({ installation: "the-caretaker", box: "house-box", turns: 1 });
    expect(turns.turns["house-box"]).toBe(1);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/house/turns`);
    producer.close();
  });
});

describe("the venue and its stations", () => {
  it("reads the venue, lists, creates and moves a location, and prints the sheet", async () => {
    const { server, producer } = desk();
    const venue = await producer.venue.get();
    expect(venue.venue.plan?.width).toBe(800);

    const locations = await producer.venue.locations.list({ limit: 2 });
    expect(locations.items).toHaveLength(2);

    const made = await producer.venue.locations.create({ label: "The hearth", x: 200, y: 200 });
    expect(made.location.code).toContain("/at/this-room/");
    expect(last(server)).toMatchObject({ method: "POST", path: `${WIRE_CONSOLE_PATH}/venue/locations` });

    const moved = await producer.venue.locations.update({ location: made.location.location, x: 210, y: 220 });
    expect(moved.location.x).toBe(210);
    // The printed code never changes: a placard is printed once (wire 12.2).
    expect(moved.location.code).toBe(made.location.code);
    expect(last(server).method).toBe("PATCH");

    const sheet = await producer.venue.printSheet({});
    expect(sheet.sheet.length).toBeGreaterThan(2);
    // Pure: the wire asks for no key on this one, so none is sent.
    expect(last(server).idempotencyKey).toBeUndefined();
    producer.close();
  });

  it("binds a station's kind and its location, and lists presence", async () => {
    const { server, producer } = desk();
    const bound = await producer.stations.bind({ station: "kiosk-1", kind: "fixed", label: "The table kiosk" });
    expect(bound.station.kind).toBe("fixed");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/stations/kiosk-1/binding`);

    const placed = await producer.stations.bindToLocation({ station: "kiosk-1", location: "the-window" });
    expect(placed.station.location).toBe("the-window");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/stations/kiosk-1/location`);

    const here = await producer.stations.presence({ location: "the-window" });
    expect(here.presence.map((p) => p.station)).toEqual(["kiosk-1"]);
    expect(last(server).path).toContain("location=the-window");
    producer.close();
  });
});

describe("installations and their bindings", () => {
  it("lists, opens, closes and updates a story", async () => {
    const { server, producer } = desk({ twoStories: true });
    const page = await producer.installations.list({ open: true });
    expect(page.items).toHaveLength(2);

    const closed = await producer.installations.close("after-dark");
    expect(closed.installation.open).toBe(false);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/installations/after-dark/close`);

    const opened = await producer.installations.open("after-dark");
    expect(opened.installation.open).toBe(true);

    const updated = await producer.installations.update({ installation: "after-dark", default: true });
    expect(updated.installation.default).toBe(true);
    expect(last(server).method).toBe("PATCH");
    producer.close();
  });

  it("edits the trigger-in allow list on the patch, whole rather than by delta", async () => {
    const { server, producer } = desk();
    const before = await producer.installations.list();
    // Never set means no external write is allowed, which is the safe default
    // for a rig nobody has decided about yet (5.6).
    expect(before.items[0]?.externalWritable).toBeUndefined();

    const armed = await producer.installations.update({
      installation: "the-caretaker",
      externalWritable: ["world.doors_open", "world.weather"],
    });
    expect(armed.installation.externalWritable).toEqual(["world.doors_open", "world.weather"]);
    expect(last(server)).toMatchObject({ method: "PATCH" });
    expect(last(server).body).toMatchObject({ externalWritable: ["world.doors_open", "world.weather"] });

    // A patch that says nothing about the list leaves it alone: renaming a
    // story must not silently disarm the building.
    const renamed = await producer.installations.update({ installation: "the-caretaker", name: "The Caretaker by day" });
    expect(renamed.installation.externalWritable).toEqual(["world.doors_open", "world.weather"]);

    // An empty array is the list cleared, said out loud.
    const cleared = await producer.installations.update({ installation: "the-caretaker", externalWritable: [] });
    expect(cleared.installation.externalWritable).toEqual([]);
    producer.close();
  });

  it("binds a hand to one of the venue's locations, and unbinds it", async () => {
    const { server, producer } = desk();
    const before = await producer.bindings.list("the-caretaker");
    expect(before.bindings.map((b) => b.hand)).toContain("at-the-door");

    const bound = await producer.bindings.bind({
      installation: "the-caretaker", hand: "at-the-window", location: "the-door",
    });
    expect(bound.binding.location).toBe("the-door");
    expect(last(server)).toMatchObject({
      method: "PUT",
      path: `${WIRE_CONSOLE_PATH}/installations/the-caretaker/bindings/at-the-window`,
    });

    const gone = await producer.bindings.unbind({ installation: "the-caretaker", hand: "at-the-window" });
    expect(gone.unboundAt).toBeTruthy();
    expect(last(server).method).toBe("DELETE");
    producer.close();
  });
});

describe("principals, bundles, durable state and bridges", () => {
  it("pairs a principal, lists, relabels and revokes", async () => {
    const { server, producer } = desk();
    const paired = await producer.principals.pair({ role: "designer", label: "Sam" });
    expect(paired.code).toMatch(/^[A-Z0-9-]{8,}$/);
    // The KEY is never here: it is minted to the device that redeems the code.
    expect(JSON.stringify(paired)).not.toContain("key");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/principals/pair`);

    const page = await producer.principals.list({ role: "designer" });
    expect(page.items.some((p) => p.principal === paired.principal.principal)).toBe(true);

    const named = await producer.principals.relabel({ principal: paired.principal.principal, label: "Sam O." });
    expect(named.principal.label).toBe("Sam O.");
    expect(last(server).method).toBe("PATCH");

    const revoked = await producer.principals.revoke(paired.principal.principal);
    expect(revoked.principal.revokedAt).toBeTruthy();
    producer.close();
  });

  it("uploads, stages, previews, goes live, hot-swaps and rolls back", async () => {
    const { server, producer } = desk();
    const uploaded = await producer.bundles.upload({
      installation: "the-caretaker", bundle: "YnVuZGxl", stage: true,
    });
    expect(uploaded.bundle.state).toBe("staged");
    expect(last(server)).toMatchObject({ method: "POST", path: `${WIRE_CONSOLE_PATH}/bundles` });

    const list = await producer.bundles.list({ installation: "the-caretaker" });
    expect(list.items.length).toBeGreaterThan(1);

    const staged = await producer.bundles.stage(uploaded.bundle.id);
    expect(staged.bundle.state).toBe("staged");

    const preview = await producer.bundles.previewSwap(uploaded.bundle.id);
    expect(preview.build.project).toBe("this-room");
    // Pure, so no key: the wire asks for one on every other bundle verb.
    expect(last(server).idempotencyKey).toBeUndefined();

    const live = await producer.bundles.goLive({ build: uploaded.bundle.id, acknowledged: [] });
    expect(live.bundle.state).toBe("live");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/bundles/${uploaded.bundle.id}/go-live`);

    const swapped = await producer.bundles.hotSwap({ build: uploaded.bundle.id });
    expect(swapped.seq).toBeGreaterThan(0);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/bundles/${uploaded.bundle.id}/hot-swap`);

    const back = await producer.bundles.rollback({ installation: "the-caretaker" });
    expect(back.bundle.state).toBe("live");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/bundles/rollback`);
    producer.close();
  });

  it("resets durable state behind the typed confirmation, and refuses a mismatch", async () => {
    const { server, producer } = desk();
    await expect(producer.durable.reset({
      installation: "the-caretaker", scope: "all", confirm: "the wrong words",
    })).rejects.toMatchObject({ code: "bad_request" });

    const done = await producer.durable.reset({
      installation: "the-caretaker", scope: "pockets", confirm: "The Caretaker",
    });
    expect(done.scope).toBe("pockets");
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/durable/reset`);
    producer.close();
  });

  it("lists, configures and test-fires a bridge", async () => {
    const { server, producer } = desk();
    const bridges = await producer.bridges.list("the-caretaker");
    expect(bridges.bridges.map((b) => b.id)).toContain("the-lights");

    const configured = await producer.bridges.configure({
      installation: "the-caretaker", bridge: "the-lights", enabled: true, hands: ["at-the-door"],
    });
    expect(configured.bridge.enabled).toBe(true);
    expect(last(server)).toMatchObject({ method: "PUT", path: `${WIRE_CONSOLE_PATH}/bridges/the-lights` });

    // "The light desk did not answer" is an answer, not a broken request.
    const fired = await producer.bridges.testFire({ bridge: "the-lights" });
    expect(fired.ok).toBe(true);
    const dead = await producer.bridges.testFire({ bridge: "the-dead-desk" });
    expect(dead.ok).toBe(false);
    expect(dead.detail).toBeTruthy();
    producer.close();
  });
});

describe("messages", () => {
  it("broadcasts to an audience, lists and acks", async () => {
    const { server, producer } = desk();
    const sent = await producer.messages.broadcast({
      installation: "the-caretaker",
      body: "five minutes",
      priority: "cue",
      audience: { to: "kind", kind: "crew" },
      ackRequired: true,
    });
    expect(sent.delivered).toBeGreaterThan(0);
    expect(last(server).path).toBe(`${WIRE_CONSOLE_PATH}/messages`);

    const listed = await producer.messages.list();
    expect(listed.messages.map((m) => m.body)).toContain("five minutes");
    expect(last(server).path).toBe("/v1/messages");

    const acked = await producer.messages.ack(sent.message.id);
    expect(acked.acked).toBe(1);
    producer.close();
  });

  it("reads the whole sent log with its counts, which the inbox is not", async () => {
    const { server, producer } = desk();
    const sent = await producer.messages.broadcast({
      installation: "the-caretaker",
      body: "places",
      priority: "cue",
      audience: { to: "kind", kind: "crew" },
      ackRequired: true,
    });
    await producer.messages.ack(sent.message.id);

    const log = await producer.messages.log({ installation: "the-caretaker" });
    expect(last(server)).toMatchObject({ method: "GET" });
    expect(last(server).path).toContain(`${WIRE_CONSOLE_PATH}/messages?`);
    const line = log.messages.find((m) => m.id === sent.message.id);
    // "4 of 5 in the forest have seen it": the denominator is what the message
    // went out to, kept from send time, and the numerator is who has answered.
    expect(line?.delivered).toBe(sent.delivered);
    expect(line?.acknowledged).toBe(1);

    // The INBOX is a different question and a different route, and a station's
    // own copy of a message carries neither count.
    const inbox = await producer.messages.list();
    expect(last(server).path).toBe("/v1/messages");
    expect(inbox.messages.find((m) => m.id === sent.message.id)?.delivered).toBeUndefined();
    producer.close();
  });
});

describe("the monitor stream", () => {
  it("asks for monitor scope, and does not open until it is started", async () => {
    const { server, producer } = desk();
    await settle();
    expect(server.streams).toBe(0);
    expect(server.requests.some((r) => r.path === "/v1/stream-ticket")).toBe(false);

    producer.monitor.start();
    await settle();
    const ticket = server.requests.find((r) => r.path === "/v1/stream-ticket");
    expect(ticket?.body).toEqual({ monitor: true });
    expect(ticket?.bearer).toBe("producer");
    expect(producer.monitor.connection).toBe("live");
    producer.close();
    expect(server.streams).toBe(0);
  });

  it("refuses monitor scope to a station key, and says so instead of holding", async () => {
    const { server, client } = desk();
    const wrong = client.connectProducer("station-key");
    wrong.monitor.start();
    await settle();
    expect(wrong.monitor.refusal?.code).toBe("wrong_role");
    expect(wrong.monitor.connection).toBe("disconnected");
    expect(server.streams).toBe(0);
    wrong.close();
  });

  it("hands each event to the subscription for its kind, and to nothing else", async () => {
    const { server, producer } = desk();
    producer.monitor.start();
    await settle();

    const world: WireEvent[] = [];
    const visits: WireEvent[] = [];
    const boards: WireEvent[] = [];
    producer.monitor.onWorld((e) => world.push(e));
    producer.monitor.onVisit((e) => visits.push(e));
    producer.monitor.onBoard((e) => boards.push(e));

    server.emit({
      type: "world",
      installation: "the-caretaker",
      path: CLOCK_PHASE,
      value: "evening",
      actor: { kind: "producer", label: "Priya (producer)" },
    } as never);
    server.emit({
      type: "visit",
      flow: "party-1",
      installation: "the-caretaker",
      visit: "visit-1",
      phase: "opened",
    } as never);
    await settle();

    expect(world).toHaveLength(1);
    expect(visits).toHaveLength(1);
    expect(boards).toHaveLength(0);
    producer.close();
  });

  it("sees every flow, which is what monitor scope is for", async () => {
    const { server, producer } = desk();
    producer.monitor.start();
    await settle();
    const flows: string[] = [];
    producer.monitor.onBoard((e) => flows.push(e.flow));
    server.emit({ type: "board", flow: "party-1", visit: "visit-1", board: {} } as never);
    server.emit({ type: "board", flow: "party-999", visit: "visit-999", board: {} } as never);
    await settle();
    expect(flows).toEqual(["party-1", "party-999"]);
    producer.close();
  });

  it("merges everything into one timeline the console can render, newest last", async () => {
    const { server, producer } = desk();
    producer.monitor.start();
    await settle();

    let latest: { summary: string }[] = [];
    producer.monitor.onTimeline((entries) => { latest = entries; });
    server.emit({
      type: "world",
      installation: "the-caretaker",
      path: CLOCK_PHASE,
      value: "evening",
      actor: { kind: "producer", label: "Priya (producer)" },
    } as never);
    server.emit({
      type: "run",
      installation: "the-caretaker",
      phase: "paused",
      run: { run: "run-1", build: { project: "p", version: "1", hash: "h" }, seed: 1, startedAt: "2025-08-24T01:46:40.000Z", state: "paused" },
    } as never);
    await settle();

    expect(producer.monitor.timeline).toHaveLength(2);
    expect(latest).toHaveLength(2);
    expect(latest[0]?.summary).toContain("world.time_phase");
    expect(latest[0]?.summary).toContain("Priya (producer)");
    expect(latest[1]?.summary).toContain("paused");
    // Every entry carries the raw event, so a console that wants more than the
    // line has it without a second subscription.
    expect(producer.monitor.timeline[1]?.event.type).toBe("run");
    producer.close();
  });

  it("keeps the timeline bounded, because a run is a day long", async () => {
    const { server, producer } = desk({ ringSize: 4 });
    producer.monitor.start();
    await settle();
    for (let i = 0; i < 12; i++) {
      server.emit({ type: "presence", presence: { station: `crew-${i}`, kind: "crew", since: "2025-08-24T01:46:40.000Z" } } as never);
    }
    await settle();
    expect(producer.monitor.timeline.length).toBeLessThanOrEqual(12);
    expect(producer.monitor.timeline.at(-1)?.summary).toContain("crew-11");
    producer.close();
  });
});

describe("a producer is never held", () => {
  it("refuses a mutation the moment the network is away, rather than queueing it", async () => {
    const { server, producer } = desk();
    server.offline = true;
    const before = Date.now();
    const err = await producer.world
      .write({ installation: "the-caretaker", path: CLOCK_PHASE, value: "evening" })
      .catch((e: unknown) => e);
    // No timer was advanced and none was needed: nothing backed off, because
    // nothing was held.
    expect(Date.now() - before).toBeLessThan(1000);
    expect(err).toBeInstanceOf(ClientError);
    expect(err).toMatchObject({ code: "offline", status: 0 });
    expect((err as ClientError).offline).toBe(true);
    producer.close();
  });

  it("refuses everything queued behind it too, since there is no queue at all", async () => {
    const { server, producer } = desk();
    server.offline = true;
    const results = await Promise.allSettled([
      producer.runs.hold("run-1"),
      producer.visits.park("visit-1"),
      producer.durable.reset({ installation: "the-caretaker", scope: "all", confirm: "The Caretaker" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    server.offline = false;
    // And nothing is sent late: the commands were never kept.
    await settle();
    expect(server.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
    producer.close();
  });

  it("still holds the TIMELINE when the stream goes, which is a different claim", async () => {
    const { server, producer } = desk();
    producer.monitor.start();
    await settle();
    expect(producer.monitor.connection).toBe("live");
    server.drop();
    await settle();
    // `held` here says the timeline is stale, never that a command is waiting.
    expect(producer.monitor.connection).toBe("held");
    producer.close();
  });
});
