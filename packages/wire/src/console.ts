// ---------------------------------------------------------------------------
// The producer API (`/v1/console`, section 6.5, with 9.1 for the project's
// pull and push).
//
// Bearer: a producer principal's key, held by the browser as a session, or an
// integrator or monitor principal for automation. The console is a static SPA
// served by the same process and it talks to the same API as everyone else;
// nothing here is a private back door.
//
// Path parameters are fields, and every mutation takes `Idempotency-Key`, for
// the reasons stated at the top of station.ts.
//
// TWO LEVELS, AND THE ROUTES SAY WHICH (4a). The VENUE routes are the
// building's: its plan, its locations with their printed codes, and its
// stations with their keys. The INSTALLATION routes are one story's: its runs,
// parties, world, cues, bundles, bridges and its bindings of hands to the
// venue's locations. A venue hosts several installations at once, so every
// route that lists or creates within one story names it.
// ---------------------------------------------------------------------------

import type { LoadReport, ScalarValue } from "@storylet-studio/model";
import type { CueEntry } from "./cues.js";
import type {
  Actor, BuildIdentity, CredentialId, GameId, InstallationId, IsoTimestamp, LocationId, Page,
  PageRequest, PartyId, PrincipalId, PrincipalRole, PropertyPath, RevisionId, RunId, StationId,
  StationKind, VisitId, ZoneId, FlowRef,
} from "./vocabulary.js";
import type {
  BindingView, BoardView, BridgeView, BundleView, CredentialView, InstallationView, LocationView,
  MessageAudience, MessageView, PartyView, PresenceView, PrincipalView, PropertyView, RevisionView,
  RunView, StationView, TurnsView, VenueView, VisitView,
} from "./views.js";

// --- the journal (5.2) --------------------------------------------------------

/**
 * One journaled mutation. The journal is the truth: every command is
 * appended BEFORE it is applied, so recovery is a snapshot plus replay, and
 * the same sequence is the producer's timeline, the audit log and the
 * designer's bug report.
 *
 * Trace events are NOT here: they are derived from applying commands and are
 * re-emitted on replay (5.2). Presence and messages are not here either:
 * they change no story, so they are logged and not journaled.
 */
export type WireCommand =
  /** A visit opened, with the seed derived from the run seed and the party
   *  id, so replay is exact (5.4.1). */
  | { kind: "open"; flow: FlowRef; seed?: number; restored?: boolean }
  /** Hands dealt. Absent `hands` means every hand the actor may deal. */
  | { kind: "deal"; flow: FlowRef; hands?: GameId[] }
  | { kind: "play"; flow: FlowRef; card: GameId; outcome: GameId; hand: GameId }
  /** `advanceTurns` on a box: a cue's nudge, or a timed box's own tick. */
  | { kind: "advance"; flow: FlowRef; box: GameId; turns: number }
  /** A property write. `flow` absent means a shared or `@world` write; a
   *  trigger in from a bridge is one of these with actor `external` (5.6). */
  | { kind: "set"; path: PropertyPath; value: ScalarValue; flow?: FlowRef }
  /** A visit closed: idle, or the run ending (5.4). */
  | { kind: "close"; flow: FlowRef; reason?: "idle" | "run-end" | "producer" | "forget" }
  /** A bundle installed (section 9). */
  | { kind: "install"; build: BuildIdentity }
  /** A fresh world with a fresh seed (5.4.1). */
  | { kind: "run.start"; run: RunId; seed: number; build: BuildIdentity }
  /** The cue list disarmed, the house closed, every pocket lifted (5.4.1). */
  | { kind: "run.end"; run: RunId }
  /** A Hold and its Resume: the clocks are derived from these (10.2). */
  | { kind: "run.hold"; run: RunId }
  | { kind: "run.resume"; run: RunId }
  /** A scheduler tick: the cue list firing, journaled so replay reproduces
   *  what fired and when. */
  | { kind: "tick"; cue?: string; action?: CueEntry["action"] }
  /** A new build carried into the live run, with the 4.9 report attached, so
   *  the swap is reversible like any other command (section 9). */
  | { kind: "hot-swap"; build: BuildIdentity }
  /** Every pocket and the installation memory cleared (6.5). */
  | { kind: "durable.reset"; scope: "pockets" | "installation" | "all" };

/** One line of the journal. */
export interface JournalEntry {
  /** Monotonic per run. */
  seq: number;
  at: IsoTimestamp;
  /** Who: "Priya (producer)", a station, the scheduler, a bridge (7.5). */
  actor: Actor;
  command: WireCommand;
  /** Present on `install` and `hot-swap`: what the load cost, or would have
   *  (4.9). */
  report?: LoadReport;
}

// --- runs ---------------------------------------------------------------------

/** `POST /v1/console/runs`. A fresh world with a fresh seed (5.4.1). Takes
 *  `Idempotency-Key`. */
export interface StartRunRequest {
  /** Which story is starting. Each installation has its own run, clock and
   *  cue list, so the family story can end at six and the after-dark story
   *  open at eight on the same walls (4a). */
  installation: InstallationId;
  /** Given only for a rehearsal that should repeat; otherwise the server
   *  mints one and journals it. */
  seed?: number;
  /** Which build to pin to. Absent takes the live build. */
  build?: string;
  /** Arm the cue list at T+0. Absent means yes. */
  armCues?: boolean;
}

