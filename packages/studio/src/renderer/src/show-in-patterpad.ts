// Show Scene in Patterpad, for both of its doors (Edit > Show Scene in Patterpad,
// and the problems bar's "create the scene" fix): when Storyletter can't find
// Patterpad, main hands back the question and it is asked here, in the shell's
// confirm with Cancel first, as Patterpad asks its mirror. A yes goes back to main,
// which offers the file picker.

import { confirmDialog } from "@wildwinter/app-shell";
import type { StudioApi } from "../../shared/api.js";

export async function showInPatterpad(studio: StudioApi, cardId: string): Promise<
  { address: string; published: boolean } | { error: string } | null> {
  const first = await studio.editInPatterpad(cardId);
  if (first === null || !("locate" in first)) return first;
  const yes = await confirmDialog({ title: first.locate.title, body: first.locate.body, confirmLabel: "Locate Patterpad…" });
  if (!yes) return null;
  const located = await studio.editInPatterpad(cardId, true);
  // Main asks only when it has not been told to locate, so a second question never
  // comes; if one did, it is a cancel rather than a loop.
  return located !== null && "locate" in located ? null : located;
}
