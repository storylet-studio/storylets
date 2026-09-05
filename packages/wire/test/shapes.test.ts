// ---------------------------------------------------------------------------
// One literal of every request, response and event on the wire.
//
// This file is TYPE-LEVEL COVERAGE and is meant to be dull: if a shape
// changes, this file stops compiling, and the compile is the assertion. It is
// the cheapest possible stand-in for the thing that actually caught the old
// system's six shape mismatches, which was two ends importing one definition.
//
// Keep it mechanical: one literal per type, required fields only unless an
// optional field is the point of the type, and no cleverness that would let a
// shape change through.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { LoadReport } from "@storylet-studio/model";
import {
  CLOCK_PATHS, CLOCK_PHASE, CLOCK_SHOW, CLOCK_WALL, HOUSE_FLOW, IDEMPOTENCY_HEADER,
  WIRE_CONSOLE_PATH, WIRE_PATH, WIRE_VERSION,
} from "../src/index.js";
import type {
  Actor, AckMessageRequest, AckMessageResponse, AdvanceHouseRequest, AdvanceHouseResponse,
  AdvanceTurnsRequest, AdvanceTurnsResponse, AttachAtLocationRequest, AttachAtLocationResponse,
  BindHandRequest, BindHandResponse, BindingView, BindStationRequest, BindStationResponse,
  BindStationToLocationRequest, BindStationToLocationResponse, BoardView, BridgeView,
  BroadcastMessageRequest,
  BroadcastMessageResponse, BuildIdentity, BundleView, ChooseInstallationRequest,
  ChooseInstallationResponse, ClaimPartyRequest, ClaimPartyResponse,
  CloseInstallationRequest, CloseInstallationResponse,
  Clocks, ConfigureBridgeRequest, ConfigureBridgeResponse, CreateLocationRequest,
  CreateLocationResponse, CreateStreamTicketRequest,
  CreateStreamTicketResponse, CredentialView, CueAction, CueEntry, DealHouseRequest,
  DealHouseResponse, DealRequest, DealResponse, DealtCardView, DetachStationRequest,
  DetachStationResponse, DetachVisitStationRequest, DetachVisitStationResponse, EditPocketRequest,
  EditPocketResponse, EndRunRequest, EndRunResponse, EvictCardRequest, EvictCardResponse,
  FireCueRequest, FireCueResponse, ForceDealRequest, ForceDealResponse, ForcePlayRequest,
  ForcePlayResponse, ForgetPartyRequest, ForgetPartyResponse, GetBoardRequest, GetBoardResponse,
  GetContractRequest, GetContractResponse, GetCueListRequest, GetCueListResponse, GetJournalRequest,
  GetJournalResponse, GetOutcomesRequest, GetOutcomesResponse, GetPartyRequest, GetPartyResponse,
  GetPropertiesRequest, GetPropertiesResponse, GetVenueRequest, GetVenueResponse,
  GetVisitLensRequest, GetVisitLensResponse,
  GetWorldRequest, GetWorldResponse, GoLiveRequest, GoLiveResponse, HandshakeRequest,
  HandshakeResponse, HelloRequest, HelloResponse, HotSwapRequest, HotSwapResponse,
  InstallationView, IssueCredentialRequest, IssueCredentialResponse, JournalEntry,
  ListBindingsRequest, ListBindingsResponse, ListBridgesRequest,
  ListBridgesResponse, ListBundlesRequest, ListBundlesResponse, ListInstallationsRequest,
  ListInstallationsResponse, ListLocationsRequest, ListLocationsResponse, ListMessagesRequest,
  ListMessagesResponse, ListPartiesRequest, ListPartiesResponse, ListPresenceRequest,
  ListPresenceResponse, ListPrincipalsRequest, ListPrincipalsResponse, ListRevisionsRequest,
  ListRevisionsResponse, ListRunsRequest, ListRunsResponse, ListVisitsRequest, ListVisitsResponse,
  LocationView, MessageAudience, MessageView, MintPartyRequest, MintPartyResponse,
  MoveCredentialRequest, MoveCredentialResponse, NewFromSeedRequest, NewFromSeedResponse,
  OpenInstallationRequest, OpenInstallationResponse,
  OpenVisitRequest, OpenVisitResponse, OutcomeViewWire, PairPrincipalRequest, PairPrincipalResponse,
  PairRequest, PairResponse, ParkVisitConsoleRequest, ParkVisitConsoleResponse, ParkVisitRequest,
  ParkVisitResponse, PartyView, PauseRunRequest, PauseRunResponse, PeekRequest, PeekResponse,
  PlayHouseRequest, PlayHouseResponse, PlayRequest,
  PlayResponse, PresenceView, PreviewSwapRequest, PreviewSwapResponse, PrincipalView,
  PrintLocationSheetRequest, PrintLocationSheetResponse,
  PropertyView, PullProjectRequest, PullProjectResponse, PushProjectRequest, PushProjectResponse,
  PutCueListRequest, PutCueListResponse, ReadWorldRequest, ReadWorldResponse, RelabelPrincipalRequest,
  RelabelPrincipalResponse, ResetDurableRequest, ResetDurableResponse, RestoreFromJournalRequest,
  RestoreFromJournalResponse, ResumeRunRequest, ResumeRunResponse, RevisionView,
  RevokeCredentialRequest, RevokeCredentialResponse, RevokePrincipalRequest, RevokePrincipalResponse,
  RollbackBundleRequest, RollbackBundleResponse, RunView, SendMessageRequest, SendMessageResponse,
  SetPresenceRequest, SetPresenceResponse, SetPropertyRequest, SetPropertyResponse,
  SnapshotRunRequest, SnapshotRunResponse, StageBundleRequest, StageBundleResponse,
  StartRunRequest, StartRunResponse, StationView, TestFireBridgeRequest, TestFireBridgeResponse,
  TurnsView, UnbindHandRequest, UnbindHandResponse, UpdateInstallationRequest,
  UpdateInstallationResponse, UpdateLocationRequest, UpdateLocationResponse, UploadBundleRequest,
  UploadBundleResponse, VenueView, VisitView, WireCommand, WireError,
  WireErrorCode, WireEvent, WireTraceEvent, WriteWorldRequest, WriteWorldResponse,
} from "../src/index.js";

