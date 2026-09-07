// ---------------------------------------------------------------------------
// This app's user settings, over the shell's store.
//
// The STORE moved to @wildwinter/app-shell/app-store (2026-08-09): a settings
// file in userData follows from the app SHAPE rather than from storylets, and
// both apps in the family had written the same one - the same tolerant read,
// the same merged defaults, the same capped recents, the same panes, the same
// per-window bounds and pin, the same identity.
//
// What stays here is this app's own slice and the names it calls things by.
// `StudioState` is unchanged as far as the rest of the app is concerned: this
// class flattens the shell's core and our slice into the one object the IPC
// contract has always sent, so nothing outside this file had to move.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAppStore } from "@wildwinter/app-shell/app-store";
import type { AppStore } from "@wildwinter/app-shell/app-store";
import type { LastPlace, PaneState, StudioState, ThemeChoice, ViewMode, WindowBounds } from "../shared/api.js";

/** The settings that are OURS rather than the family's: everything the shell
 *  has no opinion about. */
interface StudioSlice {
  theme: ThemeChoice;
  autoRebuild: boolean;
  viewMode: ViewMode;
  boardFollow: boolean;
  /** The Board's List | Map choice. Defaulting to "map" is deliberate: a
   *  project WITH a map opens on it (the richer view), and the Board already
   *  forces "list" when the project has none, so the default costs a mapless
   *  project nothing. Remembered once the author chooses. */
  /** The Board's remembered place, PER PROJECT (keyed by path): the List |
   *  Map choice and which box its navigator was watching ("" = Everything,
   *  chosen; absent = never chose, the Board's default rule decides). One
   *  entry so the recents-follow prune covers both. */
  boardViews: Record<string, { view?: "list" | "map"; box?: string }>;
  showResolved: boolean;
  reviewWalk: boolean;
  coverageOverlay: boolean;
  navExpanded?: string[];
  mapGroups?: Record<string, string>;
  canvasCameras?: Record<string, { x: number; y: number; scale: number }>;
  /** The keys a pack exchange was paired with, by address and then by ROLE.
   *  Here and never in a project: a key belongs to the person at the keyboard,
   *  like the identity two fields up, and a shard that carried one would hand
   *  it to everybody the project is ever sent to. Sealed by the host when the
   *  OS offers somewhere to seal it (see `secret` on the constructor).
   *
   *  TWO SLOTS PER ADDRESS, because a person with both jobs holds two keys
   *  (design/engine-server.md 9.1 point 5). Keyed by address alone until
   *  2026-09-07, which meant pairing a second project as a designer overwrote
   *  the author key for the same server: the author's project then pulled as a
   *  designer, its sidecar flipped role, and the read-only rule on the shape
   *  went with it. A project uses the slot its own sidecar's role names. */
  servers?: Record<string, ServerSlots>;
}

/** The keys held for one address: at most one per role. A file written before
 *  the split holds a single key here instead, which is read as the one slot
 *  its own `role` names. */
export type ServerSlots = Partial<Record<ServerRole, StoredServerKey>> | StoredServerKey;

export type ServerRole = "author" | "designer";

/** One paired key. `role` rides along because the editor needs it before any
 *  call is made: it is what the shape shards are read-only under, and it is now
 *  also the slot the key sits in. */
export interface StoredServerKey {
  key: string;
  role: ServerRole;
  installation?: string;
}

/** Is this the pre-split shape: one key for the address, whatever its role? */
const isSingleKey = (slots: ServerSlots): slots is StoredServerKey =>
  typeof (slots as StoredServerKey).key === "string";

/** The slots at an address, with a pre-split single key read as the one slot it
 *  belongs in. Read-time only: nothing rewrites the file until a key is paired
 *  or forgotten, so an old file keeps working and a new one is written in the
 *  new shape the first time either happens. */
