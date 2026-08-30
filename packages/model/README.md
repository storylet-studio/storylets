# @storylet-studio/model

Storylets data-model types: source shards (project / box / tags / hands /
deck files), the compiled `.storyletsc` bundle, and the save
envelope. The shape source-of-truth; no behaviour.

Entity shapes are generic over their expression representation: source
shards carry plain `src` strings (`Card<string>`), the compiled bundle
carries `{ src, ast }` envelopes (`Card<Expression>`).

Authored against [the bundle format](https://storylet.studio/format/bundle/)
and [the source format](https://storylet.studio/format/shards/).
