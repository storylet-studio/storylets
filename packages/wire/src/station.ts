// ---------------------------------------------------------------------------
// The station and party API (`/v1`, section 6.4, with 5.7, 6.7 and 7.5.1).
//
// Bearer: a station key, or a party token (from the QR). A station key may
// act on behalf of a party it has handshaken with; a party token alone is a
// companion phone.
//
// A STATION KEY IS A VENUE KEY (4a). One station serves any installation the
// venue is running, and which story it shows is decided PER PARTY at the
// handshake, never per device at provisioning: the credential resolves to a
// party in an installation, and that pair is the routing. A crew handset is
// the one exception, and only operationally: it is signed in to one
// installation at a time, since a performer is in one show.
//
// PATH PARAMETERS ARE FIELDS. A route like
// `POST /v1/visits/{visitId}/play` carries its visit id in the request type
// as well as in the URL, because a client that builds the URL from the same
// object it sends cannot get the two out of step, and because a request type
// with no fields at all is a type nobody can misuse and nobody can check.
// The JSDoc names the route, so which fields are path and which are body is
// never in doubt.
//
// EVERY MUTATION TAKES `Idempotency-Key` (see IDEMPOTENCY_HEADER). It is a
// header, not a field, so it is documented on each mutating request rather
// than typed into it: a retry after a wifi blip must be the SAME request,
// and a key in the body would be part of what is being retried.
// ---------------------------------------------------------------------------

import type { ScalarValue } from "@storylet-studio/model";
import type { Clocks } from "./cues.js";
import type {
  BoardView, DealtCardView, InstallationView, MessageAudience, MessageView, OutcomeViewWire,
  PresenceView, PropertyView, RunView, StationView, TurnsView, VenueView, VisitView,
} from "./views.js";
import type {
  BuildIdentity, GameId, InstallationId, IsoTimestamp, LocationId, MessageId, PartyId, PropertyPath,
  StationId, VenueId, VisitId,
} from "./vocabulary.js";

// --- hello -------------------------------------------------------------------

/** `POST /v1/hello`. The first call any client makes, before it knows whether
 *  its key still works. Empty by design: what the caller is comes from the
 *  bearer, not from what it claims. */
export interface HelloRequest {
  /** The protocol the client speaks, so a mismatch is caught in one round
   *  trip rather than at the first shape that changed. */
  wire?: string;
}

/** What the server is, right now, to this caller. */
export interface HelloResponse {
  server: { version: string };
  /** Always `storyletengine/wire@1` for this package. */
  wire: string;
  /** The physical place: one venue per server, above every installation
   *  (4a). */
  venue: VenueView;
  /** The OPEN installations: the stories running here now, each saying
   *  whether it takes a walk-up and which one is the venue's default. A LIST
   *  rather than the one installation the first draft named, because a
   *  station key is a venue key and the story is chosen per party. A device
   *  that finds several open and holds no credential draws the chooser. */
  installations: InstallationView[];
  /** The run of the installation this caller is already in: a party token, or
   *  a crew handset signed in to one. Absent when the caller is in no
   *  installation yet, and when that installation has no live run, in which
   *  case a station shows its waiting screen. */
  run?: RunView;
  /** The build that run is pinned to. */
  build?: BuildIdentity;
  /** Present when the bearer is a station key: what this device is, where it
   *  stands, and which story it is signed in to if it is a crew handset. */
  station?: StationView;
  /** Present when the bearer is a party token: the visit it is attached to,
   *  so a reloaded phone resumes without a second handshake. The visit names
   *  the installation, which is what the page skins itself from. */
  visit?: VisitView;
}

// --- parties and credentials --------------------------------------------------

/** `POST /v1/parties`. Mint a transient party IN AN INSTALLATION. Any station
 *  may, since a station key is a venue key, when that installation allows
 *  walk-up (`walkUp: true`, the default, 7.2); otherwise `walk_up_closed`.
 *  Nothing is asked for, and nothing about a person is stored. Takes
 *  `Idempotency-Key`. */
