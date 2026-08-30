// ---------------------------------------------------------------------------
// Live Link (design/live-link.md): the editor-side server.
//
// A loopback WebSocket server in the main process that a running game connects
// to. Two things travel on it: the game's trace stream and board snapshots come
// IN, forwarded to the Board window so it can show the game's run instead of
// its own (observe-only: the editor never drives the game); freshly compiled
// bundles go OUT after a save, so the run picks up the edit without restarting.
//
// Patterpad's debug-link.ts, lifted: one client at a time, a hello before
// anything is honoured, status pushed to the renderer, pushBundle gated on the
// build the client reported. Port 4472, one above Patterpad's, so both editors
// can listen on one machine.
//
// Wire protocol `storyletengine/debug@1` (one JSON object per message):
//   hello : { t:"hello", v:2, build, project?, boxes?, flows:[id...] }
//                                                         - on connect, and again after a pushed bundle lands
//   flowOpen / flowClose : { t:"flowOpen"|"flowClose", flow }
//   trace : { t:"trace", flow, event }                    - a runtime TraceEvent, verbatim
//   board : { t:"board", flow, hands:{ hand: [card...] }, turns:{ box: n } }
//   bundle: { t:"bundle", v:1, build, data }              - SERVER -> client: the full .storyletsc JSON
// ---------------------------------------------------------------------------

import { WebSocketServer, type WebSocket } from "ws";
import { LIVE_LOG_CAP } from "../shared/api.js";
import type { LiveLinkBoard, LiveLinkFrame, LiveLinkSnapshot, LiveLinkStatus, LiveLinkTrace } from "../shared/api.js";

export const LIVE_LINK_PORT = 4472;



export interface LiveLinkServer {
  start(): void;
  stop(): void;
  status(): LiveLinkStatus;
  isOn(): boolean;
  /** What a Board opening mid-run needs: the last board snapshot and the
   *  recent trace, so it has the table at once and a journal to read. */
  snapshot(): LiveLinkSnapshot;
  /** Live refresh: push a freshly compiled bundle to the connected game. No-op
   *  when nothing is connected / handshaken, or when the client already runs
   *  this exact build. The client applies it and re-hellos with the new build,
   *  which brings the chip back to in sync on its own. */
  pushBundle(build: string, data: string): void;
  /** Point the Board at another participant's flow. */
  follow(flowId: string): void;
}

export interface LiveLinkDeps {
  /** The project's current compiled hash, read at handshake to tell a stale
   *  running build from a matching one. */
  currentBuildHash: () => string | null;
  /** A frame for the Board window: a hello (a new run begins; clear what was
   *  shown), a board snapshot, or one trace event. */
  onFrame: (frame: LiveLinkFrame) => void;
  /** Push the latest status to the windows and the menu. */
  onStatus: (status: LiveLinkStatus) => void;
  port?: number;
}

