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
// `flows` and nothing else - so the host saves it exactly once. It rides in the
// storylet half's save file, and because this class has the container's two
// verbs (`values` and `load`), the save helpers put it back before the Storylet
// Engine checks the hand it restores against it.
// ---------------------------------------------------------------------------
class World {
    state = new Map();
    /** Fires whenever the game moves the world, so the UI can redraw. */
    onChange = null;
    /** The GAME's policy, as opposed to either story's stated intent: names
     *  nothing but the host may move. A story that tries is refused LOUDLY,
     *  because the compilers cannot see across projects and a silent ignore
     *  would leave a scene believing it had moved the clock. */
    readOnly;
    constructor(initial = {}, readOnly = []) {
        for (const [k, v] of Object.entries(initial))
            this.state.set(k, v);
        this.readOnly = new Set(readOnly);
    }
    /** The resolver shape both engines accept. `set` is present because this
     *  game lets time pass; a world the story may only READ omits it. */
    resolver = {
        get: (name) => this.state.get(name),
        set: (name, value) => {
            if (this.readOnly.has(name))
                throw new Error(`@world.${name} is the game's alone: a story tried to set it to ${JSON.stringify(value)}`);
            this.state.set(name, value);
            this.onChange?.();
        },
    };
    get(name) { return this.state.get(name); }
    /** The host's own write, which the read-only policy does not bind: it is the host. */
    set(name, value) { this.state.set(name, value); this.onChange?.(); }
    /** A copy of the world, for the save. */
    values() { return Object.fromEntries(this.state); }
    load(saved) {
        this.state = new Map(Object.entries(saved));
        this.onChange?.();
    }
}