export interface MintPartyRequest {
  /** Which story this party is being minted into. A party belongs to one
   *  installation and the credential resolves to the pair, which is the
   *  routing (7.1, 4a). A device with no story of its own must say. */
  installation: InstallationId;
  /** Ask for a day-pass call sign as well as the token, which a kiosk shows
   *  and a performer can hear. Absent means the server decides. */
  callSign?: boolean;
  /** Attach the minting station to the new party's visit immediately, which
   *  is what a walk-up handshake wants. */
  attach?: boolean;
}

/** The minted party, and the one time its token is on the wire. */
export interface MintPartyResponse {
  partyId: PartyId;
  /** The bearer the phone keeps, or the QR the kiosk prints. */
  token: string;
  /** A day pass from a word list, unique within the run, expiring at run end
   *  (7.1). Chosen by the server, never typed in by the party. */
  callSign?: string;
  /** Present when `attach` was asked for. */
  visit?: VisitView;
}

/** `POST /v1/parties/{partyId}/claim`. Make a transient party permanent by
 *  issuing a keepsake credential: issuing IS the claim (7.1). A kiosk or a
 *  companion page may claim with what it has; the sign-in station is the one
 *  with hardware behind it. Takes `Idempotency-Key`. */
export interface ClaimPartyRequest {
  /** Path parameter. */
  partyId: PartyId;
  /** Which keepsake: a QR to photograph or print, a permanent call sign to
   *  remember, or a wristband to bind. */
  kind: "token" | "callsign" | "external";
  /** For `external`: the value the venue's reader just read. Opaque to us. */
  externalRef?: string;
  /** What a producer will see beside the credential in the console. */
  label?: string;
}

/** The keepsake. Exactly one of the three is present, matching `kind`. */
export interface ClaimPartyResponse {
  partyId: PartyId;
  /** The party record has flipped to claimed and left the sweep. */
  claimed: true;
  /** For `kind: "token"`: the URL to print or photograph. */
  qr?: string;
  /** For `kind: "callsign"`: permanent, unique per installation. */
  callSign?: string;
  /** For `kind: "external"`: the ref now bound to this party. */
  externalRef?: string;
}

/** `POST /v1/parties/{partyId}/credentials`. Another credential for the same
 *  party: a wristband per member, a day pass, a replacement for a lost one.
 *  Many credentials resolve to one party, one flow, one pocket (7.1). Takes
 *  `Idempotency-Key`. */
export interface IssueCredentialRequest {
  /** Path parameter. */
  partyId: PartyId;
  kind: "token" | "callsign" | "external";
  /** For `external`: the wristband or chip just read. */
  externalRef?: string;
  label?: string;
  /** A day pass expires at run end; absent means permanent. */
  dayPass?: boolean;
}

/** The issued credential. As with the claim, the secret crosses once. */
export interface IssueCredentialResponse {
  partyId: PartyId;
  credential: { id: string; kind: "token" | "callsign" | "external" };
  /** For a token: the URL. For a call sign: the words. */
  token?: string;
  callSign?: string;
  externalRef?: string;
}

// --- the handshake ------------------------------------------------------------

/** `POST /v1/handshake`. Resolve a credential and attach THIS station to the
 *  party's visit (7.2). Tagged on the credential kind, where the spec's
 *  sketch is untagged: a tag costs one field and buys a discriminated union,
 *  which is exactly the drift this package exists to prevent.
 *
 *  A call sign or an external ref from an anonymous connection is refused
 *  with `needs_station_key`: a station with a key VOUCHES; a phone must HOLD
 *  the token. Takes `Idempotency-Key`. */
export type HandshakeRequest =
  /** A printed QR, or the same on a phone screen. Any station, or the party's
   *  own phone. */
  | { credential: "token"; token: string }
  /** A wristband, an RFID chip, an NFC tag. A station with a key only. */
  | { credential: "external"; externalRef: string }
  /** A name or phrase the party SAYS, picked from a list by a person. A crew
   *  or sign-in station only. */
  | { credential: "callsign"; callSign: string };

/** The attach. The board comes back with it so the first screen needs no
 *  second round trip. */