function slotsOf(slots: ServerSlots | undefined): Partial<Record<ServerRole, StoredServerKey>> {
  if (slots === undefined) return {};
  return isSingleKey(slots) ? { [slots.role]: slots } : slots;
}

// A deck opens on its NODE canvas: a deck is a web of cards that lead to each
// other, and the arrangement says more about it than an alphabetical wall of
// faces does. Cards and Table are one click away and the choice is remembered.
//
// A DEFAULT, so it reaches new state files only: whether an existing file's
// `viewMode` was chosen or merely never touched cannot be told apart, and
// leaving it alone is the answer that never overrules somebody.
const DEFAULTS: StudioSlice = {
  theme: "system", autoRebuild: false, viewMode: "node", boardFollow: false, boardViews: {}, showResolved: false,
  reviewWalk: false, coverageOverlay: false,
};

/** The helper windows, by the keys the shell stores them under. */
const BOARD = "board", SEARCH = "search", LINKS = "links", COVERAGE = "coverage";
const WINDOWS = [BOARD, SEARCH, LINKS, COVERAGE];

/**
 * Fold a pre-shell settings file into the shell's shape, once.
 *
 * The old file was flat - theme, viewMode, boardPinned and boardBounds all at
 * the top level beside recents - and the shell keeps its own core apart from
 * the app's slice. `recents`, `lastProject` and `panes` are named the same and
 * survive on their own; everything else would silently revert to its default,
 * which is a small loss and an infuriating one (a theme and a window layout
 * somebody chose, gone with no explanation).
 *
 * Recognised by the absence of `app`, so it runs once and never again. Any
 * failure leaves the file alone: a settings migration is not worth failing to
 * start over.
 */
function migrateFlatFile(file: string): void {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (raw["app"] !== undefined) return;   // already the shell's shape

    const windows: Record<string, { bounds?: unknown; pinned?: boolean }> = {};
    const window = (key: string, pinnedKey: string, boundsKey: string): void => {
      const pinned = raw[pinnedKey] as boolean | undefined;
      const bounds = raw[boundsKey];
      if (pinned === undefined && bounds === undefined) return;
      windows[key] = { ...(pinned !== undefined ? { pinned } : {}), ...(bounds !== undefined ? { bounds } : {}) };
    };
    window("board", "boardPinned", "boardBounds");
    window("search", "searchPinned", "searchBounds");
    window("links", "linksPinned", "linksBounds");
    window("coverage", "coveragePinned", "coverageBounds");

    const keep = (key: string, as: string): Record<string, unknown> =>
      (raw[key] !== undefined ? { [as]: raw[key] } : {});
    const migrated = {
      recents: (raw["recents"] as string[] | undefined) ?? [],
      ...keep("lastProject", "lastProject"),
      ...keep("lastPlace", "place"),
      panes: (raw["panes"] as object | undefined) ?? {},
      ...keep("identity", "identity"),
      windows,
      app: {
        theme: (raw["theme"] as string | undefined) ?? DEFAULTS.theme,
        autoRebuild: (raw["autoRebuild"] as boolean | undefined) ?? DEFAULTS.autoRebuild,
        viewMode: (raw["viewMode"] as string | undefined) ?? DEFAULTS.viewMode,
        boardFollow: (raw["boardFollow"] as boolean | undefined) ?? DEFAULTS.boardFollow,
        showResolved: (raw["showResolved"] as boolean | undefined) ?? DEFAULTS.showResolved,
        reviewWalk: (raw["reviewWalk"] as boolean | undefined) ?? DEFAULTS.reviewWalk,
        coverageOverlay: (raw["coverageOverlay"] as boolean | undefined) ?? DEFAULTS.coverageOverlay,
        ...keep("navExpanded", "navExpanded"),
        ...keep("mapGroups", "mapGroups"),
        ...keep("canvasCameras", "canvasCameras"),
      },
    };
    writeFileSync(file, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  } catch {
    // No file yet, or one we cannot read or write: the store falls back to
    // defaults, which is what a first run looks like anyway.
  }
}

