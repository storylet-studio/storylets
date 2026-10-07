// ---------------------------------------------------------------------------
// Getting the project out and back: Publish (the bundle, the spreadsheet, the
// playable page), Share Scopes, the send envelope (.storyletpack), and the
// server exchange (connect, pull, push, and merging a returned pack).
//
// The blocking ones run as jobs in main, and the strip says so while the call
// is out (parity row 20).
// ---------------------------------------------------------------------------

import { confirmDialog, el, mountJobProgress, plural } from "@wildwinter/app-shell";
import { baseName } from "./paths.js";
import { askPush, askServer } from "./server-dialog.js";
import { flash, flashError, ok } from "./results.js";
import type { PushOptions } from "./server-dialog.js";
import type { Session } from "./session.js";
import type { ContractBreakDto, JobProgress, OpenResult, PackOffer } from "../../shared/api.js";

export interface ExchangeContext {
  session: Session;
  flushSaves: () => Promise<void>;
  applied: (r: OpenResult | { error: string }) => boolean;
  applyResult: (r: OpenResult) => void;
  refreshProject: () => Promise<void>;
  /** Draw the workspace (renderWorkspace). */
  render: () => void;
  /** Redraw after a project arrives that may differ in shape (renderer.ts). */
  repaintReplacedProject: () => void;
  /** Take an opened project, or its refusal (renderer.ts). */
  adopt: (pending: Promise<OpenResult | { error: string } | null>) => Promise<void>;
  /** Fetch the open condition catalogue again; false when none was open. */
  reloadCatalogue: () => Promise<boolean>;
}

export type Exchange = ReturnType<typeof createExchange>;

