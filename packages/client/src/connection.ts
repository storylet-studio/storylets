// ---------------------------------------------------------------------------
// A connection: one bearer, one stream, and the verbs that bearer is allowed.
//
// The wire gives two bearers and they are not the same thing (6.4): a STATION
// KEY is hardware the venue owns, and it VOUCHES, so it may mint parties,
// resolve a call sign, issue credentials and report presence. A PARTY TOKEN is
// a phone, and it HOLDS: it may scan a placard, pick a story and claim its own
// pocket, and nothing else.
//
// So there are two interfaces here rather than one with half its methods
// throwing. A crew view written against `StationConnection` cannot call
// `chooseInstallation` by accident, and a companion page written against
// `PartyConnection` cannot ask for someone else's credentials. The shared half
// (hello, the stream, visits, the world) is common to both.
// ---------------------------------------------------------------------------

import type {
  AckMessageResponse, AttachAtLocationResponse, ChooseInstallationResponse, ClaimPartyRequest,
  ClaimPartyResponse, GetWorldResponse, HandshakeRequest, HandshakeResponse, HelloResponse,
  InstallationId, IssueCredentialRequest, IssueCredentialResponse, ListMessagesResponse, LocationId,
  MessageId, MessageView, MintPartyRequest, MintPartyResponse, OpenVisitRequest, OpenVisitResponse,
  PartyId, SendMessageRequest, SendMessageResponse, SetPresenceRequest, SetPresenceResponse,
  VenueId, VisitId, WireEvent,
} from "@storylet-studio/wire";
import { ClientError, safely } from "./errors.js";
import type { CommandQueue, Timers } from "./queue.js";
import { createQueue } from "./queue.js";
import { createStream } from "./stream.js";
import type { ConnectionState, EventSourceCtor, Stream } from "./stream.js";
import { seg } from "./transport.js";
import type { Bearer, Transport } from "./transport.js";
import { createVisit } from "./visit.js";
import type { Visit, VisitInternals } from "./visit.js";

/** Everything from both, once each, oldest first. The stream and the catch-up
 *  overlap by design (a reconnect replays the ring buffer AND asks what it
 *  missed), so the id decides, and the later copy wins because it is the one
 *  that may carry acks. */
