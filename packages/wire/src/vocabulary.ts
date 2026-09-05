// ---------------------------------------------------------------------------
// The venue's words, on the wire (design/engine-server.md section 2).
//
// Ids are PLAIN string aliases, not branded types. Branding would buy a
// little safety at the cost of every literal in every client, every test and
// every fixture needing a cast, and the ids that matter most here are
// gameIds, which the runtime itself types as bare strings. One rule, applied
// to all of them, is worth more than a mixed scheme.
// ---------------------------------------------------------------------------

/** The protocol name and major version. It rides the path (`/v1`) and the
 *  `hello`, and it is the ONLY thing a bump changes: see the additive-fields
 *  rule on {@link WireEnvelopeRules}. */
export const WIRE_VERSION = "storyletengine/wire@1";

/** Base path of the station and party API (section 6.4). */
export const WIRE_PATH = "/v1";

/** Base path of the producer API (section 6.5). */
export const WIRE_CONSOLE_PATH = "/v1/console";

/** The header every mutation takes, so a retry after a wifi blip is not a
 *  second deal (section 5.2). Replaying a key returns the first result, or
 *  `idempotent_replay` when the first is still in flight. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * The wire's one compatibility rule, stated as a type so it can be cited.
 *
 * Every field not listed in these types is IGNORED by receivers, so either
 * end may add fields without a version bump, exactly as the Live Link rules
 * (section 6.1). A bump is for a field that CHANGES meaning or disappears.
 */
export interface WireEnvelopeRules {
  /** Always {@link WIRE_VERSION}. */
  wire: string;
}

/** An ISO 8601 instant in UTC (`2026-09-05T14:32:11.204Z`). Times on the wire
 *  are strings, never epoch numbers, because a journal a producer reads and a
 *  clock a bridge fires from should not disagree about a timezone. */
export type IsoTimestamp = string;

/** A party: the durable identity that holds a flow. An opaque ULID minted by
 *  the server, unique per installation, and the flow id as well (7.1). */
export type PartyId = string;

/** A visit: a party's presence in one run (5.4). Distinct from the party id
 *  because a party may visit many runs and the console lists them apart. */
export type VisitId = string;

/** A venue: the physical place, one per server. It owns the LOCATIONS on its
 *  plan and the STATIONS with keys, above any installation, and it hosts one
 *  or more installations at once (4a). */
export type VenueId = string;

/** A location: a position on the venue's plan with a printed code. A placard
 *  IS a location, not a station: it has no hardware, no key and no kind, and
 *  its QR says only where it is (4a). */
export type LocationId = string;

/** A station: hardware with a key that presents hands to a party (5.7). The
 *  key is a VENUE key: one station can serve any installation the venue is
 *  running, and which story it shows is decided per party at the handshake
 *  (4a). */
export type StationId = string;

/** A run: one continuous playing of an installation (section 2). */
export type RunId = string;

/** A principal: every non-party thing that talks to the server (7.5). */
export type PrincipalId = string;

/** An installation: one story running at the venue, owning its own bundle
 *  versions, parties, durable state and runs. A venue hosts several at once,
 *  so the family story and the after-dark story share the walls and share
 *  nothing else (section 2, 4a). */
export type InstallationId = string;

/** A credential record. The credential's SECRET (a token, an external ref) is
 *  never this id; the id is what a console revokes or moves. */
export type CredentialId = string;

/** A zone: a named place on the INSTALLATION's map, from the bundle's `maps`
 *  block. Presence is reported as a venue {@link LocationId}, and the zone is
 *  what that installation's map derives from it, when its map covers it at
 *  all (5.7, 4a). */
export type ZoneId = string;

/** A message (6.7). */
export type MessageId = string;

/** A staged or live build of the project's bundle (section 9). */
export type BuildId = string;

/** A revision of the project's source, as the server's pull and push count
 *  them (9.1). Revision 1 is the seed. */
export type RevisionId = string;

/** A gameId: the author-facing address of a hand, box, card, outcome or tag.
 *  Internal ids never cross the wire (6.3). */
export type GameId = string;

/** A property's address, as `listProperties()` prints it: `world.time_show`,
 *  `story.visits`, `deck.wares.name` (6.3). */
export type PropertyPath = string;

/** The house flow's id: the venue's own flow, never a player's (5.5). */
export const HOUSE_FLOW = "house";

/** What an event or a command is tagged with: a party's flow, or the house. */
export type FlowRef = PartyId | "house";

/**
 * What a station is, which is what decides whose screen it uses (5.7).
 *
 * `placard` is deliberately NOT here. A placard is a LOCATION with a printed
 * code and nothing behind it: no hardware, no key, no presence of its own, and
 * no installation, since its QR names the venue and the location only (4a).
 *
 * `house` is not a station kind in the table either; it is here because the
 * house's own outputs (a wall display, a light desk) are addressed like
 * stations by the messaging and presence routes, and a kind that cannot be
 * named cannot be messaged.
 */
export type StationKind = "fixed" | "crew" | "sign-in" | "house";

/** What a principal may do (7.5). One person with two roles is two
 *  principals, deliberately: which key you connected with IS the mode. */
export type PrincipalRole = "producer" | "designer" | "author" | "station" | "monitor" | "integrator";

/** How a party proves who it is (7.1). The entropy decides where each may be
 *  used: a call sign or an external ref from an anonymous connection is
 *  refused outright. */
export type CredentialKind = "token" | "external" | "callsign";

/** Who did a thing: the journal's attribution, and the actor on a `@world`
 *  write. Identity is not ours to hold, so `label` is the label typed at
 *  pairing and nothing more (7.5). */
export interface Actor {
  /** The kind of thing that acted. `scheduler` is the cue list, `system` is
   *  the server itself (a sweep, an idle close). */
  kind: "party" | "station" | "producer" | "crew" | "external" | "scheduler" | "system";
  /** The acting party, station, principal or bridge id, when there is one. */
  id?: string;
  /** What a producer sees: a call sign, a station label, a principal's label. */
  label?: string;
}

/** The build a run is pinned to (section 9), as `content.{project, version,
 *  hash}` records it. Drift in any of the three is reported, never tolerated
 *  silently (4.9). */
export interface BuildIdentity {
  /** The project id. A bundle whose project differs from the installation's
   *  is refused at install. */
  project: string;
  /** The author's version string from the project file. */
  version: string;
  /** The compiled bundle's content hash. */
  hash: string;
}

/** Paging in: the cursor from the previous page, and how many to return. */
export interface PageRequest {
  /** Opaque; the `next` of the previous page. Absent means the first page. */
  cursor?: string;
  /** Server-clamped. Absent takes the server's default. */
  limit?: number;
}

/** Paging out. `next` absent means this was the last page. */
export interface Page<T> {
  items: T[];
  /** Feed back as {@link PageRequest.cursor} to continue. */
  next?: string;
}
