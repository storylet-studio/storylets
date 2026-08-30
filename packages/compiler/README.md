# @storylet-studio/compiler

The Storylet Engine compiler: `.storylets` shards in, validated
`.storyletsc` bundle out.

- **`parseSource` / `canonicalStringify`**: JSON5 in, the canonical byte
  form out (the versioned contract of
  [the source format](https://storylet.studio/format/shards/));
  `serialiseBundle` emits the bundle's strict-JSON canonical bytes.
- **`parseProjectFiles`**: `SourceFile[]` -> `SourceProject` (directory is
  the registry; structural issues reported, never thrown).
- **`compileProject`**: the publish gate - reference checks (card tags,
  template bindings and holes, hand -> hand template, card fields against
  the box shape, id and gameId
  uniqueness) and expression validation against the declared scopes, then
  assembly: expressions to `{ src, ast }` envelopes, collections sorted by
  id, the `hash32` content hash embedded.
- **`bundleIsFresh`**: the staleness gate - does a committed bundle still
  match the shards? (`validate` errors when not; schema doc 2.8.)
- **`loadProjectFiles`**: the thin fs edge; the core is pure and the hosted
  shard store feeds the same shapes (Reboot 8.2).

The pure core takes `SourceFile[]` (path + text) so desktop, CLI, CI and
the hosted store all share one compiler.