const mergeMessages = (held: MessageView[], arrived: MessageView[]): MessageView[] => {
  const by = new Map<MessageId, MessageView>();
  for (const message of [...held, ...arrived]) by.set(message.id, message);
  return [...by.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
};

/** What a handshake, an attach or an open hands back: the wire's own response,
 *  and the visit state machine already seeded from it. */
export interface Attached<R> {
  response: R;
  visit: Visit;
}

/** The messages desk. Delivery rides the stream; `list` is the catch-up a
 *  device that reconnects needs, and `send` is the help call a performer makes
 *  (wire 6.7). */
export interface MessageDesk {
  /** Everything seen this session, oldest first. */
  readonly all: MessageView[];
  /**
   * The catch-up read. `since` MERGES what comes back into what this
   * connection has already seen; without it the answer replaces the lot.
   *
   * The two are different questions and a handset asks both. `list()` is
   * "what is there", which a device asks once on waking. `list(since)` is
   * "what did I miss", which a device asks after a blip, and answering it by
   * replacing would empty the tray of everything older than the outage: a
   * performer who reconnected would watch the control room's last half hour
   * disappear, which is the opposite of what degraded mode promises (spec 17
   * item 2). Merged by id, oldest first, so a message delivered twice - once
   * on the stream, once in the catch-up - appears once.
   */
  list(since?: string): Promise<MessageView[]>;
  ack(id: MessageId): Promise<AckMessageResponse>;
  send(req: SendMessageRequest): Promise<SendMessageResponse>;
  subscribe(listener: (messages: MessageView[]) => void): () => void;
}

/** Everything both bearers can do. */
export interface Connection {
  /** What the server is, right now, to this bearer. */
  hello(): Promise<HelloResponse>;
  /** `@world` as this bearer may read it, with the three clocks. */
  world(prefix?: string): Promise<GetWorldResponse>;
  /** Open or resume a visit for a party this bearer already knows. */
  openVisit(req: OpenVisitRequest): Promise<Attached<OpenVisitResponse>>;
  /** Make a transient party permanent: issuing the keepsake IS the claim. A
   *  kiosk or a companion page claims with what it has; a sign-in station has
   *  hardware behind it (spec 7.1). */
  claim(partyId: PartyId, req: Omit<ClaimPartyRequest, "partyId">): Promise<ClaimPartyResponse>;
  /** The visit this connection is driving, once there is one. */
  readonly visit: Visit | undefined;
  readonly messages: MessageDesk;
  /** What the stream is doing, and whether the screen is being held. */
  readonly connection: ConnectionState;
  readonly held: boolean;
  readonly heldReason: string | undefined;
  /** The server's REFUSAL of this bearer, when there is one: the stream's
   *  ticket was answered with `unknown_credential`, `revoked`, `wrong_role`.
   *  Set instead of degraded mode, never as well as it, because the two say
   *  opposite things to the person holding the phone: a hold says wait, and a
   *  refusal says this credential is not the one. A front-end showing the
   *  refusal's own message should leave its connection banner alone (spec 17
   *  item 2). Cleared the moment a stream opens. */
  readonly refusal: ClientError | undefined;
  /** Told on every connection-state change, and once immediately. */
  subscribe(listener: (state: ConnectionState, held: boolean, reason?: string) => void): () => void;
  /** Every event this bearer receives, raw, for a front-end that wants more
   *  than the visit gives it (a house display mirroring `cue`, a crew screen
   *  watching colleagues' `presence`). */
  on(listener: (event: WireEvent) => void): () => void;
  /** Stop: the stream closes, held commands are refused, listeners go. */
  close(): void;
}

/** A station key. It vouches, so it may do the things that need a person or a
 *  venue behind them. */
export interface StationConnection extends Connection {
  /** Resolve a credential and attach THIS station to the party's visit. */
  handshake(credential: HandshakeRequest): Promise<Attached<HandshakeResponse>>;
  /** The device scanned the code on a wall. A crew handset uses this to be
   *  where it is; the same route serves a phone (spec 7.2). */
  attachAtLocation(venue: VenueId, location: LocationId): Promise<AttachAtLocationResponse>;
  /** Mint a transient party in a story. Nothing is asked for and nothing about
   *  a person is stored (spec 7.1). */
  mintParty(req: MintPartyRequest): Promise<MintPartyResponse>;
  /** Another credential for the same party: a wristband per member, a day
   *  pass, a replacement for a lost one. */
  issueCredential(partyId: PartyId, req: Omit<IssueCredentialRequest, "partyId">): Promise<IssueCredentialResponse>;
  /** Say where this device is. A LOCATION, never a zone: a device knows one
   *  and a zone is a story's word for it (wire 6.4). */
  setPresence(req: SetPresenceRequest): Promise<SetPresenceResponse>;
}

/** A party token: a companion phone, holding its own credential and nothing
 *  else. */
export interface PartyConnection extends Connection {
  /** The phone scanned a placard. Either it is routed into one story, or it is
   *  asked which: both are 200s, which is why the wire has no
   *  `choose_installation` error code.
   *
   *  A phone that held NOTHING scans anonymously, the server mints a transient
   *  party, and the token rides back with the attach (wire 7.1). This
   *  connection ADOPTS it: every later call is made as that party, which is
   *  the difference between a walk-up that works and one that 401s on its own
   *  first deal. */
  atLocation(venue: VenueId, location: LocationId): Promise<AttachAtLocationResponse>;
  /** The visitor picked a story from the chooser. The choice mints the party
   *  there and attaches, and the minted token is adopted as `atLocation`'s
   *  is. */
  chooseInstallation(venue: VenueId, location: LocationId, installation: InstallationId): Promise<Attached<ChooseInstallationResponse>>;
  /** Take the keepsake, and BECOME it.
   *
   *  Issuing a permanent credential IS the claim (spec 7.1), so the credential
   *  it issues is this phone's from that moment: adopted exactly as a first
   *  scan's minted token is, and announced through {@link PartyConnection.onToken}
   *  so a page keeps one credential in one place. A phone that claimed and
   *  went on holding its day pass is refused on the next run's first scan
   *  (7.3), with the pocket it just decided to keep on the wrong side of the
   *  refusal. */
  claim(partyId: PartyId, req: Omit<ClaimPartyRequest, "partyId">): Promise<ClaimPartyResponse>;
  /** The token this phone is holding NOW: the one it was built with, the one
   *  a scan minted for it, or the keepsake its own claim issued. Undefined
   *  before any of them, which is the honest answer for a phone that has never
   *  been here. */
  readonly token: string | undefined;
  /** Told whenever a scan or a choice mints a token, and NOT for the one this
   *  connection was built with. A companion page persists it here: the token
   *  is the only thing worth remembering, and the moment it arrives is the
   *  only moment it is on the wire (wire 7.1). */
  onToken(listener: (token: string) => void): () => void;
}

export interface ConnectionDeps {
  transport: Transport;
  bearer: Bearer;
  EventSource?: EventSourceCtor;
  timers?: Timers;
  key(): string;
  /** Open the stream straight away. A test that only wants the HTTP verbs
   *  passes false and stays silent. */
  stream?: boolean;
}

/** What the two wrappers below need from the shared body, and what a
 *  front-end must never see: the bearer, the queue and the visit factory. */
interface ConnectionInternals {
  transport: Transport;
  /** A FUNCTION, not the value: a party connection may adopt a minted token
   *  mid-life, and a wrapper that had destructured the string would go on
   *  calling as whoever it used to be. */
  bearer(): Bearer;
  queue: CommandQueue;
  key(): string;
  adopt<R>(response: R, seed: Parameters<typeof createVisit>[1]): Attached<R>;
  /** Become this party: the bearer for every later call, a stream reopened as
   *  the new principal, and the listeners told so a page can persist it. */
  adoptToken(token: string): void;
  onToken(listener: (token: string) => void): () => void;
}

/** The shared body of both connections. */
function createConnection(deps: ConnectionDeps): { conn: Connection; raw: ConnectionInternals } {
  const { transport } = deps;
  // MUTABLE, and read live everywhere below: a walk-up scan mints the party
  // this connection then IS (spec 7.1). Every call in this file closes over
  // the variable rather than a copy, so adoption is one assignment.
  let bearer: Bearer = deps.bearer;
  let state: ConnectionState = deps.stream === false ? "disconnected" : "connecting";
  let queueHeld = false;
  let queueReason: string | undefined;
  let current: Visit | undefined;
  let refusal: ClientError | undefined;
  let closed = false;

  const stateListeners = new Set<(s: ConnectionState, held: boolean, reason?: string) => void>();
  const eventListeners = new Set<(e: WireEvent) => void>();
  const messageListeners = new Set<(m: MessageView[]) => void>();
  const tokenListeners = new Set<(t: string) => void>();
  let seen: MessageView[] = [];

  /** Held means "what is on screen is not confirmed": the stream is away, or a
   *  command is waiting to go out. Two causes, one flag, because a front-end
   *  has one banner. */
  const heldNow = (): { state: ConnectionState; held: boolean; reason?: string } => {
    const held = queueHeld || state === "held";
    const reason = state === "held" ? "the connection to the server dropped" : queueReason;
    return { state, held, ...(held && reason !== undefined ? { reason } : {}) };
  };

  const announce = (): void => {
    const now = heldNow();
    for (const l of stateListeners) safely(() => l(now.state, now.held, now.reason));
    (current as (Visit & VisitInternals) | undefined)?.__touch();
  };

  const queue: CommandQueue = createQueue({
    transport,
    ...(deps.timers !== undefined ? { timers: deps.timers } : {}),
    onHeld: (held, reason) => {
      queueHeld = held;
      queueReason = held ? reason : undefined;
      announce();
    },
  });

  const deliver = (event: WireEvent): void => {
    if (event.type === "message") {
      // A replayed ring buffer can hand the same message over twice; the tray
      // should not show it twice.
      if (!seen.some((m) => m.id === event.message.id)) {
        seen = [...seen, event.message];
        for (const l of messageListeners) safely(() => l(seen));
      }
    }
    (current as (Visit & VisitInternals) | undefined)?.__apply(event);
    for (const l of eventListeners) safely(() => l(event));
  };

  let stream: Stream | undefined;
  if (deps.stream !== false) {
    stream = createStream({
      transport,
      bearer: () => bearer,
      ...(deps.EventSource !== undefined ? { EventSource: deps.EventSource } : {}),
      ...(deps.timers !== undefined ? { timers: deps.timers } : {}),
      onEvent: deliver,
      // Set BEFORE the state change that follows it, so the first frame a
      // subscriber is given already carries the reason.
      onRefused: (error) => { refusal = error; },
      onState: (next) => {
        state = next;
        // The stream is back, so the network is back: send what was held,
        // rather than waiting out a backoff that has already been disproved.
        if (next === "live") queue.drain();
        announce();
      },
      onResync: () => {
        // Whatever is held may have missed anything. Re-reading the board is
        // the wire's own instruction for `replay-lost`, and a resume after an
        // outage is the same situation without the courtesy of being told.
        void current?.refresh().catch(() => { /* still away: the hold stands */ });
      },
    });
    stream.start();
  }

  /** The walk-up's one assignment. The stream is reopened rather than left to
   *  its backoff, because until now it could not mint a ticket at all: an
   *  anonymous phone has no principal, and a visitor at a wall should not wait
   *  out a ladder that starts at a second. */
  const adoptToken = (token: string): void => {
    if (closed || token === "" || token === bearer) return;
    bearer = token;
    // Whoever was refused, this client is not them any more.
    refusal = undefined;
    stream?.restart();
    for (const l of tokenListeners) safely(() => l(token));
  };

  const adopt = <R>(response: R, seed: Parameters<typeof createVisit>[1]): Attached<R> => {
    current?.close();
    current = createVisit({ transport, queue, bearer: () => bearer, key: deps.key, connection: heldNow }, seed);
    return { response, visit: current };
  };

  const messages: MessageDesk = {
    get all() { return seen; },
    async list(since) {
      const res = await transport.send<ListMessagesResponse>(bearer, {
        method: "GET",
        path: "/messages",
        query: { since },
      });
      seen = since === undefined ? res.messages : mergeMessages(seen, res.messages);
      for (const l of messageListeners) safely(() => l(seen));
      return seen;
    },
    ack(id) {
      return queue.send<AckMessageResponse>(bearer, {
        method: "POST",
        path: `/messages/${seg(id)}/ack`,
        body: { id },
        idempotencyKey: deps.key(),
      });
    },
    send(req) {
      return queue.send<SendMessageResponse>(bearer, {
        method: "POST",
        path: "/messages",
        body: req,
        idempotencyKey: deps.key(),
      });
    },
    subscribe(listener) {
      messageListeners.add(listener);
      safely(() => listener(seen));
      return () => { messageListeners.delete(listener); };
    },
  };

  const conn: Connection = {
    hello() {
      return transport.send<HelloResponse>(bearer, { method: "POST", path: "/hello", body: {} });
    },
    world(prefix) {
      return transport.send<GetWorldResponse>(bearer, { method: "GET", path: "/world", query: { prefix } });
    },
    async openVisit(req) {
      const res = await queue.send<OpenVisitResponse>(bearer, {
        method: "POST",
        path: "/visits",
        body: req,
        idempotencyKey: deps.key(),
      });
      return adopt(res, { view: res.visit, ...(res.board !== undefined ? { board: res.board } : {}) });
    },
    claim(partyId, req) {
      return queue.send<ClaimPartyResponse>(bearer, {
        method: "POST",
        path: `/parties/${seg(partyId)}/claim`,
        body: { partyId, ...req },
        idempotencyKey: deps.key(),
      });
    },
    get visit() { return current; },
    messages,
    get connection() { return heldNow().state; },
    get held() { return heldNow().held; },
    get heldReason() { return heldNow().reason; },
    get refusal() { return refusal; },
    subscribe(listener) {
      stateListeners.add(listener);
      const now = heldNow();
      safely(() => listener(now.state, now.held, now.reason));
      return () => { stateListeners.delete(listener); };
    },
    on(listener) {
      eventListeners.add(listener);
      return () => { eventListeners.delete(listener); };
    },
    close() {
      if (closed) return;
      closed = true;
      stream?.close();
      queue.close();
      current?.close();
      stateListeners.clear();
      eventListeners.clear();
      messageListeners.clear();
      tokenListeners.clear();
    },
  };

  return {
    conn,
    raw: {
      transport,
      bearer: () => bearer,
      queue,
      key: deps.key,
      adopt,
      adoptToken,
      onToken(listener) {
        tokenListeners.add(listener);
        return () => { tokenListeners.delete(listener); };
      },
    },
  };
}

// The two bearers, each the shared connection PLUS its own verbs.
//
// `Object.create` rather than a spread: the shared object's `visit`,
// `connection`, `held` and `heldReason` are getters, and a spread would copy
// the values they happened to have at construction time, freezing every
// front-end on "connecting" for ever. A prototype chain keeps them live.

export function createStationConnection(deps: ConnectionDeps): StationConnection {
  const { conn, raw } = createConnection(deps);
  const { bearer, queue, key, adopt } = raw;
  // A station key is HARDWARE the venue owns, so nothing here adopts: a scan
  // at a wall may mint a party and hand its token back, and that token is the
  // PARTY's (wire 7.1). This device stays the device it was provisioned as.
  return Object.assign(Object.create(conn) as Connection, {
    async handshake(credential: HandshakeRequest): Promise<Attached<HandshakeResponse>> {
      const res = await queue.send<HandshakeResponse>(bearer(), {
        method: "POST",
        path: "/handshake",
        body: credential,
        idempotencyKey: key(),
      });
      return adopt(res, {
        view: { visit: res.visitId, party: res.partyId, installation: res.installation },
        board: res.board,
      });
    },
    async attachAtLocation(venue: VenueId, location: LocationId): Promise<AttachAtLocationResponse> {
      const res = await queue.send<AttachAtLocationResponse>(bearer(), {
        method: "POST",
        path: `/at/${seg(venue)}/${seg(location)}`,
        body: { venue, location },
        idempotencyKey: key(),
      });
      if (res.outcome === "attached") adopt(res, { view: res.visit, board: res.board });
      return res;
    },
    mintParty(req: MintPartyRequest): Promise<MintPartyResponse> {
      return queue.send<MintPartyResponse>(bearer(), {
        method: "POST",
        path: "/parties",
        body: req,
        idempotencyKey: key(),
      });
    },
    issueCredential(partyId: PartyId, req: Omit<IssueCredentialRequest, "partyId">): Promise<IssueCredentialResponse> {
      return queue.send<IssueCredentialResponse>(bearer(), {
        method: "POST",
        path: `/parties/${seg(partyId)}/credentials`,
        body: { partyId, ...req },
        idempotencyKey: key(),
      });
    },
    setPresence(req: SetPresenceRequest): Promise<SetPresenceResponse> {
      return queue.send<SetPresenceResponse>(bearer(), {
        method: "POST",
        path: "/stations/me/presence",
        body: req,
        idempotencyKey: key(),
      });
    },
  }) as StationConnection;
}

/**
 * The bearer inside a keepsake.
 *
 * The wire hands a claim's keepsake back as `qr`, the URL to print or
 * photograph, and the spec defines that URL as `https://<server>/p/<token>`
 * (7.1): the credential is its last segment. That is the same reading the
 * companion page makes of its own arrival URL, so it is a format both ends
 * already depend on rather than a guess about one. A value with no `/p/` in it
 * is taken as the token itself, so a server that hands the bearer over plainly
 * needs no second rule here.
 */
const keepsakeToken = (res: ClaimPartyResponse): string | undefined => {
  if (typeof res.qr !== "string" || res.qr === "") return undefined;
  const match = /\/p\/([^/?#]+)/.exec(res.qr);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : res.qr;
};

export function createPartyConnection(deps: ConnectionDeps): PartyConnection {
  const { conn, raw } = createConnection(deps);
  const { bearer, queue, key, adopt, adoptToken, onToken } = raw;
  const party = Object.assign(Object.create(conn) as Connection, {
    async claim(partyId: PartyId, req: Omit<ClaimPartyRequest, "partyId">): Promise<ClaimPartyResponse> {
      const res = await conn.claim(partyId, req);
      // A KEEPSAKE ONLY. A call sign is said out loud and a wristband is worn;
      // neither is a bearer this phone can hold, and the day pass stays the
      // credential until one of the venue's own stations resolves the other.
      if (req.kind === "token") {
        const token = keepsakeToken(res);
        if (token !== undefined) adoptToken(token);
      }
      return res;
    },
    async atLocation(venue: VenueId, location: LocationId): Promise<AttachAtLocationResponse> {
      const res = await queue.send<AttachAtLocationResponse>(bearer(), {
        method: "POST",
        path: `/at/${seg(venue)}/${seg(location)}`,
        body: { venue, location },
        idempotencyKey: key(),
      });
      if (res.outcome === "attached") {
        // BEFORE the visit is made, so the visit is born holding the bearer
        // its own deals and plays must carry.
        if (res.token !== undefined) adoptToken(res.token);
        adopt(res, { view: res.visit, board: res.board });
      }
      return res;
    },
    async chooseInstallation(
      venue: VenueId,
      location: LocationId,
      installation: InstallationId,
    ): Promise<Attached<ChooseInstallationResponse>> {
      const res = await queue.send<ChooseInstallationResponse>(bearer(), {
        method: "POST",
        path: `/at/${seg(venue)}/${seg(location)}/choose`,
        body: { venue, location, installation },
        idempotencyKey: key(),
      });
      if (res.token !== undefined) adoptToken(res.token);
      return adopt(res, { view: res.visit, board: res.board });
    },
    onToken,
  });
  // `defineProperty` rather than a field in the literal above, for the reason
  // the prototype chain is one: a copied value would freeze a phone on the
  // token it did not have when it was built.
  Object.defineProperty(party, "token", { get: () => bearer(), enumerable: true });
  return party as PartyConnection;
}

/** Thrown when a front-end asks a visit-shaped question before there is a
 *  visit. Exported so a reference app can catch it by identity. */
export const noVisit = (): ClientError =>
  new ClientError("unknown_visit", "there is no visit yet: handshake, scan a placard, or open one first", 0);
