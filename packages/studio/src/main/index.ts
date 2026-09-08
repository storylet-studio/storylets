// ---------------------------------------------------------------------------
// Main process: window lifecycle, dialogs, and the IPC surface. All fs, ops
// and VC work happens here; the renderer sees only the typed contract in
// shared/api.ts. Hardened webPreferences (contextIsolation + sandbox), one
// preload bridge, quit when all windows close (no window-less process).
// ---------------------------------------------------------------------------

import { BrowserWindow, app, dialog, ipcMain, protocol, safeStorage, shell } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { hostname } from "node:os";
import { currentUserAsync, writeBinaryFile, writeTextFile, writeTextFiles } from "@wildwinter/simple-vc-lib";
import { openToolWindow, pinToolWindow, rescueToolWindow, savedWindowRect } from "@wildwinter/app-shell/tool-window";
import type { ToolWindowBounds } from "@wildwinter/app-shell/tool-window";
import { StudioStore } from "./store.js";
import type { SecretCodec } from "./store.js";
import { refreshMenu } from "./menu.js";
// The pack exchange (design/engine-server.md 9.1): three calls over plain HTTP
// for a project that came from a server, and nothing at all for one that did not.
import {
  addressOf, askLeave, contractBreaks, failed, forgetShardHashes, hashProject, leavePrompt, normaliseAddress,
  openPackBytes, packAddress, packProject, planConnect, planPull, pullPack, pushPack, menuState, projectStatusLine,
  pushedLine, reachable, readRemote, refusalPrompt, resolveLeave, unpushedShards, writeBase, writeRemote,
  levelLine, nothingToPush, serverProblems, ServerSession,
  LEAVE_SETTLE_MS, REMOTE_FILE,
} from "./remote.js";
import type { InAppPrompt, LeaveChoice, LeavePrompt, ProjectAnchor, PullPlan, RemoteRecord } from "./remote.js";
import { compileBundle, compileForLivePush, createProject, currentProjectHash, exportBundle, openProject, openResult, projectSettings, validate, vcStatus } from "./project.js";
import { createLiveLinkServer, type LiveLinkServer } from "./live-link.js";   // Live Link
import { setProjectWrittenListener } from "./mutate.js";   // Live Link: refresh a connected game after a write
import { spreadsheetExport } from "./spreadsheet.js";   // Publish Spreadsheet
import { playableExport } from "./playable.js";   // Publish Playable HTML
import { applyStates, captureBefore } from "./history.js";
// Launching from a shell: `storyletter <path> --at <where>` (Patterpad's shape).
import { launchLocation, launchLocationFromArgv, launchPathFromArgv, sameProject } from "./launch.js";
import {
  addCoverageDrivers, cardCatalogue, createBox, createCard, createDeck, createTagGroup, createTemplate,
  boxCatalogue, createHand, deleteBox, deleteCard, deleteDeck, deleteTagGroup, deleteHand, deleteTemplate, tagGroupDetail, duplicateBox, duplicateCard,
  duplicateDeck, duplicateTagGroup, duplicateHand, duplicateTemplate, handDetail, moveBox, moveCard, moveDeck, moveHand, templateDetail, redo, renameDeck,
  saveHand,
  declareProperty, deleteCommentMessage, repointTag,
  saveBox, saveCard, saveTagGroup, saveProjectSettings, saveTemplate, proposeDrivers, undo, moveCardsOnCanvas, createCardOnCanvas, layoutDeck,
  moveComment, postComment, setCanvasFurniture, setCommentResolved, setGroupSpatial, setZonePolygon, moveSitesOnMap, removeSitesFromMap, createZone, restackZone, addBackground, editBackground, restackBackground, removeBackground,
} from "./mutate.js";
// Find: the Property and Replace tabs
import { applyReplace, propertyUsage, propertyUsageMany, replacePreview } from "./replace.js";
import { analyseInfluence, canvasFurniture, cardNeighbourhood, cardPositions, clearCanonicalCache, describeContribution, mapSites, runCoverage, runCoverageAsync, projectFolderName, runPack, runUnpack, runUnpackMerge, sharedSpaces, PACK_EXTENSION, assetPath, orphanAssetPaths } from "@storylet-studio/ops";
import { clearParseCache } from "@storylet-studio/compiler";
import type { UnpackMergeResult } from "@storylet-studio/ops";
import { createJobHost } from "@wildwinter/app-shell/job";
import { createProjectSession } from "@wildwinter/app-shell/session";
import type { JobProgress } from "@wildwinter/app-shell/job";
import type { InfluenceEdge } from "@storylet-studio/ops";
import type { SourceBox } from "@storylet-studio/compiler";
import type { ProjectSession } from "./project.js";
import { SAVEFILE_SCHEMA, SAVE_SCHEMA, commentsOf, effectiveGameId, isSpatial, polygonOf, handBinding, markOf, marksOn, stacked, threadsFor, zOf, backgroundsOf, byDisplayOrder } from "@storylet-studio/model";
import type { Bundle, Comment, Frame, PropertyDecl, SaveFile, ScalarValue, StackMove } from "@storylet-studio/model";
import type { BackgroundEdit } from "./mutate.js";
import { ASSET_SCHEME, assetUrl } from "../shared/api.js";
import type {
  BoxEdit, BoxKit, BoxMapDto, CanvasFurnitureDto, CanvasRefDto, CardEdit, CommentDto, CommentMarkerDto, ReviewAt, ReviewItemDto, LastPlace, ConditionProperty, CoverageDriverDto, CoverageInfo, CoverageOverlayDto, CoverageReport, DeckGraph, GraphEdge, LinksView, MapSiteDto, MapZoneDto, TagGroupEdit, HandEdit, OpenResult, PackMergeSummary, PackOffer, ContractBreakDto, LeavePromptDto, LeaveSettledDto, MapBackgroundDto, PaneState, Problem, ProjectMapDto, ProjectSettingsDto, ReplaceOptions, SearchOpen, ServerPullResult, ServerPushResult, TemplateEdit, ThemeChoice, VcStatusDto, ViewMode, WindowBounds,
} from "../shared/api.js";
import { JOB_PROGRESS_CHANNEL, MAP_CANVAS, PROJECT_CHANGED } from "../shared/api.js";
import { configureUpdater, startBackgroundUpdateCheck } from "@wildwinter/app-shell/updater";

// Chromium has to be told about a scheme BEFORE `whenReady`, or `protocol.handle`
// serves a URL the renderer is not allowed to load: an unregistered scheme is
// treated as opaque, so an <img> pointing at one is refused before the handler is
// ever asked. `standard` gives it host/path parsing (the box id is the host),
// `secure` keeps a page loaded over it out of the mixed-content bucket, and
// `stream` is the point of the whole scheme - a 10MB site plan arriving in chunks
// rather than as one buffer. `supportFetchAPI` is what lets the renderer fetch()
// one directly, which is how a picture's size gets checked without decoding it.
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

// Opt-in remote debugging, for verifying a build without a person at the
// keyboard: with it on, the renderer can be inspected and driven over the
// devtools protocol on localhost. Off unless asked for, because it is a port
// into the app and no ordinary dev run needs one.
if (process.env["STORYLETTER_DEBUG_PORT"] !== undefined) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env["STORYLETTER_DEBUG_PORT"]);
}

let window: BrowserWindow | undefined;

/** The author has answered the leaving question (or there was none to ask), so
 *  the next close and the next quit go straight through (9.1). */
let leaving = false;

/**
 * Where a paired key is held at rest: the OS's own store where there is one.
 *
 * `safeStorage` is the keychain on macOS, DPAPI on Windows, and the desktop's
 * secret service on Linux; where none of them answers it says so, and the key
 * sits in the settings file as it would have anyway. Nothing here fails
 * because of it: a key that cannot be unsealed reads as no key, and the author
 * is offered the dialog rather than a call that would be refused.
 */
function osSecret(): SecretCodec {
  return {
    seal: (plain) => (safeStorage.isEncryptionAvailable()
      ? `sealed:${safeStorage.encryptString(plain).toString("base64")}`
      : plain),
    unseal: (sealed) => {
      if (!sealed.startsWith("sealed:")) return sealed;
      try {
        return safeStorage.decryptString(Buffer.from(sealed.slice("sealed:".length), "base64"));
      } catch {
        return undefined;
      }
    },
  };
}

let tableWindow: BrowserWindow | undefined;
let coverageWindow: BrowserWindow | undefined;
let searchWindow: BrowserWindow | undefined;
let linksWindow: BrowserWindow | undefined;
let store: StudioStore;
/** The last coverage report of this session, so the window reopens showing it. */
let lastCoverage: CoverageReport | undefined;
/** When `lastCoverage` finished. Held beside it rather than inside the report,
 *  which is the ops package's shape and is written to no file: the canvas needs
 *  to date its evidence, the report itself has no opinion about clocks. */
let lastCoverageAt: string | undefined;
/** A tab and query handed to Find as it opens, waiting to be collected at its boot. */
let searchSeed: SearchOpen | undefined;
/** Ask the editor to put its pending edits on disk, and resolve once it says
 *  so (or after a short wait if it cannot). Before a project-wide Replace, so
 *  an edit still in the air is neither lost nor written over the replacement.
 *  The editor answers "editor:flush" with "editor:flushed" (Patterpad's pair). */
let flushWaiters: Array<() => void> = [];
function flushEditor(): Promise<void> {
  return new Promise((resolve) => {
    if (!window || window.isDestroyed()) { resolve(); return; }
    flushWaiters.push(resolve);
    window.webContents.send("editor:flush");
    setTimeout(() => { const i = flushWaiters.indexOf(resolve); if (i >= 0) { flushWaiters.splice(i, 1); resolve(); } }, 1500);
  });
}
/** The card the editor currently has open, so the Links lens can follow it. */
let linkFocus: string | undefined;
/** Distinguishes one structural undo step from the next. */
let structCounter = 0;
const structKey = (): string => String(structCounter++);

// --- long jobs (the shared shell's kit) ----------------------------------------
// A coverage sweep of a few thousand runs is seconds of solid CPU. The kit runs
// it cooperatively: the sweep hands the event loop back between runs, so the
// windows keep painting, progress arrives, and Cancel is heard.
const COVERAGE_JOB = "coverage";
const jobs = createJobHost({
  // The kit hands us its channel name; we send on OURS, which the contract
  // declares and a test pins to the kit's, so the preload never has to import
  // the kit (see JOB_PROGRESS_CHANNEL in shared/api.ts).
  send: (_channel, payload: JobProgress) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(JOB_PROGRESS_CHANNEL, payload);
    }
  },
});

type CoverageRunOpts = { runs?: number; maxTurns?: number; seed?: number };

/** One coverage sweep as a cancellable job. A cancelled sweep still yields the
 *  runs it managed: a partial answer beats none, and the report says how many
 *  runs it is speaking for. */
async function coverageJob(opts: CoverageRunOpts): Promise<{ report: CoverageReport; name: string; cancelled?: boolean } | { error: string }> {
  if (!session) return { error: "no project open" };
  validate(session);   // re-read from disk first (files are the truth)
  const source = session.loaded.source;
  if (!source) return { error: "the project does not load" };
  const name = source.project.project.name;

  const outcome = await jobs.start(COVERAGE_JOB, async (ctx) =>
    runCoverageAsync(source, {
      ...opts,
      // Always, in the editor: the sweep feeds the Links window's observed-edge
      // overlay, and an author who ran a coverage test and then found that
      // overlay empty because they had run "the wrong kind" would be right to
      // call it broken. It costs about 1.7x on an operation that already has a
      // progress bar and a Cancel.
      observeEdges: true,
      shouldStop: () => ctx.cancelled,
      onRun: (done, total) => ctx.step(done, total),
    }));

  if ("error" in outcome) return outcome;
  const cancelled = "cancelled" in outcome;
  const report = outcome.value;
  if (!report) return { error: "coverage was cancelled before it began" };
  if (report.issues.some((i) => i.severity === "error")) {
    return { error: report.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") };
  }
  lastCoverage = report;
  lastCoverageAt = new Date().toISOString();
  // Tell the EDITOR, not just the window that asked. The sweep is run from the
  // Coverage window, and an overlay in the main window that kept showing the
  // previous run until something else happened to refresh it would be stale in
  // the one moment the author is most likely to be looking at it.
  if (window && !window.isDestroyed()) window.webContents.send("coverage:done");
  return { report, name, ...(cancelled ? { cancelled: true } : {}) };
}

/**
 * Where a shipped example lives.
 *
 * Two homes because there are two ways to run this. In development the repo's
 * own `examples/` is four levels up from the main bundle; in a packaged app
 * they are resources beside it. PACKAGING MUST CARRY `examples/` for the second
 * branch to find anything: `build.extraResources` in package.json copies the
 * Hamlet (minus its dist/) to `resources/examples/`, which is exactly where
 * `process.resourcesPath` points in a packaged app.
 */
function examplePath(name: string): string | undefined {
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, "examples", name);
    return existsSync(packaged) ? packaged : undefined;
  }
  // In development, WALK UP rather than counting directories. How far the repo
  // root is from the app path depends on the dev runner's layout, and a hard
  // "../../.." is a guess that fails silently by finding nothing - which looks
  // exactly like "no examples shipped".
  let dir = app.getAppPath();
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, "examples", name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

