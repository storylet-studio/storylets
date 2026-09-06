// ---------------------------------------------------------------------------
// The producer identity: the console API (wire 6.5, spec 11), grouped as the
// wire groups it.
//
// THE THIRD BEARER, and the first that is not in the room. A station key is
// hardware the venue owns and a party token is a phone; a PRODUCER key is the
// person running the show, and an integrator or monitor key is automation
// holding the read-only half of the same surface (wire 6.5). So this is a
// third interface rather than a station connection with thirty more methods:
// a crew view written against `StationConnection` cannot reset the durable
// state by accident, and this cannot deal a card as a visitor.
//
// GROUPED, because forty-five verbs in one flat object is a list nobody can
// read and an autocomplete nobody can steer. The groups are the wire's own
// (`runs`, `visits`, `parties`, `world`, `house`, `venue`, `stations`,
// `bindings`, `installations`, `principals`, `bundles`, `durable`, `bridges`,
// `messages`), so 6.5 read aloud is this file's table of contents.
//
// **NO QUEUE. A producer is never in degraded mode's held state.** Every
// station verb goes through the command queue, because a play pressed during a
// wifi blip must land exactly once when the signal returns and the person
// pressing it should never know (spec 17 item 2). A producer's screen is the
// opposite case: the console is the place where what happened has to be true,
// so a command either happened or was refused and the console says which. A
// held force-play would be worse than a failed one, because a producer who
// pressed it would go on to do something else instead, and then it would land.
// So these calls go straight to the transport: a refusal rejects with its
// code, and a blip rejects with `offline` at status 0, which is the console's
// cue to say the command was not sent and RE-READ rather than press again.
// (The key is minted per call, so a second press is deliberately a second
// command; the wire's idempotency protects a retry of one attempt, not a
// producer's change of mind.)
//
// The stream is the one thing here that does hold, and it holds the TIMELINE
// rather than a command: see monitor.ts.
// ---------------------------------------------------------------------------

import { CLOCK_PHASE, CLOCK_SHOW, CLOCK_WALL, WIRE_CONSOLE_PATH, WIRE_PATH } from "@storylet-studio/wire";
import type {
  AckMessageResponse, AdvanceHouseRequest, AdvanceHouseResponse, AdvanceTurnsRequest,
  AdvanceTurnsResponse, BindHandRequest, BindHandResponse, BindStationRequest, BindStationResponse,
  BindStationToLocationRequest, BindStationToLocationResponse, BroadcastMessageRequest,
  BroadcastMessageResponse, BuildId, ClaimPartyRequest, ClaimPartyResponse, Clocks,
  CloseInstallationResponse, ConfigureBridgeRequest, ConfigureBridgeResponse, CreateLocationRequest,
  CreateLocationResponse, DealHouseRequest, DealHouseResponse,
  DetachVisitStationRequest, DetachVisitStationResponse, EditPocketRequest, EditPocketResponse,
  EndRunResponse, EvictCardRequest, EvictCardResponse, FireCueRequest, FireCueResponse,
  ForceDealRequest, ForceDealResponse, ForcePlayRequest, ForcePlayResponse, ForgetPartyResponse,
  GetCueListRequest, GetCueListResponse, GetHouseRequest, GetHouseResponse, GetJournalRequest,
  GetJournalResponse, GetPartyResponse,
  GetVenueResponse, GetVisitLensResponse, GoLiveRequest, GoLiveResponse, HelloResponse,
  HotSwapRequest, HotSwapResponse, InstallationId, IssueCredentialRequest, IssueCredentialResponse,
  ListBindingsResponse, ListBridgesResponse, ListBundlesRequest, ListBundlesResponse,
  ListInstallationsRequest, ListInstallationsResponse, ListLocationsRequest, ListLocationsResponse,
  ListMessagesResponse, ListPartiesRequest, ListPartiesResponse, ListPresenceRequest,
  ListPresenceResponse, ListPrincipalsRequest, ListPrincipalsResponse, ListRunsRequest,
  ListRunsResponse, ListSentMessagesRequest, ListSentMessagesResponse,
  ListVisitsRequest, ListVisitsResponse, MessageId, MoveCredentialRequest,
  MoveCredentialResponse, OpenInstallationResponse, PairPrincipalRequest, PairPrincipalResponse,
  ParkVisitConsoleResponse, PartyId, PauseRunResponse, PlayHouseRequest, PlayHouseResponse,
  PreviewSwapResponse, PrincipalId, PrintLocationSheetRequest, PrintLocationSheetResponse,
  PropertyPath, PutCueListRequest, PutCueListResponse, ReadWorldRequest, ReadWorldResponse,
  RelabelPrincipalRequest, RelabelPrincipalResponse, ResetDurableRequest, ResetDurableResponse,
  RestoreFromJournalRequest, RestoreFromJournalResponse, ResumeRunResponse,
  RevokeCredentialRequest, RevokeCredentialResponse, RevokePrincipalResponse, RollbackBundleRequest,
  RollbackBundleResponse, RunId, SetPropertyRequest, SetPropertyResponse, SnapshotRunResponse,
  StageBundleResponse, StartRunRequest, StartRunResponse, TestFireBridgeRequest,
  TestFireBridgeResponse, UnbindHandRequest, UnbindHandResponse, UpdateInstallationRequest,
  UpdateInstallationResponse, UpdateLocationRequest, UpdateLocationResponse, UploadBundleRequest,
  UploadBundleResponse, VisitId, WriteWorldRequest, WriteWorldResponse,
} from "@storylet-studio/wire";
import { createMonitor } from "./monitor.js";
import type { Monitor } from "./monitor.js";
import type { Timers } from "./queue.js";
import type { EventSourceCtor } from "./stream.js";
import { seg } from "./transport.js";
import type { Bearer, Transport } from "./transport.js";

