export { newId, slug } from "./ids.js";
export type { PlannedWrite } from "./write.js";
export { findProjectDir, loadProject } from "./load.js";
export type { LoadedProject } from "./load.js";
export { runInit, projectFolderName } from "./init.js";
export type { InitOptions, InitResult } from "./init.js";
export { runNewBox, BOX_KITS } from "./newbox.js";
export { boxFolderWrites, boxFolderName } from "./box-folder.js";
export type { BoxKit, NewBoxOptions, NewBoxResult } from "./newbox.js";
export { runExport, bundleOutputPath } from "./export.js";
export type { ExportOptions, ExportResult } from "./export.js";
// The readable export (the project as an .xlsx workbook).
export { runExportXlsx, spreadsheetFileName } from "./export-xlsx.js";
export type { ExportXlsxCounts, ExportXlsxOptions, ExportXlsxResult } from "./export-xlsx.js";
// The playable export (the project as one self-contained .html that plays in a browser).
export { runExportHtml, playableFileName, playableMaps } from "./export-html.js";
export type { PlayableMap, PlayableMapOptions } from "./export-html.js";
export type { ExportHtmlResult } from "./export-html.js";
export { runValidate, clearCanonicalCache } from "./validate.js";
export type { ValidateResult, ValidateOptions } from "./validate.js";
export { runFormat } from "./format.js";
export type { FormatResult } from "./format.js";
export { runAsk, parseFlagValue } from "./draw.js";
export type { AskOptions, AskResult } from "./draw.js";
// resolve: what a gameId / id / title names (the CLI's `resolve`, Storyletter's `--at`)
export { runResolve, indexProject } from "./resolve.js";
export type { ResolveEntry, ResolveKind } from "./resolve.js";
export { runCoverage, runCoverageAsync, proposeCoverage } from "./coverage.js";
export type {
  CoverageOptions, CoverageReport, CardCoverage, OutcomeCoverage, HandCoverage,
} from "./coverage.js";
export {
  runMerge, detectMergeType, conflictSidecar, MergeInputError, CONFLICT_SIDECAR_EXTENSION,
} from "./merge.js";
export { analyseInfluence, cardNeighbourhood, describeContribution } from "./influence.js";
// Find: property usage (the Property tab) and find-and-replace over item text (the Replace tab)
export { runPropertyUsage, runPropertyUsageMany, parsePropertyQuery } from "./usage.js";
export type { PropertyUsage } from "./usage.js";
export { runReplace } from "./replace.js";
export type { ReplaceOptions, ReplaceHit, ReplaceField, ReplacePlan } from "./replace.js";
export {
  ASSETS_DIR, assetPath, assetUse, freeAssetName, imageSize, isSafeAssetName, orphanAssetPaths,
} from "./assets.js";
export { contractIssues, contractNotes } from "./contract.js";
export type { ContractNote } from "./contract.js";
export { canvasFurniture, cardPositions, deckCanvas, mapSites, planCanvasFurniture, planCardPositions, planForgetCanvas, planForgetSites, planMapSites, viewPath } from "./view.js";
export type { CanvasRef } from "./view.js";
export { notesPath, planComments } from "./comments.js";
export { layoutByDependency } from "./layout.js";
export type { LayoutEdge, LayoutOptions, LayoutResult } from "./layout.js";
export type { CardPlacement, SitePlacement } from "./view.js";
export type {
  InfluenceGraph, InfluenceEdge, InfluenceNode, InfluenceScope, InfluenceOptions,
  InfluenceScopeName, EdgeClass, EdgeContribution, AnalysisWarning, AnalysisWarningKind, Neighbourhood,
} from "./influence.js";
export { runPack, readPackManifest, PackError, PACK_EXTENSION, PACK_MANIFEST, PACK_SCHEMA } from "./pack.js";
export type { PackManifest } from "./pack.js";
export { runUnpack, runUnpackMerge, isUnsafeEntry, UnsafeEntryError } from "./unpack.js";
export type { ProvenanceCheck } from "./unpack.js";
export type { MergedShard, UnpackMergeResult } from "./unpack.js";
export type { MergeFileType, MergeResult, Conflict, Warning, ConflictKind } from "./merge.js";
export { findConflictSidecars } from "./load.js";
export type { Issue } from "@storylet-studio/compiler";
export { parseSource, canonicalStringify } from "@storylet-studio/compiler";
export { sharedSpaces } from "./spaces.js";
export type { SharedSpace } from "./spaces.js";

export { reachabilityIssues } from "./reachability.js";
