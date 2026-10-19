// ---------------------------------------------------------------------------
// Live Link (design/live-link.md): the editor-side server.
//
// A loopback WebSocket server in the main process that a running game connects
// to. Two things travel on it: the game's trace stream and board snapshots come
// IN, forwarded to the Board window so it can show the game's run instead of
// its own (observe-only: the editor never drives the game); freshly compiled
// bundles go OUT after a save, so the run picks up the edit without restarting.
//
// The server itself is the family's, app-shell's live-link (family parity
// item 14), shared with Patterpad: loopback, web pages refused, one client at a
// time, a hello before anything is honoured, the build judged, status pushed,
// pushBundle gated on the build the client reported. This file is Storyletter's
// protocol plugged into it. Port 4472, one above Patterpad's, so both editors
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

import { LIVE_LOG_CAP } from "../shared/api.js";
import type { LiveLinkBoard, LiveLinkFrame, LiveLinkSnapshot, LiveLinkStatus, LiveLinkTrace } from "../shared/api.js";
import { isLocalOrigin } from "@wildwinter/app-shell/util";
import { createLiveLinkServer as createShellLiveLink } from "@wildwinter/app-shell/live-link";

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
  let boxes: string[] = [];
  // Kept PER FLOW: following a different participant then shows their table at
  // once, rather than waiting for them to move (Patterpad's lastFrame, same
  // reason). The trace stays one interleaved list; the Board filters it.
  let boards: Record<string, LiveLinkBoard> = {};
  let flows: string[] = [];
  let following: string | null = null;
  let recent: LiveLinkTrace[] = [];

  /** Remember a flow, and follow it if we are following nothing yet: the first
   *  flow a game reports is the one the Board opens on. */
  const noteFlow = (id: string): void => {
    if (!flows.includes(id)) flows.push(id);
    if (following === null) following = id;
  };
  const forget = (): void => { boxes = []; boards = {}; flows = []; following = null; recent = []; };

  const server = createShellLiveLink({
    port: deps.port ?? LIVE_LINK_PORT,
    currentBuildHash: deps.currentBuildHash,
    onStatus: deps.onStatus,
    protocol: ({ pushStatus }) => ({
      hello: ({ build, project, msg }) => {
        // A hello is a run beginning (or a refresh landing): the story so far is
        // the game's to keep, and the Board starts reading from here.
        forget();
        boxes = Array.isArray(msg.boxes) ? msg.boxes.filter((b): b is string => typeof b === "string") : [];
        for (const f of Array.isArray(msg.flows) ? msg.flows : []) {
          if (typeof f === "string") noteFlow(f);
        }
        deps.onFrame({ t: "hello", build, ...(project !== undefined ? { project } : {}) });
      },
      message: (msg) => {
        switch (msg.t) {
          case "flowOpen": {
            if (typeof msg.flow !== "string") break;
            noteFlow(msg.flow);
            pushStatus();
            break;
          }
          case "flowClose": {
            if (typeof msg.flow !== "string") break;
            flows = flows.filter((f) => f !== msg.flow);
            delete boards[msg.flow];
            // Following a flow that just ended: fall back to whatever is left, so
            // the Board never sits on a participant who has gone.
            if (following === msg.flow) following = flows[0] ?? null;
            pushStatus();
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
      },
      reset: forget,
      describe: () => ({ boxes, flows: [...flows], following }),
    }),
  });

  return {
    isOn: () => server.isOn(),
    status: () => server.status(),
    snapshot: (): LiveLinkSnapshot => ({ status: server.status(), boards: { ...boards }, trace: [...recent] }),
    /** Point the Board at another participant. Unknown ids are ignored, so a
     *  stale click after a flow closed does nothing. */
    follow(flowId: string): void {
      if (!flows.includes(flowId)) return;
      following = flowId;
      server.pushStatus();
    },
    pushBundle: (build, data) => server.pushBundle(build, data),
    start: () => server.start(),
    stop: () => server.stop(),
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
/** Whether a connection's Origin is this machine, so a game may take the slot:
 *  the family's one rule, shared with Patterpad's Live Link (app-shell util). */
export { isLocalOrigin };

