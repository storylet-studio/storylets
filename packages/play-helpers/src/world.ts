// ---------------------------------------------------------------------------
// The host's @world container (design/flows.md; engine-runtimes.md 3.1).
//
// @world is the game's own state: the engine resolves it through a resolver
// and NEVER saves it - "host saves its container once, each engine saves its
// own envelope". A real game binds its own state here; a host that has no
// state of its own (the demos, the playable page, the Board) uses this
// ready-made container so @world still persists across its save/load.
//
// This is also what keeps a mixed Patter + Storylet Engine game honest: ONE
// container, both engines mounting it foreign, neither writing it into its
// envelope.
// ---------------------------------------------------------------------------

import { PropertyBag as StateBag } from "@wildwinter/scoperegistry";
import type { ScalarValue } from "@wildwinter/expr";
import type { ScopeResolver } from "@wildwinter/expr";
import type { Bundle, PropertyBag } from "@storylet-studio/model";

export interface WorldContainer {
  /** Pass as `new Engine(bundle, { world: container.resolver })`. */
  resolver: ScopeResolver;
  /** The kernel bag itself (subscribe, audit, rows live there) - mount it
   *  into a state logger or examiner beside the engine's own bags. */
  bag: StateBag;
  /** The current values, for saving beside the engine's envelope. */
  values(): PropertyBag;
  /** Restore saved values over fresh defaults: orphaned keys drop, new
   *  declarations keep their defaults - the same drift rule as loadGame. */
  load(values: PropertyBag): void;
}

/** A world container seeded from the bundle's @world declarations. */
export function createWorldContainer(bundle: Bundle): WorldContainer {
  const bag = new StateBag(bundle.world.properties, { normalise: (n) => n });
  return {
    resolver: {
      get: (n) => bag.get(n),
      set: (n: string, v: ScalarValue) => { bag.set(n, v); },
    },
    bag,
    values: () => bag.values,
    load: (values) => bag.load(values),
  };
}
