---
"@storylet-studio/model": minor
---

`MapShard`: the box map gets a shard of its own, `map.storyletmap` (design/engine-server.md 9.1 point 5).

Hand and zone placement used to sit in `view.storyletview` under `map`, beside the deck canvases. The two halves had stopped sharing an owner. A hand's position ships in the bundle's `maps` block, which since 4.3 makes it the thing a venue provisions its kiosks against: it is SHAPE, and a server's author key may not change it. A deck's node canvas is a working drawing that never leaves the project folder, and refusing an author their own canvas would be refusing them nothing the designer cares about. One file could not be both, and the ruling splits it.

`MAP_SCHEMA` is `storylets/map@0`, `SHARD_EXTENSIONS` gains `map: ".storyletmap"`, and `MapShard` is `{ schema, map: BoxMap }`. The block is NESTED rather than flattened to the top level, and deliberately: its bytes are then exactly what the view shard held, so the migration is a move of a value rather than a reshaping of it, the merge strategy carries over word for word, and a reader that has to look in both places is one expression.

`ViewShard.map` is deprecated and read-only for one release. It is still typed, so a reader that meets a project written before the split finds the map where it is; nothing writes it, `storyletengine format` moves it, and the compiler warns once per box naming that command. `ViewShard` itself now documents what it is left holding, which is the canvases.

Nothing in the compiled bundle changed. The `maps` block is byte for byte what it was, so none of the four runtimes moved and no corpus case did either.
