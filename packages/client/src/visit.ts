// ---------------------------------------------------------------------------
// A visit, as an observable state machine (spec 12, layer 2).
//
// This is the piece a bespoke kiosk keeps when it throws every pixel away: the
// board and what moves it, the clocks, the properties, the messages, the
// presence, and the five verbs. A front-end subscribes and renders; it never
// asks "is this stale?", because the answer is in the state it was handed.
//
// THE STATE IS A SNAPSHOT, replaced whole and never mutated in place. A
// renderer can therefore compare `prev !== next` on any field and skip work,
// and a listener that keeps a reference to yesterday's state cannot be
// surprised by it changing underneath.
//
// Reads go straight out; MUTATIONS go through the command queue, so a play
// pressed during a blip is held with its key and sent once when the wifi comes
// back (spec 17 item 2). That is the whole of degraded mode from the caller's
// side: `deal()` and `play()` simply take longer, and `state.held` says why.
// ---------------------------------------------------------------------------

import type {
  BoardView, Clocks, DealRequest, DealResponse, DetachStationResponse, GameId,
  GetBoardResponse, GetOutcomesResponse, GetPropertiesResponse, InstallationId, MessageView,
  OutcomeViewWire, ParkVisitResponse, PartyId, PeekResponse, PlayResponse, PresenceView,
  PropertyView, TurnsView, VisitId, VisitView, WireEvent,
} from "@storylet-studio/wire";
import { safely } from "./errors.js";
import type { CommandQueue } from "./queue.js";
import type { ConnectionState } from "./stream.js";
import { seg } from "./transport.js";
import type { Bearer, Transport } from "./transport.js";

/** Everything a front-end draws, in one frozen object. */
export interface VisitState {
  visit: VisitId;
  party?: PartyId;
  installation?: InstallationId;
  /** The cards in each hand this station may show. Kept through a disconnect
   *  on purpose: the last board is better than a blank screen. */
  board: BoardView;
  /** Each box's clock, for a cooldown a front-end wants to show. */
  turns: TurnsView;
  /** The three world clocks as of the last read or event. */
  clocks?: Clocks;
  /** The flow's merged property view, by path. */
  properties: PropertyView[];
  /** This station's presence, when the bearer is a station key. */
  presence?: PresenceView;
  /** Messages addressed to this station, its zone, its kind, or everyone. */
  messages: MessageView[];
  /** What the stream is doing, for the connection banner. */
  connection: ConnectionState;
  /** DEGRADED MODE. True when what is on screen is being held rather than
   *  confirmed: the stream is away, or a command is waiting to be sent. Every
   *  reference front-end must render this (spec 17 item 2). */
  held: boolean;
  /** Why, in words a front-end may show as it stands. */
  heldReason?: string;
  /** How many commands are waiting to go out. */
  queued: number;
  /** Set once the visit is parked or closed: the verbs stop working and a
   *  front-end should go back to its first screen. */
  closed: boolean;
}

export interface Visit {
  readonly id: VisitId;
  /** The current snapshot. Never mutated: a new object per change. */
  readonly state: VisitState;
  readonly board: BoardView;
  readonly turns: TurnsView;
  readonly clocks: Clocks | undefined;
  readonly properties: PropertyView[];
  readonly presence: PresenceView | undefined;
  readonly messages: MessageView[];

  /** Availability is evaluated at the moment of the ask, so this is a read a
   *  front-end repeats rather than a value it caches (wire 6.4). */
  outcomes(card: GameId, hand: GameId): Promise<OutcomeViewWire[]>;
  deal(hands?: GameId[]): Promise<DealResponse>;
  play(card: GameId, outcome: GameId, hand: GameId): Promise<PlayResponse>;
  peek(box: GameId, criteria?: Record<GameId, GameId>, n?: number): Promise<PeekResponse>;
  /** Leave. The flow is saved, the stations detached, the claims released. */
  park(): Promise<ParkVisitResponse>;
  /** The performer moves on: detach this station, leave the visit open. */
  detach(): Promise<DetachStationResponse>;
  /** Re-read the board and the clocks. Called for you on a resume and on
   *  `replay-lost`; public because a front-end returning from the background
   *  may want it too. */
  refresh(): Promise<void>;
  /** Re-read the flow's properties. Not automatic: a play's `writes` keep the
   *  cached view current without a round trip. */
  refreshProperties(): Promise<void>;
  /** Called with every new snapshot, and once immediately with the current
   *  one, so a subscriber never has to ask for the first frame. Returns the
   *  unsubscribe. A listener that throws is caught: never into the host. */
  subscribe(listener: (state: VisitState) => void): () => void;
  /** Stop watching. Does not park: a page that reloads wants the visit left
   *  alone. */
  close(): void;
}

