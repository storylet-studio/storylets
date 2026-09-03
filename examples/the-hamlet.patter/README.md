# The Hamlet (Patter side)

The dialogue half of the joint demo: the Storylet Engine chooses the beat, Patter
performs it. The storylet half is `../the-hamlet.storylets`, and the design is in
the workshop repo (`design/the-hamlet-patter-demo.md`, and Reboot.md section 10).

**Every scene here is a STUB.** Each one has a single placeholder text beat and
the outcome plumbing. The plumbing is real and tested; the words are not written
yet. Replace the text, keep the shape.

## The contract, which is by name and not by a field

- **A scene's id IS the storylet card's `gameId`.** `arrive-at-the-gate` here is
  `arrive-at-the-gate` there. Nothing declares the link, so nothing can get it
  half-right. One file per card, sixteen of each.
- **A scene reports which outcome it reached** with a `gameEvent` beat carrying
  `gameData: { outcome: "<the outcome's gameId>" }`, at the end of whichever
  branch it took. The host plays that outcome through the Storylet Engine.
- **It is a `gameEvent`, not the choice**, because a scene may hold several
  choices or dialogue after one, so the outcome is only known when the branch
  resolves. `gameEvent` is Patter's own "host-facing cue, no spoken text".

Cards with one outcome fire the event and end. Cards with several offer one
choice option per outcome, each branch ending on its own event.

## If you rename anything

A card's `gameId` is this project's scene id, and an outcome's `gameId` is the
string in `gameData`. Renaming either on the storylet side breaks the link, and
**a card whose `gameId` is derived from its title rather than pinned will break
if the title changes** (`the-tree-blooms` is the one such card today). The
cross-check in the demo client is what catches all of this; until it exists,
rename carefully.

## Checking it

```
npx @patterkit/cli validate the-hamlet.patter
npx @patterkit/cli play the-hamlet.patter --scene arrive-at-the-gate
```

The second prints the stub line and then `(game event {"outcome":"step-through"})`,
which is the whole seam in one line.
