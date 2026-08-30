# The Village (example)

The big worked example: the complete Village from the previous generation of
Storylets, ported to the new format. **86 cards across 13 decks, 13 places in 5
regions**, where [The Hamlet](../the-hamlet.storylets/README.md) is a 16-card
slice of the same story cut down to be read in one sitting.

Open it with `npm run studio` (File ▸ Open Project), or drive it from the CLI:

```
storyletengine deal wishing-well the-village.storylets
storyletengine coverage the-village.storylets --runs 40 --seed 1
```

## What it exercises that the Hamlet cannot

- **Scale.** 13 decks running as parallel arcs, most of them a chain of beats
  where playing one opens the next.
- **Both ways a card reaches a place, at volume.** 68 cards belong to exactly
  one place, 4 to two places, 14 to a whole region.
- **A map with five regions**, each carrying its real outline from the original,
  each with its background picture from the original demo game behind it
  (`village/assets/`), and all thirteen sites standing where they stood in the
  original (`view.storyletview`), so the map reads as the world rather than as
  five empty rectangles.
- **Acts as deck gates.** Every deck is single-act, so the old model's `actId`
  needs no concept of its own here: 13 deck conditions replace what would have
  been 86 per-card ones.
- **Regional gating.** The four wild regions open in act 2 and the village never
  closes, which is one condition on a hand template rather than twelve copies.
- **Composed `@hand` state.** The old `@zone` scope becomes properties declared
  once on the `zone` tag group, so a card at any place in the cave reads the
  cave's own `haunting`, and every zone added later has one automatically.

## How the old model maps to the new one

| Old Village | New format |
|---|---|
| `storyworld` | the project; its 11 flag properties become `@story` |
| Zones (5) | a spatial `zone` tag group, outlines carried |
| Zone artwork (game-side, `images/zones/*.jpg`) | map **backgrounds** on the same group, one behind each outline |
| Zone conditions | a condition on the hand template for places in the wilds |
| Sites (13) | **hands**, one per place, each choosing its region, standing at their original map positions |
| Storylet `sites: [...]` | `place:` tags (the direct "I belong here") |
| Storylet `zones: [...]` | `zone:` tags ("anywhere in here") |
| Decks (13) | decks, their conditions kept as the deck gate |
| Acts (3) | folded into those gates |
| `tags: [bard]` | a plain `thread` tag group, for the pacing rules that count it |
| `@zone.x` | tag properties, read as `@hand.x` |
| Pins (8) | dropped: portals are the host's business |
| `gameData.ink-fragment` | dropped: that is game data, not storylet data |

## Facts are flags, stages are a quality

Six of the thirteen decks run their spine on a **quality**, an ordered ladder
of named stages, and keep their flags for everything that is not a sequence.
The split is the teaching, so it is worth reading as a table:

| Deck | The ladder | What stays a fact, and why |
|---|---|---|
| The Oracle's Prophecy | `prophecy`: unheard > first > second > final | nothing: a pure ladder, three visits in order |
| The Well's Bargain | `curse`: unfelt > unease > spreading > undeniable | the six investigation flags (sources consulted in any order) |
| the `zone` group | `haunting`: quiet > restless > screaming, per place via `@hand` | The Haunted Miners' own four booleans (see below) |
| Gareth's Debt | `debt`: quiet > engaged > resolved | `troubled_seen` and `aldric_background_known`, gathered either way round |
| Mira's Secret | `secret`: unnoticed > noticed > letter > confession | `direct_path` / `elara_path`: the route is a branch, not a rung |
| Forging a Legend | `legend`: unheard > planned > forged | `iron_gathered` and `shards_gathered`: two errands, either order |
| Behind the Door | `door`: shut > seen > warned | three lore sources, read as `(research && oracle) \|\| lore` |

The other seven stay entirely on flags, which is the other half of the lesson.
Market Shadows, The Cursed Hoard, Arrival and the ambients are genuinely
meshy: their beats can land in any order, and forcing them into a ladder would
be the one-big-quality mistake. The Haunted Miners looks like a spine until you
notice you can reach `descended` without ever seeing the screaming, so its own
deck flags have no single order to name. Its LADDER lives one scope over: the
`haunting` quality is declared once on the `zone` tag group, each zone sits at
its own stage of the same ladder, and the miners' cards gate on
`@hand.haunting >= "screaming"`, meaning "wherever this hand is, if it has got
that bad". The write is `advance(@hand.haunting)`, which moves only the zone
the hand belongs to. This was the port's other integer in disguise: the same
`>= 2` shape as the curse, unconvertible until qualities could live on a tag. The Calling Tree and The Lost Patrol are untouchable
for a different reason: they carry the original's bugs, below.

**The Well's Bargain is why the type exists.** Its curse was an integer in the
original, and the gates read `@deck.curse_intensity >= 2` and
`< 2`. Two. A number that says nothing about the story: you had to read every
outcome in the deck to learn what two meant. The same gates now read
`@deck.curse >= "spreading"` and `< "spreading"`, and the outcomes say
`advance(@deck.curse)` instead of `+ 1`. Nothing about the play changed. The
difference is that the condition is now legible to whoever reads it next, and
the compiler rejects a stage name that does not exist, where it could never
reject a wrong number.

The conversion also let a few conditions collapse. Gareth's confrontation used
to be gated on `(@deck.confronted || @deck.committed) && !@deck.helped &&
!@deck.negotiated && !@deck.abandoned`: two ways in, three ways to have
finished already. It is now `@deck.debt == "engaged"`, because a ladder cannot
be at two rungs at once and the ending advances past it.

## The coverage story, which is the point of shipping it

Run Coverage and **81 of 86 cards are dealt**. The five that never come up are
the original's own bugs, faithfully carried across, and they trace to a single
missing write:

1. Nothing anywhere sets `@deck.well_vision`, so **accept-the-trees-demand**
   can never be dealt.
2. That card is the only writer of `@deck.demand_known`, so
   **name-the-trees-price** goes with it.
3. Those two are the only writers of the `tree_bloomed` world event, so
   **perform-the-old-ritual**, over in another deck, goes too.
4. **expose-the-conspiracy** is a second, separate root, and it is the only
   writer of `traders_arrived`, which takes **sell-the-legend** with it.

One missing write, five dead cards and ten dead outcomes, spread across four
decks that never mention each other. Nothing in the original could see it. Here
it is one coverage run, and the node canvas draws the same fact as a
`references` edge: cards waiting on a property nobody writes.

The port deliberately does **not** fix it. An example that shows the tool
earning its keep is worth more than a tidy one.
