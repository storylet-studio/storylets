# Port Meridian

A mini demo of storylets driving the SUPPORTING systems of an action game.
The game carries the gameplay; this project answers one question five ways -
"what belongs here, now?" - where only the verb differs:

- **Contracts** are *offered*: the player chooses to take one. A contract is
  two cards - the offer at a job board, the resolution at the destination -
  joined by a `jobs` flag.
- **Encounters** are *forced*: the game asks what the challenge is in this
  district, springs it when it likes, and reports the result by playing one
  outcome. Every card ends with a quiet **Moved on** - the game's release
  valve when the player disengages.
- **Items** are *hidden*: found by exploring. The `value` field is data for
  the game's economy, delivered in the dealt slice.
- **Codex** entries are *unlocked*: dealt, never played, accumulating. The
  game's UI just reads the hand.
- **News** is *broadcast*: never played either. A headline leaves a screen
  the way an offer is withdrawn - the game's news cycle clears `@story.wire`
  and re-deals, and stale conditions evict.

The spine is one quality, `@story.heat` (`unnoticed > watched > hunted`),
which every box reads and only outcomes advance. Boxes talk to each other
ONLY through `@story` - open the Links window to watch a delivery going loud
ripple into checkpoints, headlines and codex entries.

The integrator's contract this example demonstrates (what "a turn" means per
box, the world-hook naming discipline, how a game reacts to the spine) is
covered by [World state](https://storylet.studio/play/world-state/) and
[Dealing](https://storylet.studio/play/dealing/).
