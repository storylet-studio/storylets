---
"@storylet-studio/model": minor
---

Outcomes gain fields (design/outcome-fields-brief.md, 2026-09-13).

`Outcome.fields?: Record<string, ScalarValue>` is template data as `Card.fields` is: field name to value, validated at publish, handed to the host with the outcome, never read by the engine. `Box.outcomeFields?: FieldDecl[]` declares which fields an outcome may carry, beside the card template and in the same shape, and `BoxShard.box.outcomeFields` is the source of it. Both are optional and absent when a box declares none, so a bundle from a project without them is byte for byte what it was, and `FieldDecl`'s comment now says it serves both templates.

`ContractShard.outcomeFields?: string[]` lets a venue name the outcome fields its crew read, as `fields` names the card fields: a station showing an outcome's after-line is then a dependency `validate` refuses to break.
