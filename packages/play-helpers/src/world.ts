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
   *  into a state logger or examiner beside the engine's own bags. Writing it
   *  DIRECTLY is writing the kernel, so a `writable: false` declaration asks
   *  the kernel's question: pass `{ host: true }` to say the game is speaking
   *  (`bag.set(name, value, { host: true })`). Through `resolver` or an
   *  engine's setProperty that is already answered. */
  bag: StateBag;
  /** The current values, for saving beside the engine's envelope. */
  values(): PropertyBag;
  /** Restore saved values over fresh defaults: orphaned keys drop, new
   *  declarations keep their defaults - the same drift rule as loadGame. */
  load(values: PropertyBag): void;
}

/** A world container seeded from the bundle's @world declarations.
 *
 *  The container is the GAME's state, so it WRITES - even a declaration
 *  carrying `writable: false`. That flag is the STORY's promise not to write
 *  the value (Reboot.md 10), and the engine keeps it where the story writes: an
 *  outcome is refused against the engine's read-only table before it ever
 *  reaches this resolver. Enforcing it here as well refused the HOST too - the
 *  clock the game must move, the harness driving the value it is testing
 *  against - which is the opposite of what the flag says.
 *
 *  So the declarations are seeded AS DECLARED, which is what an examiner over
 *  this container should read, and the writes go through as HOST writes
 *  (scoperegistry 0.6.0's `{ host: true }`). The resolver's `set` is the
 *  engine's own doorway and passes the flag too: the engine has already sorted
 *  story from host by then - a story write was refused earlier, a host write is
 *  the only kind that arrives - and a resolver takes a name and a value with no
 *  room to say which. A game wanting a rule of its own binds its own resolver
 *  rather than this one; the ports' container (Unreal's UStoryletWorld) draws
 *  the same line, with HostSet never refused and StorySet asking the game's own
 *  read-only list. */
export function createWorldContainer(bundle: Bundle): WorldContainer {
  const bag = new StateBag(bundle.world.properties, { normalise: (n) => n });
  return {
    resolver: {
      get: (n) => bag.get(n),
      set: (n: string, v: ScalarValue) => { bag.set(n, v, { host: true }); },
    },
    bag,
    values: () => bag.values,
    load: (values) => bag.load(values),
  };
}