export interface VisitDeps {
  transport: Transport;
  queue: CommandQueue;
  bearer: Bearer;
  /** Mint an `Idempotency-Key`. One per command, reused on retry. */
  key(): string;
  /** The connection state, read at snapshot time so the visit's own `held`
   *  agrees with the banner's. */
  connection(): { state: ConnectionState; held: boolean; reason?: string };
}

/** Build a visit around what a handshake, an attach or an open already
 *  returned, so the first screen needs no second round trip. */
export function createVisit(deps: VisitDeps, seed: {
  view: VisitView | { visit: VisitId; party?: PartyId; installation?: InstallationId };
  board?: BoardView;
  turns?: TurnsView;
  clocks?: Clocks;
}): Visit {
  const id = seed.view.visit;
  const listeners = new Set<(state: VisitState) => void>();
  let watching = true;

  let state: VisitState = freeze({
    visit: id,
    ...(seed.view.party !== undefined ? { party: seed.view.party } : {}),
    ...(seed.view.installation !== undefined ? { installation: seed.view.installation } : {}),
    board: seed.board ?? {},
    turns: seed.turns ?? {},
    ...(seed.clocks !== undefined ? { clocks: seed.clocks } : {}),
    properties: [],
    messages: [],
    connection: deps.connection().state,
    held: deps.connection().held,
    ...(deps.connection().reason !== undefined ? { heldReason: deps.connection().reason } : {}),
    queued: 0,
    closed: false,
  });

  function freeze(next: VisitState): VisitState {
    return Object.freeze(next);
  }

  /** Replace the snapshot and tell everyone. The connection fields are read
   *  here rather than pushed in, so there is one place they can disagree and
   *  it is this one. */
  function change(patch: Partial<VisitState>): void {
    const conn = deps.connection();
    const next: VisitState = {
      ...state,
      ...patch,
      connection: conn.state,
      held: conn.held,
      queued: deps.queue.depth,
    };
    if (conn.reason !== undefined) next.heldReason = conn.reason;
    else delete next.heldReason;
    state = freeze(next);
    for (const l of listeners) safely(() => l(state));
  }

  /** The stream's events, filtered to this visit. The fan-out rule means a
   *  station never receives another party's per-flow events, but a monitor
   *  stream receives every one, so the flow is checked here as well: a client
   *  that renders someone else's board is the bug the rule exists to stop. */
  function apply(event: WireEvent): void {
    if (!watching) return;
    switch (event.type) {
      case "board": {
        if (event.visit !== undefined && event.visit !== id) return;
        if (event.visit === undefined && state.party !== undefined && event.flow !== state.party) return;
        change({ board: event.board, ...(event.turns !== undefined ? { turns: event.turns } : {}) });
        return;
      }
      case "visit": {
        if (event.visit !== id) return;
        if (event.phase === "parked" || event.phase === "closed") change({ closed: true });
        return;
      }
      case "message": {
        change({ messages: [...state.messages, event.message] });
        return;
      }
      case "presence": {
        if (state.presence !== undefined && event.presence.station !== state.presence.station) return;
        change({ presence: event.presence });
        return;
      }
      case "world": {
        // A `@world` write a station can render without a re-read: the path is
        // resolved and the value is the new one.
        const properties = state.properties.map((p) => (p.path === event.path ? { ...p, value: event.value } : p));
        change({ properties });
        return;
      }
      default:
        return;
    }
  }

  const send = <T>(path: string, body: unknown): Promise<T> =>
    deps.queue.send<T>(deps.bearer, { method: "POST", path, body, idempotencyKey: deps.key() });

  const visit: Visit = {
    id,
    get state() { return state; },
    get board() { return state.board; },
    get turns() { return state.turns; },
    get clocks() { return state.clocks; },
    get properties() { return state.properties; },
    get presence() { return state.presence; },
    get messages() { return state.messages; },

    async outcomes(card, hand) {
      const res = await deps.transport.send<GetOutcomesResponse>(deps.bearer, {
        method: "GET",
        path: `/visits/${seg(id)}/cards/${seg(card)}/outcomes`,
        query: { hand },
      });
      return res.outcomes;
    },

    async deal(hands) {
      const body: DealRequest = { visitId: id, ...(hands !== undefined ? { hands } : {}) };
      const res = await send<DealResponse>(`/visits/${seg(id)}/deal`, body);
      change({ board: res.board, ...(res.turns !== undefined ? { turns: res.turns } : {}) });
      return res;
    },

    async play(card, outcome, hand) {
      const res = await send<PlayResponse>(`/visits/${seg(id)}/play`, { visitId: id, card, outcome, hand });
      // The writes come back resolved, so the property view stays current
      // without a second read. A path this client has never seen is appended
      // rather than dropped: the flow may have declared it since.
      let properties = state.properties;
      if (res.writes && res.writes.length > 0) {
        properties = state.properties.map((p) => {
          const write = res.writes?.find((w) => w.path === p.path);
          return write ? { ...p, value: write.value } : p;
        });
      }
      change({
        board: res.board,
        ...(res.turns !== undefined ? { turns: res.turns } : {}),
        properties,
      });
      return res;
    },

    peek(box, criteria, n) {
      return send<PeekResponse>(`/visits/${seg(id)}/peek`, {
        visitId: id,
        box,
        ...(criteria !== undefined ? { criteria } : {}),
        ...(n !== undefined ? { n } : {}),
      });
    },

    async park() {
      const res = await deps.queue.send<ParkVisitResponse>(deps.bearer, {
        method: "DELETE",
        path: `/visits/${seg(id)}`,
        idempotencyKey: deps.key(),
      });
      change({ closed: true });
      return res;
    },

    async detach() {
      const res = await deps.queue.send<DetachStationResponse>(deps.bearer, {
        method: "DELETE",
        path: `/visits/${seg(id)}/stations/me`,
        idempotencyKey: deps.key(),
      });
      change({ closed: true });
      return res;
    },

    async refresh() {
      const res = await deps.transport.send<GetBoardResponse>(deps.bearer, {
        method: "GET",
        path: `/visits/${seg(id)}/board`,
      });
      change({
        board: res.board,
        ...(res.turns !== undefined ? { turns: res.turns } : {}),
        ...(res.clocks !== undefined ? { clocks: res.clocks } : {}),
      });
    },

    async refreshProperties() {
      const res = await deps.transport.send<GetPropertiesResponse>(deps.bearer, {
        method: "GET",
        path: `/visits/${seg(id)}/properties`,
      });
      change({ properties: res.properties });
    },

    subscribe(listener) {
      listeners.add(listener);
      safely(() => listener(state));
      return () => { listeners.delete(listener); };
    },

    close() {
      watching = false;
      listeners.clear();
    },
  };

  // Handed back to the connection, which owns the stream and fans events out.
  (visit as Visit & { __apply: (e: WireEvent) => void }).__apply = apply;
  (visit as Visit & { __touch: () => void }).__touch = () => change({});
  return visit;
}

/** The two hooks the connection uses to drive a visit. Not on the public
 *  interface: a front-end never feeds its own events in. */
export interface VisitInternals {
  __apply(event: WireEvent): void;
  /** Re-emit the snapshot because something OUTSIDE the visit changed: the
   *  connection state, or the queue's depth. */
  __touch(): void;
}
