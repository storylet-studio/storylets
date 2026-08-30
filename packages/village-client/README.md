# The Village: a playable example

A small browser game over the Village, one of the worked example projects that
ships with Storyletter. It is here to be **read**: it is the shortest honest
answer to "what does a game built on the Storylet Engine actually look like?".

Open `dist/index.html` and play it. Read `src/main.ts` and you have seen the
whole integration; everything else in `src/` is drawing.

```
npm run build -w @storylet-studio/village-client   # content + script -> dist/
npm run serve -w @storylet-studio/village-client   # ...and serve it at :5180
```

## What is the engine's, and what is the game's

The line matters more than any single call, so the code is arranged along it.

**The engine's**: what is eligible here and now, how it ranks, what is dealt,
what an outcome changes, whose turn it is, and the whole save.

**The game's**: where the player is standing, what a place looks like, what a
card looks like, what the journal says, and when time passes for a reason the
engine cannot see.

The engine never learns where the player is. That is `at` in `main.ts`, four
lines of game state, and it is the only thing the client tracks itself.

## The API it shows

Every row here is checked, both ways, by `scripts/check-sample-coverage.mjs`:
the member must exist and the client must really call it. What the client does
NOT show is listed in that same file with a reason, so a gap is a decision
rather than an oversight.

| Call | What it shows |
|---|---|
| `Engine` | Built once from the compiled bundle, with a seed. A game owns one. |
| `openFlow` | There is no default flow; a game opens the one it plays in. |
| `getFlow` | Taking a FRESH handle after a load, because loading rebuilds the flows and the handle held across it is inert. |
| `describeBundle` | What am I playing? Version and content hash in the corner, which is what a playtester needs when reporting a bug. |
| `dealMany` | The opening deal: every place gets what it is owed, so the world has something in it. |
| `deal` | Arriving somewhere is dealing that place's hand. |
| `board` | What is on the table here, which is what the player can see. |
| `outcomes` | The choices on a card, each evaluated against the state RIGHT NOW, so a locked one can unlock while you stand there. |
| `play` | The only thing in the client that changes the world. |
| `turn` | The clock, shown to the player. |
| `advanceTurns` | Time the GAME spends that the engine cannot see: waiting a while. |
| `listBoxes` | Which box the world lives in, asked rather than hard-coded. |
| `listProperties` | The player's own state, drawn as a character sheet rather than a debug table. |
| `getProperty` | Reading one value to show it. |
| `serializeState` | Saving to `localStorage`, through the engine's own envelope rather than a shape of the client's own invention. |
| `deserializeState` | Loading it back. |

## Where the content comes from

Nothing in `dist/` is committed and nothing here is hand-copied. Every build:

1. loads `examples/the-village.storylets` from its shards,
2. compiles it with full metadata (a compile error fails the build),
3. derives the map geometry with the same op the Publish ▸ Playable HTML page
   uses, so "where is a site on the map" has one implementation,
4. copies the box's pictures,
5. bundles `src/` against the runtime's **source**.

So the client cannot describe a Village that is not the Village, and an API
change breaks this build rather than a download.

## What this is not

Not the smallest possible integration: read the Board demo in
`packages/play-helpers/demo` for that, and its twins in the Godot, Unity and
Unreal runtimes. Not what you hand a playtester: that is Publish ▸ Playable
HTML in Storyletter, which needs no code at all. Not a framework, and not an
art project.

See the design notes in the private workshop repo.
