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

  /** The GAME's policy, as opposed to either story's stated intent: names
   *  nothing but the host may move. A story that tries is refused LOUDLY,
   *  because the compilers cannot see across projects and a silent ignore
   *  would leave a scene believing it had moved the clock. */
  private readonly readOnly: Set<string>;

  constructor(initial: Record<string, Scalar> = {}, readOnly: string[] = []) {
    for (const [k, v] of Object.entries(initial)) this.values.set(k, v);
    this.readOnly = new Set(readOnly);
  }

  /** The resolver shape both engines accept. `set` is present because this
   *  game lets time pass; a world the story may only READ omits it. */
  readonly resolver = {
    get: (name: string): Scalar | undefined => this.values.get(name),
    set: (name: string, value: Scalar): void => {
      if (this.readOnly.has(name)) throw new Error(`@world.${name} is the game's alone: a story tried to set it to ${JSON.stringify(value)}`);
      this.values.set(name, value);
      this.onChange?.();
    },
  };

  get(name: string): Scalar | undefined { return this.values.get(name); }
  /** The host's own write, which the read-only policy does not bind: it is the host. */
  set(name: string, value: Scalar): void { this.values.set(name, value); this.onChange?.(); }

  /** The host's half of the joint save. */
  save(): Record<string, Scalar> { return Object.fromEntries(this.values); }
  load(saved: Record<string, Scalar>): void {
    this.values = new Map(Object.entries(saved));
    this.onChange?.();
  }
}
