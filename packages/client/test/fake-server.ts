// ---------------------------------------------------------------------------
// A fake Storylet Server: the station and party routes of wire 6.4, in memory,
// over the wire's own types.
//
// The audit lesson this package exists to answer is that BOTH ends mocking the
// other is how six shape mismatches passed two green suites. So this fake is
// written against `@storylet-studio/wire` and nothing else: every response it
// builds is typed as the wire declares it, and a field renamed there is a
// compile error here. It is not a second definition of the protocol; it is a
// consumer of the one definition, exactly as the real server will be.
//
// It answers `fetch`, it serves an `EventSource` double with a per-run ring
// buffer and `Last-Event-ID` resume, and it can be taken away mid-command
// (`offline`) or have its streams dropped (`drop()`), which is how degraded
// mode is tested without a wifi router.
//
// The content is a caretaker's room: three locations, three hands, six cards.
// Small on purpose; the corpus is where content behaviour is proved, and this
// file is where the WIRE is.
// ---------------------------------------------------------------------------

import { IDEMPOTENCY_HEADER, WIRE_VERSION } from "@storylet-studio/wire";
import type {
  AckMessageResponse, AttachAtLocationResponse, BoardView, ChooseInstallationResponse,
  ClaimPartyRequest, ClaimPartyResponse, CreateStreamTicketResponse, DealRequest, DealResponse,
  DealtCardView, DetachStationResponse, GetBoardResponse, GetOutcomesResponse,
  GetPropertiesResponse, GetWorldResponse, HandshakeRequest, HandshakeResponse, HelloResponse,
  InstallationView, IssueCredentialRequest, IssueCredentialResponse, ListMessagesResponse,
  LocationView, MessageView, MintPartyRequest, MintPartyResponse, OpenVisitRequest,
  OpenVisitResponse, ParkVisitResponse, PeekRequest, PeekResponse, PlayRequest, PlayResponse,
  PresenceView, PropertyView, RunView, SendMessageRequest, SendMessageResponse, SetPresenceRequest,
  SetPresenceResponse, StationView, TurnsView, VenueView, VisitView, WireError, WireErrorCode,
  WireEvent,
} from "@storylet-studio/wire";
import type { EventSourceCtor, EventSourceLike, FetchInit, FetchLike, FetchResponse } from "../src/index.js";

// --- the room ----------------------------------------------------------------

const VENUE: VenueView = {
  venue: "this-room",
  name: "This Room",
  plan: { width: 800, height: 520 },
};

const LOCATIONS: LocationView[] = [
  { location: "the-door", venue: "this-room", label: "The door", x: 80, y: 260, code: "http://venue.local/at/this-room/the-door" },
  { location: "the-window", venue: "this-room", label: "The window", x: 400, y: 90, code: "http://venue.local/at/this-room/the-window" },
  { location: "the-table", venue: "this-room", label: "The table", x: 420, y: 380, code: "http://venue.local/at/this-room/the-table" },
];

const CARETAKER: InstallationView = {
  installation: "the-caretaker",
  name: "The Caretaker",
  open: true,
  walkUp: true,
  default: true,
};
const AFTER_DARK: InstallationView = {
  installation: "after-dark",
  name: "After Dark",
  open: true,
  walkUp: true,
};

/** Which hand each location deals, per installation. The venue's half of the
 *  two levels (wire 4a): the same wall, two stories. */
const BINDINGS: Record<string, Record<string, string>> = {
  "the-caretaker": { "the-door": "at-the-door", "the-window": "at-the-window", "the-table": "at-the-table" },
  "after-dark": { "the-door": "the-locked-door" },
};

/** The deck each hand deals from, in order. */
const DECKS: Record<string, DealtCardView[]> = {
  "at-the-door": [
    { id: "who-let-you-in", title: "Who let you in?", purpose: "The opening beat: establish that somebody is expected.", fields: { prompt: "Look them up and down. Do not smile yet." } },
    { id: "the-key-under-the-mat", title: "The key under the mat", purpose: "The scarce thing. Only the first party gets it.", fields: { prompt: "Hand over the key, once." } },
  ],
  "at-the-window": [
    { id: "the-weather-outside", title: "The weather outside", purpose: "A beat that reads differently by phase.", fields: { prompt: "Describe the weather as it is right now." } },
  ],
  "at-the-table": [
    { id: "what-you-brought", title: "What you brought", purpose: "Pays off whatever the door put in the pocket.", fields: { prompt: "Ask what they picked up on the way in." } },
  ],
  "the-locked-door": [
    { id: "not-tonight", title: "Not tonight", purpose: "The after-dark story's own opening.", fields: {} },
  ],
};