/** The run that started. */
export interface StartRunResponse {
  run: RunView;
}

/** `POST /v1/console/runs/{run}/end`. Every open visit is CLOSED, not parked,
 *  and each pocket is lifted from its flow by the `durable` declarations
 *  (5.4). Takes `Idempotency-Key`. */
export interface EndRunRequest {
  /** Path parameter. */
  run: RunId;
}

/** The ended run, for the console's own record. */
export interface EndRunResponse {
  run: RunView;
  /** How many visits were closed and had their pockets lifted. */
  visitsClosed?: number;
}

/** `POST /v1/console/runs/{run}/pause`. Hold: the show waits. Reads still
 *  answer; mutations get `run_paused` (10.3). Takes `Idempotency-Key`. */
export interface PauseRunRequest {
  /** Path parameter. */
  run: RunId;
}

/** The held run. */
export interface PauseRunResponse {
  run: RunView;
}

/** `POST /v1/console/runs/{run}/resume`. The clocks pick up where the hold
 *  left them, because they are derived from the journaled holds (10.2).
 *  Takes `Idempotency-Key`. */
export interface ResumeRunRequest {
  /** Path parameter. */
  run: RunId;
}

/** The resumed run. */
export interface ResumeRunResponse {
  run: RunView;
}

/** `GET /v1/console/runs`. Recent first. */
export interface ListRunsRequest extends PageRequest {
  /** Whose runs. */
  installation: InstallationId;
}

/** A page of runs. */
export interface ListRunsResponse extends Page<RunView> {}

/** `GET /v1/console/runs/{run}/journal`. Windowed, recent-first: a day's run
 *  is a long list and the producer's question is usually "what happened at
 *  14:32". */
export interface GetJournalRequest extends PageRequest {
  /** Path parameter. */
  run: RunId;
  /** Only entries at or after this instant. */
  since?: IsoTimestamp;
  /** Only entries at or before this instant. */
  until?: IsoTimestamp;
  /** Only these command kinds. */
  kinds?: WireCommand["kind"][];
  /** Only this flow's commands. */
  flow?: FlowRef;
}

/** A page of the journal, recent first. */
export interface GetJournalResponse extends Page<JournalEntry> {
  /** The highest sequence number in the run, so a client can say how far
   *  back this window sits. */
  head?: number;
}

/** `POST /v1/console/runs/{run}/snapshot`. `saveGame()` plus the `@world`
 *  container plus the visit table, on demand rather than on the every-N
 *  cadence (5.2). Takes `Idempotency-Key`. */
export interface SnapshotRunRequest {
  /** Path parameter. */
  run: RunId;
}

/** Where the snapshot landed, and what it covers. */
export interface SnapshotRunResponse {
  run: RunId;
  /** The server's handle for it, which a restore names. */
  snapshot: string;
  /** The command this snapshot sits after. */
  seq: number;
  at: IsoTimestamp;
}

/** `POST /v1/console/runs/{run}/restore`. Snapshot plus replay of the
 *  commands after it: the recovery path, exposed so a producer can use it
 *  deliberately (5.2, 6.5). Takes `Idempotency-Key`. */
export interface RestoreFromJournalRequest {
  /** Path parameter. */
  run: RunId;
  /** Replay up to and including this command. Absent replays everything. */
  toSeq?: number;
  /** Start from this snapshot. Absent takes the latest before `toSeq`. */
  snapshot?: string;
}

/** The restored run, and how far the replay went. */
export interface RestoreFromJournalResponse {
  run: RunView;
  replayed: number;
  seq: number;
}

// --- parties ------------------------------------------------------------------

/** `GET /v1/console/parties`. Claimed and transient (7.1). */
export interface ListPartiesRequest extends PageRequest {
  /** Whose parties: ids are minted per installation, and a person playing
   *  both of a venue's stories is two parties (7.1, 4a). */
  installation: InstallationId;
  /** Claimed only, transient only, or both when absent. */
  claimed?: boolean;
  /** Only parties with a live visit in the current run. */
  live?: boolean;
  /** Match a call sign by prefix: what a performer types before picking from
   *  a handful (7.1). */
  callSign?: string;
}

/** A page of parties, without their credentials or pockets. */
export interface ListPartiesResponse extends Page<PartyView> {}

/** `GET /v1/console/parties/{party}`. The detail: pocket, credentials,
 *  parked state. */
export interface GetPartyRequest {
  /** Path parameter. */
  party: PartyId;
}

/** The party in full, plus its live visit if it has one. */
export interface GetPartyResponse {
  party: PartyView;
  visit?: VisitView;
}

/** `PATCH /v1/console/parties/{party}/pocket`. A producer editing durable
 *  values by path: the fix for a mis-set flag, journaled with the actor as
 *  every producer write is. Takes `Idempotency-Key`. */
export interface EditPocketRequest {
  /** Path parameter. */
  party: PartyId;
  /** By property path, as the pocket is keyed (section 9). */
  set: Record<PropertyPath, ScalarValue>;
  /** Orphaned values a build no longer declares, cleared rather than kept. */
  clear?: PropertyPath[];
}

/** The pocket after the edit. */
export interface EditPocketResponse {
  party: PartyId;
  pocket: Record<PropertyPath, ScalarValue>;
}

