---
title: The bundle and the save
description: Learn what export writes into the compiled .storyletsc bundle, how the staleness check guards it, and what the .storyletsave envelope snapshots.
sidebar:
  label: Bundle and save
---

Your shards are the source. The bundle is what ships.

## What export does

`storyletengine export` (or **Publish ▸ Publish Bundle** in Storyletter) is the compiler.
It:

1. **Compiles every expression** from source text into a `{ src, ast }` envelope, so no
   runtime ever ships a parser.
2. **Assembles the shards**, the project file, the project map, and every box folder and deck
   file, into one JSON document, with every collection sorted by id except a card's
   outcomes, which keep the order you gave them.
3. **Validates**, refusing to write anything on an error. It checks for property references
   nothing declares, tag references that point nowhere, hands that don't fill in every group
   their template asks for, and field values against the box's card template.
4. **Computes a content hash** over the canonical source shards and embeds it.
5. **Carries author metadata through** by default. A `stripped` build omits the `title` and
   `purpose` of every box, deck, card, outcome, hand template, hand and tag group. Property
   and field declarations keep their `purpose`.

The output is a single strict-JSON `.storyletsc` file at the path the project shard's
`export.bundle` names. New projects point it at a `storylet-dist/` folder beside the project,
named after it (`../storylet-dist/the-hamlet.storyletsc`), and that is the default when the
shard names nothing. The project folder is the document; a build output never goes inside it.
Patterpad publishes to `../patter-dist/` in the same way.

## What's in it

```json5
{
  schema: "storylets/bundle@1",
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
  map: { /* the project map, when there is one: see below */ },
  externalScopes: ["patter"],          // other engines' scopes the content names, when any
}
```

There's no text a player would read, no localisation and no captions. A card is its
condition, its ranking inputs, its redraw policy, its tags, its outcomes, and its box-shaped
fields, and an outcome is its condition, its changes, and its own box-shaped fields, which
keeps a bundle small.

Author metadata is kept. Titles and purposes ship by default because they make a trace
readable: "why did *Ambush at the ford* get dealt here?" is a question the log can then
answer in words.

## The project map

A project with a [map](/storyletter/maps/) has a `map` block, with its zone group in it:

```
map: {
  group: { /* the zone group: its id, gameId, and tags, each zone with its properties */ },
  geometry: { /* the drawing, only when the project asked: see below */ },
}
```

