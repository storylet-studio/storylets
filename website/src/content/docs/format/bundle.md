---
title: The bundle and the save
description: The compiled .storyletsc bundle - what export does, what the bundle holds, the staleness check - and the .storyletsave envelope that snapshots a whole run.
sidebar:
  label: Bundle and save
---

Your shards are the source. The **bundle** is what ships.

## What export does

`storyletengine export` (or **Publish ▸ Publish Bundle** in Storyletter) is the compiler.
It:

1. **Compiles every expression** from source text into a `{ src, ast }` envelope, so no
   runtime ever ships a parser.
2. **Assembles the shards**: the project file plus every box folder and deck file, into one
   JSON document, all collections sorted by id.
3. **Validates**: property references nothing declares, tag references that point nowhere,
   hands that don't fill in every group their template asks for, field values against the
   box's card template. It refuses to write anything on an error.
4. **Computes a content hash** over the canonical source shards and embeds it.
5. **Carries author metadata through** by default. A `stripped` build omits every `title`
   and `purpose`.

The output is a single strict-JSON `.storyletsc` file at the path the project shard's
`export.bundle` names. New projects point it at a `storylet-dist/` folder beside the project,
named after it (`../storylet-dist/the-hamlet.storyletsc`), and that is the default when the
shard names nothing. The project folder is the document; a build output never goes inside it.
Patterpad publishes to `../patter-dist/` in the same way.

## What's in it

```json5
{
  schema: "storylets/bundle@0",
  content: {
    project: "proj_salt",        // immutable project id
    version: "0.3.0",            // authored project version
    hash: "a91c...",             // over the canonical source shards
  },
  metadata: "full",              // "full" | "stripped"
  settings: {
    playAdvancesTurns: 1,
  },
  world: {
    properties: [ /* the @world declarations */ ],
    registry: { /* owned / foreign split */ },
  },
  story: {
    properties: [ /* the @story declarations */ ],
  },
  boxes: [ /* each box, with its tag groups, decks, templates and hands */ ],
  maps: [ /* only when the project asked: see below */ ],
}
```

There's no text a player would read, no localisation and no captions. A card is its
condition, its ranking inputs, its redraw policy, its tags, its outcomes and its box-shaped
fields, which keeps a bundle small.

Author metadata is kept. Titles and purposes ship by default because they make a trace
readable: "why did *Ambush at the ford* get dealt here?" is a question the log can then
answer in words.

## Maps, when you ask for them

Maps are off by default: geometry is authoring data, the engine deals in tag names, and a
shipping build needn't carry anything it doesn't use. Turn on `export.map` in the project
shard (or pass `--map` to one export) and the bundle gains a `maps` block, one entry per
spatial tag group:

```
maps: [{
  box: "village",              // the owning box, by gameId
  group: "zone",               // the tag group, by gameId
  zones: [
    { tag: "tavern", polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] },
  ],
  backgrounds: [
    { file: "assets/village/plan.png", x: 0, y: 0, width: 800, height: 600, opacity: 0.6 },
  ],
  sites: [                     // where the placed hands stand
    { hand: "the-forge", x: 210, y: 340 },
    { hand: "the-well", x: 120, y: 80 },
  ],
}]
```

Everything is named by gameId, the same names `peek` takes, so a host can match a shape to
the tag it draws. Background pictures are written as files next to the bundle at the path
each entry names, ready for an engine to import.

`sites` is where each placed hand stands on the map, sorted by hand gameId so the bytes
don't move when a shard is reordered. A hand nobody has placed has no entry, and a map with
no placed hand has no `sites` key at all. Which zone a hand belongs to isn't repeated here:
the hand's own binding is what the engine deals from.

**The engine never reads any of it.** It's there for a host that wants to draw an in-game
map without building its own export. `describeBundle` reports whether a bundle carries maps,
so one can't slip into a build unnoticed.

## The staleness check

`content.hash` is a hash over the canonical source shards. `storyletengine validate`
recomputes it and **errors if a committed bundle doesn't match the shards**:

```
$ storyletengine validate the-hamlet.storylets
error: dist/the-hamlet.storyletsc: bundle is stale (content hash does not
  match the shards); run: storyletengine export
```

That's what makes committing the bundle safe. The default is to commit it, marked
`merge=ours` in `.gitattributes`: you regenerate it, you never hand-merge it, and the hash
means a stale one can't land without `validate` saying so. Ignoring the bundle instead is a
choice you can make in `.gitignore`.

The same triple (`project`, `version`, `hash`) ties a save to the bundle it was made
against.

## Versioning

The `schema` tag (`storylets/bundle@0`) versions the format, and runtimes refuse a major
version they don't speak. Canonical source serialisation is versioned the same way, in each
shard's own `schema` tag: a change to how shards serialise is a schema bump even if no field
changed, because the bytes are part of the contract.

## The save envelope

A running engine snapshots to a `storylets/save@1` envelope: the shared state once, then
every flow's own blob, keyed by the flow's name. Every id in it is immutable, so renaming
things in the project doesn't break a save.

Claims are not in it, deliberately: a claim is just "this card is on that hand right now", so
it is read back off the boards rather than stored twice. What a shared one-shot **spent** is
durable, so that does ride the shared half.

```json5
{
  schema: "storylets/save@1",
  content: { project: "proj_salt", version: "0.3.0", hash: "a91c..." },
  shared: {                            // what every flow shares; no world key
    props: {                           // the shared-flagged properties
      story: { reputation: -1 },
      box:   { "b_enc": { heat: 2 } },
      deck:  {}, hand: {}, value: {},
    },
    spent: ["c_pixie"],                // shared one-shots taken out of the world
  },
  flows: {
    "main": {
      props: {                         // this flow's own copies
        story: {}, box: {}, deck: { "k_docks": { visits: 3 } },
        hand:  { "h_board": { owner: "elder" } },
        value: { "v_docks": { danger: 3 } },   // tag state
      },
      turns: { "b_enc": 12 },          // per-box turn counters, per flow
      prng: 1199730143,                // mulberry32 state, uint32, per flow
      cooldowns: { "c_ambush": 15 },   // absolute next-eligible turn of that card's box
      board: { "h_board": ["c_rat_job"] },   // hand contents, in dealt order
      playLog: [ { card: "rat-job", outcome: "accepted", turn: 11 } ],
    },
  },
}
```

**`@world` is never in the envelope.** It's your game's state - the engine only borrows it -
so your game saves its world once, beside the envelope
([why](/play/world-state/#saving-it)). The `.storyletsave` FILE on disk is
`storylets/savefile@1`: `{ schema, engine: <the envelope>, world?: <your values> }`, both
halves in one file. Storyletter's Board writes them, every runtime reads and writes them,
and a foreign, malformed or wrong-project file is refused at the boundary instead of
corrupting a run.

Loading a save against edited content is safe. Orphaned keys drop harmlessly: a deleted
card's cooldown, a deleted hand's contents, a re-flagged property's old partition. Newly
declared properties get their defaults. A save whose bundle triple doesn't match is flagged,
never guessed at.

## Determinism

The PRNG is **mulberry32**, bit for bit across every runtime, with its state a plain uint32
in the save. The default seed is 0. There's one PRNG per flow: `random(a, b)` draws
advance it, tie shuffles advance it, and the hand-order shuffle in a multi-hand deal
advances it.

So a seeded coverage run reproduces exactly, and the same seed gives the same result in the
editor, in CI and in every engine.
