---
title: JavaScript
description: Play a .storyletsc bundle in a browser or Node app with the Storylet Engine reference runtime. Install from the release zip, load a bundle, build an engine, open a flow, deal, play, save, and mount the in-page dev tools.
sidebar:
  label: JavaScript
---

<div class="sy-badge">
  <img src="/plugin-javascript.svg" alt="" width="56" height="56" />
  <p>The reference runtime, in pure TypeScript: no DOM, no filesystem, no engine. It runs in any browser or Node app, and every native port reproduces its results exactly.</p>
</div>

## Install

Download the JavaScript zip from the [download page](/download/). It carries three things:

- **`@storylet-studio/runtime`**: the interpreter. Pure, so it embeds anywhere: a browser, a
  server, a test harness.
- **`@storylet-studio/play-helpers`**: everything that touches the browser or the host: the
  save-file plumbing, the state logger, the in-page property examiner and the bundle
  inspector.
- **A browser drop-in**, `storyletengine.min.js`: the runtime and the helpers in one classic
  script that defines a `StoryletEngine` global. Two script tags and no build step:

  ```html
  <script src="storyletengine.min.js"></script>
  <script>
    const engine = new StoryletEngine.Engine(bundle, { seed: 7 });
    const text = StoryletEngine.serializeState(engine);   // the save helpers are on it too
  </script>
  ```

Each package folder has a `dist/` with `index.js` (ESM), `index.cjs` and `index.d.ts`. Copy
the folders into your project and import from them with your bundler, or with a plain path
import. Both are also on npm (`@storylet-studio/runtime`, `@storylet-studio/play-helpers`),
and the drop-in is on a CDN, straight from the npm package:

```html
<script src="https://unpkg.com/@storylet-studio/play-helpers/dist/storyletengine.min.js"></script>
```

```js
import { Engine } from "@storylet-studio/runtime";
```

## Load a bundle

The runtime takes a parsed bundle object. It does no I/O, so load the `.storyletsc` however
suits you: `fetch()` it, `import` it, or read it from disk in Node.

```js
const bundle = await fetch("the-hamlet.storyletsc").then((r) => r.json());
```

## Build an engine, open a flow

```js
const engine = new Engine(bundle, { seed: 7, log: true });
const flow = engine.openFlow("main");
```

The engine is the world: it holds the bundle, the shared state and your game's `@world`
binding. Every play call lives on a **flow** - one playthrough - opened by name. A
single-player game opens `"main"` and never thinks about it again; an experience with many
participants opens one flow each, all over the same shared world
([the sharing rules](/play/world-state/)). Re-opening a name replaces that flow with a fresh
one, and a closed flow's handle refuses every call.

`seed` defaults to 0 and seeds each flow's own generator (override per flow:
`openFlow("bob", { seed: 3 })`), so the same seed always deals the same cards. `log: true`
keeps each flow's trace events so you can read them back later (capped at 1000, oldest
dropped first; `{ cap: n }` sets your own). It's off by default, and with no subscribers and
no retained log the flow does no trace work at all.

## Deal, peek, outcomes, play

```js
// Refresh every hand. Returns what was dealt, keyed by hand gameId. A refresh evicts
// what is no longer eligible and fills EMPTY slots; a still-eligible card stays dealt.
const dealt = flow.dealMany();

// Or one hand by name.
const cards = flow.deal("the-inn");

// What's out right now, across the whole board or one box's hands.
const board = flow.board();
const barks = flow.board("barks");

// Look at what a box would deal, without dealing anything.
const looks = flow.peek("village", { area: "forest" }, 3);
```

A dealt card is `{ id, gameId, title?, purpose?, fields? }`. `fields` is your handoff: the
scene id, the animation reference, whatever the box's card template declared.

Ask for outcomes when you're about to show them; a dealt card doesn't carry them:

```js
for (const o of flow.outcomes(card.id, "the-inn")) {
  if (o.available) offer(o.title ?? o.gameId, () =>
    flow.play(card.id, o.gameId, "the-inn"));
}
```

`play` throws before changing anything if the outcome is gated shut or the card isn't in that
hand. You can only play a card that's on the board.

## Your game's state

```js
flow.setProperty("world.time_of_day", "night");   // write before you deal
flow.getProperty("story.reputation");
flow.listProperties();                             // every declared property: path, type, value, default

flow.advanceTurns("village", 1);                   // one box's clock
flow.turn("village");                              // read it
flow.listBoxes();                                  // every box: id, gameId, title, turn
```

