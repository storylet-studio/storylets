// ---------------------------------------------------------------------------
// A report with Undo (the October 2026 review: Undo replaces "Are you sure?").
//
// A delete, a Replace or a merge goes at once and says so in a toast whose
// Undo takes back the step it made. Only that step, and only while it is still
// the newest thing done: main checks, in the write queue, and the button never
// undoes something done since. Anything newer, and it says so instead, since
// Edit > Undo steps back through it in order. A write that joined the step
// before it (the same edit continuing), or made none, gets the plain toast.
// ---------------------------------------------------------------------------

import { toast } from "@wildwinter/app-shell";
import type { ToastKind } from "@wildwinter/app-shell";
import type { ProjectStep } from "../../shared/api.js";

/** What the toast's Undo says when the step isn't the newest any more. */
export const STALE_UNDO = "That's no longer the latest change. Undo in the Edit menu steps back to it.";

/** How a window takes back one step: "stale" when it isn't the newest. */
export type UndoStep = (id: number) => Promise<"done" | "stale">;

/** Say `message`, with Undo when `step` is one of its own. */
export function toastWithUndo(undoStep: UndoStep, message: string, kind: ToastKind, step: ProjectStep | undefined): void {
  if (!step || step.merged) { toast(message, kind); return; }
  const id = step.id;
  toast(message, kind, {
    action: { label: "Undo", run: () => void undoStep(id).then((r) => { if (r === "stale") toast(STALE_UNDO); }) },
  });
}
