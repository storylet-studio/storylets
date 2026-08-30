// ---------------------------------------------------------------------------
// Live Link (design/live-link.md): the game-side client.
//
// Joins a running game to Storyletter over a loopback WebSocket. Two things
// travel on it: the flow's trace stream and board snapshots go UP, so the
// editor's Board can show the game's run instead of its own (observe-only: the
// editor never drives the game); freshly compiled bundles come DOWN after a
// save, so the run picks up the edit without restarting (applyLiveBundle in
// refresh.ts does the swap).
//
// Wire protocol `storyletengine/debug@1` (one JSON object per message):
//   hello : { t:"hello", v:2, build, project?, boxes?, flows:[id...] }
//                                                           - on open, and again on setBuild
//   flowOpen  / flowClose : { t:"flowOpen"|"flowClose", flow }
//                                                           - a flow appeared or went
//   trace : { t:"trace", flow, event }                      - every TraceEvent any flow emits
//   board : { t:"board", flow, hands:{ hand: [card...] }, turns:{ box: n } }
//                                                           - after hello, and after every deal /
//                                                             play / evict / turns event
//   bundle: { t:"bundle", v:1, build, data }                - EDITOR -> game: the full .storyletsc
//                                                             JSON as a string
// Identity in frames is by gameId (hands, boxes, cards); the trace event is
// the runtime's own object, verbatim, whatever ids it carries.
//
// Patterpad's createDebugLink is the template (Patter play-helpers/debug.ts):
// hello first, frames queue until the socket opens, a missing editor is a
// silent no-op, nothing here ever throws into the game, and no WebSocket
// implementation at all degrades to a no-op handle. `observe(...)` became a
// trace subscription, which is why this one takes an ENGINE: attach(engine)
// subscribes, detach() stops, and a live refresh replaces the flow
// (detach the old one, attach the new one, then setBuild).
//
//   const link = createLiveLink({ build: bundle.content.hash, onBundle: ... });
//   link.attach(engine);   // the ENGINE: the link discovers your flows itself
// ---------------------------------------------------------------------------

import type { Engine, Flow, TraceEvent } from "@storylet-studio/runtime";

/** A minimal structural type for a WebSocket implementation (browsers and
 *  Node 22+ have a global one). */
export interface LiveSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  /** Incoming editor messages (the pushed bundle). Optional so a bare
   *  send-only socket still fits. */
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
}
type LiveSocketCtor = new (url: string) => LiveSocketLike;

export interface LiveLinkOptions {
  /** The running bundle's build identity: pass `bundle.content.hash`. The
   *  editor compares it with its own compiled hash (in sync / stale). */
  build: string;
  /** Optional project name, shown in the editor's connect-chip tooltip. */
  project?: string;
  /** Editor WebSocket URL. Default `ws://127.0.0.1:4472`. */
  url?: string;
  /** A WebSocket constructor to use instead of the global one (tests with a
   *  fake socket, or a host without a global WebSocket). */
  WebSocket?: LiveSocketCtor;
  /** Live refresh: the editor pushed a freshly compiled bundle. `data` is
   *  the .storyletsc JSON; hand it (with your current Engine) to
   *  `applyLiveBundle`, `attach` the engine it returns, then call
   *  `link.setBuild(build)`. Never called with a malformed frame. */
  onBundle?: (msg: { build: string; data: string }) => void;
}

export interface LiveLink {
  /** Start forwarding this ENGINE's trace: every flow's events, each frame
   *  naming the flow it came from, so the editor can follow one participant
   *  and switch. An earlier engine is detached first. Sends a board snapshot
   *  per open flow straight away, queued behind the hello if the socket is
   *  not open yet.
   *
   *  Flows are discovered rather than declared: the link diffs `engine.flows()`
   *  whenever anything happens and emits `flowOpen` / `flowClose` itself. That
   *  is a deliberate departure from Patterplay, whose host calls `FlowOpened`
   *  by hand - it has no engine-level trace tap to hang the diff on and we do,
   *  so the host has nothing to remember and cannot get the editor's flow list
   *  wrong. The one cost: a flow that opens and then does nothing at all is not
   *  announced until the next event anywhere in the run. */
  attach(engine: Engine): void;
  /** Stop forwarding. A refresh replaces the engine, so attach the new one
   *  afterwards. */
  detach(): void;
  /** After applying a pushed bundle: report the build now running (re-hellos
   *  with the new build and a fresh board snapshot, so the editor's chip goes
   *  back to in sync and it stops re-pushing the same bundle). */
  setBuild(build: string): void;
  /** Close the link; every later call is a no-op. */
  close(): void;
}