export function createExchange(ctx: ExchangeContext) {
  const { session } = ctx;
  const studio = session.studio;

  /**
   * The job strip for the blocking acts main runs as jobs (publish, pack, pull,
   * push, merge): the wait is SAID rather than felt (parity row 20). The strip
   * appears when main reports the work has started (so a Save dialog in front
   * of it is not "publishing" yet) and goes when the call returns. These jobs
   * report no count and cannot be cancelled mid-write, so the strip is pinned
   * to the shell's indeterminate mode (the band and the elapsed time, no count)
   * and, with no `onCancel`, draws no Cancel.
   */
  const jobStrip = mountJobProgress(el("div"), { indeterminate: true });
  let jobRunning: { kind: string; label: string } | undefined;
  async function withJob<T>(kind: string, label: string, work: () => Promise<T>): Promise<T> {
    jobRunning = { kind, label };
    try { return await work(); } finally { jobRunning = undefined; jobStrip.end(); }
  }

  /** Publish Bundle, the manual one: it pins every address still following its
   *  title first (design/pin-on-publish.md), and says so, once, so the diff that
   *  follows is not a surprise. Main flushes pending edits before it pins. */
  async function exportBundle(): Promise<void> {
    const result = await withJob("bundle", "Publishing the bundle…", () => studio.exportBundle({ pin: true }));
    // Re-read even on a failure: the pins may have landed before the export failed.
    if (!ok(result)) { void ctx.refreshProject(); return; }
    // "Published", the menu's own verb, as the other two Publish commands say.
    const pinned = result.pinned > 0 ? `, and pinned ${plural(result.pinned, "game id")} that followed a title` : "";
    flash(`Published ${baseName(result.path)}${pinned}`, "ok");
    void ctx.refreshProject();
  }

  /** Publish Spreadsheet: the whole project as a readable .xlsx, to a path chosen
   *  in a native Save dialog (main). The workbook is read from the FILES, so
   *  pending edits land first. */
  async function exportSpreadsheet(): Promise<void> {
    await ctx.flushSaves();
    const result = await withJob("spreadsheet", "Publishing the spreadsheet…", () => studio.exportXlsx());
    if (result === null) return;
    if (!ok(result)) return;
    flash(`Published ${baseName(result.path)}`, "ok");
  }

  /** Publish Playable HTML: the project as one self-contained page that plays
   *  in any browser, to a path chosen in a native Save dialog (main). Compiled
   *  from the FILES, so pending edits land first. */
  async function exportPlayable(): Promise<void> {
    await ctx.flushSaves();
    const result = await withJob("playable", "Publishing the playable page…", () => studio.exportHtml());
    if (result === null) return;
    if (!ok(result)) return;
    flash(`Published ${baseName(result.path)}`, "ok");
  }

  // --- the game's shared scopes folder (patterkit design/shared-scopes.md) -------

  /** "Share Scopes with Other Tools...": make the folder, or say where it already is. The
   *  catalogue is re-read afterwards, since the other tools' properties are in it now. */
  async function shareScopes(): Promise<void> {
    if (session.project?.gameScopes) {
      flash(`This project already shares its scopes, through ${session.project.gameScopes.dir}.`, "ok");
      return;
    }
    await ctx.flushSaves();   // the files the other tools read are written from what is on disk
    const result = await studio.shareScopes();
    if (result === null) return;
    if (!ctx.applied(result)) return;
    if (!(await ctx.reloadCatalogue())) ctx.render();
    flash("Shared the project's scopes with the game's other tools", "ok");
  }

  // --- the send envelope (.storyletpack) ---------------------------------------

  /** Export the project as a pack, to hand to someone with no shared VCS. */
  async function exportPack(): Promise<void> {
    await ctx.flushSaves();   // a pack is a snapshot of the FILES, so land edits first
    const result = await withJob("pack", "Packing the project…", () => studio.exportPack());
    if (result === null) return;
    if (!ok(result)) return;
    flash(`Packed ${baseName(result.path)}`, "ok");
  }

  /**
   * Open a pack: explode it somewhere the author chooses, then open that. The
   * result is an ordinary project open, so it goes through `adopt` like any
   * other - a pack that has been unpacked is just a project.
   *
   * A pack that names an address is the one case with a question in it: the
   * connect dialog opens with the address filled in, and the code is typed as it
   * always is. Cancel opens the pack as it stands, with no record of where it
   * came from, which is exactly what this command did before there was an
   * exchange at all.
   */
  async function openPack(): Promise<void> {
    await ctx.flushSaves();
    const picked = await studio.choosePack();
    if (picked === null) return;
    await offerPack(picked);
  }

  /**
   * A pack, and the one question it can have in it.
   *
   * Shared by the picker and by a pack the OS handed us, because they are the
   * same pack and deserve the same offer: a double-clicked one used to unpack
   * flat with its address quietly thrown away.
   */
  async function offerPack(picked: { path: string; address?: string }): Promise<void> {
    if (picked.address !== undefined) {
      const answered = await connect({ address: picked.address, offerForget: true });
      if (answered === "connected" || answered === "busy") return;
    }
    await ctx.adopt(withJob("unpack", "Unpacking…", () => studio.openPackAt(picked.path)));
  }

  /** What the OS handed us, whichever of the three it is. */
  async function arrive(result: OpenResult | { error: string } | PackOffer): Promise<void> {
    if ("pack" in result) { await offerPack(result.pack); return; }
    await ctx.adopt(Promise.resolve(result));
  }

  /**
   * The connect dialog, and what it asks for.
   *
   * "busy" means the dialog did something of its own (forgetting a key) and the
   * caller should not fall through to its alternative; "connected" means a
   * project is open; "cancelled" means nothing happened.
   */
  async function connect(opts: { address?: string; offerForget?: boolean } = {}): Promise<"connected" | "cancelled" | "busy"> {
    const answer = await askServer(opts);
    if (answer === null) return "cancelled";
    if ("forget" in answer) {
      await studio.forgetServer(answer.forget);
      return "busy";
    }
    const result = await studio.connectServer(answer.address, answer.code, answer.fingerprint);
    if (result === null) return "cancelled";
    if (!ok(result)) return "cancelled";
    await ctx.adopt(Promise.resolve(result));
    return "connected";
  }

  /** Take the server's latest revision into the open project. */
  async function serverPull(): Promise<void> {
    await ctx.flushSaves();
    const done = await withJob("pull", "Pulling from the server…", () => studio.serverPull());
    if (done === null) return;
    if (!ok(done)) return;
    ctx.applyResult(done.result);
    ctx.render();
    // The venue's own file is taken whole rather than merged (4.11), so it is
    // counted apart: "16 merged, 0 added" over 17 shards was a shard nobody could
    // account for, and the one it left out was the contract.
    const counts = [
      `${done.merged} merged`, `${done.added} added`,
      ...(done.replaced > 0 ? [`${plural(done.replaced, "contract")} taken`] : []),
    ].join(", ");
    if (done.conflicts > 0) {
      // The ERROR voice, as the returned-pack merge uses: the merge landed, but
      // walking away from unresolved conflicts thinking you were done is exactly
      // what a quiet toast would let somebody do.
      flashError(`Pulled revision ${done.revision} (${counts}). ${plural(done.conflicts, "conflict")} ${done.conflicts === 1 ? "needs" : "need"} a look. See the .storyletconflict files.`);
    } else {
      flash(`Pulled revision ${done.revision} (${counts})`, "ok");
    }
  }

  /**
   * Send the open project up, and say what came back.
   *
   * The dialog first: a note for whoever reads the revision list later, and the
   * line saying where the project stands. THEN the one refusal with a way through
   * it - the far end naming things this change breaks - brings the dialog back
   * with a tick per break, and the second attempt names the ticked ones. Every
   * other refusal is the far end saying no, shown as it stands in the problems
   * bar: it is the one thing here nobody should paraphrase.
   *
   * `breaks` is main asking for that second dialog directly, after a push it made
   * on its own on the way out of a project.
   */
  async function serverPush(breaks: ContractBreakDto[] = []): Promise<void> {
    await ctx.flushSaves();
    let asking: PushOptions = {
      status: session.remote?.status ?? "",
      ...(breaks.length > 0 ? { breaks } : {}),
    };
    for (;;) {
      const answer = await askPush(asking);
      if (answer === null) return;
      const done = await withJob("push", "Pushing to the server…", () => studio.serverPush(answer.note, answer.acknowledge));
      if (done === null) return;
      if (!ok(done)) return;
      ctx.applyResult(done.result);
      ctx.render();
      // Nothing differed from the revision the far end holds, which is the server
      // saying the work is already there. A remark, not a refusal: it is said in
      // the quiet voice and nothing is filed in the problems bar.
      if ("unchanged" in done) { flash(done.unchanged, "ok"); return; }
      if ("refusal" in done) {
        if (done.breaks === undefined || done.breaks.length === 0) { flashError(done.refusal); return; }
        asking = {
          status: session.remote?.status ?? "",
          note: answer.note, refusal: done.refusal, breaks: done.breaks,
        };
        continue;
      }
      flash(`Pushed as revision ${done.revision} (${plural(done.changed, "shard")})`, "ok");
      return;
    }
  }

  /**
   * Merge a returned pack back in, against the pack that was sent.
   *
   * PLAN, confirm, commit. The op is pure, so the whole merge runs before anything
   * is written and the confirmation can quote REAL counts - "7 merged, 2 added, 3
   * conflicts will keep yours" - rather than describing what is about to be
   * attempted. A confirmation that cannot say what will happen is only a speed bump.
   * (Adopted from the Patter side, which built this shape first.)
   */
  async function mergePack(): Promise<void> {
    await ctx.flushSaves();
    const planned = await withJob("merge", "Merging the returned pack…", () => studio.mergePackPlan());
    if (planned === null) return;                       // a picker was cancelled
    if (!ok(planned)) return;
    const { shards, conflicts, assets, keptAssets, provenance, gameWorld, gameWorldError } = planned.summary;
    const added = shards.filter((s) => s.added).length;
    const merged = shards.length - added;

    const counts = [
      `${merged} merged`,
      ...(added > 0 ? [`${added} added`] : []),
      ...(assets > 0 ? [`${plural(assets, "picture")} added`] : []),
      ...(keptAssets > 0 ? [`${keptAssets} of yours kept`] : []),
    ].join(", ");
    const conflictLine = conflicts > 0
      ? ` ${plural(conflicts, "conflict")} will keep your version, with a .storyletconflict file beside each.`
      : "";
    // Their copy of the game's scopes is never merged in; a World edit they made
    // is the one exception, and the author is told where it goes.
    const worldLine = gameWorld !== undefined
      ? ` They changed the World properties, so ${gameWorld} gets them too.`
      : gameWorldError !== undefined
        ? ` They changed the World properties, which only the project's copy gets: ${gameWorldError}.`
        : "";
    // The mismatch is the HEADLINE when there is one, because it is the thing most
    // likely to mean the author picked the wrong file. Cancel is the shell confirm's
    // focused button either way, so the safe answer is the one already under the
    // keyboard. It warns and never refuses: an id can legitimately differ.
    const merge = await confirmDialog({
      title: provenance !== undefined ? "This pack may not belong to this project" : "Merge the returned pack?",
      // ONE paragraph, deliberately: `.confirm-body` sets no `white-space`, so a
      // newline here collapses to a space and a `\n\n` is two characters that do
      // nothing. Written as prose that reads without the break rather than as prose
      // that needs one it will not get.
      body: provenance !== undefined
        ? `${provenance} Merging anyway would give you ${counts}.${conflictLine}${worldLine}`
        : `${counts}.${conflictLine}${worldLine} You can undo this.`,
      confirmLabel: "Merge",
    });
    if (!merge) { await studio.mergePackDrop(); return; }

    const result = await studio.mergePackCommit();
    if (result === null) return;
    if (!ctx.applied(result)) return;
    ctx.repaintReplacedProject();
    // A conflict is not a failure, but it is not a success either: the shard was
    // written provisionally with OURS and a sidecar sits beside it.
    if (conflicts > 0) flashError(`Merged the returned pack (${counts}). ${plural(conflicts, "conflict")} ${conflicts === 1 ? "needs" : "need"} a look. See the .storyletconflict files.`);
    else flash(`Merged the returned pack (${counts})`, "ok");
  }

  return {
    /** The strip, mounted by the workspace above its bars. */
    jobStrip: jobStrip.element,
    /** Main's progress for a job: only the job this window is waiting on, so a
     *  quiet auto-rebuild (the same bundle job, unasked) never raises the strip. */
    onJobProgress(p: JobProgress): void {
      if (jobRunning === undefined || p.kind !== jobRunning.kind) return;
      if (!jobStrip.visible) jobStrip.begin(jobRunning.label);
      jobStrip.update(p.done, p.total, p.elapsedMs);
    },
    exportBundle, exportSpreadsheet, exportPlayable, exportPack,
    shareScopes, openPack, arrive, connect, serverPull, serverPush, mergePack,
  };
}
