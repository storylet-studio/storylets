---
"@storylet-studio/model": minor
---

Storylet extensions (phase 3 of the extensions proposal): the extension data shard (`.storyletextension`, `EXTENSION_SCHEMA`, `ExtensionShard`), the project's opt-in (`ProjectShard.extensions`, `ProjectExtension`), the manifest's place in a project (`MANIFEST_EXTENSION`, `EXTENSIONS_DIR`, `SOURCE_EXTENSIONS`), the reserved `UNRESOLVED_KEY` an unresolved merge writes into any shard, and in the bundle each node's `extensions` values and the `extensions` section with each extension's compiled declarations (`BundleExtension`, `ExtensionFieldDecl`, `NodeExtensions`). Bundles without extensions are unchanged.