// --- Live Link (design/live-link.md) -------------------------------------------
// Created on first use (Patterpad's shape). The game's frames go to the Board
// window, which renders the game's run instead of its own in Live mode; the
// status goes to the editor (its bottom-right chip) and the Board (its banner
// and Live / Local switch), and re-ticks the menu item.
let liveLink: LiveLinkServer | undefined;
function ensureLiveLink(): LiveLinkServer {
  if (!liveLink) {
    liveLink = createLiveLinkServer({
      currentBuildHash: () => (session ? currentProjectHash(session) : null),
      onFrame: (frame) => { if (tableWindow && !tableWindow.isDestroyed()) tableWindow.webContents.send("liveLink:frame", frame); },
      onStatus: (status) => {
        for (const w of [window, tableWindow]) if (w && !w.isDestroyed()) w.webContents.send("liveLink:status", status);
        menu();   // keep the Play > Live Link tick in step
      },
    });
  }
  return liveLink;
}
const liveLinkOn = (): boolean => liveLink?.isOn() ?? false;
/** Live refresh: after a write, recompile and push to a connected game,
 *  debounced. Free when nothing is connected: the gate skips the compile, and
 *  pushBundle itself no-ops when the game already runs the exact build (it
 *  re-hellos with the new hash after applying). */
let livePushTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleLivePush(): void {
  if (!liveLink?.isOn() || liveLink.status().state !== "connected") return;
  clearTimeout(livePushTimer);
  livePushTimer = setTimeout(() => {
    if (!session) return;
    const out = compileForLivePush(session);
    if (out) liveLink?.pushBundle(out.hash, out.json);
  }, 500);
}

// --- the pack exchange, main's half (design/engine-server.md 9.1) -------------
//
// Every piece of this is gated on the OPEN PROJECT having come from a server
// and this app still holding the key for it. With no remote there is no Server
// menu, no status line, no role and no prompt on the way out: an editor that
// has never been pointed at one carries a single File item and nothing else.

/** What this sitting knows about where the open project stands with its server:
 *  the head revision, learned in the background so the status line can say
 *  "behind" without a call on the menu's own path, and the count last drawn.
 *  Dropped whole on a project switch - the rule and the reason are in
 *  remote.ts, beside the rest of the server state. */
const serverSession = new ServerSession();

interface ServerContext {
  dir: string; remote: RemoteRecord; address: string; key: string;
  /** The certificate every call to this address must come over, or "" where
   *  there is none to pin. */
  pin: string;
}

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
  const dir = session?.loaded.dir;
  if (dir === undefined) return undefined;
  const remote = readRemote(dir);
  if (remote === undefined) return undefined;
  const address = addressOf(remote);
  const held = store.serverKey(address, remote.role);
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
const standingOf = (ctx: ServerContext): { revision: number; edits: number; head?: number } => {
  const head = serverSession.head(ctx.dir);
  return {
    revision: ctx.remote.revision,
    edits: unpushedShards(ctx.dir),
    ...(head !== undefined ? { head } : {}),
  };
};

/** The name the project goes by, for the surfaces that name it. */
const projectName = (): string => session?.dto.name ?? "";

/** The window's suffix, which is the status line again so an author with the
 *  menu closed still knows - and it NAMES the project, because the one moment
 *  this matters is the moment a second one is arriving. Silent while the
 *  project is level, and silent always for a project with no server. */
function retitle(ctx: ServerContext | undefined, standing?: { revision: number; edits: number; head?: number }): void {
  if (!window || window.isDestroyed()) return;
  const stands = ctx === undefined ? undefined : standing ?? standingOf(ctx);
  window.setTitle(stands !== undefined && stands.edits > 0
    ? `Storyletter - ${projectStatusLine(projectName(), stands)}`
    : "Storyletter");
}

const menu = (): void => {
  const ctx = serverContext();
  const dir = session?.loaded.dir;
  const standing = ctx === undefined ? undefined : standingOf(ctx);
  serverSession.shownEdits = standing?.edits;
  refreshMenu(window, store.get(), liveLinkOn(), menuState(
    ctx?.remote, ctx !== undefined, standing?.edits ?? 0,
    dir !== undefined ? serverSession.head(dir) : undefined,
  ));
  retitle(ctx, standing);
};

/** After every write that lands - a commit, an undo, a redo - the count may
 *  have moved. Compared rather than rebuilt blindly, because a write happens on
 *  every autosave and a menu rebuild does not belong on that path. */
function noteProjectWritten(): void {
  const ctx = serverContext();
  const edits = ctx === undefined ? undefined : unpushedShards(ctx.dir);
  if (edits === serverSession.shownEdits) return;
  menu();
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
    menu();
  })();
}

/** A path the OS handed us before the window existed (open-file fires during
 *  cold launch on macOS), waiting for the renderer to collect it at boot. */
let pendingLaunchPath: string | undefined;

/** A `--at <where>` from the command line, waiting beside the path (or alone:
 *  a bare `storyletter --at x` reopens the last project there). */
let pendingLaunchAt: string | undefined;

/** Explode a pack into a directory the author picks, then open that. A pack
 *  cannot be edited in place, so "opening" one always means unpacking it
 *  somewhere first, and that somewhere is never guessed. */
