// ---------------------------------------------------------------------------
// The storylets state logger: an ADAPTER over the kernel logger in
// @wildwinter/scoperegistry (design/engine-runtimes.md 3.4 is the design of
// record). The kernel does the work - push-based property logging on the
// PropertyBag audit hook, so a write logs the moment it lands, plus a diff of
// everything that has no audit hook - and this supplies the two product-shaped
// pieces: which bags to watch, and the non-property state (turns / cooldowns /
// board) as flattened paths.
//
// The core lived here, marked "moves into the kernel package wholesale when the
// vendor-sync slice lands". It has. Patterplay's logger, which diffed save
// snapshots and so could not see a value that changed and changed back, is an
// adapter over the same core now.
//
// Flattened path scheme:
//   world.x / story.x / box.<id>.x / deck.<id>.x / hand.<id>.x / value.<id>.x
//   turn:<boxId>      per-box clocks
//   cooldown:<cardId> next-eligible turns
//   board:<handId>    hand contents (card ids, dealt order)
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for undefined.
// ---------------------------------------------------------------------------

import type { Engine, Flow } from "@storylet-studio/runtime";
import type { FlowSave, ScalarValue } from "@storylet-studio/model";
import {
  createStateLogger as createKernelStateLogger, diffState,
} from "@wildwinter/scoperegistry";
import type {
  StateSnapshot, StateChange, StateLogger, StateLoggerAdapter, StateLoggerOptions,
} from "@wildwinter/scoperegistry";

// Re-exported: these were declared here, and a host importing them from
// @storylet-studio/play-helpers should not have to care that they moved.
export { createKernelStateLogger, diffState };
export type { StateSnapshot, StateChange, StateLogger, StateLoggerAdapter, StateLoggerOptions };

/** The full flattened snapshot of ONE FLOW's view - the shared partitions
 *  plus that flow's own - straight off the save envelope, so "what the
 *  snapshot sees" is by construction "what a save persists". @world is not
 *  here for the same reason it is not in the envelope: the host owns that
 *  container and mounts/saves it itself (createWorldContainer). */
export function snapshotState(engine: Engine, flow: Flow): StateSnapshot {
  const env = engine.saveGame();
  const flowSave = env.flows[flow.id];
  const out: StateSnapshot = {};
  const bag = (prefix: string, values: Record<string, ScalarValue> | undefined): void => {
    for (const [name, value] of Object.entries(values ?? {})) out[`${prefix}.${name}`] = value;
  };
  // Shared under the flow's own: names are disjoint (shared XOR per-flow by
  // declaration), so one path space holds both without collision.
  bag("story", env.shared.props.story);
  bag("story", flowSave?.props.story);
  for (const kind of ["box", "deck", "hand", "value"] as const) {
    for (const [id, values] of Object.entries(env.shared.props[kind])) bag(`${kind}.${id}`, values);
    for (const [id, values] of Object.entries(flowSave?.props[kind] ?? {})) bag(`${kind}.${id}`, values);
  }
  Object.assign(out, extraState(env.flows[flow.id]));
  return out;
}

/** The storylets path-provider adapter for non-property state (design 3.4):
 *  one flow's turns / cooldowns / board as flattened paths, off its blob in
 *  the envelope (absent for a just-closed flow: no paths). */
function extraState(saved: FlowSave | undefined): StateSnapshot {
  const out: StateSnapshot = {};
  if (saved === undefined) return out;
  for (const [boxId, turn] of Object.entries(saved.turns)) out[`turn:${boxId}`] = turn;
  for (const [cardId, at] of Object.entries(saved.cooldowns)) out[`cooldown:${cardId}`] = at;
  for (const [handId, cards] of Object.entries(saved.board)) out[`board:${handId}`] = [...cards];
  return out;
}

/** The storylets state logger: the kernel core mounted on the SHARED bags
 *  (engine.listBags()) and one flow's own (flow.listBags()) - the same
 *  prefixes, one path space, names disjoint - plus the flow's turns /
 *  cooldowns / board adapter. A host that wants @world lines mounts its
 *  world container's bag through createKernelStateLogger itself. */
export function createStateLogger(engine: Engine, flow: Flow, opts: StateLoggerOptions = {}): StateLogger {
  // By NAME, not by handle: loadGame rebuilds every flow and the handle we
  // were given goes inert; capture()'s re-mount picks up the rebuilt one.
  const id = flow.id;
  const live = (): Flow | undefined => engine.getFlow(id);
  return createKernelStateLogger({
    // A BagMount's `prefix` ("story", "deck.<id>") is the engine's label for the mount;
    // the kernel composes paths from the BAG's own pathPrefix ("story.", "deck.<id>.")
    // and needs none passed. Same strings, one owner.
    mounts: () => [...engine.listBags(), ...(live()?.listBags() ?? [])].map(({ bag }) => ({ bag })),
    extra: () => extraState(engine.saveGame().flows[id]),
  }, opts);
}