const OUTCOMES: Record<string, { id: string; title: string; available: boolean }[]> = {
  "who-let-you-in": [
    { id: "say-nothing", title: "Say nothing", available: true },
    { id: "give-a-name", title: "Give a name", available: true },
    { id: "show-the-key", title: "Show the key", available: false },
  ],
  "the-key-under-the-mat": [{ id: "take-it", title: "Take it", available: true }],
  "the-weather-outside": [{ id: "watch-it", title: "Watch it", available: true }],
  "what-you-brought": [{ id: "put-it-down", title: "Put it down", available: true }],
  "not-tonight": [{ id: "turn-away", title: "Turn away", available: true }],
};

// --- state -------------------------------------------------------------------

interface Party {
  id: string;
  token: string;
  callSign?: string;
  claimed: boolean;
  installation: string;
}

interface Visit {
  id: string;
  party: string;
  installation: string;
  board: BoardView;
  turns: TurnsView;
  properties: PropertyView[];
  stations: string[];
}

/** One recorded request, which is what the frames fixture is made of. */
export interface RecordedRequest {
  method: string;
  /** The path below the origin, query included: `/v1/visits/v1/play`. */
  path: string;
  /** The bearer's KIND, never its value: a fixture must not carry secrets. */
  bearer: "none" | "station" | "party";
  /** The `Idempotency-Key`, when the call carried one. */
  idempotencyKey?: string;
  body?: unknown;
}

export interface FakeServerOptions {
  /** The origin the client is pointed at. */
  base?: string;
  /** The station key this server accepts. */
  stationKey?: string;
  /** How many events the run's ring buffer holds. Small on purpose: a test
   *  that proves `replay-lost` should not have to send a thousand events. */
  ringSize?: number;
  /** Open a second story, so a walk-up with no credential is offered a
   *  chooser rather than routed. */
  twoStories?: boolean;
}

export interface FakeServer {
  /** Hand this to `createClient({ fetch })`. */
  readonly fetch: FetchLike;
  /** Hand this to `createClient({ EventSource })`. */
  readonly EventSource: EventSourceCtor;
  /** Every request the client has made, in order. */
  readonly requests: RecordedRequest[];
  /** Push an event to every open stream, and into the ring buffer. */
  emit(event: Omit<WireEvent, "id" | "at"> & { id?: string; at?: string }): WireEvent;
  /** Drop every open stream, as a wifi blip does. The client sees `error`. */
  drop(): void;
  /** Take the whole server away: `fetch` rejects, streams cannot be opened.
   *  This is the blip that makes the command queue hold. */
  offline: boolean;
  /** Forget the oldest events, so the next resume falls off the buffer and is
   *  answered with `replay-lost`. */
  forgetHistory(): void;
  /** The venue's own facts, for a test that wants to assert against them. */
  readonly venue: VenueView;
  readonly locations: LocationView[];
  /** Mint a claimed party up front, for a returning-visitor test. */
  seedParty(opts?: { installation?: string; callSign?: string; claimed?: boolean }): Party;
  /** How many streams are open right now. */
  readonly streams: number;
}

const now = (): string => new Date(1_756_000_000_000).toISOString();