The zone group always ships, because hands and cards name its zones by id, just as they name
a box's own tags. It's in no box's `tagGroups`. A box that uses the map says so with
`usesMap: true`, and only those boxes may name the map's zones. Each zone is one tag for the
whole bundle, so a zone property is one value whichever box's hand is dealt there, at the
address `value.<zone>.<name>` (see [Your game's state](/play/world-state/#writing-it-from-your-game)).

A bundle with no map has no `map` block, and no box carries `usesMap`.

### The drawing, when you ask for it

The drawing is off by default, because geometry is authoring data, the engine deals in tag
names, and a shipping build needn't carry anything it doesn't use. Turn on `export.map` in
the project shard (or pass `--map` to one export) and the block gains `geometry`:

```
geometry: {
  zones: [                     // drawn zones only, by tag gameId
    { tag: "tavern", polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] },
  ],
  backgrounds: [
    { file: "assets/plan.png", x: 0, y: 0, width: 800, height: 600, opacity: 0.6 },
  ],
  sites: {                     // where each box's placed hands stand, by box gameId
    village: [
      { hand: "the-forge", x: 210, y: 340 },
      { hand: "the-well", x: 120, y: 80 },
    ],
  },
}
```

Everything is named by gameId, the same names `peek` takes, so a host can match a shape to
the tag it draws. Background pictures are written as files next to the bundle at the path
each entry names, ready for an engine to import.

`sites` is where each placed hand stands, box by box, each list sorted by hand gameId so the
bytes don't move when a shard is reordered. A hand nobody has placed has no entry, a box with
no placed hand has no key, and a map with no placed hand has no `sites` at all. Which zone a
hand is in isn't repeated here, because the hand's own binding is what the engine deals from.

**The engine never reads the geometry.** It's there for a host that wants to draw an in-game
map without building its own export. `describeBundle` reports which boxes use the map and how
much of the drawing a bundle carries, so geometry can't slip into a build unnoticed.

### What a runtime refuses

A runtime refuses, when the engine is made, a bundle that breaks the map's rules, naming the
box and the group or tag: a box without `usesMap` that names the map's zones, a box with
`usesMap` in a bundle with no map, a box group with the map's group name, a box tag with a
zone's name, or a map group named `place`. The compiler refuses all of these first, so a
bundle Storyletter or the CLI wrote never meets them.

## The staleness check

`content.hash` is a hash over the canonical source shards. `storyletengine validate`
recomputes it and **errors if a committed bundle doesn't match the shards**:

```
$ storyletengine validate the-hamlet.storylets
error: ../storylet-dist/the-hamlet.storyletsc: bundle is stale (content hash does not
  match the shards); run: storyletengine export
```

That's what makes committing the bundle safe. The default is to commit it, marked
`merge=ours` in `.gitattributes`. You regenerate it, you never hand-merge it, and the hash
means a stale one can't land without `validate` saying so. Ignoring the bundle instead is a
choice you can make in `.gitignore`.

The same triple (`project`, `version`, `hash`) ties a save to the bundle it was made
against.

## Versioning

The `schema` tag (`storylets/bundle@1`) versions the format, and runtimes refuse a version
they don't speak. Today's runtimes read `@1` and `@0`; the project map brought `@1`, and a
bundle with no map differs from an `@0` one only in its tag. Canonical source serialisation is versioned the same way, in each
shard's own `schema` tag. A change to how shards serialise is a schema bump even if no field
changed, because the bytes are part of the contract.

## The save envelope

A running engine snapshots to a `storylets/save@2` envelope, which holds what is not a
property: what a shared one-shot spent, then every flow's own blob, keyed by the flow's name.
Boards, cooldowns and spent cards are keyed by immutable id, so renaming things in the project
doesn't break a save. The play log is the exception: it records cards and outcomes by gameId,
the names the play-history functions take.

Property values live in the game's **registry** (a `ScopeRegistry`, one per game, see
[Running it with Patter](/play/with-patter/#one-registry)). An engine built without one makes
its own, and then its envelope carries that registry's values under `registry`, so one call is
still the whole run. An engine given the game's registry leaves them out, and the game saves the
registry once, beside every engine's envelope. The keys are the same on every runtime:
`story` for the shared `@story`, `storylets/<kind>/<id>` for a shared box, deck, hand, or
value bag, and `storylets/flow/<flow>/story` or `storylets/flow/<flow>/<kind>/<id>` for a
flow's own. A bag with no declared properties isn't registered.

Claims aren't in it. A claim is just "this card is on that hand right now", so
it is read back off the boards rather than stored twice. What a shared one-shot **spent** is
durable, so that does ride the shared half.

```json5
{
  schema: "storylets/save@2",
  content: { project: "proj_salt", version: "0.3.0", hash: "a91c..." },
  registry: {                          // only when the engine made its own registry
    story: { reputation: -1 },         // the shared-flagged properties
    world: { gold: 120 },              // a self-backed @world
    "storylets/box/b_enc": { heat: 2 },
    "storylets/flow/main/deck/k_docks": { visits: 3 },   // this flow's own copies
    "storylets/flow/main/hand/h_board": { owner: "elder" },
    "storylets/flow/main/value/v_docks": { danger: 3 },  // tag state
  },
  shared: {
    spent: ["c_pixie"],                // shared one-shots taken out of the world
  },
  flows: {
    "main": {
      turns: { "b_enc": 12 },          // per-box turn counters, per flow
      prng: 1199730143,                // mulberry32 state, uint32, per flow
      cooldowns: { "c_ambush": 15 },   // absolute next-eligible turn of that card's box
      board: { "h_board": ["c_rat_job"] },   // hand contents, in dealt order
      playLog: [ { card: "rat-job", outcome: "accepted", turn: 11 } ],
    },
  },
}
```

A `storylets/save@1` envelope, from before the registry held the properties, carried them as
`props` partitions in its shared half and in each flow. Every runtime still loads one, and its
values move into the registry as it does. `saveFlow(id)`, which parks one flow, still carries
that flow's `props`, because a parked flow's values leave the registry when it closes.

**A `@world` your game binds is never in the envelope.** It's your game's state (the engine only
borrows it), so your game saves it once, beside the envelope
([why](/play/world-state/#saving-it)). A self-backed `@world` is a property the engine's own
registry stores, so it rides under `registry`. The `.storyletsave` FILE on disk is
`storylets/savefile@1`, which is `{ schema, engine: <the envelope>, world?: <your values> }`,
both halves in one file. Storyletter's Board writes them, every runtime reads and writes
them, and a foreign, malformed, or wrong-project file is refused at the boundary instead of
corrupting a run.

Loading a save against edited content is safe. Orphaned keys drop harmlessly: a deleted
card's cooldown, a deleted hand's contents, a re-flagged property's old partition. Newly
declared properties get their defaults. A save whose bundle triple doesn't match is flagged,
never guessed at.

## Determinism

The PRNG is **mulberry32**, bit for bit across every runtime, with its state a plain uint32
in the save. The default seed is 0. There's one PRNG per flow. `random(a, b)` draws
advance it, tie shuffles advance it, and the hand-order shuffle in a multi-hand deal
advances it.

So a seeded coverage run reproduces exactly, and the same seed gives the same result in the
editor, in CI, and in every engine.
