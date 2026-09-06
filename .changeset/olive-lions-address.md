---
"@storylet-studio/model": patch
---

`LoadProperty.path` is documented as the gameId form (design/engine-server.md 4.4).

No type changed. What changed is what the string in it says: a load report's property address now names its owner by gameId (`box.village.mood`), the way `listProperties()` prints it and the way `getProperty` and `setProperty` take it, where all three used to say the owner's internal id. The doc comment carried a note that the gap was uniform and would be closed by 4.4 across all four runtimes; it has been, so the note is replaced by the rule. An owner the build no longer has keeps the id the save carried, since there is no gameId left to give it, which is the rule the eviction list beside it has always used.