/**
 * The console's own segment, below the transport's `/v1`.
 *
 * DERIVED from the wire's two constants rather than written out again: the
 * whole point of that package is that a path has one definition, and a
 * `"/console"` typed here would be a second one waiting to disagree.
 */
const CONSOLE = WIRE_CONSOLE_PATH.startsWith(WIRE_PATH)
  ? WIRE_CONSOLE_PATH.slice(WIRE_PATH.length)
  : WIRE_CONSOLE_PATH;

/**
 * The cue GO fires by default.
 *
 * GO is not a run route. A run STARTS (a fresh world with a fresh seed, 5.4.1)
 * and the show GOES, and those are two acts a producer performs minutes apart:
 * the house opens at 19:00 and GO is at 19:05, which is exactly why
 * `world.time_show` counts from the second and not the first (10.1). So GO is
 * a cue without a time, like Hold and Resume were before the run gained routes
 * of its own for them (10.3), and `runs.go()` fires one. The id is the Venue
 * kit's; any other may be passed.
 */
export const GO_CUE = "go";

/**
 * The prefix `world.clocks()` narrows its read to.
 *
 * The three clocks share the `time_` prefix ON PURPOSE (10.1): a producer
 * reading down a project's `@world` list has to find them as a group, and
 * `now`, `show` and `phase` scattered alphabetically said nothing about each
 * other. It is what the console's World surface groups on, so it is what a
 * clock read narrows on.
 */
export const CLOCK_PREFIX = "world.time_";

// --- the desks, in the wire's own order --------------------------------------

/** Runs: the show's life (5.4.1), and its journal (5.2). */
export interface RunsDesk {
  /** A fresh world with a fresh seed. */
  start(req: StartRunRequest): Promise<StartRunResponse>;
  /** Every open visit CLOSED, not parked, and each pocket lifted (5.4). */
  end(run: RunId): Promise<EndRunResponse>;
  list(req: ListRunsRequest): Promise<ListRunsResponse>;
  /** Windowed and recent-first, with the wire's six filters: `since`,
   *  `until`, `kinds`, `flow`, `station` and `hand`. A day's run is a long
   *  list and the producer's question is usually "what happened at 14:32", or
   *  else "what has the well been doing" (spec 11's Journal surface). */
  journal(req: GetJournalRequest): Promise<GetJournalResponse>;
  snapshot(run: RunId): Promise<SnapshotRunResponse>;
  /** Snapshot plus replay: the recovery path, used deliberately (5.2). */
  restoreFromJournal(req: RestoreFromJournalRequest): Promise<RestoreFromJournalResponse>;
  /** Press GO. A cue without a time (10.3), so this fires one: see
   *  {@link GO_CUE}. */
  go(req: { installation: InstallationId; cue?: string }): Promise<FireCueResponse>;
  /** Hold: the show waits. Reads still answer; mutations get `run_paused`,
   *  `world.time_show` stops and every timed box stops with it (10.3). */
  hold(run: RunId): Promise<PauseRunResponse>;
  /** The clocks pick up where the hold left them, because they are derived
   *  from the journaled holds rather than ticked (10.2). */
  resume(run: RunId): Promise<ResumeRunResponse>;
}

/** The cue list (10.3). Here because GO, Hold and Resume are its buttons and a
 *  console that can press GO must be able to find the entry it is pressing. */