export function createFakeServer(opts: FakeServerOptions = {}): FakeServer {
  const base = (opts.base ?? "http://venue.local").replace(/\/+$/, "");
  const stationKey = opts.stationKey ?? "station-key";
  const ringSize = opts.ringSize ?? 32;

  const parties = new Map<string, Party>();
  const byToken = new Map<string, Party>();
  const byCallSign = new Map<string, Party>();
  const byExternal = new Map<string, Party>();
  const visits = new Map<string, Visit>();
  const tickets = new Map<string, "station" | "party">();
  const messages: MessageView[] = [];
  const requests: RecordedRequest[] = [];

  let ids = 0;
  const nextId = (prefix: string): string => `${prefix}${++ids}`;
  let eventSeq = 0;
  let ring: WireEvent[] = [];
  let oldestHeld = 1;
  let offline = false;
  const open = new Set<FakeEventSource>();

  const run: RunView = {
    run: "run-1",
    build: { project: "this-room", version: "0.1.0", hash: "0roomhash" },
    seed: 7,
    startedAt: now(),
    state: "live",
  };
  const station: StationView = {
    station: "kiosk-1",
    venue: VENUE.venue,
    label: "The table kiosk",
    kind: "fixed",
    location: "the-table",
    paired: true,
  };
  let presence: PresenceView = { station: station.station, kind: station.kind, location: "the-table", since: now() };

  const installations = (): InstallationView[] => (opts.twoStories === true ? [CARETAKER, AFTER_DARK] : [CARETAKER]);

  // --- events ----------------------------------------------------------------

  const emit: FakeServer["emit"] = (partial) => {
    const event = { ...partial, id: partial.id ?? String(++eventSeq), at: partial.at ?? now() } as WireEvent;
    ring.push(event);
    while (ring.length > ringSize) {
      ring.shift();
      oldestHeld++;
    }
    for (const es of open) es.push(event);
    return event;
  };

  // --- helpers ---------------------------------------------------------------

  const mintParty = (installation: string, callSign: boolean, claimed = false): Party => {
    const id = nextId("party-");
    const party: Party = {
      id,
      token: `token-${id}`,
      claimed,
      installation,
      ...(callSign ? { callSign: `quiet otter ${id.slice(-1)}` } : {}),
    };
    parties.set(id, party);
    byToken.set(party.token, party);
    if (party.callSign !== undefined) byCallSign.set(party.callSign, party);
    return party;
  };

  const openVisitFor = (party: Party): Visit => {
    for (const v of visits.values()) if (v.party === party.id) return v;
    const visit: Visit = {
      id: nextId("visit-"),
      party: party.id,
      installation: party.installation,
      board: {},
      turns: { room: 0 },
      properties: [
        { path: "story.visits", value: 1, type: "number", writable: true, durable: true },
        { path: "world.time_phase", value: "afternoon", type: "string", writable: false, shared: true },
      ],
      stations: [station.station],
    };
    for (const hand of Object.values(BINDINGS[party.installation] ?? {})) visit.board[hand] = [];
    visits.set(visit.id, visit);
    emit({ type: "visit", flow: party.id, installation: visit.installation, visit: visit.id, phase: "opened" } as WireEvent);
    return visit;
  };

  const viewOf = (visit: Visit): VisitView => ({
    visit: visit.id,
    party: visit.party,
    installation: visit.installation,
    ...(parties.get(visit.party)?.callSign !== undefined ? { callSign: parties.get(visit.party)!.callSign! } : {}),
    stations: visit.stations,
    lastCommandAt: now(),
    idle: false,
  });

  const dealInto = (visit: Visit, hands?: string[]): void => {
    const bound = BINDINGS[visit.installation] ?? {};
    const wanted = hands ?? Object.values(bound);
    for (const hand of wanted) {
      const deck = DECKS[hand] ?? [];
      const already = new Set((visit.board[hand] ?? []).map((c) => c.id));
      visit.board[hand] = [...(visit.board[hand] ?? []), ...deck.filter((c) => !already.has(c.id))];
    }
  };

  const fail = (status: number, code: WireErrorCode, message: string): FetchResponse => {
    const body: WireError = { error: { code, message } };
    return { ok: false, status, text: () => Promise.resolve(JSON.stringify(body)) };
  };
  const ok = (body: unknown): FetchResponse => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  });

  // --- the EventSource double ------------------------------------------------
  //
  // A ticket, or no stream: the whole point of wire 6.2, and the rule the old
  // server broke for months. `last` is this client's resume value (there is no
  // header to read on a socket the client opened itself), answered either with
  // the events the ring still holds or with `replay-lost`.

  class FakeEventSource implements EventSourceLike {
    private readonly listeners = new Map<string, (arg: never) => void>();
    private shut = false;

    constructor(url: string) {
      const query = new URLSearchParams(url.split("?")[1] ?? "");
      const ticket = query.get("t") ?? "";
      const last = query.get("last");
      if (offline || !tickets.has(ticket)) {
        queueMicrotask(() => this.fail());
        return;
      }
      open.add(this);
      queueMicrotask(() => {
        if (this.shut) return;
        (this.listeners.get("open") as (() => void) | undefined)?.();
        if (last === null) return;
        const from = Number(last);
        if (from + 1 < oldestHeld) {
          this.push({ type: "replay-lost", at: now(), id: String(eventSeq), from: String(oldestHeld) } as WireEvent);
          return;
        }
        for (const e of ring) if (Number(e.id) > from) this.push(e);
      });
    }

    push(event: WireEvent): void {
      if (this.shut) return;
      const listener = this.listeners.get("message") as ((ev: { data: unknown; lastEventId?: string }) => void) | undefined;
      listener?.({ data: JSON.stringify(event), ...(event.id !== undefined ? { lastEventId: event.id } : {}) });
    }

    fail(): void {
      if (this.shut) return;
      open.delete(this);
      this.shut = true;
      (this.listeners.get("error") as (() => void) | undefined)?.();
    }

    addEventListener(type: "open" | "error", listener: () => void): void;
    addEventListener(type: "message", listener: (ev: { data: unknown; lastEventId?: string }) => void): void;
    addEventListener(type: string, listener: (arg: never) => void): void {
      this.listeners.set(type, listener);
    }

    close(): void {
      open.delete(this);
      this.shut = true;
    }
  }

  // --- fetch -----------------------------------------------------------------

  const server: FakeServer = {
    get offline() { return offline; },
    set offline(next: boolean) { offline = next; },
    requests,
    venue: VENUE,
    locations: LOCATIONS,
    emit,
    get streams() { return open.size; },
    drop() {
      for (const es of [...open]) es.fail();
    },
    forgetHistory() {
      oldestHeld = eventSeq + 1;
      ring = [];
    },
    seedParty(o = {}) {
      const party = mintParty(o.installation ?? CARETAKER.installation, o.callSign !== undefined, o.claimed ?? true);
      if (o.callSign !== undefined) {
        if (party.callSign !== undefined) byCallSign.delete(party.callSign);
        party.callSign = o.callSign;
        byCallSign.set(o.callSign, party);
      }
      return party;
    },

    EventSource: FakeEventSource as unknown as EventSourceCtor,

    fetch: async (url: string, init: FetchInit): Promise<FetchResponse> => {
      if (offline) throw new Error("network unreachable");
      const rel = url.startsWith(base) ? url.slice(base.length) : url;
      const [pathname = "", search = ""] = rel.split("?");
      const query = new URLSearchParams(search);
      const auth = init.headers["Authorization"];
      const token = auth?.startsWith("Bearer ") === true ? auth.slice(7) : undefined;
      const bearer: RecordedRequest["bearer"] = token === undefined
        ? "none"
        : token === stationKey ? "station" : "party";
      const body: unknown = init.body === undefined ? undefined : JSON.parse(init.body);
      const idem = init.headers[IDEMPOTENCY_HEADER];
      requests.push({
        method: init.method,
        path: rel,
        bearer,
        ...(idem !== undefined ? { idempotencyKey: idem } : {}),
        ...(body !== undefined ? { body } : {}),
      });

      const partyOf = (): Party | undefined => (token === undefined ? undefined : byToken.get(token));
      const isStation = token === stationKey;
      const path = pathname.replace(/^\/v1/, "");

      // hello --------------------------------------------------------------
      if (path === "/hello" && init.method === "POST") {
        const party = partyOf();
        const visit = party ? [...visits.values()].find((v) => v.party === party.id) : undefined;
        const res: HelloResponse = {
          server: { version: "0.0.0-fake" },
          wire: WIRE_VERSION,
          venue: VENUE,
          installations: installations(),
          run,
          build: run.build,
          ...(isStation ? { station } : {}),
          ...(visit !== undefined ? { visit: viewOf(visit) } : {}),
        };
        return ok(res);
      }

      // parties --------------------------------------------------------------
      if (path === "/parties" && init.method === "POST") {
        if (!isStation) return fail(401, "needs_station_key", "a station with a key vouches; a phone must hold a token");
        const req = body as MintPartyRequest;
        if (!installations().some((i) => i.installation === req.installation)) {
          return fail(404, "unknown_installation", `this venue does not run ${req.installation}`);
        }
        const party = mintParty(req.installation, req.callSign === true);
        const res: MintPartyResponse = {
          partyId: party.id,
          token: party.token,
          ...(party.callSign !== undefined ? { callSign: party.callSign } : {}),
          ...(req.attach === true ? { visit: viewOf(openVisitFor(party)) } : {}),
        };
        return ok(res);
      }

      const claimMatch = /^\/parties\/([^/]+)\/claim$/.exec(path);
      if (claimMatch && init.method === "POST") {
        const party = parties.get(decodeURIComponent(claimMatch[1] ?? ""));
        if (!party) return fail(404, "unknown_party", "no party by that id");
        const req = body as ClaimPartyRequest;
        party.claimed = true;
        if (req.kind === "callsign" && party.callSign === undefined) {
          party.callSign = "steady heron";
          byCallSign.set(party.callSign, party);
        }
        if (req.kind === "external" && req.externalRef !== undefined) byExternal.set(req.externalRef, party);
        const res: ClaimPartyResponse = {
          partyId: party.id,
          claimed: true,
          ...(req.kind === "token" ? { qr: `${base}/p/${party.token}` } : {}),
          ...(req.kind === "callsign" ? { callSign: party.callSign! } : {}),
          ...(req.kind === "external" ? { externalRef: req.externalRef! } : {}),
        };
        return ok(res);
      }

      const credMatch = /^\/parties\/([^/]+)\/credentials$/.exec(path);
      if (credMatch && init.method === "POST") {
        if (!isStation) return fail(401, "needs_station_key", "credentials are issued by a station with a key");
        const party = parties.get(decodeURIComponent(credMatch[1] ?? ""));
        if (!party) return fail(404, "unknown_party", "no party by that id");
        const req = body as IssueCredentialRequest;
        const id = nextId("cred-");
        const res: IssueCredentialResponse = {
          partyId: party.id,
          credential: { id, kind: req.kind },
          ...(req.kind === "token" ? { token: `${base}/p/${party.token}` } : {}),
          ...(req.kind === "callsign" ? { callSign: "steady heron" } : {}),
          ...(req.kind === "external" && req.externalRef !== undefined ? { externalRef: req.externalRef } : {}),
        };
        if (req.kind === "external" && req.externalRef !== undefined) byExternal.set(req.externalRef, party);
        return ok(res);
      }

      // handshake ------------------------------------------------------------
      if (path === "/handshake" && init.method === "POST") {
        const req = body as HandshakeRequest;
        if (req.credential !== "token" && !isStation) {
          return fail(401, "needs_station_key", "a call sign or a wristband needs a station with a key");
        }
        const party = req.credential === "token"
          ? byToken.get(req.token)
          : req.credential === "callsign" ? byCallSign.get(req.callSign) : byExternal.get(req.externalRef);
        if (!party) return fail(404, "unknown_credential", "that credential is not known here");
        const visit = openVisitFor(party);
        const res: HandshakeResponse = {
          partyId: party.id,
          installation: party.installation,
          visitId: visit.id,
          board: visit.board,
          ...(party.callSign !== undefined ? { callSign: party.callSign } : {}),
          ...(party.claimed ? { returning: true } : {}),
        };
        return ok(res);
      }

      // at a location --------------------------------------------------------
      const chooseMatch = /^\/at\/([^/]+)\/([^/]+)\/choose$/.exec(path);
      if (chooseMatch && init.method === "POST") {
        const req = body as { installation: string };
        // The chooser is drawn for a phone that holds nothing, so the choice
        // MINTS, and the token comes back with the attach: the phone has no
        // other way to learn the bearer every later call must carry (7.1).
        const held = partyOf();
        const party = held ?? mintParty(req.installation, true);
        const visit = openVisitFor(party);
        dealInto(visit, [BINDINGS[party.installation]?.[decodeURIComponent(chooseMatch[2] ?? "")] ?? ""].filter(Boolean));
        const res: ChooseInstallationResponse = {
          installation: party.installation,
          visit: viewOf(visit),
          board: visit.board,
          ...(held === undefined ? { token: party.token } : {}),
        };
        return ok(res);
      }

      const atMatch = /^\/at\/([^/]+)\/([^/]+)$/.exec(path);
      if (atMatch && init.method === "POST") {
        const location = decodeURIComponent(atMatch[2] ?? "");
        if (!LOCATIONS.some((l) => l.location === location)) {
          return fail(404, "unknown_location", `no location called ${location} at this venue`);
        }
        const party = partyOf();
        if (!party) {
          const walkUps = installations().filter((i) => i.walkUp !== false);
          if (walkUps.length > 1) {
            const res: AttachAtLocationResponse = { outcome: "choose", installations: walkUps };
            return ok(res);
          }
          const only = walkUps[0] ?? CARETAKER;
          const minted = mintParty(only.installation, true);
          const visit = openVisitFor(minted);
          dealInto(visit, [BINDINGS[only.installation]?.[location] ?? ""].filter(Boolean));
          const res: AttachAtLocationResponse = {
            outcome: "attached",
            installation: only.installation,
            visit: viewOf(visit),
            board: visit.board,
            // The walk-up minted, so the answer carries the token the phone
            // must keep, exactly as the server does (7.1, 7.2).
            token: minted.token,
          };
          return ok(res);
        }
        const visit = openVisitFor(party);
        dealInto(visit, [BINDINGS[party.installation]?.[location] ?? ""].filter(Boolean));
        const res: AttachAtLocationResponse = {
          outcome: "attached",
          installation: party.installation,
          visit: viewOf(visit),
          board: visit.board,
        };
        return ok(res);
      }

      // presence -------------------------------------------------------------
      if (path === "/stations/me/presence" && init.method === "POST") {
        if (!isStation) return fail(401, "needs_station_key", "presence is a station's fact");
        const req = body as SetPresenceRequest;
        presence = {
          station: station.station,
          kind: station.kind,
          ...(req.location !== undefined ? { location: req.location } : {}),
          since: now(),
        };
        emit({ type: "presence", presence } as WireEvent);
        const res: SetPresenceResponse = { presence, mirrored: [] };
        return ok(res);
      }

      // messages -------------------------------------------------------------
      if (path === "/messages" && init.method === "GET") {
        const since = query.get("since");
        const res: ListMessagesResponse = {
          messages: since === null ? messages : messages.filter((m) => m.at > since),
        };
        return ok(res);
      }
      if (path === "/messages" && init.method === "POST") {
        const req = body as SendMessageRequest;
        const message: MessageView = {
          id: nextId("msg-"),
          body: req.body,
          sender: { kind: "crew", id: station.station, label: station.label },
          priority: req.priority,
          audience: req.audience,
          at: now(),
          ...(req.ackRequired === true ? { ackRequired: true } : {}),
        };
        messages.push(message);
        emit({ type: "message", message } as WireEvent);
        const res: SendMessageResponse = { message };
        return ok(res);
      }
      const ackMatch = /^\/messages\/([^/]+)\/ack$/.exec(path);
      if (ackMatch && init.method === "POST") {
        const res: AckMessageResponse = { id: decodeURIComponent(ackMatch[1] ?? ""), acked: 1, of: 1 };
        return ok(res);
      }

      // the stream -----------------------------------------------------------
      if (path === "/stream-ticket" && init.method === "POST") {
        if (token === undefined) return fail(401, "unauthorized", "no bearer");
        const ticket = nextId("ticket-");
        tickets.set(ticket, isStation ? "station" : "party");
        const res: CreateStreamTicketResponse = { ticket, expiresAt: now() };
        return ok(res);
      }

      // the world ------------------------------------------------------------
      if (path === "/world" && init.method === "GET") {
        const res: GetWorldResponse = {
          properties: [
            { path: "world.time_phase", value: "afternoon", type: "string", writable: false, shared: true },
          ],
          clocks: { time_wall: now(), time_show: 120, time_phase: "afternoon" },
        };
        return ok(res);
      }

      // visits ---------------------------------------------------------------
      if (path === "/visits" && init.method === "POST") {
        const req = body as OpenVisitRequest;
        const party = parties.get(req.party);
        if (!party) return fail(404, "unknown_party", "no party by that id");
        const visit = openVisitFor(party);
        const res: OpenVisitResponse = {
          visit: viewOf(visit),
          ...(req.attach !== false ? { board: visit.board } : {}),
          resumed: false,
        };
        return ok(res);
      }

      const visitMatch = /^\/visits\/([^/]+)(\/.*)?$/.exec(path);
      if (visitMatch) {
        const visit = visits.get(decodeURIComponent(visitMatch[1] ?? ""));
        if (!visit) return fail(404, "unknown_visit", "that visit is closed or was never opened");
        const rest = visitMatch[2] ?? "";

        if (rest === "" && init.method === "DELETE") {
          visits.delete(visit.id);
          emit({ type: "visit", flow: visit.party, installation: visit.installation, visit: visit.id, phase: "parked" } as WireEvent);
          const res: ParkVisitResponse = { visit: visit.id, parkedAt: now() };
          return ok(res);
        }
        if (rest === "/stations/me" && init.method === "DELETE") {
          visit.stations = visit.stations.filter((s) => s !== station.station);
          emit({ type: "visit", flow: visit.party, installation: visit.installation, visit: visit.id, phase: "detached", station: station.station } as WireEvent);
          const res: DetachStationResponse = { visit: visit.id, station: station.station, stations: visit.stations };
          return ok(res);
        }
        if (rest === "/board" && init.method === "GET") {
          const res: GetBoardResponse = {
            board: visit.board,
            turns: visit.turns,
            clocks: { time_wall: now(), time_show: 120, time_phase: "afternoon" },
          };
          return ok(res);
        }
        if (rest === "/properties" && init.method === "GET") {
          const res: GetPropertiesResponse = { properties: visit.properties };
          return ok(res);
        }
        if (rest === "/deal" && init.method === "POST") {
          const req = body as DealRequest;
          dealInto(visit, req.hands);
          emit({ type: "board", flow: visit.party, installation: visit.installation, visit: visit.id, board: visit.board, turns: visit.turns } as WireEvent);
          const res: DealResponse = { board: visit.board, turns: visit.turns };
          return ok(res);
        }
        if (rest === "/peek" && init.method === "POST") {
          const req = body as PeekRequest;
          const res: PeekResponse = { box: req.box, cards: (DECKS["at-the-door"] ?? []).slice(0, req.n ?? 1) };
          return ok(res);
        }
        if (rest === "/play" && init.method === "POST") {
          const req = body as PlayRequest;
          const held = visit.board[req.hand] ?? [];
          if (!held.some((c) => c.id === req.card)) {
            return fail(409, "not_dealt", `${req.card} is not on this table`);
          }
          if (!(OUTCOMES[req.card] ?? []).some((o) => o.id === req.outcome && o.available)) {
            return fail(409, "gated", `${req.outcome} is not available on ${req.card} right now`);
          }
          visit.board[req.hand] = held.filter((c) => c.id !== req.card);
          visit.turns = { ...visit.turns, room: (visit.turns["room"] ?? 0) + 1 };
          const visits1 = visit.properties.find((p) => p.path === "story.visits");
          if (visits1) visits1.value = Number(visits1.value) + 1;
          emit({ type: "board", flow: visit.party, installation: visit.installation, visit: visit.id, board: visit.board, turns: visit.turns } as WireEvent);
          const res: PlayResponse = {
            board: visit.board,
            turns: visit.turns,
            writes: [{ path: "story.visits", value: visits1?.value ?? 1 }],
          };
          return ok(res);
        }
        const outcomeMatch = /^\/cards\/([^/]+)\/outcomes$/.exec(rest);
        if (outcomeMatch && init.method === "GET") {
          const card = decodeURIComponent(outcomeMatch[1] ?? "");
          const res: GetOutcomesResponse = { card, outcomes: OUTCOMES[card] ?? [] };
          return ok(res);
        }
      }

      return fail(404, "bad_request", `the fake server has no route for ${init.method} ${path}`);
    },
  };

  return server;
}

/** Timers a test drives by hand, so a backoff is proved in microseconds. */
export interface ManualTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Run every timer due at or before `ms` from now, oldest first. */
  advance(ms: number): void;
  /** Run every pending timer, whatever its delay. */
  runAll(): void;
  readonly pending: number;
}

export function manualTimers(): ManualTimers {
  let clock = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      const handle = ++seq;
      due.set(handle, { at: clock + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      due.delete(handle as number);
    },
    advance(ms) {
      clock += ms;
      for (const [handle, t] of [...due]) {
        if (t.at > clock) continue;
        due.delete(handle);
        t.fn();
      }
    },
    runAll() {
      for (const [handle, t] of [...due]) {
        due.delete(handle);
        t.fn();
      }
    },
    get pending() { return due.size; },
  };
}
