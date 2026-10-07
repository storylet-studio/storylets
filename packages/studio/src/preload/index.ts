// ---------------------------------------------------------------------------
// The one narrow bridge: window.studio, implementing shared/api.ts. Nothing
// else crosses the boundary.
// ---------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from "electron";
import { JOB_PROGRESS_CHANNEL, PROJECT_CHANGED } from "../shared/api.js";
import type {
  BoxEdit, CardEdit, DeckEdit, TagGroupEdit, HandEdit, LastPlace, MapLayerPrefs, PaneState, ProjectSettingsDto, ReplaceOptions, ReviewAt, SearchOpen, TemplateEdit, StudioApi, ThemeChoice, ViewMode,
  ProjectKit, UpdaterPromptOptions,
  UpdaterDownloadProgress,
  InvokeArgs, InvokeChannel, InvokeResult, PushArgs, PushChannel, SendArgs, SendChannel,
} from "../shared/api.js";
import type { SaveFile } from "@storylet-studio/model";

/** Ask main, on a channel of the contract's (`INVOKE_CHANNELS`): the name, the
 *  arguments and the answer are all checked against the method it serves. */
const invoke = <C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>;

/** Hear main on a channel of the contract's (`PUSH_CHANNELS`), with its payload
 *  and not the event. Returns the way to stop listening. */
const listen = <C extends PushChannel>(channel: C, handler: (...payload: PushArgs<C>) => void): (() => void) => {
  const listener = (_event: unknown, ...payload: unknown[]): void => handler(...(payload as PushArgs<C>));
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
};

/** Tell main something without waiting (`SEND_CHANNELS`). */
const tell = <C extends SendChannel>(channel: C, ...args: SendArgs<C>): void => ipcRenderer.send(channel, ...args);