export interface CuesDesk {
  list(req: GetCueListRequest): Promise<GetCueListResponse>;
  /** The whole list at once, because reordering by patch is where an ordered
   *  list goes wrong. */
  put(req: PutCueListRequest): Promise<PutCueListResponse>;
  fire(req: FireCueRequest): Promise<FireCueResponse>;
}

/** Visits: the live roster, and the producer's hands in one flow (spec 11). */
export interface VisitsDesk {
  list(req: ListVisitsRequest): Promise<ListVisitsResponse>;
  /** That flow's board, properties and log: the answer to "what is happening
   *  to these four people". `log` is how many entries to bring back. */
  lens(visit: VisitId, log?: number): Promise<GetVisitLensResponse>;
  /** The "it stuck, give them something" button. Bound by no station's hands. */
  forceDeal(req: ForceDealRequest): Promise<ForceDealResponse>;
  /** Playing on a party's behalf, which a performer's improvised answer
   *  sometimes needs (5.7). */
  forcePlay(req: ForcePlayRequest): Promise<ForcePlayResponse>;
  /** Take a card off a board without playing it: the stuck-beat fix. */
  evict(req: EvictCardRequest): Promise<EvictCardResponse>;
  /** One box, one flow. With no `visit` it is the cue's own shape (every open
   *  flow) reached by hand, and the path loses the segment with it. */
  advanceTurns(req: AdvanceTurnsRequest): Promise<AdvanceTurnsResponse>;
  /** A property on one flow, journaled with the actor. With no `visit` this is
   *  a shared or `@world` write, which is what `world.write` is for. */
  setProperty(req: SetPropertyRequest): Promise<SetPropertyResponse>;
  /** Detach somebody else's station: the tablet left on a bench. */
  detach(req: DetachVisitStationRequest): Promise<DetachVisitStationResponse>;
  /** Park a visit: the party has plainly gone home. */
  park(visit: VisitId): Promise<ParkVisitConsoleResponse>;
}

/** Credentials, which are how a party proves who it is (7.1). */
export interface CredentialsDesk {
  /** Another credential for the same party: a wristband per member, a day
   *  pass, a replacement for a lost one. The wire declares ONE route for this
   *  and it is not under `/console` (`POST /v1/parties/{party}/credentials`),
   *  so a producer issues on the route the wire names rather than on a console
   *  path nobody declared. */
  issue(req: IssueCredentialRequest): Promise<IssueCredentialResponse>;
  /** Instant, from the console (7.5). */
  revoke(req: RevokeCredentialRequest): Promise<RevokeCredentialResponse>;
  /** Someone changed group: the wristband resolves to another party from now
   *  on. Pockets do not split or merge; only the credential moves. */
  move(req: MoveCredentialRequest): Promise<MoveCredentialResponse>;
}

/** Parties: the durable identities, claimed and transient (7.1, 7.4). */
export interface PartiesDesk {
  list(req: ListPartiesRequest): Promise<ListPartiesResponse>;
  /** The detail: pocket, credentials, parked state, and the live visit. */
  detail(party: PartyId): Promise<GetPartyResponse>;
  /** A producer editing durable values by path: the fix for a mis-set flag. */
  editPocket(req: EditPocketRequest): Promise<EditPocketResponse>;
  /** Make a transient party permanent. On the station route, for the reason
   *  {@link CredentialsDesk.issue} states. */
  claim(req: ClaimPartyRequest): Promise<ClaimPartyResponse>;
  credentials: CredentialsDesk;
  /** Right to be forgotten: the record, the parked state and the pocket, and
   *  the visit closed if live, so the next persist cannot resurrect it (7.4). */
  forget(party: PartyId): Promise<ForgetPartyResponse>;
}

/** `@world`, whole, and the three clocks derived from it (10.1, 10.2). */
export interface WorldDesk {
  read(req: ReadWorldRequest): Promise<ReadWorldResponse>;
  /** Actor producer, journaled. `writable: false` protects a property from
   *  OUTCOMES, not from the person running the show (5.6). */
  write(req: WriteWorldRequest): Promise<WriteWorldResponse>;
  /** The three clocks as one reading.
   *
   *  There is no clock ROUTE, and there should not be: the clocks are `@world`
   *  properties derived by the server's resolver at read time from journaled
   *  facts, never ticked and never written (10.2). So this is the narrowed
   *  read, shaped. A project that renamed its clocks tells the installation
   *  which is which and reads them through `read`; these are the kit's names,
   *  which are the convention the docs teach. */
  clocks(installation: InstallationId): Promise<Clocks>;
}

