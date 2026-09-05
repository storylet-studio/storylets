// ---------------------------------------------------------------------------
// What the server SHOWS: the read shapes every route and every event hands
// back. GameIds throughout, properties by their path (6.3).
//
// The card views mirror the runtime's `DealtCard` and `OutcomeView` with the
// internal `id` dropped and the gameId promoted to `id`, which is the
// normalisation 6.3 requires. They are declared here rather than imported so
// that a change to the runtime's internal view cannot silently change the
// wire, which is the whole reason this package exists.
// ---------------------------------------------------------------------------

import type { PropertyType, ScalarValue } from "@storylet-studio/model";
import type {
  Actor, BuildIdentity, CredentialId, CredentialKind, FlowRef, GameId, InstallationId, IsoTimestamp,
  LocationId, MessageId, PartyId, PrincipalId, PrincipalRole, PropertyPath, RevisionId, RunId,
  StationId, StationKind, VenueId, VisitId, ZoneId,
} from "./vocabulary.js";

/**
 * The venue: the physical place, one per server, above every installation
 * (4a). Its locations and its stations belong to it, and the stories running
 * on those walls are its installations.
 */
export interface VenueView {
  venue: VenueId;
  /** What the building is called, which is what a placard's sheet is headed
   *  with and what pairing shows. */
  name: string;
  /** The venue plan every installation's map is drawn over: one background
   *  and one coordinate space, so two stories on the same walls line up.
   *  Absent until a producer uploads one, in which case the console draws
   *  locations on a bare grid. */
  plan?: {
    width: number;
    height: number;
    /** Where the console fetches the plan image. */
    background?: string;
  };
}

/**
 * A location: a position on the venue's plan with a printed code (4a).
 *
 * A PLACARD IS A LOCATION, not a station. It has no key, no kind and no
 * hardware, and its code carries no story, because the same wall serves every
 * installation the venue is running: what comes back when it is scanned is
 * decided by the scanning party's credential, never by the code.
 */
export interface LocationView {
  location: LocationId;
  venue: VenueId;
  /** What the crew call it: "the well", "the forge door". */
  label: string;
  /** Where it is on the venue plan. The bundle's `maps.sites` positions are
   *  the DESIGNER's, for the Board and the playable page; these are the
   *  building's, and the server maps hands to them at binding (4.3, 4a). */
  x: number;
  y: number;
  /** The printed URL, which is what the QR encodes:
   *  `https://<server>/at/<venue>/<location>`. Stable for the life of the
   *  location, because placards are printed once (12.2). */
  code: string;
}

/**
 * One installation's hand, bound to one of the venue's locations (4a).
 *
 * Bindings are the per-installation half of the venue: the same wall is the
 * family story's well by day and the after-dark story's altar by night, and
 * neither knows about the other.
 */
export interface BindingView {
  installation: InstallationId;
  /** The hand's gameId. */
  hand: GameId;
  location: LocationId;
}

/** One card on a board or in a peeked list. Carries NO outcome availability:
 *  ask `outcomes` for current truth, exactly as the local runtime requires. */
export interface DealtCardView {
  /** The card's gameId. */
  id: GameId;
  title?: string;
  /** The author's note about what the beat is for. A crew view leans on it
   *  (5.7), which is why author metadata falls through into the bundle. */
  purpose?: string;
  /** The card's fields: the cue vocabulary a bridge or a display reads. */
  fields?: Record<string, ScalarValue>;
}

/** One outcome offered on a dealt card. Named against the runtime's
 *  `OutcomeView` with a `Wire` suffix so the two can be imported side by side
 *  in the server, which holds both. */
export interface OutcomeViewWire {
  /** The outcome's gameId. */
  id: GameId;
  title?: string;
  purpose?: string;
  /** Evaluated against CURRENT state at the moment of the ask. */
  available: boolean;
}

/** A flow's board: the cards in each hand, keyed by the hand's gameId. A
 *  station sees only the hands its party's installation binds to the location
 *  it stands at (5.7, 4a). */
export type BoardView = Record<GameId, DealtCardView[]>;

/** Each box's clock, keyed by the box's gameId. Turns are not time, except in
 *  a timed box, where the host ticks them (4.8, 10.4). */
export type TurnsView = Record<GameId, number>;

/** One property row, as `listProperties()` prints it. */
export interface PropertyView {
  /** The address: `world.time_show`, `story.visits`, `deck.wares.name`. */
  path: PropertyPath;
  value: ScalarValue;
  type: PropertyType;
  /** False for a story property the content declares read-only. It protects
   *  against OUTCOMES only; what an external writer may touch is the
   *  installation's resolver decision, per property (5.6). */
  writable: boolean;
  /** Shared across flows rather than per-flow (the model's `shared`). */
  shared?: boolean;
  /** Survives the run: the pocket, or the installation memory (4.2). */
  durable?: boolean;
}