/** `POST /v1/console/parties/{party}/credentials/{credential}/revoke`.
 *  Instant, from the console (7.5). Takes `Idempotency-Key`. */
export interface RevokeCredentialRequest {
  /** Path parameter. */
  party: PartyId;
  /** Path parameter. */
  credential: CredentialId;
}

/** The revoked credential, with the instant a client can quote back to the
 *  person holding it. */
export interface RevokeCredentialResponse {
  credential: CredentialView;
}

/** `POST /v1/console/credentials/{credential}/move`. Someone changed group:
 *  the wristband now resolves to another party (7.1). Pockets do not split or
 *  merge; only the credential moves. Takes `Idempotency-Key`. */
export interface MoveCredentialRequest {
  /** Path parameter. */
  credential: CredentialId;
  /** The party it resolves to from now on. */
  to: PartyId;
}

/** Where it now points. */
export interface MoveCredentialResponse {
  credential: CredentialView;
  party: PartyId;
}

/** `DELETE /v1/console/parties/{party}`. Right to be forgotten: the record,
 *  the parked state and the pocket, and the visit closed if live, so the next
 *  persist cannot resurrect it (7.4). Takes `Idempotency-Key`. */
export interface ForgetPartyRequest {
  /** Path parameter. */
  party: PartyId;
}

/** What was deleted. Deliberately thin: there is nothing left to describe. */
export interface ForgetPartyResponse {
  party: PartyId;
  forgottenAt: IsoTimestamp;
  /** True when a live visit was closed to do it. */
  visitClosed?: boolean;
}

// --- visits -------------------------------------------------------------------

/** `GET /v1/console/visits`. The live roster: party, its stations, last
 *  command, idle. */
export interface ListVisitsRequest extends PageRequest {
  /** Whose roster. One console page per story, over the same venue plan. */
  installation: InstallationId;
  /** Idle visits only, for the producer sweeping the floor. */
  idle?: boolean;
  /** Visits with a station present at this venue location. */
  location?: LocationId;
  /** Visits with a station whose derived zone is this one, for a producer
   *  thinking in the story's own words (4a). */
  zone?: ZoneId;
}

/** A page of the roster. */
export interface ListVisitsResponse extends Page<VisitView> {}

/** `GET /v1/console/visits/{visit}/lens`. That flow's board and log: what the
 *  producer needs to answer "what is happening to these four people". */
export interface GetVisitLensRequest {
  /** Path parameter. */
  visit: VisitId;
  /** How many log entries to bring back, recent first. */
  log?: number;
}

/** The flow, seen whole. */
export interface GetVisitLensResponse {
  visit: VisitView;
  board: BoardView;
  turns: TurnsView;
  properties: PropertyView[];
  /** The flow's own log, recent first (4.5). */
  entries?: JournalEntry[];
}

/** `POST /v1/console/visits/{visit}/deal`. The producer dealing into a
 *  party's flow by hand: the "it stuck, give them something" button. Not
 *  bound by any station's hands. Takes `Idempotency-Key`. */
export interface ForceDealRequest {
  /** Path parameter. */
  visit: VisitId;
  hands?: GameId[];
}

/** The board after it. */
export interface ForceDealResponse {
  board: BoardView;
  turns?: TurnsView;
}

/** `POST /v1/console/visits/{visit}/play`. Playing on a party's behalf, which
 *  a performer's improvised answer sometimes needs (5.7). Takes
 *  `Idempotency-Key`. */
export interface ForcePlayRequest {
  /** Path parameter. */
  visit: VisitId;
  card: GameId;
  outcome: GameId;
  hand: GameId;
}

/** The board after the play. */
export interface ForcePlayResponse {
  board: BoardView;
  turns?: TurnsView;
}

/** `POST /v1/console/visits/{visit}/evict`. Take a card off a board without
 *  playing it: the stuck-beat fix. Takes `Idempotency-Key`. */
export interface EvictCardRequest {
  /** Path parameter. */
  visit: VisitId;
  hand: GameId;
  card: GameId;
}

/** The board after the eviction. */
export interface EvictCardResponse {
  board: BoardView;
}

/** `POST /v1/console/visits/{visit}/turns`. `advanceTurns` on one box for one
 *  flow. The cue list's `advance-turns` does it for every open flow (10.3).
 *  Takes `Idempotency-Key`. */
export interface AdvanceTurnsRequest {
  /** Which story's boxes. */
  installation: InstallationId;
  /** Path parameter. Absent means every open flow, which is the cue's shape
   *  reached by hand. */
  visit?: VisitId;
  box: GameId;
  turns: number;
}

/** The box clocks after it. */
export interface AdvanceTurnsResponse {
  turns: TurnsView;
}

/** `POST /v1/console/visits/{visit}/properties`. A producer setting a
 *  property on one flow: journaled with the actor, like every producer write.
 *  Takes `Idempotency-Key`. */
export interface SetPropertyRequest {
  /** Which story's state. */
  installation: InstallationId;
  /** Path parameter. Absent writes a shared or `@world` property, which is
   *  what {@link WriteWorldRequest} is for; keep this one to the flow. */
  visit?: VisitId;
  path: PropertyPath;
  value: ScalarValue;
}

/** The row after the write, so the console shows the value the store kept
 *  (a quality normalises, an enum validates). */