/**
 * Heal the legacy singular `place` key (app-shell <= 0.32.0). The shell's load
 * folds it into `places[lastProject]` with the LEGACY value winning, and never
 * deletes it, so one stale key from an old build permanently pins the restore
 * of whatever project is current: the author closes on deck A, reopens, and
 * lands wherever `place` froze months ago. Every navigation writes the right
 * entry and every launch clobbers it back, which is exactly the shape of the
 * report that found it ("only the view mode seems to persist").
 *
 * The heal is host-side and one-time: drop the singular key, keeping its value
 * only when the per-project entry does not exist (the fold the shell's merge
 * INTENDED). Reported upstream; this guards our users on the shell as it is.
 */
function healLegacyPlace(file: string): void {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (raw["place"] === undefined) return;
    const places = (raw["places"] as Record<string, unknown> | undefined) ?? {};
    const last = raw["lastProject"] as string | undefined;
    if (last !== undefined && places[last] === undefined) places[last] = raw["place"];
    raw["places"] = places;
    delete raw["place"];
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  } catch {
    // No file, or one we cannot touch: the store starts from defaults anyway.
  }
}

/** How a secret is held at rest. The host supplies the OS's own sealing where
 *  there is one; the default is the honest no-op, which is what a machine with
 *  no keychain has anyway. */
export interface SecretCodec {
  seal: (plain: string) => string;
  unseal: (sealed: string) => string | undefined;
}

const PLAIN: SecretCodec = { seal: (s) => s, unseal: (s) => s };

export class StudioStore {
  private readonly store: AppStore<LastPlace, StudioSlice>;
  private readonly secret: SecretCodec;

  constructor(dir: string, secret: SecretCodec = PLAIN) {
    this.secret = secret;
    migrateFlatFile(join(dir, "studio-state.json"));
    healLegacyPlace(join(dir, "studio-state.json"));
    this.store = createAppStore<LastPlace, StudioSlice>({
      dir,
      fileName: "studio-state.json",
      defaults: DEFAULTS,
      panes: { nav: true, inspector: false },
    });
  }

  /**
   * The flat shape the renderer has always been sent.
   *
   * The pins read `?? true` rather than being stored eagerly: a helper window
   * floats over the editor until somebody says otherwise, and a default that
   * lives in the reader cannot drift from a default that lives in the file.
   */
  get(): StudioState {
    const s = this.store.get();
    const windowBounds = (key: string): WindowBounds | undefined => s.windows[key]?.bounds;
    // The renderer's flat shape keeps its `boardView` field: computed for the
    // CURRENT project, "map" when it never chose (the Board falls back to List
    // when there is no map to show). The keyed record stays main-side.
    // `servers` is stripped with `boardViews`, and for a stronger reason than
    // shape: this object crosses to the renderer, and a key has no business
    // over there. What the renderer is told about a server is its status line.
    const { boardViews, servers, ...app } = s.app;
    void servers;
    const boardPlace = s.lastProject !== undefined ? boardViews[s.lastProject] : undefined;
    return {
      ...app,
      boardView: boardPlace?.view ?? "map",
      ...(boardPlace?.box !== undefined ? { boardBox: boardPlace.box } : {}),
      recents: s.recents,
      panes: {
        nav: s.panes.nav ?? true,
        inspector: s.panes.inspector ?? false,
        ...(s.panes.navW !== undefined ? { navW: s.panes.navW } : {}),
        ...(s.panes.inspW !== undefined ? { inspW: s.panes.inspW } : {}),
      },
      ...(s.lastProject !== undefined ? { lastProject: s.lastProject } : {}),
      // A place belongs to a PROJECT now, not to the app (app-shell 0.24.0): the
      // file keys them by path and drops one when its project ages off recents.
      // `placeOf()` with no argument means the current one, which is what the
      // renderer has always been sent.
      ...((): { lastPlace?: LastPlace } => { const place = this.store.placeOf(); return place !== undefined ? { lastPlace: place } : {}; })(),
      ...(s.identity !== undefined ? { identity: s.identity } : {}),
      boardPinned: s.windows[BOARD]?.pinned ?? true,
      searchPinned: s.windows[SEARCH]?.pinned ?? true,
      linksPinned: s.windows[LINKS]?.pinned ?? true,
      coveragePinned: s.windows[COVERAGE]?.pinned ?? true,
      ...(windowBounds(BOARD) !== undefined ? { boardBounds: windowBounds(BOARD) } : {}),
      ...(windowBounds(SEARCH) !== undefined ? { searchBounds: windowBounds(SEARCH) } : {}),
      ...(windowBounds(LINKS) !== undefined ? { linksBounds: windowBounds(LINKS) } : {}),
      ...(windowBounds(COVERAGE) !== undefined ? { coverageBounds: windowBounds(COVERAGE) } : {}),
    };
  }

