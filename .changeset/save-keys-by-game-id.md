---
"@storylet-studio/model": minor
---

Saves name cards, hands and boxes by Game ID: `SAVE_SCHEMA` is `storylets/save@3`, and `SAVE_SCHEMA_V2` names the version 2 envelope, keyed by internal id, which still loads. A load report's `evicted` can also carry a deal's reasons (`condition`, `deck-gate`, `hand-condition`, `cooldown`, `tags`, `taken`), for a held card a load drops because it no longer qualifies.
