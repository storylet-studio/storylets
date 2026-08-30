# Storylets

[![CI](https://github.com/storylet-studio/storylets/actions/workflows/ci.yml/badge.svg)](https://github.com/storylet-studio/storylets/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-storylet.studio-7b4b6e)](https://storylet.studio)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Storylet Studio** is an open toolkit for building storylet-driven games: stories
made of small, self-contained cards that the game deals when their conditions are
met, rather than a single branching tree. Designers work in **Storyletter**, a
desktop editor that shows a project as cards, decks and a map; a compiler turns
the plain files on disk into one small bundle that a **Storylet Engine** runtime
plays inside your game. The same bundle plays identically on JavaScript, Unity,
Unreal and Godot.

Everything here is MIT-licensed. **Documentation lives at
[storylet.studio](https://storylet.studio)**: a guided tour, per-role guides, and
the format reference.

## What is in this repository

| Area | What it is |
|------|------------|
| [`packages/`](packages) | The `@storylet-studio/*` npm workspaces (see below): model, compiler, runtime, ops, CLI, and the Storyletter app. |
| [`ports/`](ports) | The native Storylet Engine runtimes: Unity (C#), Unreal (C++), Godot (GDScript), each with a demo and held to the shared corpus. |
| [`website/`](website) | The [storylet.studio](https://storylet.studio) documentation site (Astro + Starlight). |
| [`examples/`](examples) | Worked example projects, from a 16-card slice to the full 86-card Village. |
| [`branding/`](branding) | The app icon and document icons the build needs. |

## Packages (`@storylet-studio/*`)

An npm-workspaces monorepo under `packages/`, layered bottom-up:

| Package | Role |
|---------|------|
| **`model`** | The data-model types: source shards (project / box / tags / hands / decks), the compiled bundle, the save envelope. The shape source-of-truth. |
| **`dialect`** | The storylets expression dialect for the expression engine: the five scopes (`@world`, `@story`, `@box`, `@deck`, `@hand`) and the built-in functions. |
| **`compiler`** | `.storylets` shards in, a validated `.storyletsc` bundle out. Canonical serialisation, the publish gate, and the staleness gate. |
| **`runtime`** | The JS reference runtime: an engine over the bundle and shared state, and a flow per playthrough (peek, deal, board, outcomes, play). Held to the corpus. |
| **`ops`** | The shared operations layer. Every project operation (init, export, validate, format, deal, merge, pack, coverage) as a pure function. The CLI and the editor are thin front-ends over it. |
| **`cli`** | The **`storyletengine`** command. |
| **`studio`** | **Storyletter**, the desktop editor (Electron). |
| **`play-helpers`** | Browser-side helpers for the JS runtime: the state logger, save-file plumbing. |
| **`conformance`** | A language-agnostic JSON corpus every runtime must pass. The cross-language parity contract. |

The expression engine and version-control awareness live in sibling repos and are
consumed as published packages: **`@wildwinter/expr`** with **`scoperegistry`**
(the language), and **`@wildwinter/simple-vc-lib`** (git, Perforce, Plastic and
SVN reads and writes).

## File types

A project is a **folder**, not a file, so that a team can merge it.

| Extension | Role | Source of truth? |
|-----------|------|------------------|
| `.storylets` | The **project**: a folder of shards (a package on macOS, a plain folder elsewhere) | yes (it *is* the source tree) |
| `.storyletproj` | Project settings, `@world` and `@story` declarations, export config | yes |
| `.storyletbox` | One box: the card template, `@box` properties, the ranking toggle | yes |
| `.storylettags` | Tag groups, their tags and each tag's properties, and map outlines | yes |
| `.storylethands` | Hand templates and hands | yes |
| `.storyletdeck` | One deck: its cards, its gate and its `@deck` properties | yes |
| `.storyletview` | The arrangement layer: where things sit on a canvas or a map, and nothing about what they are | yes, and safe to lose |
| `.storyletnotes` | Documentation notes and review comments | yes |
| `.storyletsc` | The compiled bundle your game loads (`export` output) | generated |
| `.storyletpack` | A packed portable project (`pack` output, a zip) | generated |

Source files are UTF-8 with LF endings, written as JSON5. The per-deck sharding plus
canonical, trailing-comma serialisation is what makes them merge cleanly across a team.

## Quick start

```sh
npm install            # install the workspace
npm test               # the full suite (vitest)
npm run typecheck      # tsc across the workspace
npm run studio         # launch Storyletter in dev mode

# the CLI, from a build:
node packages/cli/dist/cli.js init my-game --name "My Game"
node packages/cli/dist/cli.js deal wishing-well my-game
node packages/cli/dist/cli.js export my-game
```

## Examples

- **`examples/the-hamlet.storylets`** - 16 cards, meant to be read in one sitting.
- **`examples/the-village.storylets`** - the big one: 86 cards, 13 decks, 13 places
  across 5 regions, with a drawn map. It carries the original's own bugs on purpose,
  because an example that shows the tools earning their keep is worth more than a
  tidy one.
- **`examples/port-meridian.storylets`** and **`examples/saltmarsh.storylets`** -
  smaller worked projects.

## Documentation

- [storylet.studio](https://storylet.studio) - the full documentation site, also in
  this repo under [`website/`](website).
- [The conformance corpus](packages/conformance) - the parity contract every runtime
  is held to.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one rule worth knowing up front: new
engine behaviour lands in the conformance corpus, with hand-written expectations,
before any implementation.

## Licence

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
