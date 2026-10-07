// ---------------------------------------------------------------------------
// The Coverage window's half in main: the sweep as a cancellable job, and the
// last report of the session, kept so the window reopens showing it and the
// editor's overlays and the Links lens can read it.
// ---------------------------------------------------------------------------

import { runCoverageAsync } from "@storylet-studio/ops";
import { pinToolWindow } from "@wildwinter/app-shell/tool-window";
import { currentProjectHash, validate } from "../project.js";
import { addCoverageDrivers } from "../mutate/quick-fixes.js";
import { serialised } from "../mutate/write-path.js";
import { coverageOverlay, proposeDrivers } from "../read/coverage.js";
import type { CoverageEvidence } from "../read/links.js";
import { COVERAGE_JOB } from "../jobs.js";
import type { JobHost } from "../jobs.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { sessionGuards } from "./registrar.js";
import { push } from "./push.js";
import type { CoverageInfo, CoverageRan, CoverageReport } from "../../shared/api.js";

type CoverageRunOpts = { runs?: number; maxTurns?: number; seed?: number };

export interface CoverageHost {
  /** The last run's evidence, while it still describes the open project. */
  last(): CoverageEvidence | undefined;
  /** Forget the last run: the project it described has gone. */
  forget(): void;
  register(ipc: Ipc): void;
}

export function createCoverage(ctx: Pick<MainContext, "session" | "editor" | "store" | "windows" | "menu">, jobs: JobHost): CoverageHost {
  /** The last coverage report of this session, so the window reopens showing it. */
  let lastCoverage: CoverageReport | undefined;
  /** When `lastCoverage` finished. Held beside it rather than inside the report,
   *  which is the ops package's shape and is written to no file: the canvas needs
   *  to date its evidence, the report itself has no opinion about clocks. */
  let lastCoverageAt: string | undefined;
  /** The project hash the last report ran on, read as the sweep began (after its
   *  re-read from disk, so after any drivers it added): what "changed since"
   *  compares against. */
  let lastCoverageHash: string | null | undefined;

  /** One coverage sweep as a cancellable job. A cancelled sweep still yields the
   *  runs it managed: a partial answer beats none, and the report says how many
   *  runs it is speaking for. */
  async function coverageJob(opts: CoverageRunOpts): Promise<{ report: CoverageReport; name: string; ran: CoverageRan; cancelled?: boolean } | { error: string }> {
    const started = ctx.session();
    if (!started) return { error: "no project open" };
    validate(started);   // re-read from disk first (files are the truth)
    const hash = currentProjectHash(started);
    const source = started.loaded.source;
    if (!source) return { error: "the project does not load" };
    const name = source.project.project.name;

    const outcome = await jobs.start(COVERAGE_JOB, async (job) =>
      runCoverageAsync(source, {
        ...opts,
        // Always, in the editor: the sweep feeds the Links window's observed-edge
        // overlay, and an author who ran a coverage test and then found that
        // overlay empty because they had run "the wrong kind" would be right to
        // call it broken. It costs about twice a plain sweep (it peeks once per
        // hand, measured 2026-10-06) on an operation that already has a progress
        // bar and a Cancel.
        observeEdges: true,
        shouldStop: () => job.cancelled,
        onRun: (done, total) => job.step(done, total),
      }));

    if ("error" in outcome) return outcome;
    // The project changed or closed while it ran (the satellite cancels the job
    // too): this report describes a project that is no longer open, and stored as
    // the last one it would show there and in the editor's overlays (review
    // 2026-10, item 9).
    const session = ctx.session();
    if (session !== started) return { error: "the project changed while the coverage test ran" };
    const cancelled = "cancelled" in outcome;
    const report = outcome.value;
    if (!report) return { error: "coverage was cancelled before it began" };
    if (report.issues.some((i) => i.severity === "error")) {
      return { error: report.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") };
    }
    lastCoverage = report;
    lastCoverageAt = new Date().toISOString();
    lastCoverageHash = hash;
    // Tell the EDITOR, not just the window that asked. The sweep is run from the
    // Coverage window, and an overlay in the main window that kept showing the
    // previous run until something else happened to refresh it would be stale in
    // the one moment the author is most likely to be looking at it.
    const editor = ctx.editor();
    if (editor && !editor.isDestroyed()) push(editor.webContents, "coverage:done");
    return { report, name, ran: { at: lastCoverageAt, hash }, ...(cancelled ? { cancelled: true } : {}) };
  }

  return {
    last: () => (lastCoverage !== undefined && lastCoverageAt !== undefined ? { report: lastCoverage, at: lastCoverageAt } : undefined),
    forget: () => { lastCoverage = undefined; lastCoverageAt = undefined; lastCoverageHash = undefined; },
    register: (ipc) => {
      const { read } = sessionGuards(ctx.session);
      ipc.handle("coverage:overlay", () =>
        (lastCoverage && lastCoverageAt !== undefined ? coverageOverlay(lastCoverage, lastCoverageAt) : undefined));
      ipc.handle("coverage:setOverlay", (_event, on) => { ctx.store().setCoverageOverlay(on); ctx.menu(); });
      ipc.handle("coverage:open", () => { ctx.windows().open("coverage"); });
      // The window is a tool window: it stays open while you edit, so the last
      // report is cached here and shown again on reopen (Patterpad's coverage
      // window). A different project, or none, clears it: the Coverage row's
      // `clear` in windows.ts, which cancels a sweep still running too.
      ipc.handle("coverage:info", (): CoverageInfo => {
        const session = ctx.session();
        return {
          hasProject: session !== undefined,
          name: session?.loaded.source?.project.project.name ?? "",
          driverCount: Object.keys(session?.loaded.source?.project.coverage?.drivers ?? {}).length,
          pinned: ctx.store().get().coveragePinned,
          ...(lastCoverage ? { last: lastCoverage } : {}),
          ...(lastCoverage && lastCoverageAt !== undefined ? { ran: { at: lastCoverageAt, hash: lastCoverageHash ?? null } } : {}),
        };
      });
      ipc.handle("coverage:run", (_event, opts) => coverageJob(opts));
      ipc.handle("coverage:cancel", () => jobs.cancel(COVERAGE_JOB));
      ipc.handle("coverage:addDrivers", async (_event, opts) => {
        if (!ctx.session()) return { error: "no project open" };
        const added = await serialised(() => { const session = ctx.session(); return session ? addCoverageDrivers(session) : { error: "no project open" }; });
        if ("error" in added) return added;
        const run = await coverageJob(opts);
        return "error" in run ? run : { ...run, added: added.added };
      });
      ipc.handle("coverage:propose", read(proposeDrivers, []));
      ipc.handle("coverage:setPin", (_event, on) => {
        ctx.store().window("coverage").setPinned(on);
        pinToolWindow(ctx.windows().get("coverage"), ctx.editor(), on);
      });
      // The card table's order, kept with the app's other view choices so it
      // survives closing the window and quitting (Patterpad remembers its own).
      ipc.handle("coverage:setOrder", (_event, order) => {
        ctx.store().setCoverageOrder(order === "deck" ? "deck" : "least");
      });
      ipc.handle("coverage:close", () => { ctx.windows().get("coverage")?.close(); });
    },
  };
}