export interface HandshakeResponse {
  partyId: PartyId;
  /** Which story the credential resolved into: the pair is the routing, and
   *  it is what the station skins and titles itself from (7.1, 4a). A fixed
   *  station may show the fantasy story to one visitor and the sci-fi story
   *  to the next. */
  installation: InstallationId;
  visitId: VisitId;
  /** Narrowed to the hands this party's installation binds to the location
   *  this station stands at (5.7, 4a). */
  board: BoardView;
  callSign?: string;
  /** A returning party's pocket came back with them (7.3). */
  returning?: boolean;
}

/**
 * `POST /v1/at/{venue}/{location}`. The other direction: a party's phone
 * scanned the code on a wall (7.2).
 *
 * THE CODE SAYS ONLY WHERE IT IS. No story and no installation ride in it,
 * because the same wall serves every story the venue is running, and placards
 * are printed once (4a, 12.2). A location is not a station either: nothing is
 * attached as a device here, and the phone stays the phone. The scan is the
 * presence signal a placard venue has, and a truthful one: the party was at
 * the well when they scanned the well.
 *
 * What comes back is decided by what the phone holds. Takes
 * `Idempotency-Key`.
 */
export interface AttachAtLocationRequest {
  /** Path parameter. */
  venue: VenueId;
  /** Path parameter. */
  location: LocationId;
}

/**
 * Either the phone is routed into one story, or it is asked which.
 *
 * Discriminated on `outcome` rather than left to which field happens to be
 * present, which is exactly the drift this package exists to prevent. Both
 * are 200s: a chooser is the server answering, not failing, which is why
 * there is no `choose_installation` error code.
 */
export type AttachAtLocationResponse =
  /** The phone's credential resolved to a party in an installation, or it
   *  held none and the venue has one default story to offer: that pair is the
   *  routing (7.1, 4a). The board is this installation's hand at this
   *  location, narrowed as ever. */
  | {
      outcome: "attached";
      installation: InstallationId;
      visit: VisitView;
      board: BoardView;
    }
  /** No credential, and several stories are open: the phone shows the
   *  chooser, branded for nothing until the visitor picks. Only installations
   *  that take walk-ups are listed, and the choice mints the party (see
   *  {@link ChooseInstallationRequest}). */
  | { outcome: "choose"; installations: InstallationView[] };

/** `POST /v1/at/{venue}/{location}/choose`. The phone that was offered the
 *  chooser says which story. The choice MINTS the party in that installation
 *  and attaches, so this is the walk-up handshake with the routing supplied
 *  by a person instead of by a credential (4a, 7.2). Refused with
 *  `walk_up_closed` when that story does not mint at a walk-up, and
 *  `installation_closed` when it has closed since the chooser was drawn.
 *  Takes `Idempotency-Key`. */
export interface ChooseInstallationRequest {
  /** Path parameter. */
  venue: VenueId;
  /** Path parameter. */
  location: LocationId;
  /** The story the visitor picked, from the chooser. */
  installation: InstallationId;
}

/** The same attach the routed outcome gives, so a client has one code path
 *  after the fork. */
export interface ChooseInstallationResponse {
  installation: InstallationId;
  visit: VisitView;
  board: BoardView;
}

// --- the visit ----------------------------------------------------------------

/** Open or resume a visit for a party this station has already handshaken
 *  with. The handshake is the usual door and opens the visit itself (5.4);
 *  this exists for the client that holds a party token across a run boundary
 *  and wants the new run's visit without re-presenting a credential. Takes
 *  `Idempotency-Key`. */
export interface OpenVisitRequest {
  party: PartyId;
  /** Attach this station on open. Absent means yes for a station key. */
  attach?: boolean;
}

/** The open visit, and its board if a station asked to attach. */
export interface OpenVisitResponse {
  visit: VisitView;
  board?: BoardView;
  /** True when a parked FlowSave was restored rather than a fresh flow
   *  seeded from the pocket (5.4). */
  resumed?: boolean;
}

/** `DELETE /v1/visits/{visitId}`. Park: leave. The flow is saved, the
 *  stations detached, the shared claims released, as the corpus promises.
 *  Takes `Idempotency-Key`. */
export interface ParkVisitRequest {
  /** Path parameter. */
  visitId: VisitId;
}

