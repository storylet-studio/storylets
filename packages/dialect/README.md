# @storylet-studio/dialect

The storylets expression dialect for `@wildwinter/expr`: the five fixed
scopes (`story` / `world` / `box` / `deck` / `hand`, bare `@name` =
`@story.name`), all with missing-property = error, and the function set
(`random`, `check_flags`, `set_flags`, `count_played`,
`turns_since_played`, `count_played_in`, `turns_since_played_in`).

One dialect drives runtime eval and publish-time validation (schema doc
6.1). Runtime hosts supply the `StoryletsHost` callbacks (PRNG, play log)
via `EvalContext.host`.

Authored against [the bundle format](https://storylet.studio/format/bundle/),
section 6.

`storyletsDialectWith(tokens)` is the same dialect accepting more game-wide
scope tokens: the ones a game's shared scopes folder declares (`game-scopes/`,
where each editing tool writes its scopes for the others), such as a game's
own `@player`. Each added token gets the policy another engine's scope has.
With nothing new to add it returns `storyletsDialect` itself.
