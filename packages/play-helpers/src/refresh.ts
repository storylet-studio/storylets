// ---------------------------------------------------------------------------
// Live refresh (design/live-link.md): the game-side applier. The editor pushes
// a freshly compiled bundle over the Live Link (createLiveLink's `onBundle`);
// this swaps it in under the running engine: a new Engine over the new
// bundle, loaded from the old one's save. The runtime's loadGame() already
// tolerates edited content (a deleted card leaves the table, orphaned
// cooldowns and hand contents drop, a new property takes its default), so the
// run carries across - every flow of it; it refuses only a save from another
// project.
//
// Patter's applyLiveBundle has two tiers (strings-only vs hot swap) because it
// has string tables and a cursor to re-find; we have neither, so this is the
// one tier. Wire-up:
//
//   let engine = new Engine(bundle, { seed: 7, log: true });
//   let flow = engine.openFlow("main");
//   const link = createLiveLink({
//     build: bundle.content.hash,
//     onBundle: ({ build, data }) => {
//       const r = applyLiveBundle(engine, data, { log: true });
//       if (!r.ok) return console.warn(r.error);
//       engine = r.engine;                    // re-bind your handles: loadGame
//       flow = engine.getFlow("main")         // rebuilt every flow, so the old
//         ?? engine.openFlow("main");         // Flow objects are inert
//       link.attach(engine);   // re-attach the ENGINE: loadGame rebuilt every flow
//       link.setBuild(build);
//     },
//   });
// ---------------------------------------------------------------------------

import type { Bundle } from "@storylet-studio/model";
import { Engine } from "@storylet-studio/runtime";
import type { EngineOptions } from "@storylet-studio/runtime";

export type LiveBundleResult =
  /** The new engine, carrying the old one's run (all flows), and the bundle
   *  it runs. */
  | { ok: true; engine: Engine; bundle: Bundle }
  /** Nothing changed: keep the engine you have. */
  | { ok: false; error: string };

/**
 * Apply a bundle the editor pushed over the Live Link: `new Engine(parsed,
 * opts)` then `loadGame(engine.saveGame())`, returning the new engine. Never
 * throws; a failure (unparseable JSON, a bundle the runtime rejects, a
 * different project) comes back as `{ ok: false, error }` and the old engine
 * is untouched.
 *
 * `opts` are the options the old engine was created with. An engine does
 * not expose its seed, and it does not matter here: the save envelope carries
 * each flow's PRNG state, so `loadGame` resumes the draw sequences exactly
 * where they were and `seed` only shapes fresh flows. `log` does matter (the
 * retained log is per flow), and so does `world` (the host's binding does not
 * ride the envelope), so pass them if you had them.
 */
export function applyLiveBundle(engine: Engine, bundleJson: string, opts: EngineOptions = {}): LiveBundleResult {
  let bundle: Bundle;
  try {
    bundle = JSON.parse(bundleJson) as Bundle;
  } catch {
    return { ok: false, error: "pushed bundle is not valid JSON" };
  }
  try {
    const next = new Engine(bundle, opts);
    next.loadGame(engine.saveGame());
    return { ok: true, engine: next, bundle };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