// --- the fixtures every literal below is built from ---------------------------

const AT = "2026-09-05T14:32:11.204Z";
const PARTY = "01J8Z5Q2F0RS9T3W4X5Y6Z7A8B";
const VISIT = "01J8Z5Q2F0RS9T3W4X5Y6Z7A8B";
const STATION = "st_well";
const VENUE = "vn_the_park";
const LOCATION = "lo_the_well";
const INSTALLATION = "inst_the_park";
const RUN = "run_2026-09-05";
const PRINCIPAL = "pr_sam";

const card: DealtCardView = { id: "ambush-at-the-ford", title: "Ambush at the ford", purpose: "raise the stakes", fields: { music: "tense" } };
const outcome: OutcomeViewWire = { id: "stand-and-fight", title: "Stand and fight", available: true };
const board: BoardView = { "the-well": [card] };
const turns: TurnsView = { "the-village": 3 };
const property: PropertyView = { path: "story.visits", value: 2, type: "number", writable: true, shared: false, durable: true };
const clocks: Clocks = { time_wall: AT, time_show: 1830, time_phase: "act-2" };
const build: BuildIdentity = { project: "the-park", version: "0.4.0", hash: "9f2c1a" };
const venue: VenueView = { venue: VENUE, name: "The Park", plan: { width: 1200, height: 800, background: "/venue/plan.png" } };
const location: LocationView = { location: LOCATION, venue: VENUE, label: "The well", x: 120, y: 400, code: "https://the-park.local:4480/at/vn_the_park/lo_the_well" };
const installation: InstallationView = { installation: INSTALLATION, name: "The Park", open: true, walkUp: true, default: true };
const binding: BindingView = { installation: INSTALLATION, hand: "the-well", location: LOCATION };
const actor: Actor = { kind: "producer", id: PRINCIPAL, label: "Priya" };
const presence: PresenceView = { station: STATION, kind: "crew", location: LOCATION, zone: "forest", since: AT };
const visit: VisitView = { visit: VISIT, party: PARTY, installation: INSTALLATION, callSign: "quiet otter", stations: [STATION], lastCommandAt: AT, idle: false };
const party: PartyView = { party: PARTY, installation: INSTALLATION, callSign: "quiet otter", claimed: true, createdAt: AT };
const credential: CredentialView = { id: "cr_1", kind: "token", issuedAt: AT };
const station: StationView = { station: STATION, venue: VENUE, label: "The well", kind: "fixed", location: LOCATION };
const run: RunView = { run: RUN, build, seed: 1234, startedAt: AT, state: "live" };
const principal: PrincipalView = { principal: PRINCIPAL, label: "Sam", role: "designer", issuedAt: AT };
const message: MessageView = { id: "ms_1", body: "hold at the gate", sender: actor, priority: "cue", audience: { to: "zone", zone: "forest" }, at: AT };
const revision: RevisionView = { revision: "12", at: AT, by: actor, role: "designer" };
const bundle: BundleView = { build, id: "bd_7", uploadedAt: AT, state: "live" };
const bridge: BridgeView = { id: "br_osc", kind: "osc", enabled: true };
const report: LoadReport = {
  exact: false,
  project: "the-park",
  version: { saved: "0.3.0", bundle: "0.4.0" },
  hash: { saved: "8e1b0d", bundle: "9f2c1a" },
  flows: [PARTY, HOUSE_FLOW],
  evicted: [{ flow: PARTY, hand: "the-well", card: "ambush-at-the-ford", reason: "vanished" }],
  droppedCooldowns: [{ flow: PARTY, card: "the-goblin" }],
  droppedSpent: ["the-goblin"],
  droppedProperties: [{ flow: PARTY, path: "story.old" }],
  defaultedProperties: [{ path: "story.visits" }],
  retypedProperties: [{ flow: PARTY, path: "box.b_village.mood" }],
};

