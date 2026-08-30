# The Board demo (JS)

The whole play loop as one clickable board, over the compiled Hamlet bundle,
with both JS examiners mounted beside it.

- Every hand from `flow.board()` is a labelled group of card buttons. An
  empty hand says `(nothing here right now)`.
- Clicking a card reveals its outcomes beneath it. Available outcomes are
  clickable; unavailable ones are still shown, disabled, labelled `(locked)`.
  Only one card is open at a time.
- Three controls: **Deal all hands** (`dealMany()`), **Next turn**
  (`advanceTurns` on every box), **Restart** (a fresh engine and flow, seed 7).
- The transcript records one line per action, newest last.
- `createPropertyInspector(engine, flow)` and `createBundleInspector(bundle)`
  sit beside the board, so the state the board moves is visible as it moves.
  The engine is created with `log: true`, which is what fills the examiner's
  Log panel.

The same demo ships with the Godot, Unity and Unreal runtimes: same board, same
control labels in the same order, same transcript grammar. If you want the
smallest possible integration instead of the loop, read a minimal one-shot demo
first (`ports/godot/addons/storyletengine/demo`, or the Unity `BoardDemo`
sample).

`the-hamlet.storyletsc` here is a copy of the compiled bundle that ships with
the Godot addon demo. Nothing re-exports from `examples/`.

This folder is freely deletable: nothing in `@storylet-studio/play-helpers`
depends on it.

## Build

One command, from the repo root. `--tsconfig=tsconfig.json` is what makes
esbuild honour the root `paths`, which alias `@storylet-studio/*` to package
source (play-helpers has no built `dist`).

```sh
npx esbuild packages/play-helpers/demo/demo.ts --bundle --format=esm --outfile=packages/play-helpers/demo/app.js --tsconfig=tsconfig.json
```

`app.js` is the only build artefact and is gitignored.

## Run

The page `fetch`es `the-hamlet.storyletsc`, so serve the folder rather than
opening the file directly. Either of these, from the repo root:

```sh
npx http-server packages/play-helpers/demo -p 8378
```

```sh
python3 -m http.server 8378 --directory packages/play-helpers/demo
```

Then open <http://localhost:8378/>.

## Live Link

Open <http://localhost:8378/?live=1> and the page opens a Live Link to
Storyletter (`ws://127.0.0.1:4472`, design/live-link.md) as it loads: tick
**Play > Live Link** in the editor with the Hamlet project open, and the
editor's Board shows this run; save in the editor and the new build lands
here without a restart (the transcript says so, and the examiners re-mount
over the new engine). `?live=ws://127.0.0.1:<port>` points it elsewhere.
