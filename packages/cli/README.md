# @storylet-studio/cli

**`storyletengine`** - the Storylet Engine CLI, a thin front-end over
`@storylet-studio/ops` (one implementation of each operation; the editor
and CI consume the same functions).

```
storyletengine init [dir] [--name X]     scaffold a new .storylets project
storyletengine new box [path] [--kit K]  add a box, scaffolded from a kit
storyletengine validate [path]           publish gate + bundle staleness + canonical form
storyletengine format [path] [--check]   rewrite shards to canonical form (alias: fmt)
storyletengine export [path] [-o file]   compile to the .storyletsc bundle (-o - for stdout)
storyletengine peek <box> [path]         look at the stock through the reference runtime
    [--where group=tag ...] [--n N] [--set path=value ...] [--seed N] [--deal-all]
storyletengine deal <hand> [path]        refresh a hand through the reference runtime
    [--set path=value ...] [--seed N] [--deal-all]
storyletengine resolve <query> [path]    find an item by gameId, id or title: where it lives
                                         (the same lookup as Storyletter's --at)
storyletengine export-html [path]        one self-contained playable .html (runtime, board
    [-o file]                            and bundle inlined; opens in any browser)
storyletengine export-xlsx [path] -o F   the whole project as a readable .xlsx workbook
storyletengine links [path]              the influence graph: which cards open which
storyletengine pack [path] -o FILE       pack a project into one portable .storyletpack
    [--assets|--no-assets]               (--assets carries the background pictures too)
storyletengine unpack FILE -o DIR        explode a .storyletpack into source shards
    [--merge --base SENT.storyletpack]   (--merge folds a RETURNED pack back in by id)
storyletengine merge BASE OURS THEIRS    id-keyed 3-way merge (+ .storyletconflict sidecar)
    [-o out] [--path realfile] [--json]
storyletengine coverage [path]           seeded playthroughs: per-hand and per-card coverage
    [--runs N] [--max-turns M] [--seed S] [--json] [--fail-on-gap] [--propose]
```

Exit codes: 0 ok, 1 the operation found problems, 2 usage. `merge` alone maps a
malformed input to 2 as well, so a version-control driver can fall back.



## Shipping shape

Three tiers, Patter's CLI distribution carried whole:

- **npm**: `dist/cli.js` is **self-contained** (tsup inlines every workspace
  and sibling dependency), so the published package runs with no
  node_modules.
- **Standalone binaries**: `npm run build:standalone` (Bun `--compile`) emits
  one native executable per platform - no Node required. macOS binaries are
  Developer ID signed (hardened runtime + JIT entitlements,
  `entitlements.plist`); Windows ships unsigned by policy.
- **Release flow**: tagging `cli-vX.Y.Z` runs
  [.github/workflows/cli.yml](../../.github/workflows/cli.yml) - macOS builds
  and signs its own binaries, Linux cross-compiles the Linux + Windows set,
  and all five land as GitHub Release assets.