/** Parked. There is nothing to say beyond when. */
export interface ParkVisitResponse {
  visit: VisitId;
  parkedAt: IsoTimestamp;
}

/** `DELETE /v1/visits/{visitId}/stations/me`. The performer moves on: detach
 *  THIS station and leave the visit open for the others (5.4). Takes
 *  `Idempotency-Key`. */
export interface DetachStationRequest {
  /** Path parameter. */
  visitId: VisitId;
}

/** Detached, with what is left attached, so a crew view can drop the party
 *  from its list without a second read. */
export interface DetachStationResponse {
  visit: VisitId;
  station: StationId;
  /** Still attached after this. Empty means the visit has no station left,
   *  which is not a close: idle decides that (5.4). */
  stations: StationId[];
}

// --- the table ----------------------------------------------------------------

/** `GET /v1/visits/{visitId}/board?hands=`. What this station may show: the
 *  hands this visit's installation binds to the location this station stands
 *  at (4a). */
export interface GetBoardRequest {
  /** Path parameter. */
  visitId: VisitId;
  /** Query parameter, comma-joined on the wire. Absent means every hand bound
   *  here for this visit's installation; any other hand is `not_bound`. */
  hands?: GameId[];
}

/** The board, and the clocks that decide what it means. */
export interface GetBoardResponse {
  board: BoardView;
  /** Each box's turn count, for a client that shows a cooldown (4.8). */
  turns?: TurnsView;
  /** The three world clocks at the moment of the read (10.2). */
  clocks?: Clocks;
}

/** `POST /v1/visits/{visitId}/deal`. The hands bound here for this visit's
 *  installation only (4a). Takes `Idempotency-Key`. */
export interface DealRequest {
  /** Path parameter. */
  visitId: VisitId;
  /** Absent deals every hand bound here for this visit's installation. */
  hands?: GameId[];
}

/** The board after the deal, which is the cheap snapshot every client wants
 *  anyway, so a deal never needs a board read behind it. */
export interface DealResponse {
  board: BoardView;
  turns?: TurnsView;
  /** Cards evicted by this deal, and why: a claim taken while the party was
   *  parked comes back as `claimed-elsewhere`, which is the honest outcome
   *  (5.4). */
  evicted?: { hand: GameId; card: GameId; reason: string }[];
}

/** `GET /v1/visits/{visitId}/cards/{card}/outcomes?hand=`. Availability is
 *  evaluated at the moment of the ask, so this is a read a client repeats
 *  rather than a value it caches. */
export interface GetOutcomesRequest {
  /** Path parameter. */
  visitId: VisitId;
  /** Path parameter: the card's gameId. */
  card: GameId;
  /** Query parameter: which hand the card is being played from. */
  hand: GameId;
}

/** The outcomes, in the order the content declares them. */
export interface GetOutcomesResponse {
  card: GameId;
  outcomes: OutcomeViewWire[];
}

/** `POST /v1/visits/{visitId}/play`. The same card played from two stations
 *  fails loudly the second time with `not_dealt`, which is the right answer
 *  (5.4). Takes `Idempotency-Key`. */
export interface PlayRequest {
  /** Path parameter. */
  visitId: VisitId;
  card: GameId;
  outcome: GameId;
  hand: GameId;
}

/** What the play did. The board comes back for the same reason a deal's
 *  does. */
export interface PlayResponse {
  board: BoardView;
  turns?: TurnsView;
  /** What the outcome wrote, by resolved path, so a station can show a
   *  change without re-reading every property. */
  writes?: { path: PropertyPath; value: ScalarValue; prev?: ScalarValue }[];
}

/** `POST /v1/visits/{visitId}/peek`. A read: it never claims, and it advances
 *  nothing. A performer peeks the party's box to see what might come (5.7). */
export interface PeekRequest {
  /** Path parameter. */
  visitId: VisitId;
  /** The box's gameId. */
  box: GameId;
  /** The tag criteria, group gameId to tag gameId, as `deal` takes them. */
  criteria?: Record<GameId, GameId>;
  /** How many to look at. The engine has no pick policy (Reboot 2.1). */
  n?: number;
}

