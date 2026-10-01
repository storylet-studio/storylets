---
"@storylet-studio/model": minor
---

The project map: a project has at most one map, above the boxes. `Bundle.map` (a `ProjectMap`) replaces `Bundle.maps`; `Box.usesMap` opts a box in; zones are one value bag each, addressed `value.<zone>.<name>`; bundle schema `storylets/bundle@1` (`@0` still read). New source shapes: the root `map.storyletmap` (`ProjectMapShard`, `PROJECTMAP_SCHEMA`), `BoxShard.box.usesMap`, `BoxMap` holding sites only, and `bundleAssetPath(file)` in the root `assets/` folder. Helpers `groupsOfBox`, `groupById`, `allTagGroups`, `propertyAddresses`. Upgrade a project with `storyletengine format`. The view sidecar gains an optional `colour` (a palette slot for a box's layer on the map), never compiled.