export function createLiveLinkServer(deps: LiveLinkDeps): LiveLinkServer {
  const port = deps.port ?? LIVE_LINK_PORT;
  let wss: WebSocketServer | null = null;
  let client: WebSocket | null = null;
  let connected: { project?: string; build: "match" | "stale" | "unknown"; boxes: string[] } | null = null;
  let authed = false;       // a hello must land before any frame is honoured
  let clientBuild: string | null = null;   // the build the game reported (last hello): gates pushBundle
  // Kept PER FLOW: following a different participant then shows their table at
  // once, rather than waiting for them to move (Patterpad's lastFrame, same
  // reason). The trace stays one interleaved list; the Board filters it.
  let boards: Record<string, LiveLinkBoard> = {};
  let flows: string[] = [];
  let following: string | null = null;
  let recent: LiveLinkTrace[] = [];

  const status = (): LiveLinkStatus => {
    if (!wss) return { state: "off" };
    if (!client || !connected) return { state: "listening", port };
    return {
      state: "connected", port, build: connected.build, boxes: connected.boxes,
      flows: [...flows], following,
      ...(connected.project !== undefined ? { project: connected.project } : {}),
    };
  };
  /** Remember a flow, and follow it if we are following nothing yet: the first
   *  flow a game reports is the one the Board opens on. */
  const noteFlow = (id: string): void => {
    if (!flows.includes(id)) flows.push(id);
    if (following === null) following = id;
  };
  const push = (): void => deps.onStatus(status());

  const forget = (): void => {
    connected = null; authed = false; clientBuild = null;
    boards = {}; flows = []; following = null; recent = [];
  };

  const handleMessage = (raw: string): void => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    if (msg === null || typeof msg !== "object") return;
    if (msg.t !== "hello" && !authed) return;   // nothing is honoured until the handshake names the build
    switch (msg.t) {
      case "hello": {
        authed = true;
        clientBuild = typeof msg.build === "string" ? msg.build : null;
        const current = deps.currentBuildHash();
        const build = current === null ? "unknown" : clientBuild === current ? "match" : "stale";
        const boxes = Array.isArray(msg.boxes) ? msg.boxes.filter((b): b is string => typeof b === "string") : [];
        connected = { build, boxes, ...(typeof msg.project === "string" ? { project: msg.project } : {}) };
        // A hello is a run beginning (or a refresh landing): the story so far is
        // the game's to keep, and the Board starts reading from here.
        boards = {}; recent = []; flows = []; following = null;
        for (const f of Array.isArray(msg.flows) ? msg.flows : []) {
          if (typeof f === "string") noteFlow(f);
        }
        deps.onFrame({ t: "hello", build, ...(connected.project !== undefined ? { project: connected.project } : {}) });
        push();
        break;
      }
      case "flowOpen": {
        if (typeof msg.flow !== "string") break;
        noteFlow(msg.flow);
        push();
        break;
      }
      case "flowClose": {
        if (typeof msg.flow !== "string") break;
        flows = flows.filter((f) => f !== msg.flow);
        delete boards[msg.flow];
        // Following a flow that just ended: fall back to whatever is left, so
        // the Board never sits on a participant who has gone.
        if (following === msg.flow) following = flows[0] ?? null;
        push();
        break;
      }
      case "board": {
        if (typeof msg.flow !== "string") break;
        const hands = isStringListMap(msg.hands) ? msg.hands : {};
        const turns = isNumberMap(msg.turns) ? msg.turns : {};
        noteFlow(msg.flow);
        boards[msg.flow] = { hands, turns };
        deps.onFrame({ t: "board", flow: msg.flow, hands, turns });
        break;
      }
      case "trace": {
        const event = msg.event;
        if (typeof msg.flow !== "string") break;
        if (event === null || typeof event !== "object" || typeof (event as { type?: unknown }).type !== "string") break;
        noteFlow(msg.flow);
        const frame: LiveLinkTrace = { t: "trace", flow: msg.flow, event: event as LiveLinkTrace["event"] };
        recent.push(frame);
        if (recent.length > LIVE_LOG_CAP) recent.splice(0, recent.length - LIVE_LOG_CAP);
        deps.onFrame(frame);
        break;
      }
    }
  };

  return {
    isOn: (): boolean => wss !== null,
    status,
    snapshot: (): LiveLinkSnapshot => ({ status: status(), boards: { ...boards }, trace: [...recent] }),
    /** Point the Board at another participant. Unknown ids are ignored, so a
     *  stale click after a flow closed does nothing. */
    follow(flowId: string): void {
      if (!flows.includes(flowId)) return;
      following = flowId;
      push();
    },
    pushBundle(build: string, data: string): void {
      if (!client || !authed) return;         // nothing connected / handshaken
      if (clientBuild === build) return;      // the game already runs this exact build
      try { client.send(JSON.stringify({ t: "bundle", v: 1, build, data })); } catch { /* socket went away */ }
      // Until the game re-hellos with the new build it is on the old one, and
      // the chip should say so rather than keep the match it had at handshake.
      if (connected && connected.build !== "stale") { connected = { ...connected, build: "stale" }; push(); }
    },
    start(): void {
      if (wss) return;
      try {
        // Loopback only: only processes on this machine can reach it.
        wss = new WebSocketServer({ host: "127.0.0.1", port }, () => push());   // "listening" once actually bound
      } catch (e) {
        deps.onStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
        wss = null;
        return;
      }
      wss.on("error", (e) => {
        deps.onStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
        // A bind failure (the port is taken) leaves no server behind: the next
        // click starts again rather than finding a dead one "on".
        if (!client) { const s = wss; wss = null; try { s?.close(); } catch { /* already closing */ } }
      });
      wss.on("connection", (ws) => {
        // One game at a time: a new connection replaces the old.
        if (client) { try { client.close(); } catch { /* gone */ } }
        client = ws; forget();
        ws.on("message", (data) => handleMessage(data.toString()));
        ws.on("close", () => { if (client === ws) { client = null; forget(); push(); } });
        ws.on("error", () => { /* a flaky client must not take the editor down */ });
        push();
      });
    },
    stop(): void {
      try { client?.close(); } catch { /* gone */ }
      client = null; forget();
      const s = wss; wss = null;
      try { s?.close(); } catch { /* already closing */ }
      push();
    },
  };
}

function isStringListMap(v: unknown): v is Record<string, string[]> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((list) => Array.isArray(list) && list.every((x) => typeof x === "string"));
}

function isNumberMap(v: unknown): v is Record<string, number> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((n) => typeof n === "number");
}