/** The house flow: the venue's own, never a player's (5.5). */
export interface HouseDesk {
  /** The house's hands as they stand, READ rather than dealt: what the map
   *  draws beside everybody else's table, and what a cue editor offers as the
   *  target of `deal-house`. Pure, so it carries no key. */
  list(req: GetHouseRequest): Promise<GetHouseResponse>;
  deal(req: DealHouseRequest): Promise<DealHouseResponse>;
  play(req: PlayHouseRequest): Promise<PlayHouseResponse>;
  /** A house box without `turn` advances per play as authored, and a cue (or
   *  this) may nudge it by hand. */
  advance(req: AdvanceHouseRequest): Promise<AdvanceHouseResponse>;
}

/** The venue's locations: a position on the plan with a printed code (4a). */
export interface LocationsDesk {
  list(req?: ListLocationsRequest): Promise<ListLocationsResponse>;
  /** The server mints the id and the printed code; neither is the caller's to
   *  choose, because the code goes on a wall and outlives every story that
   *  binds to it. */
  create(req: CreateLocationRequest): Promise<CreateLocationResponse>;
  /** Move it on the plan, or rename it. The printed CODE never changes:
   *  placards are printed once (12.2). */
  update(req: UpdateLocationRequest): Promise<UpdateLocationResponse>;
}

/** The venue: the building, one per server, above every installation (4a). */
export interface VenueDesk {
  get(): Promise<GetVenueResponse>;
  locations: LocationsDesk;
  /** Label and code per location, and nothing else. What a venue prints is the
   *  venue's own design (12.2), so the server hands over the addresses and
   *  never the artwork. Pure, so it carries no key. */
  printSheet(req?: PrintLocationSheetRequest): Promise<PrintLocationSheetResponse>;
}

/** Stations: hardware with a key, owned by the venue (4a, 5.7). */
export interface StationsDesk {
  /** What kind of device this is and what it is called: provisioning, not
   *  content. It carries no hands: which story a station shows is decided per
   *  party at the handshake, so hands live in `bindings`. */
  bind(req: BindStationRequest): Promise<BindStationResponse>;
  /** Where the hardware stands. It names a LOCATION rather than carrying x and
   *  y, because positions belong to locations and geometry in two places is
   *  geometry that disagrees (4a). */
  bindToLocation(req: BindStationToLocationRequest): Promise<BindStationToLocationResponse>;
  /** What the map draws, and the answer to "who is in the forest". A venue
   *  fact, so this is every station in the building unless it is narrowed. */
  presence(req?: ListPresenceRequest): Promise<ListPresenceResponse>;
}

/** One installation's hands, bound to the venue's locations (4a). */
export interface BindingsDesk {
  list(installation: InstallationId): Promise<ListBindingsResponse>;
  /** What makes one wall two different beats in two different stories. */
  bind(req: BindHandRequest): Promise<BindHandResponse>;
  /** The hand is dealt nowhere in the building from now on. */
  unbind(req: UnbindHandRequest): Promise<UnbindHandResponse>;
}

/** Installations: the stories running at this venue (4a). */
export interface InstallationsDesk {
  list(req?: ListInstallationsRequest): Promise<ListInstallationsResponse>;
  /** Opening puts a story in `hello`'s list and in a walk-up's chooser.
   *  Distinct from starting a run, which is the story beginning to play. */
  open(installation: InstallationId): Promise<OpenInstallationResponse>;
  /** The door shuts. Open visits are untouched: closing the door and ending
   *  the run are two acts. */
  close(installation: InstallationId): Promise<CloseInstallationResponse>;
  update(req: UpdateInstallationRequest): Promise<UpdateInstallationResponse>;
}

/** Principals: pairing, not accounts (7.5, 7.5.1). */
export interface PrincipalsDesk {
  /** A one-time code for any role: eight characters that cannot be misread,
   *  ten-minute expiry, single use. The KEY is never in the answer; it is
   *  minted to the device that redeems the code. */
  pair(req: PairPrincipalRequest): Promise<PairPrincipalResponse>;
  list(req?: ListPrincipalsRequest): Promise<ListPrincipalsResponse>;
  /** The label is the attribution, so fixing a typo fixes the journal's future
   *  lines. */
  relabel(req: RelabelPrincipalRequest): Promise<RelabelPrincipalResponse>;
  /** Instant, felt at the next call, with a refusal that names who and when. */
  revoke(principal: PrincipalId): Promise<RevokePrincipalResponse>;
}

