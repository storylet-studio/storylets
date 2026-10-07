// ---------------------------------------------------------------------------
// Long jobs (the shared shell's kit). A coverage sweep of a few thousand runs
// is seconds of solid CPU. The kit runs it cooperatively: the sweep hands the
// event loop back between runs, so the windows keep painting, progress
// arrives, and Cancel is heard.
// ---------------------------------------------------------------------------

import { BrowserWindow } from "electron";
import { createJobHost } from "@wildwinter/app-shell/job";
import type { JobProgress } from "@wildwinter/app-shell/job";
import { JOB_PROGRESS_CHANNEL } from "../shared/api.js";
import { push } from "./ipc/push.js";

export const COVERAGE_JOB = "coverage";

export type JobHost = ReturnType<typeof createJobHost>;

export function createJobs(): { host: JobHost; run: <T>(kind: string, work: () => Promise<T>) => Promise<T | { error: string }> } {
  const jobs = createJobHost({
    // The kit hands us its channel name; we send on OURS, which the contract
    // declares and a test pins to the kit's, so the preload never has to import
    // the kit (see JOB_PROGRESS_CHANNEL in shared/api.ts).
    send: (_channel, payload: JobProgress) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) push(w.webContents, JOB_PROGRESS_CHANNEL, payload);
      }
    },
  });

  /**
   * Run one of the blocking acts (publish, pack, unpack, pull, push, merge) as a
   * job of the same kit, so the window that asked can show its strip and the
   * editor keeps painting (parity row 20: nothing waits on the hot path without
   * saying so). The ops layer reports no progress for these, so the bar is
   * indeterminate: one step at the start, one at the end. Not cancellable
   * mid-write; a job cancelled from the strip still returns what it wrote, so
   * the author is never told a file does not exist when it does.
   */
  async function run<T>(kind: string, work: () => Promise<T>): Promise<T | { error: string }> {
    const outcome = await jobs.start(kind, async (ctx) => {
      await ctx.step(0, 0);
      const value = await work();
      await ctx.step(1, 1);
      return value;
    });
    if ("error" in outcome) return { error: outcome.error };
    if ("cancelled" in outcome) return outcome.value !== undefined ? outcome.value : { error: "cancelled" };
    return outcome.value;
  }

  return { host: jobs, run };
}