export interface SetPropertyResponse {
  property: PropertyView;
}

/** `DELETE /v1/console/visits/{visit}/stations/{station}`. Detach someone
 *  else's station: the tablet left on a bench. Takes `Idempotency-Key`. */
export interface DetachVisitStationRequest {
  /** Path parameter. */
  visit: VisitId;
  /** Path parameter. */
  station: StationId;
}

/** What is left attached. */
export interface DetachVisitStationResponse {
  visit: VisitId;
  stations: StationId[];
}

/** `DELETE /v1/console/visits/{visit}`. Park a visit from the console: the
 *  party has plainly gone home. Takes `Idempotency-Key`. */
export interface ParkVisitConsoleRequest {
  /** Path parameter. */
  visit: VisitId;
}

/** Parked. */
export interface ParkVisitConsoleResponse {
  visit: VisitId;
  parkedAt: IsoTimestamp;
}

// --- world, cues and the house ------------------------------------------------

/** `GET /v1/console/world`. Everything, unlike the station's narrowed read. */
export interface ReadWorldRequest {
  /** Whose world. Nothing crosses stories: two installations on one venue
   *  have two `@world` containers, and a prop only one may hold at a time is
   *  a property a bridge writes into both (4a). */
  installation: InstallationId;
  /** Only paths under this prefix. */
  prefix?: string;
}

/** The world as the producer sees it. */
export interface ReadWorldResponse {
  properties: PropertyView[];
}

/** `POST /v1/console/world`. Actor producer, journaled (5.6). `writable:
 *  false` protects a property from OUTCOMES, not from the person running the
 *  show. Takes `Idempotency-Key`. */
export interface WriteWorldRequest {
  /** Whose world. */
  installation: InstallationId;
  path: PropertyPath;
  value: ScalarValue;
}

/** The row after the write. */
export interface WriteWorldResponse {
  property: PropertyView;
}

/** `GET /v1/console/cues`. The run's cue list, in order (10.3). */
export interface GetCueListRequest {
  /** Whose cue list: each story has its own, so both can run on one clock. */
  installation: InstallationId;
  /** Absent takes the live run's list. */
  run?: RunId;
}

/** The list, and whether the scheduler is armed. */
export interface GetCueListResponse {
  cues: CueEntry[];
  armed: boolean;
}

/** `PUT /v1/console/cues`. The whole list at once, because reordering by
 *  patch is where an ordered list goes wrong. Takes `Idempotency-Key`. */
export interface PutCueListRequest {
  installation: InstallationId;
  run?: RunId;
  cues: CueEntry[];
}

/** The list as stored. */
export interface PutCueListResponse {
  cues: CueEntry[];
}

/** `POST /v1/console/cues/{cue}/fire`. Any entry, by hand: GO, Hold, Resume
 *  and the manual entries are cues without a time (10.3). Takes
 *  `Idempotency-Key`. */
export interface FireCueRequest {
  /** Whose cue list. */
  installation: InstallationId;
  /** Path parameter. */
  cue: string;
}

/** Fired, with the sequence number it took, so the console can jump to it in
 *  the journal. */
export interface FireCueResponse {
  cue: string;
  seq: number;
}

/** `POST /v1/console/house/deal`. The venue's own flow, dealt by hand (5.5).
 *  Takes `Idempotency-Key`. */
export interface DealHouseRequest {
  /** Whose house: each story has its own house flow (5.5). */
  installation: InstallationId;
  hands?: GameId[];
}

/** The house's board. */
export interface DealHouseResponse {
  board: BoardView;
  turns?: TurnsView;
}

/** `POST /v1/console/house/play`. Takes `Idempotency-Key`. */
export interface PlayHouseRequest {
  installation: InstallationId;
  card: GameId;
  outcome: GameId;
  hand: GameId;
}

/** The house's board after the play. */
export interface PlayHouseResponse {
  board: BoardView;
  turns?: TurnsView;
}

/** `POST /v1/console/house/turns`. A house box without `turn` advances per
 *  play as authored, and a cue may nudge it by hand (5.5). Takes
 *  `Idempotency-Key`. */
export interface AdvanceHouseRequest {
  installation: InstallationId;
  box: GameId;
  turns: number;
}

/** The house's box clocks. */
export interface AdvanceHouseResponse {
  turns: TurnsView;
}

// --- the venue (4a) -----------------------------------------------------------

/** `GET /v1/console/venue`. The place itself: one per server, above every
 *  installation. The console draws every story's map over this plan. */
export interface GetVenueRequest {}

/** The venue, with its plan when a producer has uploaded one. */
export interface GetVenueResponse {
  venue: VenueView;
}

/** `GET /v1/console/venue/locations`. Every position on the venue plan, with
 *  the code printed at each (4a). */
export interface ListLocationsRequest extends PageRequest {}

/** A page of locations. */
export interface ListLocationsResponse extends Page<LocationView> {}

/** `POST /v1/console/venue/locations`. A new place on the plan. The server
 *  mints its id and its printed code; neither is the caller's to choose,
 *  because the code goes on a wall and outlives every story that binds to it.
 *  Takes `Idempotency-Key`. */
export interface CreateLocationRequest {
  /** What the crew call it: "the well", "the forge door". */
  label: string;
  x: number;
  y: number;
}

/** The location, with the code to print. */
export interface CreateLocationResponse {
  location: LocationView;
}

