// ---------------------------------------------------------------------------
// Find's Property, Field and Replace tabs over the bridge.
// ---------------------------------------------------------------------------

import { applyReplace, declaredFields, fieldUsage, propertyUsage, propertyUsageMany, replacePreview } from "../replace.js";
import { serialised } from "../mutate/write-path.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { hear, sessionGuards } from "./registrar.js";
import { push } from "./push.js";

/** Pairs each of Find's Undo asks with the editor's reply. */
let undoAsks = 0;

export function registerFind(ipc: Ipc, deps: Pick<MainContext, "session" | "editor" | "flushEditor">): void {
  const { read } = sessionGuards(deps.session);

  // Find's Property tab: every read and write of a property.
  ipc.handle("search:propertyUsage", read(propertyUsage, []));
  ipc.handle("search:propertyUsageMany", (_e, queries) => {
    const session = deps.session();
    return session ? propertyUsageMany(session, queries) : queries.map(() => []);
  });
  // Find's Field tab: what holds a field's value, and what fields there are.
  ipc.handle("search:fieldUsage", read(fieldUsage, []));
  ipc.handle("search:declaredFields", read(declaredFields, []));
  // Find's Replace tab. Preview is read-only. Apply first has the editor flush
  // its pending edits (Patterpad's flushEditorScene: they would otherwise be
  // lost under the rewrite, or land on top of it), then writes through the
  // mutation path as one undo step, then tells the editor to re-read.
  ipc.handle("search:replacePreview", read(replacePreview, { hits: [], items: 0 }));
  ipc.handle("search:replaceApply", async (_e, opts) => {
    if (!deps.session()) return { error: "no project open" };
    await deps.flushEditor();
    // Into the write queue only after the flush: the editor's flushed saves
    // are themselves queued writes, and waiting inside the queue for them
    // would wait for ever.
    const r = await serialised(() => { const session = deps.session(); return session ? applyReplace(session, opts) : { error: "no project open" }; });
    const window = deps.editor();
    if (!("error" in r) && window && !window.isDestroyed()) push(window.webContents, "replace:applied", r.count);
    return "error" in r ? r : { count: r.count, items: r.items, ...(r.step ? { step: r.step } : {}) };
  });
  // The toast's Undo after a Replace. The editor owns the page an undo redraws,
  // so it runs the undo (its pending edits first, then the step, only while it
  // is still the newest) and says how it went. No editor, or no answer, and the
  // step is left alone.
  ipc.handle("search:undoStep", (_e, id) => new Promise<"done" | "stale">((resolve) => {
    const window = deps.editor();
    if (!window || window.isDestroyed()) { resolve("stale"); return; }
    const ask = ++undoAsks;
    let stop = (): void => undefined;
    const timer = setTimeout(() => { stop(); resolve("stale"); }, 30_000);
    stop = hear("editor:undoStepReply", (_event, reply) => {
      if (reply.ask !== ask) return;
      clearTimeout(timer);
      stop();
      resolve(reply.result);
    });
    push(window.webContents, "editor:undoStep", { ask, id });
  }));
}
