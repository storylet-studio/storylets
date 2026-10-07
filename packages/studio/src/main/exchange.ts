// ---------------------------------------------------------------------------
// The pack exchange, main's half (design/engine-server.md 9.1): landing a pack,
// pulling, pushing, the question on the way out of a project the server has
// not seen the whole of, and folding a returned pack back in. Three calls over
// plain HTTP for a project that came from a server (remote.ts), and nothing at
// all for one that did not.
//
// Every piece of this is gated on the OPEN PROJECT having come from a server
// and this app still holding the key for it. With no remote there is no Server
// menu, no status line, no role and no prompt on the way out: an editor that
// has never been pointed at one carries a single File item and nothing else.
// ---------------------------------------------------------------------------

import { app, dialog } from "electron";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { writeTextFilesAsync } from "@wildwinter/simple-vc-lib";
import { runUnpackMerge } from "@storylet-studio/ops";
import type { UnpackMergeResult } from "@storylet-studio/ops";
import {
  addressOf, askLeave, contractBreaks, failed, hashPack, leavePrompt, levelLine, normaliseAddress, nothingToPush,
  packAddress, packProject, planConnect, planPull, projectStatusLine, pullPack, pushPack, pushedLine, reachable,
  readRemote, refusalPrompt, resolveLeave, serverProblems, unpushedShards, writeBase, writeRemote,
  LEAVE_SETTLE_MS, ServerSession,
} from "./remote.js";
import type { InAppPrompt, LeaveChoice, LeavePrompt, ProjectAnchor, PullPlan, RemoteRecord } from "./remote.js";
import { applyStates, captureBefore, writeFailure } from "./history.js";
import { HandedPaths } from "./trust.js";
import { openResult, validate } from "./project.js";
import type { ProjectSession } from "./project.js";
import { returnedWorldSummary, returnedWorldWrites } from "./game-scopes.js";
import { refuse, serialised } from "./mutate/write-path.js";
import type { MainContext } from "./context.js";
import type { Ipc } from "./ipc/registrar.js";
import { hear } from "./ipc/registrar.js";
import { push } from "./ipc/push.js";
import type {
  ContractBreakDto, LeavePromptDto, LeaveSettledDto, OpenResult, PackMergeSummary, ServerPullResult, ServerPushResult,
} from "../shared/api.js";

interface ServerContext {
  dir: string; remote: RemoteRecord; address: string; key: string;
  /** The certificate every call to this address must come over, or "" where
   *  there is none to pin. */
  pin: string;
}

/** Where the open project stands with its server (see `standingOf`). */
export interface Standing { revision: number; edits: number; head?: number }

export interface Exchange {
  /** The open project's remote and how it stands, for the menu and the title;
   *  notes the count drawn, so `countMoved` can tell when it next changes. */
  standing(): { remote?: RemoteRecord; keyed: boolean; standing?: Standing; head?: number };
  /** Has the unpushed count moved since the menu last drew it? */
  countMoved(): boolean;
  /** The window's suffix: the status line again, naming the project. */
  retitle(remote: RemoteRecord | undefined, standing: Standing | undefined): void;
  /** Ask the server where it has got to, once, in the background. */
  refreshHead(): void;
  /** Every piece of server state goes with the project it describes. */
  forget(): void;
  /** Drop a merge planned and not agreed to: the project it was planned on has gone. */
  dropPendingMerge(): void;
  /** May the author leave this project? Asks first when the server has not seen it all. */
  mayLeaveProject(act: "quit" | "close"): Promise<boolean>;
  /** Explode pack bytes into a folder the author picks, and open it. */
  landPack(bytes: Buffer, remote: RemoteRecord | undefined): Promise<OpenResult | { error: string } | null>;
  /** The address a pack on disk names, or nothing. */
  readPackAddress(packPath: string): Promise<string | undefined>;
  /** The pack paths main has handed out, the only ones `pack:openAt` will read. */
  handedPacks: HandedPaths;
  register(ipc: Ipc): void;
}

export interface ExchangeDeps extends Pick<MainContext, "session" | "editor" | "store" | "menu" | "openAt" | "flushEditor" | "runJob"> {
  /** After a pull or a merge lands: tell a connected game (Live Link). */
  schedulePush(): void;
  /** After a write that did not go through the write path: the menu's count may have moved. */
  noteProjectWritten(): void;
}