  setTheme(theme: ThemeChoice): void { this.store.patchApp({ theme }); }
  setAutoRebuild(on: boolean): void { this.store.patchApp({ autoRebuild: on }); }
  setViewMode(mode: ViewMode): void { this.store.patchApp({ viewMode: mode }); }
  setBoardFollow(on: boolean): void { this.store.patchApp({ boardFollow: on }); }
  setBoardView(view: "list" | "map"): void { this.patchBoardPlace({ view }); }
  /** Which box the Board's navigator is watching ("" = Everything). */
  setBoardBox(box: string): void { this.patchBoardPlace({ box }); }
  private patchBoardPlace(patch: { view?: "list" | "map"; box?: string }): void {
    const s = this.store.get();
    if (s.lastProject === undefined) return;   // no project, nothing to key by
    const entry = s.app.boardViews[s.lastProject] ?? {};
    this.store.patchApp({ boardViews: { ...s.app.boardViews, [s.lastProject]: { ...entry, ...patch } } });
  }
  setShowResolved(on: boolean): void { this.store.patchApp({ showResolved: on }); }
  setReviewWalk(on: boolean): void { this.store.patchApp({ reviewWalk: on }); }
  setCoverageOverlay(on: boolean): void { this.store.patchApp({ coverageOverlay: on }); }

  setNavExpanded(ids: string[]): void { this.store.patchApp({ navExpanded: ids }); }
  setMapGroups(groups: Record<string, string>): void { this.store.patchApp({ mapGroups: groups }); }
  setCanvasCameras(cameras: Record<string, { x: number; y: number; scale: number }>): void {
    this.store.patchApp({ canvasCameras: cameras });
  }

  /** `name` is optional and STICKY: omitting it keeps whatever was known, so a
   *  second open through a route that does not have the name (the session's own
   *  bookkeeping) cannot blank the menu entry. */
  touchProject(path: string, name?: string): void { this.store.touchProject(path, name); this.pruneBoardViews(); }
  forgetProject(path: string): void { this.store.forgetProject(path); this.pruneBoardViews(); }
  /** Board view choices follow recents, the places rule: prune whenever the
   *  recents list changes, so forgetting a project forgets its choice too. */
  private pruneBoardViews(): void {
    const s = this.store.get();
    const kept = Object.fromEntries(Object.entries(s.app.boardViews)
      .filter(([path]) => s.recents.some((r) => r.path === path)));
    if (Object.keys(kept).length !== Object.keys(s.app.boardViews).length) this.store.patchApp({ boardViews: kept });
  }
  clearLastProject(): void { this.store.clearLastProject(); }
  setLastPlace(place: LastPlace): void { this.store.setPlace(place); }
  setPanes(panes: PaneState): void { this.store.setPanes(panes); }
  setIdentity(identity: { name: string; email?: string }): void { this.store.setIdentity(identity); }

