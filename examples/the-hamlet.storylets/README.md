# The Hamlet (example)

The small worked example: a coherent slice of the same village story the
full **Village** example tells, cut down so it can be read in one sitting.
It exercises every format feature, so the editor's surfaces have real
content to show. Open it with `npm run studio` (File > Open Project), or
drive it from the CLI (`storyletengine deal the-inn the-hamlet.storylets
--deal-all`, or `storyletengine peek village the-hamlet.storylets --where
zone=village` to look at the stock without claiming anything).

Not a full port: the old demo has 86 storylets across 13 decks; this is ~16
cards across 5 decks, chosen to still read as one story and to touch each
feature once.

## How the old model maps to the new one

| Old Village | New format |
|---|---|
| Zones (village, forest, mountain, cave, lair) | a `zone` **tag group** with those tags |
| Decks (Arrival, Gareth's Debt, ...) | **decks** in one `village` **box** (all cards share a shape) |
| Sites (The Inn, The Forge, ...) | **standing hands** sharing their zone's pool (exclusivity puts a limited beat at one site) |
| Acts | a `@story.act` enum the cards read and advance |
| `rel_*` / `world_events` flags | `@story` flags (the story's own state) |
| (host-owned state) | `@world.time_of_day` - the game seam, and a coverage-driver demo |

## What it shows

- **Hands as the contract**: `whats-happening` is the writer/programmer
  seam, one hand per zone through a hand template; the ambient deck is
  non-exclusive background.
- **Both ways a card reaches a place**: nine cards are tagged `home` (they
  belong AT The Inn, The Forge or The Mystic Tree, and come up nowhere else),
  and seven carry a zone tag instead (they belong anywhere in that region).
  The editor's **Where** row reads both as one sentence. Gareth is the
  blacksmith, so his cards live at the forge; Mira keeps the inn; the tree's
  two beats are at the tree. The arrival, the ambients and the moneylender's
  men are regional, because no one place owns them.
- **Standing hands**: The Inn and The Forge share the village pool; The
  Mystic Tree sits in the forest.
- **Conditions and ranking**: arrival one-shots (`redraw: never`), priority
  ordering, specificity from richer conditions.
- **Gated outcomes**: "Stand with Gareth" needs a warm first impression;
  "Pay the debt" needs reputation.
- **Scopes**: `@story` (the arc and relationships), `@deck` (each arc's
  private state), `@world.time_of_day` (the host seam), and `@hand`
  on the forest (the tree card raises the forest's `peril`, which another
  card then reads - composition and write-back).
- **Facts are flags, stages are a quality**: Gareth's Debt runs on a `debt`
  quality (`quiet` > `troubled` > `confronted`), each beat gating on a stage
  and advancing it, with a `helped` fact alongside for WHICH ending you chose.
  Mira's Secret, whose beats can land in any order, stays on flags: the
  side-by-side is the point.
- **A coverage story, already solved.** As shipped, Coverage reports full:
  16 of 16 cards dealt, because the project carries a driver for
  `@world.time_of_day`. To see the problem the driver fixes, delete the
  `coverage` block from `the-hamlet.storyletproj` and run it again: five cards
  read as never-dealt, two of them named as gated on `@world.time_of_day`,
  which nothing writes. The "Add coverage drivers" quick-fix writes that block
  back, and coverage returns to full - the tree only glows at night, and its
  bloom follows.