export function createExchange(deps: ExchangeDeps): Exchange {
  /** What this sitting knows about where the open project stands with its server:
   *  the head revision, learned in the background so the status line can say
   *  "behind" without a call on the menu's own path, and the count last drawn.
   *  Dropped whole on a project switch - the rule and the reason are in
   *  remote.ts, beside the rest of the server state. */
  const serverSession = new ServerSession();

  /** The merge planned but not yet agreed to. Held only between `pack:mergePlan`
   *  and `pack:mergeCommit`, and dropped on either answer. */
  let pendingMerge: UnpackMergeResult | undefined;

  /** The pack paths main has handed out (a picked pack, a pack the OS passed),
   *  which are the only ones `pack:openAt` will read. */
  const handedPacks = new HandedPaths();

  /** The open project as it is NOW: read again after every wait, as these always
   *  have been, rather than held from before it. */
  const live = (): ProjectSession => deps.session()!;

  /** Distinguishes one pull's or merge's undo step from the next. */
  let stepCounter = 0;
  const stepKey = (): string => String(stepCounter++);

  /**
   * The open project's remote AND the key for it, or nothing.
   *
   * Both halves: a remote whose key has been forgotten is a project like any
   * other. The key is the one whose ROLE matches this project's sidecar, because
   * a person with both jobs at one venue holds two (9.1 point 5): keyed by
   * address alone, pairing a second project as a designer overwrote the author
   * key, and the author's project then pulled as a designer with the read-only
   * rule gone. A project whose role has no key held is a project like any other,
   * which is the honest answer: the connect dialog is what offers to fix it.
   */
  function serverContext(): ServerContext | undefined {
    const dir = deps.session()?.loaded.dir;
    if (dir === undefined) return undefined;
    const remote = readRemote(dir);
    if (remote === undefined) return undefined;
    const address = addressOf(remote);
    const held = deps.store().serverKey(address, remote.role);
    if (held === undefined) return undefined;
    // THE PROJECT'S OWN FIRST. Both places hold the number and they agree, but
    // the record beside the shards is the one that travelled with the project,
    // so a project carried to another machine pins from the first call rather
    // than from whenever this machine last paired.
    const pin = remote.fingerprint ?? held.fingerprint ?? "";
    return { dir, remote, address, key: held.key, pin };
  }

  /** How the open project stands with its server: the revision it is level with,
   *  how many shards differ from it, and where the far end has got to when we
   *  have been told. The count is read off the SHARDS every time (remote.ts
   *  `unpushedShards`), which is what keeps it in step with the last keystroke
   *  rather than one event behind it. */
  const standingOf = (ctx: ServerContext): Standing => {
    const head = serverSession.head(ctx.dir);
    return {
      revision: ctx.remote.revision,
      edits: unpushedShards(ctx.dir),
      ...(head !== undefined ? { head } : {}),
    };
  };

  /** The name the project goes by, for the surfaces that name it. */
  const projectName = (): string => deps.session()?.dto.name ?? "";

  /** The window's suffix, which is the status line again so an author with the
   *  menu closed still knows - and it NAMES the project, because the one moment
   *  this matters is the moment a second one is arriving. Silent while the
   *  project is level, and silent always for a project with no server. */
  function retitle(remote: RemoteRecord | undefined, standing: Standing | undefined): void {
    const window = deps.editor();
    if (!window || window.isDestroyed()) return;
    window.setTitle(remote !== undefined && standing !== undefined && standing.edits > 0
      ? `Storyletter - ${projectStatusLine(projectName(), standing)}`
      : "Storyletter");
  }

  /**
   * Ask the server where it has got to, once, in the background.
   *
   * Silent on failure, deliberately: a server that is not on this network
   * is the ordinary case for a project opened on a train, and it is not
   * something to interrupt anybody about. What it costs is one pack fetched and
   * thrown away, which is the only way to learn the head revision over the calls
   * this app makes.
   */
  function refreshHead(): void {
    const ctx = serverContext();
    if (ctx === undefined) return;
    void (async () => {
      const head = await pullPack(ctx.address, ctx.key, {
        installation: ctx.remote.installation, version: ctx.remote.version,
      }, ctx.pin);
      if (failed(head)) return;
      serverSession.noteHead(ctx.dir, head.revision);
      deps.menu();
    })();
  }

  // --- landing a pack ------------------------------------------------------------

  /**
   * Explode pack bytes into a folder the author picks, and open it.
   *
   * ONE PATH for both cases the spec separates, because the merge already is
   * both. A folder that does not hold this project yet has nothing to merge
   * against, so every shard is written verbatim as an add; a folder that DOES
   * hold it gets `unpack --merge` semantics, id by id, with conflicts landing as
   * sidecars the problems bar shows. Which of the two happened is a fact about
   * the folder, not a mode anybody has to choose.
   */
  async function landPack(
    bytes: Buffer, remote: RemoteRecord | undefined,
  ): Promise<OpenResult | { error: string } | null> {
    const target = await askProjectFolder();
    if (target === null) return null;
    return landPackAt(target, bytes, remote);
  }

  /** Where should the project go? One picker, one wording, wherever it is asked
   *  from: unpacking a pack, or connecting to a server. */
  async function askProjectFolder(): Promise<string | null> {
    const dirPick = await dialog.showOpenDialog(deps.editor()!, {
      title: "Where should the project go?",
      message: "Choose a folder. The pack is unpacked into it as a project and opened.",
      buttonLabel: "Unpack Here",
      properties: ["openDirectory", "createDirectory"],
    });
    const target = dirPick.filePaths[0];
    return dirPick.canceled || target === undefined ? null : target;
  }

  /** The other half of landing a pack, once the folder is settled: the unpack
   *  itself, as a job. */
  async function landPackAt(
    target: string, bytes: Buffer, remote: RemoteRecord | undefined,
  ): Promise<OpenResult | { error: string } | null> {
    return deps.runJob("unpack", async () => {
      try {
        const plan = await planPull(target, bytes, undefined);
        const failure = await commitPlan(plan);
        if (failure !== undefined) return { error: failure };
        // The record goes in AFTER the shards, and only when the author connected:
        // a pack opened by file alone is an ordinary project, whatever its manifest
        // once said about where it came from.
        if (remote !== undefined) {
          writeRemote(target, remote);
          // ...and the base beside it: this pack IS the revision last pulled, so
          // everything in the folder is level with the server until it is typed in.
          writeBase(target, remote.revision, plan.base);
        }
        return deps.openAt(target);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  /** The address a pack on disk names, or nothing. A file we cannot even read is
   *  a pack with no address: the unpack that follows reports it properly. */
  async function readPackAddress(packPath: string): Promise<string | undefined> {
    try {
      return await packAddress(readFileSync(packPath), dirname(packPath));
    } catch {
      return undefined;
    }
  }

  // --- pulling and pushing ----------------------------------------------------------

  /** Write a plan's shards, sidecars and pictures. Returns the reason it could
   *  not, or nothing. All or nothing, as every write of the project's is: a
   *  pull that half landed would be a revision neither end ever had. */
  async function commitPlan(plan: PullPlan): Promise<string | undefined> {
    // Sidecars first: a shard holding provisional content must never land
    // without the sidecar that says so.
    const writes = [...plan.sidecars, ...plan.writes, ...plan.scopes];
    if (writes.length > 0) {
      try {
        const batch = await writeTextFilesAsync(writes.map((w) => ({ filePath: w.path, content: w.content })), "utf8", { allOrNothing: true });
        if (!batch.success) return writeFailure(batch.results);
      } catch (e) {
        return `couldn't save the project: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    // Pictures go straight to disk rather than through the text writer: they are
    // bytes, and nothing downstream should be asked to diff or merge them.
    for (const asset of plan.assets) {
      mkdirSync(dirname(asset.path), { recursive: true });
      writeFileSync(asset.path, asset.bytes);
    }
    return undefined;
  }

  /** Where the problems bar counts this project's paths from: the folder, and the
   *  project shard a problem about the whole project is anchored to. */
  const projectAnchor = (open: ProjectSession): ProjectAnchor =>
    ({ dir: open.loaded.dir, project: open.loaded.source?.path ?? "" });

  /** A refused push that came back with conflict sidecars: write them where the
   *  author will meet them, which is beside the shards that disagreed. */
  function writeRefusedSidecars(dir: string, details: unknown): void {
    if (!Array.isArray(details)) return;
    for (const row of details as { path?: string; text?: string }[]) {
      if (typeof row.path !== "string" || typeof row.text !== "string") continue;
      const path = join(dir, row.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, row.text, "utf8");
    }
  }

  /** Take the server's latest revision into the open project. */
  async function serverPull(): Promise<ServerPullResult> {
    const ctx = serverContext();
    if (ctx === undefined || deps.session() === undefined) return null;
    await deps.flushEditor();   // a merge reads the working copy off disk
    const head = await pullPack(ctx.address, ctx.key, {
      installation: ctx.remote.installation, version: ctx.remote.version,
    }, ctx.pin);
    if (failed(head)) return { error: head.error };
    serverSession.noteHead(ctx.dir, head.revision);
    // The ancestor is the revision we last pulled, which the far end still has:
    // it keeps every pack it sent, so the merge never has to ask which base.
    // Already level with the head means the head IS the ancestor, and the merge
    // is then a no-op over the author's own edits rather than a rewrite of every
    // shard against an empty base.
    const base = head.revision === ctx.remote.revision
      ? head
      : await pullPack(ctx.address, ctx.key, {
          installation: ctx.remote.installation, version: ctx.remote.version, revision: ctx.remote.revision,
        }, ctx.pin);
    if (failed(base)) return { error: base.error };
    try {
      const plan = await planPull(ctx.dir, head.bytes, base.bytes);
      const writes = [...plan.sidecars, ...plan.writes];
      // In the write queue, so no edit lands between the before-images and the
      // pull's own writes (an undo would otherwise put back the wrong text).
      // ONE undo step for the whole pull, as the returned-pack merge is one: a
      // revision is one act, and unpicking it shard by shard would leave the
      // project in a state neither end ever had. A pull that wrote nothing -
      // everything of theirs is already what is here - records no step: an undo
      // that puts nothing back is not a step anybody wants on their stack.
      const failure = await serialised(async () => {
        const before = captureBefore(writes.map((w) => w.path));
        const failed = await commitPlan(plan);
        if (failed !== undefined) return failed;
        if (writes.length > 0) {
          live().history.record("Pull from server", `pull:${stepKey()}`, before,
            writes.map((w) => ({ path: w.path, content: w.content })));
        }
        return undefined;
      });
      if (failure !== undefined) return refuse(live(), failure);
      // Level with the server at ITS revision, and the base moves to what the
      // server sent rather than to what is now on disk: a merge that folded local
      // edits in leaves them unpushed, and they still differ from the pulled
      // revision, so they still count. Saying "in sync" over them would be a lie.
      writeRemote(ctx.dir, { ...ctx.remote, revision: head.revision, role: head.role });
      writeBase(ctx.dir, head.revision, plan.base);
      deps.schedulePush();
      deps.menu();
      return {
        result: openResult(live(), validate(live())),
        revision: head.revision,
        merged: plan.merged, added: plan.added, replaced: plan.replaced, conflicts: plan.conflicts,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Send the open project up. A refusal is not a fault in the plumbing: it is the
   * far end saying no, in its own words, and it is shown as it stands.
   *
   * `note` and `acknowledge` come from the push dialog: the note rides on the
   * revision for whoever reads the list later, and the acknowledgements are the
   * breaks the author ticked after a refusal that named them. Both are absent on
   * the way out of a project, where the push happens with no dialog in front of
   * it, and a refusal that names breaks then opens one.
   */
  async function serverPush(
    opts: { note?: string; acknowledge?: string[] } = {},
  ): Promise<ServerPushResult> {
    const ctx = serverContext();
    if (ctx === undefined || deps.session() === undefined) return null;
    await deps.flushEditor();   // a pack is a snapshot of the FILES
    let pack: Buffer;
    let sent: Record<string, string>;
    try {
      pack = await packProject(ctx.dir);
      // Hashed now, from the pack itself: autosave carries on while the far end
      // answers, and an edit typed meanwhile is not in what was sent.
      sent = await hashPack(pack, ctx.dir);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    const identity = deps.store().get().identity;
    const pushed = await pushPack(ctx.address, ctx.key, {
      pack,
      installation: ctx.remote.installation,
      version: ctx.remote.version,
      base: ctx.remote.revision,
      // An empty note is no note: the field is optional, and a blank one should
      // not land on the revision as if somebody had typed a space.
      ...(opts.note !== undefined && opts.note.trim() !== "" ? { note: opts.note.trim() } : {}),
      ...(opts.acknowledge !== undefined && opts.acknowledge.length > 0 ? { acknowledge: opts.acknowledge } : {}),
      ...(identity !== undefined ? { identity } : {}),
    }, ctx.pin);
    if (failed(pushed)) {
      // A push that would change nothing is the far end confirming the work is
      // already there. It goes to a toast, and nothing about it is filed: the
      // problems bar is for things wrong with the project.
      if (nothingToPush(pushed)) {
        return { result: openResult(live(), validate(live())), unchanged: pushed.error };
      }
      if (pushed.code === "conflict") writeRefusedSidecars(ctx.dir, pushed.details);
      const problems = [...validate(live()), ...serverProblems(projectAnchor(live()), pushed.error, pushed.details)];
      // The one refusal with a way through it: the far end named things this
      // change breaks, and a designer who meant it says so break by break.
      const breaks = pushed.code === "contract_break" ? contractBreaks(pushed.details) : [];
      return {
        result: openResult(live(), problems),
        refusal: pushed.error,
        ...(breaks.length > 0 ? { breaks } : {}),
      };
    }
    serverSession.noteHead(ctx.dir, pushed.revision);
    writeRemote(ctx.dir, { ...ctx.remote, revision: pushed.revision });
    // The base moves to what was just SENT, hashed before the round trip. Not
    // the disk now: autosave ran on while the far end answered, and hashing the
    // files afterwards counted an edit typed during the push as pushed (review
    // 2026-10, item 2). `planPull` takes its base from the pack for the same reason.
    writeBase(ctx.dir, pushed.revision, sent);
    deps.menu();
    return {
      result: openResult(live(), validate(live())),
      revision: pushed.revision,
      changed: pushed.changed?.length ?? 0,
    };
  }

  // --- the way out --------------------------------------------------------------------

  /**
   * Ask the question in the app's own dialog, when there is a renderer to ask.
   *
   * Nothing when there is not: the fallback below is what an unanswerable
   * question falls back to, and `askLeave` chooses between them.
   */
  function inAppPrompt(): { ask: (prompt: LeavePrompt) => InAppPrompt; done: () => void } | undefined {
    const target = deps.editor();
    if (!target || target.isDestroyed()) return undefined;
    let clear = (): void => { /* nothing registered until something is asked */ };
    return {
      /** Called however the question was answered, native fallback included, so a
       *  prompt that was never replied to leaves no listeners behind. */
      done: () => clear(),
      ask: (prompt) => {
        let drawn = (): void => { /* replaced below, before anything can call it */ };
        let answered: (index: number) => void = () => { /* likewise */ };
        const shown = new Promise<void>((resolve) => { drawn = resolve; });
        const answer = new Promise<number>((resolve) => { answered = resolve; });
        const stopShown = hear("server:leave-shown", () => drawn());
        const stopReply = hear("server:leave-reply", (_event, index: unknown) =>
          answered(typeof index === "number" ? index : prompt.cancelId));
        clear = (): void => { stopShown(); stopReply(); };
        // Buttons and nothing else cross: what each index MEANS stays this side.
        push(target.webContents, "server:leave-prompt", {
          message: prompt.message, detail: prompt.detail, buttons: prompt.buttons,
          defaultId: prompt.defaultId, cancelId: prompt.cancelId,
        } satisfies LeavePromptDto);
        return { shown, answer };
      },
    };
  }

  /**
   * The fallback, for a renderer that has gone or will not answer.
   *
   * PARENTLESS on purpose. Attached to the editor window this is a sheet, and on
   * the close path that window's close has already been deferred: dismissing the
   * sheet let the deferred close through whatever button had been clicked, which
   * is how Cancel came to close the window and Push came to close it without
   * pushing (found end to end, 2026-09-07). App-modal, it answers and nothing
   * else happens.
   */
  async function nativePrompt(prompt: LeavePrompt): Promise<number> {
    const answer = await dialog.showMessageBox({
      type: "question",
      message: prompt.message,
      detail: prompt.detail,
      buttons: [...prompt.buttons],
      defaultId: prompt.defaultId,
      cancelId: prompt.cancelId,
    });
    return answer.response;
  }

  /**
   * The way out of a project the server has not seen the whole of.
   *
   * One prompt, three buttons, and the middle one names the act it is in the
   * middle of: quitting or closing. A push that lands lets go; a push that is
   * REFUSED does not, and the app stays where the author can act on it, which is
   * the whole reason the refusal is worth reaching at this moment at all.
   *
   * The prompt is the RENDERER's (2026-09-07), in the same classes as the push
   * dialog beside it: the app has one dialog style, and the only native surfaces
   * are the file and folder pickers.
   */
  async function mayLeaveProject(act: "quit" | "close"): Promise<boolean> {
    const ctx = serverContext();
    if (ctx === undefined) return true;
    const standing = standingOf(ctx);
    if (standing.edits === 0) return true;
    const name = projectName();
    const online = await reachable(ctx.address, ctx.pin);
    const prompt = leavePrompt(name, standing, act, online);
    const asking = inAppPrompt();
    const choice: LeaveChoice = await askLeave(prompt, asking?.ask, nativePrompt);
    asking?.done();
    // The push at this moment carries no note and no acknowledgements: there is no
    // dialog in front of it. A refusal that NAMES BREAKS is the one that then
    // needs one, so the breaks travel back for it.
    let breaks: ContractBreakDto[] | undefined;
    // ...and the far end may answer that the pack differs from its revision in
    // nothing at all, which is a way out rather than a refusal: the work is
    // already there, and the closing word says so instead of claiming a push.
    let level = false;
    const outcome = await resolveLeave(
      choice,
      async () => {
        const pushed = await serverPush();
        if (pushed === null) return { error: "there is nothing to push to." };
        if ("error" in pushed) return { error: pushed.error };
        if ("unchanged" in pushed) { level = true; return { revision: ctx.remote.revision }; }
        if ("refusal" in pushed) { breaks = pushed.breaks; return { error: pushed.refusal }; }
        return { revision: pushed.revision };
      },
      // The beat of confirmation: the dialog is still up, and it turns into the
      // revision the work landed as before the window goes.
      async (revision) => { await holdLeaveDialog(level ? levelLine(revision) : pushedLine(revision)); },
    );
    // However this ended, the dialog the person answered is finished with. Held
    // open until now on purpose (a push takes as long as the far end takes), so
    // it is dismissed here rather than at the click.
    if (choice !== "push" || outcome.refusal !== undefined) dropLeaveDialog();
    const window = deps.editor();
    if (outcome.refusal !== undefined && window && !window.isDestroyed()) {
      const session = live();
      // The problems bar already has it (the push wrote it there); this is the
      // window coming back to the front with the reason on it.
      push(window.webContents, "project:opened", openResult(session, [
        ...validate(session), ...serverProblems(projectAnchor(session), outcome.refusal, undefined),
      ]));
      if (breaks !== undefined && breaks.length > 0) {
        // The one refusal with a way through it: the push dialog opens on the
        // breaks to tick, down the same channel every other menu-driven dialog
        // opens on, and IS the answer to "why did nothing happen".
        push(window.webContents, "menu", { cmd: "server-push", breaks });
      } else {
        // Every other refusal has no way through it here, and until 2026-09-07
        // said so nowhere: the person pressed Push to server, stayed exactly
        // where they were, and only the problems bar had moved. The prompt says
        // it, in the far end's own words, with the one honest way out.
        const said = refusalPrompt(name, standingOf(ctx), outcome.refusal);
        const again = inAppPrompt();
        await askLeave(said, again?.ask, nativePrompt);
        again?.done();
        dropLeaveDialog();
      }
    }
    return outcome.go;
  }

  /**
   * Turn the leaving prompt into a closing word, and hold it there.
   *
   * TWO timers of one length, and that is deliberate: the renderer closes its own
   * dialog after `holdMs` so a main process that goes away cannot leave a modal
   * standing, and main waits the same `holdMs` before it lets the window go. A
   * quit destroys the window mid-hold, which is exactly the intended end of it.
   */
  async function holdLeaveDialog(message: string, holdMs = LEAVE_SETTLE_MS): Promise<void> {
    const window = deps.editor();
    if (window && !window.isDestroyed()) {
      push(window.webContents, "server:leave-settled", { message, holdMs } satisfies LeaveSettledDto);
    }
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  }

  /** Take the leaving prompt down with nothing to say: cancelled, left, or
   *  refused. A renderer with no dialog up ignores it. */
  function dropLeaveDialog(): void {
    const window = deps.editor();
    if (window && !window.isDestroyed()) {
      push(window.webContents, "server:leave-settled", { holdMs: 0 } satisfies LeaveSettledDto);
    }
  }

  /** Is there already something in this folder? The reason it cannot be used, or
   *  nothing. Dot-files are not something: the OS leaves them in folders nobody
   *  has touched, and refusing over one would be refusing over nothing. */
  function notEmpty(dir: string): string | undefined {
    let entries: string[] = [];
    try { entries = readdirSync(dir).filter((name) => !name.startsWith(".")); } catch { return undefined; }
    return entries.length === 0 ? undefined
      : "there is already something in that folder, and the project needs one of its own.";
  }

  return {
    standing: () => {
      const ctx = serverContext();
      const dir = deps.session()?.loaded.dir;
      const standing = ctx === undefined ? undefined : standingOf(ctx);
      serverSession.shownEdits = standing?.edits;
      return {
        ...(ctx !== undefined ? { remote: ctx.remote } : {}),
        keyed: ctx !== undefined,
        ...(standing !== undefined ? { standing } : {}),
        ...(dir !== undefined && serverSession.head(dir) !== undefined ? { head: serverSession.head(dir)! } : {}),
      };
    },
    countMoved: () => {
      const ctx = serverContext();
      const edits = ctx === undefined ? undefined : unpushedShards(ctx.dir);
      return edits !== serverSession.shownEdits;
    },
    retitle,
    refreshHead,
    forget: () => serverSession.forget(),
    dropPendingMerge: () => { pendingMerge = undefined; },
    mayLeaveProject,
    landPack,
    readPackAddress,
    handedPacks,

    register: (ipc) => {
      // --- the send envelope (.storyletpack) -----------------------------------------

      /**
       * Open Storyletpack, first half: choose the file, and say whether it names an
       * address.
       *
       * Two halves rather than one, because a pack that came from a server is a
       * pack you can either connect to or open flat, and only the author can say
       * which. A pack that names none is opened as it always was, in the second
       * call, with nobody asked anything.
       */
      ipc.handle("pack:choose", async (): Promise<{ path: string; address?: string } | null> => {
        const packPick = await dialog.showOpenDialog(deps.editor()!, {
          title: "Open a Storyletpack",
          message: "Choose a .storyletpack to unpack into a project.",
          buttonLabel: "Choose",
          filters: [{ name: "Storyletpack", extensions: ["storyletpack"] }],
          properties: ["openFile"],
        });
        const packPath = packPick.filePaths[0];
        if (packPick.canceled || packPath === undefined) return null;
        handedPacks.add(packPath);   // the one path the second half may open
        const address = await readPackAddress(packPath);
        return address === undefined ? { path: packPath } : { path: packPath, address };
      });

      /** Open a chosen pack flat: the project only, with no record of where it came
       *  from. What Cancel on the connect dialog falls back to. */
      ipc.handle("pack:openAt", async (_event, path): Promise<OpenResult | { error: string } | null> => {
        // Only a pack main handed out: a picked one, or one the OS passed at
        // launch. A renderer naming a file of its own is not a way to read the disk.
        if (!handedPacks.has(path)) return { error: "that pack wasn't chosen here" };
        if (!(await mayLeaveProject("close"))) return null;
        try {
          return await landPack(readFileSync(path), undefined);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      });

      // --- the server ---------------------------------------------------------------

      /**
       * Address and code in, project out.
       *
       * The code is spent on the way past: it is exchanged for a key, which is kept
       * in this app's settings under the address and never in a project. Then the
       * project is fetched and opened, which is the whole of connecting - there is
       * no separate first pull to remember to do.
       *
       * `fingerprint` is there when a whole link was pasted into the dialog rather
       * than a bare address: the certificate every call to this address must come
       * over from now on, kept with the key and beside the project's shards.
       */
      ipc.handle("server:connect", async (
        _event, address, code, fingerprint,
      ): Promise<OpenResult | { error: string } | null> => {
        if (!(await mayLeaveProject("close"))) return null;
        // THE FOLDER FIRST (2026-09-07). A code is single use and is spent the
        // moment it is exchanged for a key, so asking where the project should go
        // afterwards meant a cancelled picker cost the author their code and left
        // them with nothing to show for it. Nothing is spent until there is
        // somewhere to put what comes back.
        const store = deps.store();
        const identity = store.get().identity;
        const planned = await planConnect({
          address, code,
          device: { app: `Storyletter ${app.getVersion()}`, host: hostname() },
          ...(identity !== undefined ? { identity } : {}),
          ...(fingerprint !== undefined && fingerprint !== "" ? { pin: fingerprint } : {}),
          chooseFolder: askProjectFolder,
          refuseFolder: notEmpty,
          keepKey: (dialled, paired) => store.setServerKey(dialled, {
            key: paired.key, role: paired.role,
            ...(paired.installation !== "" ? { installation: paired.installation } : {}),
            // The number goes in the settings with the key it was agreed beside;
            // the project's own record gets it too, from the plan below.
            ...(paired.fingerprint !== undefined && paired.fingerprint !== ""
              ? { fingerprint: paired.fingerprint }
              : fingerprint !== undefined && fingerprint !== "" ? { fingerprint } : {}),
          }),
        });
        if (planned === null) return null;
        if (failed(planned)) return { error: planned.error };
        const landed = await landPackAt(planned.target, planned.bytes, planned.remote);
        if (landed !== null && !("error" in landed)) deps.menu();
        return landed;
      });

      /**
       * Forget the key paired with an address. Every piece of chrome that depended
       * on it goes with it.
       *
       * ONE SLOT when there is an open project at that address: the key it uses,
       * leaving the other role's alone, because somebody who authors here and
       * designs here has said nothing about the other job. With no such project -
       * a pack offering an address before anything is open - the address goes
       * whole, since there is nothing to narrow it by and half a forgotten server
       * would carry on appearing.
       */
      ipc.handle("server:forget", (_event, address): void => {
        const dialled = normaliseAddress(address);
        const open = serverContext();
        if (open !== undefined && open.address === dialled) deps.store().forgetServer(dialled, open.remote.role);
        else deps.store().forgetServer(dialled);
        deps.menu();
      });

      // Both as jobs: a pull or a push is a round trip to a server plus a merge
      // or a pack, and the editor says so while it waits (parity row 20). The way
      // OUT of a project pushes through serverPush directly, with the leaving
      // dialog in front of it instead.
      ipc.handle("server:pull", (): Promise<ServerPullResult> => deps.runJob("pull", serverPull));
      ipc.handle("server:push", (
        _event, note, acknowledge,
      ): Promise<ServerPushResult> => deps.runJob("push", () => serverPush({
        ...(note !== undefined ? { note } : {}),
        ...(acknowledge !== undefined ? { acknowledge } : {}),
      })));

      // --- folding a returned pack back in ---------------------------------------------
      //
      // PLAN, then commit, in two calls with the author's answer in between.
      //
      // The merge used to write as soon as the two files were picked, so a confirmation
      // could only ever have described what was ABOUT to be attempted. The op is pure,
      // which buys the better shape (the Patter side's, adopted here): run the whole
      // merge, show real counts and any provenance mismatch, and let the author back
      // out having seen them. The modal also sits BETWEEN the two calls, so it never
      // blocks inside the write queue.
      ipc.handle("pack:mergePlan", async (): Promise<{ summary: PackMergeSummary } | { error: string } | null> => {
        if (!deps.session()) return { error: "no project open" };
        const returnedPick = await dialog.showOpenDialog(deps.editor()!, {
          title: "Which returned Storyletpack?",
          message: "Choose the .storyletpack that came back to you.",
          buttonLabel: "Choose",
          filters: [{ name: "Storyletpack", extensions: ["storyletpack"] }],
          properties: ["openFile"],
        });
        const returned = returnedPick.filePaths[0];
        if (returnedPick.canceled || returned === undefined) return null;
        // The pack that was SENT is the common ancestor. Without it there is no
        // three-way merge to do, only an overwrite, so it is asked for explicitly.
        const basePick = await dialog.showOpenDialog(deps.editor()!, {
          title: "And the Storyletpack you sent them?",
          message: "Choose the .storyletpack you originally sent. It is the common ancestor, and the merge needs it.",
          buttonLabel: "Choose",
          filters: [{ name: "Storyletpack", extensions: ["storyletpack"] }],
          properties: ["openFile"],
        });
        const base = basePick.filePaths[0];
        if (basePick.canceled || base === undefined) return null;

        const dir = live().loaded.dir;
        try {
          const merged = await deps.runJob("merge", () => runUnpackMerge(readFileSync(returned), readFileSync(base), dir));
          if ("error" in merged) { pendingMerge = undefined; return merged; }
          pendingMerge = merged;
          const summary: PackMergeSummary = {
            shards: merged.shards.map((s) => ({ path: s.path, added: s.added, conflicts: s.result?.conflicts.length ?? 0 })),
            conflicts: merged.conflicts,
            warnings: merged.warnings,
            assets: merged.assets.length,
            keptAssets: merged.keptAssets.length,
            ...(merged.provenance.message !== undefined ? { provenance: merged.provenance.message } : {}),
            // The returned World edit, carried to the game's own file, or why it can't be.
            ...returnedWorldSummary(merged.gameWorld),
          };
          return { summary };
        } catch (e) {
          pendingMerge = undefined;
          return { error: e instanceof Error ? e.message : String(e) };
        }
      });

      /** The author said no: forget the plan rather than leaving it committable. */
      ipc.handle("pack:mergeDrop", () => { pendingMerge = undefined; });

      /** Write the merge the author has just agreed to. Nothing else may sit between
       *  the plan and this: a project change would invalidate the plan's ancestor. */
      ipc.write("pack:mergeCommit", async (): Promise<OpenResult | { error: string } | null> => {
        if (!deps.session()) return { error: "no project open" };
        const merged = pendingMerge;
        pendingMerge = undefined;
        if (merged === undefined) return null;
        try {
          // Assets the returned pack brought that we do not have. Never overwriting
          // one we DO have is the merge's own rule (there is nothing to three-way
          // inside a PNG, and an author's original must not be silently replaced).
          for (const asset of merged.assets) {
            mkdirSync(dirname(asset.path), { recursive: true });
            writeFileSync(asset.path, asset.bytes);
          }
          // The returned World edit goes to the game's own file in the same batch,
          // so the one undo puts it back with the rest (game-scopes.ts).
          const writes = [...merged.sidecars, ...merged.writes, ...returnedWorldWrites(merged.gameWorld)];
          const before = captureBefore(writes.map((w) => w.path));
          const applied = await applyStates(writes.map((w) => ({ path: w.path, content: w.content })));
          if (!applied.ok) return refuse(live(), applied.error);
          // One undo step for the whole merge: a returned pack is one act, and
          // unpicking it shard by shard would be worse than useless.
          live().history.record("Merge returned storyletpack", `pack:${stepKey()}`, before, writes.map((w) => ({ path: w.path, content: w.content })));
          // A write like any other, including to the server: the shards it changed
          // are shards the far end has not seen, and the count says so on its own.
          deps.noteProjectWritten();
          deps.schedulePush();   // Live Link: a merge is a write like any other
          return openResult(live(), validate(live()));
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      });
    },
  };
}