/** `PATCH /v1/console/venue/locations/{location}`. Move it on the plan, or
 *  rename it. The printed CODE never changes: placards are printed once
 *  (12.2), so a location can be moved and relabelled but never re-addressed.
 *  Takes `Idempotency-Key`. */
export interface UpdateLocationRequest {
  /** Path parameter. */
  location: LocationId;
  label?: string;
  /** Both or neither: a position is a pair. */
  x?: number;
  y?: number;
}

/** The location after the edit. */
export interface UpdateLocationResponse {
  location: LocationView;
}

/** `POST /v1/console/venue/locations/print`. The sheet to print and stick on
 *  the walls: label and code per location, and nothing else. What a venue
 *  prints is the venue's own design (12.2), so the server hands over the
 *  addresses and never the artwork. */
export interface PrintLocationSheetRequest {
  /** Which locations. Absent means every one the venue has. */
  locations?: LocationId[];
}

/** The codes, in the order asked for. Each is
 *  `https://<server>/at/<venue>/<location>`: no story, no installation. */
export interface PrintLocationSheetResponse {
  sheet: { location: LocationId; label: string; code: string }[];
}

// --- stations, which are the venue's too --------------------------------------

/** `POST /v1/console/stations/{station}/binding`. What kind of device this is
 *  and what it is called: provisioning, not content (5.7).
 *
 *  It carries NO hands any more. Which story a station shows is decided per
 *  party at the handshake, so the hands belong to each installation's own
 *  bindings ({@link BindHandRequest}, 4a). Takes `Idempotency-Key`. */
export interface BindStationRequest {
  /** Path parameter. */
  station: StationId;
  kind?: StationKind;
  /** Mirror this station's presence into the movable holes of the hands of
   *  whichever installation it is signed in to (4.6). The default when a
   *  bound hand has one. */
  mirrorPresence?: boolean;
  label?: string;
}

/** The station as bound. */
export interface BindStationResponse {
  station: StationView;
}

/** `POST /v1/console/stations/{station}/location`. Where the hardware stands.
 *  It names a LOCATION rather than carrying x and y, because positions belong
 *  to locations now and geometry in two places is geometry that disagrees
 *  (4a). This replaces the first draft's `place` route. Takes
 *  `Idempotency-Key`. */
export interface BindStationToLocationRequest {
  /** Path parameter. */
  station: StationId;
  /** Absent clears it: a crew handset that stands wherever it signs in. */
  location?: LocationId;
}

/** The station, standing where it stands. */
export interface BindStationToLocationResponse {
  station: StationView;
}

/** `GET /v1/console/stations/presence`. What the map draws, and the answer to
 *  "who is in the forest" (5.7). Presence is a venue fact, so this lists
 *  every station in the building unless it is narrowed. */
export interface ListPresenceRequest {
  /** One venue location only. */
  location?: LocationId;
  /** One zone only, as the given installation's map derives zones from
   *  locations. Needs `installation` to mean anything (4a). */
  zone?: ZoneId;
  /** Crew handsets signed in to this story only. */
  installation?: InstallationId;
  /** One kind only: all crew, all kiosks. */
  kind?: StationKind;
}

/** Every station's presence right now. Ephemeral by design: presence is
 *  logged, never journaled. */
export interface ListPresenceResponse {
  presence: PresenceView[];
}

// --- installations, and their bindings to the venue (4a) ----------------------

/** `GET /v1/console/installations`. Every story on this venue, open and
 *  closed. A producer runs one console page per story over the same plan. */
export interface ListInstallationsRequest extends PageRequest {
  /** Open ones only, which is what a walk-up would be offered. */
  open?: boolean;
}

/** A page of installations, with their walk-up and default flags. */
export interface ListInstallationsResponse extends Page<InstallationView> {}

/** `POST /v1/console/installations/{installation}/open`. Opening is what puts
 *  a story in `hello`'s list and in a walk-up's chooser: the family story
 *  opens at ten, the after-dark story at eight, on the same walls. Distinct
 *  from starting a run, which is the story beginning to play (5.4.1). Takes
 *  `Idempotency-Key`. */
export interface OpenInstallationRequest {
  /** Path parameter. */
  installation: InstallationId;
}

/** The installation as it now stands. */
export interface OpenInstallationResponse {
  installation: InstallationView;
}

/** `POST /v1/console/installations/{installation}/close`. The door shuts: a
 *  handshake that routes here is refused with `installation_closed` and the
 *  chooser stops offering it. Open visits are untouched, since closing the
 *  door and ending the run are two acts. Takes `Idempotency-Key`. */
export interface CloseInstallationRequest {
  /** Path parameter. */
  installation: InstallationId;
}

/** The closed installation. */
export interface CloseInstallationResponse {
  installation: InstallationView;
}

/** `PATCH /v1/console/installations/{installation}`. The venue-level flags:
 *  which story a walk-up is offered when no chooser is wanted, and whether
 *  this one takes walk-ups at all (7.2, 4a). Takes `Idempotency-Key`. */
export interface UpdateInstallationRequest {
  /** Path parameter. */
  installation: InstallationId;
  /** The story's name, which is what a party's page is titled with. */
  name?: string;
  /** Make this the venue's default. Exactly one installation holds it, so
   *  setting it here clears it on whichever had it. */
  default?: boolean;
  /** Mint parties at a walk-up here (7.2). False keeps this story to the
   *  door, and off every chooser. */
  walkUp?: boolean;
}

