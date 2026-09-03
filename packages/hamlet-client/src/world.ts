// ---------------------------------------------------------------------------
// The shared world: ONE object, handed to BOTH engines.
//
// This file is the coexistence design in twenty lines (Reboot.md 10). `@world`
// is the game's own state. Neither engine owns it, both read it through a
// resolver the host provides, and because it is the SAME resolver instance,
// there is one picture of the world and no synchronising to get wrong.
//
// It is also why a joint save works. Neither engine puts `@world` in its own
// save envelope - ours excludes it by design, and Patter's `saveGame()`
// serialises `shared`, `sharedVisits`, `sharedSelectors`, `stageBags` and
// `flows` and nothing else - so the host saves it exactly once, here.
// ---------------------------------------------------------------------------

export type Scalar = boolean | number | string | string[];

export class World {
  private values = new Map<string, Scalar>();
  /** Fires whenever the game moves the world, so the UI can redraw. */
  onChange: (() => void) | null = null;

  constructor(initial: Record<string, Scalar> = {}) {
    for (const [k, v] of Object.entries(initial)) this.values.set(k, v);
  }

  /** The resolver shape both engines accept. `set` is present because this
   *  game lets time pass; a world the story may only READ omits it. */
  readonly resolver = {
    get: (name: string): Scalar | undefined => this.values.get(name),
    set: (name: string, value: Scalar): void => {
      this.values.set(name, value);
      this.onChange?.();
    },
  };

  get(name: string): Scalar | undefined { return this.values.get(name); }
  set(name: string, value: Scalar): void { this.resolver.set(name, value); }

  /** The host's half of the joint save. */
  save(): Record<string, Scalar> { return Object.fromEntries(this.values); }
  load(saved: Record<string, Scalar>): void {
    this.values = new Map(Object.entries(saved));
    this.onChange?.();
  }
}