const audiences: MessageAudience[] = [
  { to: "everyone" },
  { to: "kind", kind: "crew" },
  { to: "location", location: LOCATION },
  { to: "zone", zone: "forest" },
  { to: "station", station: STATION },
  { to: "producers" },
];

/** Every code, so removing one breaks the compile rather than a client. */
const codes: WireErrorCode[] = [
  "unknown_party", "unknown_credential", "code_expired", "code_used", "revoked", "not_dealt",
  "gated", "claimed_elsewhere", "no_run", "run_paused", "contract_break", "conflict",
  "replay_lost", "forbidden_shard", "wrong_role", "idempotent_replay", "stale_build", "not_bound",
  "unknown_visit", "walk_up_closed", "unknown_location", "unknown_installation",
  "installation_closed", "duplicate_handshake", "needs_station_key",
  "fingerprint_changed", "bad_request", "unauthorized",
];

const wireError: WireError = { error: { code: "not_dealt", message: "That card is not on this board.", details: { card: "ambush-at-the-ford" } } };

// --- the station and party API (6.4) ------------------------------------------

const helloRequest: HelloRequest = { wire: WIRE_VERSION };
const helloResponse: HelloResponse = { server: { version: "0.1.0" }, wire: WIRE_VERSION, venue, installations: [installation], run, build, station, visit };
const mintPartyRequest: MintPartyRequest = { installation: INSTALLATION, callSign: true, attach: true };
const mintPartyResponse: MintPartyResponse = { partyId: PARTY, token: "tk_x", callSign: "quiet otter", visit };
const claimPartyRequest: ClaimPartyRequest = { partyId: PARTY, kind: "callsign" };
const claimPartyResponse: ClaimPartyResponse = { partyId: PARTY, claimed: true, callSign: "quiet otter" };
const issueCredentialRequest: IssueCredentialRequest = { partyId: PARTY, kind: "external", externalRef: "wb-4412", dayPass: true };
const issueCredentialResponse: IssueCredentialResponse = { partyId: PARTY, credential: { id: "cr_2", kind: "external" }, externalRef: "wb-4412" };
const handshakes: HandshakeRequest[] = [
  { credential: "token", token: "tk_x" },
  { credential: "external", externalRef: "wb-4412" },
  { credential: "callsign", callSign: "quiet otter" },
];
const handshakeResponse: HandshakeResponse = { partyId: PARTY, installation: INSTALLATION, visitId: VISIT, board, callSign: "quiet otter", returning: true };
const attachAtLocationRequest: AttachAtLocationRequest = { venue: VENUE, location: LOCATION };
const attachAtLocationResponses: AttachAtLocationResponse[] = [
  { outcome: "attached", installation: INSTALLATION, visit, board },
  { outcome: "choose", installations: [installation] },
];
const chooseInstallationRequest: ChooseInstallationRequest = { venue: VENUE, location: LOCATION, installation: INSTALLATION };
const chooseInstallationResponse: ChooseInstallationResponse = { installation: INSTALLATION, visit, board };
const openVisitRequest: OpenVisitRequest = { party: PARTY, attach: true };
const openVisitResponse: OpenVisitResponse = { visit, board, resumed: true };
const parkVisitRequest: ParkVisitRequest = { visitId: VISIT };
const parkVisitResponse: ParkVisitResponse = { visit: VISIT, parkedAt: AT };
const detachStationRequest: DetachStationRequest = { visitId: VISIT };
const detachStationResponse: DetachStationResponse = { visit: VISIT, station: STATION, stations: [] };
const getBoardRequest: GetBoardRequest = { visitId: VISIT, hands: ["the-well"] };
const getBoardResponse: GetBoardResponse = { board, turns, clocks };
const dealRequest: DealRequest = { visitId: VISIT, hands: ["the-well"] };
const dealResponse: DealResponse = { board, turns, evicted: [{ hand: "the-well", card: "the-goblin", reason: "claimed-elsewhere" }] };
const getOutcomesRequest: GetOutcomesRequest = { visitId: VISIT, card: "ambush-at-the-ford", hand: "the-well" };
const getOutcomesResponse: GetOutcomesResponse = { card: "ambush-at-the-ford", outcomes: [outcome] };
const playRequest: PlayRequest = { visitId: VISIT, card: "ambush-at-the-ford", outcome: "stand-and-fight", hand: "the-well" };
const playResponse: PlayResponse = { board, turns, writes: [{ path: "story.visits", value: 3, prev: 2 }] };
const peekRequest: PeekRequest = { visitId: VISIT, box: "the-village", criteria: { mood: "tense" }, n: 3 };
const peekResponse: PeekResponse = { box: "the-village", cards: [card] };
const getPropertiesRequest: GetPropertiesRequest = { visitId: VISIT, prefix: "story." };
const getPropertiesResponse: GetPropertiesResponse = { properties: [property] };
const getWorldRequest: GetWorldRequest = { prefix: "world." };
const getWorldResponse: GetWorldResponse = { properties: [property], clocks };
const createStreamTicketRequest: CreateStreamTicketRequest = { monitor: false };
const createStreamTicketResponse: CreateStreamTicketResponse = { ticket: "tt_1", expiresAt: AT };
const setPresenceRequest: SetPresenceRequest = { location: LOCATION };
const setPresenceResponse: SetPresenceResponse = { presence, mirrored: ["@hand.elder_zone"] };
const listMessagesRequest: ListMessagesRequest = { since: AT };
const listMessagesResponse: ListMessagesResponse = { messages: [message] };
const ackMessageRequest: AckMessageRequest = { id: "ms_1" };
const ackMessageResponse: AckMessageResponse = { id: "ms_1", acked: 4, of: 5 };
const sendMessageRequest: SendMessageRequest = { body: "help at the forge", priority: "urgent", audience: { to: "producers" }, ackRequired: true };
const sendMessageResponse: SendMessageResponse = { message };