/** The installation after the change. */
export interface UpdateInstallationResponse {
  installation: InstallationView;
}

/** `GET /v1/console/installations/{installation}/bindings`. Which of the
 *  venue's locations this story's hands are dealt at (4a). */
export interface ListBindingsRequest {
  /** Path parameter. */
  installation: InstallationId;
}

/** Every binding this story has. A hand with no binding is dealt nowhere in
 *  the building, which is a contract break if a station serves it (4.11). */
export interface ListBindingsResponse {
  bindings: BindingView[];
}

/** `PUT /v1/console/installations/{installation}/bindings/{hand}`. Bind one
 *  hand to one of the venue's locations: the per-installation half of the
 *  venue, and what makes one wall two different beats in two different
 *  stories. The bundle's `maps.sites` position is the designer's picture of
 *  where the hand lives; this is the building (4.3, 4a). Takes
 *  `Idempotency-Key`. */
export interface BindHandRequest {
  /** Path parameter. */
  installation: InstallationId;
  /** Path parameter: the hand's gameId. */
  hand: GameId;
  location: LocationId;
}

/** The binding as stored. */
export interface BindHandResponse {
  binding: BindingView;
}

/** `DELETE /v1/console/installations/{installation}/bindings/{hand}`. The
 *  hand is dealt nowhere in the building from now on. Takes
 *  `Idempotency-Key`. */
export interface UnbindHandRequest {
  /** Path parameter. */
  installation: InstallationId;
  /** Path parameter. */
  hand: GameId;
}

/** Unbound, with the instant, since the console shows when the wall went
 *  quiet. */
export interface UnbindHandResponse {
  installation: InstallationId;
  hand: GameId;
  unboundAt: IsoTimestamp;
}

// --- principals ---------------------------------------------------------------

/** `POST /v1/console/principals/pair`. Issue a one-time code for any role
 *  (7.5.1): eight characters that cannot be misread, ten-minute expiry,
 *  single use. Takes `Idempotency-Key`. */
export interface PairPrincipalRequest {
  role: PrincipalRole;
  /** What the journal will attribute to: "Sam". */
  label: string;
  /** For `role: "station"`: the station this key will hold. */
  station?: StationId;
}

/** The code, and the two ways to hand it over. The KEY is not here: it is
 *  minted to the device that redeems the code, and never displayed. */
export interface PairPrincipalResponse {
  code: string;
  expiresAt: IsoTimestamp;
  /** The address to type beside the code. */
  address: string;
  /** The same two as a link, for pasting: `https://host/pair/SAM7-K2Q9`. */
  link: string;
  /** The principal the code will mint, so the console can list it as
   *  pending. */
  principal: PrincipalView;
}

/** `GET /v1/console/principals`. Every key, live and revoked. */
export interface ListPrincipalsRequest extends PageRequest {
  role?: PrincipalRole;
  /** Include revoked ones, which the console greys rather than hides. */
  revoked?: boolean;
}

/** A page of principals. */
export interface ListPrincipalsResponse extends Page<PrincipalView> {}

/** `PATCH /v1/console/principals/{principal}`. The label is the attribution,
 *  so fixing a typo in it fixes the journal's future lines (7.5). Takes
 *  `Idempotency-Key`. */
export interface RelabelPrincipalRequest {
  /** Path parameter. */
  principal: PrincipalId;
  label: string;
}

/** The relabelled principal. */
export interface RelabelPrincipalResponse {
  principal: PrincipalView;
}

/** `POST /v1/console/principals/{principal}/revoke`. Instant. Felt at the
 *  next call, with a refusal that names who revoked it and when (7.5.1).
 *  Takes `Idempotency-Key`. */
export interface RevokePrincipalRequest {
  /** Path parameter. */
  principal: PrincipalId;
}

/** The revoked principal. */
export interface RevokePrincipalResponse {
  principal: PrincipalView;
}

// --- the project (9.1) --------------------------------------------------------

/** `POST /v1/console/project`. An installation is created FROM a project: a
 *  seed pack a designer made in Storyletter, which becomes revision 1 and the
 *  source the server holds from then on. This is how a venue gains a second
 *  story on the same walls, and the new installation starts closed, taking no
 *  walk-ups, until a producer opens it (4a). Takes `Idempotency-Key`. */
export interface NewFromSeedRequest {
  /** The installation's name, which is what pairing, `hello` and the
   *  chooser show, and what the party's page is titled with. */
  name: string;
  /** The `.storyletpack` as a base64 payload, or a handle from a prior
   *  upload. The pack envelope is the wire format now, not something anyone
   *  sees (9.1). */
  pack: string;
  /** Where the pack is: `inline` is base64 in this field, `upload` is a
   *  handle. */
  encoding?: "inline" | "upload";
}

/** The new installation at revision 1. */
export interface NewFromSeedResponse {
  installation: InstallationId;
  revision: RevisionView;
  build?: BuildIdentity;
}

/** `GET /v1/console/project/pull`. A pack at the current revision. Pull with
 *  no project open behaves as Open Storyletpack does; with a project from
 *  this server open, Storyletter merges into it (9.1). */
