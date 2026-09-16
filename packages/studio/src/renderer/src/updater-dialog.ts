// The themed auto-update prompt: our in-app replacement for Electron's stock
// dialog.showMessageBox, so "Update available", "Restart now" and the
// unsaved-work question all wear the app's own typography and palette rather
// than a system dialog (design-language.md, "coherent to the edges").
//
// Main summons it over `updater:prompt` and reads back the chosen button INDEX,
// which is deliberately the same contract as showMessageBox's `response`: the
// shell's updater was lifted from Patterpad whole, and keeping the reply shape
// identical is what let it be lifted without rewriting either side.
//
// **The renderer half is not optional.** An unanswered prompt does not fall back
// to a native dialog: the shell waits 300 seconds and then resolves to its own
// fallback index, so an app that ships the updater without this file has a
// Check for Updates that appears to do nothing and then quietly decides for
// itself. That is worse than not shipping it.
//
// Two departures from Patterpad's copy, both deliberate:
//   - no `links` branch. Theirs carries one because their About box shares this
//     dialog; ours does not (About is the shell's, fed our wordmark), and the
//     shell's own UpdaterPromptOptions has no links field to read.
//   - the shell's dialog frame (dialogFrame) and `.btn` buttons rather than a
//     parallel set of our own, so this matches the themed confirm the rest of
//     the app already uses.

import { dialogFrame } from "@wildwinter/app-shell/dialog";
import { el } from "./dom.js";
import type { UpdaterDownloadProgress, UpdaterPromptOptions } from "../../shared/api.js";

// The progress row of the open `progress: true` dialog, if any. These are modal,
// so one at a time, so one slot is enough. Closing clears it.
let liveProgress: { bar: HTMLElement; label: HTMLElement } | null = null;

const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);

/** Route a download-progress tick into the open dialog's bar. No-op when none is showing. */
export function feedUpdaterDownloadProgress(p: UpdaterDownloadProgress): void {
  if (!liveProgress) return;
  const pct = Math.max(0, Math.min(100, p.percent));
  liveProgress.bar.style.width = `${pct}%`;
  liveProgress.label.textContent =
    `${pct.toFixed(0)}% - ${mb(p.transferred)} of ${mb(p.total)} MB (${mb(p.bytesPerSecond)} MB/s)`;
}

/** Show the prompt as a modal themed dialog; resolve the index of the clicked button (Esc -> cancelId). */
export function showUpdaterDialog(opts: UpdaterPromptOptions): Promise<number> {
  return new Promise((resolve) => {
    const defaultId = opts.defaultId ?? 0;
    const cancelId = opts.cancelId ?? opts.buttons.length - 1;

    let done = false;
    const finish = (idx: number): void => {
      if (done) return;
      done = true;
      liveProgress = null;
      resolve(idx);
      frame.close();
    };
    const frame = dialogFrame({
      title: opts.message, className: "updater-dialog",
      // Esc is the cancel button, not a fourth answer: main is waiting on an index.
      onClose: () => finish(cancelId),
    });
    if (opts.detail) frame.body.append(el("div", "confirm-body", opts.detail));

    if (opts.progress) {
      const track = el("div", "updater-progress-track");
      const bar = el("div", "updater-progress-bar");
      track.append(bar);
      const label = el("div", "updater-progress-label", "Starting download…");
      frame.body.append(track, label);
      liveProgress = { bar, label };
    }

    opts.buttons.forEach((label, i) => {
      // The default is the affirmative and wears the accent; every other button,
      // the way out included, is the plain one. Matches the confirm dialog's
      // cancel/confirm pairing.
      const b = el("button", i === defaultId ? "btn primary" : "btn", label);
      b.type = "button";
      b.addEventListener("click", () => finish(i));
      frame.actions.append(b);
      if (i === defaultId) queueMicrotask(() => b.focus());
    });

    frame.open();
  });
}