// --- pairing (7.5.1) ----------------------------------------------------------

const pairRequest: PairRequest = { code: "SAM7-K2Q9", device: { app: "Storyletter 0.3.0", host: "Sam's MacBook" }, identity: { name: "Sam", email: "sam@example.com" } };
const pairResponse: PairResponse = { key: "k_x", principal, installation, server: { version: "0.1.0", wire: WIRE_VERSION }, fingerprint: "SHA256:ab12" };

// --- the stream (6.4) ---------------------------------------------------------

const traceEvents: WireTraceEvent[] = [
  { type: "deal", hand: "the-well", cards: [{ id: "ambush-at-the-ford", verdict: "dealt", priority: 2, specificity: 1 }] },
  { type: "peek", box: "the-village", criteria: { mood: "tense" }, cards: [{ id: "the-goblin", verdict: "capped" }] },
  { type: "evict", hand: "the-well", card: "the-goblin", reason: "claimed-elsewhere" },
  { type: "play", card: "ambush-at-the-ford", outcome: "stand-and-fight", turn: 4 },
  { type: "write", target: "@story", path: "story.visits", value: 3, prev: 2 },
  { type: "turns", box: "the-village", turn: 5 },
  { type: "diagnostic", where: "the-well/condition", message: "unknown property @story.gold" },
];

const events: WireEvent[] = [
  { type: "ready", at: AT, id: "1", server: { version: "0.1.0" }, wire: WIRE_VERSION, venue, installations: [installation], installation: INSTALLATION, run, build, station, visit, monitor: false },
  { type: "board", at: AT, flow: PARTY, installation: INSTALLATION, visit: VISIT, board, turns },
  { type: "trace", at: AT, flow: PARTY, installation: INSTALLATION, event: traceEvents[0]!, seq: 12, turn: 4 },
  { type: "world", at: AT, installation: INSTALLATION, path: "world.time_phase", value: "act-2", prev: "act-1", actor },
  { type: "visit", at: AT, flow: PARTY, installation: INSTALLATION, visit: VISIT, phase: "attached", station: STATION },
  { type: "run", at: AT, installation: INSTALLATION, phase: "started", run },
  { type: "cue", at: AT, flow: HOUSE_FLOW, installation: INSTALLATION, bridge: "br_osc", verb: "deal", hand: "the-wall", card: "dusk", fields: { music: "tense" } },
  { type: "message", at: AT, message },
  { type: "presence", at: AT, presence },
  { type: "installation", at: AT, phase: "opened", installation },
  { type: "replay-lost", at: AT, from: "88", message: "the buffer has moved on; re-read the board" },
];

// --- cues and clocks (10.3) ---------------------------------------------------

const cueActions: CueAction[] = [
  { do: "set-phase", phase: "act-2" },
  { do: "deal-house", hands: ["the-wall"] },
  { do: "play-house", card: "dusk", outcome: "lights-down", hand: "the-wall" },
  { do: "advance-turns", box: "the-village", turns: 1 },
  { do: "message", body: "places", priority: "cue", audience: { to: "kind", kind: "crew" }, ackRequired: true },
  { do: "bridge-fire", bridge: "br_osc", payload: { address: "/lights/2" } },
];

const cues: CueEntry[] = [
  { id: "c1", label: "House lights", at: "wall", time: "19:30", action: cueActions[0]! },
  { id: "c2", at: "show", seconds: 600, action: cueActions[1]! },
  { id: "c3", at: "every", seconds: 300, action: cueActions[3]!, enabled: true },
  { id: "c4", at: "manual", label: "GO", action: cueActions[2]! },
];

// --- the journal (5.2) --------------------------------------------------------