export interface PullProjectRequest {
  /** Which story's source. */
  installation: InstallationId;
  /** A specific revision, for a designer going back to compare. Absent takes
   *  the current one. */
  revision?: RevisionId;
}

/** The pack, and the revision it is, which Storyletter records in the view
 *  sidecar so a later open knows which connection the project belongs to. */
export interface PullProjectResponse {
  revision: RevisionView;
  /** Base64 `.storyletpack`. */
  pack: string;
}

/** `POST /v1/console/project/push`. The server merges against the revision
 *  the pack was pulled from, validates, compiles and stages, or refuses with
 *  the conflict sidecars and the reasons (9.1).
 *
 *  WHICH KEY YOU CONNECTED WITH IS THE MODE: an author key may change deck,
 *  notes and comment shards and nothing else, and a push that touches a hands
 *  shard is refused with `forbidden_shard` and the author's own phrase, "pull
 *  as designer to change the shape". Takes `Idempotency-Key`. */
export interface PushProjectRequest {
  /** Which story is being pushed to. A project playing at two venues, or
   *  twice at one, has one push target per installation (4.11). */
  installation: InstallationId;
  /** The revision this push was based on, from the view sidecar. */
  base: RevisionId;
  /** Base64 `.storyletpack`. */
  pack: string;
  /** The author's note for the revision list. */
  note?: string;
  /** Storyletter's own identity, for comment authorship and as the
   *  cross-check the console shows when it disagrees with the key's label
   *  (7.5). Never authorisation. */
  identity?: { name: string; email?: string };
}

/** What the push did, or why it did not. A refusal is a `WireError` with
 *  `conflict`, `contract_break` or `forbidden_shard`; this is the success. */
export interface PushProjectResponse {
  revision: RevisionView;
  /** The build the push compiled and staged (section 9). */
  build?: BuildIdentity;
  /** Breaks against the live build and the provisioning, which the producer
   *  acknowledges per break before go-live (4.11). */
  breaks?: { path: string; message: string }[];
  /** Conflict sidecars the merge wrote, which Storyletter shows in the
   *  problems bar. */
  conflicts?: string[];
}

/** `GET /v1/console/project/revisions`. Who pushed what, when (9.1). */
export interface ListRevisionsRequest extends PageRequest {
  /** Whose source history. */
  installation: InstallationId;
}

/** A page of revisions, recent first. */
export interface ListRevisionsResponse extends Page<RevisionView> {}

/** `GET /v1/console/project/contract`. Export the contract shard: what the
 *  venue depends on, which `validate` in Storyletter reads before a push
 *  (4.11, 9.1). */
export interface GetContractRequest {
  /** Whose contract: the hands this story's stations serve, the boxes its
   *  scheduler ticks (4.11). */
  installation: InstallationId;
  /** A specific revision. Absent takes the current one. */
  revision?: RevisionId;
}

/** The shard, as text, plus what it currently protects. */
export interface GetContractResponse {
  /** The contract shard's source. */
  shard: string;
  /** The hands bound to venue locations, the boxes the scheduler ticks, the
   *  clock properties: the things a designer's push must not break. A hand
   *  named here and renamed by a push takes a wall out of the show (4a). */
  depends?: { hands?: GameId[]; boxes?: GameId[]; properties?: PropertyPath[] };
}

// --- bundles (section 9) ------------------------------------------------------

/** `POST /v1/console/bundles`. Install a `.storyletsc`. The server parses,
 *  checks `schema`, refuses a bundle whose project differs, refuses
 *  `metadata: "stripped"` unless the installation says its stations show no
 *  titles, and smoke-deals a scratch engine so every gate and every
 *  `diagnostic` fires once before a player sees it. Takes
 *  `Idempotency-Key`. */
export interface UploadBundleRequest {
  /** Which story this build is for. Bundles belong to an installation, never
   *  to the venue: two stories on one server share no content (4a). */
  installation: InstallationId;
  /** Base64 `.storyletsc`. */
  bundle: string;
  /** Base64 zip of `assets/`, when maps are on. */
  assets?: string;
  /** Stage it as well as install it. */
  stage?: boolean;
}

/** The installed build. */
export interface UploadBundleResponse {
  bundle: BundleView;
  /** What the smoke deal found, if anything. */
  diagnostics?: string[];
}

/** `GET /v1/console/bundles`. Every build the installation holds. */
export interface ListBundlesRequest extends PageRequest {
  /** Whose builds. */
  installation: InstallationId;
}

/** A page of builds, recent first. */
export interface ListBundlesResponse extends Page<BundleView> {}

/** `POST /v1/console/bundles/{build}/stage`. The producer chooses what the
 *  NEXT run starts on, which since runs restart daily is the common case for
 *  a content update (section 9). Takes `Idempotency-Key`. */
export interface StageBundleRequest {
  /** Path parameter: the server's handle for the build. */
  build: string;
}

/** The staged build. */
export interface StageBundleResponse {
  bundle: BundleView;
}

/** `POST /v1/console/bundles/{build}/go-live`. The install diff is
 *  acknowledged per break before this succeeds (4.11). Takes
 *  `Idempotency-Key`. */
export interface GoLiveRequest {
  /** Path parameter. */
  build: string;
  /** The breaks the producer has acknowledged, by path. A break not listed
   *  here is a `contract_break` refusal. */
  acknowledged?: string[];
}

