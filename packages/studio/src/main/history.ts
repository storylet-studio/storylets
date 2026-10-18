// ---------------------------------------------------------------------------
// Undo / redo, the files-are-truth way: the shell's file-byte history
// (`@wildwinter/app-shell/history`), which started here and moved into the
// shell so Patterpad's project-level undo is the same code (patterkit
// design/patterpad-undo.md, ruling 2). Every mutation writes through `commit`
// (mutate/write-path.ts), which captures the before-state from disk, applies
// the writes through the VC layer, and records the step; undo and redo refuse
// a step whose files have changed since (ruling 5).
//
// Re-exported from here so nothing that imports it has to move.
// ---------------------------------------------------------------------------

export { History, UNDO_LIMIT, applyStates, captureBefore, writeFailure } from "@wildwinter/app-shell/history";
export type { Applied, FileRestorer, FileState, HistoryOptions, StepOutcome } from "@wildwinter/app-shell/history";
