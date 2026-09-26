# @storylet-studio/with-patter

Play a dealt storylet card as the [Patter](https://patterkit.dev) scene named after it, and take the
outcome the scene reaches. The contract is by name: a card's `gameId` is its scene's address, and a
scene says which outcome it reached by labelling the option the player takes with the outcome's
`gameId` in its Game Data, or with a `gameEvent` carrying one. A card with one outcome needs neither.

DOM-free and engine-agnostic about the Storylet side: you deal, you draw, you play the outcome.

```ts
import { Performer } from "@storylet-studio/with-patter";

// Both engines on your game's one ScopeRegistry, as in the Storylets-with-Patter guide.
const performer = new Performer(patter, new Set(["village"]));

const card = flow.deal("the-inn")[0];
const outcomes = flow.outcomes(card.gameId, "the-inn");      // { gameId, available }
let p = performer.start(card, "village", outcomes);
// draw p.transcript; while p.options, let the player pick:
p = performer.choose(p, pickedOptionId, outcomes);
// once p.ended, p.outcome is the outcome to play (or p.problem says why there isn't one)
flow.play(card.gameId, p.outcome, "the-inn");
```

One Patter flow per performed box, named after the box, entered with `goto` for each card, so
Patter's memory (visits, shuffles) carries across the box's cards. An option is marked not
`enabled` when Patter's condition on it fails or the outcome it leads to is gated shut.