const commands: WireCommand[] = [
  { kind: "open", flow: PARTY, seed: 77, restored: true },
  { kind: "deal", flow: PARTY, hands: ["the-well"] },
  { kind: "play", flow: PARTY, card: "ambush-at-the-ford", outcome: "stand-and-fight", hand: "the-well" },
  { kind: "advance", flow: HOUSE_FLOW, box: "the-village", turns: 1 },
  { kind: "set", path: "world.time_phase", value: "act-2" },
  { kind: "close", flow: PARTY, reason: "idle" },
  { kind: "install", build },
  { kind: "run.start", run: RUN, seed: 1234, build },
  { kind: "run.end", run: RUN },
  { kind: "run.hold", run: RUN },
  { kind: "run.resume", run: RUN },
  { kind: "tick", cue: "c3", action: cueActions[3]! },
  { kind: "hot-swap", build },
  { kind: "durable.reset", scope: "all" },
];

const journalEntry: JournalEntry = { seq: 412, at: AT, actor, command: commands[2]!, report };

// --- the producer API (6.5) ---------------------------------------------------

const startRunRequest: StartRunRequest = { installation: INSTALLATION, seed: 1234, build: "bd_7", armCues: true };
const startRunResponse: StartRunResponse = { run };
const endRunRequest: EndRunRequest = { run: RUN };
const endRunResponse: EndRunResponse = { run, visitsClosed: 12 };
const pauseRunRequest: PauseRunRequest = { run: RUN };
const pauseRunResponse: PauseRunResponse = { run };
const resumeRunRequest: ResumeRunRequest = { run: RUN };
const resumeRunResponse: ResumeRunResponse = { run };
const listRunsRequest: ListRunsRequest = { installation: INSTALLATION, cursor: "c", limit: 25 };
const listRunsResponse: ListRunsResponse = { items: [run], next: "c2" };
const getJournalRequest: GetJournalRequest = { run: RUN, since: AT, until: AT, kinds: ["play"], flow: PARTY, limit: 50 };
const getJournalResponse: GetJournalResponse = { items: [journalEntry], next: "c2", head: 412 };
const snapshotRunRequest: SnapshotRunRequest = { run: RUN };
const snapshotRunResponse: SnapshotRunResponse = { run: RUN, snapshot: "sn_3", seq: 412, at: AT };
const restoreFromJournalRequest: RestoreFromJournalRequest = { run: RUN, toSeq: 400, snapshot: "sn_3" };
const restoreFromJournalResponse: RestoreFromJournalResponse = { run, replayed: 12, seq: 400 };

const listPartiesRequest: ListPartiesRequest = { installation: INSTALLATION, claimed: true, live: true, callSign: "qui", limit: 20 };
const listPartiesResponse: ListPartiesResponse = { items: [party] };
const getPartyRequest: GetPartyRequest = { party: PARTY };
const getPartyResponse: GetPartyResponse = { party: { ...party, credentials: [credential], pocket: { "story.visits": 2 }, parked: true }, visit };
const editPocketRequest: EditPocketRequest = { party: PARTY, set: { "story.visits": 3 }, clear: ["story.old"] };
const editPocketResponse: EditPocketResponse = { party: PARTY, pocket: { "story.visits": 3 } };
const revokeCredentialRequest: RevokeCredentialRequest = { party: PARTY, credential: "cr_1" };
const revokeCredentialResponse: RevokeCredentialResponse = { credential: { ...credential, revokedAt: AT } };
const moveCredentialRequest: MoveCredentialRequest = { credential: "cr_1", to: PARTY };
const moveCredentialResponse: MoveCredentialResponse = { credential, party: PARTY };
const forgetPartyRequest: ForgetPartyRequest = { party: PARTY };
const forgetPartyResponse: ForgetPartyResponse = { party: PARTY, forgottenAt: AT, visitClosed: true };

const listVisitsRequest: ListVisitsRequest = { installation: INSTALLATION, idle: false, location: LOCATION, zone: "forest" };
const listVisitsResponse: ListVisitsResponse = { items: [visit] };
const getVisitLensRequest: GetVisitLensRequest = { visit: VISIT, log: 50 };
const getVisitLensResponse: GetVisitLensResponse = { visit, board, turns, properties: [property], entries: [journalEntry] };
const forceDealRequest: ForceDealRequest = { visit: VISIT, hands: ["the-well"] };
const forceDealResponse: ForceDealResponse = { board, turns };
const forcePlayRequest: ForcePlayRequest = { visit: VISIT, card: "ambush-at-the-ford", outcome: "stand-and-fight", hand: "the-well" };
const forcePlayResponse: ForcePlayResponse = { board };
const evictCardRequest: EvictCardRequest = { visit: VISIT, hand: "the-well", card: "the-goblin" };
const evictCardResponse: EvictCardResponse = { board };
const advanceTurnsRequest: AdvanceTurnsRequest = { installation: INSTALLATION, visit: VISIT, box: "the-village", turns: 1 };
const advanceTurnsResponse: AdvanceTurnsResponse = { turns };
const setPropertyRequest: SetPropertyRequest = { installation: INSTALLATION, visit: VISIT, path: "story.visits", value: 3 };
const setPropertyResponse: SetPropertyResponse = { property };
const detachVisitStationRequest: DetachVisitStationRequest = { visit: VISIT, station: STATION };
const detachVisitStationResponse: DetachVisitStationResponse = { visit: VISIT, stations: [] };
const parkVisitConsoleRequest: ParkVisitConsoleRequest = { visit: VISIT };
const parkVisitConsoleResponse: ParkVisitConsoleResponse = { visit: VISIT, parkedAt: AT };

