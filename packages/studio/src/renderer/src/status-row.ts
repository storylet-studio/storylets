// The window's status row: one 28px row at its foot for what is true right now (a canvas's summary, an
// armed tool's instruction), with Live Link at its right-hand end. The row is the shell's
// (`.shell-statusrow`, app-shell 0.65), the same as Patterpad's hint bar; the October 2026 UI review
// (patterkit design/ui-review-2026-10/3-composition.md, proposal 9) gave both apps one. A view that has
// something to say fills it while it is up and empties it when it goes.
import { el } from "@wildwinter/app-shell";

/** The one status row, appended to the workspace once, at its foot. */
export const statusRow = el("div", { className: "shell-statusrow" });
statusRow.setAttribute("role", "status");
