---
"@storylet-studio/model": minor
---

Host scopes like Patter's: `HostScopeDecl`, `HostScopeSpec` and `HostScopeRegistry`, and `scopeRegistry` on the project shard and the bundle, in place of `world`. `BUNDLE_SCHEMA` is `storylets/bundle@2`; `BUNDLE_SCHEMA_V1` names the @1 bundle, which with @0 is still read, its `world` block (`LegacyWorldBlock`, now optional on `Bundle` and `ProjectShard`) read as the host scope `world`. Helpers: `bundleHostScopes`, `hostScopeSpec`, `hostScopeDecls`, `setHostScopeDecls` and `migrateLegacyWorld`.
