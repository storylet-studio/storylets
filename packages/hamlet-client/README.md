# The Hamlet client

One browser game, two engines. The **Storylet Engine** decides which beat happens;
**Patter** performs its dialogue; the host owns `@world` and hands the same
resolver to both. The design is Reboot.md section 10 in the workshop repo; this
is it running.

Play it: `npm run serve` here, then open the printed URL. Or read it, which is
the point: `src/world.ts` is the shared surface (45 lines), `src/performance.ts`
is the handoff, `src/main.ts` is the game around them.

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
