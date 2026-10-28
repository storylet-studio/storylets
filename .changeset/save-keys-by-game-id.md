---
"@storylet-studio/model": minor
---

Saves name cards, hands and boxes by Game ID: `SAVE_SCHEMA` is `storylets/save@3`, and `SAVE_SCHEMA_V2` names the version 2 envelope, keyed by internal id, which still loads. A load report's `evicted` can also carry a deal's reasons (`condition`, `deck-gate`, `hand-condition`, `cooldown`, `tags`, `taken`), for a held card a load drops because it no longer qualifies.

A card's dealing rules: `weight` (how often among cards of equal rank), `inOneHand` (how many copies one hand may hold) and `acrossHands` (`"one"` hand at a time, or `"any"`) replace `copies`, which is deprecated and migrated by `format`. A box's `cardDefaults` declares the Card template's defaults for Redraw and these three, live as field defaults are, so a card's `redraw` is optional in source. A box's `turn` takes an optional `seconds`: without it the game moves the clock.