  // --- the pack exchange's keys, by address and role --------------------------------
  // Kept whole rather than merged into: forgetting one has to actually remove
  // it, and a patch that only overwrote fields would leave a dead key in the
  // file for anyone reading it later.

  /** Unseal a stored key, or say there is none. A key we can no longer unseal
   *  (a keychain that moved machines) is a key that is gone: say so by having
   *  none, so the author is offered the dialog rather than a call that will be
   *  refused. */
  private unsealed(stored: StoredServerKey | undefined): StoredServerKey | undefined {
    if (stored === undefined) return undefined;
    const key = this.secret.unseal(stored.key);
    return key === undefined ? undefined : { ...stored, key };
  }

  /**
   * The key paired with this address for this role, unsealed, or nothing.
   *
   * With no role asked for, the answer is the address's only key: a caller
   * that has no role to match by (a pack offering its address before anything
   * has been opened) should not be handed one of two at random.
   */
  serverKey(address: string, role?: ServerRole): StoredServerKey | undefined {
    const slots = slotsOf(this.store.get().app.servers?.[address]);
    if (role !== undefined) return this.unsealed(slots[role]);
    const held = Object.values(slots);
    return held.length === 1 ? this.unsealed(held[0]) : undefined;
  }

  /** Which roles this address holds a key for. What "Forget this server" reads
   *  to say what it is about to forget. */
  serverRoles(address: string): ServerRole[] {
    return Object.keys(slotsOf(this.store.get().app.servers?.[address])) as ServerRole[];
  }

  /** Keep a key in its own role's slot, leaving the other role's alone. */
  setServerKey(address: string, entry: StoredServerKey): void {
    const servers = { ...this.store.get().app.servers };
    servers[address] = {
      ...slotsOf(servers[address]),
      [entry.role]: { ...entry, key: this.secret.seal(entry.key) },
    };
    this.store.patchApp({ servers });
  }

  /**
   * Forget this server: the key goes, and with it every piece of chrome that
   * depended on it.
   *
   * With a role, ONE slot goes and the other stays, which is what an author who
   * also designs at this venue means by forgetting the key the open project
   * uses. With no role, the address goes whole: there is no open project to
   * narrow it by, so leaving half of it behind would be forgetting a server
   * that then carries on appearing.
   */
  forgetServer(address: string, role?: ServerRole): void {
    const servers = { ...this.store.get().app.servers };
    const slots = slotsOf(servers[address]);
    if (role === undefined) {
      if (!(address in servers)) return;
      delete servers[address];
    } else {
      if (slots[role] === undefined) return;
      const kept = { ...slots };
      delete kept[role];
      if (Object.keys(kept).length === 0) delete servers[address];
      else servers[address] = kept;
    }
    this.store.patchApp({ servers });
  }

  setBoardPinned(on: boolean): void { this.store.setWindow(BOARD, { pinned: on }); }
  setSearchPinned(on: boolean): void { this.store.setWindow(SEARCH, { pinned: on }); }
  setLinksPinned(on: boolean): void { this.store.setWindow(LINKS, { pinned: on }); }
  setCoveragePinned(on: boolean): void { this.store.setWindow(COVERAGE, { pinned: on }); }
  setBoardBounds(bounds: WindowBounds): void { this.store.setWindow(BOARD, { bounds }); }
  setSearchBounds(bounds: WindowBounds): void { this.store.setWindow(SEARCH, { bounds }); }
  setLinksBounds(bounds: WindowBounds): void { this.store.setWindow(LINKS, { bounds }); }
  setCoverageBounds(bounds: WindowBounds): void { this.store.setWindow(COVERAGE, { bounds }); }

  /** Reset View's window half: forget every remembered rectangle so a window
   *  lost off a disconnected display comes back centred at its default size,
   *  and re-pin them all (the resting state a helper window starts in). */
  resetWindows(): void {
    for (const key of WINDOWS) this.store.setWindow(key, { bounds: undefined, pinned: true });
  }
}
