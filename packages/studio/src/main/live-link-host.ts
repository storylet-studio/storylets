// ---------------------------------------------------------------------------
// Live Link, main's half (design/live-link.md). Created on first use
// (Patterpad's shape). The game's frames go to the Board window, which renders
// the game's run instead of its own in Live mode; the status goes to the
// editor (its bottom-right chip) and the Board (its banner and Live / Local
// switch), and re-ticks the menu item.
// ---------------------------------------------------------------------------

import { createLiveLinkServer, type LiveLinkServer } from "./live-link.js";
import { compileForLivePush, currentProjectHash } from "./project.js";
import type { MainContext } from "./context.js";
import type { Ipc } from "./ipc/registrar.js";
import { push } from "./ipc/push.js";
import type { LiveLinkStatus } from "../shared/api.js";   // the chip's status, with a held save

export interface LiveLinkHost {
  /** Is the server running? (The Play > Live Link tick.) */
  isOn(): boolean;
  /** After a write: recompile and push to a connected game, debounced. */
  schedulePush(): void;
  /** Stop the server, and any push still waiting: closing the project or the editor. */
  stop(): void;
  register(ipc: Ipc): void;
}

export function createLiveLinkHost(ctx: Pick<MainContext, "session" | "editor" | "windows" | "menu">): LiveLinkHost {
  let liveLink: LiveLinkServer | undefined;
  function ensureLiveLink(): LiveLinkServer {
    if (!liveLink) {
      liveLink = createLiveLinkServer({
        currentBuildHash: () => { const session = ctx.session(); return session ? currentProjectHash(session) : null; },
        onFrame: (frame) => { const board = ctx.windows().get("board"); if (board) push(board.webContents, "liveLink:frame", frame); },
        onStatus: sendLiveStatus,
      });
    }
    return liveLink;
  }
  /** Why the last save was not pushed to the connected game (a load error, or a
   *  project that does not compile), for the chip's tip; cleared by the next
   *  push. Without it the refusal was silent, and an author watching the game
   *  for their edit had nothing to say why it never came. */
  let liveHeld: string | undefined;
  /** The status as the windows see it: the server's, with the held save. */
  const liveStatus = (status: LiveLinkStatus): LiveLinkStatus =>
    (status.state === "connected" && liveHeld !== undefined ? { ...status, held: liveHeld } : status);
  function sendLiveStatus(status: LiveLinkStatus): void {
    const shown = liveStatus(status);
    for (const w of [ctx.editor(), ctx.windows().get("board")]) if (w && !w.isDestroyed()) push(w.webContents, "liveLink:status", shown);
    ctx.menu();   // keep the Play > Live Link tick in step
  }
  /** Live refresh: after a write, recompile and push to a connected game,
   *  debounced. Free when nothing is connected: the gate skips the compile, and
   *  pushBundle itself no-ops when the game already runs the exact build (it
   *  re-hellos with the new hash after applying). */
  let livePushTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePush(): void {
    if (!liveLink?.isOn() || liveLink.status().state !== "connected") return;
    clearTimeout(livePushTimer);
    livePushTimer = setTimeout(() => {
      const session = ctx.session();
      if (!session || !liveLink) return;
      const out = compileForLivePush(session);
      const held = "error" in out ? out.error : undefined;
      if (held !== liveHeld) { liveHeld = held; sendLiveStatus(liveLink.status()); }
      if (!("error" in out)) liveLink.pushBundle(out.hash, out.json);
    }, 500);
  }

  return {
    isOn: () => liveLink?.isOn() ?? false,
    schedulePush,
    stop: () => {
      clearTimeout(livePushTimer);   // a push still waiting would compile a project no longer open
      liveLink?.stop();
    },
    register: (ipc) => {
      // The chip and Play > Live Link toggle the server; the Board asks for the
      // snapshot when it enters Live mode.
      ipc.handle("liveLink:start", () => { ensureLiveLink().start(); ctx.menu(); return liveStatus(ensureLiveLink().status()); });
      ipc.handle("liveLink:stop", () => {
        liveHeld = undefined;
        clearTimeout(livePushTimer);   // a push still waiting has nothing to go to
        ensureLiveLink().stop();
        ctx.menu();
        return ensureLiveLink().status();
      });
      ipc.handle("liveLink:status", () => liveStatus(ensureLiveLink().status()));
      ipc.handle("liveLink:snapshot", () => ensureLiveLink().snapshot());
      ipc.handle("liveLink:follow", (_e, flowId) => {
        const link = ensureLiveLink();
        link.follow(flowId);
        return link.status();
      });
    },
  };
}