async function unpackToChosenDir(packPath: string): Promise<OpenResult | { error: string } | null> {
  const dirPick = await dialog.showOpenDialog(window!, {
    title: "Where should the project go?",
    message: "Choose a folder. The pack is unpacked into it as a project and opened.",
    buttonLabel: "Unpack Here",
    properties: ["openDirectory", "createDirectory"],
  });
  const target = dirPick.filePaths[0];
  if (dirPick.canceled || target === undefined) return null;
  try {
    const { shards, assets } = await runUnpack(readFileSync(packPath), target);
    // The record a server-issued pack carries is NOT written by this route. A
    // pack opened by file is an ordinary project until somebody connects: the
    // role it names would otherwise make the shape read-only in an editor that
    // has no server to explain it and no menu to act on it.
    const batch = writeTextFiles(shards
      .filter((w) => w.path !== join(target, REMOTE_FILE))
      .map((w) => ({ filePath: w.path, content: w.content })));
    if (!batch.success) {
      const first = batch.results.find((r) => !r.success);
      return { error: `could not write the unpacked project: ${first?.message ?? "unknown"}` };
    }
    // Assets go straight to disk rather than through the text writer: they are
    // bytes, and nothing downstream should be asked to diff or merge them.
    for (const asset of assets) {
      mkdirSync(dirname(asset.path), { recursive: true });
      writeFileSync(asset.path, asset.bytes);
    }
    return openAt(target);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Open whatever the OS passed us.
 *
 * A `.storyletpack` is a DELIVERY, never a project that can be opened in place,
 * so it unpacks (with a destination prompt) rather than being loaded; anything
 * else is treated as a project folder.
 *
 * A pack that NAMES AN ADDRESS is not opened here at all: it is handed back as
 * an offer, and the renderer asks the same question File ▸ Open Storyletpack
 * asks. A double-clicked pack and a picked one are the same pack, and until now
 * one of them quietly threw the address away.
 */
async function resolveLaunchPath(path: string): Promise<OpenResult | { error: string } | PackOffer | null> {
  if (!path.toLowerCase().endsWith(PACK_EXTENSION)) return openAt(path);
  const address = await readPackAddress(path);
  return address === undefined ? unpackToChosenDir(path) : { pack: { path, address } };
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

/** Bring the editor window to the front (a launch while we are running). */
function surfaceWindow(): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

/** Aim an opened project at a `--at` item. The renderer lands on `at` instead
 *  of the remembered place, through the same path a Find hit takes. Nothing
 *  matching is said on the terminal and the open goes ahead as it would have,
 *  so a stale id in a bug report cannot keep anyone out. */
function withLaunchLocation(
  result: OpenResult | { error: string } | PackOffer | null, query: string | undefined,
): OpenResult | { error: string } | PackOffer | null {
  // An offer has not opened anything yet, so there is nowhere to land: the `--at`
  // is dropped with the same silence a stale id gets.
  if (query === undefined || result === null || "error" in result || "pack" in result || !session) return result;
  const at = launchLocation(session.loaded, query);
  if (!at) { console.error(`--at: nothing in this project matches '${query}'`); return result; }
  return { ...result, at };
}

/** A `--at <where>` while a project is open: jump the running window, down the
 *  channel the Find window drives the editor with. */
function navigateInWindow(query: string): void {
  if (!window || window.isDestroyed() || !session) return;
  const at = launchLocation(session.loaded, query);
  if (!at) { console.error(`--at: nothing in this project matches '${query}'`); return; }
  window.webContents.send("search:navigate", at);
}

/** Open an OS- or shell-provided path in the running window (or hold it for
 *  boot when there is no window yet). A pack unpacks, with its destination
 *  prompt; anything else loads in place, landing on `at` when one rode in. */
function openInWindow(path: string, at?: string): void {
  if (!window || window.isDestroyed()) {
    pendingLaunchPath = path;      // the renderer collects it at boot
    if (at !== undefined) pendingLaunchAt = at;
    return;
  }
  void (async () => {
    const result = withLaunchLocation(await resolveLaunchPath(path), at);
    if (result === null) return;
    surfaceWindow();
    window?.webContents.send("project:opened", result);
  })();
}

// One running copy. A second `storyletter …` hands its command line to the
// window that is already open (second-instance) and quits, rather than
// starting a rival. This process's argv rides along in additionalData: on
// Windows the argv Chromium delivers to the event can drop or reorder user
// switches, so `--at` could vanish from it (Patterpad's finding).
// Windows ties a running window to its Start Menu shortcut (taskbar grouping,
// pinning, notifications) by AppUserModelID; electron-builder stamps the
// shortcut with package.json's build.appId, so the running app must claim the
// same string. No-op elsewhere. Patterpad sets it beside its lock, as here.
app.setAppUserModelId("studio.storylet.storyletter");

if (!app.requestSingleInstanceLock({ argv: process.argv })) {
  app.quit();
} else {
  // A path on OUR command line: Windows / Linux file associations, and
  // `storyletter <path>` on any platform. (macOS double-clicks arrive as
  // open-file instead, below; both feed the same pending path.)
  pendingLaunchPath = launchPathFromArgv(process.argv, app.isPackaged);
  pendingLaunchAt = launchLocationFromArgv(process.argv, app.isPackaged);

  app.on("second-instance", (_event, argv, _wd, additionalData) => {
    const forwarded = (additionalData as { argv?: string[] } | undefined)?.argv;
    const eff = forwarded?.length ? forwarded : argv;
    const path = launchPathFromArgv(eff, app.isPackaged);
    const at = launchLocationFromArgv(eff, app.isPackaged);
    if (path !== undefined && sameProject(path, session?.loaded.dir)) {
      // Already the open project: jump in place, never reload. A reload drops
      // the editor back to its landing page, and the jump would race it.
      if (at !== undefined) navigateInWindow(at);
      surfaceWindow();
    } else if (path !== undefined) {
      openInWindow(path, at);
    } else {
      // Bare `storyletter --at x` (or a bare relaunch): the project already open.
      if (at !== undefined) navigateInWindow(at);
      surfaceWindow();
    }
  });
}

// Registered before `whenReady`: on macOS an open-file can arrive before the
// app is ready, and preventDefault stops the OS default handling.
app.on("open-file", (event, path) => {
  event.preventDefault();
  openInWindow(path);
});

/**
 * Delete the assets no map uses any more.
 *
 * Safe because of what the project folder IS: internal to the project, filled by
 * an import that COPIED somebody's file from somewhere else. An orphan here is a
 * second copy by construction, version control has the history, and the only
 * reason to keep one was the live undo chain - undo an import and the file must
 * still be there.
 *
 * So this runs exactly where that chain ends: when a session is replaced, and
 * when the app quits. Never mid-session, where an undo might still want the
 * bytes, and never on OPEN either: a crash-orphaned file is harmless until the
 * next clean close, and sweeping something an author had just put in the folder
 * by hand would be a surprise for no gain.
 */
function sweepOrphanAssets(ending: ProjectSession | undefined): void {
  const source = ending?.loaded.source;
  if (!ending || !source) return;
  const orphans = orphanAssetPaths(ending.loaded.dir, source.boxes);
  for (const path of orphans) {
    try { rmSync(path); } catch { /* gone already, or read-only: not worth a word */ }
  }
  if (orphans.length > 0) {
    console.log(`swept ${orphans.length} unused asset${orphans.length === 1 ? "" : "s"}`);
  }
}

/**
 * Opening a project: the shell's sequence, with our four windows registered as
 * satellites so none of them can be forgotten.
 *
 * The shell (0.14.0) owns the order - open, forget on failure, close the
 * outgoing one, record the root, invalidate the satellites, rebuild the menu -
 * because both apps had written it and each had left a window out. Ours was the
 * Find window, which went on listing the previous project's cards until it next
 * took focus.
 */
const projects = createProjectSession<ProjectSession, OpenResult>({
  // Read through, not captured: `store` is built at whenReady, after this.
  store: {
    get: () => store.get(),
    touchProject: (path, name) => store.touchProject(path, name),
    forgetProject: (path) => store.forgetProject(path),
    clearLastProject: () => store.clearLastProject(),
  },
  open: (path) => {
    const result = openProject(path);
    if ("error" in result) return result;
    return {
      session: result.session,
      root: result.session.loaded.dir,
      // What the project calls itself, so Open Recent and the welcome screen can
      // name it rather than deriving a label from the folder (app-shell 0.25.0).
      // Returned rather than written to the store here: the session is the thing
      // that just opened it, so it records the name with the path in one go
      // (0.27.0, which closed the two-call dance this used to need).
      ...(result.session.loaded.source !== undefined
        ? { name: result.session.loaded.source.project.project.name }
        : {}),
      reply: openResult(result.session, result.problems),
    };
  },
  // The outgoing project's undo chain dies here, so its orphans can go with it.
  // The hook also drops main's own cross-IPC caches that describe the outgoing
  // project (the Patter side's close-hook lesson: the shell cannot know what a
  // host caches, and a stale pendingMerge would pass mergeCommit's session
  // guard against the WRONG project after a switch).
  close: (ending) => { sweepOrphanAssets(ending); pendingMerge = undefined; searchSeed = undefined; },
  refreshMenu: () => menu(),
  satellites: [
    // A cached report describes the project that produced it; a new project
    // underneath the Coverage window makes it a lie.
    { window: () => coverageWindow, channel: PROJECT_CHANGED, clear: () => { lastCoverage = undefined; lastCoverageAt = undefined; } },
    { window: () => linksWindow, channel: "links:focus", clear: () => { linkFocus = undefined; } },
    { window: () => searchWindow, channel: PROJECT_CHANGED },
    // The Table is the runtime's board: it holds a running simulation of the
    // project that was open when it started.
    { window: () => tableWindow, channel: PROJECT_CHANGED },
  ],
});

/** A mirror of `projects.current()`, refreshed at the one moment it can change.
 *  The handlers below read it a hundred times, and `session ? f(session) : ...`
 *  narrows where a function call would not. */
let session: ProjectSession | undefined;

/** The merge planned but not yet agreed to. Held only between `pack:mergePlan`
 *  and `pack:mergeCommit`, and dropped on either answer. */
let pendingMerge: UnpackMergeResult | undefined;

/** Both shard caches, dropped together.
 *
 *  The compiler's parse cache and ops' canonical-form cache are each keyed by
 *  shard path and validated by exact text, so they are bounded by ONE project
 *  and never go stale. A CLI run therefore never needs this. The editor is the
 *  host they were written for and it opens many projects in a session, so
 *  without this every project ever opened stays in memory: `clearParseCache`
 *  existed for exactly this and had no caller anywhere until now. */
function dropShardCaches(): void {
  clearParseCache();
  clearCanonicalCache();
  forgetShardHashes();
}

function openAt(path: string): OpenResult | { error: string } {
  // Before the new project's shards land, so the outgoing project's entries go
  // rather than accumulating across a session of switching.
  dropShardCaches();
  // EVERY PIECE OF SERVER STATE GOES WITH THE PROJECT IT DESCRIBES (2026-09-07).
  // A head learned in the background and a count last drawn are facts about the
  // project being left; keeping them meant the window said where the OLD project
  // stood while the new one was on screen.
  serverSession.forget();
  const reply = projects.openAt(path);
  session = projects.current();
  // ...and the menu the shell rebuilt DURING that open described the old project
  // too, because this mirror only becomes true on the line above. Drawn again
  // here, from the project that is actually open.
  menu();
  // A project that came from a server: ask in the background where the server
  // has got to. A no-op otherwise.
  refreshHead();
  return reply;
}

// --- the pack exchange: landing a pack, pulling, pushing ----------------------

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
  const dirPick = await dialog.showOpenDialog(window!, {
    title: "Where should the project go?",
    message: "Choose a folder. The pack is unpacked into it as a project and opened.",
    buttonLabel: "Unpack Here",
    properties: ["openDirectory", "createDirectory"],
  });
  const target = dirPick.filePaths[0];
  return dirPick.canceled || target === undefined ? null : target;
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

/** The other half of landing a pack, once the folder is settled. */
async function landPackAt(
  target: string, bytes: Buffer, remote: RemoteRecord | undefined,
): Promise<OpenResult | { error: string } | null> {
  try {
    const plan = await planPull(target, bytes, undefined);
    const failure = commitPlan(plan);
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
    return openAt(target);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Write a plan's shards, sidecars and pictures. Returns the reason it could
 *  not, or nothing. */
function commitPlan(plan: PullPlan): string | undefined {
  const batch = writeTextFiles([...plan.writes, ...plan.sidecars]
    .map((w) => ({ filePath: w.path, content: w.content })));
  if (!batch.success) {
    const first = batch.results.find((r) => !r.success);
    return `could not write the project: ${first?.message ?? "unknown"}`;
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
  if (ctx === undefined || session === undefined) return null;
  await flushEditor();   // a merge reads the working copy off disk
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
    const writes = [...plan.writes, ...plan.sidecars];
    const before = captureBefore(writes.map((w) => w.path));
    const failure = commitPlan(plan);
    if (failure !== undefined) return { error: failure };
    // ONE undo step for the whole pull, as the returned-pack merge is one: a
    // revision is one act, and unpicking it shard by shard would leave the
    // project in a state neither end ever had. A pull that wrote nothing -
    // everything of theirs is already what is here - records no step: an undo
    // that puts nothing back is not a step anybody wants on their stack.
    if (writes.length > 0) {
      session.history.record("Pull from server", `pull:${structKey()}`, before,
        writes.map((w) => ({ path: w.path, content: w.content })));
    }
    // Level with the server at ITS revision, and the base moves to what the
    // server sent rather than to what is now on disk: a merge that folded local
    // edits in leaves them unpushed, and they still differ from the pulled
    // revision, so they still count. Saying "in sync" over them would be a lie.
    writeRemote(ctx.dir, { ...ctx.remote, revision: head.revision, role: head.role });
    writeBase(ctx.dir, head.revision, plan.base);
    scheduleLivePush();
    menu();
    return {
      result: openResult(session, validate(session)),
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
  if (ctx === undefined || session === undefined) return null;
  await flushEditor();   // a pack is a snapshot of the FILES
  let pack: Buffer;
  try {
    pack = await packProject(ctx.dir);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const identity = store.get().identity;
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
      return { result: openResult(session, validate(session)), unchanged: pushed.error };
    }
    if (pushed.code === "conflict") writeRefusedSidecars(ctx.dir, pushed.details);
    const problems = [...validate(session), ...serverProblems(projectAnchor(session), pushed.error, pushed.details)];
    // The one refusal with a way through it: the far end named things this
    // change breaks, and a designer who meant it says so break by break.
    const breaks = pushed.code === "contract_break" ? contractBreaks(pushed.details) : [];
    return {
      result: openResult(session, problems),
      refusal: pushed.error,
      ...(breaks.length > 0 ? { breaks } : {}),
    };
  }
  serverSession.noteHead(ctx.dir, pushed.revision);
  writeRemote(ctx.dir, { ...ctx.remote, revision: pushed.revision });
  // The base moves to what was just sent, which is what is on disk: the pack
  // was made from these files a moment ago and nothing has touched them since.
  writeBase(ctx.dir, pushed.revision, hashProject(ctx.dir));
  menu();
  return {
    result: openResult(session, validate(session)),
    revision: pushed.revision,
    changed: pushed.changed?.length ?? 0,
  };
}

/**
 * Ask the question in the app's own dialog, when there is a renderer to ask.
 *
 * Nothing when there is not: the fallback below is what an unanswerable
 * question falls back to, and `askLeave` chooses between them.
 */
function inAppPrompt(): { ask: (prompt: LeavePrompt) => InAppPrompt; done: () => void } | undefined {
  const target = window;
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
      const up = (): void => drawn();
      const reply = (_event: unknown, index: unknown): void =>
        answered(typeof index === "number" ? index : prompt.cancelId);
      ipcMain.on("server:leave-shown", up);
      ipcMain.on("server:leave-reply", reply);
      clear = (): void => {
        ipcMain.removeListener("server:leave-shown", up);
        ipcMain.removeListener("server:leave-reply", reply);
      };
      // Buttons and nothing else cross: what each index MEANS stays this side.
      target.webContents.send("server:leave-prompt", {
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
  if (outcome.refusal !== undefined && window && !window.isDestroyed()) {
    // The problems bar already has it (the push wrote it there); this is the
    // window coming back to the front with the reason on it.
    window.webContents.send("project:opened", openResult(session!, [
      ...validate(session!), ...serverProblems(projectAnchor(session!), outcome.refusal, undefined),
    ]));
    if (breaks !== undefined && breaks.length > 0) {
      // The one refusal with a way through it: the push dialog opens on the
      // breaks to tick, down the same channel every other menu-driven dialog
      // opens on, and IS the answer to "why did nothing happen".
      window.webContents.send("menu", { cmd: "server-push", breaks });
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
  if (window && !window.isDestroyed()) {
    window.webContents.send("server:leave-settled", { message, holdMs } satisfies LeaveSettledDto);
  }
  await new Promise((resolve) => setTimeout(resolve, holdMs));
}

/** Take the leaving prompt down with nothing to say: cancelled, left, or
 *  refused. A renderer with no dialog up ignores it. */
function dropLeaveDialog(): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send("server:leave-settled", { holdMs: 0 } satisfies LeaveSettledDto);
  }
}

function wireIpc(): void {
  ipcMain.handle("state:get", () => store.get());

  ipcMain.handle("project:openDialog", async (): Promise<OpenResult | { error: string } | null> => {
    // Opening another project over one the server has not seen the whole of is
    // one of the three ways out that ask first (9.1).
    if (!(await mayLeaveProject("close"))) return null;
    const picked = await dialog.showOpenDialog(window!, {
      title: "Open a storylets project",
      message: "Choose your project's .storylets folder.",
      buttonLabel: "Open",
      properties: ["openDirectory", "treatPackageAsDirectory"],
    });
    const path = picked.filePaths[0];
    return path === undefined ? null : openAt(path);
  });

  // Only paths the app already knows: the last project and recents, which got
  // there through a native dialog run in main where a person picked them. A
  // renderer naming a directory of its own is not a route into the file system
  // (Patterpad's guard, which we did not have).
  ipcMain.handle("project:openPath", async (_event, path: string) => {
    if (!(await mayLeaveProject("close"))) return null;
    return projects.isKnownPath(path) ? openAt(path) : { error: "that project is not one of yours" };
  });

  ipcMain.handle("project:create", async (_event, name: string): Promise<OpenResult | { error: string } | null> => {
    if (!(await mayLeaveProject("close"))) return null;
    const picked = await dialog.showOpenDialog(window!, {
      title: "Choose where to create the project",
      // Patterpad's wording, and its shape: say what will be CREATED here,
      // naming it from the same rule that creates it (`projectFolderName`).
      message: `Storyletter will create "${projectFolderName(name)}" here.`,
      buttonLabel: "Create Here",
      properties: ["openDirectory", "createDirectory"],
    });
    const parent = picked.filePaths[0];
    if (parent === undefined) return null;
    const created = createProject(parent, name);
    if ("error" in created) return created;
    return openAt(created.path);
  });

  /**
   * Open a worked example: COPY it somewhere the author owns, then open that.
   *
   * Never opened in place. A bundled example lives inside the installed app,
   * which is read-only on macOS and replaced wholesale by the next update - so
   * editing it would either fail or be thrown away, and an example nobody can
   * poke at teaches half of what it could. The same reasoning, and the same
   * shape, as unpacking a pack: you cannot edit the envelope, so opening one
   * always means putting it somewhere first.
   */
  ipcMain.handle("example:open", async (_event, name: string): Promise<OpenResult | { error: string } | null> => {
    if (!(await mayLeaveProject("close"))) return null;
    const source = examplePath(name);
    if (source === undefined) return { error: `no example called "${name}" shipped with this build` };
    // `title` alone is INVISIBLE on macOS: the native open panel ignores it, so
    // the author saw a bare folder chooser and no reason for it. `message` is
    // the line macOS actually renders, and `buttonLabel` names the act - which
    // is Patterpad's convention on every dialog that asks for a folder.
    const picked = await dialog.showOpenDialog(window!, {
      title: "Where should your copy of the example go?",
      message: `Choose a folder. A copy of "${basename(source)}" goes into it and opens, yours to change.`,
      buttonLabel: "Copy Here",
      properties: ["openDirectory", "createDirectory"],
    });
    const parent = picked.filePaths[0];
    if (picked.canceled || parent === undefined) return null;
    const target = join(parent, basename(source));
    if (existsSync(target)) return { error: `there is already something called "${basename(source)}" there` };
    try {
      cpSync(source, target, { recursive: true });
    } catch (e) {
      return { error: `could not copy the example: ${e instanceof Error ? e.message : String(e)}` };
    }
    return openAt(target);
  });

  // Close Project: back to the no-project state and the welcome screen. The
  // shell owns the teardown order (close hook, satellites, menu, forget WHICH
  // while keeping recents); the tool windows then close outright, because a
  // Board or a Find over no project is not a stale view, it is a view of
  // nothing.
  ipcMain.handle("project:close", async (): Promise<boolean> => {
    if (!(await mayLeaveProject("close"))) return false;
    projects.closeCurrent();
    session = undefined;
    dropShardCaches();
    for (const w of [searchWindow, linksWindow, coverageWindow, tableWindow]) {
      if (w && !w.isDestroyed()) w.close();
    }
    // Live Link is a project facility: with no project there is nothing to
    // serve, so the server stops (a project SWITCH deliberately keeps it - the
    // running game follows the editor across builds via the re-hello). The
    // menu rebuild puts the Play > Live Link tick back in step.
    liveLink?.stop();
    menu();
    return true;
  });

  /** Show the project's folder in Finder / the file manager (Patterpad's
   *  `app:revealProject`, same one line). The renderer never names a path here:
   *  it reveals the OPEN project, whatever that is. */
  ipcMain.handle("project:reveal", (): void => {
    const dir = session?.loaded.dir;
    if (dir !== undefined) shell.showItemInFolder(dir);
  });

  ipcMain.handle("project:revalidate", (): OpenResult | null =>
    session ? openResult(session, validate(session)) : null);

  // The lock / read-only / out-of-date badges. Throttled + coalesced in vc.ts,
  // so the renderer may poll it freely.
  ipcMain.handle("project:vcStatus", (): Promise<VcStatusDto> | null =>
    (session ? vcStatus(session) : null));

  ipcMain.handle("state:setTheme", (_event, theme: ThemeChoice) => {
    store.setTheme(theme);
    menu();
    // Every open window, not just the one that asked. A tool window read the
    // theme once at boot and then kept it, so switching palette left the Find,
    // Links, Board and Coverage windows in the old one beside a re-themed editor.
    for (const w of [window, searchWindow, linksWindow, coverageWindow, tableWindow]) {
      if (w && !w.isDestroyed()) w.webContents.send("state:theme", theme);
    }
  });

  ipcMain.handle("state:setLastPlace", (_event, place: LastPlace) => store.setLastPlace(place));
  ipcMain.handle("state:setPanes", (_event, panes: PaneState) => { store.setPanes(panes); menu(); });
  ipcMain.handle("state:setAutoRebuild", (_event, on: boolean) => { store.setAutoRebuild(on); menu(); });
  ipcMain.handle("state:setViewMode", (_event, mode: ViewMode) => store.setViewMode(mode));
  ipcMain.handle("state:setNavExpanded", (_event, ids: string[]) => store.setNavExpanded(ids));
  ipcMain.handle("state:setMapGroups",
    (_event, groups: Record<string, string>) => store.setMapGroups(groups));
  ipcMain.handle("state:setCanvasCameras",
    (_event, cameras: Record<string, { x: number; y: number; scale: number }>) => store.setCanvasCameras(cameras));
  ipcMain.handle("project:settings", (): ProjectSettingsDto | null => (session ? projectSettings(session) : null));
  ipcMain.handle("project:saveSettings", (_event, dto: ProjectSettingsDto) =>
    (session ? saveProjectSettings(session, dto) : { error: "no project open" }));
  ipcMain.handle("box:create", (_e, kit: BoxKit) => (session ? createBox(session, kit) : { error: "no project open" }));
  ipcMain.handle("box:duplicate", (_e, boxId: string) => (session ? duplicateBox(session, boxId) : { error: "no project open" }));
  ipcMain.handle("box:delete", (_e, boxId: string) => (session ? deleteBox(session, boxId) : { error: "no project open" }));
  ipcMain.handle("box:move", (_e, boxId: string, targetId: string, before: boolean) => (session ? moveBox(session, boxId, targetId, before) : { error: "no project open" }));
  ipcMain.handle("deck:move", (_e, deckId: string, targetId: string, before: boolean) => (session ? moveDeck(session, deckId, targetId, before) : { error: "no project open" }));
  ipcMain.handle("hand:move", (_e, boxId: string, handId: string, targetId: string, before: boolean) => (session ? moveHand(session, boxId, handId, targetId, before) : { error: "no project open" }));

  ipcMain.handle("card:save", (_event, deckId: string, cardId: string, edit: CardEdit) =>
    (session ? saveCard(session, deckId, cardId, edit) : { error: "no project open" }));
  ipcMain.handle("card:create", (_event, deckId: string) =>
    (session ? createCard(session, deckId) : { error: "no project open" }));
  ipcMain.handle("card:duplicate", (_event, deckId: string, cardId: string) =>
    (session ? duplicateCard(session, deckId, cardId) : { error: "no project open" }));
  ipcMain.handle("card:delete", (_event, deckId: string, cardId: string) =>
    (session ? deleteCard(session, deckId, cardId) : { error: "no project open" }));
  ipcMain.handle("card:move", (_event, deckId: string, cardId: string, targetId: string, before: boolean) =>
    (session ? moveCard(session, deckId, cardId, targetId, before) : { error: "no project open" }));
  ipcMain.handle("card:catalogue", (_event, deckId: string): ConditionProperty[] =>
    (session ? cardCatalogue(session, deckId) : []));

  ipcMain.handle("deck:create", (_event, boxId: string) =>
    (session ? createDeck(session, boxId) : { error: "no project open" }));
  ipcMain.handle("deck:delete", (_event, deckId: string) =>
    (session ? deleteDeck(session, deckId) : { error: "no project open" }));
  ipcMain.handle("deck:rename", (_event, deckId: string, edit: { title?: string; gameId?: string }) =>
    (session ? renameDeck(session, deckId, edit) : { error: "no project open" }));

  ipcMain.handle("box:save", (_event, boxId: string, edit: BoxEdit) =>
    (session ? saveBox(session, boxId, edit) : { error: "no project open" }));

  // The problems bar's quick-fixes (storyletter.md section 4). Ordinary
  // mutations: one undo step each, and the bar re-validates after, so a fix that
  // uncovers a second problem says so straight away.
  ipcMain.handle("problem:declareProperty", (_event, scope: string, name: string, owner: string, guess?: { type: PropertyDecl["type"]; default: ScalarValue }) =>
    (session ? declareProperty(session, scope, name, owner, guess) : { error: "no project open" }));
  ipcMain.handle("problem:repointTag", (_event, holder: string, group: string, from: string, to: string) =>
    (session ? repointTag(session, holder, group, from, to) : { error: "no project open" }));

  ipcMain.handle("hand:detail", (_event, boxId: string, handId: string) =>
    (session ? handDetail(session, boxId, handId) : null));
  ipcMain.handle("hand:save", (_event, boxId: string, handId: string, edit: HandEdit) =>
    (session ? saveHand(session, boxId, handId, edit) : { error: "no project open" }));
  ipcMain.handle("hand:create", (_event, boxId: string) =>
    (session ? createHand(session, boxId) : { error: "no project open" }));
  ipcMain.handle("hand:delete", (_event, boxId: string, handId: string) =>
    (session ? deleteHand(session, boxId, handId) : { error: "no project open" }));
  ipcMain.handle("deck:duplicate", (_event, deckId: string) =>
    (session ? duplicateDeck(session, deckId) : { error: "no project open" }));
  ipcMain.handle("template:duplicate", (_event, boxId: string, templateId: string) =>
    (session ? duplicateTemplate(session, boxId, templateId) : { error: "no project open" }));
  ipcMain.handle("hand:duplicate", (_event, boxId: string, handId: string) =>
    (session ? duplicateHand(session, boxId, handId) : { error: "no project open" }));
  ipcMain.handle("tag-group:duplicate", (_event, boxId: string, groupId: string) =>
    (session ? duplicateTagGroup(session, boxId, groupId) : { error: "no project open" }));
  ipcMain.handle("box:catalogue", (_event, boxId: string) =>
    (session ? boxCatalogue(session, boxId) : []));
  ipcMain.handle("template:detail", (_event, boxId: string, templateId: string) =>
    (session ? templateDetail(session, boxId, templateId) : null));
  ipcMain.handle("template:save", (_event, boxId: string, templateId: string, edit: TemplateEdit) =>
    (session ? saveTemplate(session, boxId, templateId, edit) : { error: "no project open" }));
  ipcMain.handle("template:create", (_event, boxId: string) =>
    (session ? createTemplate(session, boxId) : { error: "no project open" }));
  ipcMain.handle("template:delete", (_event, boxId: string, templateId: string) =>
    (session ? deleteTemplate(session, boxId, templateId) : { error: "no project open" }));

  ipcMain.handle("tag-group:detail", (_event, boxId: string, groupId: string) =>
    (session ? tagGroupDetail(session, boxId, groupId) : null));
  ipcMain.handle("tag-group:save", (_event, boxId: string, groupId: string, edit: TagGroupEdit) =>
    (session ? saveTagGroup(session, boxId, groupId, edit) : { error: "no project open" }));
  ipcMain.handle("tag-group:create", (_event, boxId: string) =>
    (session ? createTagGroup(session, boxId) : { error: "no project open" }));
  ipcMain.handle("tag-group:delete", (_event, boxId: string, groupId: string) =>
    (session ? deleteTagGroup(session, boxId, groupId) : { error: "no project open" }));

  ipcMain.handle("edit:undo", (): OpenResult | null => (session ? undo(session) : null));
  ipcMain.handle("edit:redo", (): OpenResult | null => (session ? redo(session) : null));

  ipcMain.handle("table:open", () => openTable());
  ipcMain.handle("board:setPin", (_e, on: boolean) => {
    store.setBoardPinned(on);
    pinToolWindow(tableWindow, window, on);
  });

  // The Find window (Patterpad's detached search tool): it queries the
  // project itself (revalidate) and drives the editor here.
  // A seeded open: the window may not exist yet, so the query waits here for
  // the new window to ask for it at boot; an open window is told directly.
  ipcMain.handle("search:open", (_event, open?: SearchOpen) => {
    const already = searchWindow !== undefined && !searchWindow.isDestroyed();
    searchSeed = open;
    openSearch();
    if (already && open !== undefined) searchWindow!.webContents.send("search:seed", open);
  });
  ipcMain.handle("search:pendingQuery", (): SearchOpen | undefined => {
    const seed = searchSeed;
    searchSeed = undefined;
    return seed;
  });
  ipcMain.handle("search:setPin", (_e, on: boolean) => {
    store.setSearchPinned(on);
    pinToolWindow(searchWindow, window, on);
  });
  ipcMain.handle("search:reveal", (_e, selection: ReviewAt) => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.webContents.send("search:navigate", selection);
    }
  });
  // Find's Property tab: every read and write of a property.
  ipcMain.handle("search:propertyUsage", (_e, query: string) => (session ? propertyUsage(session, query) : []));
  ipcMain.handle("search:propertyUsageMany", (_e, queries: string[]) => (session ? propertyUsageMany(session, queries) : queries.map(() => [])));
  // Find's Replace tab. Preview is read-only. Apply first has the editor flush
  // its pending edits (Patterpad's flushEditorScene: they would otherwise be
  // lost under the rewrite, or land on top of it), then writes through the
  // mutation path as one undo step, then tells the editor to re-read.
  ipcMain.handle("editor:flushed", () => { const w = flushWaiters; flushWaiters = []; for (const r of w) r(); });
  ipcMain.handle("search:replacePreview", (_e, opts: ReplaceOptions) => (session ? replacePreview(session, opts) : { hits: [], items: 0 }));
  ipcMain.handle("search:replaceApply", async (_e, opts: ReplaceOptions) => {
    if (!session) return { error: "no project open" };
    await flushEditor();
    const r = applyReplace(session, opts);
    if (!("error" in r) && window && !window.isDestroyed()) window.webContents.send("replace:applied", r.count);
    return "error" in r ? r : { count: r.count, items: r.items };
  });
  ipcMain.handle("state:setBoardFollow", (_e, on: boolean) => store.setBoardFollow(on));
  ipcMain.handle("state:setBoardView", (_e, view: "list" | "map") => store.setBoardView(view));
  ipcMain.handle("state:setBoardBox", (_e, box: string) => store.setBoardBox(box));
  ipcMain.handle("search:close", () => searchWindow?.close());
  ipcMain.handle("view:resetWindows", () => rescueWindows());
  ipcMain.handle("table:bundle", (): { bundle: Bundle; name: string } | { error: string } =>
    (session ? compileBundle(session) : { error: "no project open" }));
  ipcMain.handle("project:hash", (): string | null => (session ? currentProjectHash(session) : null));

  // Live Link (design/live-link.md): the chip and Play > Live Link toggle the
  // server; the Board asks for the snapshot when it enters Live mode.
  ipcMain.handle("liveLink:start", () => { ensureLiveLink().start(); menu(); return ensureLiveLink().status(); });
  ipcMain.handle("liveLink:stop", () => { ensureLiveLink().stop(); menu(); return ensureLiveLink().status(); });
  ipcMain.handle("liveLink:status", () => ensureLiveLink().status());
  ipcMain.handle("liveLink:snapshot", () => ensureLiveLink().snapshot());
  ipcMain.handle("liveLink:follow", (_e, flowId: string) => {
    const link = ensureLiveLink();
    link.follow(flowId);
    return link.status();
  });

  // Session saves on disk: the .storyletsave round trip. File pickers are the
  // one legitimately native seam (design-language: dialogs themed, pickers OS).
  ipcMain.handle("table:exportSave", async (_e, file: SaveFile, suggestedName: string) => {
    const picked = await dialog.showSaveDialog(tableWindow ?? window!, {
      title: "Export the session state",
      defaultPath: `${suggestedName || "session"}.storyletsave`,
      filters: [{ name: "Storylets save", extensions: ["storyletsave"] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    // Land the export through the VC layer, like every other write: the author
    // may well be saving into the project's own repo, so a read-only or locked
    // target should be checked out (or its refusal surfaced), not choked on.
    try {
      const res = writeTextFile(picked.filePath, JSON.stringify(file, null, 2));
      return res.success ? { path: picked.filePath } : { error: res.message || res.status };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("table:importSave", async () => {
    const picked = await dialog.showOpenDialog(tableWindow ?? window!, {
      title: "Import a session state",
      message: "Choose a .storyletsave to load into the Board.",
      buttonLabel: "Import",
      filters: [{ name: "Storylets save", extensions: ["storyletsave"] }],
      properties: ["openFile"],
    });
    const path = picked.filePaths[0];
    if (path === undefined) return null;
    try {
      const file = JSON.parse(readFileSync(path, "utf8")) as SaveFile;
      if (file?.schema !== SAVEFILE_SCHEMA || file.engine?.schema !== SAVE_SCHEMA) {
        return { error: "not a storylets save file" };
      }
      return { file, name: basename(path, ".storyletsave") };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * The last run, projected for the canvas overlays.
   *
   * Built here rather than in the renderer because main is where the report
   * lives, and because the projection is the whole point: two numbers per card
   * and one per hand, instead of a report the overlay would have to mine on
   * every repaint.
   */
  ipcMain.handle("coverage:overlay", (): CoverageOverlayDto | undefined => {
    if (!lastCoverage || lastCoverageAt === undefined) return undefined;
    const cards: Record<string, { dealt: number; played: number }> = {};
    for (const card of lastCoverage.cards) cards[card.id] = { dealt: card.dealt, played: card.played };
    const hands: Record<string, number> = {};
    for (const hand of lastCoverage.hands) hands[hand.id] = hand.deals;
    return {
      at: lastCoverageAt,
      runs: lastCoverage.runs,
      cards,
      hands,
      // Relative to the busiest hand in THIS project. An absolute scale would
      // make every hand in a small project look cold and every hand in a big one
      // look hot, which says something about the run size rather than the design.
      busiest: lastCoverage.hands.reduce((most, h) => Math.max(most, h.deals), 0),
    };
  });
  ipcMain.handle("coverage:setOverlay", (_event, on: boolean) => { store.setCoverageOverlay(on); menu(); });
  ipcMain.handle("coverage:open", () => openCoverage());
  // The window is a tool window: it stays open while you edit, so the last
  // report is cached here and shown again on reopen (Patterpad's coverage
  // window). Opening a different project clears it, in openAt.
  ipcMain.handle("coverage:info", (): CoverageInfo => ({
    hasProject: session !== undefined,
    name: session?.loaded.source?.project.project.name ?? "",
    driverCount: Object.keys(session?.loaded.source?.project.coverage?.drivers ?? {}).length,
    pinned: store.get().coveragePinned,
    ...(lastCoverage ? { last: lastCoverage } : {}),
  }));
  ipcMain.handle("coverage:run", (_event, opts: CoverageRunOpts) => coverageJob(opts));
  ipcMain.handle("coverage:cancel", () => jobs.cancel(COVERAGE_JOB));
  ipcMain.handle("coverage:addDrivers", async (_event, opts: CoverageRunOpts) => {
    if (!session) return { error: "no project open" };
    const added = addCoverageDrivers(session);
    if ("error" in added) return added;
    const run = await coverageJob(opts);
    return "error" in run ? run : { ...run, added: added.added };
  });
  ipcMain.handle("coverage:propose", (): CoverageDriverDto[] => (session ? proposeDrivers(session) : []));
  ipcMain.handle("coverage:setPin", (_event, on: boolean) => {
    store.setCoveragePinned(on);
    pinToolWindow(coverageWindow, window, on);
  });
  // The Coverage window's "Coverage drivers..." button: bring the editor
  // forward with the settings dialog open where the drivers are edited.
  ipcMain.handle("settings:open", (_event, section: string) => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.focus();
      window.webContents.send("menu", { cmd: "project-settings", section });
    }
  });

  ipcMain.handle("bundle:export", () => (session ? exportBundle(session) : { error: "no project open" }));

  // Publish Spreadsheet: the readable workbook through a Save dialog (Patterpad's
  // exportReport shape: the op hands back bytes, main picks the path and lands
  // them through the VC layer, so a locked target is checked out, not choked on).
  ipcMain.handle("xlsx:export", async (): Promise<{ path: string } | { error: string } | null> => {
    if (!session) return { error: "no project open" };
    const out = await spreadsheetExport(session);
    if ("error" in out) return out;
    const picked = await dialog.showSaveDialog(window!, {
      title: "Publish Spreadsheet",
      defaultPath: out.defaultPath,
      filters: [{ name: "Excel spreadsheet", extensions: ["xlsx"] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    try {
      const res = writeBinaryFile(picked.filePath, out.buffer);
      return res.success ? { path: picked.filePath } : { error: res.message || res.status };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Publish Playable HTML: one self-contained page through a Save dialog
  // (Patterpad's exportPlayableHtml shape, the spreadsheet's write path).
  ipcMain.handle("html:export", async (): Promise<{ path: string } | { error: string } | null> => {
    if (!session) return { error: "no project open" };
    const out = playableExport(session);
    if ("error" in out) return out;
    const picked = await dialog.showSaveDialog(window!, {
      title: "Publish Playable HTML",
      defaultPath: out.defaultPath,
      filters: [{ name: "HTML page", extensions: ["html"] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    try {
      const res = writeTextFile(picked.filePath, out.html);
      return res.success ? { path: picked.filePath } : { error: res.message || res.status };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // --- the Links lens ---------------------------------------------------------
  // With a card: point the lens at THAT card and bring the window forward, which
  // is what "Links..." on a card means whether the window is open or not. Focus
  // first, so a window opening for the first time boots straight onto the right
  // card rather than showing the old one for a frame.
  ipcMain.handle("links:open", (_event, cardId?: string) => {
    if (cardId !== undefined) linkFocus = cardId;
    const already = linksWindow !== undefined && !linksWindow.isDestroyed();
    openLinks();
    if (cardId !== undefined && already) linksWindow!.webContents.send("links:focus", cardId);
    // A lens the author has just asked for should be in front of the editor even
    // when it is not pinned.
    if (already) linksWindow!.show();
  });
  ipcMain.handle("board:close", () => {
    if (tableWindow && !tableWindow.isDestroyed()) tableWindow.close();
  });
  ipcMain.handle("coverage:close", () => {
    if (coverageWindow && !coverageWindow.isDestroyed()) coverageWindow.close();
  });
  ipcMain.handle("links:close", () => {
    if (linksWindow && !linksWindow.isDestroyed()) linksWindow.close();
  });
  ipcMain.handle("links:setPin", (_event, on: boolean) => {
    store.setLinksPinned(on);
    pinToolWindow(linksWindow, window, on);
  });
  ipcMain.handle("links:setFocus", (_event, cardId: string | undefined) => {
    linkFocus = cardId;
    if (linksWindow && !linksWindow.isDestroyed()) linksWindow.webContents.send("links:focus", cardId);
  });
  ipcMain.handle("links:for", (_event, cardId?: string): LinksView => {
    const which = cardId ?? linkFocus;
    const base: LinksView = {
      hasProject: session !== undefined, card: undefined,
      predecessors: [], dependents: [], notes: [], pinned: store.get().linksPinned,
    };
    if (!session || which === undefined) return base;
    // Files are the truth, and a condition edited a second ago should show: the
    // analysis reads the live session, which mutate.ts keeps reloaded.
    const source = session.loaded.source;
    if (!source) return base;
    // Deck titles for the faces: the analyser reports a deck's internal id, and
    // the canvas draws titles (never ids or gameIds).
    const deckTitles = new Map<string, string>();
    for (const box of source.boxes) {
      for (const deck of box.decks) {
        deckTitles.set(deck.shard.deck.id, deck.shard.deck.title ?? deck.shard.deck.gameId ?? deck.shard.deck.id);
      }
    }
    const withDeck = (card: { id: string; gameId: string; title?: string; deck: string; box: string } | undefined): LinksView["card"] =>
      card === undefined ? undefined : { ...card, deckTitle: deckTitles.get(card.deck) ?? card.deck };

    const n = cardNeighbourhood(source, which);
    const asNeighbour = (x: { edge: InfluenceEdge; node: { id: string; gameId: string; title?: string; deck: string; box: string } | undefined }): LinksView["predecessors"][number] => ({
      card: withDeck(x.node),
      cls: x.edge.cls as LinksView["predecessors"][number]["cls"],
      // The analyser's own fields, passed straight through: the window phrases
      // and typesets them. It does not reason about them, and a joined sentence
      // would take away the only thing it can add.
      via: x.edge.via.map((v) => ({
        property: v.property, ...(v.flag ? { flag: v.flag } : {}),
        ...(v.outcome ? { outcome: v.outcome } : {}), ...(v.note ? { note: v.note } : {}),
      })),
    });
    // Evidence over inference, when a run exists (design/graphical-views.md 4).
    // Keyed on the PAIR: the report attributes each edge to an outcome too, and
    // several outcomes of the same card can open the same door, so the pair is
    // what a drawn edge means and the counts sum.
    const edges = lastCoverage?.observedEdges;
    const seen = new Map<string, { runs: number; count: number }>();
    for (const e of edges ?? []) {
      const key = `${e.from}\u0000${e.to}`;
      const found = seen.get(key);
      // runs: the most any single outcome was seen in, not the sum. Two
      // outcomes each seen in 30 of 60 runs are not 60 runs' worth of evidence.
      if (found) { found.runs = Math.max(found.runs, e.runs); found.count += e.count; }
      else seen.set(key, { runs: e.runs, count: e.count });
    }
    const observedFor = (from: string | undefined, to: string | undefined): { runs: number; count: number } | undefined =>
      from === undefined || to === undefined ? undefined : seen.get(`${from}\u0000${to}`);

    const predecessors = n.predecessors.map(asNeighbour).map((x) => {
      const o = observedFor(x.card?.id, which);
      return o ? { ...x, observed: o } : x;
    });
    const dependents = n.dependents.map(asNeighbour).map((x) => {
      const o = observedFor(which, x.card?.id);
      return o ? { ...x, observed: o } : x;
    });

    // Flagged: the run saw it and the analyser did not predict it. Two
    // derivations disagreeing means one of them is wrong, which is the whole
    // reason the overlay is worth having.
    const known = new Set([
      ...predecessors.map((x) => `p\u0000${x.card?.id}`),
      ...dependents.map((x) => `d\u0000${x.card?.id}`),
    ]);
    const cardById = new Map(source.boxes.flatMap((box) => box.decks.flatMap((deck) =>
      deck.shard.cards.map((c) => [c.id, { id: c.id, gameId: effectiveGameId(c), ...(c.title !== undefined ? { title: c.title } : {}), deck: deck.shard.deck.id, box: box.box.box.id }] as const))));
    const flagged: LinksView["predecessors"] = [];
    for (const [key, o] of seen) {
      const cut = key.indexOf("\u0000");
      const from = key.slice(0, cut);
      const to = key.slice(cut + 1);
      if (to === which && !known.has(`p\u0000${from}`)) {
        flagged.push({ card: withDeck(cardById.get(from)), cls: "enable", via: [], observed: o, flagged: true });
      }
      if (from === which && !known.has(`d\u0000${to}`)) {
        flagged.push({ card: withDeck(cardById.get(to)), cls: "enable", via: [], observed: o, flagged: true });
      }
    }

    return {
      ...base,
      card: withDeck(n.card),
      predecessors: [...predecessors, ...flagged.filter((f) => seen.get(`${f.card?.id}\u0000${which}`))],
      dependents: [...dependents, ...flagged.filter((f) => seen.get(`${which}\u0000${f.card?.id}`))],
      ...(lastCoverage && lastCoverageAt
        ? { evidence: { runs: lastCoverage.runs, at: lastCoverageAt } }
        : {}),
      notes: [...new Set(n.warnings.filter((w) => w.kind === "hand-scope-not-analysed").map((w) => w.message))],
    };
  });

  // The node view's edges (#56). One analysis of the whole project, partitioned
  // by whether an edge's ends are both in this deck, because the OUTSIDE count
  // is as load-bearing as the inside edges: a deck with no internal links is
  // perfectly normal (its cards answer to cards elsewhere), and a canvas that
  // only looked empty would read as broken. A second pass at deck scope would
  // just re-derive what this one already knows.
  ipcMain.handle("graph:deck", (_event, deckId: string): DeckGraph => {
    const base: DeckGraph = {
      hasProject: session !== undefined, positions: {}, edges: [], outsideLinks: 0,
      furniture: { frames: [] }, notes: [],
    };
    const source = session?.loaded.source;
    if (!source) return base;
    // The owning box, not just the deck: the arrangement lives in the box's
    // sidecar, so the canvas needs both.
    const box = source.boxes.find((b) => b.decks.some((d) => d.shard.deck.id === deckId));
    const deck = box?.decks.find((d) => d.shard.deck.id === deckId);
    if (!box || !deck) return base;
    const mine = new Set(deck.shard.cards.map((c) => c.id));
    const graph = analyseInfluence(source);
    const edges: GraphEdge[] = [];
    let outside = 0;
    for (const edge of graph.edges) {
      const from = mine.has(edge.from);
      const to = mine.has(edge.to);
      if (from && to) edges.push({ from: edge.from, to: edge.to, cls: edge.cls as GraphEdge["cls"] });
      else if (from || to) outside++;
    }
    return {
      ...base,
      // Where the author has put things. Sparse: the view lays out the rest.
      positions: cardPositions(box, deckId),
      furniture: furnitureDto(canvasFurniture(box, { kind: "deck", deck: deckId })),
      edges,
      outsideLinks: outside,
      notes: [...new Set(graph.warnings.filter((w) => w.kind === "hand-scope-not-analysed").map((w) => w.message))],
    };
  });

  ipcMain.handle("view:newCard", (_event, deckId: string, at: { x: number; y: number }, pinned: { id: string; x: number; y: number }[]) => {
    if (!session) return { error: "no project open" };
    return createCardOnCanvas(session, deckId, at, pinned);
  });

  ipcMain.handle("view:layout", (
    _event, deckId: string, ids: string[],
    current: { id: string; x: number; y: number }[],
    size: { width: number; height: number; gapX: number; gapY: number },
  ) => {
    if (!session) return { error: "no project open" };
    return layoutDeck(session, deckId, ids, current, size);
  });

  // Arranging: writes the box's `.storyletview` sidecar, never a content shard.
  // (The map's own arranging writes `.storyletmap` next door; see mutate.ts.)
  ipcMain.handle("view:moveCards", (_event, deckId: string, placements: { id: string; x: number; y: number }[]): OpenResult | { error: string } => {
    if (!session) return { error: "no project open" };
    return moveCardsOnCanvas(session, deckId, placements);
  });

  // --- the map (#55, the spatial template of play) -----------------------------
  // The map is the tag data seen from above: zones ARE the tags of a spatial group,
  // sites come from the box's map shard. Nothing here is computed, so the view
  // draws and does not reason.
  ipcMain.handle("map:box", (_event, boxId: string, groupId?: string): BoxMapDto => {
    const base: BoxMapDto = {
      hasProject: session !== undefined,
      groups: [], zones: [], undrawn: [], backgrounds: [], sites: [], unplaced: [],
      furniture: { frames: [] },
    };
    const source = session?.loaded.source;
    const box = source?.boxes.find((b) => b.box.box.id === boxId);
    if (!source || !box) return base;

    const spatial = box.tags.groups.filter(isSpatial);
    const groups = spatial.map((g) => ({ id: g.id, gameId: effectiveGameId(g) }));
    // The group asked for, else the box's first: opening the view should show a map
    // rather than ask which one before showing anything.
    const group = spatial.find((g) => g.id === groupId) ?? spatial[0];
    if (!group) return { ...base, groups };


    const zones: MapZoneDto[] = [];
    const undrawn: { id: string; gameId: string }[] = [];
    for (const tag of group.tags) {
      const polygon = polygonOf(tag);
      if (!polygon) { undrawn.push({ id: tag.id, gameId: effectiveGameId(tag) }); continue; }
      const z = zOf(tag);
      zones.push({ id: tag.id, gameId: effectiveGameId(tag), polygon, ...(z !== undefined ? { z } : {}) });
    }
    // The pictures behind the map, already in draw order and already checked
    // against the disk: a view should draw a placeholder, not discover a 404.
    const backgrounds: MapBackgroundDto[] = backgroundsOf(group).map((b) => {
      const full = assetPath(session!.loaded.dir, box, b.file);
      return {
        id: b.id, file: b.file, url: assetUrl(box.box.box.id, b.file),
        x: b.x, y: b.y, width: b.width, height: b.height,
        ...(b.opacity !== undefined ? { opacity: b.opacity } : {}),
        ...(b.hidden === true ? { hidden: true } : {}),
        ...(b.locked === true ? { locked: true } : {}),
        ...(full === undefined || !existsSync(full) ? { missing: true } : {}),
      };
    });

    // Sent in DRAW order, back to front, so every view paints the stack right by
    // painting the list in order and none of them has to know the rule.
    const drawn = stacked(zones);

    // A pin's ZONE comes from the hand, never from the ground under the pin: the
    // hand's own binding is what the runtime deals from, so it is what the map
    // must draw, and a second copy in the map shard could only go on to disagree.
    const placed = mapSites(box);
    const sites: MapSiteDto[] = [];
    const unplaced: { id: string; gameId: string }[] = [];
    for (const hand of box.hands.hands) {
      const at = placed[hand.id];
      if (!at) { unplaced.push({ id: hand.id, gameId: effectiveGameId(hand) }); continue; }
      const template = box.hands.templates.find((t) => t.id === hand.template);
      const binding = handBinding(hand, template, group.id);
      sites.push({
        id: hand.id, gameId: effectiveGameId(hand), x: at.x, y: at.y,
        ...(binding.kind !== "none" && binding.tag !== undefined ? { zone: binding.tag } : {}),
        rebinds: binding.editable,
        ...(binding.kind === "fixed" && template ? { fixedBy: effectiveGameId(template) } : {}),
      });
    }

    return {
      hasProject: true, groups, groupId: group.id, zones: drawn, undrawn, backgrounds, sites, unplaced,
      furniture: furnitureDto(canvasFurniture(box, { kind: "map" })),
    };
  });

  ipcMain.handle("map:project", (): ProjectMapDto[] => {
    const source = session?.loaded.source;
    if (!source) return [];
    // Boxes carrying the same place (ops sharedSpaces) get a shared stamp, so
    // the Board can draw the place ONCE with every member's hands on it.
    const spaces = sharedSpaces(source);
    const spaceOf = new Map<string, number>();
    spaces.forEach((space, i) => {
      for (const b of space.boxes) spaceOf.set(`${b}|${space.group}`, i);
    });
    const maps: ProjectMapDto[] = [];
    for (const box of source.boxes) {
      for (const group of box.tags.groups.filter(isSpatial)) {
        const space = spaceOf.get(`${effectiveGameId(box.box.box)}|${effectiveGameId(group)}`);
        maps.push({
          box: box.box.box.id, boxGameId: effectiveGameId(box.box.box),
          group: group.id, groupGameId: effectiveGameId(group),
          ...(space !== undefined ? { space } : {}),
        });
      }
    }
    return maps;
  });

  ipcMain.handle("map:setSpatial", (_event, boxId: string, groupId: string, on: boolean) => {
    if (!session) return { error: "no project open" };
    return setGroupSpatial(session, boxId, groupId, on);
  });
  ipcMain.handle("map:createZone", (_event, boxId: string, groupId: string, polygon: { x: number; y: number }[]) => {
    if (!session) return { error: "no project open" };
    return createZone(session, boxId, groupId, polygon);
  });
  ipcMain.handle("map:addBackground", async (
    _event, boxId: string, groupId: string,
    place: { view: { width: number; height: number }; scale: number; at: { x: number; y: number } },
  ) => {
    if (!session) return { error: "no project open" };
    // The picker is the one legitimately native seam (design-language: dialogs
    // themed, pickers OS), same as every other file choice in this app.
    const picked = await dialog.showOpenDialog(window!, {
      title: "Add a background",
      message: "A picture of the place, to map the content onto.",
      buttonLabel: "Add",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (picked.canceled || picked.filePaths[0] === undefined) return null;
    const from = picked.filePaths[0];
    try {
      const bytes = readFileSync(from);
      return addBackground(session, boxId, groupId, { name: basename(from), bytes }, place);
    } catch (e) {
      return { error: `could not read ${basename(from)}: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  ipcMain.handle("map:editBackground", (
    _event, boxId: string, groupId: string, backgroundId: string,
    edit: BackgroundEdit, opts: { coalesce?: boolean },
  ) => {
    if (!session) return { error: "no project open" };
    return editBackground(session, boxId, groupId, backgroundId, edit, opts);
  });
  ipcMain.handle("map:restackBackground", (
    _event, boxId: string, groupId: string, backgroundId: string, move: StackMove,
  ) => {
    if (!session) return { error: "no project open" };
    return restackBackground(session, boxId, groupId, backgroundId, move);
  });
  ipcMain.handle("map:removeBackground", (_event, boxId: string, groupId: string, backgroundId: string) => {
    if (!session) return { error: "no project open" };
    return removeBackground(session, boxId, groupId, backgroundId);
  });

  ipcMain.handle("map:restack", (
    _event, boxId: string, groupId: string, tagId: string, move: "front" | "forward" | "backward" | "back",
  ) => {
    if (!session) return { error: "no project open" };
    return restackZone(session, boxId, groupId, tagId, move);
  });
  ipcMain.handle("map:setPolygon", (
    _event, boxId: string, groupId: string, tagId: string, polygon: { x: number; y: number }[] | undefined,
  ) => {
    if (!session) return { error: "no project open" };
    return setZonePolygon(session, boxId, groupId, tagId, polygon);
  });
  ipcMain.handle("map:removeSites", (_event, boxId: string, handIds: string[]) => {
    if (!session) return { error: "no project open" };
    return removeSitesFromMap(session, boxId, handIds);
  });
  // --- threaded comments --------------------------------------------------------
  //
  // A thread hangs off ANY id, so the handler finds what an id belongs to before
  // it can answer. That lookup lives here rather than in the renderer because the
  // containment is the project's shape, not the view's.

  ipcMain.handle("comments:for", (_event, anchor: string): CommentDto[] => {
    const source = session?.loaded.source;
    if (!source) return [];
    for (const box of source.boxes) {
      const threads = threadsFor(box.notes, anchor);
      if (threads.length > 0) return threads;
    }
    return [];
  });
  ipcMain.handle("comments:post", (
    _event, anchor: string, threadId: string, body: string, mark?: { canvas: string; x: number; y: number },
  ) => {
    if (!session) return { error: "no project open" };
    // The author comes from the app's identity HERE rather than from the
    // renderer, so every message in a project agrees about who wrote it even if
    // a window has been open since before the name was set.
    const who = store.get().identity?.name?.trim();
    return postComment(session, anchor, threadId, who && who !== "" ? who : "Someone", body, mark);
  });
  ipcMain.handle("comments:resolve", (_event, threadId: string, resolved: boolean) => {
    if (!session) return { error: "no project open" };
    return setCommentResolved(session, threadId, resolved);
  });

  /**
   * The markers on one canvas, resolved so the renderer draws rather than
   * decides: which kind each is, its badge count, and its hover line.
   *
   * Searched across every box because a canvas name is unique project-wide (a
   * deck id, or `map:<boxId>`), and the renderer asking about "this canvas" does
   * not know or care which box's sidecar the threads landed in.
   */
  /**
   * Every thread in the project, resolved into somewhere the walk can GO.
   *
   * The lookup is here rather than in the renderer for the same reason the
   * marker resolution is: an anchor id says nothing about what it is, and the
   * containment that turns it into "Village, Arrival, Arrive at the Gate" is the
   * project's shape, not the view's.
   *
   * READING ORDER, not the shard's: boxes as the navigator lists them, then
   * decks, then cards, then each card's outcomes. A walk that jumped about would
   * make the count meaningless as a sense of progress.
   */
  ipcMain.handle("review:feedback", (_event, showResolved: boolean): ReviewItemDto[] => {
    const source = session?.loaded.source;
    if (!source) return [];
    const out: ReviewItemDto[] = [];
    for (const box of source.boxes) {
      const boxName = effectiveGameId(box.box.box);
      const threads = commentsOf(box.notes);
      // A thread dropped on EMPTY canvas is filed against the canvas's owner, so
      // the owner's pass and the canvas pass below would both claim it and the
      // walk would step through it twice. The canvas pass owns it: that is where
      // the marker is, and where the reviewer put it.
      const byAnchor = (anchor: string): Comment[] =>
        threads.filter((t) => t.anchor === anchor && t.mark?.canvas !== t.anchor);
      const add = (thread: Comment, at: ReviewAt, where: string): void => {
        if (thread.resolved === true && !showResolved) return;
        const first = thread.messages[0];
        out.push({
          thread: thread.id, anchor: thread.anchor, at, where,
          ...(thread.mark ? { canvas: thread.mark.canvas } : {}),
          author: first?.author ?? "", text: (first?.body ?? "").split("\n")[0] ?? "",
          ...(thread.resolved === true ? { resolved: true } : {}),
        });
      };

      for (const t of byAnchor(box.box.box.id)) add(t, { kind: "box", box: box.box.box.id }, boxName);
      for (const deck of box.decks) {
        const deckName = effectiveGameId(deck.shard.deck);
        for (const t of byAnchor(deck.shard.deck.id)) {
          add(t, { kind: "deck", box: box.box.box.id, deck: deck.shard.deck.id }, `${boxName} · ${deckName}`);
        }
        for (const card of deck.shard.cards) {
          const cardName = card.title ?? effectiveGameId(card);
          const at: ReviewAt = { kind: "card", box: box.box.box.id, deck: deck.shard.deck.id, card: card.id };
          for (const t of byAnchor(card.id)) add(t, at, `${boxName} · ${deckName} · ${cardName}`);
          for (const outcome of byDisplayOrder(card.outcomes)) {
            const name = outcome.title ?? effectiveGameId(outcome);
            for (const t of byAnchor(outcome.id)) {
              add(t, {
                kind: "outcome", box: box.box.box.id, deck: deck.shard.deck.id, card: card.id, outcome: outcome.id,
              }, `${boxName} · ${deckName} · ${cardName} · ${name}`);
            }
          }
        }
      }
      for (const hand of box.hands.hands) {
        for (const t of byAnchor(hand.id)) {
          add(t, { kind: "hand", box: box.box.box.id, hand: hand.id }, `${boxName} · ${effectiveGameId(hand)}`);
        }
      }
      for (const template of box.hands.templates) {
        for (const t of byAnchor(template.id)) {
          add(t, { kind: "template", box: box.box.box.id, template: template.id }, `${boxName} · ${effectiveGameId(template)}`);
        }
      }
      for (const group of box.tags.groups) {
        for (const t of byAnchor(group.id)) {
          add(t, { kind: "tagGroup", box: box.box.box.id, group: group.id }, `${boxName} · ${effectiveGameId(group)}`);
        }
      }
      // Threads anchored to a CANVAS rather than to a thing on it. They have no
      // editor of their own, so the walk opens the canvas: the deck's for a deck
      // canvas, the box's map for a map.
      for (const t of threads) {
        const canvas = t.mark?.canvas;
        if (canvas === undefined || t.anchor !== canvas) continue;
        const deck = box.decks.find((d) => d.shard.deck.id === canvas);
        if (deck) add(t, { kind: "deck", box: box.box.box.id, deck: deck.shard.deck.id }, `${boxName} · ${effectiveGameId(deck.shard.deck)} · canvas`);
        else if (canvas === `${MAP_CANVAS}${box.box.box.id}`) add(t, { kind: "box", box: box.box.box.id }, `${boxName} · map`);
      }
    }
    return out;
  });

  ipcMain.handle("comments:delete", (_event, threadId: string, index: number) =>
    (session ? deleteCommentMessage(session, threadId, index) : { error: "no project open" }));
  ipcMain.handle("comments:markers", (_event, canvas: string): CommentMarkerDto[] => {
    const source = session?.loaded.source;
    if (!source) return [];
    const out: CommentMarkerDto[] = [];
    for (const box of source.boxes) {
      for (const thread of marksOn(box.notes, canvas)) {
        const at = markOf(thread);
        if (!at) continue;
        // The first message that still SAYS something, and a count of the same:
        // a withdrawn message is a turn in the conversation, not something left
        // to read, so a marker whose opener was deleted previews what carried on
        // rather than showing a blank hover.
        const live = thread.messages.filter((m) => m.deleted !== true);
        const first = live[0];
        out.push({
          id: thread.id, x: at.x, y: at.y,
          ...(at.item !== undefined ? { item: at.item } : {}),
          open: thread.resolved === true ? 0 : live.length,
          gist: (first?.body ?? "").split("\n")[0] ?? "",
          author: first?.author ?? "",
        });
      }
    }
    return out;
  });
  ipcMain.handle("comments:move", (
    _event, threadId: string, canvas: string, x: number, y: number, item?: string,
  ) => {
    if (!session) return { error: "no project open" };
    return moveComment(session, threadId, canvas, x, y, item);
  });
  // Only http(s), and only from the renderer's own About/docs links: a URL is
  // the one input that can reach the rest of the machine.
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle("identity:get", () => store.get().identity);
  // What the VCS thinks the author is called, to OFFER when nothing is stored
  // (simple-vc-lib 0.4.1's currentUser, and the vc-current-user brief). Keyed to
  // the open project so it reads THAT working copy - git's user.name is
  // per-repository as often as not - and undefined when nothing is open or the
  // VCS cannot say, which the dialog treats as "ask with an empty box".
  ipcMain.handle("identity:offer", async (): Promise<string | undefined> => {
    const dir = session?.loaded.dir;
    if (dir === undefined) return undefined;
    try { return await currentUserAsync(dir); } catch { return undefined; }
  });
  ipcMain.handle("identity:set", (_event, identity: { name: string; email?: string }) => {
    store.setIdentity(identity);
  });
  ipcMain.handle("comments:showResolved", (_event, on: boolean) => { store.setShowResolved(on); menu(); });
  ipcMain.handle("review:setWalk", (_event, on: boolean) => { store.setReviewWalk(on); menu(); });

  ipcMain.handle("canvas:setFurniture", (
    _event, boxId: string, ref: CanvasRefDto, furniture: CanvasFurnitureDto, label: string, coalesce?: string,
  ) => {
    if (!session) return { error: "no project open" };
    return setCanvasFurniture(session, boxId, ref, furniture, label, coalesce);
  });
  ipcMain.handle("map:moveSites", (
    _event, boxId: string, groupId: string, placements: { id: string; x: number; y: number }[],
  ) => {
    if (!session) return { error: "no project open" };
    return moveSitesOnMap(session, boxId, groupId, placements);
  });

  // --- the send envelope (.storyletpack) --------------------------------------
  // A pack is a DELIVERY, not the canonical files, so all three of these go
  // through a file picker: nothing is ever written back to a pack silently, and
  // unpacking always names its own destination.
  ipcMain.handle("pack:export", async (): Promise<{ path: string } | { error: string } | null> => {
    if (!session) return { error: "no project open" };
    const name = session.loaded.source?.project.project.name ?? "project";
    const picked = await dialog.showSaveDialog(window!, {
      title: "Export as Storyletpack",
      defaultPath: `${name}${PACK_EXTENSION}`,
      filters: [{ name: "Storyletpack", extensions: ["storyletpack"] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    try {
      const bytes = await runPack(session.loaded.dir);
      const res = writeBinaryFile(picked.filePath, bytes);
      return res.success ? { path: picked.filePath } : { error: res.message || res.status };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Open Storyletpack, first half: choose the file, and say whether it names an
   * address.
   *
   * Two halves rather than one, because a pack that came from a server is a
   * pack you can either connect to or open flat, and only the author can say
   * which. A pack that names none is opened as it always was, in the second
   * call, with nobody asked anything.
   */
  ipcMain.handle("pack:choose", async (): Promise<{ path: string; address?: string } | null> => {
    const packPick = await dialog.showOpenDialog(window!, {
      title: "Open a Storyletpack",
      message: "Choose a .storyletpack to unpack into a project.",
      buttonLabel: "Choose",
      filters: [{ name: "Storyletpack", extensions: ["storyletpack"] }],
      properties: ["openFile"],
    });
    const packPath = packPick.filePaths[0];
    if (packPick.canceled || packPath === undefined) return null;
    const address = await readPackAddress(packPath);
    return address === undefined ? { path: packPath } : { path: packPath, address };
  });

  /** Open a chosen pack flat: the project only, with no record of where it came
   *  from. What Cancel on the connect dialog falls back to. */
  ipcMain.handle("pack:openAt", async (_event, path: string): Promise<OpenResult | { error: string } | null> => {
    if (!(await mayLeaveProject("close"))) return null;
    try {
      return await landPack(readFileSync(path), undefined);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // --- the pack exchange ------------------------------------------------------

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
  ipcMain.handle("server:connect", async (
    _event, address: string, code: string, fingerprint?: string,
  ): Promise<OpenResult | { error: string } | null> => {
    if (!(await mayLeaveProject("close"))) return null;
    // THE FOLDER FIRST (2026-09-07). A code is single use and is spent the
    // moment it is exchanged for a key, so asking where the project should go
    // afterwards meant a cancelled picker cost the author their code and left
    // them with nothing to show for it. Nothing is spent until there is
    // somewhere to put what comes back.
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
    if (landed !== null && !("error" in landed)) menu();
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
  ipcMain.handle("server:forget", (_event, address: string): void => {
    const dialled = normaliseAddress(address);
    const open = serverContext();
    if (open !== undefined && open.address === dialled) store.forgetServer(dialled, open.remote.role);
    else store.forgetServer(dialled);
    menu();
  });

  ipcMain.handle("server:pull", (): Promise<ServerPullResult> => serverPull());
  ipcMain.handle("server:push", (
    _event, note?: string, acknowledge?: string[],
  ): Promise<ServerPushResult> => serverPush({
    ...(note !== undefined ? { note } : {}),
    ...(acknowledge !== undefined ? { acknowledge } : {}),
  }));

  // Whatever the OS handed us at launch (a double-clicked project or pack), if
  // anything. The renderer asks first and falls back to the last project, so
  // boot order stays the renderer's decision.
  ipcMain.handle("project:launchTarget", async (): Promise<OpenResult | { error: string } | PackOffer | null> => {
    const path = pendingLaunchPath;
    const at = pendingLaunchAt;
    pendingLaunchPath = undefined;
    pendingLaunchAt = undefined;
    if (path !== undefined) return withLaunchLocation(await resolveLaunchPath(path), at);
    // A bare `storyletter --at <where>`: the last project, straight at that item.
    if (at !== undefined) {
      const last = store.get().lastProject;
      if (last !== undefined && existsSync(last)) return withLaunchLocation(openAt(last), at);
      console.error(`--at: no project to open at '${at}'`);
    }
    return null;
  });

  // PLAN, then commit, in two calls with the author's answer in between.
  //
  // The merge used to write as soon as the two files were picked, so a confirmation
  // could only ever have described what was ABOUT to be attempted. The op is pure,
  // which buys the better shape (the Patter side's, adopted here): run the whole
  // merge, show real counts and any provenance mismatch, and let the author back
  // out having seen them. The modal also sits BETWEEN the two calls, so it never
  // blocks inside the write queue.
  ipcMain.handle("pack:mergePlan", async (): Promise<{ summary: PackMergeSummary } | { error: string } | null> => {
    if (!session) return { error: "no project open" };
    const returnedPick = await dialog.showOpenDialog(window!, {
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
    const basePick = await dialog.showOpenDialog(window!, {
      title: "And the Storyletpack you sent them?",
      message: "Choose the .storyletpack you originally sent. It is the common ancestor, and the merge needs it.",
      buttonLabel: "Choose",
      filters: [{ name: "Storyletpack", extensions: ["storyletpack"] }],
      properties: ["openFile"],
    });
    const base = basePick.filePaths[0];
    if (basePick.canceled || base === undefined) return null;

    try {
      const merged = await runUnpackMerge(readFileSync(returned), readFileSync(base), session.loaded.dir);
      pendingMerge = merged;
      const summary: PackMergeSummary = {
        shards: merged.shards.map((s) => ({ path: s.path, added: s.added, conflicts: s.result?.conflicts.length ?? 0 })),
        conflicts: merged.conflicts,
        warnings: merged.warnings,
        assets: merged.assets.length,
        keptAssets: merged.keptAssets.length,
        ...(merged.provenance.message !== undefined ? { provenance: merged.provenance.message } : {}),
      };
      return { summary };
    } catch (e) {
      pendingMerge = undefined;
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** The author said no: forget the plan rather than leaving it committable. */
  ipcMain.handle("pack:mergeDrop", () => { pendingMerge = undefined; });

  /** Write the merge the author has just agreed to. Nothing else may sit between
   *  the plan and this: a project change would invalidate the plan's ancestor. */
  ipcMain.handle("pack:mergeCommit", (): OpenResult | { error: string } | null => {
    if (!session) return { error: "no project open" };
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
      const writes = [...merged.writes, ...merged.sidecars];
      const before = captureBefore(writes.map((w) => w.path));
      if (!applyStates(writes.map((w) => ({ path: w.path, content: w.content })))) {
        return { error: "could not write the merge (locked or read-only?)" };
      }
      // One undo step for the whole merge: a returned pack is one act, and
      // unpicking it shard by shard would be worse than useless.
      session.history.record("Merge returned storyletpack", `pack:${structKey()}`, before, writes.map((w) => ({ path: w.path, content: w.content })));
      // A write like any other, including to the server: the shards it changed
      // are shards the far end has not seen, and the count says so on its own.
      noteProjectWritten();
      scheduleLivePush();   // Live Link: a merge is a write like any other
      return openResult(session, validate(session));
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

// --- helper windows (the shared tool-window kit; Patterpad's shape) ------------

const BOARD_DEFAULT = { width: 1080, height: 760 };
const BOARD_MIN = { width: 720, height: 520 };
const SEARCH_DEFAULT = { width: 440, height: 480 };
const SEARCH_MIN = { width: 340, height: 240 };
const COVERAGE_DEFAULT = { width: 1080, height: 760 };
const COVERAGE_MIN = { width: 640, height: 420 };

/**
 * The four tool windows, as data.
 *
 * They were four near-identical `openX()` functions, and the differences
 * between them were all mistakes: only the Board forwarded its console to a dev
 * terminal, and Reset View rescued two of the four because it kept its own
 * list. Both of those are structurally impossible now - a window is a row, and
 * everything that walks the windows walks the rows.
 *
 * `get`/`set` close over the module variables rather than replacing them,
 * because the rest of the file reads `tableWindow` and friends by name.
 */
interface ToolWindowSpec {
  /** For the dev console prefix, and any future log line. */
  name: string;
  title: string;
  page: string;
  def: { width: number; height: number };
  min: { width: number; height: number };
  get: () => BrowserWindow | undefined;
  set: (w: BrowserWindow | undefined) => void;
  bounds: () => Parameters<typeof savedWindowRect>[0];
  remember: (b: ToolWindowBounds) => void;
  pinned: () => boolean;
}

const LINKS_DEFAULT = { width: 900, height: 560 };
const LINKS_MIN = { width: 520, height: 360 };

const TOOL_WINDOWS: ToolWindowSpec[] = [
  { name: "board", title: "The Board", page: "table.html",
    def: BOARD_DEFAULT, min: BOARD_MIN,
    get: () => tableWindow, set: (w) => { tableWindow = w; },
    bounds: () => store.get().boardBounds, remember: (b) => store.setBoardBounds(b),
    pinned: () => store.get().boardPinned },
  // A small, FRAMELESS, always-on-top helper (Patterpad's search tool window):
  // the editor stays live underneath while you step through hits.
  { name: "find", title: "Find", page: "search.html",
    def: SEARCH_DEFAULT, min: SEARCH_MIN,
    get: () => searchWindow, set: (w) => { searchWindow = w; },
    bounds: () => store.get().searchBounds, remember: (b) => store.setSearchBounds(b),
    pinned: () => store.get().searchPinned },
  // A lens, so it opens beside the editor and follows the selection rather
  // than holding a place of its own.
  { name: "links", title: "Links", page: "links.html",
    def: LINKS_DEFAULT, min: LINKS_MIN,
    get: () => linksWindow, set: (w) => { linksWindow = w; },
    bounds: () => store.get().linksBounds, remember: (b) => store.setLinksBounds(b),
    pinned: () => store.get().linksPinned },
  { name: "coverage", title: "Coverage", page: "coverage.html",
    def: COVERAGE_DEFAULT, min: COVERAGE_MIN,
    get: () => coverageWindow, set: (w) => { coverageWindow = w; },
    bounds: () => store.get().coverageBounds, remember: (b) => store.setCoverageBounds(b),
    pinned: () => store.get().coveragePinned },
];

/** Open (or focus) one tool window. Frameless throughout: each draws its own
 *  slim drag bar, remembers its bounds, and has a minimum size, which is the
 *  convention Find set and the other three were brought onto. */
function openToolWindowFor(spec: ToolWindowSpec): void {
  const opened = openToolWindow(spec.get(), {
    title: spec.title, page: spec.page, frame: false,
    rendererDir: rendererDir(), preload: preloadPath(),
    rect: savedWindowRect(spec.bounds(), spec.def, spec.min),
    min: spec.min,
    pinTo: () => window,
    pinned: spec.pinned(),
    remember: spec.remember,
  });
  spec.set(opened);
  opened.on("closed", () => { if (spec.get() === opened) spec.set(undefined); });
  // EVERY tool window, not just the Board: a renderer fault is invisible to a
  // scripted verifier otherwise, which is the whole reason watchInDev exists.
  watchInDev(opened, spec.name);
}

const byName = (name: string): ToolWindowSpec => {
  const found = TOOL_WINDOWS.find((s) => s.name === name);
  if (!found) throw new Error(`no tool window "${name}"`);
  return found;
};


const rendererDir = (): string => join(import.meta.dirname, "../renderer");
const preloadPath = (): string => join(import.meta.dirname, "../preload/index.cjs");

/** Reset View's window half: every tool window back to floating (re-pinned),
 *  default size, centred; remembered bounds cleared - so a window lost on a
 *  now-disconnected monitor comes back. */
function rescueWindows(): void {
  store.resetWindows();
  // Over the TABLE, so this cannot fall behind the window list again. It kept
  // its own copy and rescued two of the four, leaving Links and Coverage as the
  // only windows Reset View could not bring back from a dead monitor - which is
  // the one thing the command exists for.
  for (const spec of TOOL_WINDOWS) rescueToolWindow(spec.get(), spec.def);
  // ACTUALLY pin them, then tell them. Both halves were missing, in opposite
  // directions. `rescueToolWindow` restores, resizes, centres and raises, but it
  // never calls setAlwaysOnTop - `pinToolWindow` is the one that does - so the
  // store said pinned, the buttons were told pinned, and any window the author
  // had unpinned went on sitting behind the editor. Reset View has to make the
  // claim true before it makes it.
  for (const spec of TOOL_WINDOWS) {
    const w = spec.get();
    if (!w || w.isDestroyed()) continue;
    pinToolWindow(w, window, true);
    w.webContents.send("state:pinned", true);
  }
}

function openTable(): void { openToolWindowFor(byName("board")); }
function openSearch(): void { openToolWindowFor(byName("find")); }
function openLinks(): void { openToolWindowFor(byName("links")); }
function openCoverage(): void { openToolWindowFor(byName("coverage")); }

/**
 * In dev, put a window's console on the terminal.
 *
 * A renderer's errors are otherwise only visible in devtools, which needs a
 * person at the keyboard to open. That makes a whole class of fault - a blocked
 * subresource, a failed image, an exception during a paint - invisible to anyone
 * verifying a build from a script, which is exactly how the asset scheme shipped
 * with a CSP that forbade it. Dev only, and quiet unless something speaks.
 */
function watchInDev(win: BrowserWindow, name: string): void {
  if (process.env["ELECTRON_RENDERER_URL"] === undefined) return;
  win.webContents.on("console-message", (event) => {
    console.log(`[${name}] ${event.level}: ${event.message}`);
  });
  win.webContents.on("did-fail-load", (_e, code, description, url) => {
    console.log(`[${name}] load failed ${code} ${description} ${url}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.log(`[${name}] renderer gone: ${details.reason}`);
  });
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, "../preload/index.cjs"),
    },
  });
  window.once("ready-to-show", () => window?.show());
  // Closing the editor is one of the three ways out (9.1): with edits the
  // server has not seen, the close waits for an answer. `leaving` is what an
  // answered prompt sets so the second close goes straight through, and it is
  // also what Quit sets, so Cmd+Q asks once rather than twice.
  window.on("close", (event) => {
    if (leaving || window === undefined) return;
    event.preventDefault();
    void mayLeaveProject("quit").then((go) => {
      if (!go) return;
      leaving = true;
      window?.close();
    });
  });
  window.on("closed", () => { window = undefined; liveLink?.stop(); });   // closing the editor closes the live link
  watchInDev(window, "editor");

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

/**
 * Serve a box's background images to the renderer, over a scheme of our own.
 *
 * NOT over IPC, and the reason is in the file sizes: a site plan is a 2816x1536
 * PNG of about 10MB, and three of them is 30MB structure-cloned across the
 * bridge for a picture Chromium can stream off disk itself and cache. The
 * renderer just sets `img.src` and the browser does the rest.
 *
 * The authority stays HERE, though, which is the whole point of the scheme
 * existing rather than handing out `file://`. A URL is
 * `storylet-asset://<boxId>/<file>`, and both halves are checked against the
 * OPEN PROJECT: an unknown box, a name that is not a plain file name, or no
 * project at all, and nothing is served. So a renderer (or anything that gets to
 * run in one) can reach a box's own pictures and nothing else on the disk.
 */
function serveAssets(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url);
    // `host` is the box id, `pathname` the file. Both decoded, because a real
    // filename has spaces in it.
    const boxId = decodeURIComponent(url.host);
    const file = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const source = session?.loaded.source;
    const box = source?.boxes.find((b) => b.box.box.id === boxId);
    if (!session || !box) return new Response("no such box", { status: 404 });
    const full = assetPath(session.loaded.dir, box, file);
    if (full === undefined) return new Response("not a file name", { status: 400 });
    try {
      const bytes = await readFile(full);
      return new Response(bytes, {
        headers: {
          "content-type": contentTypeFor(file),
          // The bytes on disk never change under a given name (an import writes a
          // new name rather than replacing one in use), so let the renderer keep
          // it. A picture re-read on every repaint would be the whole reason for
          // this scheme, wasted.
          "cache-control": "max-age=3600",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

/** Furniture as the renderer sees it. The model's reader has already dropped
 *  anything malformed and put the rest in draw order; this only widens the
 *  optional keys into the DTO's shape. */
function furnitureDto(furniture: { frames?: Frame[] }): CanvasFurnitureDto {
  return { frames: (furniture.frames ?? []).map((r) => ({ ...r })) };
}

/** Enough of a guess for the images a floor plan arrives as. */
function contentTypeFor(file: string): string {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

void app.whenReady().then(() => {
  store = new StudioStore(app.getPath("userData"), osSecret());
  serveAssets();
  wireIpc();
  // Live Link: every saved edit reaches a connected game. And the unpushed
  // count may have moved with it, which the menu and the title say.
  setProjectWrittenListener(() => { scheduleLivePush(); noteProjectWritten(); });
  createWindow();
  menu();
  // Auto-update. `configureUpdater` FIRST, or every prompt is addressed to "This
  // app" and hung off whatever window happened to be focused (Patterpad's note,
  // and the reason the order is written down rather than assumed).
  configureUpdater({
    appName: "Storyletter",
    activeWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
  });
  // Let the window settle before the first check, then every six hours. The delay
  // is not cosmetic: the renderer registers its four updater handlers at boot, and
  // a prompt that arrives before them waits 300 seconds and then answers itself.
  setTimeout(startBackgroundUpdateCheck, 10_000);
  setInterval(startBackgroundUpdateCheck, 6 * 60 * 60 * 1000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit-clean on every platform: no window-less macOS process left hanging
// (the Patterpad stance, kept for family consistency).
app.on("window-all-closed", () => app.quit());

// The last chance to tidy: after this there is no undo chain to protect.
//
// And the last chance to ask, too. A push at quit stages a revision and
// advances nothing, so pushing half-done work is harmless; a push that is
// REFUSED leaves the app open on the problems bar, because a refusal reached
// at the moment of quitting is the one an author most needs to still be there
// to act on.
app.on("before-quit", (event) => {
  if (leaving) { sweepOrphanAssets(session); return; }
  event.preventDefault();
  void mayLeaveProject("quit").then((go) => {
    if (!go) return;
    leaving = true;
    app.quit();
  });
});