/** Builds: install, stage, go live, hot swap, roll back (section 9). */
export interface BundlesDesk {
  list(req: ListBundlesRequest): Promise<ListBundlesResponse>;
  upload(req: UploadBundleRequest): Promise<UploadBundleResponse>;
  /** What the NEXT run starts on, which since runs restart daily is the common
   *  case for a content update. */
  stage(build: BuildId): Promise<StageBundleResponse>;
  /** The install diff is acknowledged per break before this succeeds (4.11). */
  goLive(req: GoLiveRequest): Promise<GoLiveResponse>;
  rollback(req: RollbackBundleRequest): Promise<RollbackBundleResponse>;
  /** The 4.9 report against the live run, before anything moves. Pure, so it
   *  carries no key. */
  previewSwap(build: BuildId): Promise<PreviewSwapResponse>;
  /** A new engine on the new build, the save carried across, every flow
   *  rebuilt. Journaled, so it is reversible like any other command; its
   *  honest limit is that side effects already sent to the building do not
   *  rewind. */
  hotSwap(req: HotSwapRequest): Promise<HotSwapResponse>;
}

/** Durable state: the pockets and the installation memory (4.2). */
export interface DurableDesk {
  /** Typed confirmation in the console, journaled here. `all` is all of ONE
   *  story's, never the venue's. */
  reset(req: ResetDurableRequest): Promise<ResetDurableResponse>;
}

/** Bridges: cues out, triggers in (5.6). */
export interface BridgesDesk {
  list(installation: InstallationId): Promise<ListBridgesResponse>;
  /** The adapter's own settings, which the server does not interpret. */
  configure(req: ConfigureBridgeRequest): Promise<ConfigureBridgeResponse>;
  /** Fire a cue at the building with nobody in it: the morning-of check. A
   *  failure is a 200 with `ok: false`, because "the light desk did not
   *  answer" is an answer, not a broken request. */
  testFire(req: TestFireBridgeRequest): Promise<TestFireBridgeResponse>;
}

/** Messaging (6.7). */
export interface ProducerMessageDesk {
  /** A producer to everyone, a kind, a location, a zone or one station. */
  broadcast(req: BroadcastMessageRequest): Promise<BroadcastMessageResponse>;
  /** The producer's own INBOX: crew replies and help calls, filtered to what
   *  is addressed to this bearer. On the station route, which is where the
   *  wire declares `GET /v1/messages`. */
  list(since?: string): Promise<ListMessagesResponse>;
  /**
   * The whole SENT log with its ack counts, on the console's own route.
   *
   * `log` rather than a second `list`, because the two answer different
   * questions and a desk with two verbs that read alike is a desk a console
   * calls the wrong half of: `list` is what was said TO the producer, this is
   * what the producer said to everybody, and only this one carries "4 of 5 in
   * the forest have seen it".
   */
  log(req?: ListSentMessagesRequest): Promise<ListSentMessagesResponse>;
  ack(id: MessageId): Promise<AckMessageResponse>;
}

/**
 * A producer connection: the console API, and a monitor stream.
 *
 * Held by the console as a session, or by an integrator or monitor key for
 * automation. It has no `visit` and no `deal`: a producer drives other
 * people's flows through {@link VisitsDesk} and never has one of its own.
 */
export interface ProducerConnection {
  /** What the server is, right now, to this key. */
  hello(): Promise<HelloResponse>;
  runs: RunsDesk;
  cues: CuesDesk;
  visits: VisitsDesk;
  parties: PartiesDesk;
  world: WorldDesk;
  house: HouseDesk;
  venue: VenueDesk;
  stations: StationsDesk;
  bindings: BindingsDesk;
  installations: InstallationsDesk;
  principals: PrincipalsDesk;
  bundles: BundlesDesk;
  durable: DurableDesk;
  bridges: BridgesDesk;
  messages: ProducerMessageDesk;
  /** Everything, flow-tagged. Idle until `monitor.start()`. */
  monitor: Monitor;
  /** Stop: the stream closes and its listeners go. Nothing is queued, so
   *  nothing is refused on the way out. */
  close(): void;
}

export interface ProducerDeps {
  transport: Transport;
  bearer: Bearer;
  EventSource?: EventSourceCtor;
  timers?: Timers;
  key(): string;
}