/** One game-to-editor frame, as the client serialises it. Exported for the
 *  fixture test; hosts never build these by hand. */
export type LiveFrame =
  | { t: "hello"; v: 2; build: string; project?: string; boxes?: string[]; flows: string[] }
  | { t: "flowOpen"; flow: string }
  | { t: "flowClose"; flow: string }
  | { t: "trace"; flow: string; event: TraceEvent }
  | { t: "board"; flow: string; hands: Record<string, string[]>; turns: Record<string, number> };

const OPEN = 1; // WebSocket.OPEN

/** How many frames may wait for a socket that has not opened yet. Generous:
 *  the point of queueing is that a game's first moments are not lost while the
 *  editor's socket is still connecting. */
const QUEUE_CAP = 512;
const DEFAULT_URL = "ws://127.0.0.1:4472";

/** The trace kinds that move the board, and so are followed by a snapshot. */
const BOARD_EVENTS: ReadonlySet<TraceEvent["type"]> = new Set(["deal", "play", "evict", "turns"]);

/** The cheap snapshot: hands by gameId holding card gameIds in dealt order,
 *  and every box's clock by gameId. */
export function boardFrame(flow: Flow): Extract<LiveFrame, { t: "board" }> {
  const id = flow.id;
  const hands: Record<string, string[]> = {};
  for (const [hand, cards] of Object.entries(flow.board())) hands[hand] = cards.map((c) => c.gameId);
  const turns: Record<string, number> = {};
  for (const box of flow.listBoxes()) turns[box.gameId] = box.turn;
  return { t: "board", flow: id, hands, turns };
}

/**
 * Open a Live Link to Storyletter. Returns a handle whose calls are no-ops once
 * the editor disconnects or if it was never listening: safe to leave wired into
 * a shipping build behind a flag.
 */
