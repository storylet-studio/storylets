// ---------------------------------------------------------------------------
// The session strip under the head: the seed, the Live / Local switch, Save
// state and Restore (the snapshots, kept for the window's life, and the
// .storyletsave files), and Restart or, at the venue rung, New run and Forget
// everyone. In Live mode the game is in control, so its own controls are
// hidden and only the switch stays. Also the out-of-date bar, whose one action
// is the same Restart.
// ---------------------------------------------------------------------------

import { el, iconNode, staleBar, toast } from "@wildwinter/app-shell";
import { focusKey } from "../tool-window/focus.js";
import { shows } from "../src/play-ladder.js";
import type { Board } from "./board-state.js";
import { build, forgetEveryone, newRun, restart, restore } from "./session.js";
import { liveSwitch } from "./live-mode.js";

export function sessionStrip(b: Board): HTMLElement {
  const s = b.state;
  if (s.liveMode) {
    return el("div", { className: "tbar" },
      el("span", { className: "livenote", text: "Watching the connected game (observe only)." }),
      el("span", { className: "tbargap" }),
      liveSwitch(b));
  }
  const toggle = (panel: "save" | "restore"): void => { s.snapPanel = s.snapPanel === panel ? undefined : panel; b.render(); };
  return el("div", { className: "tbar" },
    el("label", { className: "seed" }, "Seed ",
      (() => {
        const input = focusKey(el("input", { className: "seedin", tip: "The session's random seed. Changing it restarts the run." }), "seed");
        input.value = String(s.seed);
        input.addEventListener("change", () => { const n = Number(input.value); if (Number.isInteger(n)) { s.seed = n; void build(b); } });
        return input;
      })()),
    el("span", { className: "tbargap" }),
    liveSwitch(b),
    el("button", { className: "btn", text: "Save state…", onClick: () => toggle("save") }),
    el("button", { className: "btn", text: "Restore…", onClick: () => toggle("restore") }),
    // The run boundary (design/engine-server.md 4.2), at the venue rung
    // only (4.10): New run keeps the pockets so a returning party can be
    // played, Forget everyone drops them and IS the restart. Below that
    // rung nothing is durable, so Restart is the whole story and the pair
    // would be two names for one act.
    ...(shows("runGestures")
      ? [
        el("button", { className: "btn", text: "New run",
          tip: "Restart the world, keeping everything durable, to play a party who have been here before",
          onClick: () => newRun(b) }),
        el("button", { className: "btn",
          tip: "Restart and forget the durable half too (the pockets and the installation's memory)",
          onClick: () => forgetEveryone(b) }, iconNode("restart"), "Forget everyone"),
      ]
      : [el("button", { className: "btn", onClick: () => restart(b) }, iconNode("restart"), "Restart")]),
  );
}

/** The out-of-date bar: the shell's (app-shell 0.18.0), since Patterpad had
 *  grown the same sentence for the same situation a word apart, and two apps
 *  arriving independently at one wording is what "shape-level" looks like. An
 *  edit is the shared sentence; another project, or none, says what happened
 *  instead (the bar's `message`, app-shell 0.46.5). Never in Live mode. */
export function staleNote(b: Board): HTMLElement | null {
  const s = b.state;
  const onRestart = (): void => restart(b);
  return s.stale === undefined || s.liveMode ? null
    : s.stale === "edit"
      ? staleBar({ subject: "The project", onRestart })
      : s.stale === "project"
        ? staleBar({ subject: "The project", message: "Another project was opened in the editor.", advice: "Restart to play it.", onRestart })
        : staleBar({ subject: "The project", message: "The project was closed in the editor.", advice: "Restart to clear the Board.", onRestart });
}

/** Save state: name a snapshot, or export the state to a file. Restore: pick
 *  a snapshot, delete one, or import a file (which joins them). */
export function snapshotPanel(b: Board): HTMLElement | null {
  const s = b.state;
  if (!s.snapPanel || !s.table) return null;
  if (s.snapPanel === "save") {
    const input = el("input", { className: "snapname" });
    input.placeholder = "Snapshot name";
    const save = (): void => {
      const label = input.value.trim() || "snapshot";
      s.snapshots = [...s.snapshots, { name: label, file: s.table!.saveFile() }];
      s.snapPanel = undefined; b.render();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { s.snapPanel = undefined; b.render(); } });
    const panel = el("div", { className: "snappanel" }, input, el("button", { className: "btn", text: "Save", onClick: save }),
      el("button", { className: "btn", text: "Export…", tip: "Write the current state to a .storyletsave file", onClick: () => {
        void b.studio.exportSave(s.table!.saveFile(), s.name || "session").then((r) => {
          if (r === null) return;   // cancelled: the panel stays
          if ("error" in r) toast(`Export failed: ${r.error}.`, "error"); else { s.snapPanel = undefined; }
          b.render();
        });
      } }));
    setTimeout(() => input.focus(), 0);
    return panel;
  }
  const list = el("div", { className: "snappanel" });
  s.snapshots.forEach((snap, i) => {
    list.append(el("div", { className: "snaprow" },
      el("button", { className: "btn snappick", text: snap.name, onClick: () => {
        if (restore(s, snap.file)) b.render();
      } }),
      el("button", { className: "btn ghost icon snapdel", tip: "Delete snapshot", onClick: () => { s.snapshots = s.snapshots.filter((_, j) => j !== i); b.render(); } }, iconNode("close"))));
  });
  if (s.snapshots.length === 0) list.append(el("span", { className: "empty", text: "No snapshots yet." }));
  list.append(el("button", { className: "btn", text: "Import…", tip: "Load a .storyletsave file (it also joins the snapshots)", onClick: () => {
    void b.studio.importSave().then((r) => {
      if (r === null) return;   // cancelled
      if ("error" in r) { toast(`Import failed: ${r.error}.`, "error"); return; }
      if (restore(s, r.file)) s.snapshots = [...s.snapshots, { name: r.name, file: r.file }];
      b.render();
    });
  } }));
  return list;
}
