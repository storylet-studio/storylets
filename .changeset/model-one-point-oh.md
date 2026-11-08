---
"@storylet-studio/model": major
---

The first stable release: from 1.0.0 the model follows semver, and a minor never breaks a project, a bundle or a save (see Versions and compatibility on storylets.dev). Two deprecated fields go. `ViewShard.map`, the box map's address before the MAP shard, is no longer part of the model: a map left in a view shard is ignored, and `storyletengine format` drops it. `copies` leaves the source card: `Card<string>` is now `CardFields<string>`, and only a bundle card (`Card<Expression>`) may still carry an old bundle's `copies`, through the new `LegacyBundleCard`, for a runtime to read. Depends on `@wildwinter/expr` and `@wildwinter/toolkit` ^1.0.0.