export function createProducerConnection(deps: ProducerDeps): ProducerConnection {
  const { transport, bearer } = deps;

  /** A read. Straight out, and never queued: see the header. */
  const read = <T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> =>
    transport.send<T>(bearer, { method: "GET", path, ...(query !== undefined ? { query } : {}) });

  /** A mutation, with the key every one of them carries (wire 6.4). */
  const write = <T>(
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> => transport.send<T>(bearer, {
    method,
    path,
    ...(body !== undefined ? { body } : {}),
    idempotencyKey: deps.key(),
  });

  /** A POST the wire declares as pure: the print sheet and the swap preview
   *  touch nothing, so neither takes a key and neither is journaled. */
  const pure = <T>(path: string, body?: unknown): Promise<T> =>
    transport.send<T>(bearer, { method: "POST", path, ...(body !== undefined ? { body } : {}) });

  /** Paging, out of a request: `{ cursor, limit }` and nothing else. */
  const at = (req: { cursor?: string; limit?: number }): Record<string, string | number | undefined> =>
    ({ cursor: req.cursor, limit: req.limit });

  const monitor = createMonitor({
    transport,
    bearer: () => bearer,
    ...(deps.EventSource !== undefined ? { EventSource: deps.EventSource } : {}),
    ...(deps.timers !== undefined ? { timers: deps.timers } : {}),
  });

  const cues: CuesDesk = {
    list(req) {
      return read<GetCueListResponse>(`${CONSOLE}/cues`, { installation: req.installation, run: req.run });
    },
    put(req) {
      return write<PutCueListResponse>("PUT", `${CONSOLE}/cues`, req);
    },
    fire(req) {
      return write<FireCueResponse>("POST", `${CONSOLE}/cues/${seg(req.cue)}/fire`, req);
    },
  };

  const runs: RunsDesk = {
    start(req) {
      return write<StartRunResponse>("POST", `${CONSOLE}/runs`, req);
    },
    end(run) {
      return write<EndRunResponse>("POST", `${CONSOLE}/runs/${seg(run)}/end`, { run });
    },
    list(req) {
      return read<ListRunsResponse>(`${CONSOLE}/runs`, { installation: req.installation, ...at(req) });
    },
    journal(req) {
      return read<GetJournalResponse>(`${CONSOLE}/runs/${seg(req.run)}/journal`, {
        since: req.since,
        until: req.until,
        // A repeated parameter is a shape the wire does not describe, so the
        // list rides as one comma-separated value, which is the only form a
        // `Record<string, string>` query can carry without inventing one.
        kinds: req.kinds !== undefined ? req.kinds.join(",") : undefined,
        flow: req.flow,
        station: req.station,
        hand: req.hand,
        ...at(req),
      });
    },
    snapshot(run) {
      return write<SnapshotRunResponse>("POST", `${CONSOLE}/runs/${seg(run)}/snapshot`, { run });
    },
    restoreFromJournal(req) {
      return write<RestoreFromJournalResponse>("POST", `${CONSOLE}/runs/${seg(req.run)}/restore`, req);
    },
    go(req) {
      const cue = req.cue ?? GO_CUE;
      return cues.fire({ installation: req.installation, cue });
    },
    hold(run) {
      return write<PauseRunResponse>("POST", `${CONSOLE}/runs/${seg(run)}/pause`, { run });
    },
    resume(run) {
      return write<ResumeRunResponse>("POST", `${CONSOLE}/runs/${seg(run)}/resume`, { run });
    },
  };

  /** The visit segment, which the wire marks OPTIONAL on `advanceTurns` and
   *  `setProperty`: absent means every open flow, and a path parameter that is
   *  absent leaves the segment out rather than sending an empty one. */
  const under = (visit: VisitId | undefined, tail: string): string =>
    visit !== undefined ? `${CONSOLE}/visits/${seg(visit)}/${tail}` : `${CONSOLE}/visits/${tail}`;

  const visits: VisitsDesk = {
    list(req) {
      return read<ListVisitsResponse>(`${CONSOLE}/visits`, {
        installation: req.installation,
        idle: req.idle,
        location: req.location,
        zone: req.zone,
        ...at(req),
      });
    },
    lens(visit, log) {
      return read<GetVisitLensResponse>(`${CONSOLE}/visits/${seg(visit)}/lens`, { log });
    },
    forceDeal(req) {
      return write<ForceDealResponse>("POST", `${CONSOLE}/visits/${seg(req.visit)}/deal`, req);
    },
    forcePlay(req) {
      return write<ForcePlayResponse>("POST", `${CONSOLE}/visits/${seg(req.visit)}/play`, req);
    },
    evict(req) {
      return write<EvictCardResponse>("POST", `${CONSOLE}/visits/${seg(req.visit)}/evict`, req);
    },
    advanceTurns(req) {
      return write<AdvanceTurnsResponse>("POST", under(req.visit, "turns"), req);
    },
    setProperty(req) {
      return write<SetPropertyResponse>("POST", under(req.visit, "properties"), req);
    },
    detach(req) {
      return write<DetachVisitStationResponse>(
        "DELETE",
        `${CONSOLE}/visits/${seg(req.visit)}/stations/${seg(req.station)}`,
      );
    },
    park(visit) {
      return write<ParkVisitConsoleResponse>("DELETE", `${CONSOLE}/visits/${seg(visit)}`);
    },
  };

  const credentials: CredentialsDesk = {
    issue(req) {
      return write<IssueCredentialResponse>("POST", `/parties/${seg(req.partyId)}/credentials`, req);
    },
    revoke(req) {
      return write<RevokeCredentialResponse>(
        "POST",
        `${CONSOLE}/parties/${seg(req.party)}/credentials/${seg(req.credential)}/revoke`,
        req,
      );
    },
    move(req) {
      return write<MoveCredentialResponse>("POST", `${CONSOLE}/credentials/${seg(req.credential)}/move`, req);
    },
  };

  const parties: PartiesDesk = {
    list(req) {
      return read<ListPartiesResponse>(`${CONSOLE}/parties`, {
        installation: req.installation,
        claimed: req.claimed,
        live: req.live,
        callSign: req.callSign,
        ...at(req),
      });
    },
    detail(party) {
      return read<GetPartyResponse>(`${CONSOLE}/parties/${seg(party)}`);
    },
    editPocket(req) {
      return write<EditPocketResponse>("PATCH", `${CONSOLE}/parties/${seg(req.party)}/pocket`, req);
    },
    claim(req) {
      return write<ClaimPartyResponse>("POST", `/parties/${seg(req.partyId)}/claim`, req);
    },
    credentials,
    forget(party) {
      return write<ForgetPartyResponse>("DELETE", `${CONSOLE}/parties/${seg(party)}`);
    },
  };

  const world: WorldDesk = {
    read(req) {
      return read<ReadWorldResponse>(`${CONSOLE}/world`, {
        installation: req.installation,
        prefix: req.prefix,
      });
    },
    write(req) {
      return write<WriteWorldResponse>("POST", `${CONSOLE}/world`, req);
    },
    async clocks(installation) {
      const res = await read<ReadWorldResponse>(`${CONSOLE}/world`, {
        installation,
        prefix: CLOCK_PREFIX,
      });
      const value = (path: PropertyPath): unknown => res.properties.find((p) => p.path === path)?.value;
      const wall = value(CLOCK_WALL);
      const show = value(CLOCK_SHOW);
      const phase = value(CLOCK_PHASE);
      // Coerced rather than trusted: a store keeps a scalar and `Clocks` says
      // which of the three it is. A clock the project renamed is simply absent,
      // and absent reads as the empty answer rather than as a wrong one. Both
      // numbers go through `Number` so a store that kept a numeric clock as a
      // string still reads as the number it is: `time_wall` is minutes since
      // midnight in the venue's zone, not an instant (10.1).
      const minutes = (v: unknown): number => {
        const n = typeof v === "number" ? v : Number(v ?? 0);
        return Number.isFinite(n) ? n : 0;
      };
      return {
        time_wall: minutes(wall),
        time_show: minutes(show),
        time_phase: typeof phase === "string" ? phase : "",
      };
    },
  };

  const house: HouseDesk = {
    list(req) {
      return read<GetHouseResponse>(`${CONSOLE}/house`, { installation: req.installation });
    },
    deal(req) {
      return write<DealHouseResponse>("POST", `${CONSOLE}/house/deal`, req);
    },
    play(req) {
      return write<PlayHouseResponse>("POST", `${CONSOLE}/house/play`, req);
    },
    advance(req) {
      return write<AdvanceHouseResponse>("POST", `${CONSOLE}/house/turns`, req);
    },
  };

  const venue: VenueDesk = {
    get() {
      return read<GetVenueResponse>(`${CONSOLE}/venue`);
    },
    locations: {
      list(req = {}) {
        return read<ListLocationsResponse>(`${CONSOLE}/venue/locations`, at(req));
      },
      create(req) {
        return write<CreateLocationResponse>("POST", `${CONSOLE}/venue/locations`, req);
      },
      update(req) {
        return write<UpdateLocationResponse>(
          "PATCH",
          `${CONSOLE}/venue/locations/${seg(req.location)}`,
          req,
        );
      },
    },
    printSheet(req = {}) {
      return pure<PrintLocationSheetResponse>(`${CONSOLE}/venue/locations/print`, req);
    },
  };

  const stations: StationsDesk = {
    bind(req) {
      return write<BindStationResponse>("POST", `${CONSOLE}/stations/${seg(req.station)}/binding`, req);
    },
    bindToLocation(req) {
      return write<BindStationToLocationResponse>(
        "POST",
        `${CONSOLE}/stations/${seg(req.station)}/location`,
        req,
      );
    },
    presence(req = {}) {
      return read<ListPresenceResponse>(`${CONSOLE}/stations/presence`, {
        location: req.location,
        zone: req.zone,
        installation: req.installation,
        kind: req.kind,
      });
    },
  };

  const bindings: BindingsDesk = {
    list(installation) {
      return read<ListBindingsResponse>(`${CONSOLE}/installations/${seg(installation)}/bindings`);
    },
    bind(req) {
      return write<BindHandResponse>(
        "PUT",
        `${CONSOLE}/installations/${seg(req.installation)}/bindings/${seg(req.hand)}`,
        req,
      );
    },
    unbind(req) {
      return write<UnbindHandResponse>(
        "DELETE",
        `${CONSOLE}/installations/${seg(req.installation)}/bindings/${seg(req.hand)}`,
      );
    },
  };

  const installations: InstallationsDesk = {
    list(req = {}) {
      return read<ListInstallationsResponse>(`${CONSOLE}/installations`, { open: req.open, ...at(req) });
    },
    open(installation) {
      return write<OpenInstallationResponse>(
        "POST",
        `${CONSOLE}/installations/${seg(installation)}/open`,
        { installation },
      );
    },
    close(installation) {
      return write<CloseInstallationResponse>(
        "POST",
        `${CONSOLE}/installations/${seg(installation)}/close`,
        { installation },
      );
    },
    update(req) {
      return write<UpdateInstallationResponse>(
        "PATCH",
        `${CONSOLE}/installations/${seg(req.installation)}`,
        req,
      );
    },
  };

  const principals: PrincipalsDesk = {
    pair(req) {
      return write<PairPrincipalResponse>("POST", `${CONSOLE}/principals/pair`, req);
    },
    list(req = {}) {
      return read<ListPrincipalsResponse>(`${CONSOLE}/principals`, {
        role: req.role,
        revoked: req.revoked,
        ...at(req),
      });
    },
    relabel(req) {
      return write<RelabelPrincipalResponse>(
        "PATCH",
        `${CONSOLE}/principals/${seg(req.principal)}`,
        req,
      );
    },
    revoke(principal) {
      return write<RevokePrincipalResponse>(
        "POST",
        `${CONSOLE}/principals/${seg(principal)}/revoke`,
        { principal },
      );
    },
  };

  const bundles: BundlesDesk = {
    list(req) {
      return read<ListBundlesResponse>(`${CONSOLE}/bundles`, {
        installation: req.installation,
        ...at(req),
      });
    },
    upload(req) {
      return write<UploadBundleResponse>("POST", `${CONSOLE}/bundles`, req);
    },
    stage(build) {
      return write<StageBundleResponse>("POST", `${CONSOLE}/bundles/${seg(build)}/stage`, { build });
    },
    goLive(req) {
      return write<GoLiveResponse>("POST", `${CONSOLE}/bundles/${seg(req.build)}/go-live`, req);
    },
    rollback(req) {
      return write<RollbackBundleResponse>("POST", `${CONSOLE}/bundles/rollback`, req);
    },
    previewSwap(build) {
      return pure<PreviewSwapResponse>(`${CONSOLE}/bundles/${seg(build)}/preview-swap`, { build });
    },
    hotSwap(req) {
      return write<HotSwapResponse>("POST", `${CONSOLE}/bundles/${seg(req.build)}/hot-swap`, req);
    },
  };

  const durable: DurableDesk = {
    reset(req) {
      return write<ResetDurableResponse>("POST", `${CONSOLE}/durable/reset`, req);
    },
  };

  const bridges: BridgesDesk = {
    list(installation) {
      return read<ListBridgesResponse>(`${CONSOLE}/bridges`, { installation });
    },
    configure(req) {
      return write<ConfigureBridgeResponse>("PUT", `${CONSOLE}/bridges/${seg(req.bridge)}`, req);
    },
    testFire(req) {
      return write<TestFireBridgeResponse>("POST", `${CONSOLE}/bridges/${seg(req.bridge)}/test`, req);
    },
  };

  const messages: ProducerMessageDesk = {
    broadcast(req) {
      return write<BroadcastMessageResponse>("POST", `${CONSOLE}/messages`, req);
    },
    list(since) {
      return read<ListMessagesResponse>("/messages", { since });
    },
    log(req = {}) {
      return read<ListSentMessagesResponse>(`${CONSOLE}/messages`, {
        installation: req.installation,
        since: req.since,
        limit: req.limit,
      });
    },
    ack(id) {
      return write<AckMessageResponse>("POST", `/messages/${seg(id)}/ack`, { id });
    },
  };

  return {
    hello() {
      return transport.send<HelloResponse>(bearer, { method: "POST", path: "/hello", body: {} });
    },
    runs,
    cues,
    visits,
    parties,
    world,
    house,
    venue,
    stations,
    bindings,
    installations,
    principals,
    bundles,
    durable,
    bridges,
    messages,
    monitor,
    close() {
      monitor.close();
    },
  };
}