/** The live build. */
export interface GoLiveResponse {
  bundle: BundleView;
}

/** `POST /v1/console/bundles/rollback`. The same command as a hot swap, with
 *  the previous build (section 9). Takes `Idempotency-Key`. */
export interface RollbackBundleRequest {
  /** Whose live build is being rolled back. */
  installation: InstallationId;
  /** Absent rolls back to whatever was live before the current one. */
  build?: string;
}

/** The build that is live now. */
export interface RollbackBundleResponse {
  bundle: BundleView;
  /** What carrying the save back across cost (4.9). */
  report?: LoadReport;
}

/** `POST /v1/console/bundles/{build}/preview-swap`. The 4.9 report against
 *  the live run, before anything moves: "3 cards on tables will be evicted, 2
 *  properties will reset". Pure: it touches nothing. */
export interface PreviewSwapRequest {
  /** Path parameter. */
  build: string;
}

/** What the swap would cost. An empty report means the swap is exact. */
export interface PreviewSwapResponse {
  build: BuildIdentity;
  report: LoadReport;
}

/** `POST /v1/console/bundles/{build}/hot-swap`. `applyLiveBundle`: a new
 *  engine on the new build, `saveGame()` carried across, every flow rebuilt,
 *  the Live Link re-attached, the `@world` container untouched. A journaled
 *  command with the report attached, so it is reversible like any other.
 *  Its honest limit, stated on the console: side effects already sent to the
 *  building do not rewind. Takes `Idempotency-Key`. */
export interface HotSwapRequest {
  /** Path parameter. */
  build: string;
  /** The preview the producer saw. The server refuses with `stale_build` if
   *  the live build has moved since. */
  seenReportFor?: string;
}

/** The swap, and what it cost. */
export interface HotSwapResponse {
  bundle: BundleView;
  report: LoadReport;
  /** The journal sequence number of the swap command. */
  seq: number;
}

// --- durable state and bridges ------------------------------------------------

/** `POST /v1/console/durable/reset`. Every pocket and the installation
 *  memory. Typed confirmation in the console, journaled here (6.5). Takes
 *  `Idempotency-Key`. */
export interface ResetDurableRequest {
  /** Whose durable state. `all` is all of ONE story's, never the venue's:
   *  wiping the family story leaves the after-dark story alone (4a). */
  installation: InstallationId;
  /** What to clear. */
  scope: "pockets" | "installation" | "all";
  /** The installation's name, typed by the producer, as the console's
   *  confirmation. A mismatch is `bad_request`. */
  confirm: string;
}

/** What was cleared. */
export interface ResetDurableResponse {
  scope: "pockets" | "installation" | "all";
  /** How many party pockets were emptied. */
  pockets?: number;
  at: IsoTimestamp;
}

/** `GET /v1/console/bridges`. Cues out, triggers in (5.6). */
export interface ListBridgesRequest {
  /** Whose bridges. A prop only one story may hold at a time is a `@world`
   *  property a bridge writes into both, which is two bridges (4a). */
  installation: InstallationId;
}

/** Every bridge the installation has. */
export interface ListBridgesResponse {
  bridges: BridgeView[];
}

/** `PUT /v1/console/bridges/{bridge}`. The adapter's own settings, which the
 *  server does not interpret. Takes `Idempotency-Key`. */
export interface ConfigureBridgeRequest {
  /** Whose bridge. */
  installation: InstallationId;
  /** Path parameter. */
  bridge: string;
  kind?: "webhook" | "osc" | "mqtt";
  label?: string;
  enabled?: boolean;
  hands?: GameId[];
  flow?: FlowRef;
  config?: Record<string, ScalarValue>;
}

/** The bridge as configured. */
export interface ConfigureBridgeResponse {
  bridge: BridgeView;
}

/** `POST /v1/console/bridges/{bridge}/test`. Fire a cue at the building with
 *  nobody in it: the morning-of check. Takes `Idempotency-Key`. */
export interface TestFireBridgeRequest {
  /** Path parameter. */
  bridge: string;
  /** What to send. Absent sends the adapter's own test payload. */
  payload?: unknown;
}

/** What the adapter said. A failure here is a 200 with `ok: false`, because
 *  "the light desk did not answer" is an answer, not a broken request. */
export interface TestFireBridgeResponse {
  bridge: string;
  ok: boolean;
  /** The adapter's response or its error, for the console to show. */
  detail?: string;
}

// --- messaging from the console (6.7) -----------------------------------------

/** `POST /v1/console/messages`. A producer to everyone, a kind, a zone or one
 *  station. Takes `Idempotency-Key`. */
export interface BroadcastMessageRequest {
  /** Which story's crew. Absent addresses the whole building, which is what
   *  a venue-wide instruction ("everyone to the foyer") wants; a location or
   *  zone audience without one reaches every station standing there,
   *  whichever story it is serving (4a). */
  installation?: InstallationId;
  body: string;
  priority: "note" | "cue" | "urgent";
  audience: MessageAudience;
  ackRequired?: boolean;
}

/** The message as sent, with the audience it resolved to right now. */
export interface BroadcastMessageResponse {
  message: MessageView;
  /** How many stations it went to, which is the denominator of "4 of 5 in
   *  the forest have seen it". */
  delivered: number;
}