The paths, and when to write them: [Your game's state](/play/world-state/).

## Save and load

```js
const envelope = engine.saveGame();   // a plain object: the whole run, every flow
engine.loadGame(envelope);
const again = engine.getFlow("main"); // loadGame rebuilds every flow: re-take your handles
```

`@world` is deliberately not in the envelope - it's your game's state, and your game saves
it ([why](/play/world-state/)). For files, `play-helpers` gives you the string boundary,
which wraps the envelope together with your world values:

```js
import { serializeState, deserializeState, createWorldContainer } from "@storylet-studio/play-helpers";

const world = createWorldContainer(bundle);     // or bind your own resolver
const text = serializeState(engine, world.values());   // write this to a .storyletsave
const savedWorld = deserializeState(engine, text);     // read one back...
if (savedWorld) world.load(savedWorld);                // ...and apply the world half yourself
flow = engine.getFlow("main");                         // and RE-TAKE your handles: a load rebuilds every flow
```

Two things about that last line. The `flow` you held before the load is now inert, so
you must take a fresh one. And take it with `getFlow`, **not `openFlow`**: `openFlow` on
an id that exists *replaces* it, which here discards the hand the file just restored, and
you find out later when `play()` refuses the card as not dealt. The engine can tell you
when that happens: pass `onReplacedFlow: (id, dealt) => console.warn(...)` in its
options during development, and leave it unset in a shipped game.

A foreign, malformed or wrong-project blob is refused, so a bad file can't corrupt a run.

## The trace

```js
const unsubscribe = flow.subscribeTrace((event) => console.log(event));
```

Events are `deal`, `peek`, `evict`, `play`, `write`, `turns` and `diagnostic`. A `deal` or
`peek` event lists every card that was considered and why it was or wasn't dealt (`dealt`,
`capped`, `cooldown`, `deck-gate`, `tags`, `condition`, `priority`, `claimed`,
`claimed-elsewhere`, `taken`). A `write`
carries the path and the previous value, so a log line reads "0 -> 1".

If you created the engine with `log: true`, `flow.log()` gives you the same events, each
stamped with a sequence number and the turn of the box it happened in. The log lives for the
flow and never rides a save; the durable play history is in the save's `playLog`.

When you run several flows, **`engine.log()` is the run's log**: every flow's events in one
order, each entry carrying the `flow` it happened in. You want it because a flow's own log
cannot show a story action in *another* flow moving shared state - that participant's value
simply changes, with nothing in their log to explain it. `engine.subscribeTrace((flowId,
event) => ...)` is the same stream live, and `engine.clearLog()` drops the retained one.

## Dev tools

```js
import {
  createPropertyInspector, createBundleInspector, createStateLogger,
} from "@storylet-studio/play-helpers";

createPropertyInspector(engine, flow, { container: document.getElementById("state") });
createBundleInspector(bundle, { container: document.getElementById("bundle") });
```

The property examiner shows and edits a running flow's state, turns and board, with
**Save State… / Load State…** buttons. The bundle inspector shows what a bundle offers your
code, with no flow running. Leave both out of a shipping build. What each one shows:
[Dev tools](/play/dev-tools/).

The same package ships `createLiveLink` and `applyLiveBundle`: connect the running game to
Storyletter, and saves reach the run without a restart while the Board shows the game's
deals. Wiring and the protocol: [Live Link](/play/live-link/).

## The Board demo

The helpers package carries a `demo` folder: the whole play loop as one clickable page, with
every hand a labelled group of card buttons, outcomes revealed beneath the open card, a
transcript, and both examiners mounted beside the board. Its README has the two commands that
build and serve it.

The same Board demo ships with the Unity, Unreal and Godot runtimes: same content, same control
labels, same transcript, one idiom each.

**The Hamlet on the web** is the second demo: the same project with [Patter](https://patterkit.dev)
performing each card's dialogue, two engines in one game. It ships as a project zip on the
[download page](/download/#the-hamlet-two-engines-in-one-game); `src/performance.ts` is the whole
integration, and [Running it with Patter](/play/with-patter/) explains the handoff.

## Next

- What every runtime shares: [Dev tools](/play/dev-tools/).
- Why it matches the other engines exactly:
  [Compatibility & conformance](/compatibility/).
