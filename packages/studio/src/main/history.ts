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
//
// The one thing added here is a name for each step. A toast's Undo (the
// October 2026 review: Undo replaces "Are you sure?") must take back the step
// it reported and nothing else, so it asks for that step by id, and is told
// "no" once anything newer has been done. The shell's history keeps its stack
// to itself, so the ids ride on a stack of marks kept beside it, moved by the
// same rules (Patterpad's `undoMarks`, patter main/project.ts).
// ---------------------------------------------------------------------------

import { History, UNDO_LIMIT } from "@wildwinter/app-shell/history";
import type { FileState, StepOutcome } from "@wildwinter/app-shell/history";
import type { ProjectStep } from "../shared/api.js";

export { History, UNDO_LIMIT, applyStates, captureBefore, writeFailure } from "@wildwinter/app-shell/history";
export type { Applied, FileRestorer, FileState, HistoryOptions, StepOutcome } from "@wildwinter/app-shell/history";

interface StepMark { id: number; key: string }

/** Ids are never reused, in this window's life, across projects too: a toast left over from the last project
 *  can never name a step of this one. */
let nextStepId = 1;

/**
 * The shell's history, each step named. `record` says which step a write went into (a new one, or the one it
 * coalesced with), and `newest` which step Undo would take back now.
 */
export class StepHistory extends History {
  private undoMarks: StepMark[] = [];
  private redoMarks: StepMark[] = [];

  /** The id of the step Undo would take back now; undefined with nothing to undo. */
  get newest(): number | undefined { return this.undoMarks[this.undoMarks.length - 1]?.id; }

  override reset(): void {
    super.reset();
    this.undoMarks = [];
    this.redoMarks = [];
  }

  /** Record a step, as the shell does, and say which: `merged` when it joined the step on top (the same key,
   *  as typing into one field), which a toast doesn't offer to undo on its own. */
  override record(label: string, key: string, before: FileState[], after: FileState[]): ProjectStep {
    const top = this.undoMarks[this.undoMarks.length - 1];
    const merged = top !== undefined && top.key === key;
    super.record(label, key, before, after);
    this.redoMarks = [];
    if (merged) return { id: top.id, merged: true };
    const id = nextStepId++;
    this.undoMarks.push({ id, key });
    if (this.undoMarks.length > UNDO_LIMIT) this.undoMarks.shift();
    return { id, merged: false };
  }

  override clearRedo(): void {
    super.clearRedo();
    this.redoMarks = [];
  }

  override async applyUndo(): Promise<StepOutcome | undefined> {
    return this.moved(await super.applyUndo(), this.undoMarks, this.redoMarks);
  }

  override async applyRedo(): Promise<StepOutcome | undefined> {
    return this.moved(await super.applyRedo(), this.redoMarks, this.undoMarks);
  }

  /** The marks follow what the shell did: a step that landed moves across, drift drops every step on its
   *  side (the shell's rule), and a write that failed leaves the step where it was. */
  private moved(outcome: StepOutcome | undefined, from: StepMark[], to: StepMark[]): StepOutcome | undefined {
    if (!outcome) return outcome;
    if (outcome.ok) { const mark = from.pop(); if (mark) to.push(mark); }
    else if (outcome.drift) from.length = 0;
    return outcome;
  }
}
