// ---------------------------------------------------------------------------
// The one narrow bridge: window.studio, implementing shared/api.ts. Nothing
// else crosses the boundary.
// ---------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from "electron";
import { JOB_PROGRESS_CHANNEL, PROJECT_CHANGED } from "../shared/api.js";
import type { JobProgress } from "../shared/api.js";
import type {
  BoxEdit, CardEdit, DeckEdit, TagGroupEdit, HandEdit, LastPlace, LiveLinkFrame, LiveLinkStatus, MenuCommand, OpenResult, PaneState, ProjectSettingsDto, ReplaceOptions, ReviewAt, SearchOpen, TemplateEdit, StudioApi, ThemeChoice, ViewMode,
} from "../shared/api.js";
import type { SaveFile } from "@storylet-studio/model";

const api: StudioApi = {
  getState: () => ipcRenderer.invoke("state:get"),
  openProjectDialog: () => ipcRenderer.invoke("project:openDialog"),
  openProjectPath: (path: string) => ipcRenderer.invoke("project:openPath", path),
  revealProject: () => { void ipcRenderer.invoke("project:reveal"); },
  createProject: (name: string) => ipcRenderer.invoke("project:create", name),
  openExample: (name: string) => ipcRenderer.invoke("example:open", name),
  closeProject: () => ipcRenderer.invoke("project:close"),
  revalidate: () => ipcRenderer.invoke("project:revalidate"),
  vcStatus: () => ipcRenderer.invoke("project:vcStatus"),
  setTheme: (theme: ThemeChoice) => ipcRenderer.invoke("state:setTheme", theme),
  onTheme: (handler: (theme: ThemeChoice) => void) => {
    ipcRenderer.on("state:theme", (_event, theme: ThemeChoice) => handler(theme));
  },
  onWindowPinned: (handler: (pinned: boolean) => void) => {
    ipcRenderer.on("state:pinned", (_event, pinned: boolean) => handler(pinned));
  },
  setLastPlace: (place: LastPlace) => ipcRenderer.invoke("state:setLastPlace", place),
  setPanes: (panes: PaneState) => ipcRenderer.invoke("state:setPanes", panes),
  setAutoRebuild: (on: boolean) => ipcRenderer.invoke("state:setAutoRebuild", on),
  setViewMode: (mode: ViewMode) => ipcRenderer.invoke("state:setViewMode", mode),
  setNavExpanded: (ids: string[]) => ipcRenderer.invoke("state:setNavExpanded", ids),
  setMapGroups: (groups: Record<string, string>) => ipcRenderer.invoke("state:setMapGroups", groups),
  setCanvasCameras: (cameras: Record<string, { x: number; y: number; scale: number }>) =>
    ipcRenderer.invoke("state:setCanvasCameras", cameras),
  projectSettings: () => ipcRenderer.invoke("project:settings"),
  saveProjectSettings: (dto: ProjectSettingsDto) => ipcRenderer.invoke("project:saveSettings", dto),
  createBox: (kit) => ipcRenderer.invoke("box:create", kit),
  duplicateBox: (boxId: string) => ipcRenderer.invoke("box:duplicate", boxId),
  deleteBox: (boxId: string) => ipcRenderer.invoke("box:delete", boxId),
  moveBox: (boxId: string, targetId: string, before: boolean) => ipcRenderer.invoke("box:move", boxId, targetId, before),
  moveDeck: (deckId: string, targetId: string, before: boolean) => ipcRenderer.invoke("deck:move", deckId, targetId, before),
  moveHand: (boxId: string, handId: string, before_target: string, before: boolean) => ipcRenderer.invoke("hand:move", boxId, handId, before_target, before),
  saveBox: (boxId: string, edit: BoxEdit) => ipcRenderer.invoke("box:save", boxId, edit),
  boxCatalogue: (boxId: string) => ipcRenderer.invoke("box:catalogue", boxId),
  duplicateDeck: (deckId: string) => ipcRenderer.invoke("deck:duplicate", deckId),
  duplicateTemplate: (boxId: string, templateId: string) => ipcRenderer.invoke("template:duplicate", boxId, templateId),
  duplicateHand: (boxId: string, handId: string) => ipcRenderer.invoke("hand:duplicate", boxId, handId),
  duplicateTagGroup: (boxId: string, groupId: string) => ipcRenderer.invoke("tag-group:duplicate", boxId, groupId),
  handDetail: (boxId: string, handId: string) => ipcRenderer.invoke("hand:detail", boxId, handId),
  saveHand: (boxId: string, handId: string, edit: HandEdit) => ipcRenderer.invoke("hand:save", boxId, handId, edit),
  createHand: (boxId: string) => ipcRenderer.invoke("hand:create", boxId),
  deleteHand: (boxId: string, handId: string) => ipcRenderer.invoke("hand:delete", boxId, handId),
  templateDetail: (boxId: string, templateId: string) => ipcRenderer.invoke("template:detail", boxId, templateId),
  saveTemplate: (boxId: string, templateId: string, edit: TemplateEdit) => ipcRenderer.invoke("template:save", boxId, templateId, edit),
  createTemplate: (boxId: string) => ipcRenderer.invoke("template:create", boxId),
  deleteTemplate: (boxId: string, templateId: string) => ipcRenderer.invoke("template:delete", boxId, templateId),
  tagGroupDetail: (boxId: string, groupId: string) => ipcRenderer.invoke("tag-group:detail", boxId, groupId),
  saveTagGroup: (boxId: string, groupId: string, edit: TagGroupEdit) => ipcRenderer.invoke("tag-group:save", boxId, groupId, edit),
  createTagGroup: (boxId: string) => ipcRenderer.invoke("tag-group:create", boxId),
  deleteTagGroup: (boxId: string, groupId: string) => ipcRenderer.invoke("tag-group:delete", boxId, groupId),
  saveCard: (deckId: string, cardId: string, edit: CardEdit) => ipcRenderer.invoke("card:save", deckId, cardId, edit),
  createCard: (deckId: string) => ipcRenderer.invoke("card:create", deckId),
  duplicateCard: (deckId: string, cardId: string) => ipcRenderer.invoke("card:duplicate", deckId, cardId),
  moveCard: (deckId: string, cardId: string, targetId: string, before: boolean) => ipcRenderer.invoke("card:move", deckId, cardId, targetId, before),
  deleteCard: (deckId: string, cardId: string) => ipcRenderer.invoke("card:delete", deckId, cardId),
  cardCatalogue: (deckId: string) => ipcRenderer.invoke("card:catalogue", deckId),
  createDeck: (boxId: string) => ipcRenderer.invoke("deck:create", boxId),
  deleteDeck: (deckId: string) => ipcRenderer.invoke("deck:delete", deckId),
  renameDeck: (deckId: string, edit: DeckEdit) => ipcRenderer.invoke("deck:rename", deckId, edit),
  undo: () => ipcRenderer.invoke("edit:undo"),
  redo: () => ipcRenderer.invoke("edit:redo"),
  openTable: () => ipcRenderer.invoke("table:open"),
  setBoardPinned: (on: boolean) => ipcRenderer.invoke("board:setPin", on),
  setBoardFollow: (on: boolean) => ipcRenderer.invoke("state:setBoardFollow", on),
  setBoardView: (view: "list" | "map") => ipcRenderer.invoke("state:setBoardView", view),
  setBoardBox: (box: string) => ipcRenderer.invoke("state:setBoardBox", box),
  openSearch: (open?: SearchOpen) => ipcRenderer.invoke("search:open", open),
  pendingSearchQuery: () => ipcRenderer.invoke("search:pendingQuery"),
  onSearchSeed: (handler: (open: SearchOpen) => void) => {
    ipcRenderer.on("search:seed", (_event, open: SearchOpen) => handler(open));
  },
  setSearchPinned: (on: boolean) => ipcRenderer.invoke("search:setPin", on),
  searchReveal: (selection: ReviewAt) => ipcRenderer.invoke("search:reveal", selection),
  closeSearch: () => ipcRenderer.invoke("search:close"),
  // Find's Property and Replace tabs
  propertyUsage: (query: string) => ipcRenderer.invoke("search:propertyUsage", query),
  propertyUsageMany: (queries: string[]) => ipcRenderer.invoke("search:propertyUsageMany", queries),
  replacePreview: (opts: ReplaceOptions) => ipcRenderer.invoke("search:replacePreview", opts),
  replaceApply: (opts: ReplaceOptions) => ipcRenderer.invoke("search:replaceApply", opts),
  onEditorFlush: (handler: () => void) => { ipcRenderer.on("editor:flush", () => handler()); },
  editorFlushed: () => ipcRenderer.invoke("editor:flushed"),
  onReplaceApplied: (handler: (count: number) => void) => {
    ipcRenderer.on("replace:applied", (_event, count: number) => handler(count));
  },
  onSearchNavigate: (handler: (selection: ReviewAt) => void) => {
    ipcRenderer.on("search:navigate", (_event, selection: ReviewAt) => handler(selection));
  },
  resetWindows: () => ipcRenderer.invoke("view:resetWindows"),
  tableBundle: () => ipcRenderer.invoke("table:bundle"),
  projectHash: () => ipcRenderer.invoke("project:hash"),
  exportSave: (file: SaveFile, suggestedName: string) => ipcRenderer.invoke("table:exportSave", file, suggestedName),
  importSave: () => ipcRenderer.invoke("table:importSave"),
  openCoverage: () => ipcRenderer.invoke("coverage:open"),
  coverageInfo: () => ipcRenderer.invoke("coverage:info"),
  declareProperty: (scope, name, owner, guess) => ipcRenderer.invoke("problem:declareProperty", scope, name, owner, guess),
  repointTag: (holder, group, from, to) => ipcRenderer.invoke("problem:repointTag", holder, group, from, to),
  coverageOverlay: () => ipcRenderer.invoke("coverage:overlay"),
  onCoverageDone: (handler) => {
    const listener = (): void => handler();
    ipcRenderer.on("coverage:done", listener);
    return () => ipcRenderer.removeListener("coverage:done", listener);
  },
  setCoverageOverlay: (on) => ipcRenderer.invoke("coverage:setOverlay", on),
  coverageRun: (opts: { runs?: number; maxTurns?: number; seed?: number }) => ipcRenderer.invoke("coverage:run", opts),
  coverageAddDrivers: (opts: { runs?: number; maxTurns?: number; seed?: number }) => ipcRenderer.invoke("coverage:addDrivers", opts),
  coverageCancel: () => ipcRenderer.invoke("coverage:cancel"),
  proposeDrivers: () => ipcRenderer.invoke("coverage:propose"),
  onJobProgress: (handler: (progress: JobProgress) => void) => {
    ipcRenderer.on(JOB_PROGRESS_CHANNEL, (_event, progress: JobProgress) => handler(progress));
  },
  setCoveragePinned: (on: boolean) => ipcRenderer.invoke("coverage:setPin", on),
  openProjectSettings: (section: string) => ipcRenderer.invoke("settings:open", section),
  onProjectChanged: (handler: () => void) => {
    ipcRenderer.on(PROJECT_CHANGED, () => handler());
  },
  openLinks: (cardId?: string) => ipcRenderer.invoke("links:open", cardId),
  linksFor: (cardId?: string) => ipcRenderer.invoke("links:for", cardId),
  deckGraph: (deckId: string) => ipcRenderer.invoke("graph:deck", deckId),
  boxMap: (boxId: string, groupId?: string) => ipcRenderer.invoke("map:box", boxId, groupId),
  projectMaps: () => ipcRenderer.invoke("map:project"),
  setGroupSpatial: (boxId: string, groupId: string, on: boolean) => ipcRenderer.invoke("map:setSpatial", boxId, groupId, on),
  createZone: (boxId: string, groupId: string, polygon: { x: number; y: number }[]) =>
    ipcRenderer.invoke("map:createZone", boxId, groupId, polygon),
  addBackground: (
    boxId: string, groupId: string,
    place: { view: { width: number; height: number }; scale: number; at: { x: number; y: number } },
  ) => ipcRenderer.invoke("map:addBackground", boxId, groupId, place),
  editBackground: (
    boxId: string, groupId: string, backgroundId: string,
    edit: { x?: number; y?: number; width?: number; height?: number; opacity?: number; hidden?: boolean; locked?: boolean },
    opts?: { coalesce?: boolean },
  ) => ipcRenderer.invoke("map:editBackground", boxId, groupId, backgroundId, edit, opts ?? {}),
  restackBackground: (boxId: string, groupId: string, backgroundId: string, move: "front" | "forward" | "backward" | "back") =>
    ipcRenderer.invoke("map:restackBackground", boxId, groupId, backgroundId, move),
  removeBackground: (boxId: string, groupId: string, backgroundId: string) =>
    ipcRenderer.invoke("map:removeBackground", boxId, groupId, backgroundId),
  restackZone: (boxId: string, groupId: string, tagId: string, move: "front" | "forward" | "backward" | "back") =>
    ipcRenderer.invoke("map:restack", boxId, groupId, tagId, move),
  setZonePolygon: (boxId: string, groupId: string, tagId: string, polygon: { x: number; y: number }[] | undefined) =>
    ipcRenderer.invoke("map:setPolygon", boxId, groupId, tagId, polygon),
  removeSitesFromMap: (boxId: string, handIds: string[]) => ipcRenderer.invoke("map:removeSites", boxId, handIds),
  moveSitesOnMap: (boxId: string, groupId: string, placements: { id: string; x: number; y: number }[]) =>
    ipcRenderer.invoke("map:moveSites", boxId, groupId, placements),
  commentsFor: (anchor) => ipcRenderer.invoke("comments:for", anchor),
  postComment: (anchor, threadId, body, mark) => ipcRenderer.invoke("comments:post", anchor, threadId, body, mark),
  setCommentResolved: (threadId, resolved) => ipcRenderer.invoke("comments:resolve", threadId, resolved),
  deleteComment: (threadId, index) => ipcRenderer.invoke("comments:delete", threadId, index),
  commentMarkers: (canvas) => ipcRenderer.invoke("comments:markers", canvas),
  reviewFeedback: (showResolved) => ipcRenderer.invoke("review:feedback", showResolved),
  setReviewWalk: (on) => ipcRenderer.invoke("review:setWalk", on),
  moveComment: (threadId, canvas, x, y, item) => ipcRenderer.invoke("comments:move", threadId, canvas, x, y, item),
  identity: () => ipcRenderer.invoke("identity:get"),
  offeredIdentity: () => ipcRenderer.invoke("identity:offer"),
  setIdentity: (identity) => ipcRenderer.invoke("identity:set", identity),
  setShowResolved: (on) => ipcRenderer.invoke("comments:showResolved", on),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  setCanvasFurniture: (boxId, ref, furniture, label, coalesce) =>
    ipcRenderer.invoke("canvas:setFurniture", boxId, ref, furniture, label, coalesce),
  moveCardsOnCanvas: (deckId: string, placements: { id: string; x: number; y: number }[]) =>
    ipcRenderer.invoke("view:moveCards", deckId, placements),
  createCardOnCanvas: (deckId: string, at: { x: number; y: number }, pinned: { id: string; x: number; y: number }[]) =>
    ipcRenderer.invoke("view:newCard", deckId, at, pinned),
  layoutDeck: (
    deckId: string, ids: string[], current: { id: string; x: number; y: number }[],
    size: { width: number; height: number; gapX: number; gapY: number },
  ) => ipcRenderer.invoke("view:layout", deckId, ids, current, size),
  setLinkFocus: (cardId: string | undefined) => ipcRenderer.invoke("links:setFocus", cardId),
  onLinkFocus: (handler: (cardId: string | undefined) => void) => {
    ipcRenderer.on("links:focus", (_event, cardId: string | undefined) => handler(cardId));
  },
  setLinksPinned: (on: boolean) => ipcRenderer.invoke("links:setPin", on),
  closeLinks: () => ipcRenderer.invoke("links:close"),
  closeBoard: () => ipcRenderer.invoke("board:close"),
  closeCoverage: () => ipcRenderer.invoke("coverage:close"),
  exportBundle: () => ipcRenderer.invoke("bundle:export"),
  exportXlsx: () => ipcRenderer.invoke("xlsx:export"),   // Publish Spreadsheet
  exportHtml: () => ipcRenderer.invoke("html:export"),   // Publish Playable HTML
  exportPack: () => ipcRenderer.invoke("pack:export"),
  openPack: () => ipcRenderer.invoke("pack:open"),
  mergePackPlan: () => ipcRenderer.invoke("pack:mergePlan"),
  mergePackCommit: () => ipcRenderer.invoke("pack:mergeCommit"),
  mergePackDrop: () => ipcRenderer.invoke("pack:mergeDrop"),
  launchTarget: () => ipcRenderer.invoke("project:launchTarget"),
  onProjectOpened: (handler: (result: OpenResult | { error: string }) => void) => {
    ipcRenderer.on("project:opened", (_event, result: OpenResult | { error: string }) => handler(result));
  },
  // Live Link (design/live-link.md)
  liveLinkStart: () => ipcRenderer.invoke("liveLink:start"),
  liveLinkStop: () => ipcRenderer.invoke("liveLink:stop"),
  liveLinkStatus: () => ipcRenderer.invoke("liveLink:status"),
  onLiveLinkStatus: (handler: (status: LiveLinkStatus) => void) => {
    ipcRenderer.on("liveLink:status", (_event, status: LiveLinkStatus) => handler(status));
  },
  liveLinkSnapshot: () => ipcRenderer.invoke("liveLink:snapshot"),
  liveLinkFollow: (flowId: string) => ipcRenderer.invoke("liveLink:follow", flowId),
  onLiveLinkFrame: (handler: (frame: LiveLinkFrame) => void) => {
    ipcRenderer.on("liveLink:frame", (_event, frame: LiveLinkFrame) => handler(frame));
  },
  onMenu: (handler: (command: MenuCommand) => void) => {
    ipcRenderer.on("menu", (_event, command: MenuCommand) => handler(command));
  },
};

contextBridge.exposeInMainWorld("studio", api);
