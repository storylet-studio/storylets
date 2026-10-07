// ---------------------------------------------------------------------------
// How main answers the bridge. Every handler is registered through an `Ipc`,
// against the contract's channel list (shared/api.ts `INVOKE_CHANNELS`): the
// channel name, the arguments and the answer are checked against the bridge
// method that invokes it. The contract test registers every domain through a
// recording `Ipc` to hold the other half: one handler per channel, no more.
// ---------------------------------------------------------------------------

import { ipcMain } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { serialised } from "../mutate/write-path.js";
import type { ProjectSession } from "../project.js";
import type { InvokeArgs, InvokeChannel, InvokeResult, SendArgs, SendChannel } from "../../shared/api.js";

/** A handler for `C`: the renderer's arguments in, the method's answer out. */
export type Listener<C extends InvokeChannel> =
  (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>;

export interface Ipc {
  /** Answered as it arrives: a read, or anything that does not write the project. */
  handle<C extends InvokeChannel>(channel: C, listener: Listener<C>): void;
  /**
   * A handler that writes the project: run through the one write queue
   * (write-path.ts `serialised`), so no two writes interleave now that they are
   * asynchronous. The session is read when the turn comes, not when asked.
   */
  write<C extends InvokeChannel>(channel: C, listener: Listener<C>): void;
}

/** The real thing: `ipcMain`. */
export const electronIpc: Ipc = {
  handle: (channel, listener) => {
    ipcMain.handle(channel, listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
  },
  write: (channel, listener) => {
    const run = listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
    ipcMain.handle(channel, (event, ...args: unknown[]) => serialised(() => run(event, ...args)));
  },
};

/** Hear the renderer on a fire-and-forget channel (`SEND_CHANNELS`). Returns
 *  the way to stop. */
export function hear<C extends SendChannel>(channel: C, listener: (event: IpcMainEvent, ...args: SendArgs<C>) => void): () => void {
  const heard = listener as (event: IpcMainEvent, ...args: unknown[]) => void;
  ipcMain.on(channel, heard);
  return () => { ipcMain.removeListener(channel, heard); };
}

/** What a project handler answers when no project is open. */
const noProject = (): { error: string } => ({ error: "no project open" });

/**
 * The guard every project handler opens with, written once: the open session
 * as the first argument, or an answer for "nothing is open". `project` answers
 * a write's `{ error: "no project open" }`; `read` answers whatever empty the
 * read has (null, an empty list).
 */
export function sessionGuards(session: () => ProjectSession | undefined) {
  return {
    project: <A extends unknown[], R>(f: (open: ProjectSession, ...args: A) => R) =>
      (_event: unknown, ...args: A): R | { error: string } => {
        const open = session();
        return open ? f(open, ...args) : noProject();
      },
    read: <A extends unknown[], R, N>(f: (open: ProjectSession, ...args: A) => R, none: N) =>
      (_event: unknown, ...args: A): R | N => {
        const open = session();
        return open ? f(open, ...args) : none;
      },
  };
}