const readWorldRequest: ReadWorldRequest = { installation: INSTALLATION, prefix: "world." };
const readWorldResponse: ReadWorldResponse = { properties: [property] };
const writeWorldRequest: WriteWorldRequest = { installation: INSTALLATION, path: "world.time_phase", value: "act-2" };
const writeWorldResponse: WriteWorldResponse = { property };
const getCueListRequest: GetCueListRequest = { installation: INSTALLATION, run: RUN };
const getCueListResponse: GetCueListResponse = { cues, armed: true };
const putCueListRequest: PutCueListRequest = { installation: INSTALLATION, run: RUN, cues };
const putCueListResponse: PutCueListResponse = { cues };
const fireCueRequest: FireCueRequest = { installation: INSTALLATION, cue: "c4" };
const fireCueResponse: FireCueResponse = { cue: "c4", seq: 413 };
const dealHouseRequest: DealHouseRequest = { installation: INSTALLATION, hands: ["the-wall"] };
const dealHouseResponse: DealHouseResponse = { board, turns };
const playHouseRequest: PlayHouseRequest = { installation: INSTALLATION, card: "dusk", outcome: "lights-down", hand: "the-wall" };
const playHouseResponse: PlayHouseResponse = { board };
const advanceHouseRequest: AdvanceHouseRequest = { installation: INSTALLATION, box: "the-wall-box", turns: 1 };
const advanceHouseResponse: AdvanceHouseResponse = { turns };

const getVenueRequest: GetVenueRequest = {};
const getVenueResponse: GetVenueResponse = { venue };
const listLocationsRequest: ListLocationsRequest = { limit: 50 };
const listLocationsResponse: ListLocationsResponse = { items: [location] };
const createLocationRequest: CreateLocationRequest = { label: "The well", x: 120, y: 400 };
const createLocationResponse: CreateLocationResponse = { location };
const updateLocationRequest: UpdateLocationRequest = { location: LOCATION, label: "The old well", x: 124, y: 402 };
const updateLocationResponse: UpdateLocationResponse = { location };
const printLocationSheetRequest: PrintLocationSheetRequest = { locations: [LOCATION] };
const printLocationSheetResponse: PrintLocationSheetResponse = { sheet: [{ location: LOCATION, label: "The well", code: location.code }] };

const bindStationRequest: BindStationRequest = { station: STATION, kind: "crew", mirrorPresence: true, label: "The Elder" };
const bindStationResponse: BindStationResponse = { station };
const bindStationToLocationRequest: BindStationToLocationRequest = { station: STATION, location: LOCATION };
const bindStationToLocationResponse: BindStationToLocationResponse = { station };
const listPresenceRequest: ListPresenceRequest = { location: LOCATION, zone: "forest", installation: INSTALLATION, kind: "crew" };
const listPresenceResponse: ListPresenceResponse = { presence: [presence] };

const listInstallationsRequest: ListInstallationsRequest = { open: true, limit: 10 };
const listInstallationsResponse: ListInstallationsResponse = { items: [installation] };
const openInstallationRequest: OpenInstallationRequest = { installation: INSTALLATION };
const openInstallationResponse: OpenInstallationResponse = { installation };
const closeInstallationRequest: CloseInstallationRequest = { installation: INSTALLATION };
const closeInstallationResponse: CloseInstallationResponse = { installation };
const updateInstallationRequest: UpdateInstallationRequest = { installation: INSTALLATION, name: "The Park by day", default: true, walkUp: false };
const updateInstallationResponse: UpdateInstallationResponse = { installation };
const listBindingsRequest: ListBindingsRequest = { installation: INSTALLATION };
const listBindingsResponse: ListBindingsResponse = { bindings: [binding] };
const bindHandRequest: BindHandRequest = { installation: INSTALLATION, hand: "the-well", location: LOCATION };
const bindHandResponse: BindHandResponse = { binding };
const unbindHandRequest: UnbindHandRequest = { installation: INSTALLATION, hand: "the-well" };
const unbindHandResponse: UnbindHandResponse = { installation: INSTALLATION, hand: "the-well", unboundAt: AT };

const pairPrincipalRequest: PairPrincipalRequest = { role: "designer", label: "Sam" };
const pairPrincipalResponse: PairPrincipalResponse = { code: "SAM7-K2Q9", expiresAt: AT, address: "https://the-park.local:4480", link: "https://the-park.local:4480/pair/SAM7-K2Q9", principal };
const listPrincipalsRequest: ListPrincipalsRequest = { role: "station", revoked: true };
const listPrincipalsResponse: ListPrincipalsResponse = { items: [principal] };
const relabelPrincipalRequest: RelabelPrincipalRequest = { principal: PRINCIPAL, label: "Sam O." };
const relabelPrincipalResponse: RelabelPrincipalResponse = { principal };
const revokePrincipalRequest: RevokePrincipalRequest = { principal: PRINCIPAL };
const revokePrincipalResponse: RevokePrincipalResponse = { principal };

