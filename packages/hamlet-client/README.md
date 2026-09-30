# The Hamlet client

One browser game, two engines. The **Storylet Engine** decides which beat happens;
**Patter** performs its dialogue; the host owns `@world` and hands the same
resolver to both. The design is Reboot.md section 10 in the workshop repo; this
is it running.

Play it: `npm run serve` here, then open the printed URL. There is no build: the page is three script tags for browser files (the two runtimes', and the `@storylet-studio/with-patter` helper's) and two plain scripts. The two bundles it plays are the PUBLISHED ones, `examples/storylet-dist/the-hamlet-patter.storyletsc` (from `examples/the-hamlet-patter.storylets`, the Patter version of the Hamlet) and `examples/patter-dist/the_hamlet.patterc`, read on every request: Publish from Storyletter or Patterpad, then refresh. Or read it, which is
the point: `src/world.js` is the shared surface, with-patter's `Performer`
is the handoff, `src/main.js` is the game around them.

## In the zip

- **`index.html`**: double-click it to play. No install and no server.
- **`dist/`**: the game as it runs, including both engines' browser runtimes
  (`storyletengine.min.js`, `patterplay.min.js`) and the handoff between them
  (`with-patter.min.js`).
- **`src/`**: the game's own code. `world.js` is the world both engines share,
  `main.js` the game around them.
- **`projects/`**: both source projects, side by side and already paired:
  - `the-hamlet-patter.storylets` opens in **Storyletter**: the cards, when
    they are dealt, and what their outcomes change.
  - `the-hamlet.patter` opens in **Patterpad**: the scene each card plays.
  - `storylet-dist/` and `patter-dist/` hold what each editor publishes.

Because they are paired, Storyletter checks every card against its scene and
plays the scenes on its Board, **Edit ▸ Edit Scene in Patterpad** opens a
card's scene, and Patterpad's **Edit ▸ Show Card in Storyletter** goes the
other way. What the two share is `@world`: `time_of_day` and `knows_road` are
declared in both project files, and the build checks that they agree.

To play your own edits, publish from either editor, copy the result into
`dist/` as `hamlet.storyletsc` or `hamlet.patterc`, and serve `dist/` from any
static server (`npx serve dist`, for one). Opened from disk, the page can't
read those files, so it plays `hamlet-data.js`, the copy made when the zip was
built.

## The contract, by name

- A card's `gameId` **is** its Patter scene id (`examples/the-hamlet.patter`).
- An outcome's `gameId` **is** what the scene reports back, as a `gameEvent`
  carrying `gameData: { outcome }` at the end of the branch it took.
- The host names which boxes it performs through Patter (`PATTER_BACKED` in
  `scripts/build.mjs`). No Patter concept enters the storylet format.
- `@world` is declared in BOTH projects and must agree.

Nothing declares any of that, so `scripts/pairing.mjs` validates all of it in
the build: a card with no scene, a scene with no card, an outcome no branch
reports or a report no card declares, a `@world` property the two projects
disagree on, and a card whose gameId is derived from its title rather than
pinned. Each fails the build with a message naming it.

## What it proved, and what it found

Every claim here has a test in `test/plays.test.ts`: the loop closes, the joint
save restores both engines and a scene paused mid-choice, a scene reads
`@world`, a scene writes `@world` and a storylet card is dealt because of it.
What building it turned up is in the workshop repo's `joint-demo-findings.md`;
the short version is that both engines did what the design said, and every
surprise was in the host.

The sixteen scenes are stubs: real plumbing, placeholder words.