const api: StudioApi = {
  getState: () => invoke("state:get"),
  openProjectDialog: () => invoke("project:openDialog"),
  openProjectPath: (path: string) => invoke("project:openPath", path),
  revealProject: () => { void invoke("project:reveal"); },
  createProject: (name: string, kit?: ProjectKit) => invoke("project:create", name, kit),
  openExample: (name: string) => invoke("example:open", name),
  closeProject: () => invoke("project:close"),
  clearRecents: () => invoke("state:clearRecents"),
  revalidate: () => invoke("project:revalidate"),
  project: () => invoke("project:current"),
  vcStatus: () => invoke("project:vcStatus"),
  setTheme: (theme: ThemeChoice) => invoke("state:setTheme", theme),
  onTheme: (handler) => { listen("state:theme", handler); },
  onWindowPinned: (handler) => { listen("state:pinned", handler); },
  setLastPlace: (place: LastPlace) => invoke("state:setLastPlace", place),
  setPanes: (panes: PaneState) => invoke("state:setPanes", panes),
  setAutoRebuild: (on: boolean) => invoke("state:setAutoRebuild", on),
  setViewMode: (mode: ViewMode) => invoke("state:setViewMode", mode),
  setNavExpanded: (ids: string[]) => invoke("state:setNavExpanded", ids),
  setMapLayers: (groupId: string, prefs: MapLayerPrefs) => invoke("state:setMapLayers", groupId, prefs),
  setCardGroup: (boxId: string, page: "contents" | "deck", key: string) => invoke("state:setCardGroup", boxId, page, key),
  setCanvasCameras: (cameras: Record<string, { x: number; y: number; scale: number }>) =>
    invoke("state:setCanvasCameras", cameras),
  projectSettings: () => invoke("project:settings"),
  saveProjectSettings: (dto: ProjectSettingsDto) => invoke("project:saveSettings", dto),
  createBox: (kit) => invoke("box:create", kit),
  duplicateBox: (boxId: string) => invoke("box:duplicate", boxId),
  deleteBox: (boxId: string) => invoke("box:delete", boxId),
  moveBox: (boxId: string, targetId: string, before: boolean) => invoke("box:move", boxId, targetId, before),
  moveDeck: (deckId: string, targetId: string, before: boolean) => invoke("deck:move", deckId, targetId, before),
  moveHand: (boxId: string, handId: string, before_target: string, before: boolean) => invoke("hand:move", boxId, handId, before_target, before),
  saveBox: (boxId: string, edit: BoxEdit) => invoke("box:save", boxId, edit),
  boxCatalogue: (boxId: string) => invoke("box:catalogue", boxId),
  duplicateDeck: (deckId: string) => invoke("deck:duplicate", deckId),
  duplicateTemplate: (boxId: string, templateId: string) => invoke("template:duplicate", boxId, templateId),
  duplicateHand: (boxId: string, handId: string) => invoke("hand:duplicate", boxId, handId),
  duplicateTagGroup: (boxId: string, groupId: string) => invoke("tag-group:duplicate", boxId, groupId),
  handDetail: (boxId: string, handId: string) => invoke("hand:detail", boxId, handId),
  handCards: (boxId: string, handId: string) => invoke("hand:cards", boxId, handId),
  saveHand: (boxId: string, handId: string, edit: HandEdit) => invoke("hand:save", boxId, handId, edit),
  createHand: (boxId: string, site?: { x: number; y: number }, templateId?: string) => invoke("hand:create", boxId, site, templateId),
  deleteHand: (boxId: string, handId: string) => invoke("hand:delete", boxId, handId),
  templateDetail: (boxId: string, templateId: string) => invoke("template:detail", boxId, templateId),
  saveTemplate: (boxId: string, templateId: string, edit: TemplateEdit) => invoke("template:save", boxId, templateId, edit),
  createTemplate: (boxId: string) => invoke("template:create", boxId),
  deleteTemplate: (boxId: string, templateId: string) => invoke("template:delete", boxId, templateId),
  tagGroupDetail: (boxId: string, groupId: string) => invoke("tag-group:detail", boxId, groupId),
  saveTagGroup: (boxId: string, groupId: string, edit: TagGroupEdit) => invoke("tag-group:save", boxId, groupId, edit),
  createTagGroup: (boxId: string) => invoke("tag-group:create", boxId),
  createGroupAsMap: (boxId: string) => invoke("tag-group:createMap", boxId),
  deleteTagGroup: (boxId: string, groupId: string) => invoke("tag-group:delete", boxId, groupId),
  saveCard: (deckId: string, cardId: string, edit: CardEdit) => invoke("card:save", deckId, cardId, edit),
  createCard: (deckId: string, place?: string, zone?: string) => invoke("card:create", deckId, place, zone),
  duplicateCard: (deckId: string, cardId: string) => invoke("card:duplicate", deckId, cardId),
  moveCard: (deckId: string, cardId: string, targetId: string, before: boolean) => invoke("card:move", deckId, cardId, targetId, before),
  deleteCard: (deckId: string, cardId: string) => invoke("card:delete", deckId, cardId),
  deleteCards: (deckId: string, cardIds: string[]) => invoke("card:deleteMany", deckId, cardIds),
  deleteCardsAcross: (groups: { deckId: string; cardIds: string[] }[]) => invoke("card:deleteAcross", groups),
  cardCatalogue: (deckId: string) => invoke("card:catalogue", deckId),
  createDeck: (boxId: string) => invoke("deck:create", boxId),
  deleteDeck: (deckId: string) => invoke("deck:delete", deckId),
  renameDeck: (deckId: string, edit: DeckEdit) => invoke("deck:rename", deckId, edit),
  setDeckFocused: (on: boolean) => invoke("menu:setDeckFocused", on),
  undo: () => invoke("edit:undo"),
  redo: () => invoke("edit:redo"),
  openTable: () => invoke("table:open"),
  setBoardPinned: (on: boolean) => invoke("board:setPin", on),
  setBoardFollow: (on: boolean) => invoke("state:setBoardFollow", on),
  setBoardView: (view: "list" | "map") => invoke("state:setBoardView", view),
  setBoardBox: (box: string) => invoke("state:setBoardBox", box),
  openSearch: (open?: SearchOpen) => invoke("search:open", open),
  pendingSearchQuery: () => invoke("search:pendingQuery"),
  onSearchSeed: (handler) => { listen("search:seed", handler); },
  setSearchPinned: (on: boolean) => invoke("search:setPin", on),
  searchReveal: (selection: ReviewAt) => invoke("search:reveal", selection),
  closeSearch: () => invoke("search:close"),
  // Find's Property and Replace tabs
  propertyUsage: (query: string) => invoke("search:propertyUsage", query),
  propertyUsageMany: (queries: string[]) => invoke("search:propertyUsageMany", queries),
  replacePreview: (opts: ReplaceOptions) => invoke("search:replacePreview", opts),
  replaceApply: (opts: ReplaceOptions) => invoke("search:replaceApply", opts),
  onEditorFlush: (handler) => { listen("editor:flush", handler); },
  editorFlushed: () => invoke("editor:flushed"),
  onReplaceApplied: (handler) => { listen("replace:applied", handler); },
  onSearchNavigate: (handler) => { listen("search:navigate", handler); },
  resetWindows: () => invoke("view:resetWindows"),
  tableBundle: () => invoke("table:bundle"),
  projectHash: () => invoke("project:hash"),
  exportSave: (file: SaveFile, suggestedName: string) => invoke("table:exportSave", file, suggestedName),
  importSave: () => invoke("table:importSave"),
  openCoverage: () => invoke("coverage:open"),
  coverageInfo: () => invoke("coverage:info"),
  declareProperty: (scope, name, owner, guess) => invoke("problem:declareProperty", scope, name, owner, guess),
  repointTag: (holder, group, from, to) => invoke("problem:repointTag", holder, group, from, to),
  addOutcome: (card, gameId) => invoke("problem:addOutcome", card, gameId),
  createPatterScene: (card) => invoke("problem:createScene", card),
  planMapUpgrade: () => invoke("project:planMapUpgrade"),
  upgradeProjectMap: () => invoke("project:upgradeProjectMap"),
  coverageOverlay: () => invoke("coverage:overlay"),
  onCoverageDone: (handler) => listen("coverage:done", handler),
  setCoverageOverlay: (on) => invoke("coverage:setOverlay", on),
  coverageRun: (opts: { runs?: number; maxTurns?: number; seed?: number }) => invoke("coverage:run", opts),
  coverageAddDrivers: (opts: { runs?: number; maxTurns?: number; seed?: number }) => invoke("coverage:addDrivers", opts),
  coverageCancel: () => invoke("coverage:cancel"),
  proposeDrivers: () => invoke("coverage:propose"),
  onJobProgress: (handler) => { listen(JOB_PROGRESS_CHANNEL, handler); },
  setCoveragePinned: (on: boolean) => invoke("coverage:setPin", on),
  setCoverageOrder: (order) => invoke("coverage:setOrder", order),
  openProjectSettings: (section: string) => invoke("settings:open", section),
  onProjectChanged: (handler) => { listen(PROJECT_CHANGED, handler); },
  openLinks: (cardId?: string) => invoke("links:open", cardId),
  linksFor: (cardId?: string) => invoke("links:for", cardId),
  deckGraph: (deckId: string) => invoke("graph:deck", deckId),
  boxMap: (boxId: string, groupId?: string) => invoke("map:box", boxId, groupId),
  projectMaps: () => invoke("map:project"),
  projectMapView: () => invoke("map:view"),
  mapZone: (tagId: string) => invoke("map:zone", tagId),
  useProjectMap: (boxId: string, on: boolean, confirmed?: boolean) => invoke("map:use", boxId, on, confirmed),
  setBoxColour: (boxId: string, colour: number) => invoke("map:colour", boxId, colour),
  setGroupSpatial: (boxId: string, groupId: string, on: boolean) => invoke("map:setSpatial", boxId, groupId, on),
  createZone: (boxId: string, groupId: string, polygon: { x: number; y: number }[], name?: string) =>
    invoke("map:createZone", boxId, groupId, polygon, name),
  addBackground: (
    boxId: string, groupId: string,
    place: { view: { width: number; height: number }; scale: number; at: { x: number; y: number } },
  ) => invoke("map:addBackground", boxId, groupId, place),
  editBackground: (
    boxId: string, groupId: string, backgroundId: string,
    edit: { x?: number; y?: number; width?: number; height?: number; opacity?: number; hidden?: boolean; locked?: boolean },
    opts?: { coalesce?: boolean },
  ) => invoke("map:editBackground", boxId, groupId, backgroundId, edit, opts ?? {}),
  restackBackground: (boxId: string, groupId: string, backgroundId: string, move: "front" | "forward" | "backward" | "back") =>
    invoke("map:restackBackground", boxId, groupId, backgroundId, move),
  removeBackground: (boxId: string, groupId: string, backgroundId: string) =>
    invoke("map:removeBackground", boxId, groupId, backgroundId),
  restackZone: (boxId: string, groupId: string, tagId: string, move: "front" | "forward" | "backward" | "back") =>
    invoke("map:restack", boxId, groupId, tagId, move),
  setZonePolygon: (boxId: string, groupId: string, tagId: string, polygon: { x: number; y: number }[] | undefined) =>
    invoke("map:setPolygon", boxId, groupId, tagId, polygon),
  removeSitesFromMap: (boxId: string, handIds: string[]) => invoke("map:removeSites", boxId, handIds),
  moveSitesOnMap: (boxId: string, groupId: string, placements: { id: string; x: number; y: number }[]) =>
    invoke("map:moveSites", boxId, groupId, placements),
  commentsFor: (anchor) => invoke("comments:for", anchor),
  postComment: (anchor, threadId, body, mark) => invoke("comments:post", anchor, threadId, body, mark),
  setCommentResolved: (threadId, resolved) => invoke("comments:resolve", threadId, resolved),
  deleteComment: (threadId, index) => invoke("comments:delete", threadId, index),
  commentMarkers: (canvas) => invoke("comments:markers", canvas),
  reviewFeedback: (showResolved) => invoke("review:feedback", showResolved),
  setReviewWalk: (on) => invoke("review:setWalk", on),
  moveComment: (threadId, canvas, x, y, item) => invoke("comments:move", threadId, canvas, x, y, item),
  identity: () => invoke("identity:get"),
  offeredIdentity: () => invoke("identity:offer"),
  setIdentity: (identity) => invoke("identity:set", identity),
  setShowResolved: (on) => invoke("comments:showResolved", on),
  openExternal: (url) => invoke("shell:openExternal", url),
  appReady: () => tell("app:ready"),
  setCanvasFurniture: (boxId, ref, furniture, label, coalesce) =>
    invoke("canvas:setFurniture", boxId, ref, furniture, label, coalesce),
  moveCardsOnCanvas: (deckId: string, placements: { id: string; x: number; y: number }[]) =>
    invoke("view:moveCards", deckId, placements),
  createCardOnCanvas: (deckId: string, at: { x: number; y: number }, pinned: { id: string; x: number; y: number }[]) =>
    invoke("view:newCard", deckId, at, pinned),
  layoutDeck: (
    deckId: string, ids: string[], current: { id: string; x: number; y: number }[],
    size: { width: number; height: number; gapX: number; gapY: number },
  ) => invoke("view:layout", deckId, ids, current, size),
  setLinkFocus: (cardId: string | undefined) => invoke("links:setFocus", cardId),
  onLinkFocus: (handler) => { listen("links:focus", handler); },
  onLinkReset: (handler) => { listen("links:reset", handler); },
  setLinksPinned: (on: boolean) => invoke("links:setPin", on),
  closeLinks: () => invoke("links:close"),
  closeBoard: () => invoke("board:close"),
  onBoardAskClose: (handler) => { listen("board:askClose", handler); },
  closeCoverage: () => invoke("coverage:close"),
  exportBundle: (opts) => invoke("bundle:export", opts),
  exportXlsx: () => invoke("xlsx:export"),   // Publish Spreadsheet
  exportHtml: () => invoke("html:export"),   // Publish Playable HTML
  exportPack: () => invoke("pack:export"),
  shareScopes: () => invoke("project:shareScopes"),
  choosePatterProject: () => invoke("patter:choose"),
  editInPatterpad: (cardId: string, locate?: boolean) => invoke("patter:edit", cardId, locate),
  choosePack: () => invoke("pack:choose"),
  openPackAt: (path: string) => invoke("pack:openAt", path),
  // The pack exchange: three calls, and the key never crosses this bridge.
  connectServer: (address: string, code: string, fingerprint?: string) =>
    invoke("server:connect", address, code, fingerprint),
  forgetServer: (address: string) => invoke("server:forget", address),
  serverPull: () => invoke("server:pull"),
  serverPush: (note?: string, acknowledge?: string[]) =>
    invoke("server:push", note, acknowledge),
  mergePackPlan: () => invoke("pack:mergePlan"),
  mergePackCommit: () => invoke("pack:mergeCommit"),
  mergePackDrop: () => invoke("pack:mergeDrop"),
  launchTarget: () => invoke("project:launchTarget"),
  onProjectOpened: (handler) => { listen("project:opened", handler); },
  // Live Link (design/live-link.md)
  liveLinkStart: () => invoke("liveLink:start"),
  liveLinkStop: () => invoke("liveLink:stop"),
  liveLinkStatus: () => invoke("liveLink:status"),
  onLiveLinkStatus: (handler) => { listen("liveLink:status", handler); },
  liveLinkSnapshot: () => invoke("liveLink:snapshot"),
  liveLinkFollow: (flowId: string) => invoke("liveLink:follow", flowId),
  onLiveLinkFrame: (handler) => { listen("liveLink:frame", handler); },
  onMenu: (handler) => { listen("menu", handler); },

  // The way out of a project the server has not seen the whole of. Shaped like
  // the updater's prompt below: main sends the question, the renderer draws it
  // in the app's own dialog, and the answer goes back as a button index.
  onLeavePrompt: (handler) => {
    listen("server:leave-prompt", (opts) => {
      // TWO messages, not one. "shown" goes back at once and is how main tells a
      // renderer that is drawing the dialog from one that is not there at all;
      // the reply comes when somebody clicks, which is however long a person
      // takes. Timing the person instead put a native box on top of the dialog
      // after four seconds.
      let answer: Promise<number>;
      try { answer = handler(opts); } catch { answer = Promise.resolve(opts.cancelId); }
      tell("server:leave-shown");
      void answer.then(
        (idx) => tell("server:leave-reply", idx),
        () => tell("server:leave-reply", opts.cancelId),
      );
    });
  },

  // ...and what becomes of that dialog once it has been answered. It is held
  // open past the click, so somebody has to take it down: either with a closing
  // word (a push landed) or with nothing to say (cancelled, left, refused).
  onLeaveSettled: (handler) => { listen("server:leave-settled", handler); },

  // The auto-updater's four channels. The names are the shell's UPDATER_CHANNELS
  // values, written out literally rather than imported: this file is the sandbox
  // boundary and pulls in nothing it does not have to. If they ever disagree the
  // updater goes silent, so they are covered by a parity test.
  onUpdaterCheckDirty: (handler: () => boolean) => {
    ipcRenderer.on("updater:check-dirty", () => ipcRenderer.send("updater:dirty-reply", handler()));
  },
  onUpdaterSaveBeforeInstall: (handler: () => Promise<{ ok: boolean }>) => {
    ipcRenderer.on("updater:save-before-install", () => {
      void handler().then((r) => ipcRenderer.send("updater:save-done", r));
    });
  },
  onUpdaterPrompt: (handler: (opts: UpdaterPromptOptions) => Promise<number>) => {
    ipcRenderer.on("updater:prompt", (_event, opts: UpdaterPromptOptions) => {
      void handler(opts).then((idx) => ipcRenderer.send("updater:prompt-reply", idx));
    });
  },
  onUpdaterDownloadProgress: (handler: (p: UpdaterDownloadProgress) => void) => {
    ipcRenderer.on("updater:download-progress", (_event, p: UpdaterDownloadProgress) => handler(p));
  },
};

contextBridge.exposeInMainWorld("studio", api);
