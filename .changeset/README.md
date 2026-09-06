# Changesets

Four packages reach npm: `@storylet-studio/model`, `@storylet-studio/dialect`,
`@storylet-studio/runtime` and `@storylet-studio/play-helpers`. Everything else in `packages/` is `private` and
listed in `ignore` here, which is belt and braces: `ignore` keeps a package out
of versioning, `private` keeps it out of the registry, and it takes both to be
sure a 0.0.0 internal never ships.

Add a changeset with `npm run changeset` when you change `model` or `dialect`.

**Not for the runtime or the play helpers.** Together they are the JS member of the
lockstep runtime set: its version comes from `npm run bump:play`, together with
the Unity, Unreal and Godot ports, because one version number has to mean one
runtime behaviour across all four. A changeset naming it would bump it out of
step with three ports that never had that version. `npm run release:guard`
refuses one. It still reaches npm, because the release publishes any package
whose version is ahead of the registry.
