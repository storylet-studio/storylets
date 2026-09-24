---
"@storylet-studio/model": minor
"@storylet-studio/dialect": minor
---

Shared game scopes (patterkit design/shared-scopes.md). `ProjectShard.gameScopes` optionally names the game's shared scopes folder, relative to the project file, for a folder the tools would not find by looking up from the project; it is authoring config and never compiled. `@storylet-studio/dialect` exports `storyletsDialectWith(tokens)`: the dialect, also accepting the given game-wide scope tokens (every token a game's `game-scopes/` folder declares, such as a game's own `@player`), and `storyletsDialect` itself when there is nothing new to add.
