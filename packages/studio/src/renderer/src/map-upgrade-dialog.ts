// ---------------------------------------------------------------------------
// The upgrade prompt for a project from before the project map (main
// `map-upgrade.ts`): one question when such a project opens, and the same
// question from the problems bar's "Upgrade the project…".
//
// It shows what the move will do in the planner's own lines (which map is kept,
// which copies fold into it, the boxes that join, the pictures and frames
// moved), because "upgrade" alone asks the author to trust a rewrite of files
// they cannot see. Refused, it shows the planner's sentences instead and offers
// nothing to click but OK: there is nothing to do until the copies agree.
//
// On the shell's dialog frame, like the push and leave prompts beside it, with
// the family's `.btn` / `.btn.primary` buttons.
// ---------------------------------------------------------------------------

import { dialogFrame } from "@wildwinter/app-shell/dialog";
import { el } from "@wildwinter/app-shell";
import type { MapUpgradeDto } from "../../shared/api.js";

/** The planner's sentences are the CLI's, and two of them are not true of the
 *  app: they end by telling the author to "run format again", where the same
 *  act here is this prompt, and they say each picture is MOVED, where the app
 *  copies it (main map-upgrade.ts: bytes are not in the undo history, so the
 *  box's own copies stay for an undo to find). Those clauses are said in the
 *  app's words; the rest is the planner's verbatim. */
export const inAppWords = (sentence: string): string =>
  sentence.replace(/run format again$/, "upgrade the project again").replace(/^picture moved to /, "picture copied to ");

/** First letter up, full stop on: a planner line made into a sentence. */
const asSentence = (line: string): string => {
  const s = line.charAt(0).toUpperCase() + line.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
};

/** Ask. Resolves true to upgrade, false otherwise; a refused plan always
 *  resolves false. */
export function askMapUpgrade(plan: MapUpgradeDto): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (yes: boolean): void => {
      if (done) return;
      done = true;
      resolve(yes);
      frame.close();
    };
    const refused = plan.refusals.length > 0;
    const frame = dialogFrame({
      title: refused ? "This project can’t be upgraded yet" : "Upgrade this project?",
      className: "map-upgrade-dialog",
      onClose: () => finish(false),
    });
    const body = frame.body;
    const list = (lines: string[], className: string): HTMLElement => {
      const ul = el("ul", className);
      for (const line of lines) ul.append(el("li", { text: asSentence(inAppWords(line)) }));
      return ul;
    };
    if (refused) {
      body.append(
        el("div", "confirm-body", "This project was made before maps belonged to the project, and it can’t move onto the project map until these are put right:"),
        list(plan.refusals, "map-upgrade-refusals"),
        el("div", "confirm-body", "Until then the map isn’t drawn or played. The problems bar keeps the way back here."),
      );
    } else {
      body.append(
        el("div", "confirm-body", "This project was made before maps belonged to the project. Upgrade it?"),
        list(plan.report, "map-upgrade-report"),
        ...(plan.warnings.length > 0 ? [list(plan.warnings, "map-upgrade-warnings")] : []),
        el("div", "confirm-body", "You can undo this."),
      );
    }
    const actions = frame.actions;
    if (refused) {
      const ok = el("button", "btn primary", "OK");
      ok.type = "button";
      ok.addEventListener("click", () => finish(false));
      actions.append(ok);
      queueMicrotask(() => ok.focus());
    } else {
      const later = el("button", "btn", "Not now");
      later.type = "button";
      later.addEventListener("click", () => finish(false));
      const go = el("button", "btn primary", "Upgrade");
      go.type = "button";
      go.addEventListener("click", () => finish(true));
      actions.append(later, go);
      queueMicrotask(() => go.focus());
    }
    frame.open();
  });
}