const newFromSeedRequest: NewFromSeedRequest = { name: "The Park", pack: "UEsDBA==", encoding: "inline" };
const newFromSeedResponse: NewFromSeedResponse = { installation: INSTALLATION, revision, build };
const pullProjectRequest: PullProjectRequest = { installation: INSTALLATION, revision: "12" };
const pullProjectResponse: PullProjectResponse = { revision, pack: "UEsDBA==" };
const pushProjectRequest: PushProjectRequest = { installation: INSTALLATION, base: "12", pack: "UEsDBA==", note: "the forge beats", identity: { name: "Sam" } };
const pushProjectResponse: PushProjectResponse = { revision, build, breaks: [{ path: "hands/the-well.storylethands", message: "a bound hand was renamed" }], conflicts: [] };
const listRevisionsRequest: ListRevisionsRequest = { installation: INSTALLATION, limit: 10 };
const listRevisionsResponse: ListRevisionsResponse = { items: [revision] };
const getContractRequest: GetContractRequest = { installation: INSTALLATION, revision: "12" };
const getContractResponse: GetContractResponse = { shard: "contract:\n", depends: { hands: ["the-well"], boxes: ["the-village"], properties: ["@world.time_phase"] } };

const uploadBundleRequest: UploadBundleRequest = { installation: INSTALLATION, bundle: "UEsDBA==", assets: "UEsDBA==", stage: true };
const uploadBundleResponse: UploadBundleResponse = { bundle, diagnostics: [] };
const listBundlesRequest: ListBundlesRequest = { installation: INSTALLATION, limit: 10 };
const listBundlesResponse: ListBundlesResponse = { items: [bundle] };
const stageBundleRequest: StageBundleRequest = { build: "bd_7" };
const stageBundleResponse: StageBundleResponse = { bundle };
const goLiveRequest: GoLiveRequest = { build: "bd_7", acknowledged: ["hands/the-well.storylethands"] };
const goLiveResponse: GoLiveResponse = { bundle };
const rollbackBundleRequest: RollbackBundleRequest = { installation: INSTALLATION, build: "bd_6" };
const rollbackBundleResponse: RollbackBundleResponse = { bundle, report };
const previewSwapRequest: PreviewSwapRequest = { build: "bd_8" };
const previewSwapResponse: PreviewSwapResponse = { build, report };
const hotSwapRequest: HotSwapRequest = { build: "bd_8", seenReportFor: "bd_7" };
const hotSwapResponse: HotSwapResponse = { bundle, report, seq: 414 };

const resetDurableRequest: ResetDurableRequest = { installation: INSTALLATION, scope: "all", confirm: "The Park" };
const resetDurableResponse: ResetDurableResponse = { scope: "all", pockets: 214, at: AT };
const listBridgesRequest: ListBridgesRequest = { installation: INSTALLATION };
const listBridgesResponse: ListBridgesResponse = { bridges: [bridge] };
const configureBridgeRequest: ConfigureBridgeRequest = { installation: INSTALLATION, bridge: "br_osc", kind: "osc", enabled: true, hands: ["the-wall"], flow: HOUSE_FLOW, config: { host: "10.0.0.4" } };
const configureBridgeResponse: ConfigureBridgeResponse = { bridge };
const testFireBridgeRequest: TestFireBridgeRequest = { bridge: "br_osc", payload: { address: "/test" } };
const testFireBridgeResponse: TestFireBridgeResponse = { bridge: "br_osc", ok: false, detail: "no route to host" };
const broadcastMessageRequest: BroadcastMessageRequest = { installation: INSTALLATION, body: "places", priority: "cue", audience: audiences[0]!, ackRequired: true };
const broadcastMessageResponse: BroadcastMessageResponse = { message, delivered: 5 };

/** Everything above, so nothing is an unused local and the compile covers it
 *  all. The runtime assertion is deliberately weak: the compile is the test. */
