---
"@storylet-studio/model": minor
"@storylet-studio/compiler": minor
"@storylet-studio/runtime": minor
---

The durability axis: `durable` on a declaration, a deck and a card (design/engine-server.md 4.2).

`shared` says whose a value is WITHIN a run. `durable` says whether it survives the run at all, and the two are independent: shared and durable is the installation's memory (trolls defeated since it opened), per-flow and durable is the player's pocket (visits, allegiance, what they earned).

`PropertyDecl.durable` is valid wherever `shared` is, and is a compile error on a `@world` declaration for the reason `shared` is: `@world` is the game's own state, and how long the game keeps it is the game's business.

`Deck.durable` and `Card.durable` mean one thing: the card's `redraw: "never"` spend survives the run. A card takes its deck's flag unless it sets its own, exactly as `shared` already works between the two. Only `"never"` can cross a run boundary, for the reason only `"never"` crosses the flow boundary in shared-scarcity 9.3.2 - a finite cooldown is an absolute turn of a box clock, and the clock resets with the run - so `durable` on any other redraw is a compile warning, said on the card that set it, and a durable deck with nothing spent for good in it is warned about once, on the deck.

**The runtime is INERT.** The engine partitions by `shared` alone and never reads the flag. Durability is what a server does at a run boundary, entirely on the public surface: read the declarations, lift the values with `getProperty` and the spends out of `saveGame`, then put them back with `setProperty`, `openFlow(id, { restore })` and `markTaken`. No corpus case, because nothing about play is different.

The four bundle parsers carry the flag so the four inspectors can report it: `describeBundle` marks a durable declaration with `durable: true` on `PropertySummary` and counts a box's durable cards as `BoxSummary.durableCards`, and each inspector shows "(durable)" on the property row and "durable cards N" on the box's counts line.