/** Where a station is, and since when (5.7). Presence is the server's fact,
 *  kept apart from the content's binding on purpose. */
export interface PresenceView {
  station: StationId;
  kind: StationKind;
  /** Where the device is: one of the VENUE's locations. A fixed or sign-in
   *  station's is where it was installed; a crew handset's is the location it
   *  last signed in to, by scanning the code on the wall or tapping one from
   *  the list. None when a crew handset has not signed in anywhere yet. */
  location?: LocationId;
  /** The zone the installation's map derives from that location, when the
   *  station is serving an installation whose map covers it (4a). Derived by
   *  the server, never sent by the device: a device knows only where it is,
   *  and a zone is a story's word for it. */
  zone?: ZoneId;
  since: IsoTimestamp;
}

/** A live visit, as the console's roster and a station's own view read it. */
export interface VisitView {
  visit: VisitId;
  party: PartyId;
  /** Which story this visit is in. A party belongs to one installation and a
   *  credential resolves to the pair, which IS the routing (7.1, 4a). */
  installation: InstallationId;
  /** The handle the performer says and the producer reads: the same words in
   *  the roster, the console and the room (7.4). */
  callSign?: string;
  /** Every station attached right now: a group can split up (5.4). */
  stations: StationId[];
  lastCommandAt: IsoTimestamp;
  /** Past `visit.idleMinutes` with no command: the next sweep parks it. */
  idle: boolean;
}

/** One credential, without its secret. The console revokes and moves these by
 *  `id`; the token itself is shown once, at issue, and never again. */
export interface CredentialView {
  id: CredentialId;
  kind: CredentialKind;
  /** The call sign's words, or a label a producer typed for a wristband. The
   *  external ref itself is opaque to us and is not echoed. */
  label?: string;
  issuedAt: IsoTimestamp;
  /** A day pass expires at run end; a permanent credential does not. */
  expiresAt?: IsoTimestamp;
  revokedAt?: IsoTimestamp;
}

/** A party as the console lists it. No name, no email, no photo: a ULID, its
 *  credentials, a pocket of declared story values, a parked flow (7.4). */
export interface PartyView {
  party: PartyId;
  /** The story this party is in: party ids are minted per installation, and
   *  the credential resolves to the pair (7.1, 4a). A person playing both of
   *  a venue's stories is two parties with two pockets. */
  installation: InstallationId;
  callSign?: string;
  /** Claimed parties leave the sweep; transient ones live for the run and a
   *  grace window (7.1). */
  claimed: boolean;
  createdAt: IsoTimestamp;
  lastSeenAt?: IsoTimestamp;
  /** Present on the detail route, absent in a page of the list. */
  credentials?: CredentialView[];
  /** What the party takes away and brings back, by property path (4.2). A
   *  path the current build no longer declares is listed here as an orphan
   *  rather than silently dropped (section 9). */
  pocket?: Record<PropertyPath, ScalarValue>;
  /** A parked FlowSave is waiting for them in the live run (5.4). */
  parked?: boolean;
}

/**
 * A station as the console lists and the map draws it: hardware with a key,
 * owned by the VENUE (4a).
 *
 * It carries NO hands. Which story a station shows is decided per party at
 * the handshake, never per device at provisioning, so the hands live in the
 * installation's own bindings ({@link BindingView}). It carries no position
 * either: it stands at a location, and the location has the position.
 */
export interface StationView {
  station: StationId;
  /** The venue whose key this station holds. */
  venue: VenueId;
  label: string;
  kind: StationKind;
  /** Where it stands, which is where the map draws it. A crew handset has
   *  none until it signs in somewhere. */
  location?: LocationId;
  /** The station's presence, which for a crew station is the second mark the
   *  map draws beside where the content thinks the NPC is. */
  presence?: PresenceView;
  /** For a crew handset: the installation it is signed in to right now. One
   *  at a time, since a performer is in one show (4a). Absent for a fixed or
   *  sign-in station, which serves whichever story each party is in. */
  installation?: InstallationId;
  /** Mirror the sign-in into the bound hands' movable holes (4.6), which is
   *  the default when a bound hand has one. The hands are those of the
   *  installation the handset is signed in to. */
  mirrorPresence?: boolean;
  /** Every station holds a key, so every station pairs; false until the
   *  device has. A location needs no key and never appears here: it is a
   *  printed code and nothing else. */
  paired?: boolean;
}