const shapes: unknown[] = [
  helloRequest, helloResponse, mintPartyRequest, mintPartyResponse, claimPartyRequest,
  claimPartyResponse, issueCredentialRequest, issueCredentialResponse, handshakes,
  handshakeResponse, attachAtLocationRequest, attachAtLocationResponses,
  chooseInstallationRequest, chooseInstallationResponse, openVisitRequest,
  openVisitResponse, parkVisitRequest, parkVisitResponse, detachStationRequest,
  detachStationResponse, getBoardRequest, getBoardResponse, dealRequest, dealResponse,
  getOutcomesRequest, getOutcomesResponse, playRequest, playResponse, peekRequest, peekResponse,
  getPropertiesRequest, getPropertiesResponse, getWorldRequest, getWorldResponse,
  createStreamTicketRequest, createStreamTicketResponse, setPresenceRequest, setPresenceResponse,
  listMessagesRequest, listMessagesResponse, ackMessageRequest, ackMessageResponse,
  sendMessageRequest, sendMessageResponse, pairRequest, pairResponse, traceEvents, events, cues,
  cueActions, commands, journalEntry, startRunRequest, startRunResponse, endRunRequest,
  endRunResponse, pauseRunRequest, pauseRunResponse, resumeRunRequest, resumeRunResponse,
  listRunsRequest, listRunsResponse, getJournalRequest, getJournalResponse, snapshotRunRequest,
  snapshotRunResponse, restoreFromJournalRequest, restoreFromJournalResponse, listPartiesRequest,
  listPartiesResponse, getPartyRequest, getPartyResponse, editPocketRequest, editPocketResponse,
  revokeCredentialRequest, revokeCredentialResponse, moveCredentialRequest, moveCredentialResponse,
  forgetPartyRequest, forgetPartyResponse, listVisitsRequest, listVisitsResponse,
  getVisitLensRequest, getVisitLensResponse, forceDealRequest, forceDealResponse, forcePlayRequest,
  forcePlayResponse, evictCardRequest, evictCardResponse, advanceTurnsRequest,
  advanceTurnsResponse, setPropertyRequest, setPropertyResponse, detachVisitStationRequest,
  detachVisitStationResponse, parkVisitConsoleRequest, parkVisitConsoleResponse, readWorldRequest,
  readWorldResponse, writeWorldRequest, writeWorldResponse, getCueListRequest, getCueListResponse,
  putCueListRequest, putCueListResponse, fireCueRequest, fireCueResponse, dealHouseRequest,
  dealHouseResponse, playHouseRequest, playHouseResponse, advanceHouseRequest,
  advanceHouseResponse, getVenueRequest, getVenueResponse, listLocationsRequest,
  listLocationsResponse, createLocationRequest, createLocationResponse, updateLocationRequest,
  updateLocationResponse, printLocationSheetRequest, printLocationSheetResponse,
  bindStationRequest, bindStationResponse, bindStationToLocationRequest,
  bindStationToLocationResponse, listPresenceRequest, listPresenceResponse,
  listInstallationsRequest, listInstallationsResponse, openInstallationRequest,
  openInstallationResponse, closeInstallationRequest, closeInstallationResponse,
  updateInstallationRequest, updateInstallationResponse, listBindingsRequest, listBindingsResponse,
  bindHandRequest, bindHandResponse, unbindHandRequest, unbindHandResponse, pairPrincipalRequest,
  pairPrincipalResponse, listPrincipalsRequest, listPrincipalsResponse, relabelPrincipalRequest,
  relabelPrincipalResponse, revokePrincipalRequest, revokePrincipalResponse, newFromSeedRequest,
  newFromSeedResponse, pullProjectRequest, pullProjectResponse, pushProjectRequest,
  pushProjectResponse, listRevisionsRequest, listRevisionsResponse, getContractRequest,
  getContractResponse, uploadBundleRequest, uploadBundleResponse, listBundlesRequest,
  listBundlesResponse, stageBundleRequest, stageBundleResponse, goLiveRequest, goLiveResponse,
  rollbackBundleRequest, rollbackBundleResponse, previewSwapRequest, previewSwapResponse,
  hotSwapRequest, hotSwapResponse, resetDurableRequest, resetDurableResponse, listBridgesRequest,
  listBridgesResponse, configureBridgeRequest, configureBridgeResponse, testFireBridgeRequest,
  testFireBridgeResponse, broadcastMessageRequest, broadcastMessageResponse, wireError, codes,
  audiences, report, outcome, venue, location, binding,
];

describe("the wire contract", () => {
  it("names the protocol", () => {
    expect(WIRE_VERSION).toBe("storyletengine/wire@1");
  });

  it("prints a location's code with the venue and the location, and no story", () => {
    expect(location.code).toContain(`/at/${VENUE}/${LOCATION}`);
    expect(location.code).not.toContain(INSTALLATION);
  });

  it("offers the open installations rather than one, and both attach outcomes", () => {
    expect(helloResponse.installations).toHaveLength(1);
    expect(attachAtLocationResponses.map((r) => r.outcome)).toEqual(["attached", "choose"]);
  });

  it("puts the version in the path and the idempotency key in a header", () => {
    expect(WIRE_PATH).toBe("/v1");
    expect(WIRE_CONSOLE_PATH).toBe("/v1/console");
    expect(IDEMPOTENCY_HEADER).toBe("Idempotency-Key");
    expect(HOUSE_FLOW).toBe("house");
  });

  it("names the three clocks by their property paths", () => {
    expect(CLOCK_WALL).toBe("world.time_wall");
    expect(CLOCK_SHOW).toBe("world.time_show");
    expect(CLOCK_PHASE).toBe("world.time_phase");
    expect(CLOCK_PATHS).toEqual([CLOCK_WALL, CLOCK_SHOW, CLOCK_PHASE]);
  });

  it("constructs one literal of every shape", () => {
    expect(shapes.every((s) => s !== undefined)).toBe(true);
    expect(events).toHaveLength(11);
    expect(traceEvents).toHaveLength(7);
    expect(commands).toHaveLength(14);
  });
});
