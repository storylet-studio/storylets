# @storylet-studio/play-helpers

The **host-side helpers** for a JavaScript game running
[`@storylet-studio/runtime`](../runtime). The runtime deals cards; nothing in
it touches a file, a socket or the DOM. Everything that does lives here, so the
runtime stays the pure, corpus-pinned thing every port is transliterated from.

Each helper has a counterpart in the Unity, Godot and Unreal ports under the
same name, so an integration reads the same in every engine
(`scripts/check-runtime-api-parity.mjs` holds all four to it).

## What is in it

- **The save boundary** - `saveState` / `loadState` over the parsed file,
  `serializeState` / `deserializeState` over text. Patterplay's pairing, so a
  project running both engines saves and loads the same way in each.
  The `.storyletsave` string form of a whole run: the shared state plus every
  flow. Your game decides where the bytes go; this decides what they are.
- **The state logger** - `createStateLogger`, `snapshotState`, `diffState`.
  A running account of what the story changed, as it changes, for a debug
  overlay or a console. `createKernelStateLogger` is the product-agnostic core
  if you are mounting your own bags.
- **Live Link** - `createLiveLink`, `applyLiveBundle`. Joins a running game to
  Storyletter over a loopback WebSocket, so the editor's Board shows the real
  run, and a save in the editor swaps the new bundle in underneath it without
  a restart. Attach the **engine**, not a flow: the link discovers your flows
  itself and announces them as they open and close.
  &rarr; [Live Link](https://storylet.studio/play/live-link/)
- **The examiners** - `createPropertyInspector`, `createBundleInspector`. A
  DOM panel showing live state, the run log and what a bundle offers. The web
  equivalent of the Runtime State window each engine port ships.
- **`createWorldContainer`** - a ready-made `@world` resolver for a game with
  no state store of its own to bind.

## Using it

```ts
import { Engine } from "@storylet-studio/runtime";
import { createLiveLink, serializeState } from "@storylet-studio/play-helpers";

const engine = new Engine(bundle, { seed: 7, log: true });
const flow = engine.openFlow("main");

// Debug builds only: inert when no editor is listening, and it never throws
// into your game.
const link = createLiveLink({ build: bundle.content.hash, project: "My Game" });
link.attach(engine);

const saved = serializeState(engine);   // hand the string to your save system
```

The demo in [`demo/`](./demo) wires all of it together against the Hamlet
bundle and is the shortest complete example.

&rarr; Full documentation: [storylet.studio/play/javascript](https://storylet.studio/play/javascript/)