/** The live run (section 2, 5.4.1). */
export interface RunView {
  run: RunId;
  /** The build this run is pinned to at start (section 9). */
  build: BuildIdentity;
  /** Minted at `run.start`, or given by a producer for a rehearsal that
   *  should repeat. Every flow's seed derives from it and the party id. */
  seed: number;
  startedAt: IsoTimestamp;
  /** There is no third state between a live run and a closed one; `paused` is
   *  a Hold, which the cue list drives (10.3). */
  state: "live" | "paused" | "ended";
}

/** A principal: one record shape for every non-party thing (7.5). The key
 *  hash is never on the wire. */
export interface PrincipalView {
  principal: PrincipalId;
  /** What the journal attributes to: "Priya (producer)". */
  label: string;
  role: PrincipalRole;
  issuedAt: IsoTimestamp;
  /** The principal that issued it, which is always a producer in v1. */
  issuedBy?: PrincipalId;
  revokedAt?: IsoTimestamp;
  lastSeenAt?: IsoTimestamp;
  /** For a station principal: the station it holds the key for. */
  station?: StationId;
}

/**
 * An installation: one story running at the venue, as `hello`, the chooser
 * and the pairing response name it (4a).
 *
 * `hello` lists the OPEN ones rather than the one installation the first
 * draft named, because a station key is a venue key and the story is chosen
 * per party.
 */
export interface InstallationView {
  installation: InstallationId;
  /** The story's name, which is the skin, the tone and the title of the page
   *  a party sees: branding follows the installation, not the venue (12). */
  name: string;
  /** Open to parties right now. Absent means open: a closed one is only ever
   *  listed by the console. */
  open?: boolean;
  /** This story mints parties at a walk-up (`walkUp: true`, the default,
   *  7.2). False means a party must be signed in at the door, and it is
   *  offered in no chooser. */
  walkUp?: boolean;
  /** The venue's default: what a walk-up with no credential is offered, and
   *  the only one offered when just one is open. Exactly one installation
   *  holds it. */
  default?: boolean;
}

/** Who a message is for (6.7). A location or zone audience is what makes
 *  presence worth having: it reaches every station standing there, by the
 *  location it reported or by the zone an installation's map derives from
 *  it (4a). */
export type MessageAudience =
  | { to: "everyone" }
  | { to: "kind"; kind: StationKind }
  /** Every station standing at one of the venue's locations. The address a
   *  producer has without knowing whose map covers what (4a). */
  | { to: "location"; location: LocationId }
  | { to: "zone"; zone: ZoneId }
  | { to: "station"; station: StationId }
  | { to: "producers" };

/** A message. Logged with the run, never journaled: it changes no story. */
export interface MessageView {
  id: MessageId;
  body: string;
  sender: Actor;
  priority: "note" | "cue" | "urgent";
  audience: MessageAudience;
  at: IsoTimestamp;
  /** The producer wants to watch the acks fill in: "4 of 5 in the forest have
   *  seen it". */
  ackRequired?: boolean;
  /** Stations that have acked, and when. Absent on a station's own copy. */
  acks?: { station: StationId; at: IsoTimestamp }[];
}

/** One revision of the project's source, as pull and push count them (9.1). */
export interface RevisionView {
  revision: RevisionId;
  at: IsoTimestamp;
  /** Who pushed: the principal's label, and the role that decided what the
   *  push was allowed to touch. */
  by: Actor;
  role: PrincipalRole;
  /** The author's own note, when Storyletter sent one. */
  note?: string;
  /** The shard paths this revision changed. */
  changed?: string[];
}

/** One installed build (section 9). */
export interface BundleView {
  build: BuildIdentity;
  /** The server's own handle for this build, which is what stage, go-live and
   *  rollback name. */
  id: string;
  uploadedAt: IsoTimestamp;
  by?: Actor;
  /** Exactly one build is live and at most one is staged. */
  state: "installed" | "staged" | "live" | "rolled-back";
  /** From `describeBundle` at install: refused unless the installation says
   *  its stations show no titles. */
  metadata?: "full" | "stripped";
}

/** A bridge: cues out, triggers in (5.6). The server never interprets a
 *  card's fields; a bridge does. */
export interface BridgeView {
  id: string;
  kind: "webhook" | "osc" | "mqtt";
  label?: string;
  enabled: boolean;
  /** The hands whose deals and plays this bridge sends. */
  hands?: GameId[];
  /** Adapter settings, opaque to this package: a URL, a host and port, a
   *  topic prefix. The console renders them from the adapter's own schema. */
  config?: Record<string, ScalarValue>;
  /** The flow whose trace this bridge is watching, when it is narrowed. */
  flow?: FlowRef;
}
