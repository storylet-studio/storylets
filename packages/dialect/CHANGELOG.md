# @storylet-studio/dialect

## 0.2.0

### Minor Changes

- 0f5311a: Other engines' scopes, with no setting. `@storylet-studio/dialect` accepts every game-wide scope token in the family's shared list other than its own (`@patter`), with the Storylet Engine's missing-property policy, and exports `ENGINE_SCOPES`, `EXTERNAL_SCOPES`, and `OWN_SCOPES`. `Bundle.externalScopes` records the other engines' tokens the content names.
