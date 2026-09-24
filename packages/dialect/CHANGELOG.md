# @storylet-studio/dialect

## 0.3.0

### Minor Changes

- 52b550d: Shared game scopes (patterkit design/shared-scopes.md). `ProjectShard.gameScopes` optionally names the game's shared scopes folder, relative to the project file, for a folder the tools would not find by looking up from the project; it is authoring config and never compiled. `@storylet-studio/dialect` exports `storyletsDialectWith(tokens)`: the dialect, also accepting the given game-wide scope tokens (every token a game's `game-scopes/` folder declares, such as a game's own `@player`), and `storyletsDialect` itself when there is nothing new to add.

## 0.2.0

### Minor Changes

- 0f5311a: Other engines' scopes, with no setting. `@storylet-studio/dialect` accepts every game-wide scope token in the family's shared list other than its own (`@patter`), with the Storylet Engine's missing-property policy, and exports `ENGINE_SCOPES`, `EXTERNAL_SCOPES`, and `OWN_SCOPES`. `Bundle.externalScopes` records the other engines' tokens the content names.