export function createLiveLink(opts: LiveLinkOptions): LiveLink {
  const url = opts.url ?? DEFAULT_URL;
  const Ctor: LiveSocketCtor | undefined = opts.WebSocket ?? (globalThis as { WebSocket?: LiveSocketCtor }).WebSocket;
  let queue: string[] = [];
  let sock: LiveSocketLike | null = null;
  let closed = false;
  let build = opts.build; // mutable: setBuild() after a live refresh lands
  let engine: Engine | null = null;
  let unsubscribe: (() => void) | null = null;
  // The flows the EDITOR believes are open. Diffed against engine.flows() so
  // flowOpen / flowClose are the link's own business, not the host's.
  let announced = new Set<string>();

  if (!Ctor) {
    // No WebSocket available (no global, none passed): a silent no-op link.
    return { attach() {}, detach() {}, setBuild() {}, close() { closed = true; } };
  }

  const flush = (): void => {
    if (!sock || sock.readyState !== OPEN) return;
    for (const m of queue) { try { sock.send(m); } catch { /* socket went away */ } }
    queue = [];
  };
  const post = (frame: LiveFrame): void => {
    if (closed) return;
    queue.push(JSON.stringify(frame));
    // A cap for the CONNECTING window, where queueing is the point: the hello
    // and the frames a game emits during those first milliseconds have to
    // land. Beyond that many, the editor is not coming - drop the oldest, so
    // what survives is the most recent story rather than the first moments of
    // it. Once the socket has actually closed the queue is dropped outright
    // (see the close listener); this is only the never-opened case.
    if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
    flush();
  };

  // The handshake goes straight to the socket, never through the queue: it
  // must be the first thing the editor reads, ahead of anything queued while
  // the socket was still connecting.
  const liveFlows = (): Flow[] => {
    try { return engine ? engine.flows() : []; } catch { return []; }
  };
  const sendHello = (): void => {
    const flows = liveFlows();
    const hello: LiveFrame = { t: "hello", v: 2, build, flows: flows.map((f) => f.id) };
    if (opts.project !== undefined) hello.project = opts.project;
    const first = flows[0];
    if (first) {
      try { hello.boxes = first.listBoxes().map((b) => b.gameId); } catch { /* mid-swap: no boxes */ }
    }
    // The editor's list starts from the hello, so the diff starts there too.
    announced = new Set(flows.map((f) => f.id));
    try { sock?.send(JSON.stringify(hello)); } catch { /* race: closed immediately */ }
  };
  const postBoard = (flow: Flow): void => {
    try { post(boardFrame(flow)); } catch { /* never into the game */ }
  };
  /** Announce anything that opened or closed since the last look. Runs before
   *  each forwarded event, so a frame never names a flow the editor has not
   *  been told about. */
  const syncFlows = (): void => {
    const now = liveFlows();
    const ids = new Set(now.map((f) => f.id));
    for (const f of now) {
      if (announced.has(f.id)) continue;
      announced.add(f.id);
      post({ t: "flowOpen", flow: f.id });
      postBoard(f);
    }
    for (const id of [...announced]) {
      if (ids.has(id)) continue;
      announced.delete(id);
      post({ t: "flowClose", flow: id });
    }
  };
  const onTrace = (flowId: string, event: TraceEvent): void => {
    try {
      syncFlows();
      post({ t: "trace", flow: flowId, event });
      if (BOARD_EVENTS.has(event.type)) {
        const f = engine?.getFlow(flowId);
        if (f) postBoard(f);
      }
    } catch { /* never into the game */ }
  };

  try {
    sock = new Ctor(url);
    sock.addEventListener("open", () => {
      sendHello();
      flush();
    });
    // Live refresh: the editor pushed a new bundle. The shape is checked here
    // so the host's handler never sees a malformed frame; anything else the
    // editor might send is ignored.
    sock.addEventListener("message", (ev: { data: unknown }) => {
      if (!opts.onBundle || typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        if (msg.t === "bundle" && typeof msg.build === "string" && typeof msg.data === "string") {
          opts.onBundle({ build: msg.build, data: msg.data });
        }
      } catch { /* not for us */ }
    });
    sock.addEventListener("error", () => { /* editor not listening: stay a no-op */ });
    // The socket is gone and this link does not reconnect, so the link is
    // INERT from here rather than merely unable to send. It used to set `sock`
    // to null and nothing else, leaving `closed` false, so every later trace
    // event pushed another string onto a queue nothing would ever drain: one
    // heap allocation per deal, play and write for the rest of the session.
    // Godot and Unity both already stopped at this point; JS and Unreal did
    // not. Found by the pre-release audit, 2026-08-29.
    sock.addEventListener("close", () => { sock = null; closed = true; queue = []; });
  } catch { sock = null; closed = true; } // malformed URL etc.: never throw into the game

  const detach = (): void => {
    unsubscribe?.();
    unsubscribe = null;
    engine = null;
    announced = new Set();
  };

  return {
    attach(next: Engine): void {
      if (closed) return;
      detach();
      engine = next;
      try { unsubscribe = next.subscribeTrace(onTrace); } catch { engine = null; return; }
      // Every open flow's board up front: the editor can show any of them the
      // moment it connects, without waiting for that participant to move.
      announced = new Set(liveFlows().map((f) => f.id));
      for (const f of liveFlows()) postBoard(f);
    },
    detach,
    setBuild(next: string): void {
      if (closed || next === build) return;
      build = next;
      // Re-handshake: the editor re-reads the build, then gets every flow's
      // table as the new engine has it.
      if (sock && sock.readyState === OPEN) {
        sendHello();
        for (const f of liveFlows()) postBoard(f);
      }
    },
    close(): void {
      closed = true;
      detach();
      queue = [];
      try { sock?.close(); } catch { /* already gone */ }
      sock = null;
    },
  };
}
