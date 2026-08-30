# @storylet-studio/ops

The pure-function operations layer shared by the CLI, the editor and CI
(Reboot 7.3): one implementation of each operation, three front ends.

- `loadProject` / `findProjectDir`: resolve any path to its `.storylets`
  project (walk-up discovery) and parse it.
- `runInit`: scaffold a new project - project shard, a starter box with a
  playable two-card loop, editor associations (the shard extensions as
  JSON5), `.editorconfig`, `.gitattributes` and `.gitignore`.
- `runExport`: compile to the `.storyletsc` bundle at the project's
  declared output path.
- `runExportHtml`: one self-contained, playable `.html` (the runtime, the
  Board player and the bundle inlined; `player/` is the page's script,
  `scripts/gen-player-blob.mjs` bundles it into the committed blob).
- `runValidate`: the publish gate + the bundle staleness gate + the
  canonical-form check.
- `runFormat`: rewrite shards to the canonical byte form.
- `runAsk`: compile in memory, stand up a reference engine and flow, then peek a
  box's stock or deal a hand - "what would this give me right now?".
- `runResolve`: what a gameId, id or title names, and where it lives (box,
  deck, shard). The one lookup behind `storyletengine resolve` and
  Storyletter's `--at`.
- `runMerge` / `conflictSidecar`: the id-keyed 3-way merge (Reboot 7.4) and
  its `.storyletconflict` sidecar; a lingering sidecar is a validate error.
- `runCoverage` / `proposeCoverage`: seeded random playthroughs with
  external drivers (the `coverage` block in the project shard) - coverage
  per hand, per card and per outcome, plus the unwritten-inputs honesty
  net and whole-driver auto-proposal.
- `runNewBox`: add a box to a project, scaffolded from a starter kit
  (`blank`, `rpg`, `dialogue`), each teaching one chapter of the model.
- `runExportXlsx`: the whole project as a readable `.xlsx` workbook - a
  sheet per deck, plus Outcomes, Hands and Tag groups - for review.
- `runPack` / `runUnpack` / `runUnpackMerge`: the portable `.storyletpack`,
  for handing a project to someone with no shared version control, and
  folding the returned pack back in by id.
- `analyseInfluence` / `cardNeighbourhood`: the influence graph - which
  cards open, close or bear on which, derived from what each writes and
  each reads. What the Links window draws.
- `runPropertyUsage` / `runPropertyUsageMany`: every read and write of a
  property, in project order. The Many form compiles once for a whole list.
- `runReplace`: project-wide find and replace over authored text. It returns
  a plan, so a caller can preview the hits before committing any of them.

Operations return **planned writes**; callers commit them through the VC
layer (`@wildwinter/simple-vc-lib`), never raw fs (the merge driver is the
one deliberate exception: it runs while the VCS holds its own locks).
