---
"@storylet-studio/model": patch
---

`PlayRecord.outcome` documents the empty outcome: `""` for a card with no outcomes, played with none (the no-outcome-play brief, 2026-09-14). The key is always present, so a save's shape does not depend on the card.

Documentation only. The type is unchanged: `outcome` was already a `string`, and `""` is one. What gives the empty string its meaning is the runtime's `play(card, "", hand)`, which ships with the four runtimes' lockstep release, not with this package.
