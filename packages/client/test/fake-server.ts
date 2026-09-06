// ---------------------------------------------------------------------------
// A fake Storylet Server: the station and party routes of wire 6.4 and the
// producer's console routes of 6.5, in memory, over the wire's own types.
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
//
// The console half answers the same way and under the same rule: every reply
// is typed as `@storylet-studio/wire` declares it. It also keeps the roles
// honest, because a client that is never refused proves nothing: a station key
// on a console route is `wrong_role`, and so is a station key asking for
// monitor scope on the stream.
// ---------------------------------------------------------------------------

import {
  CLOCK_PHASE, CLOCK_SHOW, CLOCK_WALL, HOUSE_FLOW, IDEMPOTENCY_HEADER, WIRE_VERSION,
} from "@storylet-studio/wire";
import type { LoadReport, ScalarValue } from "@storylet-studio/model";
import type {
  AckMessageResponse, AdvanceHouseRequest, AdvanceHouseResponse, AdvanceTurnsRequest,
  AdvanceTurnsResponse, AttachAtLocationResponse, BindHandRequest, BindHandResponse,
  BindStationRequest, BindStationResponse, BindStationToLocationRequest,
  BindStationToLocationResponse, BindingView, BoardView, BridgeView, BroadcastMessageRequest,
  BroadcastMessageResponse, BundleView, ChooseInstallationResponse,
  ClaimPartyRequest, ClaimPartyResponse, CloseInstallationResponse, ConfigureBridgeRequest,
  ConfigureBridgeResponse, CreateLocationRequest, CreateLocationResponse, FireCueResponse,
  CreateStreamTicketRequest, CreateStreamTicketResponse, CredentialView, DealHouseRequest,
  DealHouseResponse, DealRequest, DealResponse,
  DealtCardView, DetachStationResponse, DetachVisitStationResponse, EditPocketRequest,
  EditPocketResponse, EndRunResponse, EvictCardRequest, EvictCardResponse,
  ForceDealRequest, ForceDealResponse, ForcePlayRequest, ForcePlayResponse,
  ForgetPartyResponse, GetBoardResponse, GetCueListResponse, GetHouseResponse, GetJournalResponse,
  GetOutcomesResponse,
  GetPartyResponse, GetPropertiesResponse, GetVenueResponse, GetVisitLensResponse, GetWorldResponse,
  GoLiveRequest, GoLiveResponse, HandshakeRequest, HandshakeResponse, HelloResponse,
  HotSwapRequest, HotSwapResponse, InstallationView, IssueCredentialRequest,
  IssueCredentialResponse, JournalEntry, ListBindingsResponse, ListBridgesResponse,
  ListBundlesResponse, ListInstallationsResponse, ListLocationsResponse, ListMessagesResponse,
  ListPartiesResponse, ListPresenceResponse, ListPrincipalsResponse, ListRunsResponse,
  ListSentMessagesResponse, ListVisitsResponse, LocationView, MessageAudience, MessageView,
  MintPartyRequest, MintPartyResponse,
  MoveCredentialRequest, MoveCredentialResponse, OpenInstallationResponse, OpenVisitRequest,
  OpenVisitResponse, Page, PairPrincipalRequest, PairPrincipalResponse, ParkVisitConsoleResponse,
  ParkVisitResponse, PartyView, PauseRunResponse, PeekRequest, PeekResponse, PlayHouseRequest,
  PlayHouseResponse, PlayRequest, PlayResponse, PresenceView, PreviewSwapResponse, PrincipalView,
  PrintLocationSheetRequest, PrintLocationSheetResponse, PropertyView, PutCueListRequest,
  PutCueListResponse, ReadWorldResponse, RelabelPrincipalRequest, RelabelPrincipalResponse,
  ResetDurableRequest, ResetDurableResponse, RestoreFromJournalRequest, RestoreFromJournalResponse,
  ResumeRunResponse, RevokeCredentialResponse, RevokePrincipalResponse, RollbackBundleRequest,
  RollbackBundleResponse, RunView, SendMessageRequest, SendMessageResponse, SetPresenceRequest,
  SetPresenceResponse, SetPropertyRequest, SetPropertyResponse, SnapshotRunResponse,
  StageBundleResponse, StartRunRequest, StartRunResponse, StationView, TestFireBridgeRequest,
  TestFireBridgeResponse, TurnsView, UnbindHandResponse, UpdateInstallationRequest,
  UpdateInstallationResponse, UpdateLocationRequest, UpdateLocationResponse, UploadBundleRequest,
  UploadBundleResponse, VenueView, VisitView, WireError, WireErrorCode, WireEvent,
  WriteWorldRequest, WriteWorldResponse,
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
 *  two levels (wire 4a): the same wall, two stories.
 *
 *  COPIED per server below, because the console binds and unbinds hands and a
 *  module-level object mutated by one test is a module-level object the next
 *  test inherits. */
const BINDINGS: Record<string, Record<string, string>> = {
  "the-caretaker": { "the-door": "at-the-door", "the-window": "at-the-window", "the-table": "at-the-table" },
  "after-dark": { "the-door": "the-locked-door" },
};

/** The zone each of the venue's locations falls in, per installation (4a).
 *
 *  A ZONE IS A STORY'S WORD for a part of its map, and the server derives one
 *  from the location a device reported: the device knows only where it is. Two
 *  locations share `the-parlour` on purpose, because that is the whole point
 *  of a zone-addressed message - "everyone inside" reaches a performer at the
 *  window and a performer at the table with one send (6.7).
 */
const ZONES: Record<string, Record<string, string>> = {
  "the-caretaker": { "the-door": "the-threshold", "the-window": "the-parlour", "the-table": "the-parlour" },
  "after-dark": { "the-door": "the-threshold" },
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
  "the-bell": [{ id: "ring-it", title: "Ring it", available: true }],
};

/** The house's own hand: the venue's flow, never a player's (wire 5.5). Only
 *  the console deals it. */
const HOUSE_DECK: DealtCardView[] = [
  { id: "the-bell", title: "The bell", purpose: "The house's own beat: everybody hears it.", fields: { cue: "bell" } },
];

// --- state -------------------------------------------------------------------

interface Party {
  id: string;
  /** The credential this party arrived with. A walk-up's is a DAY PASS: it
   *  expires at run end, claimed or not (7.1). */
  token: string;
  /** Whether {@link Party.token} dies with the run. */
  dayPass: boolean;
  /** The permanent credential a claim minted, which is the one that comes
   *  back (7.3). A different string from the day pass on purpose: a fake that
   *  hands the same token back cannot show the defect that made this test. */
  keepsake?: string;
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
  bearer: "none" | "station" | "party" | "producer";
  /** The `Idempotency-Key`, when the call carried one. */
  idempotencyKey?: string;
  body?: unknown;
}

export interface FakeServerOptions {
  /** The origin the client is pointed at. */
  base?: string;
  /** The station key this server accepts. */
  stationKey?: string;
  /** The producer principal's key this server accepts on `/v1/console` and for
   *  monitor scope on the stream. Any other bearer there is `wrong_role`. */
  producerKey?: string;
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
  /** End the run: every day pass expires, and a party that never claimed is
   *  refused from then on (7.1). The claim's keepsake survives it, which is
   *  the property the companion page's own storage has to keep. */
  endRun(): void;
  /** The venue's own facts, for a test that wants to assert against them. */
  readonly venue: VenueView;
  readonly locations: LocationView[];
  /** Mint a claimed party up front, for a returning-visitor test. */
  seedParty(opts?: { installation?: string; callSign?: string; claimed?: boolean }): Party;
  /** Mint a party, open its visit and deal its hands, for a console that needs
   *  somebody on the floor to look at. Returns the visit's id. */
  seedVisit(opts?: { installation?: string }): string;
  /** Log a message from the control room and deliver it, exactly as the
   *  console's broadcast route does (6.7). For a test about the RECEIVING
   *  end, which is most of them: a crew handset's tray is fed by producers
   *  this fake has no second connection for. */
  seedMessage(opts: {
    body: string;
    audience: MessageAudience;
    priority?: MessageView["priority"];
    ackRequired?: boolean;
  }): MessageView;
  /** Where the fake's one station says it is, and the zone its installation
   *  derives from that. A test that broadcasts to a zone needs to know
   *  which. */
  readonly presence: PresenceView;
  /** How many streams are open right now. */
  readonly streams: number;
}

const now = (): string => new Date(1_756_000_000_000).toISOString();

/**
 * The instant a MESSAGE is logged at, one second on from the last.
 *
 * Everything else in this fake reads one frozen instant, so no frame depends
 * on a clock. Messages cannot: `GET /v1/messages?since=` is answered by
 * comparing instants, and a tray whose every message shared one would make the
 * catch-up either everything or nothing, whatever the cursor said. Still
 * deterministic, and still not the wall clock: a counter from the same epoch.
 *
 * PER SERVER, like the bindings and for the same reason: a counter at module
 * level is one test's state leaking into the next one's.
 */
const messageClock = (): (() => string) => {
  let ticks = 0;
  return () => new Date(1_756_000_000_000 + ++ticks * 1000).toISOString();
};

/** The wall clock this fake reads back: minutes since midnight, local to the
 *  venue, which is what `time_wall` is (10.1). 872 is 14:32. A literal rather
 *  than something derived from `now()`, so no frame depends on the timezone
 *  the suite happens to run in. */
const WALL_MINUTES = 872;

export function createFakeServer(opts: FakeServerOptions = {}): FakeServer {
  const base = (opts.base ?? "http://venue.local").replace(/\/+$/, "");
  const stationKey = opts.stationKey ?? "station-key";
  const producerKey = opts.producerKey ?? "producer-key";
  const ringSize = opts.ringSize ?? 32;

  const parties = new Map<string, Party>();
  const byToken = new Map<string, Party>();
  /** Day passes the run took back, kept so the refusal can say WHICH refusal
   *  it is: "not known here" and "that run has ended" are different answers to
   *  a party standing at a wall. */
  const retired = new Set<string>();
  const byCallSign = new Map<string, Party>();
  const byExternal = new Map<string, Party>();
  const visits = new Map<string, Visit>();
  const tickets = new Map<string, "station" | "party" | "producer" | "monitor">();
  const messages: MessageView[] = [];
  const messageNow = messageClock();
  const requests: RecordedRequest[] = [];

  let ids = 0;
  const nextId = (prefix: string): string => `${prefix}${++ids}`;
  /** A SECOND counter, for everything only the console mints. The station
   *  fixture's frames name `party-1` and `visit-2`, so a console id drawn from
   *  the same counter would renumber a committed contract from a distance. */
  let consoleIds = 0;
  const nextConsoleId = (prefix: string): string => `${prefix}${++consoleIds}`;
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
  // The zone is spelt out rather than derived, because `zoneAt` below is
  // declared after this and a device standing somewhere is the state this
  // server starts in. `ZONES` is the one place the pairing is decided; this
  // literal must agree with it.
  let presence: PresenceView = {
    station: station.station, kind: station.kind, location: "the-table", zone: "the-parlour", since: now(),
  };

  // --- what the console may change, and therefore what is per-server --------

  /** The stories this venue runs. Copied, because the console opens, closes
   *  and re-defaults them. */
  const stories: InstallationView[] = opts.twoStories === true
    ? [{ ...CARETAKER }, { ...AFTER_DARK }]
    : [{ ...CARETAKER }];
  /** The OPEN ones, which is what `hello` lists and a walk-up is offered. */
  const installations = (): InstallationView[] => stories.filter((i) => i.open !== false);
  const storyOf = (id: string): InstallationView | undefined => stories.find((i) => i.installation === id);

  const bindings: Record<string, Record<string, string>> =
    JSON.parse(JSON.stringify(BINDINGS)) as Record<string, Record<string, string>>;
  const locations: LocationView[] = LOCATIONS.map((l) => ({ ...l }));

  /** Earlier runs, so a list has more than one page in it. `run` is the live
   *  one and is always first: the console reads recent-first. */
  const runs: RunView[] = [
    run,
    { run: "run-0", build: run.build, seed: 6, startedAt: now(), state: "ended" },
    { run: "run-00", build: run.build, seed: 5, startedAt: now(), state: "ended" },
  ];

  /** The journal: appended before anything is applied, which is what makes it
   *  the truth (wire 5.2). Short here; it is the SHAPE that is the contract. */
  const journal: JournalEntry[] = [
    { seq: 1, at: now(), actor: { kind: "system" }, command: { kind: "run.start", run: run.run, seed: run.seed, build: run.build } },
    { seq: 2, at: now(), actor: { kind: "producer", label: "Priya (producer)" }, command: { kind: "set", path: CLOCK_PHASE, value: "afternoon" } },
    { seq: 3, at: now(), actor: { kind: "producer", label: "Priya (producer)" }, command: { kind: "play", flow: "house", card: "the-bell", outcome: "ring-it", hand: "the-house-hand" } },
  ];
  const head = (): number => journal.reduce((n, e) => Math.max(n, e.seq), 0);
  const journalled = (actor: JournalEntry["actor"], command: JournalEntry["command"]): JournalEntry => {
    const entry: JournalEntry = { seq: head() + 1, at: now(), actor, command };
    journal.push(entry);
    return entry;
  };
  const PRODUCER: JournalEntry["actor"] = { kind: "producer", label: "Priya (producer)" };

  /** `@world`, the console's read of it: everything, including the three
   *  derived clocks (wire 10.1, 10.2). */
  const world: PropertyView[] = [
    { path: CLOCK_WALL, value: WALL_MINUTES, type: "number", writable: false, shared: true },
    { path: CLOCK_SHOW, value: 120, type: "number", writable: false, shared: true },
    { path: CLOCK_PHASE, value: "afternoon", type: "string", writable: false, shared: true },
    { path: "world.doors_open", value: true, type: "boolean", writable: true, shared: true },
    // An enum and a quality, declared options and all, because a console that
    // is only told the type can offer a producer nothing but a text field.
    { path: "world.weather", value: "fair", type: "enum", writable: true, shared: true, values: ["fair", "rain", "storm"] },
    { path: "story.standing", value: "stranger", type: "quality", writable: true, shared: true, stages: ["stranger", "friend", "kin"] },
  ];

  const cues: GetCueListResponse = {
    cues: [
      { id: "go", label: "GO", at: "manual", action: { do: "set-phase", phase: "act-one" } },
      { id: "act-two", at: "show", seconds: 720, action: { do: "set-phase", phase: "act-two" } },
    ],
    armed: true,
  };

  const houseBoard: BoardView = {};
  let houseTurns: TurnsView = {};

  const credentials = new Map<string, CredentialView[]>();
  const pockets = new Map<string, Record<string, ScalarValue>>();

  const principals: PrincipalView[] = [
    { principal: "pr-producer", label: "Priya", role: "producer", issuedAt: now() },
  ];

  const bundles: BundleView[] = [
    { build: run.build, id: "build-live", uploadedAt: now(), state: "live", metadata: "full" },
  ];
  const emptyReport = (): LoadReport => ({
    exact: true,
    project: run.build.project,
    version: { saved: run.build.version, bundle: run.build.version },
    hash: { saved: run.build.hash, bundle: run.build.hash },
    flows: [],
    evicted: [],
    droppedCooldowns: [],
    droppedSpent: [],
    droppedProperties: [],
    defaultedProperties: [],
    retypedProperties: [],
  });

  const bridges: BridgeView[] = [
    { id: "the-lights", kind: "webhook", label: "The light desk", enabled: false },
  ];

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

  // --- zones, and who a message reaches --------------------------------------

  /** The zone this installation's map derives from a location, if any (4a).
   *  Derived here and never sent by a device: a device knows only where it is.
   *  Which installation's map is asked is the one the handset is signed in to,
   *  falling back to the venue's default, which is what a fixed station in a
   *  one-story venue is serving anyway. */
  const zoneAt = (location?: string, installation?: string): string | undefined => {
    if (location === undefined) return undefined;
    const story = installation ?? station.installation
      ?? installations().find((i) => i.default === true)?.installation
      ?? installations()[0]?.installation;
    return story === undefined ? undefined : ZONES[story]?.[location];
  };

  const presenceNow = (location?: string): PresenceView => {
    const zone = zoneAt(location);
    return {
      station: station.station,
      kind: station.kind,
      ...(location !== undefined ? { location } : {}),
      ...(zone !== undefined ? { zone } : {}),
      since: now(),
    };
  };

  /**
   * Whether a message reaches a stream of this scope (6.7).
   *
   * The half of the fan-out rule that is about messages rather than flows, and
   * the one a client cannot check for itself: a station receives what is
   * addressed to it, to its kind, to where it stands, to the zone its
   * installation derives from that, or to everyone. A PARTY receives none of
   * it. There is no party audience on the wire, and there should not be: what
   * the control room says to the floor is said to the venue's own devices, and
   * a visitor's phone is not one. It reaches a party only as whatever a
   * performer standing in front of them says out loud.
   */
  /** A station's own copy of a message carries no acks and neither of the two
   *  counts: the tally is what a producer watches fill in, and it is nobody
   *  else's business (6.7). A handset that could see the denominator could see
   *  how many colleagues have not looked up yet. */
  const withoutAcks = (message: MessageView): MessageView => {
    const copy: MessageView = { ...message };
    delete copy.acks;
    delete copy.delivered;
    delete copy.acknowledged;
    return copy;
  };

  const reaches = (message: MessageView, scope: "station" | "party" | "producer" | "monitor"): boolean => {
    if (scope === "producer" || scope === "monitor") return true;
    if (scope === "party") return false;
    const to = message.audience;
    switch (to.to) {
      case "everyone": return true;
      case "kind": return to.kind === station.kind;
      case "location": return to.location === presence.location;
      case "zone": return to.zone === presence.zone;
      case "station": return to.station === station.station;
      case "producers": return false;
    }
  };

  // --- helpers ---------------------------------------------------------------

  const mintParty = (installation: string, callSign: boolean, claimed = false): Party => {
    const id = nextId("party-");
    const party: Party = {
      id,
      token: `token-${id}`,
      // A party nobody claimed is transient, and so is its credential: a day
      // pass, good for this run and no other (7.1).
      dayPass: !claimed,
      claimed,
      installation,
      ...(callSign ? { callSign: `quiet otter ${id.slice(-1)}` } : {}),
    };
    parties.set(id, party);
    byToken.set(party.token, party);
    if (party.callSign !== undefined) byCallSign.set(party.callSign, party);
    // Every party arrives holding SOMETHING, and the console lists what: the
    // record, never the secret (wire 7.1). The console counter mints this, so
    // the station fixture's ids are untouched.
    credentials.set(id, [{
      id: nextConsoleId("cred-"),
      kind: "token",
      issuedAt: now(),
      ...(party.dayPass ? { expiresAt: now() } : {}),
    }]);
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
    for (const hand of Object.values(bindings[party.installation] ?? {})) visit.board[hand] = [];
    visits.set(visit.id, visit);
    // Journaled BEFORE it is applied, which is the rule the whole recovery
    // story rests on (wire 5.2). It is also what the lens reads back as the
    // flow's own log.
    journalled({ kind: "party", id: party.id }, { kind: "open", flow: party.id, seed: run.seed });
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

  /** A party as the console lists it. No name, no email, no photo: a ULID,
   *  its credentials, a pocket (wire 7.4). The secret is never in either. */
  const partyViewOf = (p: Party, full = false): PartyView => ({
    party: p.id,
    installation: p.installation,
    ...(p.callSign !== undefined ? { callSign: p.callSign } : {}),
    claimed: p.claimed,
    createdAt: now(),
    lastSeenAt: now(),
    ...(full ? { credentials: credentials.get(p.id) ?? [] } : {}),
    ...(full ? { pocket: pockets.get(p.id) ?? {} } : {}),
  });

  /** What a value's declaration would say it is, for a row the console writes
   *  that the fake had not declared. */
  const typeOf = (value: ScalarValue): PropertyView["type"] =>
    typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";

  const dealInto = (visit: Visit, hands?: string[]): void => {
    const bound = bindings[visit.installation] ?? {};
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
    /** What this stream is entitled to see. The flow-tagged events are already
     *  narrow enough for this fake's one party; what this decides is messages,
     *  which are addressed by audience and not by flow (6.7). */
    private scope: "station" | "party" | "producer" | "monitor" = "party";

    constructor(url: string) {
      const query = new URLSearchParams(url.split("?")[1] ?? "");
      const ticket = query.get("t") ?? "";
      const last = query.get("last");
      if (offline || !tickets.has(ticket)) {
        queueMicrotask(() => this.fail());
        return;
      }
      this.scope = tickets.get(ticket)!;
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
      // The message half of the fan-out rule, applied on the way out so a
      // replay from the ring buffer obeys it as a live push does.
      if (event.type === "message" && !reaches(event.message, this.scope)) return;
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
    locations,
    emit,
    get streams() { return open.size; },
    drop() {
      for (const es of [...open]) es.fail();
    },
    forgetHistory() {
      oldestHeld = eventSeq + 1;
      ring = [];
    },
    endRun() {
      // The run ends and every day pass goes with it (7.1). A party that
      // claimed keeps the keepsake the claim minted, which is the difference
      // between a story that comes back and one that does not (7.3).
      for (const party of parties.values()) {
        if (!party.dayPass) continue;
        byToken.delete(party.token);
        retired.add(party.token);
      }
      run.state = "ended";
      emit({ type: "run", phase: "ended", run } as WireEvent);
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
    seedVisit(o = {}) {
      const party = mintParty(o.installation ?? CARETAKER.installation, true, true);
      const visit = openVisitFor(party);
      dealInto(visit);
      return visit.id;
    },
    seedMessage(o) {
      const message: MessageView = {
        id: nextConsoleId("msg-"),
        body: o.body,
        sender: PRODUCER,
        priority: o.priority ?? "note",
        audience: o.audience,
        at: messageNow(),
        ...(o.ackRequired === true ? { ackRequired: true, acks: [] } : {}),
      };
      messages.push(message);
      emit({ type: "message", message } as WireEvent);
      return message;
    },
    get presence() { return presence; },

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
        : token === stationKey ? "station"
          : token === producerKey ? "producer" : "party";
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
      const isProducer = token === producerKey;

      // A BEARER THIS SERVER DOES NOT KNOW IS REFUSED, on every route, which
      // is what makes a dead day pass a refusal rather than a walk-up: the
      // party that never claimed comes back after the run and is told so, and
      // the stream ticket is refused with it (7.1, 7.3).
      if (token !== undefined && !isStation && !isProducer && !byToken.has(token)) {
        return retired.has(token)
          ? fail(401, "unknown_credential", "That was a day pass for a run that has ended.")
          : fail(401, "unknown_credential", "that credential is not known here");
      }
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
          // With its PRESENCE: where the device says it is, and the zone
          // this venue's story derives from that (4a). A handset waking up
          // reads its own sign-in from here rather than asking again, and
          // without it a crew screen would show a zone only after the next
          // tap.
          ...(isStation ? { station: { ...station, presence } } : {}),
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
        if (req.kind === "token") {
          // ISSUING A PERMANENT CREDENTIAL IS THE CLAIM (7.1), and permanent
          // is the whole of it: the day pass this party arrived with still
          // dies at run end, so the keepsake is a NEW token and the phone is
          // meant to keep that one instead of the one it walked up with.
          party.keepsake ??= `keepsake-${party.id}`;
          byToken.set(party.keepsake, party);
        }
        if (req.kind === "callsign" && party.callSign === undefined) {
          party.callSign = "steady heron";
          byCallSign.set(party.callSign, party);
        }
        if (req.kind === "external" && req.externalRef !== undefined) byExternal.set(req.externalRef, party);
        const res: ClaimPartyResponse = {
          partyId: party.id,
          claimed: true,
          ...(req.kind === "token" ? { qr: `${base}/p/${party.keepsake!}` } : {}),
          ...(req.kind === "callsign" ? { callSign: party.callSign! } : {}),
          ...(req.kind === "external" ? { externalRef: req.externalRef! } : {}),
        };
        return ok(res);
      }

      const credMatch = /^\/parties\/([^/]+)\/credentials$/.exec(path);
      if (credMatch && init.method === "POST") {
        // A STATION VOUCHES, and so does a producer: 6.5 lists issuing a
        // credential among the producer's party verbs, and the wire declares
        // exactly one route for it, so this is that route with either key.
        if (!isStation && !isProducer) {
          return fail(401, "needs_station_key", "credentials are issued by a station with a key, or from the console");
        }
        const party = parties.get(decodeURIComponent(credMatch[1] ?? ""));
        if (!party) return fail(404, "unknown_party", "no party by that id");
        const req = body as IssueCredentialRequest;
        const id = nextConsoleId("cred-");
        credentials.set(party.id, [...(credentials.get(party.id) ?? []), {
          id,
          kind: req.kind,
          issuedAt: now(),
          ...(req.label !== undefined ? { label: req.label } : {}),
          ...(req.dayPass === true ? { expiresAt: now() } : {}),
        }]);
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
        dealInto(visit, [bindings[party.installation]?.[decodeURIComponent(chooseMatch[2] ?? "")] ?? ""].filter(Boolean));
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
        if (!locations.some((l) => l.location === location)) {
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
          dealInto(visit, [bindings[only.installation]?.[location] ?? ""].filter(Boolean));
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
        dealInto(visit, [bindings[party.installation]?.[location] ?? ""].filter(Boolean));
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
        presence = presenceNow(req.location);
        emit({ type: "presence", presence } as WireEvent);
        const res: SetPresenceResponse = { presence, mirrored: [] };
        return ok(res);
      }

      // messages -------------------------------------------------------------
      if (path === "/messages" && init.method === "GET") {
        const since = query.get("since");
        // Addressed to THIS bearer, under the same rule the stream applies:
        // the catch-up and the delivery must agree, or a device that
        // reconnected would learn something it was never sent (6.7).
        const scope = isProducer ? "producer" : isStation ? "station" : "party";
        const res: ListMessagesResponse = {
          messages: messages
            .filter((m) => reaches(m, scope))
            // A cursor is EXCLUSIVE: the client sends back the instant of the
            // last message it holds, and asking for that one again would put a
            // duplicate in the tray.
            .filter((m) => since === null || m.at > since)
            .map(withoutAcks),
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
          at: messageNow(),
          ...(req.ackRequired === true ? { ackRequired: true, acks: [] } : {}),
        };
        messages.push(message);
        emit({ type: "message", message } as WireEvent);
        const res: SendMessageResponse = { message };
        return ok(res);
      }
      const ackMatch = /^\/messages\/([^/]+)\/ack$/.exec(path);
      if (ackMatch && init.method === "POST") {
        const id = decodeURIComponent(ackMatch[1] ?? "");
        const message = messages.find((m) => m.id === id);
        if (!message) return fail(404, "bad_request", "no message by that id in this run");
        // The count a producer watches fill in: "4 of 5 in the forest have
        // seen it". Acked ONCE per station, however many times a thumb lands
        // on it, which is what makes a second ack from the same handset
        // harmless rather than a second body in the tally.
        message.acks ??= [];
        if (!message.acks.some((a) => a.station === station.station)) {
          message.acks.push({ station: station.station, at: now() });
        }
        // The console's log reads the count and not the list, so the two must
        // not be able to disagree: the count is the list's length here.
        message.acknowledged = message.acks.length;
        const res: AckMessageResponse = {
          id,
          acked: message.acks.length,
          of: reaches(message, "station") ? 1 : 0,
        };
        return ok(res);
      }

      // the stream -----------------------------------------------------------
      if (path === "/stream-ticket" && init.method === "POST") {
        if (token === undefined) return fail(401, "unauthorized", "no bearer");
        const req = (body ?? {}) as CreateStreamTicketRequest;
        // MONITOR SCOPE IS A ROLE, not an option. A station key asking for it
        // is refused, and refused is an ANSWER: the client stops rather than
        // laddering, because no amount of backing off will make a station a
        // monitor (wire 6.4).
        if (req.monitor === true && !isProducer) {
          return fail(403, "wrong_role", "monitor scope is a monitor's or a producer's; this key is neither");
        }
        const ticket = nextId("ticket-");
        tickets.set(ticket, req.monitor === true ? "monitor" : isStation ? "station" : isProducer ? "producer" : "party");
        const res: CreateStreamTicketResponse = { ticket, expiresAt: now() };
        return ok(res);
      }

      // the world ------------------------------------------------------------
      if (path === "/world" && init.method === "GET") {
        const res: GetWorldResponse = {
          properties: [
            { path: "world.time_phase", value: "afternoon", type: "string", writable: false, shared: true },
          ],
          clocks: { time_wall: WALL_MINUTES, time_show: 120, time_phase: "afternoon" },
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
            clocks: { time_wall: WALL_MINUTES, time_show: 120, time_phase: "afternoon" },
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

      // --- the console (6.5) --------------------------------------------------
      //
      // ONE ROLE GATE for everything below it. A station key that wandered in
      // gets `wrong_role` rather than a 404, because "no such route" would
      // send a client looking for a typo when the answer is that this key is
      // not the console's (7.5).
      if (path.startsWith("/console")) {
        if (!isProducer) {
          return fail(403, "wrong_role", "that key is valid, but the console is a producer's");
        }
        const c = path.slice("/console".length);

        /** `{ cursor, limit }` in, `{ items, next }` out. The cursor is an
         *  offset here; a real server's is opaque, and a client that treated
         *  it as anything but opaque would break on the first one that is. */
        const pageOf = <T>(items: T[]): Page<T> => {
          const limit = Math.max(1, Math.min(Number(query.get("limit") ?? 50), 200));
          const from = Number(query.get("cursor") ?? 0);
          const next = from + limit < items.length ? String(from + limit) : undefined;
          return { items: items.slice(from, from + limit), ...(next !== undefined ? { next } : {}) };
        };

        // runs -----------------------------------------------------------------
        if (c === "/runs" && init.method === "GET") {
          const res: ListRunsResponse = pageOf(runs);
          return ok(res);
        }
        if (c === "/runs" && init.method === "POST") {
          const req = body as StartRunRequest;
          run.state = "live";
          journalled(PRODUCER, { kind: "run.start", run: run.run, seed: req.seed ?? run.seed, build: run.build });
          emit({ type: "run", installation: req.installation, phase: "started", run } as WireEvent);
          const res: StartRunResponse = { run };
          return ok(res);
        }
        const runMatch = /^\/runs\/([^/]+)(\/.*)?$/.exec(c);
        if (runMatch) {
          const which = runs.find((r) => r.run === decodeURIComponent(runMatch[1] ?? ""));
          if (!which) return fail(404, "no_run", "no run by that id");
          const rest = runMatch[2] ?? "";
          if (rest === "/end" && init.method === "POST") {
            which.state = "ended";
            journalled(PRODUCER, { kind: "run.end", run: which.run });
            emit({ type: "run", phase: "ended", run: which } as WireEvent);
            const res: EndRunResponse = { run: which, visitsClosed: visits.size };
            return ok(res);
          }
          if (rest === "/pause" && init.method === "POST") {
            which.state = "paused";
            journalled(PRODUCER, { kind: "run.hold", run: which.run });
            emit({ type: "run", phase: "paused", run: which } as WireEvent);
            const res: PauseRunResponse = { run: which };
            return ok(res);
          }
          if (rest === "/resume" && init.method === "POST") {
            which.state = "live";
            journalled(PRODUCER, { kind: "run.resume", run: which.run });
            emit({ type: "run", phase: "resumed", run: which } as WireEvent);
            const res: ResumeRunResponse = { run: which };
            return ok(res);
          }
          if (rest === "/journal" && init.method === "GET") {
            const kinds = (query.get("kinds") ?? "").split(",").filter(Boolean);
            const flow = query.get("flow");
            const since = query.get("since");
            const until = query.get("until");
            const atStation = query.get("station");
            const onHand = query.get("hand");
            /** The hands a command NAMES: what it asked to deal, what it was
             *  played on, what it was evicted from. */
            const handsOf = (command: JournalEntry["command"]): string[] => {
              if (command.kind === "deal") return command.hands ?? [];
              if (command.kind === "play" || command.kind === "evict") return [command.hand];
              return [];
            };
            const window = journal.filter((e) => {
              if (kinds.length > 0 && !kinds.includes(e.command.kind)) return false;
              if (flow !== null && (e.command as { flow?: string }).flow !== flow) return false;
              // A station is NAMED by an attach or a detach and by nothing
              // else: presence is never journaled, so "commands from a device
              // standing there" is not a question the journal can answer.
              if (atStation !== null && (e.command as { station?: string }).station !== atStation) return false;
              if (onHand !== null && !handsOf(e.command).includes(onHand)) return false;
              if (since !== null && e.at < since) return false;
              if (until !== null && e.at > until) return false;
              return true;
            });
            // Recent-first, as `GetJournalResponse` says and the real server
            // does: a producer asking "what happened at 14:32" reads down from
            // the newest, and paging from the oldest would hand them the start
            // of the day.
            const res: GetJournalResponse = { ...pageOf(window.reverse()), head: head() };
            return ok(res);
          }
          if (rest === "/snapshot" && init.method === "POST") {
            const res: SnapshotRunResponse = {
              run: which.run, snapshot: nextConsoleId("snap-"), seq: head(), at: now(),
            };
            return ok(res);
          }
          if (rest === "/restore" && init.method === "POST") {
            const req = body as RestoreFromJournalRequest;
            const to = req.toSeq ?? head();
            const res: RestoreFromJournalResponse = {
              run: which, replayed: journal.filter((e) => e.seq <= to).length, seq: to,
            };
            return ok(res);
          }
        }

        // cues -----------------------------------------------------------------
        if (c === "/cues" && init.method === "GET") {
          const res: GetCueListResponse = cues;
          return ok(res);
        }
        if (c === "/cues" && init.method === "PUT") {
          const req = body as PutCueListRequest;
          cues.cues = req.cues;
          const res: PutCueListResponse = { cues: cues.cues };
          return ok(res);
        }
        const fireMatch = /^\/cues\/([^/]+)\/fire$/.exec(c);
        if (fireMatch && init.method === "POST") {
          const id = decodeURIComponent(fireMatch[1] ?? "");
          const entry = cues.cues.find((e) => e.id === id);
          if (!entry) return fail(404, "bad_request", `no cue called ${id}`);
          const res: FireCueResponse = {
            cue: id,
            seq: journalled(PRODUCER, { kind: "tick", cue: id, action: entry.action }).seq,
          };
          return ok(res);
        }

        // visits ---------------------------------------------------------------
        if (c === "/visits" && init.method === "GET") {
          const installation = query.get("installation");
          const where = query.get("location");
          const list = [...visits.values()]
            .filter((v) => installation === null || v.installation === installation)
            // Nothing here is idle, so `idle=true` narrows to nobody.
            .filter(() => query.get("idle") !== "true")
            // A visit is AT a location when one of its stations is standing
            // there, which is what presence answers (wire 5.7).
            .filter(() => where === null || presence.location === where)
            .map(viewOf);
          const res: ListVisitsResponse = pageOf(list);
          return ok(res);
        }
        // The two the wire marks OPTIONAL in the path: no visit means every
        // open flow, and the segment goes with it.
        if (c === "/visits/turns" && init.method === "POST") {
          const req = body as AdvanceTurnsRequest;
          let turns: TurnsView = {};
          for (const v of visits.values()) {
            if (v.installation !== req.installation) continue;
            v.turns = { ...v.turns, [req.box]: (v.turns[req.box] ?? 0) + req.turns };
            journalled(PRODUCER, { kind: "advance", flow: v.party, box: req.box, turns: req.turns });
            turns = v.turns;
          }
          const res: AdvanceTurnsResponse = { turns };
          return ok(res);
        }
        if (c === "/visits/properties" && init.method === "POST") {
          const req = body as SetPropertyRequest;
          const row = world.find((p) => p.path === req.path);
          if (!row) return fail(400, "bad_request", `${req.path} is not shared; name a visit, or write @world`);
          row.value = req.value;
          const res: SetPropertyResponse = { property: row };
          return ok(res);
        }
        const consoleVisit = /^\/visits\/([^/]+)(\/.*)?$/.exec(c);
        if (consoleVisit) {
          const visit = visits.get(decodeURIComponent(consoleVisit[1] ?? ""));
          if (!visit) return fail(404, "unknown_visit", "that visit is closed or was never opened");
          const rest = consoleVisit[2] ?? "";
          const board = (): WireEvent => ({
            type: "board", flow: visit.party, installation: visit.installation, visit: visit.id,
            board: visit.board, turns: visit.turns, at: now(),
          } as WireEvent);

          if (rest === "/lens" && init.method === "GET") {
            const log = Number(query.get("log") ?? 20);
            const res: GetVisitLensResponse = {
              visit: viewOf(visit),
              board: visit.board,
              turns: visit.turns,
              properties: visit.properties,
              // The FLOW's own log, recent first (4.5).
              entries: journal
                .filter((e) => (e.command as { flow?: string }).flow === visit.party)
                .slice(-log)
                .reverse(),
            };
            return ok(res);
          }
          if (rest === "/deal" && init.method === "POST") {
            const req = body as ForceDealRequest;
            dealInto(visit, req.hands);
            journalled(PRODUCER, {
              kind: "deal", flow: visit.party, ...(req.hands !== undefined ? { hands: req.hands } : {}),
            });
            emit(board());
            const res: ForceDealResponse = { board: visit.board, turns: visit.turns };
            return ok(res);
          }
          if (rest === "/play" && init.method === "POST") {
            const req = body as ForcePlayRequest;
            const held = visit.board[req.hand] ?? [];
            if (!held.some((card) => card.id === req.card)) {
              return fail(409, "not_dealt", `${req.card} is not on this table`);
            }
            // NOT gated on availability, unlike a station's play: playing on a
            // party's behalf is what a performer's improvised answer sometimes
            // needs, and that is the whole point of the verb (5.7).
            visit.board[req.hand] = held.filter((card) => card.id !== req.card);
            visit.turns = { ...visit.turns, room: (visit.turns["room"] ?? 0) + 1 };
            journalled(PRODUCER, {
              kind: "play", flow: visit.party, card: req.card, outcome: req.outcome, hand: req.hand,
            });
            emit(board());
            const res: ForcePlayResponse = { board: visit.board, turns: visit.turns };
            return ok(res);
          }
          if (rest === "/evict" && init.method === "POST") {
            const req = body as EvictCardRequest;
            visit.board[req.hand] = (visit.board[req.hand] ?? []).filter((card) => card.id !== req.card);
            // A card taken off a board is a MUTATION, so it is journaled like
            // one: the wire names the kind now, and a producer's stuck-beat
            // fix that left no line would be a replay that never made it.
            journalled(PRODUCER, { kind: "evict", flow: visit.party, hand: req.hand, card: req.card });
            emit(board());
            const res: EvictCardResponse = { board: visit.board };
            return ok(res);
          }
          if (rest === "/turns" && init.method === "POST") {
            const req = body as AdvanceTurnsRequest;
            visit.turns = { ...visit.turns, [req.box]: (visit.turns[req.box] ?? 0) + req.turns };
            journalled(PRODUCER, { kind: "advance", flow: visit.party, box: req.box, turns: req.turns });
            const res: AdvanceTurnsResponse = { turns: visit.turns };
            return ok(res);
          }
          if (rest === "/properties" && init.method === "POST") {
            const req = body as SetPropertyRequest;
            let row = visit.properties.find((p) => p.path === req.path);
            if (!row) {
              row = { path: req.path, value: req.value, type: typeOf(req.value), writable: true };
              visit.properties.push(row);
            }
            row.value = req.value;
            journalled(PRODUCER, { kind: "set", path: req.path, value: req.value, flow: visit.party });
            const res: SetPropertyResponse = { property: row };
            return ok(res);
          }
          const detachMatch = /^\/stations\/([^/]+)$/.exec(rest);
          if (detachMatch && init.method === "DELETE") {
            const which = decodeURIComponent(detachMatch[1] ?? "");
            visit.stations = visit.stations.filter((s) => s !== which);
            // The one command that NAMES a station, which is what the
            // journal's station filter can answer from (5.4).
            journalled(PRODUCER, { kind: "visit.detach", flow: visit.party, station: which });
            emit({
              type: "visit", flow: visit.party, installation: visit.installation, visit: visit.id,
              phase: "detached", station: which,
            } as WireEvent);
            const res: DetachVisitStationResponse = { visit: visit.id, stations: visit.stations };
            return ok(res);
          }
          if (rest === "" && init.method === "DELETE") {
            visits.delete(visit.id);
            journalled(PRODUCER, { kind: "close", flow: visit.party, reason: "producer" });
            emit({
              type: "visit", flow: visit.party, installation: visit.installation, visit: visit.id,
              phase: "parked",
            } as WireEvent);
            const res: ParkVisitConsoleResponse = { visit: visit.id, parkedAt: now() };
            return ok(res);
          }
        }

        // parties --------------------------------------------------------------
        if (c === "/parties" && init.method === "GET") {
          const installation = query.get("installation");
          const claimed = query.get("claimed");
          const live = query.get("live");
          const callSign = query.get("callSign");
          const list = [...parties.values()]
            .filter((p) => installation === null || p.installation === installation)
            .filter((p) => claimed === null || p.claimed === (claimed === "true"))
            .filter((p) => live === null
              || (live === "true") === [...visits.values()].some((v) => v.party === p.id))
            .filter((p) => callSign === null || (p.callSign ?? "").startsWith(callSign))
            .map((p) => partyViewOf(p));
          const res: ListPartiesResponse = pageOf(list);
          return ok(res);
        }
        const consoleParty = /^\/parties\/([^/]+)(\/.*)?$/.exec(c);
        if (consoleParty) {
          const p = parties.get(decodeURIComponent(consoleParty[1] ?? ""));
          if (!p) return fail(404, "unknown_party", "no party by that id");
          const rest = consoleParty[2] ?? "";
          if (rest === "" && init.method === "GET") {
            const live = [...visits.values()].find((v) => v.party === p.id);
            const res: GetPartyResponse = {
              party: partyViewOf(p, true),
              ...(live !== undefined ? { visit: viewOf(live) } : {}),
            };
            return ok(res);
          }
          if (rest === "/pocket" && init.method === "PATCH") {
            const req = body as EditPocketRequest;
            const pocket: Record<string, ScalarValue> = { ...(pockets.get(p.id) ?? {}), ...req.set };
            for (const path2 of req.clear ?? []) delete pocket[path2];
            pockets.set(p.id, pocket);
            const res: EditPocketResponse = { party: p.id, pocket };
            return ok(res);
          }
          if (rest === "" && init.method === "DELETE") {
            const live = [...visits.values()].find((v) => v.party === p.id);
            if (live !== undefined) visits.delete(live.id);
            parties.delete(p.id);
            byToken.delete(p.token);
            if (p.keepsake !== undefined) byToken.delete(p.keepsake);
            if (p.callSign !== undefined) byCallSign.delete(p.callSign);
            credentials.delete(p.id);
            pockets.delete(p.id);
            const res: ForgetPartyResponse = {
              party: p.id, forgottenAt: now(), ...(live !== undefined ? { visitClosed: true } : {}),
            };
            return ok(res);
          }
          const revokeMatch = /^\/credentials\/([^/]+)\/revoke$/.exec(rest);
          if (revokeMatch && init.method === "POST") {
            const id = decodeURIComponent(revokeMatch[1] ?? "");
            const cred = (credentials.get(p.id) ?? []).find((one) => one.id === id);
            if (!cred) return fail(404, "unknown_credential", "no credential by that id on this party");
            cred.revokedAt = now();
            const res: RevokeCredentialResponse = { credential: cred };
            return ok(res);
          }
        }
        const moveMatch = /^\/credentials\/([^/]+)\/move$/.exec(c);
        if (moveMatch && init.method === "POST") {
          const req = body as MoveCredentialRequest;
          const id = decodeURIComponent(moveMatch[1] ?? "");
          let moved: CredentialView | undefined;
          for (const [owner, held] of credentials) {
            const found = held.find((one) => one.id === id);
            if (found === undefined) continue;
            moved = found;
            credentials.set(owner, held.filter((one) => one.id !== id));
          }
          if (moved === undefined) return fail(404, "unknown_credential", "no credential by that id");
          // POCKETS DO NOT SPLIT OR MERGE; only the credential moves (7.1).
          credentials.set(req.to, [...(credentials.get(req.to) ?? []), moved]);
          const res: MoveCredentialResponse = { credential: moved, party: req.to };
          return ok(res);
        }

        // the world, and the house ---------------------------------------------
        if (c === "/world" && init.method === "GET") {
          const prefix = query.get("prefix");
          const res: ReadWorldResponse = {
            properties: prefix === null ? world : world.filter((p) => p.path.startsWith(prefix)),
          };
          return ok(res);
        }
        if (c === "/world" && init.method === "POST") {
          const req = body as WriteWorldRequest;
          const row = world.find((p) => p.path === req.path);
          if (!row) return fail(400, "bad_request", `${req.path} is not a property this story declares`);
          const prev = row.value;
          // `writable: false` protects a property from OUTCOMES, never from
          // the person running the show (5.6), so the flag is not consulted.
          row.value = req.value;
          journalled(PRODUCER, { kind: "set", path: req.path, value: req.value });
          emit({
            type: "world", installation: req.installation, path: req.path, value: req.value, prev,
            actor: PRODUCER,
          } as WireEvent);
          const res: WriteWorldResponse = { property: row };
          return ok(res);
        }
        // The house's table, READ rather than dealt: a read that had to deal
        // to answer would be a read that changed the show (5.5).
        if (c === "/house" && init.method === "GET") {
          const res: GetHouseResponse = { board: houseBoard, turns: houseTurns };
          return ok(res);
        }
        if (c === "/house/deal" && init.method === "POST") {
          const req = body as DealHouseRequest;
          const hand = "the-house-hand";
          const already = new Set((houseBoard[hand] ?? []).map((card) => card.id));
          houseBoard[hand] = [...(houseBoard[hand] ?? []), ...HOUSE_DECK.filter((card) => !already.has(card.id))];
          journalled(PRODUCER, {
            kind: "deal", flow: HOUSE_FLOW, ...(req.hands !== undefined ? { hands: req.hands } : {}),
          });
          emit({
            type: "board", flow: HOUSE_FLOW, installation: req.installation, board: houseBoard,
            turns: houseTurns,
          } as WireEvent);
          const res: DealHouseResponse = { board: houseBoard, turns: houseTurns };
          return ok(res);
        }
        if (c === "/house/play" && init.method === "POST") {
          const req = body as PlayHouseRequest;
          houseBoard[req.hand] = (houseBoard[req.hand] ?? []).filter((card) => card.id !== req.card);
          journalled(PRODUCER, {
            kind: "play", flow: HOUSE_FLOW, card: req.card, outcome: req.outcome, hand: req.hand,
          });
          const res: PlayHouseResponse = { board: houseBoard, turns: houseTurns };
          return ok(res);
        }
        if (c === "/house/turns" && init.method === "POST") {
          const req = body as AdvanceHouseRequest;
          houseTurns = { ...houseTurns, [req.box]: (houseTurns[req.box] ?? 0) + req.turns };
          journalled(PRODUCER, { kind: "advance", flow: HOUSE_FLOW, box: req.box, turns: req.turns });
          const res: AdvanceHouseResponse = { turns: houseTurns };
          return ok(res);
        }

        // the venue, and its stations ------------------------------------------
        if (c === "/venue" && init.method === "GET") {
          const res: GetVenueResponse = { venue: VENUE };
          return ok(res);
        }
        if (c === "/venue/locations" && init.method === "GET") {
          const res: ListLocationsResponse = pageOf(locations);
          return ok(res);
        }
        if (c === "/venue/locations" && init.method === "POST") {
          const req = body as CreateLocationRequest;
          const id = nextConsoleId("loc-");
          // The server mints the id AND the code: neither is the caller's to
          // choose, because the code goes on a wall (4a, 12.2).
          const location: LocationView = {
            location: id, venue: VENUE.venue, label: req.label, x: req.x, y: req.y,
            code: `${base}/at/${VENUE.venue}/${id}`,
          };
          locations.push(location);
          const res: CreateLocationResponse = { location };
          return ok(res);
        }
        if (c === "/venue/locations/print" && init.method === "POST") {
          const req = (body ?? {}) as PrintLocationSheetRequest;
          const wanted = req.locations ?? locations.map((l) => l.location);
          const res: PrintLocationSheetResponse = {
            sheet: wanted.flatMap((id) => {
              const l = locations.find((one) => one.location === id);
              return l === undefined ? [] : [{ location: l.location, label: l.label, code: l.code }];
            }),
          };
          return ok(res);
        }
        const locMatch = /^\/venue\/locations\/([^/]+)$/.exec(c);
        if (locMatch && init.method === "PATCH") {
          const req = body as UpdateLocationRequest;
          const l = locations.find((one) => one.location === decodeURIComponent(locMatch[1] ?? ""));
          if (!l) return fail(404, "unknown_location", "no location by that id at this venue");
          if (req.label !== undefined) l.label = req.label;
          if (req.x !== undefined) l.x = req.x;
          if (req.y !== undefined) l.y = req.y;
          // `code` is deliberately untouched: placards are printed once.
          const res: UpdateLocationResponse = { location: l };
          return ok(res);
        }
        if (c === "/stations/presence" && init.method === "GET") {
          const where = query.get("location");
          const kind = query.get("kind");
          const res: ListPresenceResponse = {
            presence: [presence]
              .filter((p) => where === null || p.location === where)
              .filter((p) => kind === null || p.kind === kind),
          };
          return ok(res);
        }
        const bindMatch = /^\/stations\/([^/]+)\/binding$/.exec(c);
        if (bindMatch && init.method === "POST") {
          const req = body as BindStationRequest;
          if (req.kind !== undefined) station.kind = req.kind;
          if (req.label !== undefined) station.label = req.label;
          if (req.mirrorPresence !== undefined) station.mirrorPresence = req.mirrorPresence;
          const res: BindStationResponse = { station };
          return ok(res);
        }
        const placeMatch = /^\/stations\/([^/]+)\/location$/.exec(c);
        if (placeMatch && init.method === "POST") {
          const req = body as BindStationToLocationRequest;
          if (req.location === undefined) delete station.location;
          else station.location = req.location;
          presence = presenceNow(station.location);
          station.presence = presence;
          emit({ type: "presence", presence } as WireEvent);
          const res: BindStationToLocationResponse = { station };
          return ok(res);
        }

        // installations, and their bindings ------------------------------------
        if (c === "/installations" && init.method === "GET") {
          const open2 = query.get("open");
          const list = stories.filter((i) => open2 === null || (open2 === "true") === (i.open !== false));
          const res: ListInstallationsResponse = pageOf(list);
          return ok(res);
        }
        const instMatch = /^\/installations\/([^/]+)(\/.*)?$/.exec(c);
        if (instMatch) {
          const story = storyOf(decodeURIComponent(instMatch[1] ?? ""));
          if (!story) return fail(404, "unknown_installation", "no installation by that id here");
          const rest = instMatch[2] ?? "";
          if (rest === "/open" && init.method === "POST") {
            story.open = true;
            emit({ type: "installation", phase: "opened", installation: story } as WireEvent);
            const res: OpenInstallationResponse = { installation: story };
            return ok(res);
          }
          if (rest === "/close" && init.method === "POST") {
            // Open visits are untouched: closing the door and ending the run
            // are two acts (4a).
            story.open = false;
            emit({ type: "installation", phase: "closed", installation: story } as WireEvent);
            const res: CloseInstallationResponse = { installation: story };
            return ok(res);
          }
          if (rest === "" && init.method === "PATCH") {
            const req = body as UpdateInstallationRequest;
            if (req.name !== undefined) story.name = req.name;
            if (req.walkUp !== undefined) story.walkUp = req.walkUp;
            // THE WHOLE LIST, not a delta: an allow list edited by patch is
            // one two consoles can grow between them (5.6). An empty array
            // clears it; absent leaves it alone, so renaming a story does not
            // silently disarm the rig.
            if (req.externalWritable !== undefined) story.externalWritable = [...req.externalWritable];
            if (req.default === true) {
              // Exactly one installation holds it, so setting it here clears
              // it on whichever had it.
              for (const other of stories) other.default = other === story;
              emit({ type: "installation", phase: "default-changed", installation: story } as WireEvent);
            }
            const res: UpdateInstallationResponse = { installation: story };
            return ok(res);
          }
          if (rest === "/bindings" && init.method === "GET") {
            const map = bindings[story.installation] ?? {};
            const res: ListBindingsResponse = {
              bindings: Object.entries(map).map(([location, hand]): BindingView => ({
                installation: story.installation, hand, location,
              })),
            };
            return ok(res);
          }
          const handMatch = /^\/bindings\/([^/]+)$/.exec(rest);
          if (handMatch) {
            const hand = decodeURIComponent(handMatch[1] ?? "");
            const map = bindings[story.installation] ?? {};
            bindings[story.installation] = map;
            // One hand stands in one place, so a rebind MOVES it rather than
            // leaving the wall it used to be dealt at still dealing it.
            for (const [where, what] of Object.entries(map)) if (what === hand) delete map[where];
            if (init.method === "PUT") {
              const req = body as BindHandRequest;
              map[req.location] = hand;
              const res: BindHandResponse = {
                binding: { installation: story.installation, hand, location: req.location },
              };
              return ok(res);
            }
            if (init.method === "DELETE") {
              const res: UnbindHandResponse = {
                installation: story.installation, hand, unboundAt: now(),
              };
              return ok(res);
            }
          }
        }

        // principals ------------------------------------------------------------
        if (c === "/principals/pair" && init.method === "POST") {
          const req = body as PairPrincipalRequest;
          const principal: PrincipalView = {
            principal: nextConsoleId("pr-"),
            label: req.label,
            role: req.role,
            issuedAt: now(),
            issuedBy: "pr-producer",
            ...(req.station !== undefined ? { station: req.station } : {}),
          };
          principals.push(principal);
          // Eight characters that cannot be misread. THE KEY IS NOT HERE: it
          // is minted to the device that redeems the code (7.5.1).
          const code = `PAIR${consoleIds}-K2Q9`;
          const res: PairPrincipalResponse = {
            code, expiresAt: now(), address: base, link: `${base}/pair/${code}`, principal,
          };
          return ok(res);
        }
        if (c === "/principals" && init.method === "GET") {
          const role = query.get("role");
          const withRevoked = query.get("revoked") === "true";
          const list = principals
            .filter((p) => role === null || p.role === role)
            .filter((p) => withRevoked || p.revokedAt === undefined);
          const res: ListPrincipalsResponse = pageOf(list);
          return ok(res);
        }
        const prMatch = /^\/principals\/([^/]+)(\/revoke)?$/.exec(c);
        if (prMatch) {
          const p = principals.find((one) => one.principal === decodeURIComponent(prMatch[1] ?? ""));
          if (!p) return fail(404, "bad_request", "no principal by that id");
          if (prMatch[2] === "/revoke" && init.method === "POST") {
            p.revokedAt = now();
            const res: RevokePrincipalResponse = { principal: p };
            return ok(res);
          }
          if (prMatch[2] === undefined && init.method === "PATCH") {
            const req = body as RelabelPrincipalRequest;
            p.label = req.label;
            const res: RelabelPrincipalResponse = { principal: p };
            return ok(res);
          }
        }

        // bundles ---------------------------------------------------------------
        if (c === "/bundles" && init.method === "GET") {
          const res: ListBundlesResponse = pageOf(bundles);
          return ok(res);
        }
        if (c === "/bundles" && init.method === "POST") {
          const req = body as UploadBundleRequest;
          const bundle: BundleView = {
            build: { ...run.build, version: `0.1.${bundles.length}` },
            id: nextConsoleId("build-"),
            uploadedAt: now(),
            by: PRODUCER,
            state: req.stage === true ? "staged" : "installed",
            metadata: "full",
          };
          bundles.push(bundle);
          journalled(PRODUCER, { kind: "install", build: bundle.build });
          const res: UploadBundleResponse = { bundle, diagnostics: [] };
          return ok(res);
        }
        if (c === "/bundles/rollback" && init.method === "POST") {
          const req = body as RollbackBundleRequest;
          const target = req.build !== undefined
            ? bundles.find((b) => b.id === req.build)
            : bundles.find((b) => b.state === "installed");
          if (!target) return fail(404, "bad_request", "there is no build to roll back to");
          for (const b of bundles) if (b.state === "live") b.state = "rolled-back";
          target.state = "live";
          const res: RollbackBundleResponse = { bundle: target, report: emptyReport() };
          return ok(res);
        }
        const buildMatch = /^\/bundles\/([^/]+)\/(stage|go-live|preview-swap|hot-swap)$/.exec(c);
        if (buildMatch && init.method === "POST") {
          const build = bundles.find((b) => b.id === decodeURIComponent(buildMatch[1] ?? ""));
          if (!build) return fail(409, "stale_build", "no build by that id");
          if (buildMatch[2] === "stage") {
            const res: StageBundleResponse = { bundle: build };
            build.state = "staged";
            return ok(res);
          }
          if (buildMatch[2] === "go-live") {
            const req = body as GoLiveRequest;
            // The install diff is acknowledged PER BREAK before this succeeds
            // (4.11). This content has none, so an empty list is enough.
            const breaks = build.metadata === "stripped" ? ["stations.titles"] : [];
            const outstanding = breaks.filter((path2) => !(req.acknowledged ?? []).includes(path2));
            if (outstanding.length > 0) {
              return fail(409, "contract_break", `acknowledge each break first: ${outstanding.join(", ")}`);
            }
            for (const other of bundles) if (other !== build && other.state === "live") other.state = "installed";
            build.state = "live";
            emit({ type: "run", phase: "build-changed", run } as WireEvent);
            const res: GoLiveResponse = { bundle: build };
            return ok(res);
          }
          if (buildMatch[2] === "preview-swap") {
            // Pure: it touches nothing, which is why it takes no key.
            const res: PreviewSwapResponse = { build: build.build, report: emptyReport() };
            return ok(res);
          }
          const req = body as HotSwapRequest;
          const live = bundles.find((b) => b.state === "live");
          if (req.seenReportFor !== undefined && req.seenReportFor !== live?.id) {
            return fail(409, "stale_build", "the live build moved since you saw that report");
          }
          const res: HotSwapResponse = {
            bundle: build,
            report: emptyReport(),
            seq: journalled(PRODUCER, { kind: "hot-swap", build: build.build }).seq,
          };
          return ok(res);
        }

        // durable state, bridges, messages ---------------------------------------
        if (c === "/durable/reset" && init.method === "POST") {
          const req = body as ResetDurableRequest;
          const story = storyOf(req.installation);
          if (!story) return fail(404, "unknown_installation", "no installation by that id here");
          // The typed confirmation, checked here because the console's dialog
          // is not the guard; the server is (6.5).
          if (req.confirm !== story.name) {
            return fail(400, "bad_request", `type the installation's name to confirm: ${story.name}`);
          }
          const emptied = req.scope === "installation" ? 0 : pockets.size;
          if (req.scope !== "installation") pockets.clear();
          journalled(PRODUCER, { kind: "durable.reset", scope: req.scope });
          const res: ResetDurableResponse = { scope: req.scope, pockets: emptied, at: now() };
          return ok(res);
        }
        if (c === "/bridges" && init.method === "GET") {
          const res: ListBridgesResponse = { bridges };
          return ok(res);
        }
        const bridgeMatch = /^\/bridges\/([^/]+)(\/test)?$/.exec(c);
        if (bridgeMatch) {
          const id = decodeURIComponent(bridgeMatch[1] ?? "");
          const bridge = bridges.find((b) => b.id === id);
          if (bridgeMatch[2] === "/test" && init.method === "POST") {
            const req = (body ?? {}) as TestFireBridgeRequest;
            // "The light desk did not answer" is an ANSWER, so a dead adapter
            // is a 200 with `ok: false`, not a broken request.
            const res: TestFireBridgeResponse = bridge !== undefined
              ? { bridge: id, ok: true, detail: req.payload === undefined ? "sent the adapter's own test payload" : "sent" }
              : { bridge: id, ok: false, detail: `nothing answered at ${id}` };
            return ok(res);
          }
          if (bridgeMatch[2] === undefined && init.method === "PUT") {
            const req = body as ConfigureBridgeRequest;
            const next: BridgeView = {
              ...(bridge ?? { id, kind: req.kind ?? "webhook", enabled: false }),
              ...(req.kind !== undefined ? { kind: req.kind } : {}),
              ...(req.label !== undefined ? { label: req.label } : {}),
              ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
              ...(req.hands !== undefined ? { hands: req.hands } : {}),
              ...(req.flow !== undefined ? { flow: req.flow } : {}),
              ...(req.config !== undefined ? { config: req.config } : {}),
            };
            if (bridge !== undefined) bridges.splice(bridges.indexOf(bridge), 1, next);
            else bridges.push(next);
            const res: ConfigureBridgeResponse = { bridge: next };
            return ok(res);
          }
        }
        if (c === "/messages" && init.method === "POST") {
          const req = body as BroadcastMessageRequest;
          const message: MessageView = {
            id: nextConsoleId("msg-"),
            body: req.body,
            sender: PRODUCER,
            priority: req.priority,
            audience: req.audience,
            at: messageNow(),
            // The denominator of "4 of 5 in the forest have seen it", resolved
            // at SEND time by presence and KEPT: the log carries the number it
            // went out with rather than counting the forest again later.
            delivered: 1,
            acknowledged: 0,
            ...(req.ackRequired === true ? { ackRequired: true, acks: [] } : {}),
          };
          messages.push(message);
          emit({ type: "message", message } as WireEvent);
          const res: BroadcastMessageResponse = { message, delivered: message.delivered ?? 0 };
          return ok(res);
        }
        // The whole SENT log with its counts, which is the producer's own
        // record and so is NOT filtered by audience the way the station route
        // is (6.7).
        if (c === "/messages" && init.method === "GET") {
          const since = query.get("since");
          const limit = Number(query.get("limit") ?? 50);
          const log = messages
            .filter((m) => since === null || m.at >= since)
            .slice(-limit)
            .reverse();
          const res: ListSentMessagesResponse = { messages: log };
          return ok(res);
        }

        return fail(404, "bad_request", `the fake server has no console route for ${init.method} ${c}`);
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