/** The top of the stock, looked at and put back. */
export interface PeekResponse {
  box: GameId;
  cards: DealtCardView[];
}

/** `GET /v1/visits/{visitId}/properties`. The flow's merged view, by path. */
export interface GetPropertiesRequest {
  /** Path parameter. */
  visitId: VisitId;
  /** Query parameter: only paths under this prefix (`story.`). */
  prefix?: string;
}

/** Every row a station may read, in `listProperties()` order. */
export interface GetPropertiesResponse {
  properties: PropertyView[];
}

/** `GET /v1/world`. `@world` as the station may read it. */
export interface GetWorldRequest {
  /** Query parameter: only paths under this prefix. */
  prefix?: string;
}

/** The world, and the clocks derived at the moment of the read (10.2). */
export interface GetWorldResponse {
  properties: PropertyView[];
  clocks: Clocks;
}

// --- the stream ---------------------------------------------------------------

/** `POST /v1/stream-ticket`. Minted by this authenticated call because a
 *  browser `EventSource` cannot set a header, and the old server's real SSE
 *  connections 401'd for months for exactly that reason (6.2). Empty body:
 *  the ticket is for whoever the bearer is. */
export interface CreateStreamTicketRequest {
  /** Ask for monitor scope (everything, flow-tagged). Refused with
   *  `wrong_role` unless the principal is a monitor or a producer. */
  monitor?: boolean;
}

/** The ticket, for `GET /v1/events?t=<ticket>`. Short-lived by design. */
export interface CreateStreamTicketResponse {
  ticket: string;
  expiresAt: IsoTimestamp;
}

// --- presence -----------------------------------------------------------------

/**
 * `POST /v1/stations/me/presence`. A crew handset says WHERE IT IS: it
 * scanned the code on the wall, or tapped a location from the venue's list
 * (5.7, 4a).
 *
 * A LOCATION, never a zone. Locations are the venue's and a device knows one;
 * zones are an installation's word for a part of its map, and the server
 * derives one from the location for whichever story the handset is signed in
 * to, if that story's map covers it. A station key is a venue key, so this is
 * a venue fact whatever the device is showing.
 *
 * Not journaled as a command (it changes no story) but logged, so a producer
 * can see where a performer was at 14:32. Takes `Idempotency-Key`.
 */
export interface SetPresenceRequest {
  /** Absent clears it: the performer is nowhere in particular. */
  location?: LocationId;
}

/** The new presence, and what the content did about it. */
export interface SetPresenceResponse {
  presence: PresenceView;
  /** The movable holes this sign-in mirrored into, when the station mirrors
   *  (4.6, 5.7). Empty when the mirror is off, in which case presence is
   *  purely operational and the content stands still. */
  mirrored?: PropertyPath[];
}

// --- messaging (6.7) ----------------------------------------------------------

/** `GET /v1/messages?since=`. For a device that reconnects: delivery rides
 *  the SSE stream, and this is the catch-up. */
export interface ListMessagesRequest {
  /** Query parameter: only messages after this instant. */
  since?: IsoTimestamp;
}

/** Messages addressed to this station, its zone, its kind, or everyone. */
export interface ListMessagesResponse {
  messages: MessageView[];
}

/** `POST /v1/messages/{id}/ack`. The performer saw it, and the producer
 *  watches the count fill in. Takes `Idempotency-Key`. */
export interface AckMessageRequest {
  /** Path parameter. */
  id: MessageId;
}

/** Acked, with the running count the producer is watching. */
export interface AckMessageResponse {
  id: MessageId;
  acked: number;
  /** How many stations the audience resolves to right now. */
  of: number;
}

/** `POST /v1/messages`. Crew to producers: a help call, a note, a reply. The
 *  first thing a crew view needs after the prompt list (6.7). Takes
 *  `Idempotency-Key`. */
export interface SendMessageRequest {
  body: string;
  priority: "note" | "cue" | "urgent";
  /** A crew station may address the producers or a zone; the wider audiences
   *  are the console's (6.5). */
  audience: MessageAudience;
  ackRequired?: boolean;
}

/** The message as it was logged and sent. */
export interface SendMessageResponse {
  message: MessageView;
}
