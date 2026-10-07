// ---------------------------------------------------------------------------
// A refusal that offers the way out: "News" can't leave the map while its hand
// "Dock screen" is in a zone, so the prompt says that and offers to open the
// hand. A toast could only say it and vanish, which left the author hunting for
// the thing it named (the round-3 reviews: "offer the action rather than
// 'Change it first'").
//
// The shell's confirm is for DESTRUCTIVE choices and draws its button in the
// danger colour, which is wrong for "Open". So this is the upgrade prompt's
// frame (map-upgrade-dialog.ts): the shell's dialog, the family's `.btn` and
// `.btn.primary`, OK on the left and the way out as the primary action.
// ---------------------------------------------------------------------------

import { dialogFrame } from "@wildwinter/app-shell/dialog";
import { el } from "@wildwinter/app-shell";

/** Say why not, and offer to open the thing in the way. Resolves true when the
 *  author chose to open it; without `openLabel` there is only OK. */
export function refusalDialog(opts: { title: string; body: string; openLabel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (open: boolean): void => {
      if (done) return;
      done = true;
      resolve(open);
      frame.close();
    };
    const frame = dialogFrame({ title: opts.title, className: "refusal-dialog", onClose: () => finish(false) });
    frame.body.append(el("div", "confirm-body", opts.body));
    const ok = el("button", opts.openLabel === undefined ? "btn primary" : "btn", "OK");
    ok.type = "button";
    ok.addEventListener("click", () => finish(false));
    frame.actions.append(ok);
    let focus = ok;
    if (opts.openLabel !== undefined) {
      const open = el("button", "btn primary", opts.openLabel);
      open.type = "button";
      open.addEventListener("click", () => finish(true));
      frame.actions.append(open);
      focus = open;
    }
    queueMicrotask(() => focus.focus());
    frame.open();
  });
}
