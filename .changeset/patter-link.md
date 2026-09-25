---
"@storylet-studio/model": minor
---

`ProjectShard.patter` optionally names the Patter project this one is paired with, as a `.patter` folder relative to the project file. It is authoring config and never compiled: with it, `validate` checks each card against the scene of the same name in that project's published bundle, and Storyletter can open Patterpad at a card's scene.
