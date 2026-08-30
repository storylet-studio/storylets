// ---------------------------------------------------------------------------
// The state logger (parity member: every runtime carries one; design/
// engine-runtimes.md 3.4 is the design of record). Kernel-shaped: property
// logging is PUSH-based on the PropertyBag audit hook - every write, engine
// or host, arrives with prev and reason and logs the moment it lands - while
// the product's non-property state (turns / cooldowns / board) arrives
// through a small path-provider adapter and is diffed on capture(). The
// kernel core (createKernelStateLogger) is product-agnostic and moves into
// @wildwinter/scoperegistry wholesale when the vendor-sync slice lands;
// createStateLogger is the storylets adapter over it. Flattened path scheme:
//   world.x / story.x / box.<id>.x / deck.<id>.x / hand.<id>.x / value.<id>.x
//   turn:<boxId>      per-box clocks
//   cooldown:<cardId> next-eligible turns
//   board:<handId>    hand contents (card ids, dealt order)
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for undefined.
// ---------------------------------------------------------------------------

import type { BagMount, Engine, Flow } from "@storylet-studio/runtime";
import type { FlowSave, ScalarValue } from "@storylet-studio/model";

/** A flattened snapshot: path -> value. */
export type StateSnapshot = Record<string, ScalarValue>;

export interface StateChange {
  path: string;
  from: ScalarValue | undefined;
  to: ScalarValue | undefined;
}

export interface StateLoggerOptions {
  /** Where lines go; defaults to console.log. */
  sink?: (line: string) => void;
  /** Prefixed to every line (e.g. "[board] "). */
  label?: string;
}

export interface StateLogger {
  snapshot(): StateSnapshot;
  /** Everything since the last capture: the audited writes already logged
   *  (push-based), plus anything that changed WITHOUT an audit event (the
   *  product's non-property state; bags replaced by a load, which fires
   *  none), diffed, logged, and re-baselined. */
  capture(): StateChange[];
  /** Unhook the bag auditors. The logger is inert afterwards. */
  dispose(): void;
}

/** What a product supplies to the kernel logger (design 3.4): its kernel
 *  bags (re-read on every capture, so a product that replaces its bags on
 *  load re-mounts) and its non-property state as flattened paths. */
export interface StateLoggerAdapter {
  mounts(): BagMount[];
  extra(): StateSnapshot;
}

export function diffState(prev: StateSnapshot, next: StateSnapshot): StateChange[] {
  const changes: StateChange[] = [];
  const paths = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const path of [...paths].sort()) {
    const from = prev[path], to = next[path];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ path, from, to });
  }
  return changes;
}

const show = (v: ScalarValue | undefined): string =>
  v === undefined ? "<unset>" : JSON.stringify(v);

/** The product-agnostic core: audit-hooked bags plus a diffed extra
 *  snapshot. (Ships here until the kernel package takes it in.) */
export function createKernelStateLogger(adapter: StateLoggerAdapter, opts: StateLoggerOptions = {}): StateLogger {
  const sink = opts.sink ?? ((line: string) => console.log(line));
  const label = opts.label ?? "";
  const emit = (c: StateChange): void => {
    sink(`${label}${c.path}: ${show(c.from)} -> ${show(c.to)}`);
  };

  const full = (): StateSnapshot => {
    const out: StateSnapshot = {};
    for (const { prefix, bag } of adapter.mounts()) {
      for (const [name, value] of Object.entries(bag.values)) out[`${prefix}.${name}`] = value;
    }
    Object.assign(out, adapter.extra());
    return structuredClone(out);
  };

  let baseline = full();
  let pushed: StateChange[] = [];
  let mounted: { bag: BagMount["bag"]; off: () => void }[] = [];

  const hook = (prefix: string, bag: BagMount["bag"]): (() => void) =>
    bag.onAudit((change) => {
      // Push-based: the write logs as it lands, prev straight off the audit
      // event; the baseline moves with it so capture() never re-reports.
      const c: StateChange = structuredClone({ path: `${prefix}.${change.name}`, from: change.prev, to: change.next });
      emit(c);
      pushed.push(c);
      baseline[c.path] = structuredClone(change.next);
    });

  const mount = (): void => {
    const mounts = adapter.mounts();
    const same = mounted.length === mounts.length && mounts.every((m, i) => mounted[i]!.bag === m.bag);
    if (same) return;
    for (const m of mounted) m.off();
    mounted = mounts.map(({ prefix, bag }) => ({ bag, off: hook(prefix, bag) }));
  };
  mount();

  return {
    snapshot: full,
    capture(): StateChange[] {
      // Whatever arrived WITHOUT an audit event: non-property paths, and
      // bag values replaced wholesale by a load (load fires no events).
      const next = full();
      const diffed = diffState(baseline, next);
      for (const c of diffed) emit(c);
      const changes = [...pushed, ...diffed];
      pushed = [];
      baseline = next;
      mount();   // a load replaces the product's bags; re-hook them
      return changes;
    },
    dispose(): void {
      for (const m of mounted) m.off();
      mounted = [];
      pushed = [];
    },
  };
}

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
    mounts: () => [...engine.listBags(), ...(live()?.listBags() ?? [])],
    extra: () => extraState(engine.saveGame().flows[id]),
  }, opts);
}
